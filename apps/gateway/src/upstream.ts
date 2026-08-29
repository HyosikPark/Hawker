import { XMLParser } from 'fast-xml-parser';
import type { products, tools } from '@hawker/db';
import { decryptSecret } from './crypto.js';
import { forbiddenUpstreamReason } from './ssrf.js';
import type { UpstreamSpec } from './types.js';

const xmlParser = new XMLParser({ ignoreAttributes: true });

/** 응답 후처리: XML→JSON 변환과 dot 경로 unwrap. 실패 시 원본 유지(과금 데이터를 잃지 않기 위해). */
export function transformResponse(body: unknown, spec: UpstreamSpec): unknown {
  let out = body;
  if (spec.responseTransform === 'xml-to-json' && typeof out === 'string' && out.trimStart().startsWith('<')) {
    try {
      out = xmlParser.parse(out);
    } catch {
      return body;
    }
  }
  if (spec.responseUnwrap && out && typeof out === 'object') {
    const unwrapped = spec.responseUnwrap
      .split('.')
      .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], out);
    if (unwrapped !== undefined) out = unwrapped;
  }
  return out;
}

type Product = typeof products.$inferSelect;
type Tool = typeof tools.$inferSelect;

export interface UpstreamResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** 툴 인자를 판매자의 실제 API 호출로 변환해 프록시한다. 구매자는 업스트림 키를 절대 보지 못한다. */
export async function callUpstream(
  product: Product,
  tool: Tool,
  args: Record<string, unknown>,
): Promise<UpstreamResult> {
  const spec = tool.upstream as UpstreamSpec;

  let path = spec.pathTemplate.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(String(args[name] ?? '')),
  );

  const url = new URL(path, product.upstreamBaseUrl);
  for (const [param, argName] of Object.entries(spec.query ?? {})) {
    const v = args[argName];
    if (v !== undefined && v !== null) url.searchParams.set(param, String(v));
  }
  for (const [param, value] of Object.entries(spec.staticQuery ?? {})) {
    url.searchParams.set(param, value);
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (product.upstreamAuthEncrypted) {
    // 레거시 {header, value} 또는 신형 {in: 'header'|'query', name, value}
    const auth = JSON.parse(decryptSecret(product.upstreamAuthEncrypted)) as {
      header?: string;
      in?: 'header' | 'query';
      name?: string;
      value: string;
    };
    const location = auth.in ?? 'header';
    const name = auth.name ?? auth.header;
    if (!name) throw new Error('업스트림 인증 설정이 손상되었습니다 (name 없음)');
    if (location === 'query') url.searchParams.set(name, auth.value);
    else headers[name] = auth.value;
  }

  let body: string | undefined;
  if (spec.bodyArgs?.length) {
    const payload: Record<string, unknown> = {};
    for (const name of spec.bodyArgs) if (args[name] !== undefined) payload[name] = args[name];
    body = JSON.stringify(payload);
    headers['content-type'] = 'application/json';
  }

  // 호출 시점 SSRF 재검사 (DNS 리바인딩 방어) + 리다이렉트 수동 처리(내부망 302 우회 차단)
  const reason = forbiddenUpstreamReason(url.href);
  if (reason) throw new Error(`Upstream blocked: ${reason}`);

  const res = await fetch(url, {
    method: spec.method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

  // 리다이렉트는 따라가지 않음 — 내부망으로 튀는 302 SSRF 차단
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Upstream redirected (${res.status}); redirects are not followed.`);
  }

  const text = await readCapped(res, MAX_UPSTREAM_BYTES);
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 업스트림이 JSON이 아니면 원문 그대로 (변환은 아래에서)
  }
  return { ok: res.ok, status: res.status, body: transformResponse(parsed, spec) };
}

const MAX_UPSTREAM_BYTES = 5_000_000; // 5MB — 대용량 응답 메모리 고갈 방어

/** 응답 본문을 상한까지만 읽는다. 초과 시 에러(과금 데이터를 어중간히 반환하지 않음). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Upstream response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
