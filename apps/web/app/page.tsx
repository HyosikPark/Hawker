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
