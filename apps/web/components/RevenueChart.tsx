'use client';

import { useState } from 'react';

export interface DailyPoint {
  date: string;
  revenueUsdMicros: number;
  calls: number;
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0'}`;
}

const W = 720;
const H = 200;
const PAD = { top: 16, right: 8, bottom: 26, left: 46 };

/** 최근 14일 일별 매출 바 차트 (단일 시리즈 — 범례 없음, 호버 툴팁 포함) */
export function RevenueChart({ daily }: { daily: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...daily.map((d) => d.revenueUsdMicros), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / daily.length;
  const barW = Math.min(slot - 8, 32);

  const total = daily.reduce((s, d) => s + d.revenueUsdMicros, 0);
  if (total === 0) {
    return <p className="hint">No revenue in the last 14 days — share your MCP URL with agents.</p>;
  }

  const y = (v: number) => PAD.top + plotH * (1 - v / max);
  const gridVals = [max, max / 2];

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily revenue, last 14 days">
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {usd(v)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        {daily.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          const x0 = cx - barW / 2;
          const barH = (d.revenueUsdMicros / max) * plotH;
          const yTop = PAD.top + plotH - barH;
          const r = Math.min(4, barH); // 상단만 4px 라운드, 베이스라인에 고정
          return (
            <g key={d.date}>
              {d.revenueUsdMicros > 0 && (
                <path
                  d={`M ${x0} ${PAD.top + plotH} V ${yTop + r} Q ${x0} ${yTop} ${x0 + r} ${yTop} H ${x0 + barW - r} Q ${x0 + barW} ${yTop} ${x0 + barW} ${yTop + r} V ${PAD.top + plotH} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {/* 히트 타깃은 마크보다 크게 */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {(i === 0 || i === daily.length - 1 || i === Math.floor(daily.length / 2)) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`,
            top: 0,
            transform: 'translateX(-50%)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
          <strong>{daily[hover].date}</strong>
          <br />
          {usd(daily[hover].revenueUsdMicros)} · {daily[hover].calls} calls
        </div>
      )}
    </div>
  );
}
