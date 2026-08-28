import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

// 금액은 전부 USD 마이크로 단위(1_000_000 = $1).
// USDC가 6 decimals라 x402의 atomic amount와 1:1로 일치한다.

export const sellers = sqliteTable('sellers', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  // 관리 API 토큰(hs_...)의 sha256. 원문은 발급 시 1회만 노출.
  tokenHash: text('token_hash').unique(),
  // MVP 정산: Base 체인 USDC 지급 주소
  payoutAddress: text('payout_address'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  upstreamBaseUrl: text('upstream_base_url').notNull(),
  // AES-256-GCM으로 암호화된 JSON: { header: "X-Api-Key", value: "..." } | null
  upstreamAuthEncrypted: text('upstream_auth_encrypted'),
  status: text('status', { enum: ['draft', 'live', 'paused'] })
    .notNull()
    .default('live'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * upstream 매핑 (tools.upstream JSON):
 * {
 *   method: "GET" | "POST" | ...,
 *   pathTemplate: "/v1/forecast" | "/users/{id}",   // {arg}는 툴 인자로 치환
 *   query: { latitude: "latitude" },                 // queryParam -> 툴 인자 이름
 *   staticQuery: { current_weather: "true" },        // 항상 붙는 고정 쿼리
 *   bodyArgs: ["text", "options"]                    // JSON body로 보낼 인자들
 * }
 */
export const tools = sqliteTable(
  'tools',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    inputSchema: text('input_schema', { mode: 'json' }).notNull(),
    upstream: text('upstream', { mode: 'json' }).notNull(),
    priceUsdMicros: integer('price_usd_micros').notNull().default(0),
  },
  (t) => [uniqueIndex('tools_product_name_idx').on(t.productId, t.name)],
);

// 선불 크레딧 구매자 (법정화폐 레일). 키 원문은 저장하지 않는다.
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  keyHash: text('key_hash').notNull().unique(), // sha256(hex)
  label: text('label'),
  creditsUsdMicros: integer('credits_usd_micros').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 판매자 정산 기록. MVP: 요청은 API로, 실송금은 운영자 수동 후 paid 처리.
export const payouts = sqliteTable('payouts', {
  id: text('id').primaryKey(),
  sellerId: text('seller_id')
    .notNull()
    .references(() => sellers.id),
  amountUsdMicros: integer('amount_usd_micros').notNull(),
  status: text('status', { enum: ['pending', 'paid'] })
    .notNull()
    .default('pending'),
  // 요청 시점의 지급 주소 스냅샷 (이후 판매자가 주소를 바꿔도 기록 보존)
  payoutAddress: text('payout_address').notNull(),
  txRef: text('tx_ref'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  paidAt: integer('paid_at', { mode: 'timestamp' }),
});

// Stripe 크레딧 충전 기록. id = Stripe Checkout Session id → 웹훅 재전송에도 중복 충전 방지.
export const creditTopups = sqliteTable('credit_topups', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id')
    .notNull()
    .references(() => apiKeys.id),
  amountUsdMicros: integer('amount_usd_micros').notNull(),
  status: text('status', { enum: ['pending', 'completed'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const usageEvents = sqliteTable('usage_events', {
  id: text('id').primaryKey(),
  productId: text('product_id').notNull(),
  toolName: text('tool_name').notNull(),
  rail: text('rail', { enum: ['credits', 'x402', 'free'] }).notNull(),
  apiKeyId: text('api_key_id'),
  priceUsdMicros: integer('price_usd_micros').notNull(),
  status: text('status', {
    enum: ['ok', 'upstream_error', 'payment_required', 'invalid_args'],
  }).notNull(),
  latencyMs: integer('latency_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
