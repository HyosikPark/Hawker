# 🛒 Hawker

**Turn your API into an agent-payable product in 5 minutes.**

AI agents are becoming customers — but there's no easy way to sell to them.
Hawker packages any API as a hosted MCP server that agents can **discover, call,
and pay per use**: autonomously with x402 (USDC on Base), or via prepaid credits
(Stripe) for humans and teams. Failed calls are never charged. You keep 90%.

> Shopify didn't win by being a marketplace — it won by being the merchant's
> tool. Hawker is that, for the agent economy: you bring the API, we handle
> MCP hosting, metering, dual-rail billing, and distribution to the registries
> agents already search.

**Live demo**: [hawker-web.vercel.app](https://hawker-web.vercel.app) ·
gateway at [hawker-gateway.fly.dev](https://hawker-gateway.fly.dev) ·
first product listed on the [official MCP Registry](https://registry.modelcontextprotocol.io)
as `io.github.HyosikPark/weather`

## How it works

```
$ curl -X POST https://hawker-gateway.fly.dev/v1/products \
    -H "Authorization: Bearer hs_..." \
    -d '{ "slug": "my-api",
          "defaultPriceUsdMicros": 2000,
          "openapiUrl": "https://example.com/openapi.json",
          "upstreamAuth": { "header": "X-Api-Key", "value": "..." } }'

→ { "mcpUrl": "https://hawker-gateway.fly.dev/mcp/my-api",
    "tools": [ { "name": "search", "price": "$0.002" }, ... ] }
```

1. **Connect** — paste an OpenAPI spec (inline or URL). Every operation becomes
   an MCP tool; path/query/JSON-body parameters map automatically. Your upstream
   API key is AES-256-GCM encrypted and never exposed to buyers.
2. **Price** — per-tool, per-call, in USD micros (1:1 with USDC's 6 decimals).
3. **Sell** — you get a hosted Streamable-HTTP MCP endpoint instantly.
   - An agent calling without payment gets **HTTP 402** with x402
     `PaymentRequirements` — the response itself teaches the agent how to pay.
   - With an `X-PAYMENT` header: facilitator verify → upstream call → settle →
     on-chain receipt in `X-PAYMENT-RESPONSE`.
   - With a Hawker API key: prepaid credits, topped up via Stripe Checkout.
4. **Get paid** — usage is metered per call; request a payout from the dashboard
   (USDC on Base, 10% platform fee, failed calls always $0).

## Architecture

```
apps/gateway     Hono multi-tenant MCP gateway (stateless Streamable HTTP)
                 payment gate (x402 + credits) · upstream proxy · metering
                 seller API (/v1) · buyer API (/v1/buyer) · Stripe webhooks
apps/web         Next.js landing + seller dashboard (revenue chart, payouts)
packages/db      Drizzle ORM (SQLite for MVP; Postgres planned)
```

## Run locally

```bash
pnpm install
pnpm db:push && pnpm db:seed     # demo product + a $5 dev buyer key
pnpm dev                         # gateway → http://localhost:8402
pnpm --filter @hawker/web dev    # dashboard → http://localhost:3402
```

Try the 402 flow (dev stub mode accepts `X-PAYMENT: test`):

```bash
curl -X POST http://localhost:8402/mcp/weather -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_current_weather","arguments":{"latitude":37.57,"longitude":126.98}}}'
# → 402 + payment requirements. Add "X-PAYMENT: test" and it returns live weather.
```

## Try it as an agent

`examples/agent-buyer` is a complete autonomous buyer: it hits the paid
endpoint, receives the 402, signs a USDC authorization with its own wallet, and
retries — no human in the loop. The first real purchase settled on Base Sepolia:
[`0x2757d3…8af312`](https://sepolia.basescan.org/tx/0x2757d30a2e55fa51a99eb0b132c6c9e54a18c8ffc8c76aa45025a8ca728af312)
($0.005 for the current weather in Seoul).

```bash
pnpm --filter @hawker/example-agent-buyer gen-wallets   # test wallets
# fund the buyer wallet with testnet USDC: https://faucet.circle.com (Base Sepolia)
pnpm --filter @hawker/example-agent-buyer buy           # 402 → sign → data + receipt
```

## Status

Early MVP, built in the open. Working today: OpenAPI import (API + dashboard
form), hosted MCP endpoints, dual-rail billing (**x402 live on Base Sepolia** /
Stripe credits), metering, payout ledger, and four products on the official MCP
Registry (`weather`, `fx-rates`, `geocode`, `wiki-summary` under
`io.github.HyosikPark/*`). Mainnet x402 + Bazaar indexing are next.
Docs: [deploy runbook](docs/deploy.md) ·
[market research](docs/market-research-2026-08.md) ·
[한국어 문서](docs/README.ko.md)
