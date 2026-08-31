import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db, products, tools, usageEvents } from '@hawker/db';
import { authorizePayment, commitPayment } from './payments.js';
import { callUpstream } from './upstream.js';
import { buildRequirements, configFromEnv, encodeReceipt } from './x402.js';
import { declareDiscoveryExtension } from '@x402/extensions';
import { canonicalUrl } from './types.js';

/**
 * CDP x402 Bazaar용 "평범한 HTTP 유료 엔드포인트" 노출.
 * MCP(JSON-RPC)와 별개로, 각 유료 툴을 POST /x402/:slug/:tool 로 노출한다.
 *   - 결제 없음 → HTTP 402 + accepts + bazaar 확장(info.input/output)  ← CDP가 인식하는 형식
 *   - 결제 있음 → 업스트림 실행 + 데이터 반환 (결제/실패콜$0 로직은 MCP와 공유)
 */

export const x402http = new Hono();

function loadTool(slug: string, toolName: string) {
  const product = db.select().from(products).where(eq(products.slug, slug)).get();
  if (!product || product.status !== 'live') return null;
  const tool = db
    .select()
    .from(tools)
    .where(and(eq(tools.productId, product.id), eq(tools.name, toolName)))
    .get();
  if (!tool) return null;
  return { product, tool };
}

// eip155 CAIP-2 네트워크 ID (x402 v2는 이 형식을 요구)
const CAIP2_NETWORK: Record<string, string> = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

/** 공식 @x402/extensions 헬퍼로 bazaar 발견 확장 생성 (info + 검증 schema 정확) */
function buildBazaarExtension(
  inputSchema: { properties?: Record<string, unknown>; required?: string[] },
  example: Record<string, unknown> | null,
): Record<string, unknown> {
  // 런타임은 method를 받지만 타입 정의가 Omit해서 캐스팅으로 우회
  const declare = declareDiscoveryExtension as unknown as (cfg: unknown) => Record<string, unknown>;
  const ext = declare({
    method: 'POST',
    bodyType: 'json',
    body: example ?? {},
    inputSchema: { type: 'object', ...inputSchema },
    output: { example: { result: 'JSON from upstream API' } },
  }) as { bazaar: { info: { input: { body?: unknown } } } };
  // 헬퍼가 body를 {}로 덮으므로, CDP 검증(required 필드 포함)을 위해 예시로 채워넣음
  if (example) ext.bazaar.info.input.body = example;
  return ext as unknown as Record<string, unknown>;
}

/** x402 v2 PAYMENT-REQUIRED 헤더 값(base64 JSON) — CDP Bazaar가 요구하는 형식 */
function paymentRequiredV2(
  c: Context,
  product: (typeof products)['$inferSelect'],
  tool: (typeof tools)['$inferSelect'],
): string {
  const cfg = configFromEnv();
  const reqs = buildRequirements(cfg, {
    priceUsdMicros: tool.priceUsdMicros,
    resource: '',
    description: `${tool.name} on ${product.name}`,
  });
  const url = canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href;
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const example = buildExample(schema);

  const payload = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: CAIP2_NETWORK[cfg.network] ?? CAIP2_NETWORK.base,
        amount: String(tool.priceUsdMicros), // v2는 amount (v1의 maxAmountRequired)
        asset: reqs.asset,
        payTo: reqs.payTo,
        maxTimeoutSeconds: 60,
      },
    ],
    // bazaar 확장은 공식 헬퍼로 생성 (info + 검증 schema를 정확히 포함, top-level)
    extensions: buildBazaarExtension(schema, example),
    resource: {
      url,
      description: tool.description.slice(0, 500),
      mimeType: 'application/json',
      serviceName: product.name,
      tags: inferTags(product.slug, product.description),
    },
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** required 필드로 현실적 예시 인자 생성 (에이전트가 유효 호출 구성용) */
function buildExample(schema: { properties?: Record<string, any>; required?: string[] }): Record<string, unknown> | null {
  if (!schema.properties) return null;
  const ex: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const p = schema.properties[key] ?? {};
    // 타입을 먼저 존중 (array/number), 문자열만 설명의 e.g. 예시 활용
    if (p.type === 'array') {
      ex[key] = ['example'];
    } else if (p.type === 'number' || p.type === 'integer') {
      const eg = /e\.g\.?\s*(\d+)/i.exec(p.description ?? '');
      ex[key] = eg ? Number(eg[1]) : 0;
    } else {
      const eg = /e\.g\.?\s*([^\s,)]+)/i.exec(p.description ?? '');
      ex[key] = eg ? eg[1] : 'example';
    }
  }
  return Object.keys(ex).length ? ex : null;
}

function inferTags(slug: string, description: string): string[] {
  const tags = new Set(['data']);
  const t = `${slug} ${description}`.toLowerCase();
  if (/korea|kr-|국토|국세|공휴/.test(t)) tags.add('korea');
  if (/weather/.test(t)) tags.add('weather');
  if (/business|사업자|kyb/.test(t)) tags.add('kyb');
  return [...tags];
}

