import { db, apiKeys, x402Claims } from '@hawker/db';
import { eq, sql, and, gte } from 'drizzle-orm';
import { sha256Hex } from './crypto.js';
import {
  buildRequirements,
  configFromEnv,
  payment402Body,
  settlePayment,
  verifyPayment,
  type SettleReceipt,
} from './x402.js';

/**
 * 이중 결제 레일:
 *  1) credits — Authorization: Bearer hk_...  (선불 크레딧, 법정화폐/B2B 경로)
 *  2) x402    — X-PAYMENT 헤더 (에이전트 자율 결제, USDC)
 *
 * 정책: 결제는 "검증(verify) → 업스트림 성공 시 확정(commit)" — 실패한 콜은 $0.
 */

export type PaymentGrant =
  | { rail: 'free' }
  | { rail: 'credits'; apiKeyId: string }
  | { rail: 'x402'; paymentHeader: string };

export type PaymentDecision =
  | { ok: true; grant: PaymentGrant }
  | { ok: false; httpStatus: 401 | 402; body: Record<string, unknown> };

interface PriceContext {
  priceUsdMicros: number;
  resource: string;
  description: string;
}

export function paymentRequirements(opts: PriceContext): Record<string, unknown> {
  return payment402Body(configFromEnv(), opts);
}

/** 결제 서명을 원자적으로 1회 소비. 이미 존재(replay)하면 false. */
function claimX402(claimId: string, priceUsdMicros: number): boolean {
  try {
    db.insert(x402Claims)
      .values({ id: claimId, productId: '', priceUsdMicros })
      .run();
    return true;
  } catch {
    // UNIQUE(PK) 위반 = 이미 소비된 결제
    return false;
  }
}

export async function authorizePayment(
  opts: PriceContext & { authorizationHeader?: string; xPaymentHeader?: string },
): Promise<PaymentDecision> {
  const { priceUsdMicros } = opts;
  if (priceUsdMicros <= 0) return { ok: true, grant: { rail: 'free' } };

  // 레일 1: 선불 크레딧 API 키
  const bearer = opts.authorizationHeader?.match(/^Bearer\s+(hk_\S+)$/i)?.[1];
  if (bearer) {
    const keyHash = sha256Hex(bearer);
    const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();
    if (!row) {
      return { ok: false, httpStatus: 401, body: { error: 'Unknown API key.' } };
    }
    if (row.creditsUsdMicros < priceUsdMicros) {
      return {
        ok: false,
        httpStatus: 402,
        body: {
          error: `Insufficient credits: balance is ${row.creditsUsdMicros} micros, call costs ${priceUsdMicros}. Top up via POST /v1/buyer/topup.`,
          ...paymentRequirements(opts),
        },
      };
    }
    return { ok: true, grant: { rail: 'credits', apiKeyId: row.id } };
  }

  // 레일 2: x402
  if (opts.xPaymentHeader) {
    const cfg = configFromEnv();
    const verified = await verifyPayment(cfg, opts.xPaymentHeader, buildRequirements(cfg, opts));
    if (!verified.ok) {
      return {
        ok: false,
        httpStatus: 402,
        body: { error: `x402 verification failed: ${verified.reason}`, ...paymentRequirements(opts) },
      };
    }
    // Replay 방어: (결제서명 × 리소스) 단일 소비. 이미 소비됐으면 재사용 시도이므로 거부.
    const claimId = sha256Hex(`${opts.xPaymentHeader}:${opts.resource}`);
    if (!claimX402(claimId, opts.priceUsdMicros)) {
      return {
        ok: false,
        httpStatus: 402,
        body: {
          error: 'This payment has already been used (replay). Provide a fresh X-PAYMENT.',
          ...paymentRequirements(opts),
        },
      };
    }
    return { ok: true, grant: { rail: 'x402', paymentHeader: opts.xPaymentHeader } };
  }

  return { ok: false, httpStatus: 402, body: paymentRequirements(opts) };
}

/**
 * 업스트림 성공 후 결제 확정.
 * credits는 잔액 차감(null 반환), x402는 온체인 정산 후 영수증 반환.
 */
export async function commitPayment(
  grant: PaymentGrant,
  opts: PriceContext,
): Promise<SettleReceipt | null> {
  if (grant.rail === 'credits') {
    // 원자적 차감 — 잔액이 그 사이 부족해졌으면 차감 실패 (동시 호출 경합 방지)
    const res = db
      .update(apiKeys)
      .set({ creditsUsdMicros: sql`${apiKeys.creditsUsdMicros} - ${opts.priceUsdMicros}` })
      .where(and(eq(apiKeys.id, grant.apiKeyId), gte(apiKeys.creditsUsdMicros, opts.priceUsdMicros)))
      .run();
    if (res.changes === 0) throw new Error('크레딧 차감 실패(경합 또는 잔액 부족)');
    return null;
  }
  if (grant.rail === 'x402') {
    const cfg = configFromEnv();
    return settlePayment(cfg, grant.paymentHeader, buildRequirements(cfg, opts));
  }
  return null;
}
