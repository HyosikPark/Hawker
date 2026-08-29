import { rpcError, rpcResult, type McpHttpResponse } from './mcp.js';
import type { JsonRpcRequest } from './types.js';

/**
 * 판매자용 메타 MCP 서버 (POST /mcp).
 * "에이전트에게 파는 가게"답게 온보딩·운영 자체를 에이전트가 하게 한다:
 *   claude mcp add hawker https://.../mcp  →  "내 API를 등록해서 팔아줘"
 *
 * 인증: MCP 서버 헤더(Authorization: Bearer hs_...) 또는 각 툴의 sellerToken 인자.
 * 구현: 자체 /v1 REST API로 프록시 — 검증·로직을 한 곳(admin.ts)에 유지.
 */

const PROTOCOL_VERSION = '2025-06-18';

interface Ctx {
  origin: string;
  authorizationHeader?: string;
  clientIp: string;
}

const TOKEN_HINT =
  'Returned seller tokens (hs_...) are shown ONCE. Tell the human to store it safely, ' +
  'then pass it as the sellerToken argument on subsequent calls (or set it as the ' +
  'Authorization header of this MCP server).';

const TOOLS = [
  {
    name: 'create_seller_account',
    description:
      `Create a Hawker seller account. Returns a seller token (hs_...). ${TOKEN_HINT}`,
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        name: { type: 'string', description: 'Person or company name' },
      },
      required: ['email', 'name'],
    },
  },
  {
    name: 'create_product',
    description:
      'Turn an API into an agent-payable product: hosted MCP endpoint + per-call billing. ' +
      'Provide an OpenAPI spec (URL or inline JSON/YAML string). Upstream API keys are ' +
      'encrypted and never exposed to buyers. Returns the live MCP URL.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL path, lowercase/digits/hyphens (e.g. my-api)' },
        priceUsd: { type: 'number', description: 'Default price per tool call in USD (e.g. 0.002)' },
        openapiUrl: { type: 'string', description: 'URL of the OpenAPI document' },
        openapi: { type: 'string', description: 'Inline OpenAPI document (JSON or YAML)' },
        authIn: { type: 'string', enum: ['header', 'query'], description: 'Where the upstream API key goes' },
        authName: { type: 'string', description: 'Header or query parameter name (e.g. X-Api-Key, serviceKey)' },
        authValue: { type: 'string', description: 'The upstream API key (stored encrypted)' },
        sellerToken: { type: 'string' },
      },
      required: ['slug', 'priceUsd'],
    },
  },
  {
    name: 'list_my_products',
    description: 'List your products with status and tool counts.',
    inputSchema: { type: 'object', properties: { sellerToken: { type: 'string' } } },
  },
  {
    name: 'get_stats',
    description: 'Revenue and call totals, per-product performance, last-14-days daily series.',
    inputSchema: { type: 'object', properties: { sellerToken: { type: 'string' } } },
  },
  {
    name: 'get_earnings',
    description: 'Earnings ledger: gross, platform fee, net, available payout balance.',
    inputSchema: { type: 'object', properties: { sellerToken: { type: 'string' } } },
  },
  {
    name: 'set_payout_address',
    description: 'Set the USDC (Base) address that payouts are sent to.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: '0x...' }, sellerToken: { type: 'string' } },
      required: ['address'],
    },
  },
  {
    name: 'request_payout',
    description: 'Request a payout of your available balance (USDC on Base, batched).',
    inputSchema: {
      type: 'object',
      properties: {
        amountUsd: { type: 'number', description: 'Amount in USD; omit for full available balance' },
        sellerToken: { type: 'string' },
      },
    },
  },
  {
    name: 'set_product_status',
    description: 'Pause or resume a product (paused products stop serving).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        status: { type: 'string', enum: ['live', 'paused'] },
        sellerToken: { type: 'string' },
      },
      required: ['slug', 'status'],
    },
  },
  {
    name: 'set_tool_price',
    description: 'Change the per-call price of one tool.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        tool: { type: 'string' },
        priceUsd: { type: 'number' },
        sellerToken: { type: 'string' },
      },
      required: ['slug', 'tool', 'priceUsd'],
    },
  },
  {
    name: 'get_recent_calls',
    description: 'Recent usage events for one product (tool, rail, price, status, latency).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        limit: { type: 'integer' },
        sellerToken: { type: 'string' },
      },
      required: ['slug'],
    },
  },
];

