import type { UpstreamSpec } from './types.js';

/**
 * OpenAPI 3.x 문서 → Hawker 툴 변환기.
 * 판매자가 스펙만 던지면 각 operation이 에이전트가 살 수 있는 MCP 툴이 된다.
 */

export interface ImportedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  upstream: UpstreamSpec;
}

export interface ImportResult {
  baseUrl?: string;
  tools: ImportedTool[];
  warnings: string[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MAX_TOOLS = 100;

type AnyObj = Record<string, any>;

/** 로컬 $ref(#/...)만 해석. 순환 참조는 depth 가드로 차단. */
function resolveRef(doc: AnyObj, node: any, depth = 0): any {
  if (depth > 20 || !node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    const target = node.$ref
      .slice(2)
      .split('/')
      .reduce((acc: any, key: string) => acc?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
    return resolveRef(doc, target, depth + 1);
  }
  return node;
}

/** JSON Schema에서 에이전트에게 유용한 필드만 추려 재귀적으로 정리 */
function cleanSchema(doc: AnyObj, schema: any, depth = 0): Record<string, unknown> {
  const s = resolveRef(doc, schema, depth);
  if (!s || typeof s !== 'object' || depth > 10) return { type: 'string' };
  const out: Record<string, unknown> = {};
  for (const k of ['type', 'description', 'enum', 'default', 'format', 'minimum', 'maximum']) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  if (s.type === 'array' && s.items) out.items = cleanSchema(doc, s.items, depth + 1);
  if (s.type === 'object' && s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, cleanSchema(doc, v, depth + 1)]),
    );
    if (Array.isArray(s.required)) out.required = s.required;
  }
  if (!out.type) out.type = 'string';
  return out;
}

function toToolName(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .toLowerCase();
}

export function importOpenApi(
  doc: AnyObj,
  opts: { include?: string[]; maxTools?: number } = {},
): ImportResult {
  const warnings: string[] = [];
  const tools: ImportedTool[] = [];
  const maxTools = opts.maxTools ?? MAX_TOOLS;

  if (!doc || typeof doc !== 'object' || !doc.paths) {
    throw new Error('유효한 OpenAPI 3.x 문서가 아닙니다 (paths 없음).');
  }

  const baseUrl: string | undefined = doc.servers?.[0]?.url;
  const seen = new Set<string>();

  for (const [path, pathItemRaw] of Object.entries<AnyObj>(doc.paths)) {
    const pathItem = resolveRef(doc, pathItemRaw);
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      const rawName = op.operationId ?? `${method}_${path.replace(/[/{}]+/g, '_')}`;
      const name = toToolName(rawName);
      if (opts.include && !opts.include.includes(name) && !opts.include.includes(op.operationId)) {
        continue;
      }
      if (seen.has(name)) {
        warnings.push(`중복 툴 이름 건너뜀: ${name} (${method.toUpperCase()} ${path})`);
        continue;
      }
      if (tools.length >= maxTools) {
        warnings.push(`툴 상한(${maxTools}) 도달 — 나머지 operation은 제외됨.`);
        break;
      }

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const queryMap: Record<string, string> = {};

      const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]
        .map((p: any) => resolveRef(doc, p))
        .filter(Boolean);

      let unsupported = false;
      for (const p of params) {
        if (p.in === 'path') {
          properties[p.name] = { description: p.description, ...cleanSchema(doc, p.schema) };
          required.push(p.name);
        } else if (p.in === 'query') {
          properties[p.name] = { description: p.description, ...cleanSchema(doc, p.schema) };
          if (p.required) required.push(p.name);
          queryMap[p.name] = p.name;
        } else if (p.in === 'header' || p.in === 'cookie') {
          if (p.required) {
            warnings.push(`${name}: 필수 ${p.in} 파라미터(${p.name})는 미지원 — 툴 제외.`);
            unsupported = true;
          }
        }
      }
      if (unsupported) continue;

      // requestBody (application/json object만 지원)
      let bodyArgs: string[] | undefined;
      const body = resolveRef(doc, op.requestBody);
      if (body?.content) {
        const jsonSchema = resolveRef(doc, body.content['application/json']?.schema);
        if (jsonSchema?.type === 'object' && jsonSchema.properties) {
          bodyArgs = Object.keys(jsonSchema.properties);
          for (const [k, v] of Object.entries(jsonSchema.properties)) {
            if (properties[k]) {
              warnings.push(`${name}: body 인자 ${k}가 파라미터와 충돌 — body 쪽을 무시.`);
              continue;
            }
            properties[k] = cleanSchema(doc, v);
          }
          for (const r of jsonSchema.required ?? []) {
            if (!required.includes(r)) required.push(r);
          }
        } else if (body.required) {
          warnings.push(`${name}: JSON object가 아닌 필수 requestBody는 미지원 — 툴 제외.`);
          continue;
        }
      }

      const description =
        [op.summary, op.description].filter(Boolean).join(' — ') ||
        `${method.toUpperCase()} ${path}`;

      seen.add(name);
      tools.push({
        name,
        description,
        inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
        upstream: {
          method: method.toUpperCase() as UpstreamSpec['method'],
          pathTemplate: path,
          ...(Object.keys(queryMap).length ? { query: queryMap } : {}),
          ...(bodyArgs?.length ? { bodyArgs } : {}),
        },
      });
    }
  }

  return { baseUrl, tools, warnings };
}
