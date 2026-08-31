import { db, products, tools } from '@hawker/db';
import { eq } from 'drizzle-orm';
import { reputationBadge, reputationForProduct } from './reputation.js';
import { formatUsd } from './types.js';

/**
 * 기계 판독 가능 발견 매니페스트. x402 인덱서(gold-402, 402index 등)가 크롤링하는
 * /.well-known/x402 와, 사람/에이전트용 카탈로그 목록을 제공한다.
 * 각 상품의 실측 평판을 함께 노출 — 판매자 주장이 아닌 관측치.
 */

const USDC_BY_NETWORK: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

interface DiscoveryItem {
  resource: string; // MCP 엔드포인트 URL
  type: 'mcp/streamable-http';
  name: string;
  description: string;
  x402: {
    network: string;
    asset: string;
    payTo: string;
    tools: { name: string; price: string; priceUsdMicros: number }[];
  };
  reputation: ReturnType<typeof reputationBadge>;
  tags: string[];
}

export function buildDiscovery(origin: string): {
  x402Version: number;
  provider: string;
  updated: string;
  items: DiscoveryItem[];
} {
  const network = process.env.HAWKER_X402_NETWORK ?? 'base-sepolia';
  const payTo = process.env.HAWKER_PAYTO_ADDRESS ?? '0x0000000000000000000000000000000000000000';
  const asset = USDC_BY_NETWORK[network] ?? USDC_BY_NETWORK['base'];

  const live = db.select().from(products).where(eq(products.status, 'live')).all();
  const items: DiscoveryItem[] = live.map((p) => {
    const productTools = db.select().from(tools).where(eq(tools.productId, p.id)).all();
    const paid = productTools.filter((t) => t.priceUsdMicros > 0);
    return {
      resource: `${origin}/mcp/${p.slug}`,
      type: 'mcp/streamable-http',
      name: p.name,
      description: p.description.slice(0, 300),
      x402: {
        network,
        asset,
        payTo,
        tools: productTools.map((t) => ({
          name: t.name,
          price: formatUsd(t.priceUsdMicros),
          priceUsdMicros: t.priceUsdMicros,
          // MCP 안 쓰는 에이전트용: 평범한 x402 HTTP 엔드포인트 (CDP Bazaar 형식)
          httpEndpoint: `${origin}/x402/${p.slug}/${t.name}`,
        })),
      },
      reputation: reputationBadge(reputationForProduct(p.id)),
      tags: inferTags(p.slug, p.description, paid.length === 0),
    };
  });

  return {
    x402Version: 1,
    provider: 'Hawker',
    updated: new Date().toISOString(),
    items,
  };
}

function inferTags(slug: string, description: string, hasFree: boolean): string[] {
  const tags = new Set<string>(['data', 'mcp', 'x402']);
  const text = `${slug} ${description}`.toLowerCase();
  if (/korea|korean|kr-|국토|국세|공휴/.test(text)) tags.add('korea');
  if (/weather/.test(text)) tags.add('weather');
  if (/fx|exchange|rate|currency/.test(text)) tags.add('finance');
  if (/business|사업자|kyb|registration/.test(text)) tags.add('kyb');
  if (/geocod|place|coordinate/.test(text)) tags.add('geo');
  if (hasFree) tags.add('free-tier');
  return [...tags];
}
