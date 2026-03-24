import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const sourceRoot = process.env.THEME_SOURCE_ROOT
  ? path.resolve(repoRoot, process.env.THEME_SOURCE_ROOT)
  : repoRoot;

const FILES = {
  themeIndex: 'wiki/docs/.vitepress/theme/index.ts',
  baseCss: 'wiki/docs/.vitepress/theme/styles/base.css',
  varsCss: 'wiki/docs/.vitepress/theme/styles/vars.css',
};

function readSource(relativePath) {
  return readFileSync(path.join(sourceRoot, relativePath), 'utf8');
}

function getDarkTokenValue(css, tokenName) {
  const darkBlockMatch = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
  assert.ok(darkBlockMatch, 'Expected a .dark token block in vars.css');

  const tokenPattern = new RegExp(`${tokenName}:\\s*([^;]+);`);
  const tokenMatch = darkBlockMatch[1].match(tokenPattern);
  assert.ok(tokenMatch, `Expected ${tokenName} inside the .dark token block`);
  return tokenMatch[1].trim().toLowerCase();
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test('theme entry keeps local theme overrides after VitePress defaults', () => {
  const themeIndex = readSource(FILES.themeIndex);

  const vitepressBaseImport = themeIndex.indexOf(
    "import 'vitepress/dist/client/theme-default/styles/base.css'",
  );
  const localVarsImport = themeIndex.indexOf("import './styles/vars.css'");
  const localBaseImport = themeIndex.indexOf("import './styles/base.css'");

  assert.notEqual(vitepressBaseImport, -1, 'Expected the VitePress base.css import');
  assert.notEqual(localVarsImport, -1, 'Expected the local vars.css import');
  assert.notEqual(localBaseImport, -1, 'Expected the local base.css import');
  assert.ok(
    vitepressBaseImport < localVarsImport && localVarsImport < localBaseImport,
    'Expected local theme overrides to load after VitePress default theme styles',
  );
});

test('base.css sets an explicit html.dark background to block the browser dark canvas', () => {
  const baseCss = readSource(FILES.baseCss);

  assert.match(
    baseCss,
    /html\.dark\s*\{[\s\S]*?background-color:\s*var\(--c-bg\);[\s\S]*?\}/,
    'Expected base.css to paint html.dark with the theme background color',
  );
});

test('vars.css syncs VitePress tokens to the custom theme tokens in both light and dark modes', () => {
  const varsCss = readSource(FILES.varsCss);
  const expectedMappings = [
    ['--vp-c-bg', '--c-bg'],
    ['--vp-c-bg-alt', '--c-bg-alt'],
    ['--vp-c-bg-soft', '--c-bg-soft'],
    ['--vp-c-bg-elv', '--c-bg-soft'],
    ['--vp-c-text-1', '--c-text-1'],
    ['--vp-c-text-2', '--c-text-2'],
    ['--vp-c-text-3', '--c-text-3'],
    ['--vp-c-border', '--c-border'],
    ['--vp-c-divider', '--c-border'],
    ['--vp-c-gutter', '--c-border'],
  ];

  for (const [vpToken, customToken] of expectedMappings) {
    const pattern = new RegExp(`${vpToken}:\\s*var\\(${customToken}\\);`, 'g');
    assert.ok(
      countMatches(varsCss, pattern) >= 2,
      `Expected ${vpToken} to mirror ${customToken} in both :root and .dark blocks`,
    );
  }
});

test('dark theme tokens use a layered dark palette instead of the old near-black background', () => {
  const varsCss = readSource(FILES.varsCss);

  const background = getDarkTokenValue(varsCss, '--c-bg');
  const backgroundSoft = getDarkTokenValue(varsCss, '--c-bg-soft');
  const backgroundMute = getDarkTokenValue(varsCss, '--c-bg-mute');
  const backgroundAlt = getDarkTokenValue(varsCss, '--c-bg-alt');

  assert.notEqual(
    background,
    '#0a0a0a',
    'Expected the primary dark background token to move away from the old near-black value',
  );
  assert.equal(background, '#1e1e1e');
  assert.equal(backgroundSoft, '#252526');
  assert.equal(backgroundMute, '#2d2d2d');
  assert.equal(backgroundAlt, '#282828');
});
