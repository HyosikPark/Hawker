import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenUpstreamReason } from './ssrf.js';

test('공개 호스트는 허용', () => {
  assert.equal(forbiddenUpstreamReason('https://api.example.com/spec.json'), null);
  assert.equal(forbiddenUpstreamReason('https://apis.data.go.kr/x'), null);
});

test('루프백·사설·링크로컬·내부 호스트는 차단', () => {
  for (const u of [
    'http://localhost:8402/v1/sellers',
    'http://127.0.0.1/',
    'https://10.0.0.5/api',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data', // 클라우드 메타데이터
    'http://gateway.internal/',
    'http://foo.localhost/',
    'http://[::1]:8080/',
  ]) {
    assert.notEqual(forbiddenUpstreamReason(u), null, `차단돼야 함: ${u}`);
  }
});

test('http(s) 외 스킴 차단', () => {
  assert.notEqual(forbiddenUpstreamReason('file:///etc/passwd'), null);
  assert.notEqual(forbiddenUpstreamReason('gopher://x'), null);
});

test('HAWKER_ALLOW_PRIVATE_UPSTREAM=1이면 로컬 개발 예외', () => {
  process.env.HAWKER_ALLOW_PRIVATE_UPSTREAM = '1';
  try {
    assert.equal(forbiddenUpstreamReason('http://localhost:8402/datasets'), null);
  } finally {
    delete process.env.HAWKER_ALLOW_PRIVATE_UPSTREAM;
  }
});
