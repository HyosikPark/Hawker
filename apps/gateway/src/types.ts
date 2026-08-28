export interface UpstreamSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** "/v1/forecast" 또는 "/users/{id}" — {arg}는 툴 인자로 치환 */
  pathTemplate: string;
  /** queryParam -> 툴 인자 이름 */
  query?: Record<string, string>;
  /** 항상 붙는 고정 쿼리 */
  staticQuery?: Record<string, string>;
  /** JSON body로 전달할 인자 이름들 */
  bodyArgs?: string[];
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** 프록시(TLS 종단) 뒤에서도 정식 스킴의 URL을 만든다 */
export function canonicalUrl(rawUrl: string, forwardedProto?: string): URL {
  const url = new URL(rawUrl);
  if (forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`;
  return url;
}

export function formatUsd(micros: number): string {
  const s = (micros / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${s || '0'}`;
}
