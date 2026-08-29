import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 격리된 임시 DB로 결제 상태머신 검증 (@hawker/db import 전에 경로 지정)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawker-pay-'));
process.env.HAWKER_DB_PATH = path.join(tmpDir, 'test.db');
process.env.HAWKER_MASTER_KEY = 'a'.repeat(64);
process.env.HAWKER_X402_MODE = 'stub';

const { db, apiKeys } = await import('@hawker/db');
const { authorizePayment, commitPayment } = await import('./payments.js');
const { sha256Hex } = await import('./crypto.js');
const { eq, sql } = await import('drizzle-orm');

// 테스트용 최소 테이블 생성 (drizzle push 대신)
db.run(
  sql`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, label TEXT,
    credits_usd_micros INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  )`,
);

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

function makeKey(credits: number): string {
  const raw = `hk_test_${crypto.randomBytes(12).toString('hex')}`;
  db.insert(apiKeys)
    .values({ id: crypto.randomUUID(), keyHash: sha256Hex(raw), creditsUsdMicros: credits })
    .run();
  return raw;
}

const ctx = { resource: 'https://h.dev/mcp/x', description: 'x' };

test('가격 0이면 무료 통과 (결제 불필요)', async () => {
  const d = await authorizePayment({ priceUsdMicros: 0, ...ctx });
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.grant.rail, 'free');
});

test('결제 정보 없으면 402', async () => {
  const d = await authorizePayment({ priceUsdMicros: 5000, ...ctx });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.httpStatus, 402);
});

test('모르는 API 키는 401', async () => {
  const d = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: 'Bearer hk_test_nope', ...ctx });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.httpStatus, 401);
});

test('잔액 부족은 402', async () => {
  const key = makeKey(1000);
  const d = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: `Bearer ${key}`, ...ctx });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.httpStatus, 402);
});

test('충분한 크레딧은 승인, commit이 정확히 차감', async () => {
  const key = makeKey(10_000);
  const keyHash = sha256Hex(key);
  const d = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: `Bearer ${key}`, ...ctx });
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.grant.rail, 'credits');
  if (d.ok) await commitPayment(d.grant, { priceUsdMicros: 5000, ...ctx });
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();
  assert.equal(row!.creditsUsdMicros, 5000); // 10000 - 5000
});

test('실패콜은 commit을 안 부르면 차감 없음 (실패콜 $0 정책)', async () => {
  const key = makeKey(10_000);
  const keyHash = sha256Hex(key);
  const d = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: `Bearer ${key}`, ...ctx });
  assert.equal(d.ok, true);
  // 업스트림 실패 시나리오 → commit 호출 안 함
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();
  assert.equal(row!.creditsUsdMicros, 10_000); // 그대로
});

test('동시 차감 경합: 잔액 5000에 5000짜리 2건 → 하나만 성공', async () => {
  const key = makeKey(5000);
  const keyHash = sha256Hex(key);
  const d1 = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: `Bearer ${key}`, ...ctx });
  const d2 = await authorizePayment({ priceUsdMicros: 5000, authorizationHeader: `Bearer ${key}`, ...ctx });
  assert.ok(d1.ok && d2.ok); // 둘 다 authorize는 통과(잔액확인 시점엔 5000)
  const results = await Promise.allSettled([
    d1.ok ? commitPayment(d1.grant, { priceUsdMicros: 5000, ...ctx }) : Promise.reject(),
    d2.ok ? commitPayment(d2.grant, { priceUsdMicros: 5000, ...ctx }) : Promise.reject(),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  assert.equal(ok, 1, '정확히 하나만 차감 성공');
  assert.equal(failed, 1, '나머지는 잔액부족으로 실패');
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).get();
  assert.equal(row!.creditsUsdMicros, 0); // 음수로 안 감
});

test('x402 stub: 유효 헤더 승인, commit이 영수증 반환', async () => {
  const d = await authorizePayment({ priceUsdMicros: 5000, xPaymentHeader: 'test', ...ctx });
  assert.equal(d.ok, true);
  assert.equal(d.ok && d.grant.rail, 'x402');
  if (d.ok) {
    const receipt = await commitPayment(d.grant, { priceUsdMicros: 5000, ...ctx });
    assert.ok(receipt && receipt.success);
  }
});

test('x402 stub: 잘못된 헤더는 402', async () => {
  const d = await authorizePayment({ priceUsdMicros: 5000, xPaymentHeader: 'bogus', ...ctx });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.httpStatus, 402);
});
