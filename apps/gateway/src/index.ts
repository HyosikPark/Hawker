import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 실행 위치와 무관하게 리포 루트의 .env를 로드 (없으면 무시 — stub 모드 기본값)
for (const envPath of [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
  '.env',
]) {
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    // 다음 후보 시도
  }
}

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq } from 'drizzle-orm';
import { db, products, tools } from '@hawker/db';
import { admin } from './admin.js';
import { buyer } from './buyer.js';
import { datasets } from './datasets.js';
import { webhooks } from './webhooks.js';
import { handleMcpRequest } from './mcp.js';
import { rateLimit } from './ratelimit.js';
import { canonicalUrl, formatUsd } from './types.js';

const app = new Hono();

// 대시보드(브라우저)에서 관리 API 호출 허용
app.use('/v1/*', cors());

// 무인증 공개 엔드포인트 남용 방지 (IP당 시간당 10회)
const publicLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
app.use('/v1/sellers', publicLimiter);
app.use('/v1/buyer/keys', publicLimiter);

app.route('/datasets', datasets);
app.route('/v1/buyer', buyer);
app.route('/v1/webhooks', webhooks);
app.route('/v1', admin);

app.get('/', (c) =>
  c.json({
    name: 'hawker-gateway',
    tagline: 'Turn your API into an agent-payable product in 5 minutes',
    version: '0.1.0',
    endpoints: { product: 'GET /mcp/:slug (product card)', mcp: 'POST /mcp/:slug (Streamable HTTP, stateless)' },
  }),
);

function loadProduct(slug: string) {
  const product = db.select().from(products).where(eq(products.slug, slug)).get();
  if (!product || product.status !== 'live') return null;
  const productTools = db.select().from(tools).where(eq(tools.productId, product.id)).all();
  return { product, productTools };
}

// 에이전트/사람이 읽을 수 있는 상품 카드. (SSE를 여는 MCP 클라이언트에는 스펙대로 405)
app.get('/mcp/:slug', (c) => {
  if (c.req.header('accept')?.includes('text/event-stream')) {
    return c.body(null, 405);
  }
  const loaded = loadProduct(c.req.param('slug'));
  if (!loaded) return c.json({ error: 'Product not found' }, 404);
  const { product, productTools } = loaded;
  return c.json({
    name: product.name,
    description: product.description,
    mcp: { transport: 'streamable-http', url: canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href },
    tools: productTools.map((t) => ({
      name: t.name,
      description: t.description,
      price: formatUsd(t.priceUsdMicros),
    })),
    payment: {
      x402: { network: 'base', asset: 'USDC' },
      apiKey: 'Authorization: Bearer hk_... (prepaid credits)',
    },
  });
});

app.post('/mcp/:slug', async (c) => {
  const loaded = loadProduct(c.req.param('slug'));
  if (!loaded) return c.json({ error: 'Product not found' }, 404);

  let rpc: unknown;
  try {
    rpc = await c.req.json();
  } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const res = await handleMcpRequest(loaded.product, loaded.productTools, rpc, {
    authorizationHeader: c.req.header('authorization'),
    xPaymentHeader: c.req.header('x-payment'),
    resourceUrl: canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href,
  });

  if (res.body === null) return c.body(null, res.status as 202);
  return c.json(res.body, res.status as 200, res.headers);
});

const port = Number(process.env.PORT ?? 8402);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🛒 hawker-gateway listening on http://localhost:${info.port}`);
});
