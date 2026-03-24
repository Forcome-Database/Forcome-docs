import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const wikiRequire = createRequire(path.join(repoRoot, 'wiki/package.json'));
const { parse, compileStyle } = wikiRequire('vue/compiler-sfc');
const loginPagePath = path.join(
  repoRoot,
  'wiki/docs/.vitepress/theme/pages/LoginPage.vue',
);

test('LoginPage dark-mode glow selectors stay scoped after SFC style compilation', () => {
  const source = readFileSync(loginPagePath, 'utf8');
  const { descriptor } = parse(source, { filename: loginPagePath });
  const styleBlock = descriptor.styles.find((style) => style.scoped);

  assert.ok(styleBlock, 'Expected LoginPage.vue to include a scoped style block');

  const compiled = compileStyle({
    filename: loginPagePath,
    id: 'login-page-scope-test',
    source: styleBlock.content,
    scoped: true,
  });

  assert.equal(compiled.errors.length, 0, 'Expected LoginPage.vue styles to compile cleanly');
  assert.doesNotMatch(
    compiled.code,
    /\.dark\s*\{\s*opacity:\s*0\.(?:06|08)\s*;\s*\}/,
    'Dark-mode glow styles must not leak into a bare .dark selector',
  );
  assert.match(
    compiled.code,
    /\.dark\s+\.login-page\.is-mounted\s+\.login-bg-glow--1\[data-v-login-page-scope-test\]/,
    'Expected the first dark glow selector to stay scoped to LoginPage',
  );
  assert.match(
    compiled.code,
    /\.dark\s+\.login-page\.is-mounted\s+\.login-bg-glow--2\[data-v-login-page-scope-test\]/,
    'Expected the second dark glow selector to stay scoped to LoginPage',
  );
});
