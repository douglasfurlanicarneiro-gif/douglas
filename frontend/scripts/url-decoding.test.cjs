'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const query = require('query-string');

test('preserves Unicode, repeated values, spaces and encoded plus signs', () => {
  assert.deepEqual({ ...query.parse('nome=Jo%C3%A3o+Silva&tag=a&tag=b&token=a%2Bb&empty=&flag') }, {
    nome: 'João Silva', tag: ['a', 'b'], token: 'a+b', empty: '', flag: null,
  });
  assert.equal(query.parseUrl('/?x=1#Ol%C3%A1+Mundo', { parseFragmentIdentifier: true }).fragmentIdentifier, 'Olá Mundo');
});

test('preserves payment-return identifiers and URL round trips', () => {
  const values = { order_nsu: 'pedido-123', transaction_nsu: 'abc+123/456', slug: 'furlani', receipt_url: 'https://example.com/r?a=1&b=2' };
  assert.deepEqual({ ...query.parse(query.stringify(values)) }, values);
  assert.deepEqual({ ...query.parse('a=%2B&b=a+b', { decode: false }) }, { a: '%2B', b: 'a+b' });
});

test('malformed UTF-8 does not block the decoder (isolated process and hard timeout)', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const query = require('query-string');
    for (const input of ['%FF'.repeat(10000), '%E0%A4'.repeat(5000), '%C3%A9%FF'.repeat(3000), '%', '%GG']) {
      const result = query.parse('value=' + input);
      assert.equal(typeof result.value, 'string');
    }
    assert.equal(query.parse('value=%C3%A9%FF').value, 'é%FF');
  `], { cwd: require('node:path').resolve(__dirname, '..'), timeout: 5000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});
