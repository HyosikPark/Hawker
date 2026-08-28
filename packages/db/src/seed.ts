import crypto from 'node:crypto';
import { db, sellers, products, tools, apiKeys } from './index.js';

// 데모 시드: Open-Meteo(무료 공개 API)를 건당 $0.005 유료 상품으로 패키징.
// Hawker의 도그푸딩 상품 1호 — "우리 플랫폼 위에서 우리가 먼저 판다".

const sellerId = crypto.randomUUID();
const productId = crypto.randomUUID();

const existing = db.select().from(products).all();
if (existing.length > 0) {
  console.log(`이미 상품 ${existing.length}개가 존재합니다. 시드를 건너뜁니다.`);
  process.exit(0);
}

db.insert(sellers)
  .values({
    id: sellerId,
    email: 'founder@hawker.dev',
    name: 'Hawker (first-party)',
    payoutAddress: null,
  })
  .run();

db.insert(products)
  .values({
    id: productId,
    sellerId,
    slug: 'weather',
    name: 'weather-pro',
    description:
      'Current weather and forecasts for any coordinates, backed by Open-Meteo. ' +
      'Paid per call — pay with x402 (USDC on Base) or a Hawker API key with prepaid credits.',
    upstreamBaseUrl: 'https://api.open-meteo.com',
    upstreamAuthEncrypted: null,
    status: 'live',
  })
  .run();

db.insert(tools)
  .values({
    id: crypto.randomUUID(),
    productId,
    name: 'get_current_weather',
    description:
      'Get the current weather (temperature °C, wind speed km/h, weather code) for a latitude/longitude.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude, e.g. 37.57' },
        longitude: { type: 'number', description: 'Longitude, e.g. 126.98' },
      },
      required: ['latitude', 'longitude'],
    },
    upstream: {
      method: 'GET',
      pathTemplate: '/v1/forecast',
      query: { latitude: 'latitude', longitude: 'longitude' },
      staticQuery: { current_weather: 'true' },
    },
    priceUsdMicros: 5_000, // $0.005 per call
  })
  .run();

// 개발용 구매자 API 키 ($5 크레딧). 원문은 이 출력에서만 볼 수 있다.
const rawKey = `hk_test_${crypto.randomBytes(24).toString('hex')}`;
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

db.insert(apiKeys)
  .values({
    id: crypto.randomUUID(),
    keyHash,
    label: 'dev buyer key',
    creditsUsdMicros: 5_000_000, // $5.00
  })
  .run();

console.log('시드 완료 ✅');
console.log('  상품: weather-pro  →  POST /mcp/weather');
console.log('  툴:   get_current_weather ($0.005/call)');
console.log(`  개발용 구매자 API 키 (크레딧 $5.00):\n\n  ${rawKey}\n`);
console.log('  이 키는 다시 표시되지 않습니다. .env나 안전한 곳에 보관하세요.');
