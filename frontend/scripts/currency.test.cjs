const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('shared BRL formatter preserves existing currency output', () => {
  const source = fs.readFileSync('src/theme.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sandbox = { exports: {}, require: () => ({ Platform: { OS: 'web', select: options => options.web ?? options.default } }), Intl };
  vm.runInNewContext(compiled, sandbox);
  for (const value of [0, -0, 0.01, 4.25, 50, 85, 109.51, -4.25, 999999.99, NaN, Infinity]) {
    assert.equal(sandbox.exports.brl(value), (value || 0).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
    }));
  }
});
