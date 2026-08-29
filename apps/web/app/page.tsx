import Link from 'next/link';

export default function Landing() {
  return (
    <div className="container">
      <nav className="nav">
        <span className="brand">🛒 Hawker</span>
        <Link className="btn secondary" href="/dashboard">
          Dashboard
        </Link>
      </nav>

      <section className="hero">
        <h1>
          Turn your API into an
          <br />
          agent-payable product.
        </h1>
        <p>
          AI agents are becoming customers. Hawker packages your API as an MCP server they can
          discover, call, and pay per use — USDC via x402 or prepaid credits. Failed calls are
          never charged.
        </p>
        <Link className="btn" href="/dashboard">
          Start selling — it takes 5 minutes
        </Link>
      </section>

      <section className="steps">
        <div className="card step">
          <h3>1 · Connect</h3>
          <p>
            Paste your OpenAPI spec. Your upstream API key is encrypted and never exposed to
            buyers.
          </p>
        </div>
        <div className="card step">
          <h3>2 · Price</h3>
          <p>Set a price per tool call — from a tenth of a cent to $100. You keep 90%.</p>
        </div>
        <div className="card step">
          <h3>3 · Sell</h3>
          <p>
            Get a hosted MCP endpoint instantly. Agents pay autonomously with x402, humans top up
            credits with a card.
          </p>
        </div>
      </section>

      <section style={{ margin: '48px 0' }}>
        <h2 style={{ fontSize: 22, marginBottom: 14, textAlign: 'center' }}>Built to be verified, not trusted</h2>
        <div className="steps" style={{ margin: 0 }}>
          <div className="card step">
            <h3>Failed calls cost $0</h3>
            <p>
              Payment is committed only after your upstream call succeeds. If it fails, the buyer
              is never charged — enforced in code, not policy.
            </p>
          </div>
          <div className="card step">
            <h3>On-chain receipts</h3>
            <p>
              x402 settlements return the transaction hash in the response. Every payment is
              publicly verifiable on Base — we couldn&apos;t hide a charge if we wanted to.
            </p>
          </div>
          <div className="card step">
            <h3>Keys encrypted, code public</h3>
            <p>
              Upstream API keys are AES-256-GCM encrypted at rest and never reach buyers. Don&apos;t
              take our word for it —{' '}
              <a href="https://github.com/HyosikPark/Hawker/blob/main/apps/gateway/src/crypto.ts">
                read the code
              </a>
              . The whole gateway is open source.
            </p>
          </div>
          <div className="card step">
            <h3>Start at zero risk</h3>
            <p>
              Free tools to try, $0.001 calls to test, prepaid credits to cap exposure. You never
              risk more than you loaded.
            </p>
          </div>
        </div>
        <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
          Built in the open by{' '}
          <a href="https://github.com/HyosikPark">Hyosik Park</a> · <Link href="/terms">Terms &amp; policies</Link>
        </p>
      </section>

      <pre className="code">
        {`$ curl -X POST https://api.hawker.dev/v1/products \\
    -H "Authorization: Bearer hs_..." \\
    -d '{ "slug": "my-api",
          "defaultPriceUsdMicros": 2000,
          "openapiUrl": "https://example.com/openapi.json" }'

→ { "mcpUrl": "https://api.hawker.dev/mcp/my-api", "tools": [...] }`}
      </pre>

      <footer className="footer">Hawker · the storefront layer of the agent economy</footer>
    </div>
  );
}
