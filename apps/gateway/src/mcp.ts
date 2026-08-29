import crypto from 'node:crypto';
import { db, usageEvents, type products, type tools } from '@hawker/db';
import { authorizePayment, commitPayment, type PaymentGrant } from './payments.js';
import { callUpstream } from './upstream.js';
import { formatUsd, type JsonRpcRequest } from './types.js';
import { encodeReceipt } from './x402.js';
import { reputationBadge, reputationForProduct } from './reputation.js';

type Product = typeof products.$inferSelect;
type Tool = typeof tools.$inferSelect;

const PROTOCOL_VERSION = '2025-06-18';

export interface McpHttpResponse {
  status: number;
  body: Record<string, unknown> | null;
  headers?: Record<string, string>;
}

interface RequestContext {
  authorizationHeader?: string;
  xPaymentHeader?: string;
  resourceUrl: string;
}

export function rpcResult(id: JsonRpcRequest['id'], result: unknown): McpHttpResponse {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, result } };
}

export function rpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  httpStatus = 200,
): McpHttpResponse {
  return { status: httpStatus, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } };
}

function meter(opts: {
  product: Product;
  toolName: string;
  rail: PaymentGrant['rail'] | 'free';
  apiKeyId?: string;
  priceUsdMicros: number;
  status: 'ok' | 'upstream_error' | 'payment_required' | 'invalid_args';
  latencyMs?: number;
}): void {
  db.insert(usageEvents)
    .values({
      id: crypto.randomUUID(),
      productId: opts.product.id,
      toolName: opts.toolName,
      rail: opts.rail,
      apiKeyId: opts.apiKeyId ?? null,
      priceUsdMicros: opts.priceUsdMicros,
      status: opts.status,
      latencyMs: opts.latencyMs ?? null,
    })
    .run();
}

/** 상품 하나 = MCP 서버 하나. Streamable HTTP(stateless) JSON-RPC 처리기. */
export async function handleMcpRequest(
  product: Product,
  productTools: Tool[],
  rpc: unknown,
  ctx: RequestContext,
): Promise<McpHttpResponse> {
  if (Array.isArray(rpc)) {
    return rpcError(null, -32600, 'Batch requests are not supported.', 400);
  }
  const req = rpc as Partial<JsonRpcRequest>;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.', 400);
  }

  // 알림(notification)은 202로 수신 확인만
  if (req.id === undefined || req.id === null) {
    return { status: 202, body: null };
  }

  switch (req.method) {
    case 'initialize':
      return rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: product.name, version: '0.1.0' },
        instructions:
          `${product.description}\n\n` +
          `Tools on this server are paid per call. Pay with an x402 X-PAYMENT header ` +
          `(USDC on Base) or a Hawker API key (Authorization: Bearer hk_...). ` +
          `Calls that fail upstream are never charged.`,
      });

    case 'ping':
      return rpcResult(req.id, {});

    case 'tools/list': {
      // 실측 신뢰 지표를 툴 설명·메타에 함께 실어 에이전트가 사기 전 판단하게 한다
      const badge = reputationBadge(reputationForProduct(product.id));
      const repSuffix =
        badge.confidence === 'none'
          ? ' [New — no track record yet]'
          : ` [Measured: ${badge.successRate} success, ${badge.totalPaidCalls} paid calls]`;
      return rpcResult(req.id, {
        tools: productTools.map((t) => ({
          name: t.name,
          description:
            t.priceUsdMicros > 0
              ? `${t.description} [Paid: ${formatUsd(t.priceUsdMicros)} per call]${repSuffix}`
              : t.description,
          inputSchema: t.inputSchema,
          _meta: {
            'dev.hawker/price': { usdMicros: t.priceUsdMicros, display: formatUsd(t.priceUsdMicros) },
            'dev.hawker/reputation': badge,
          },
        })),
      });
    }

    case 'tools/call':
      return handleToolCall(product, productTools, req as JsonRpcRequest, ctx);

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

