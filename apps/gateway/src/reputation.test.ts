import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reputationBadge, type ReputationStats } from './reputation.js';

const base: ReputationStats = {
  totalPaidCalls: 0,
  last30dCalls: 0,
  successRate: null,
  latencyP50Ms: null,
  latencyP95Ms: null,
  lastCallAt: null,
  sampleSize: 0,
};

test('표본 없으면 confidence none, 지표 null', () => {
  const b = reputationBadge(base);
  assert.equal(b.confidence, 'none');
  assert.equal(b.successRate, null);
  assert.equal(b.latency, null);
});

test('표본 크기에 따라 confidence 단계 상승', () => {
  assert.equal(reputationBadge({ ...base, sampleSize: 5 }).confidence, 'low');
  assert.equal(reputationBadge({ ...base, sampleSize: 50 }).confidence, 'medium');
  assert.equal(reputationBadge({ ...base, sampleSize: 500 }).confidence, 'high');
});

test('성공률·지연·누적콜 포맷', () => {
  const b = reputationBadge({
    ...base,
    sampleSize: 300,
    successRate: 0.9923,
    latencyP50Ms: 231,
    totalPaidCalls: 1847,
  });
  assert.equal(b.successRate, '99.2%');
  assert.equal(b.latency, '231ms');
  assert.equal(b.totalPaidCalls, 1847);
  assert.equal(b.confidence, 'high');
});
