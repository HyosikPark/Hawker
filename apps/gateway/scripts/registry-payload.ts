/**
 * 공식 MCP Registry 등록 페이로드(server.json) 생성기.
 *
 * 사용법:
 *   pnpm --filter @hawker/gateway exec tsx scripts/registry-payload.ts <slug> <publicBaseUrl> <namespace>
 *   예: ... registry-payload.ts weather https://hawker-gateway.fly.dev io.github.hyosik
 *
 * 출력된 server.json을 mcp-publisher CLI로 게시:
 *   mcp-publisher login github   (io.github.* 네임스페이스)
 *   mcp-publisher publish
 */
import { eq } from 'drizzle-orm';
import { db, products, tools } from '@hawker/db';

const [slug, baseUrl, namespace] = process.argv.slice(2);
if (!slug || !baseUrl || !namespace) {
  console.error('사용법: tsx scripts/registry-payload.ts <slug> <publicBaseUrl> <namespace>');
  process.exit(1);
}

const product = db.select().from(products).where(eq(products.slug, slug)).get();
if (!product) {
  console.error(`상품 없음: ${slug}`);
  process.exit(1);
}
const productTools = db.select().from(tools).where(eq(tools.productId, product.id)).all();

const payload = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json',
  name: `${namespace}/${product.slug}`,
  // 레지스트리 설명은 100자 제한 — 결제 정보를 우선 확보하고 남는 길이만 본문 사용
  description: (() => {
    const suffix = ` — paid per call (x402/credits), ${productTools.length} tools`;
    const room = 100 - suffix.length;
    const head =
      product.description.length > room
        ? `${product.description.slice(0, room - 1).trimEnd()}…`
        : product.description;
    return head + suffix;
  })(),
  version: '0.1.0',
  remotes: [
    {
      type: 'streamable-http',
      url: `${baseUrl.replace(/\/$/, '')}/mcp/${product.slug}`,
    },
  ],
};

console.log(JSON.stringify(payload, null, 2));
