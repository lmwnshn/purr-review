import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let minify;
try {
  ({ minify } = require(process.env.TERSER_MODULE || 'terser'));
} catch {
  console.error('Build requires Terser 5.44.0 (maintainers only). See docs/REFERENCE.md for the exact command.');
  process.exit(1);
}

const files = ['src/adapter.js', 'src/app.js'];
const sources = await Promise.all(files.map(file => readFile(resolve(root, file), 'utf8')));
const readable = `void (() => {\n'use strict';\n\n${sources.map(source => source.trim()).join('\n\n')}\n})();\n`;
new vm.Script(readable, { filename: 'purr-review.js' });
const result = await minify(readable, {
  ecma: 2020,
  compress: { passes: 3 },
  mangle: true,
  format: { ascii_only: true, comments: false },
});
if (!result.code) throw new Error('Minifier returned an empty script.');
new vm.Script(result.code, { filename: 'purr-review.min.js' });

const bookmarklet = `javascript:${encodeURIComponent(result.code)}`;
if (decodeURIComponent(bookmarklet.slice(11)) !== result.code) {
  throw new Error('Bookmarklet encoding failed verification.');
}
const escapeHTML = value => value.replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);
const template = await readFile(resolve(root, 'scripts/install-template.html'), 'utf8');
const replacements = {
  BOOKMARKLET: escapeHTML(bookmarklet),
  BOOKMARKLET_BYTES: Buffer.byteLength(bookmarklet).toLocaleString('en-US'),
  SCRIPT_BYTES: Buffer.byteLength(result.code).toLocaleString('en-US'),
};
const installer = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, token) => {
  if (!(token in replacements)) throw new Error(`Unknown installer token: ${token}`);
  return replacements[token];
});
await mkdir(resolve(root, 'dist'), { recursive: true });
await Promise.all([
  writeFile(resolve(root, 'dist/purr-review.js'), readable),
  writeFile(resolve(root, 'dist/purr-review.min.js'), `${result.code}\n`),
  writeFile(resolve(root, 'dist/bookmarklet.txt'), `${bookmarklet}\n`),
  writeFile(resolve(root, 'index.html'), installer),
]);
console.log(`Built dist/purr-review.js (${Buffer.byteLength(readable).toLocaleString('en-US')} bytes)`);
console.log(`Built dist/purr-review.min.js (${replacements.SCRIPT_BYTES} bytes)`);
console.log(`Built dist/bookmarklet.txt (${replacements.BOOKMARKLET_BYTES} bytes, excluding trailing newline)`);
console.log('Built index.html with the complete bookmarklet embedded; no server or fetch required.');