// 가입 남용 방지 (IP당 시간당 5회)
const signupHits = new Map<string, number[]>();
function signupAllowed(ip: string): boolean {
  const now = Date.now();
  const times = (signupHits.get(ip) ?? []).filter((t) => t > now - 3_600_000);
  if (times.length >= 5) return false;
  times.push(now);
  signupHits.set(ip, times);
  return true;
}

function usdToMicros(usd: unknown): number {
  return Math.round(Number(usd) * 1_000_000);
}

export async function handleSellerMcp(rpc: unknown, ctx: Ctx): Promise<McpHttpResponse> {
  const req = rpc as Partial<JsonRpcRequest>;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.', 400);
  }
  if (req.id === undefined || req.id === null) return { status: 202, body: null };

  switch (req.method) {
    case 'initialize':
      return rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'hawker', version: '0.1.0' },
        instructions:
          'Hawker seller console. Turn any API into a product AI agents can discover, call, ' +
          'and pay for per use. Start with create_seller_account, then create_product with an ' +
          `OpenAPI spec. ${TOKEN_HINT}`,
      });
    case 'ping':
      return rpcResult(req.id, {});
    case 'tools/list':
      return rpcResult(req.id, { tools: TOOLS });
    case 'tools/call':
      return handleCall(req as JsonRpcRequest, ctx);
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

async function handleCall(req: JsonRpcRequest, ctx: Ctx): Promise<McpHttpResponse> {
  const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  const args = params.arguments ?? {};
  const name = params.name;

  const token =
    typeof args.sellerToken === 'string' && args.sellerToken
      ? `Bearer ${args.sellerToken}`
      : ctx.authorizationHeader;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    needsAuth = true,
  ): Promise<{ status: number; data: unknown }> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (needsAuth) {
      if (!token) {
        throw new Error(
          'Seller token missing. Pass sellerToken argument or configure Authorization: Bearer hs_... on this MCP server. No account yet? Call create_seller_account first.',
        );
      }
      headers.authorization = token;
    }
    const res = await fetch(`${ctx.origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  try {
    let out: { status: number; data: unknown };
    switch (name) {
      case 'create_seller_account': {
        if (!signupAllowed(ctx.clientIp)) throw new Error('Signup rate limit exceeded. Try later.');
        out = await call('POST', '/v1/sellers', { email: args.email, name: args.name }, false);
        break;
      }
      case 'create_product': {
        const body: Record<string, unknown> = {
          slug: args.slug,
          defaultPriceUsdMicros: usdToMicros(args.priceUsd),
        };
        if (args.openapiUrl) body.openapiUrl = args.openapiUrl;
        if (args.openapi) body.openapi = args.openapi;
        if (args.authName && args.authValue) {
          body.upstreamAuth = { in: args.authIn ?? 'header', name: args.authName, value: args.authValue };
        }
        out = await call('POST', '/v1/products', body);
        break;
      }
      case 'list_my_products':
        out = await call('GET', '/v1/products');
        break;
      case 'get_stats':
        out = await call('GET', '/v1/stats');
        break;
      case 'get_earnings':
        out = await call('GET', '/v1/earnings');
        break;
      case 'set_payout_address':
        out = await call('PATCH', '/v1/sellers/me', { payoutAddress: args.address });
        break;
      case 'request_payout':
        out = await call(
          'POST',
          '/v1/payouts',
          args.amountUsd !== undefined ? { amountUsdMicros: usdToMicros(args.amountUsd) } : {},
        );
        break;
      case 'set_product_status':
        out = await call('PATCH', `/v1/products/${args.slug}`, { status: args.status });
        break;
      case 'set_tool_price':
        out = await call('PATCH', `/v1/products/${args.slug}/tools/${args.tool}`, {
          priceUsdMicros: usdToMicros(args.priceUsd),
        });
        break;
      case 'get_recent_calls':
        out = await call('GET', `/v1/products/${args.slug}/events?limit=${Number(args.limit ?? 20)}`);
        break;
      default:
        return rpcError(req.id, -32602, `Unknown tool: ${name ?? '(none)'}`);
    }

    const isError = out.status >= 400;
    return rpcResult(req.id, {
      ...(isError ? { isError: true } : {}),
      content: [{ type: 'text', text: JSON.stringify(out.data, null, 2) }],
    });
  } catch (err) {
    return rpcResult(req.id, {
      isError: true,
      content: [{ type: 'text', text: (err as Error).message }],
    });
  }
}
