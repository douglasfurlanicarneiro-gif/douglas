import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const sourceRoots = [join(frontendRoot, 'app'), join(frontendRoot, 'src')];
const allowedNativeTypographyFile = join('src', 'components', 'Typography.tsx');
const allowedHtmlFile = join('app', '+html.tsx');

const files = [];
const visit = (path) => {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) visit(join(path, entry));
    return;
  }
  if (extname(path) === '.tsx') files.push(path);
};
sourceRoots.forEach(visit);

const violations = [];
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const displayPath = relative(frontendRoot, file);
  const normalizedPath = displayPath.replaceAll('\\', '/');
  const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/gs)];

  if (normalizedPath !== allowedNativeTypographyFile.replaceAll('\\', '/')) {
    for (const match of imports) {
      const names = match[1]
        .split(',')
        .map((name) => name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]);
      if (names.includes('Text') || names.includes('TextInput')) {
        violations.push(`${displayPath}: use AppText/AppTextInput em vez do componente nativo.`);
      }
    }
  }

  if (/fontSize\s*:\s*\d/.test(code)) {
    violations.push(`${displayPath}: use FONT_SIZES ou TYPOGRAPHY; tamanho numérico encontrado.`);
  }
  if (
    normalizedPath !== allowedNativeTypographyFile.replaceAll('\\', '/')
    && normalizedPath !== allowedHtmlFile.replaceAll('\\', '/')
    && /fontFamily\s*:/.test(code)
  ) {
    violations.push(`${displayPath}: a família deve ser resolvida pelo sistema tipográfico.`);
  }
  if (/\bArial\b/i.test(code)) {
    violations.push(`${displayPath}: fallback Arial não permitido.`);
  }
}

if (violations.length) {
  console.error(['Falha na padronização tipográfica:', ...violations].join('\n- '));
  process.exit(1);
}

console.log(`Tipografia validada em ${files.length} arquivos.`);
