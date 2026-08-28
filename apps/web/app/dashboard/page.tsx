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
    } catch {
      setError(`Could not reach the gateway at ${GW}. Is it running?`);
    }
  }, []);

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
