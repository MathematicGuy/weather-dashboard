const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache } = require('../src/cache');

test('TTLCache stores and expires values', async () => {
  const cache = new TTLCache(30, 10);
  cache.set('key', { ok: true });
  assert.deepEqual(cache.get('key'), { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(cache.get('key'), null);
});

test('TTLCache evicts oldest on max size', () => {
  const cache = new TTLCache(1000, 2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});