function payment402(c: Context, product: (typeof products)['$inferSelect'], tool: (typeof tools)['$inferSelect']) {
  // v2: PAYMENT-REQUIRED 헤더 (CDP Bazaar 인덱싱용)
  c.header('PAYMENT-REQUIRED', paymentRequiredV2(c, product, tool));
  c.header('Cache-Control', 'no-store');
  // v1: body의 accepts (x402-fetch 등 현행 결제 클라이언트 호환)
  const cfg = configFromEnv();
  const resource = canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href;
  const v1 = buildRequirements(cfg, {
    priceUsdMicros: tool.priceUsdMicros,
    resource,
    description: `${tool.name} on ${product.name}`,
  });
  return c.json(
    {
      x402Version: 1,
      error: 'Payment required. Send X-PAYMENT (x402) or Authorization: Bearer hk_... (credits).',
      accepts: [v1],
    },
    402,
  );
}

// 발견용 GET (결제 없이 402로 스펙 노출) + 실제 호출용 POST
async function handle(c: Context) {
  const slug = c.req.param('slug');
  const toolName = c.req.param('tool');
  if (!slug || !toolName) return c.json({ error: 'Not found' }, 404);
  const loaded = loadTool(slug, toolName);
  if (!loaded) return c.json({ error: 'Not found' }, 404);
  const { product, tool } = loaded;

  // 무료 툴은 결제 없이 바로
  if (tool.priceUsdMicros <= 0) {
    return runUpstream(c, product, tool, 'free', undefined);
  }

  const decision = await authorizePayment({
    priceUsdMicros: tool.priceUsdMicros,
    authorizationHeader: c.req.header('authorization'),
    xPaymentHeader: c.req.header('x-payment'),
    resource: canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href,
    description: `${tool.name} on ${product.name}`,
  });
  if (!decision.ok) {
    // CDP·에이전트가 인식하도록 항상 표준 402 + bazaar 확장
    return payment402(c, product, tool);
  }
  return runUpstream(
    c,
    product,
    tool,
    decision.grant.rail,
    decision.grant.rail === 'credits' ? decision.grant.apiKeyId : undefined,
    decision.grant,
  );
}

async function runUpstream(
  c: Context,
  product: (typeof products)['$inferSelect'],
  tool: (typeof tools)['$inferSelect'],
  rail: 'free' | 'credits' | 'x402',
  apiKeyId: string | undefined,
  grant?: Parameters<typeof commitPayment>[0],
) {
  const args = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const schema = tool.inputSchema as { required?: string[] };
  const missing = (schema.required ?? []).filter((k) => args[k] === undefined);
  if (missing.length > 0) {
    meter(product, tool, rail, apiKeyId, 0, 'invalid_args', null);
    return c.json({ error: `Missing required arguments: ${missing.join(', ')}` }, 400);
  }

  const started = Date.now();
  let result;
  try {
    result = await callUpstream(product, tool, args);
  } catch (err) {
    meter(product, tool, rail, apiKeyId, 0, 'upstream_error', Date.now() - started);
    return c.json({ error: `Upstream failed: ${(err as Error).message}. Not charged.` }, 502);
  }
  const latency = Date.now() - started;
  if (!result.ok) {
    meter(product, tool, rail, apiKeyId, 0, 'upstream_error', latency);
    return c.json({ error: `Upstream HTTP ${result.status}. Not charged.` }, 502);
  }

  let receipt = null;
  if (grant) {
    try {
      receipt = await commitPayment(grant, {
        priceUsdMicros: tool.priceUsdMicros,
        resource: canonicalUrl(c.req.url, c.req.header('x-forwarded-proto')).href,
        description: `${tool.name} on ${product.name}`,
      });
    } catch (err) {
      meter(product, tool, rail, apiKeyId, tool.priceUsdMicros, 'payment_required', latency);
      return c.json({ error: `Payment commit failed: ${(err as Error).message}` }, 402);
    }
  }

  meter(product, tool, rail, apiKeyId, rail === 'free' ? 0 : tool.priceUsdMicros, 'ok', latency);
  const headers: Record<string, string> = { 'Cache-Control': 'no-store, private' };
  if (receipt) headers['X-PAYMENT-RESPONSE'] = encodeReceipt(receipt);
  return c.json(result.body as object, 200, headers);
}

function meter(
  product: (typeof products)['$inferSelect'],
  tool: (typeof tools)['$inferSelect'],
  rail: 'free' | 'credits' | 'x402',
  apiKeyId: string | undefined,
  priceUsdMicros: number,
  status: 'ok' | 'upstream_error' | 'payment_required' | 'invalid_args',
  latencyMs: number | null,
) {
  db.insert(usageEvents)
    .values({
      id: crypto.randomUUID(),
      productId: product.id,
      toolName: tool.name,
      rail,
      apiKeyId: apiKeyId ?? null,
      priceUsdMicros,
      status,
      latencyMs,
    })
    .run();
}

x402http.get('/:slug/:tool', handle);
x402http.post('/:slug/:tool', handle);
