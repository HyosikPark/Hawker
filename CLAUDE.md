# Hawker

"당신의 API를 5분 만에 에이전트가 사고 쓰는 상품으로" — 에이전트 경제의 Shopify.
배경과 전략은 `docs/market-research-2026-08.md`, `docs/product-definition.md` 참고.

## 구조

- `apps/gateway` — Hono 멀티테넌트 MCP 게이트웨이. 상품별 `POST /mcp/:slug`.
  - `src/mcp.ts` JSON-RPC(Streamable HTTP, stateless) 처리
  - `src/payments.ts` 이중 결제 레일 (x402 / 선불 크레딧), 예약→성공시확정
  - `src/upstream.ts` 툴 인자 → 판매자 실제 API 프록시
- `packages/db` — Drizzle + SQLite(개발). 스키마 변경 시 `pnpm db:push`.

## 규칙

- 금액은 항상 **USD 마이크로 단위**(정수, 1_000_000 = $1). USDC 6 decimals와 1:1.
- 실패한 업스트림 콜은 절대 과금하지 않는다 (실패콜 $0 정책).
- 구매자에게 판매자의 업스트림 API 키가 노출되는 경로를 만들지 않는다.
- 판매자 시크릿은 AES-256-GCM 암호화(`src/crypto.ts`), 키 원문은 로그 금지.
- MCP 프로토콜 버전 상수: `apps/gateway/src/mcp.ts`의 `PROTOCOL_VERSION`.

## 명령

```bash
pnpm dev          # 게이트웨이 (포트 8402)
pnpm db:push      # 스키마 적용
pnpm db:seed      # 데모 시드 (이미 상품 있으면 스킵)
pnpm typecheck    # 전체 타입체크 — 커밋 전 필수
```

## 환경

`.env.example` 참고. 로컬 개발은 `HAWKER_X402_MODE=stub`(기본값) — `X-PAYMENT: test` 허용.
