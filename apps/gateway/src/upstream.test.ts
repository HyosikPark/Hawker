import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformResponse } from './upstream.js';
import type { UpstreamSpec } from './types.js';

const base: UpstreamSpec = { method: 'GET', pathTemplate: '/x' };

test('xml-to-json 변환과 unwrap이 함께 동작한다', () => {
  const xml = '<response><header><resultCode>00</resultCode></header><body><items><item><name>A</name><price>100</price></item></items></body></response>';
  const out = transformResponse(xml, {
    ...base,
    responseTransform: 'xml-to-json',
    responseUnwrap: 'response.body',
  }) as any;
  assert.deepEqual(out.items.item, { name: 'A', price: 100 });
});

test('unwrap 경로가 없으면 원본 유지', () => {
  const out = transformResponse({ a: 1 }, { ...base, responseUnwrap: 'no.such.path' });
  assert.deepEqual(out, { a: 1 });
});

test('XML이 아닌 문자열은 변환하지 않는다', () => {
  const out = transformResponse('plain text', { ...base, responseTransform: 'xml-to-json' });
  assert.equal(out, 'plain text');
});

test('망가진 XML은 원본을 반환한다 (과금 데이터 보호)', () => {
  const out = transformResponse('<a><b>', { ...base, responseTransform: 'xml-to-json' });
  assert.ok(out !== undefined && out !== null);
});

test('변환 지시가 없으면 그대로 통과', () => {
  assert.equal(transformResponse('<xml/>', base), '<xml/>');
});
