# Show HN 런칭 플랜 (M6)

## 포스트 초안

**제목 (80자 제한):**
> Show HN: Hawker – Turn your API into a product AI agents can discover and pay for

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

- [ ] x402 테스트넷(base-sepolia) 실결제 데모 — stub 아닌 진짜 verify/settle
      (`fly secrets set HAWKER_X402_MODE=facilitator ...`, docs/deploy.md)
- [ ] 첫 상품 2~3개 추가 (카탈로그가 비어 보이지 않게 — 환율, 지오코딩 등 무료 업스트림)
- [ ] 대시보드에서 신규 가입 → 상품 생성 흐름 스스로 리허설 (셀프서브 UX 구멍 확인)
- [ ] README의 curl 데모가 복붙으로 바로 되는지 재확인
- [ ] GitHub repo: About(설명+링크), topics(mcp, x402, ai-agents, api-monetization)
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
