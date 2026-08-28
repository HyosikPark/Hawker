import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequirements,
  decodePaymentHeader,
  encodeReceipt,
  settlePayment,
  verifyPayment,
  type X402Config,
} from './x402.js';

const baseCfg: Omit<X402Config, 'fetchFn'> = {
  mode: 'facilitator',
  network: 'base-sepolia',
  facilitatorUrl: 'https://fac.example',
  payTo: '0x1111111111111111111111111111111111111111',
};

const priceOpts = { priceUsdMicros: 5000, resource: 'https://h.dev/mcp/x', description: 'tool x' };

function header(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

test('requirements가 네트워크별 USDC 주소와 마이크로 단가를 담는다', () => {
  const req = buildRequirements({ ...baseCfg, fetchFn: fetch }, priceOpts);
  assert.equal(req.maxAmountRequired, '5000');
  assert.equal(req.network, 'base-sepolia');
  assert.equal(req.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  assert.equal(req.payTo, baseCfg.payTo);
});

test('verify는 디코드한 paymentPayload와 requirements를 facilitator에 보낸다', async () => {
  let captured: any;
  const fetchFn = (async (url: any, init: any) => {
    captured = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ isValid: true }), { status: 200 });
  }) as typeof fetch;

  const payload = { x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { sig: '0xabc' } };
  const cfg = { ...baseCfg, fetchFn };
  const res = await verifyPayment(cfg, header(payload), buildRequirements(cfg, priceOpts));

  assert.deepEqual(res, { ok: true });
  assert.equal(captured.url, 'https://fac.example/verify');
  assert.equal(captured.body.x402Version, 1);
  assert.deepEqual(captured.body.paymentPayload, payload);
  assert.equal(captured.body.paymentRequirements.maxAmountRequired, '5000');
});

test('verify 실패 사유가 전달된다', async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ isValid: false, invalidReason: 'insufficient_funds' }), {
      status: 200,
    })) as typeof fetch;
  const cfg = { ...baseCfg, fetchFn };
  const res = await verifyPayment(cfg, header({ a: 1 }), buildRequirements(cfg, priceOpts));
  assert.deepEqual(res, { ok: false, reason: 'insufficient_funds' });
});

test('base64가 아닌 X-PAYMENT는 facilitator 호출 없이 거절된다', async () => {
  let called = false;
  const fetchFn = (async () => {
    called = true;
    return new Response('{}');
  }) as typeof fetch;
  const cfg = { ...baseCfg, fetchFn };
  const res = await verifyPayment(cfg, '!!!not-base64-json!!!', buildRequirements(cfg, priceOpts));
  assert.equal(res.ok, false);
  assert.equal(called, false);
});

test('settle 성공 시 영수증을 반환하고 실패 시 throw한다', async () => {
  const okFetch = (async () =>
    new Response(
      JSON.stringify({ success: true, transaction: '0xdeadbeef', network: 'base-sepolia' }),
    )) as typeof fetch;
  const receipt = await settlePayment(
    { ...baseCfg, fetchFn: okFetch },
    header({ a: 1 }),
    buildRequirements({ ...baseCfg, fetchFn: okFetch }, priceOpts),
  );
  assert.equal(receipt.transaction, '0xdeadbeef');

  const failFetch = (async () =>
    new Response(JSON.stringify({ success: false, errorReason: 'expired' }))) as typeof fetch;
  await assert.rejects(
    settlePayment(
      { ...baseCfg, fetchFn: failFetch },
      header({ a: 1 }),
      buildRequirements({ ...baseCfg, fetchFn: failFetch }, priceOpts),
    ),
    /expired/,
  );
});

test('영수증 인코딩/디코딩 왕복', () => {
  const receipt = { success: true, transaction: '0x123', network: 'base' };
  assert.deepEqual(decodePaymentHeader(encodeReceipt(receipt)), receipt);
});

test('stub 모드는 "test"만 승인한다', async () => {
  const cfg: X402Config = { ...baseCfg, mode: 'stub', fetchFn: fetch };
  assert.equal((await verifyPayment(cfg, 'test', buildRequirements(cfg, priceOpts))).ok, true);
  assert.equal((await verifyPayment(cfg, 'nope', buildRequirements(cfg, priceOpts))).ok, false);
});
