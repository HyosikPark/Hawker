import crypto from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { desc, eq, inArray } from 'drizzle-orm';
import YAML from 'yaml';
import { db, sellers, products, tools, usageEvents } from '@hawker/db';
import { encryptSecret, sha256Hex } from './crypto.js';
import { importOpenApi } from './openapi.js';
import { canonicalUrl, formatUsd } from './types.js';

/**
 * 판매자 관리 API (/v1). 셀프서브 온보딩의 뼈대:
 *   POST /v1/sellers   가입 + 관리 토큰(hs_...) 1회 발급
 *   POST /v1/products  OpenAPI 스펙 제출 → 상품+툴 자동 생성 → MCP URL 발급
 *   GET  /v1/products  내 상품 목록
 */

type Seller = typeof sellers.$inferSelect;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const admin = new Hono<{ Variables: { seller: Seller } }>();

admin.post('/sellers', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!email.includes('@') || !name) {
    return c.json({ error: 'email과 name이 필요합니다.' }, 400);
  }
  if (db.select().from(sellers).where(eq(sellers.email, email)).get()) {
    return c.json({ error: '이미 등록된 이메일입니다.' }, 409);
  }
  const token = `hs_live_${crypto.randomBytes(24).toString('hex')}`;
  const id = crypto.randomUUID();
  db.insert(sellers).values({ id, email, name, tokenHash: sha256Hex(token) }).run();
  return c.json(
    {
      sellerId: id,
      token,
      note: '이 토큰은 다시 표시되지 않습니다. Authorization: Bearer로 사용하세요.',
    },
    201,
  );
});

// /products 이하 라우트는 판매자 토큰 필요 (경로를 정확히 지정 — /v1/buyer 등과 충돌 방지)
const requireSeller: MiddlewareHandler<{ Variables: { seller: Seller } }> = async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(hs_\S+)$/i)?.[1];
  const seller = token
    ? db.select().from(sellers).where(eq(sellers.tokenHash, sha256Hex(token))).get()
    : undefined;
  if (!seller) return c.json({ error: '판매자 토큰(Authorization: Bearer hs_...)이 필요합니다.' }, 401);
  c.set('seller', seller);
  await next();
};
admin.use('/products', requireSeller);
admin.use('/products/*', requireSeller);
admin.use('/stats', requireSeller);

