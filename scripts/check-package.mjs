import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Run this check with npm run check:package');
}

const output = execFileSync(process.execPath, [
  npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json',
], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const [packed] = JSON.parse(output);
const expected = new Set(['LICENSE', 'README.md', 'dist/index.js', 'package.json']);
const actual = new Set(packed.files.map(file => file.path));
const unexpected = [...actual].filter(path => !expected.has(path));
const missing = [...expected].filter(path => !actual.has(path));

if (unexpected.length || missing.length) {
  // Do not log unexpected filenames: local state paths can contain private data.
  throw new Error(`Unsafe package contents: ${unexpected.length} unexpected and ${missing.length} missing files`);
}

console.log(`Package allowlist verified: ${actual.size} files, ${packed.unpackedSize} bytes unpacked`);
