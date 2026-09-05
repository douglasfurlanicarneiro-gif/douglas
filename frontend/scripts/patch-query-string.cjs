'use strict';

// Compatibility bridge for GHSA-vcc3-ghjq-m6fr. The decoder remains the
// unmodified upstream 0.5.0; query-string 7 expects a CommonJS function.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = require.resolve('query-string', { paths: [root] });
const decoder = require.resolve('decode-uri-component', { paths: [path.dirname(file)] });
const version = (entry) => JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8')).version;
if (version(file) !== '7.1.3' || version(decoder) !== '0.5.0') {
  throw new Error('Review the URL compatibility bridge before changing query-string or decode-uri-component.');
}
const original = "const decodeComponent = require('decode-uri-component');";
const replacement = [
  "const decodeComponentModule = require('decode-uri-component');",
  '// Preserve the legacy plus-sign behavior, including fragment parsing.',
  "const decodeComponent = value => decodeComponentModule.default(typeof value === 'string' ? value.replace(/\\+/g, ' ') : value);",
].join('\n');
const source = fs.readFileSync(file, 'utf8');
if (!source.includes(replacement)) {
  if (process.argv.includes('--check') || source.split(original).length !== 2) {
    throw new Error('URL compatibility bridge missing or unexpected package content. Run npm ci.');
  }
  fs.writeFileSync(file, source.replace(original, replacement));
}
console.log('URL decoder 0.5.0: compatibility bridge verified.');