admin.post('/products', async (c) => {
  const seller = c.get('seller');
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'JSON body가 필요합니다.' }, 400);

  const slug = String(body.slug ?? '');
  if (!SLUG_RE.test(slug)) {
    return c.json({ error: 'slug는 소문자/숫자/하이픈 2~40자여야 합니다.' }, 400);
  }
  if (db.select().from(products).where(eq(products.slug, slug)).get()) {
    return c.json({ error: `slug "${slug}"는 이미 사용 중입니다.` }, 409);
  }

  const defaultPrice = Number(body.defaultPriceUsdMicros ?? 0);
  if (!Number.isInteger(defaultPrice) || defaultPrice < 0 || defaultPrice > 100_000_000) {
    return c.json({ error: 'defaultPriceUsdMicros는 0~100,000,000(=$100) 정수여야 합니다.' }, 400);
  }

  // OpenAPI 문서 확보: 인라인(object/string) 또는 URL
  let doc: unknown = body.openapi;
  if (!doc && typeof body.openapiUrl === 'string') {
    try {
      const res = await fetch(body.openapiUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return c.json({ error: `openapiUrl 조회 실패: HTTP ${res.status}` }, 400);
      doc = await res.text();
    } catch (err) {
      return c.json({ error: `openapiUrl 조회 실패: ${(err as Error).message}` }, 400);
    }
  }
  if (typeof doc === 'string') {
    try {
      doc = YAML.parse(doc); // YAML은 JSON의 상위집합이라 둘 다 처리
    } catch {
      return c.json({ error: 'OpenAPI 문서 파싱 실패 (JSON/YAML 아님).' }, 400);
    }
  }
  if (!doc) return c.json({ error: 'openapi(인라인) 또는 openapiUrl이 필요합니다.' }, 400);

  let imported;
  try {
    imported = importOpenApi(doc as Record<string, unknown>, {
      include: Array.isArray(body.include) ? body.include : undefined,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  if (imported.tools.length === 0) {
    return c.json({ error: '스펙에서 변환 가능한 operation이 없습니다.', warnings: imported.warnings }, 400);
  }

  const upstreamBaseUrl = String(body.upstreamBaseUrl ?? imported.baseUrl ?? '');
  if (!/^https?:\/\//.test(upstreamBaseUrl)) {
    return c.json({ error: 'upstreamBaseUrl이 없고 스펙의 servers에서도 찾지 못했습니다.' }, 400);
  }

  let upstreamAuthEncrypted: string | null = null;
  if (body.upstreamAuth) {
    const { header, value } = body.upstreamAuth as { header?: string; value?: string };
    if (!header || !value) return c.json({ error: 'upstreamAuth는 {header, value} 형식입니다.' }, 400);
    try {
      upstreamAuthEncrypted = encryptSecret(JSON.stringify({ header, value }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  }

  const overrides = (body.priceOverrides ?? {}) as Record<string, number>;
  const productId = crypto.randomUUID();
  const docObj = doc as { info?: { title?: string; description?: string } };

  db.transaction((tx) => {
    tx.insert(products)
      .values({
        id: productId,
        sellerId: seller.id,
        slug,
        name: String(body.name ?? docObj.info?.title ?? slug),
        description: String(body.description ?? docObj.info?.description ?? `${slug} API`),
        upstreamBaseUrl,
        upstreamAuthEncrypted,
        status: 'live',
      })
      .run();
    for (const t of imported.tools) {
      tx.insert(tools)
        .values({
          id: crypto.randomUUID(),
          productId,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          upstream: t.upstream,
          priceUsdMicros: Number.isInteger(overrides[t.name]) ? overrides[t.name] : defaultPrice,
        })
        .run();
    }
  });

  const origin = canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).origin;
  return c.json(
    {
      productId,
      slug,
      mcpUrl: `${origin}/mcp/${slug}`,
      tools: imported.tools.map((t) => ({
        name: t.name,
        price: formatUsd(Number.isInteger(overrides[t.name]) ? overrides[t.name] : defaultPrice),
      })),
      warnings: imported.warnings,
    },
    201,
  );
});

admin.get('/products', (c) => {
  const seller = c.get('seller');
  const rows = db.select().from(products).where(eq(products.sellerId, seller.id)).all();
  return c.json({
    products: rows.map((p) => ({
      productId: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      toolCount: db.select().from(tools).where(eq(tools.productId, p.id)).all().length,
    })),
  });
});

/** 대시보드용 통계: 총계 + 상품별 실적 + 최근 14일 일별 시계열 */
admin.get('/stats', (c) => {
  const seller = c.get('seller');
  const myProducts = db.select().from(products).where(eq(products.sellerId, seller.id)).all();
  if (myProducts.length === 0) {
    return c.json({ totals: { calls: 0, revenueUsdMicros: 0 }, products: [], daily: [] });
  }
  const productIds = myProducts.map((p) => p.id);
  const events = db
    .select()
    .from(usageEvents)
    .where(inArray(usageEvents.productId, productIds))
    .all();

  const byProduct = new Map<string, { calls: number; revenueUsdMicros: number }>();
  const byDay = new Map<string, { calls: number; revenueUsdMicros: number }>();
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    days.push(d);
    byDay.set(d, { calls: 0, revenueUsdMicros: 0 });
  }

  let totalCalls = 0;
  let totalRevenue = 0;
  for (const e of events) {
    if (e.status !== 'ok') continue;
    totalCalls += 1;
    totalRevenue += e.priceUsdMicros;
    const p = byProduct.get(e.productId) ?? { calls: 0, revenueUsdMicros: 0 };
    p.calls += 1;
    p.revenueUsdMicros += e.priceUsdMicros;
    byProduct.set(e.productId, p);
    const day = e.createdAt.toISOString().slice(0, 10);
    const dRow = byDay.get(day);
    if (dRow) {
      dRow.calls += 1;
      dRow.revenueUsdMicros += e.priceUsdMicros;
    }
  }

  return c.json({
    totals: { calls: totalCalls, revenueUsdMicros: totalRevenue },
    products: myProducts.map((p) => ({
      productId: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      calls: byProduct.get(p.id)?.calls ?? 0,
      revenueUsdMicros: byProduct.get(p.id)?.revenueUsdMicros ?? 0,
    })),
    daily: days.map((d) => ({ date: d, ...byDay.get(d)! })),
  });
});

/** 상품별 최근 사용 이벤트 */
admin.get('/products/:slug/events', (c) => {
  const seller = c.get('seller');
  const product = db.select().from(products).where(eq(products.slug, c.req.param('slug'))).get();
  if (!product || product.sellerId !== seller.id) {
    return c.json({ error: 'Product not found' }, 404);
  }
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const rows = db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.productId, product.id))
    .orderBy(desc(usageEvents.createdAt))
    .limit(limit)
    .all();
  return c.json({
    events: rows.map((e) => ({
      toolName: e.toolName,
      rail: e.rail,
      priceUsdMicros: e.priceUsdMicros,
      status: e.status,
      latencyMs: e.latencyMs,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});
