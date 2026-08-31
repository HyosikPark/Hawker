/**
 * x402 HTTP 엔드포인트(/x402/:slug/:tool) 자율 결제 데모.
 * CDP Bazaar 인덱싱 트리거용 — 실제 결제 1건을 발생시킨다.
 * 사용법: tsx src/buy-http.ts <url> <bodyJson>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment, decodeXPaymentResponse } from 'x402-fetch';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const wallets = JSON.parse(fs.readFileSync(path.join(root, '.wallets.testnet.json'), 'utf8'));
const account = privateKeyToAccount(wallets.buyer.privateKey);

const [url, bodyJson] = process.argv.slice(2);
const target = url ?? 'https://hawker-gateway.fly.dev/x402/kr-holidays/get_holidays';
const body = bodyJson ?? '{"solYear":"2026","solMonth":"10","_type":"json"}';

console.log(`🤖 에이전트 지갑: ${account.address}`);
console.log(`🛒 x402 HTTP 결제 시도: ${target}`);

const fetchWithPay = wrapFetchWithPayment(fetch, account);
const res = await fetchWithPay(target, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});

console.log(`\nHTTP ${res.status}`);
const text = await res.text();
console.log(text.slice(0, 300));

const receipt = res.headers.get('x-payment-response');
if (receipt) console.log('\n🧾 온체인 영수증:', decodeXPaymentResponse(receipt));
