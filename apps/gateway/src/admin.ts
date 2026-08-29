import crypto from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import YAML from 'yaml';
import { db, sellers, products, tools, usageEvents, payouts } from '@hawker/db';
import { encryptSecret, sha256Hex } from './crypto.js';
import { importOpenApi } from './openapi.js';
import { forbiddenUpstreamReason } from './ssrf.js';
import { priceInBounds, sanitizeText, MAX_DESC_LEN, MAX_NAME_LEN } from './validate.js';
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
admin.use('/earnings', requireSeller);
admin.use('/payouts', requireSeller);
admin.use('/sellers/me', requireSeller);
admin.use('/sellers/me/rotate-token', requireSeller);

// 토큰 회전: 새 토큰 발급 + 기존 토큰 즉시 무효화 (유출 대응)
admin.post('/sellers/me/rotate-token', (c) => {
  const seller = c.get('seller');
  const token = `hs_live_${crypto.randomBytes(24).toString('hex')}`;
  db.update(sellers).set({ tokenHash: sha256Hex(token) }).where(eq(sellers.id, seller.id)).run();
  return c.json({
    token,
    note: '기존 토큰은 즉시 무효화되었습니다. 이 토큰은 다시 표시되지 않습니다.',
  });
});

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
  if (!priceInBounds(defaultPrice)) {
    return c.json({ error: 'defaultPriceUsdMicros는 0~100,000,000(=$100) 정수여야 합니다.' }, 400);
  }
  // priceOverrides도 동일 경계 검증 (음수/초대형 가격 우회 차단)
  const overrides = (body.priceOverrides ?? {}) as Record<string, unknown>;
  for (const [tool, price] of Object.entries(overrides)) {
    if (!priceInBounds(price)) {
      return c.json({ error: `priceOverrides.${tool}는 0~100,000,000 정수여야 합니다.` }, 400);
    }
  }

  // OpenAPI 문서 확보: 인라인(object/string) 또는 URL
  let doc: unknown = body.openapi;
  if (!doc && typeof body.openapiUrl === 'string') {
    const forbidden = forbiddenUpstreamReason(body.openapiUrl);
    if (forbidden) return c.json({ error: `openapiUrl: ${forbidden}` }, 400);
    try {
      const res = await fetch(body.openapiUrl, {
        redirect: 'manual', // 리다이렉트로 내부망 우회 차단
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status >= 300 && res.status < 400) {
        return c.json({ error: 'openapiUrl은 리다이렉트할 수 없습니다.' }, 400);
      }
      if (!res.ok) return c.json({ error: `openapiUrl 조회 실패: HTTP ${res.status}` }, 400);
      const spec = await res.text();
      if (spec.length > 2_000_000) return c.json({ error: 'openapiUrl 문서가 너무 큽니다(>2MB).' }, 400);
      doc = spec;
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
  const forbiddenBase = forbiddenUpstreamReason(upstreamBaseUrl);
  if (forbiddenBase) return c.json({ error: `upstreamBaseUrl: ${forbiddenBase}` }, 400);

  let upstreamAuthEncrypted: string | null = null;
  if (body.upstreamAuth) {
    // {header, value}(레거시) 또는 {in: 'header'|'query', name, value}
    const auth = body.upstreamAuth as {
      header?: string;
      in?: string;
      name?: string;
      value?: string;
    };
    const location = auth.in ?? 'header';
    const name = auth.name ?? auth.header;
    if (!name || !auth.value || (location !== 'header' && location !== 'query')) {
      return c.json(
        { error: 'upstreamAuth는 {header, value} 또는 {in: "header"|"query", name, value} 형식입니다.' },
        400,
      );
    }
    try {
      upstreamAuthEncrypted = encryptSecret(JSON.stringify({ in: location, name, value: auth.value }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  }

  const priceFor = (toolName: string): number =>
    priceInBounds(overrides[toolName]) ? (overrides[toolName] as number) : defaultPrice;
  const productId = crypto.randomUUID();
  const docObj = doc as { info?: { title?: string; description?: string } };
  const productName = sanitizeText(body.name ?? docObj.info?.title ?? slug, MAX_NAME_LEN) || slug;
  const productDesc =
    sanitizeText(body.description ?? docObj.info?.description ?? `${slug} API`, MAX_DESC_LEN) ||
    `${slug} API`;

  db.transaction((tx) => {
    tx.insert(products)
      .values({
        id: productId,
        sellerId: seller.id,
        slug,
        name: productName,
        description: productDesc,
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
          priceUsdMicros: priceFor(t.name),
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
        price: formatUsd(priceFor(t.name)),
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

// --- 상품 관리 ---

admin.patch('/products/:slug', async (c) => {
  const seller = c.get('seller');
  const product = db.select().from(products).where(eq(products.slug, c.req.param('slug'))).get();
  if (!product || product.sellerId !== seller.id) return c.json({ error: 'Product not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const status = body?.status;
  if (status !== 'live' && status !== 'paused') {
    return c.json({ error: 'status는 live 또는 paused여야 합니다.' }, 400);
  }
  db.update(products).set({ status }).where(eq(products.id, product.id)).run();
  return c.json({ slug: product.slug, status });
});

admin.patch('/products/:slug/tools/:toolName', async (c) => {
  const seller = c.get('seller');
  const product = db.select().from(products).where(eq(products.slug, c.req.param('slug'))).get();
  if (!product || product.sellerId !== seller.id) return c.json({ error: 'Product not found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const price = Number(body?.priceUsdMicros);
  if (!priceInBounds(price)) {
    return c.json({ error: 'priceUsdMicros는 0~100,000,000 정수여야 합니다.' }, 400);
  }
  const res = db
    .update(tools)
    .set({ priceUsdMicros: price })
    .where(and(eq(tools.productId, product.id), eq(tools.name, c.req.param('toolName'))))
    .run();
  if (res.changes === 0) return c.json({ error: 'Tool not found' }, 404);
  return c.json({ slug: product.slug, tool: c.req.param('toolName'), priceUsdMicros: price });
});

// --- 정산 (M6) ---

const FEE_BP = Number(process.env.HAWKER_FEE_BP ?? 1000); // 10% 기본
const MIN_PAYOUT_USD_MICROS = Number(process.env.HAWKER_MIN_PAYOUT_USD_MICROS ?? 1_000_000); // $1

function computeEarnings(sellerId: string) {
  const myProducts = db.select().from(products).where(eq(products.sellerId, sellerId)).all();
  let gross = 0;
  if (myProducts.length > 0) {
    const events = db
      .select()
      .from(usageEvents)
      .where(inArray(usageEvents.productId, myProducts.map((p) => p.id)))
      .all();
    for (const e of events) if (e.status === 'ok') gross += e.priceUsdMicros;
  }
  const fee = Math.floor((gross * FEE_BP) / 10_000);
  const net = gross - fee;
  const rows = db.select().from(payouts).where(eq(payouts.sellerId, sellerId)).all();
  const requested = rows.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amountUsdMicros, 0);
  const paid = rows.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amountUsdMicros, 0);
  return { gross, fee, net, requested, paid, available: net - requested - paid };
}

admin.patch('/sellers/me', async (c) => {
  const seller = c.get('seller');
  const body = await c.req.json().catch(() => null);
  const addr = typeof body?.payoutAddress === 'string' ? body.payoutAddress.trim() : '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return c.json({ error: 'payoutAddress는 0x로 시작하는 40자리 hex(EVM 주소)여야 합니다.' }, 400);
  }
  db.update(sellers).set({ payoutAddress: addr }).where(eq(sellers.id, seller.id)).run();
  return c.json({ payoutAddress: addr });
});

admin.get('/earnings', (c) => {
  const seller = c.get('seller');
  const e = computeEarnings(seller.id);
  return c.json({
    grossUsdMicros: e.gross,
    feeUsdMicros: e.fee,
    feeBp: FEE_BP,
    netUsdMicros: e.net,
    requestedUsdMicros: e.requested,
    paidUsdMicros: e.paid,
    availableUsdMicros: e.available,
    minPayoutUsdMicros: MIN_PAYOUT_USD_MICROS,
    payoutAddress: seller.payoutAddress,
  });
});

admin.get('/payouts', (c) => {
  const seller = c.get('seller');
  const rows = db
    .select()
    .from(payouts)
    .where(eq(payouts.sellerId, seller.id))
    .orderBy(desc(payouts.createdAt))
    .all();
  return c.json({
    payouts: rows.map((p) => ({
      id: p.id,
      amountUsdMicros: p.amountUsdMicros,
      status: p.status,
      payoutAddress: p.payoutAddress,
      txRef: p.txRef,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    })),
  });
});

admin.post('/payouts', async (c) => {
  const seller = c.get('seller');
  if (!seller.payoutAddress) {
    return c.json({ error: '먼저 PATCH /v1/sellers/me로 payoutAddress를 설정하세요.' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const earnings = computeEarnings(seller.id);
  const amount = Number.isInteger(body?.amountUsdMicros)
    ? Number(body.amountUsdMicros)
    : earnings.available;
  if (amount < MIN_PAYOUT_USD_MICROS) {
    return c.json(
      { error: `최소 정산 금액은 ${MIN_PAYOUT_USD_MICROS} micros입니다. (가용: ${earnings.available})` },
      400,
    );
  }
  if (amount > earnings.available) {
    return c.json({ error: `가용 잔액(${earnings.available} micros)을 초과했습니다.` }, 400);
  }
  const id = crypto.randomUUID();
  db.insert(payouts)
    .values({ id, sellerId: seller.id, amountUsdMicros: amount, payoutAddress: seller.payoutAddress })
    .run();
  return c.json(
    {
      payoutId: id,
      amountUsdMicros: amount,
      status: 'pending',
      note: 'USDC(Base) 지급은 주기 정산으로 처리됩니다.',
    },
    201,
  );
});
