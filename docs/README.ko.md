# 🛒 Hawker

**Turn your API into an agent-payable product in 5 minutes.**

에이전트 경제의 Shopify — 누구나 자기 API/서비스/데이터를 AI 에이전트가
**발견하고, 호출하고, 건당 결제**하는 상품으로 만들어주는 인프라.

우리는 마켓플레이스(수요 집계)가 아니라 **판매자의 도구**다. 판매 채널은 공식 MCP
Registry, x402 Bazaar 등 기존 레지스트리에 멀티채널 배포로 올라탄다.

## 아키텍처 (v0.1 walking skeleton)

```
apps/gateway     Hono 멀티테넌트 MCP 게이트웨이 (Streamable HTTP, stateless)
                 상품별 POST /mcp/:slug · 결제 게이트 · 업스트림 프록시 · 미터링
                 관리(/v1) · 구매자(/v1/buyer) · 웹훅(/v1/webhooks) API
apps/web         Next.js 랜딩 + 판매자 대시보드 (포트 3402)
                 가입/토큰 로그인 → 매출·호출 타일, 14일 매출 차트, 상품/이벤트 테이블
packages/db      Drizzle 스키마 (sellers/products/tools/api_keys/credit_topups/usage_events)
                 개발용 SQLite → 프로덕션 Postgres 전환 예정
docs/            시장 리서치 · 제품 정의
```

**이중 결제 레일**
1. `X-PAYMENT` 헤더 — x402 (USDC on Base, 에이전트 완전 자율 결제)
2. `Authorization: Bearer hk_...` — 선불 크레딧 API 키 (Stripe/법정화폐·B2B 경로)

**과금 정책**: 예약 → 업스트림 성공 시 확정. 실패한 콜은 $0.
금액은 USD 마이크로 단위(1e6 = $1) — USDC 6 decimals와 1:1.

## 시작하기

```bash
pnpm install
pnpm db:push        # 스키마 적용 (data/hawker.db)
pnpm db:seed        # 데모 상품 weather-pro + 개발용 구매자 키($5) 발급
pnpm dev            # 게이트웨이 실행 → http://localhost:8402
pnpm --filter @hawker/web dev   # 대시보드 → http://localhost:3402
```

## 데모 흐름

```bash
# 상품 카드 (에이전트가 읽는 상품 소개)
curl http://localhost:8402/mcp/weather

# 무결제 호출 → HTTP 402 + x402 PaymentRequirements
curl -X POST http://localhost:8402/mcp/weather -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_current_weather","arguments":{"latitude":37.57,"longitude":126.98}}}'

# x402 결제 (개발 stub 모드: X-PAYMENT: test)
curl -X POST http://localhost:8402/mcp/weather -H 'content-type: application/json' -H 'X-PAYMENT: test' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_current_weather","arguments":{"latitude":37.57,"longitude":126.98}}}'

# 크레딧 결제 (시드가 출력한 hk_test_... 키 사용, 성공 시 $0.005 차감)
curl -X POST http://localhost:8402/mcp/weather -H 'content-type: application/json' \
  -H 'Authorization: Bearer hk_test_...' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_weather","arguments":{"latitude":35.68,"longitude":139.69}}}'
```

## 판매자 온보딩 (M2)

```bash
# 1. 가입 → 관리 토큰(hs_...) 1회 발급
curl -X POST http://localhost:8402/v1/sellers -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"You"}'

# 2. OpenAPI 스펙 제출 → 상품+툴 자동 생성 → MCP URL 즉시 발급
curl -X POST http://localhost:8402/v1/products -H "Authorization: Bearer hs_..." \
  -H 'content-type: application/json' -d '{
    "slug": "my-api",
    "defaultPriceUsdMicros": 2000,
    "priceOverrides": { "expensive_tool": 10000 },
    "openapiUrl": "https://example.com/openapi.json",
    "upstreamAuth": { "header": "X-Api-Key", "value": "..." }
  }'
```

`openapi`(인라인 JSON/YAML) 또는 `openapiUrl` 지원. path/query 파라미터와
`application/json` requestBody가 툴 인자로 변환되고, `include`로 operation을 선별할 수 있다.

## 구매자(에이전트 운영자) 흐름 (M3)

```bash
# 1. API 키 발급 (잔액 $0)
curl -X POST http://localhost:8402/v1/buyer/keys -H 'content-type: application/json' -d '{"label":"my agent"}'

# 2. Stripe Checkout으로 크레딧 충전 (STRIPE_SECRET_KEY 필요)
curl -X POST http://localhost:8402/v1/buyer/topup -H "Authorization: Bearer hk_..." \
  -H 'content-type: application/json' -d '{"amountUsd":10}'
# → checkoutUrl에서 결제하면 웹훅(/v1/webhooks/stripe)이 잔액을 충전 (멱등)

# 3. 잔액 조회
curl http://localhost:8402/v1/buyer/balance -H "Authorization: Bearer hk_..."
```

x402 쪽은 클라이언트가 `X-PAYMENT`(base64 결제 페이로드)를 보내면
facilitator `/verify` → 업스트림 실행 → `/settle` 순서로 처리되고,
온체인 영수증이 `X-PAYMENT-RESPONSE` 헤더로 반환된다. 실패한 콜은 정산하지 않는다.

## 로드맵

- [x] M1 — walking skeleton: 결제 게이트 걸린 멀티테넌트 MCP 게이트웨이
- [x] M2 — 셀러 온보딩: 관리 API(`/v1`) + OpenAPI 스펙 → 상품 자동 생성
- [x] M3 — 실결제: x402 facilitator 검증/정산(영수증 헤더) + Stripe 크레딧 충전(웹훅, 멱등)
- [x] M4 — 대시보드 (Next.js): 가입·매출 타일·14일 차트·상품/이벤트 테이블
- [x] M5 — 배포 + 레지스트리 등록
  - gateway: https://hawker-gateway.fly.dev (Fly.io nrt, 볼륨+SQLite)
  - web: https://hawker-web.vercel.app (Vercel)
  - 공식 MCP Registry: `io.github.HyosikPark/weather` 게시됨 (active)
  - x402 Bazaar: 메인넷/CDP facilitator 전환 시 (docs/deploy.md 참고)
- [ ] M6 — 정산(payout), Show HN 런칭
