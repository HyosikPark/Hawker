import { Hono } from 'hono';
import type Stripe from 'stripe';
import { getStripe, applyTopup } from './stripe.js';

export const webhooks = new Hono();

/** Stripe 웹훅. 서명 검증 후 checkout.session.completed → 크레딧 충전(멱등). */
webhooks.post('/stripe', async (c) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return c.json({ error: 'Stripe 웹훅이 설정되지 않았습니다.' }, 503);
  }

  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'stripe-signature 헤더 누락' }, 400);

  const rawBody = await c.req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return c.json({ error: `서명 검증 실패: ${(err as Error).message}` }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const apiKeyId = session.metadata?.apiKeyId;
    const amountTotal = session.amount_total; // USD cents
    if (!apiKeyId || typeof amountTotal !== 'number' || amountTotal <= 0) {
      return c.json({ error: '세션에 apiKeyId metadata 또는 amount_total이 없습니다.' }, 400);
    }
    try {
      const outcome = applyTopup({
        sessionId: session.id,
        apiKeyId,
        amountUsdMicros: amountTotal * 10_000, // cents → micros
      });
      return c.json({ received: true, outcome });
    } catch (err) {
      // 5xx를 돌려주면 Stripe가 재시도한다
      return c.json({ error: (err as Error).message }, 500);
    }
  }

  return c.json({ received: true, ignored: event.type });
});
