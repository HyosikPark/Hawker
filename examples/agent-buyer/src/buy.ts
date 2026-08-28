/**
 * "에이전트가 스스로 결제하고 데이터를 산다" 데모.
 * 402 응답을 받으면 x402-fetch가 지갑으로 서명해 자동 재시도한다 — 사람 개입 0.
 *
 * 사용법: tsx src/buy.ts [mcpUrl] [toolName] [argsJson]
 * 기본값: Hawker 프로덕션 weather 상품에서 서울 날씨를 $0.005에 구매.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment, decodeXPaymentResponse } from 'x402-fetch';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const wallets = JSON.parse(fs.readFileSync(path.join(root, '.wallets.testnet.json'), 'utf8'));
const account = privateKeyToAccount(wallets.buyer.privateKey);

const [mcpUrl, toolName, argsJson] = process.argv.slice(2);
const url = mcpUrl ?? 'https://hawker-gateway.fly.dev/mcp/weather';
const tool = toolName ?? 'get_current_weather';
const args = argsJson ? JSON.parse(argsJson) : { latitude: 37.57, longitude: 126.98 };

console.log(`🤖 에이전트 지갑: ${account.address}`);
console.log(`🛒 구매 시도: ${tool} @ ${url}`);

const fetchWithPay = wrapFetchWithPayment(fetch, account);

const res = await fetchWithPay(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  }),
});

const body = await res.json();
console.log(`\nHTTP ${res.status}`);
console.log(JSON.stringify(body, null, 2).slice(0, 800));

const receiptHeader = res.headers.get('x-payment-response');
if (receiptHeader) {
  console.log('\n🧾 온체인 영수증:', decodeXPaymentResponse(receiptHeader));
}
