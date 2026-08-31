# 에이전트 발견 최적화 플레이북 (2026-08-31)

## 한 줄 결론
우리는 이미 상위 20%. 유일한 구조적 약점 = **x402.org facilitator를 쓰는 한 CDP Bazaar에 안 뜬다.**
CDP facilitator 전환(테스트넷 유지 가능)이 이번 주 최대 레버리지.

## 실트래픽 채널 (에이전트가 진짜 질의) vs 허영
**실트래픽 3개:**
1. 공식 MCP Registry ✅ 이미 8개 등재 (Claude/Cursor가 봄)
2. **CDP x402 Bazaar** ⚠️ CDP facilitator 전환 필요 — Coinbase/AWS AgentCore 에이전트가 봄. 2,945개 서비스 인덱싱
3. 402index.io — Claude/Cursor에 MCP로 직접 붙음. 도메인 검증으로 등재

**허영(등재는 되나 트래픽 0):** llms.txt(300k도메인 분석 효과 0), gold-402/awesome류(사람용), 402radar 테스트넷, MCP 디렉터리 다수(사람 개발자용)

## ⚠️ 가장 불편한 진실: 트래픽은 알고리즘이 아니라 관계로 움직인다
- x402 활성 에이전트 ~6.9만, 극도로 집중. 수천 에이전트가 단일 운영자 하나로 추적됨.
- **단일 대형 운영자의 allowlist 결정 하나가 우리 볼륨의 1/3을 차지 가능.**
- → "디렉터리 SEO"보다 **소수 대형 에이전트 운영자와 직접 관계/allowlist 진입**이 압도적으로 중요.
- 검증 지표: "재방문 지불자 12명의 100콜 > 무료가입 1만 건"

## 메타데이터 베스트 (에이전트가 읽고 고르는 것)
- 가격을 **툴 description 안에** 명시 ($0.002/call) — MCP Registry엔 가격 필드 없음
- 구체 입출력 계약: "날씨" ❌ → "위경도 in, 3h 강수확률/기온 out, p50 40ms" ✅
- 실동작하는 example (에이전트가 그대로 시험 호출, 실패=탈락)
- 절대 URL, JSON Schema `$ref`는 `#` 포인터만
- bazaar 확장 `declareDiscoveryExtension`: toolName/description(500자↓)/transport/inputSchema/example/output.example

## 이번 주 할 일 (테스트넷 유지, 실비용 0)
1일: **CDP facilitator 전환** + 8라우트에 bazaar 확장 → validate → 테스트넷 유료콜 1건 → discovery/resources로 인덱싱 확인 (CDP 계정/키 필요 = 사용자)
2일: 8개 툴 description 품질 패스 (무엇/입력/출력/지연/가격, example 실동작 확인)
3일: 402index.io 도메인 검증 등재 + `.well-known/agent-card.json`(A2A) 추가
4일: MCP 디렉터리 일괄 (Glama/Smithery/PulseMCP/mcp.so/awesome PR) — 사람 개발자용
5일: **진짜 레버리지 = 대형 에이전트 운영자 직접 접촉/allowlist**

하지 말 것: llms.txt(효과 0), ERC-8004(메인넷 가스비, 미성숙), Vercel/CF 마켓(대상 아님)

## 우리 상황 메모
- CDP facilitator 전환엔 CDP 계정+API키 필요(무료). 테스트넷 유지하면 실돈 0.
- GitHub #2112: CDP 전환해도 실제 Bazaar 노출 여부는 discovery API로 검증 필수(버그 존재).
- 서버 현재 꺼둠(fly scale 0). 이 작업 시작할 때 켜야 함.
