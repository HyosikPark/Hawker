# 배포 런북 (M5)

## ⚡ 프로덕션 복구 절차 (Fly 체험 종료 후 — 카드 등록되면 이 순서대로)

```bash
# 1. https://fly.io/trial 에서 카드 등록 (사람)
# 2. 재배포 — 볼륨·시크릿·기존 상품 데이터는 보존돼 있음
fly deploy -a hawker-gateway --yes
curl https://hawker-gateway.fly.dev/            # 헬스체크

# 3. 한국 데이터 상품 4종을 프로덕션에 개점 (로컬에서 실행 — .datago.key 필요)
sh catalog/create-kr-products.sh https://hawker-gateway.fly.dev

# 4. MCP Registry에 한국 상품 게시 (디바이스 로그인 필요)
mcp-publisher login github
# 상품별 server.json 만들어 publish — scripts/registry-payload.ts 참고
#   (kr-* 상품은 로컬 DB 기준이므로 프로덕션 URL을 인자로)

# 5. 검증: 402 흐름 + 크레딧 호출 + 대시보드 접속
# 6. 게시: docs/launch-kr.md (GeekNews → 디스콰이엇) → docs/launch.md (Show HN)
```


## 구성

| 서비스 | 호스팅 | URL |
|---|---|---|
| gateway (Hono + SQLite) | Fly.io (볼륨, 단일 인스턴스) | `https://<app>.fly.dev` |
| web (Next.js) | Vercel | `https://<project>.vercel.app` |

## 1. 게이트웨이 — Fly.io

```bash
brew install flyctl
fly auth login                      # 브라우저 로그인 (계정 없으면 가입)
fly launch --no-deploy --copy-config --name hawker-gateway  # fly.toml 사용
fly volumes create hawker_data --size 1 --region nrt
fly secrets set HAWKER_MASTER_KEY=$(openssl rand -hex 32)
fly deploy
curl https://hawker-gateway.fly.dev/          # 헬스체크
```

실결제 전환 시 (테스트넷):

```bash
fly secrets set HAWKER_X402_MODE=facilitator \
  HAWKER_X402_FACILITATOR_URL=https://x402.org/facilitator \
  HAWKER_X402_NETWORK=base-sepolia \
  HAWKER_PAYTO_ADDRESS=0x<우리 지갑>
```

Stripe 전환 시: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` secrets 추가 후
Stripe 대시보드에 웹훅 엔드포인트 `https://<app>.fly.dev/v1/webhooks/stripe` 등록
(이벤트: `checkout.session.completed`).

주의: SQLite 단일 인스턴스 전제 — `min_machines_running=1`, 스케일아웃 금지.
스케일이 필요해지면 Postgres 전환이 선행 조건.

## 2. 웹 — Vercel

```bash
cd apps/web
vercel link                          # 프로젝트 연결(최초 1회)
vercel env add NEXT_PUBLIC_GATEWAY_URL production   # https://hawker-gateway.fly.dev
vercel --prod
```

## 3. 레지스트리 등록 (배포 후)

### 공식 MCP Registry

```bash
brew install mcp-publisher
# 상품별 server.json 생성 (네임스페이스: io.github.<GitHub유저명> — GitHub 로그인으로 소유 증명)
pnpm --filter @hawker/gateway exec tsx scripts/registry-payload.ts weather \
  https://hawker-gateway.fly.dev io.github.<username> > server.json
mcp-publisher login github
mcp-publisher publish
```

커스텀 도메인 네임스페이스(`dev.hawker/*`)는 도메인 구매 후 DNS TXT 인증으로 전환.

### x402 Bazaar (Coinbase)

Coinbase CDP facilitator를 쓰면(메인넷 실결제 전환 시) `discoverable` 플래그로
Bazaar에 자동 인덱싱된다. 테스트넷 단계에서는 해당 없음 — 메인넷 전환 시 함께 진행.

## 체크리스트

- [ ] fly deploy 성공 + `/` 헬스체크
- [ ] 데모 상품 시드 (프로덕션 DB에서 `pnpm db:seed`는 fly ssh console에서)
- [ ] 402 흐름 프로덕션 검증 (무결제 → 402)
- [ ] Vercel 웹 배포 + 대시보드에서 프로덕션 게이트웨이 접속
- [ ] MCP Registry에 첫 상품 게시
- [ ] (메인넷 전환 시) CDP facilitator + Bazaar 인덱싱
