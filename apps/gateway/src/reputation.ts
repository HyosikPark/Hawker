import { db, usageEvents } from '@hawker/db';
import { and, eq, gte } from 'drizzle-orm';

/**
 * 상품/툴의 신뢰 지표. 판매자 주장이 아니라 게이트웨이가 관측한 실측치.
 * usage_events 기반 — 성공률, 응답속도(p50/p95), 누적 유료 호출, 최근 활동.
 */

export interface ReputationStats {
  totalPaidCalls: number; // 성공한 유료 호출 누적
  last30dCalls: number; // 최근 30일 총 시도(성공+실패)
  successRate: number | null; // 최근 30일 업스트림 성공률 (0~1), 표본 없으면 null
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastCallAt: string | null; // 마지막 호출 시각 ISO
  sampleSize: number; // 지표 산출에 쓴 최근 30일 표본 수
}

const THIRTY_DAYS = 30 * 86_400_000;

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** 한 상품(productId)의 신뢰 지표 계산. */
export function reputationForProduct(productId: string): ReputationStats {
  const since = new Date(Date.now() - THIRTY_DAYS);
  const recent = db
    .select()
    .from(usageEvents)
    .where(and(eq(usageEvents.productId, productId), gte(usageEvents.createdAt, since)))
    .all();

  // 누적 성공 유료 호출은 전체 기간 기준
  const allOk = db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(and(eq(usageEvents.productId, productId), eq(usageEvents.status, 'ok')))
    .all().length;

  // 성공률·지연시간은 "실제 업스트림을 탄" 호출만 대상 (결제 거부/인자오류 제외)
  const served = recent.filter((e) => e.status === 'ok' || e.status === 'upstream_error');
  const ok = served.filter((e) => e.status === 'ok');
  const latencies = ok
    .map((e) => e.latencyMs)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);

  const lastCall = recent.reduce<Date | null>(
    (max, e) => (max === null || e.createdAt > max ? e.createdAt : max),
    null,
  );

  return {
    totalPaidCalls: allOk,
    last30dCalls: recent.length,
    successRate: served.length > 0 ? ok.length / served.length : null,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    lastCallAt: lastCall ? lastCall.toISOString() : null,
    sampleSize: served.length,
  };
}

/** 상품 카드/대시보드에 바로 쓸 사람이 읽는 요약. */
export function reputationBadge(s: ReputationStats): {
  successRate: string | null;
  latency: string | null;
  totalPaidCalls: number;
  confidence: 'none' | 'low' | 'medium' | 'high';
} {
  const confidence =
    s.sampleSize === 0
      ? 'none'
      : s.sampleSize < 20
        ? 'low'
        : s.sampleSize < 200
          ? 'medium'
          : 'high';
  return {
    successRate: s.successRate === null ? null : `${(s.successRate * 100).toFixed(1)}%`,
    latency: s.latencyP50Ms === null ? null : `${s.latencyP50Ms}ms`,
    totalPaidCalls: s.totalPaidCalls,
    confidence,
  };
}
