import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importOpenApi } from './openapi.js';

const spec = {
  openapi: '3.0.3',
  info: { title: 'Demo API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/items/{id}': {
      get: {
        operationId: 'getItem',
        summary: 'Get an item',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
        ],
      },
    },
    '/items': {
      post: {
        operationId: 'createItem',
        summary: 'Create an item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewItem' },
            },
          },
        },
      },
    },
    '/skip-me': {
      get: {
        operationId: 'needsHeader',
        parameters: [{ name: 'X-Custom', in: 'header', required: true, schema: { type: 'string' } }],
      },
    },
  },
  components: {
    schemas: {
      NewItem: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Item title' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

test('path/query 파라미터가 inputSchema와 upstream 매핑으로 변환된다', () => {
  const { tools, baseUrl } = importOpenApi(spec);
  assert.equal(baseUrl, 'https://api.example.com');

  const get = tools.find((t) => t.name === 'getitem')!;
  assert.ok(get);
  assert.equal(get.upstream.method, 'GET');
  assert.equal(get.upstream.pathTemplate, '/items/{id}');
  assert.deepEqual(get.upstream.query, { verbose: 'verbose' });
  const schema = get.inputSchema as { properties: Record<string, unknown>; required: string[] };
  assert.ok(schema.properties.id);
  assert.ok(schema.properties.verbose);
  assert.deepEqual(schema.required, ['id']);
});

test('$ref requestBody가 bodyArgs로 풀린다', () => {
  const { tools } = importOpenApi(spec);
  const post = tools.find((t) => t.name === 'createitem')!;
  assert.ok(post);
  assert.deepEqual(post.upstream.bodyArgs, ['title', 'tags']);
  const schema = post.inputSchema as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(schema.required, ['title']);
});

test('필수 헤더 파라미터가 있는 operation은 경고와 함께 제외된다', () => {
  const { tools, warnings } = importOpenApi(spec);
  assert.equal(tools.find((t) => t.name === 'needsheader'), undefined);
  assert.ok(warnings.some((w) => w.includes('needsheader')));
});

test('include 필터로 특정 툴만 고를 수 있다', () => {
  const { tools } = importOpenApi(spec, { include: ['getitem'] });
  assert.deepEqual(tools.map((t) => t.name), ['getitem']);
});

test('paths 없는 문서는 거부된다', () => {
  assert.throws(() => importOpenApi({ openapi: '3.0.0' }));
});