async function handleToolCall(
  product: Product,
  productTools: Tool[],
  req: JsonRpcRequest,
  ctx: RequestContext,
): Promise<McpHttpResponse> {
  const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  const tool = productTools.find((t) => t.name === params.name);
  if (!tool) {
    return rpcError(req.id, -32602, `Unknown tool: ${params.name ?? '(none)'}`);
  }
  const args = params.arguments ?? {};

  // 필수 인자 검사 (JSON Schema required 기준의 최소 검증)
  const schema = tool.inputSchema as { required?: string[] };
  const missing = (schema.required ?? []).filter((k) => args[k] === undefined);
  if (missing.length > 0) {
    meter({ product, toolName: tool.name, rail: 'free', priceUsdMicros: 0, status: 'invalid_args' });
    return rpcResult(req.id, {
      isError: true,
      content: [{ type: 'text', text: `Missing required arguments: ${missing.join(', ')}` }],
    });
  }

  // 결제 게이트
  const decision = await authorizePayment({
    priceUsdMicros: tool.priceUsdMicros,
    authorizationHeader: ctx.authorizationHeader,
    xPaymentHeader: ctx.xPaymentHeader,
    resource: ctx.resourceUrl,
    description: `${tool.name} on ${product.name}`,
  });
  if (!decision.ok) {
    meter({
      product,
      toolName: tool.name,
      rail: 'free',
      priceUsdMicros: tool.priceUsdMicros,
      status: 'payment_required',
    });
    return { status: decision.httpStatus, body: decision.body };
  }

  // 업스트림 프록시
  const started = Date.now();
  let result;
  try {
    result = await callUpstream(product, tool, args);
  } catch (err) {
    meter({
      product,
      toolName: tool.name,
      rail: decision.grant.rail,
      apiKeyId: decision.grant.rail === 'credits' ? decision.grant.apiKeyId : undefined,
      priceUsdMicros: 0,
      status: 'upstream_error',
      latencyMs: Date.now() - started,
    });
    return rpcResult(req.id, {
      isError: true,
      content: [{ type: 'text', text: `Upstream call failed: ${(err as Error).message}. You were not charged.` }],
    });
  }
  const latencyMs = Date.now() - started;

  if (!result.ok) {
    // 실패한 콜은 과금하지 않는다
    meter({
      product,
      toolName: tool.name,
      rail: decision.grant.rail,
      apiKeyId: decision.grant.rail === 'credits' ? decision.grant.apiKeyId : undefined,
      priceUsdMicros: 0,
      status: 'upstream_error',
      latencyMs,
    });
    return rpcResult(req.id, {
      isError: true,
      content: [
        { type: 'text', text: `Upstream returned HTTP ${result.status}. You were not charged.` },
      ],
    });
  }

  // 성공 → 결제 확정 (x402는 온체인 정산 영수증 반환)
  let receipt = null;
  try {
    receipt = await commitPayment(decision.grant, {
      priceUsdMicros: tool.priceUsdMicros,
      resource: ctx.resourceUrl,
      description: `${tool.name} on ${product.name}`,
    });
  } catch (err) {
    meter({
      product,
      toolName: tool.name,
      rail: decision.grant.rail,
      apiKeyId: decision.grant.rail === 'credits' ? decision.grant.apiKeyId : undefined,
      priceUsdMicros: tool.priceUsdMicros,
      status: 'payment_required',
      latencyMs,
    });
    return rpcError(req.id, -32000, `Payment commit failed: ${(err as Error).message}`);
  }

  meter({
    product,
    toolName: tool.name,
    rail: decision.grant.rail,
    apiKeyId: decision.grant.rail === 'credits' ? decision.grant.apiKeyId : undefined,
    priceUsdMicros: tool.priceUsdMicros,
    status: 'ok',
    latencyMs,
  });

  const response = rpcResult(req.id, {
    content: [
      {
        type: 'text',
        text: typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
      },
    ],
  });
  // 유료 응답은 CDN/프록시에 절대 캐시되면 안 됨 (무료 유출 방어)
  response.headers = { 'Cache-Control': 'no-store, private' };
  if (receipt) {
    response.headers['X-PAYMENT-RESPONSE'] = encodeReceipt(receipt);
  }
  return response;
}
