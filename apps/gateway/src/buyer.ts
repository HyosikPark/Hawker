import crypto from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, apiKeys } from '@hawker/db';
import { sha256Hex } from './crypto.js';
import { getStripe } from './stripe.js';
import { canonicalUrl, formatUsd } from './types.js';

/**
 * 구매자(에이전트 운영자) API (/v1/buyer):
 *   POST /v1/buyer/keys    API 키 발급 (잔액 $0)
 *   GET  /v1/buyer/balance 잔액 조회
 *   POST /v1/buyer/topup   Stripe Checkout으로 크레딧 충전 링크 생성
 */

type ApiKey = typeof apiKeys.$inferSelect;

export const buyer = new Hono<{ Variables: { apiKey: ApiKey } }>();

buyer.post('/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawKey = `hk_live_${crypto.randomBytes(24).toString('hex')}`;
  const id = crypto.randomUUID();
  db.insert(apiKeys)
    .values({
      id,
      keyHash: sha256Hex(rawKey),
      label: typeof body?.label === 'string' ? body.label.slice(0, 100) : null,
      creditsUsdMicros: 0,
    })
    .run();
  return c.json(
    {
      apiKeyId: id,
      key: rawKey,
      note: '이 키는 다시 표시되지 않습니다. 툴 호출 시 Authorization: Bearer로 사용하세요.',
    },
    201,
  );
});

const requireKey: MiddlewareHandler<{ Variables: { apiKey: ApiKey } }> = async (c, next) => {
  const raw = c.req.header('authorization')?.match(/^Bearer\s+(hk_\S+)$/i)?.[1];
  const row = raw
    ? db.select().from(apiKeys).where(eq(apiKeys.keyHash, sha256Hex(raw))).get()
    : undefined;
  if (!row) return c.json({ error: 'API 키(Authorization: Bearer hk_...)가 필요합니다.' }, 401);
  c.set('apiKey', row);
  await next();
};
buyer.use('/balance', requireKey);
buyer.use('/topup', requireKey);

buyer.get('/balance', (c) => {
  const key = c.get('apiKey');
  return c.json({
    balanceUsdMicros: key.creditsUsdMicros,
    display: formatUsd(key.creditsUsdMicros),
  });
});

buyer.post('/topup', async (c) => {
  const stripe = getStripe();
  if (!stripe) {
    return c.json({ error: 'Stripe가 설정되지 않았습니다 (STRIPE_SECRET_KEY).' }, 503);
  }
  const key = c.get('apiKey');
  const body = await c.req.json().catch(() => ({}));
  const amountUsd = Number(body?.amountUsd);
  if (!Number.isInteger(amountUsd) || amountUsd < 1 || amountUsd > 1000) {
    return c.json({ error: 'amountUsd는 1~1000 사이의 정수(달러)여야 합니다.' }, 400);
  }

  const origin = canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountUsd * 100,
            product_data: { name: `Hawker credits $${amountUsd}` },
          },
          quantity: 1,
        },
      ],
      success_url: process.env.HAWKER_TOPUP_SUCCESS_URL ?? `${origin}/topup/success`,
      cancel_url: process.env.HAWKER_TOPUP_CANCEL_URL ?? `${origin}/topup/cancel`,
      metadata: { apiKeyId: key.id },
    });
    return c.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    return c.json({ error: `Stripe Checkout 생성 실패: ${(err as Error).message}` }, 502);
  }
});
