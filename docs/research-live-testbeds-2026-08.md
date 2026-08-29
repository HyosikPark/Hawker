# 리서치: 에이전트 결제 실전 실험장 + 훔칠 교훈 (2026-08-30)

## 한 줄 결론
"에이전트가 돈을 낸다"는 이미 사실이지만 볼륨의 ~80%는 가짜(wash/self-dealing).
**진짜 상거래는 오직 "데이터/API 구매"에 집중** — 그게 정확히 Hawker가 파는 것.

## A. 실제로 돈이 도는 서비스 (x402 Inc 30일 실측, wash 제외 신뢰도 높음)
전체: 3.69M tx / $1.11M / 평균 ~$0.30 / 구매자 189,900 · 판매자 43,000 (구매자:판매자 = 4.4:1, 공급 부족)

매출 상위 = 전부 데이터/API:
- StableEnrich $3.12K/108k콜 — Apollo·Exa·Firecrawl·Maps·Serper 데이터 번들
- BlockRun YOPO $2.68K — LLM 게이트웨이 + 데이터 API
- HYRE Agent $1.42K — DeFi 인텔리전스(Nansen)
- weather.hugen.tokyo $274 — 날씨 API ← 우리 weather 상품과 동일 카테고리
- twit.sh $207 — 실시간 X 데이터
데이터 카테고리 = 전체 활동 30.9%로 최대 세그먼트.

## B. 훔칠 교훈 (실전에서 검증됨)
1. **마찰 제로가 전부.** 계정·API키·대시보드 제거. "결제 영수증 자체가 credential." → 우리 x402 레일이 이미 이 방향.
2. **가격은 "값어치 하나?"를 고민 안 하게 할 만큼 싸게.** 단 초마이크로($0.001)는 최소수수료에 죽음 — **센트 단위가 스윗스팟** ($1+ 거래 비중 49→95%로 이동). → 우리 kr-holidays $0.001은 너무 쌀 수 있음, 재검토.
3. **가격 투명성**: 402에 가격 실어 즉석 결제/재시도. → 이미 구현.
4. **서브초 실행**: 지연 = 에이전트가 대안 탐색.
5. **예산 안전장치**(allowlist·캡·레이트리밋)가 있어야 지갑 연다.

## C. 반드시 방어할 4대 실패모드 (arXiv "Five Attacks on x402")
- **Replay(멱등성 부재)**: 결제 서명 재사용 → $0.001 1건이 248회 grant된 실측. **→ [paymentId,resourceId] 원자적 single-use 필요. 우리 미구현 — 게시 전 검토.**
- **Settlement 불일치**: 온체인 확정 전 리소스 제공 → reorg로 결제 증발(실패율 5.18%). → 우리 "예약→성공시확정"이 정면 방어. 단 x402는 facilitator settle 신뢰.
- **캐시 누수**: 유료 응답이 CDN에 public 캐시 → 무료 유출. **→ Cache-Control: no-store, private 필수. 우리 미설정 — 게시 전 추가.**
- **디스커버리 조작**: 악성 서버 1개가 에이전트 선택 71.8% 포획, Sybil 5개로 60.2%. → 우리 실측 평판이 부분 대응.

## D. AI Village 교훈 (에이전트의 실제 무능)
에이전트는 실행보다 계획을 무한반복, 상거래 UI 조작 실패(티셔츠 단일사이즈 등록 등).
**→ UI/폼 제거하고 순수 MCP 툴콜=결제로 만들수록 에이전트가 완주. 이게 x402/MCP 존재이유이자 우리 해자.**

## E. 붙어서 따라갈 곳
- 대시보드: x402scan.com, x402station.com, Onyx Bazaar, Dune(Onchain Lu wash 필터)
- 레포: github.com/Merit-Systems/awesome-agentic-commerce (최고 인덱스), x402-foundation/x402
- 사람: Erik Reppel(@programmer, Coinbase x402 백서), Onchain Lu(@OnchainLu, wash 분석)
- 커뮤니티: Coinbase CDP Discord, r/x402
- 유통 등재처: Coinbase Agentic.market, Onyx Bazaar, Vercel AI SDK 디렉토리

## 전략 함의
- 시장 방향 = 맞음 (우리가 파는 데이터/API가 유일한 진짜 상거래 카테고리).
- 승부처: ①마찰제로 ②센트단위 투명가격 ③4대 실패모드 방어 ④판매자부족 시장서 디스커버리 등재.
- 게시 전 코드 보강 후보: 멱등 결제키, 유료응답 no-store 캐시헤더. 가격 재검토($0.001→센트).
