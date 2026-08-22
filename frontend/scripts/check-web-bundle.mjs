import { readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const DIST_DIR = resolve('dist');
const MAX_SINGLE_JS_BYTES = 1_500_000;
const MAX_TOTAL_JS_BYTES = 2_000_000;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

let files;
try {
  files = (await listFiles(DIST_DIR)).filter((file) => extname(file) === '.js');
} catch {
  throw new Error('A pasta dist não existe. Execute npm run build:web antes desta validação.');
}

if (files.length === 0) throw new Error('Nenhum bundle JavaScript foi encontrado em dist.');

const sizes = await Promise.all(files.map(async (file) => ({
  file: relative(DIST_DIR, file),
  bytes: (await stat(file)).size,
})));
const largest = sizes.reduce((current, item) => item.bytes > current.bytes ? item : current);
const total = sizes.reduce((sum, item) => sum + item.bytes, 0);

console.log(`Bundle web: ${sizes.length} arquivo(s), ${total} bytes no total; maior: ${largest.file} (${largest.bytes} bytes).`);

if (largest.bytes > MAX_SINGLE_JS_BYTES) {
  throw new Error(`O maior bundle excedeu o limite de ${MAX_SINGLE_JS_BYTES} bytes.`);
}
if (total > MAX_TOTAL_JS_BYTES) {
  throw new Error(`O total de JavaScript excedeu o limite de ${MAX_TOTAL_JS_BYTES} bytes.`);
}
