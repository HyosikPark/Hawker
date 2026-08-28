'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RevenueChart, type DailyPoint } from '../../components/RevenueChart';

const GW = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8402';
const TOKEN_KEY = 'hawker_seller_token';

interface Stats {
  totals: { calls: number; revenueUsdMicros: number };
  products: {
    productId: string;
    slug: string;
    name: string;
    status: string;
    calls: number;
    revenueUsdMicros: number;
  }[];
  daily: DailyPoint[];
}

interface Earnings {
  grossUsdMicros: number;
  feeUsdMicros: number;
  feeBp: number;
  netUsdMicros: number;
  availableUsdMicros: number;
  minPayoutUsdMicros: number;
  payoutAddress: string | null;
}

interface Payout {
  id: string;
  amountUsdMicros: number;
  status: string;
  txRef: string | null;
  createdAt: string;
}

interface UsageEvent {
  toolName: string;
  rail: string;
  priceUsdMicros: number;
  status: string;
  latencyMs: number | null;
  createdAt: string;
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0'}`;
}

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<UsageEvent[] | null>(null);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [payoutList, setPayoutList] = useState<Payout[]>([]);
  const [addressInput, setAddressInput] = useState('');
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);

  // 가입 폼
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(TOKEN_KEY));
    } catch {}
    setReady(true);
  }, []);

  const logout = () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {}
    setToken(null);
    setStats(null);
    setSelected(null);
    setIssuedToken(null);
  };

  const fetchStats = useCallback(async (t: string) => {
    setError(null);
    try {
      const res = await fetch(`${GW}/v1/stats`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) {
        setError('Token was rejected. Log in again.');
        setStats(null);
        return;
      }
      setStats((await res.json()) as Stats);
      const [eRes, pRes] = await Promise.all([
        fetch(`${GW}/v1/earnings`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`${GW}/v1/payouts`, { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (eRes.ok) {
        const e = (await eRes.json()) as Earnings;
        setEarnings(e);
        setAddressInput(e.payoutAddress ?? '');
      }
      if (pRes.ok) setPayoutList(((await pRes.json()) as { payouts: Payout[] }).payouts);
    } catch {
      setError(`Could not reach the gateway at ${GW}. Is it running?`);
    }
  }, []);

  const saveAddress = async () => {
    if (!token) return;
    setPayoutMsg(null);
    const res = await fetch(`${GW}/v1/sellers/me`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payoutAddress: addressInput.trim() }),
    });
    const data = await res.json();
    setPayoutMsg(res.ok ? 'Payout address saved.' : data.error);
    if (res.ok) void fetchStats(token);
  };

  const requestPayout = async () => {
    if (!token) return;
    setPayoutMsg(null);
    const res = await fetch(`${GW}/v1/payouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    setPayoutMsg(res.ok ? `Payout requested: ${usd(data.amountUsdMicros)} (USDC on Base, batched)` : data.error);
    if (res.ok) void fetchStats(token);
  };

  useEffect(() => {
    if (token) void fetchStats(token);
  }, [token, fetchStats]);

  const signup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${GW}/v1/sellers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setIssuedToken(data.token);
      try {
        localStorage.setItem(TOKEN_KEY, data.token);
      } catch {}
      setToken(data.token);
    } catch {
      setError(`Could not reach the gateway at ${GW}.`);
    } finally {
      setBusy(false);
    }
  };

  const loginWithToken = () => {
    const t = tokenInput.trim();
    if (!t.startsWith('hs_')) {
      setError('Seller tokens start with hs_');
      return;
    }
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {}
    setToken(t);
  };

  // 상품 생성 폼
  const [npSlug, setNpSlug] = useState('');
  const [npPrice, setNpPrice] = useState('0.002');
  const [npSpec, setNpSpec] = useState('');
  const [npAuthHeader, setNpAuthHeader] = useState('');
  const [npAuthValue, setNpAuthValue] = useState('');
  const [npResult, setNpResult] = useState<string | null>(null);
  const [npBusy, setNpBusy] = useState(false);

  const createProduct = async () => {
    if (!token) return;
    setNpBusy(true);
    setNpResult(null);
    try {
      const priceUsd = Number(npPrice);
      const spec = npSpec.trim();
      const body: Record<string, unknown> = {
        slug: npSlug.trim(),
        defaultPriceUsdMicros: Math.round(priceUsd * 1_000_000),
      };
      if (/^https?:\/\//.test(spec)) body.openapiUrl = spec;
      else body.openapi = spec;
      if (npAuthHeader.trim() && npAuthValue.trim()) {
        body.upstreamAuth = { header: npAuthHeader.trim(), value: npAuthValue.trim() };
      }
      const res = await fetch(`${GW}/v1/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setNpResult(`⚠ ${data.error ?? `HTTP ${res.status}`}`);
      } else {
        setNpResult(
          `✓ Live at ${data.mcpUrl} — ${data.tools.length} tools: ${data.tools
            .map((t: { name: string; price: string }) => `${t.name} (${t.price})`)
            .join(', ')}`,
        );
        setNpSlug('');
        setNpSpec('');
        void fetchStats(token);
      }
    } catch (e) {
      setNpResult(`⚠ ${(e as Error).message}`);
    } finally {
      setNpBusy(false);
    }
  };

  const openEvents = async (slug: string) => {
    if (!token) return;
    setSelected(slug);
    setEvents(null);
    const res = await fetch(`${GW}/v1/products/${slug}/events?limit=30`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setEvents(((await res.json()) as { events: UsageEvent[] }).events);
  };

  if (!ready) return null;

  return (
    <div className="container">
      <nav className="nav">
        <Link className="brand" href="/">
          🛒 Hawker
        </Link>
        {token && stats && (
          <button className="btn secondary" onClick={logout}>
            Log out
          </button>
        )}
      </nav>

      {!token || !stats ? (
        <div className="stack" style={{ maxWidth: 440, margin: '40px auto' }}>
          <div className="card">
            <h2 className="section">Create a seller account</h2>
            <label className="label">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or company" />
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={signup} disabled={busy || !email || !name}>
                Create account
              </button>
            </div>
          </div>
          <div className="card">
            <h2 className="section">Already have a token?</h2>
            <input className="input mono" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="hs_live_..." />
            <div style={{ marginTop: 12 }}>
              <button className="btn secondary" onClick={loginWithToken}>
                Log in
              </button>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      ) : (
        <div className="stack">
          {issuedToken && (
            <div className="card">
              <h2 className="section">Your seller token — shown once</h2>
              <p className="mono" style={{ wordBreak: 'break-all' }}>{issuedToken}</p>
              <p className="hint" style={{ marginTop: 8 }}>
                Store it somewhere safe. Use it as <span className="mono">Authorization: Bearer</span> for the /v1 API.
              </p>
            </div>
          )}

          <div className="tiles">
            <div className="card tile">
              <div className="tile-label">Revenue (all time)</div>
              <div className="tile-value">{usd(stats.totals.revenueUsdMicros)}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Paid calls</div>
              <div className="tile-value">{stats.totals.calls.toLocaleString()}</div>
            </div>
            <div className="card tile">
              <div className="tile-label">Products</div>
              <div className="tile-value">{stats.products.length}</div>
            </div>
          </div>

          <div className="card">
            <h2 className="section">Revenue — last 14 days</h2>
            <RevenueChart daily={stats.daily} />
          </div>

          {earnings && (
            <div className="card">
              <h2 className="section">Earnings &amp; payouts</h2>
              <div className="tiles" style={{ marginBottom: 16 }}>
                <div className="tile">
                  <div className="tile-label">Gross</div>
                  <div className="tile-value" style={{ fontSize: 22 }}>{usd(earnings.grossUsdMicros)}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Platform fee ({earnings.feeBp / 100}%)</div>
                  <div className="tile-value" style={{ fontSize: 22 }}>−{usd(earnings.feeUsdMicros)}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Available to pay out</div>
                  <div className="tile-value" style={{ fontSize: 22 }}>{usd(earnings.availableUsdMicros)}</div>
                </div>
              </div>
              <label className="label">Payout address (USDC on Base)</label>
              <div className="row">
                <input
                  className="input mono"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="0x…"
                />
                <button className="btn secondary" onClick={() => void saveAddress()}>
                  Save
                </button>
                <button
                  className="btn"
                  onClick={() => void requestPayout()}
                  disabled={!earnings.payoutAddress || earnings.availableUsdMicros < earnings.minPayoutUsdMicros}
                >
                  Request payout
                </button>
              </div>
              {payoutMsg && (
                <p className="hint" style={{ marginTop: 8 }}>{payoutMsg}</p>
              )}
              {payoutList.length > 0 && (
                <table style={{ marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th>Requested</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                      <th>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutList.map((p) => (
                      <tr key={p.id}>
                        <td className="mono">{p.createdAt.slice(0, 10)}</td>
                        <td className="num">{usd(p.amountUsdMicros)}</td>
                        <td>
                          <span className="pill" style={p.status === 'paid' ? { color: 'var(--good)' } : undefined}>
                            {p.status}
                          </span>
                        </td>
                        <td className="mono">{p.txRef ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="card">
            <h2 className="section">New product — paste a spec, start selling</h2>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label className="label">Slug (URL path)</label>
                <input className="input mono" value={npSlug} onChange={(e) => setNpSlug(e.target.value)} placeholder="my-api" />
              </div>
              <div style={{ width: 180 }}>
                <label className="label">Price per call (USD)</label>
                <input className="input" value={npPrice} onChange={(e) => setNpPrice(e.target.value)} placeholder="0.002" />
              </div>
            </div>
            <label className="label">OpenAPI spec — URL or paste JSON/YAML</label>
            <textarea
              className="input mono"
              rows={4}
              value={npSpec}
              onChange={(e) => setNpSpec(e.target.value)}
              placeholder={'https://example.com/openapi.json\n— or paste the document itself'}
            />
            <div className="row">
              <div style={{ flex: 1 }}>
                <label className="label">Upstream auth header (optional)</label>
                <input className="input mono" value={npAuthHeader} onChange={(e) => setNpAuthHeader(e.target.value)} placeholder="X-Api-Key" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">Upstream auth value (encrypted at rest)</label>
                <input className="input mono" type="password" value={npAuthValue} onChange={(e) => setNpAuthValue(e.target.value)} placeholder="sk-..." />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => void createProduct()} disabled={npBusy || !npSlug.trim() || !npSpec.trim()}>
                {npBusy ? 'Creating…' : 'Create product'}
              </button>
            </div>
            {npResult && (
              <p className="hint mono" style={{ marginTop: 10, wordBreak: 'break-all' }}>{npResult}</p>
            )}
          </div>

          <div className="card">
            <h2 className="section">Products</h2>
            {stats.products.length === 0 ? (
              <p className="hint">
                No products yet. Create one with the /v1/products API — see the README quickstart.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>MCP endpoint</th>
                    <th>Status</th>
                    <th className="num">Calls</th>
                    <th className="num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.products.map((p) => (
                    <tr key={p.productId} className="clickable" onClick={() => void openEvents(p.slug)}>
                      <td>{p.name}</td>
                      <td className="mono">/mcp/{p.slug}</td>
                      <td>
                        <span className="pill">{p.status}</span>
                      </td>
                      <td className="num">{p.calls.toLocaleString()}</td>
                      <td className="num">{usd(p.revenueUsdMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selected && (
            <div className="card">
              <h2 className="section">Recent calls — {selected}</h2>
              {!events ? (
                <p className="hint">Loading…</p>
              ) : events.length === 0 ? (
                <p className="hint">No calls yet.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Tool</th>
                      <th>Rail</th>
                      <th>Status</th>
                      <th className="num">Price</th>
                      <th className="num">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{e.createdAt.slice(0, 19).replace('T', ' ')}</td>
                        <td className="mono">{e.toolName}</td>
                        <td>
                          <span className="pill">{e.rail}</span>
                        </td>
                        <td style={{ color: e.status === 'ok' ? 'var(--good)' : 'var(--critical)' }}>
                          {e.status}
                        </td>
                        <td className="num">{usd(e.priceUsdMicros)}</td>
                        <td className="num">{e.latencyMs != null ? `${e.latencyMs}ms` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}
