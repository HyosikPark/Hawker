/**
 * x402 프로토콜 클라이언트 (resource server 측).
 * 흐름: 402로 requirements 제시 → 클라이언트가 X-PAYMENT(base64 JSON) 제출
 *      → facilitator /verify → 업스트림 실행 → facilitator /settle → 영수증 반환.
 *
 * HAWKER_X402_MODE=stub        : 로컬 개발 — "X-PAYMENT: test"를 승인, 정산 생략
 * HAWKER_X402_MODE=facilitator : 실검증/정산 (기본 네트워크 base-sepolia 테스트넷)
 */

const USDC_BY_NETWORK: Record<string, { asset: string; name: string; version: string }> = {
  base: { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USD Coin', version: '2' },
  'base-sepolia': { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' },
};

export interface X402Config {
  mode: 'stub' | 'facilitator';
  network: string;
  facilitatorUrl?: string;
  payTo: string;
  fetchFn: typeof fetch;
}

export function configFromEnv(): X402Config {
  return {
    mode: process.env.HAWKER_X402_MODE === 'facilitator' ? 'facilitator' : 'stub',
    network: process.env.HAWKER_X402_NETWORK ?? 'base-sepolia',
    facilitatorUrl: process.env.HAWKER_X402_FACILITATOR_URL,
    payTo: process.env.HAWKER_PAYTO_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    fetchFn: fetch,
  };
}

export interface PaymentRequirementsV1 {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

export function buildRequirements(
  cfg: X402Config,
  opts: { priceUsdMicros: number; resource: string; description: string },
): PaymentRequirementsV1 {
  const usdc = USDC_BY_NETWORK[cfg.network] ?? USDC_BY_NETWORK['base'];
  return {
    scheme: 'exact',
    network: cfg.network,
    maxAmountRequired: String(opts.priceUsdMicros), // USDC 6 decimals == USD micros
    resource: opts.resource,
    description: opts.description,
    mimeType: 'application/json',
    payTo: cfg.payTo,
    asset: usdc.asset,
    maxTimeoutSeconds: 60,
    extra: { name: usdc.name, version: usdc.version },
  };
}

export function payment402Body(
  cfg: X402Config,
  opts: { priceUsdMicros: number; resource: string; description: string },
): Record<string, unknown> {
  return {
    x402Version: 1,
    error:
      'Payment required. Provide an X-PAYMENT header (x402) or a Hawker API key via Authorization: Bearer.',
    accepts: [buildRequirements(cfg, opts)],
  };
}

/** X-PAYMENT 헤더(base64 JSON) 디코드. 실패 시 null. */
export function decodePaymentHeader(header: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export interface SettleReceipt {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
}

export async function verifyPayment(
  cfg: X402Config,
  paymentHeader: string,
  requirements: PaymentRequirementsV1,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (cfg.mode === 'stub') {
    return paymentHeader === 'test'
      ? { ok: true }
      : { ok: false, reason: 'stub 모드에서는 "X-PAYMENT: test"만 허용됩니다.' };
  }
  if (!cfg.facilitatorUrl) return { ok: false, reason: 'HAWKER_X402_FACILITATOR_URL 미설정' };

  const paymentPayload = decodePaymentHeader(paymentHeader);
  if (!paymentPayload) return { ok: false, reason: 'X-PAYMENT 헤더가 base64 JSON이 아닙니다.' };

  const res = await cfg.fetchFn(`${cfg.facilitatorUrl}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, reason: `facilitator /verify HTTP ${res.status}` };
  const data = (await res.json()) as { isValid?: boolean; invalidReason?: string };
  return data.isValid ? { ok: true } : { ok: false, reason: data.invalidReason ?? 'invalid' };
}

export async function settlePayment(
  cfg: X402Config,
  paymentHeader: string,
  requirements: PaymentRequirementsV1,
): Promise<SettleReceipt> {
  if (cfg.mode === 'stub') return { success: true, transaction: 'stub', network: cfg.network };
  if (!cfg.facilitatorUrl) throw new Error('HAWKER_X402_FACILITATOR_URL 미설정');

  const paymentPayload = decodePaymentHeader(paymentHeader);
  const res = await cfg.fetchFn(`${cfg.facilitatorUrl}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: requirements }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`x402 정산 실패: facilitator /settle HTTP ${res.status}`);
  const data = (await res.json()) as SettleReceipt & { errorReason?: string };
  if (!data.success) throw new Error(`x402 정산 실패: ${data.errorReason ?? 'unknown'}`);
  return data;
}

/** 정산 영수증을 X-PAYMENT-RESPONSE 헤더 값(base64 JSON)으로 인코딩 */
export function encodeReceipt(receipt: SettleReceipt): string {
  return Buffer.from(JSON.stringify(receipt), 'utf8').toString('base64');
}
