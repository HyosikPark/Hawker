import Link from 'next/link';

export const metadata = { title: 'Terms & Policies — Hawker' };

export default function Terms() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <nav className="nav">
        <Link className="brand" href="/">
          🛒 Hawker
        </Link>
      </nav>

      <h1 style={{ fontSize: 28, margin: '24px 0 6px' }}>Terms &amp; Policies</h1>
      <p className="hint">Last updated: 2026-08-30 · Plain-language, early-stage version</p>

      <div className="stack" style={{ marginTop: 20 }}>
        <div className="card">
          <h2 className="section">What Hawker is</h2>
          <p>
            Hawker is an early-stage, independently operated gateway that packages APIs as
            per-call, agent-payable MCP endpoints. It is currently run by a single operator
            (<a href="https://github.com/HyosikPark">Hyosik Park</a>) and the entire gateway is{' '}
            <a href="https://github.com/HyosikPark/Hawker">open source</a>. Payments currently
            settle on the Base Sepolia testnet while we validate demand; mainnet settlement is on
            the roadmap and will be announced clearly.
          </p>
        </div>

        <div className="card">
          <h2 className="section">Billing &amp; refunds</h2>
          <p>
            You are charged per successful tool call, at the price shown in the tool description
            before you call it. <strong>Calls that fail upstream are never charged</strong> — this
            is enforced in the payment flow itself (settlement happens only after a successful
            response). Prepaid credits are refundable for the unused balance on request. x402
            payments are settled on-chain and are final, but every settlement returns a public
            transaction hash you can verify. Billing disputes: open a{' '}
            <a href="https://github.com/HyosikPark/Hawker/issues">GitHub issue</a> or email the
            operator — we err on the side of refunding while small.
          </p>
        </div>

        <div className="card">
          <h2 className="section">For sellers</h2>
          <p>
            Your upstream API key is encrypted at rest (AES-256-GCM) and is only decrypted in
            memory to call your API on a buyer&apos;s behalf. It is never exposed to buyers, logs,
            or analytics. You keep 90% of gross revenue; payouts are made in USDC (Base) to the
            address you set, processed in periodic batches after you request them. You may pause
            or delist your product at any time. You are responsible for having the right to resell
            access to your upstream API.
          </p>
        </div>

        <div className="card">
          <h2 className="section">Fair use &amp; prohibited products</h2>
          <p>
            No reselling of credentials you don&apos;t control, no products that facilitate fraud,
            malware, or unlawful data collection, and no tool descriptions designed to manipulate
            agents (prompt injection). We may pause products that break these rules and will
            contact the seller.
          </p>
        </div>

        <div className="card">
          <h2 className="section">Service level (honest version)</h2>
          <p>
            This is an early product without a formal SLA. What you get instead: failed calls are
            free by construction, the system is open source, and incidents are disclosed publicly
            on GitHub. As usage grows we will publish uptime metrics and a real SLA.
          </p>
        </div>

        <div className="card">
          <h2 className="section">Data &amp; privacy</h2>
          <p>
            We store the minimum needed to operate: account email, hashed tokens/keys, encrypted
            upstream credentials, and per-call metering records (tool name, price, status,
            latency). We do not store or inspect the content of your tool call arguments or
            responses beyond transient proxying, and we do not sell data.
          </p>
        </div>

        <p className="hint">
          Questions: <a href="https://github.com/HyosikPark/Hawker/issues">GitHub issues</a>. These
          terms will grow up together with the service — material changes will be announced in the
          repo.
        </p>
      </div>
      <footer className="footer">Hawker · the storefront layer of the agent economy</footer>
    </div>
  );
}
