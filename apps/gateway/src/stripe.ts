import Stripe from 'stripe';
import { eq, sql } from 'drizzle-orm';
import { db, apiKeys, creditTopups } from '@hawker/db';

let cached: Stripe | null | undefined;

/** STRIPE_SECRET_KEY가 설정된 경우에만 활성화. 미설정 시 null (기능 비활성). */
export function getStripe(): Stripe | null {
  if (cached === undefined) {
    const key = process.env.STRIPE_SECRET_KEY;
    cached = key ? new Stripe(key) : null;
  }
  return cached;
}

/**
 * Checkout 완료 → 크레딧 충전. 세션 id를 PK로 써서 웹훅 재전송에도 멱등.
 * 반환: 'completed'(이번에 충전) | 'already'(이미 처리됨)
 */
export function applyTopup(opts: {
  sessionId: string;
  apiKeyId: string;
  amountUsdMicros: number;
}): 'completed' | 'already' {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(creditTopups)
      .where(eq(creditTopups.id, opts.sessionId))
      .get();
    if (existing?.status === 'completed') return 'already';

    if (existing) {
      tx.update(creditTopups)
        .set({ status: 'completed' })
        .where(eq(creditTopups.id, opts.sessionId))
        .run();
    } else {
      tx.insert(creditTopups)
        .values({
          id: opts.sessionId,
          apiKeyId: opts.apiKeyId,
          amountUsdMicros: opts.amountUsdMicros,
          status: 'completed',
        })
        .run();
    }
    const res = tx
      .update(apiKeys)
      .set({ creditsUsdMicros: sql`${apiKeys.creditsUsdMicros} + ${opts.amountUsdMicros}` })
      .where(eq(apiKeys.id, opts.apiKeyId))
      .run();
    if (res.changes === 0) throw new Error(`충전 대상 API 키 없음: ${opts.apiKeyId}`);
    return 'completed';
  });
}
