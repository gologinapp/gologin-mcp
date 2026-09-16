import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const pkg = readJson('../package.json');
const lock = readJson('../package-lock.json');
const server = readJson('../server.json');
const [publishedPackage] = server.packages;

assert.equal(server.name, 'io.github.gologinapp/gologin-mcp');
assert.equal(pkg.mcpName, server.name);
assert.equal(server.version, pkg.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(server.packages.length, 1);
assert.equal(publishedPackage.registryType, 'npm');
assert.equal(publishedPackage.identifier, pkg.name);
assert.equal(publishedPackage.version, pkg.version);
assert.equal(publishedPackage.transport.type, 'stdio');
assert.ok(server.description.length > 0 && server.description.length <= 100);
assert.deepEqual(publishedPackage.environmentVariables.map(variable => variable.name), ['API_TOKEN']);
for (const variable of publishedPackage.environmentVariables) {
  assert.equal(variable.isRequired, true);
  assert.equal(variable.isSecret, true);
  assert.equal(variable.value, undefined);
  assert.equal(variable.default, undefined);
}

if (process.argv.includes('--published')) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Publish ${pkg.name}@${pkg.version} to npm first (HTTP ${response.status})`);
  const published = await response.json();
  assert.equal(published.name, pkg.name);
  assert.equal(published.version, pkg.version);
  assert.equal(published.mcpName, server.name, 'Published npm package must declare the Registry name');
  console.log(`Published npm metadata verified: ${pkg.name}@${pkg.version}`);
}

console.log(`Registry metadata verified: ${server.name}@${server.version}`);
