/**
 * 테스트넷용 지갑 2개 생성: 플랫폼 수취(payTo) + 에이전트 지불(buyer).
 * 키는 리포 루트의 .wallets.testnet.json 에 저장 (gitignore 대상, 테스트넷 전용).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outPath = path.join(root, '.wallets.testnet.json');

if (fs.existsSync(outPath)) {
  const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  console.log('이미 존재합니다:', outPath);
  console.log('  platform(payTo):', existing.platform.address);
  console.log('  buyer(agent):   ', existing.buyer.address);
  process.exit(0);
}

function make() {
  const pk = generatePrivateKey();
  return { privateKey: pk, address: privateKeyToAccount(pk).address };
}

const wallets = { network: 'base-sepolia', platform: make(), buyer: make() };
fs.writeFileSync(outPath, JSON.stringify(wallets, null, 2), { mode: 0o600 });

console.log(`저장됨: ${outPath} (테스트넷 전용 — 메인넷에는 절대 재사용 금지)`);
console.log('  platform(payTo):', wallets.platform.address);
console.log('  buyer(agent):   ', wallets.buyer.address);
