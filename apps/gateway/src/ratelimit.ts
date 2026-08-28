import type { MiddlewareHandler } from 'hono';

/**
 * 인메모리 슬라이딩 윈도우 레이트리미터.
 * 무인증 공개 엔드포인트(가입, 키 발급)의 남용 방지용 — 단일 인스턴스 전제(SQLite MVP와 동일).
 */
export function rateLimit(opts: { windowMs: number; max: number }): MiddlewareHandler {
  const hits = new Map<string, number[]>();

  // 주기적으로 만료 항목 청소 (메모리 누수 방지)
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [key, times] of hits) {
      const alive = times.filter((t) => t > cutoff);
      if (alive.length === 0) hits.delete(key);
      else hits.set(key, alive);
    }
  }, opts.windowMs).unref();

  return async (c, next) => {
    const ip =
      c.req.header('fly-client-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'local';
    const now = Date.now();
    const times = (hits.get(ip) ?? []).filter((t) => t > now - opts.windowMs);
    if (times.length >= opts.max) {
      return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
    }
    times.push(now);
    hits.set(ip, times);
    await next();
  };
}
