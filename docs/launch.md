# Show HN 런칭 플랜 (M6)

> 2026-08-29 개정: "한국 데이터" 각을 훅으로 추가. 한국어 리허설은 docs/launch-kr.md.

## 포스트 초안 (개정판)

**제목 (80자 제한):**
> Show HN: Hawker – I sell Korean government data to AI agents, per call

**대안 제목:**
> Show HN: Hawker – Turn your API into a product AI agents can discover and pay for

**훅 (본문 서두에 추가):**
> Agents don't buy sneakers — they buy senses, hands, and memory. My bet: the
> most valuable things to sell them are datasets that are invisible to their
> training data AND to English-language search. Korea is full of those: official
> apartment transaction prices, business registration status, substitute
> holidays. I wrapped them (plus the tooling to wrap anything) into per-call
> products agents can discover and pay for autonomously.

**본문 초안:**

> Hi HN — I built Hawker because thousands of developers are running MCP servers
> that AI agents call for free, quietly eating the hosting costs.
>
> Hawker turns any API into an agent-payable product: paste an OpenAPI spec, set
> a per-call price, and you get a hosted MCP endpoint. Agents that call it
> without paying get an HTTP 402 with x402 payment requirements — the response
> itself teaches the agent how to pay (USDC on Base, fully autonomous). Humans
> and teams can use prepaid credits via Stripe instead. Failed calls are never
> charged, and sellers keep 90%.
>
> A few design choices I think are interesting:
> - It's a tool, not a marketplace. Demand aggregation killed RapidAPI; instead,
>   Hawker publishes your product to the registries agents already search (the
>   official MCP Registry today, x402 Bazaar next).
> - Prices are stored in USD micros — exactly 1:1 with USDC's 6 decimals, so
>   there's no conversion anywhere in the billing path.
> - The whole billing flow is reserve → execute → commit: verification happens
>   before the upstream call, settlement only after it succeeds.
>
> Demo: https://hawker-web.vercel.app (the first product is a weather API at
> $0.005/call — try the 402 flow with curl in the README).
> Code: https://github.com/HyosikPark/Hawker
>
> Honest caveat: agent-initiated spending is still tiny industry-wide. This is a
> picks-and-shovels bet that it grows. Would love feedback from anyone running
> MCP servers — what would it take for you to charge for yours?

## 런칭 전 체크리스트

- [x] x402 테스트넷(base-sepolia) 실결제 데모 — **완료 (2026-08-29)**: 프로덕션 facilitator 모드 전환,
      examples/agent-buyer로 첫 자율 결제 성공. 온체인 tx:
      `0x2757d30a2e55fa51a99eb0b132c6c9e54a18c8ffc8c76aa45025a8ca728af312` (플랫폼 지갑에 $0.005 수취 확인)
- [x] 첫 상품 추가 — fx-rates·geocode·wiki-summary 3개 라이브 + MCP Registry 게시 (총 4개)
- [x] 셀프서브 리허설 → 최대 구멍(상품 생성이 curl 전용) 발견, **대시보드 상품 생성 폼 추가로 해결**
- [x] GitHub repo: About(설명+데모 링크), topics(mcp, x402, ai-agents, api-monetization, agentic-commerce)
- [ ] README의 curl 데모 복붙 재확인 (프로덕션은 이제 facilitator 모드 — 로컬 stub 데모와 구분 명확한지)
- [ ] HN 계정 준비, 화·수요일 오전(미 동부) 게시가 통계적으로 유리
- [ ] 첫 1시간 댓글 대응 시간 확보 (질문에 빠른 답변이 순위를 결정)

## 예상 질문 대비

- "MCP 스펙에 결제가 없는데?" → 맞다. MCP는 발견/호출 계층이고 결제는 HTTP 계층(x402)에서
  처리하는 게 사실상 표준 패턴. 2026-07-28 스펙의 Extensions가 향후 공식화 통로.
- "Apify와 뭐가 다른가?" → Apify는 스크레이핑 액터 중심 + 자체 플랫폼에 종속.
  Hawker는 임의의 기존 API를 5분 만에 상품화하고, 유통은 열린 레지스트리에 맡긴다.
- "수요가 있긴 한가?" → 정직하게: 아직 작다(실질 일 ~$28K). 우리는 GMV 수수료가 아니라
  공급자 도구를 판다. 곡괭이 장사 타이밍이라는 판단.
- "크립토 필수인가?" → 아니다. Stripe 선불 크레딧 레일이 기본 제공되고 x402는 선택.
- "AgentCash랑 뭐가 달라?" → AgentCash의 본체는 구매자용 지갑(수요 집계)이고, 판매자는
  자기 코드에 결제를 직접 통합해야 한다. Hawker는 반대편 — 코드 0줄로 OpenAPI 스펙만
  붙여넣으면 호스팅·과금·정산까지. 상호보완적이라 우리 상품을 그들 디스커버리에 올릴
  계획이다. (MCPize와의 차이: 이중 레일(x402+법정화폐), 대시보드 셀프서브, 응답 변환)
- "왜 한국 데이터인가?" → 글로벌 모델의 학습에도, 영어 검색에도 없는 데이터라
  에이전트가 돈 주고 살 이유가 가장 명확한 카테고리다. 그리고 나만 만들 수 있다.
