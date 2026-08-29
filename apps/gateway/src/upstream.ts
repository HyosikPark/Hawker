import type { products, tools } from '@hawker/db';
import { decryptSecret } from './crypto.js';
import type { UpstreamSpec } from './types.js';

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

  const res = await fetch(url, {
    method: spec.method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 업스트림이 JSON이 아니면 원문 그대로
  }
  return { ok: res.ok, status: res.status, body: parsed };
}
