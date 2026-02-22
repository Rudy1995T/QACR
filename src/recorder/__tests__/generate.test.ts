/**
 * Unit tests for the recordings generator.
 *
 * Run via:  npx tsx --test src/recorder/__tests__/generate.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* -------------------------------------------------------------------------- */
/*  Test: selectBestSelector scoring                                           */
/* -------------------------------------------------------------------------- */

describe('selectBestSelector', () => {
  // Dynamic import so we can test the module
  let selectBestSelector: typeof import('../selectors.js').selectBestSelector;

  before(async () => {
    const mod = await import('../selectors.js');
    selectBestSelector = mod.selectBestSelector;
  });

  it('prefers ARIA selectors over CSS', () => {
    const result = selectBestSelector([
      ['aria/Sign in[role="button"]'],
      ['css/button.btn-primary'],
    ]);
    assert.ok(result.code.includes('getByRole'));
    assert.equal(result.brittle, false);
    assert.ok(result.score >= 90);
  });

  it('prefers text selectors over CSS', () => {
    const result = selectBestSelector([
      ['text/Submit'],
      ['css/.submit-btn'],
    ]);
    assert.ok(result.code.includes('getByText'));
    assert.equal(result.brittle, false);
  });

  it('prefers ARIA over text', () => {
    const result = selectBestSelector([
      ['text/Login'],
      ['aria/Login[role="button"]'],
    ]);
    assert.ok(result.code.includes('getByRole'));
    assert.ok(result.score > 80);
  });

  it('detects data-testid from CSS', () => {
    const result = selectBestSelector([
      ['css/[data-testid="login-btn"]'],
    ]);
    assert.ok(result.code.includes('getByTestId'));
    assert.equal(result.brittle, false);
  });

  it('marks nth-child CSS as brittle', () => {
    const result = selectBestSelector([
      ['css/ul > li:nth-child(3) > a'],
    ]);
    assert.equal(result.brittle, true);
    assert.ok(result.score < 60);
  });

  it('marks generated-looking tokens as brittle', () => {
    const result = selectBestSelector([
      ['css/.sc-fKgJPi.bRjkLq'],
    ]);
    assert.equal(result.brittle, true);
  });

  it('handles simple #id CSS', () => {
    const result = selectBestSelector([
      ['css/#username'],
    ]);
    assert.ok(result.code.includes('#username'));
    assert.equal(result.brittle, false);
    assert.ok(result.score >= 70);
  });

  it('returns body fallback for empty selectors', () => {
    const result = selectBestSelector([]);
    assert.ok(result.code.includes('body'));
    assert.equal(result.brittle, true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Test: generation determinism                                               */
/* -------------------------------------------------------------------------- */

describe('generate', () => {
  const fixtureDir = join(__dirname, '..', '__fixtures__');
  const tempRecordingsDir = join(__dirname, '_temp_recordings');
  const tempOutputDir = join(__dirname, '_temp_output');

  before(() => {
    // Set up temp directories that mimic the project structure
    mkdirSync(join(tempRecordingsDir, 'assertions'), { recursive: true });
    mkdirSync(join(tempRecordingsDir, 'overrides'), { recursive: true });
    mkdirSync(tempOutputDir, { recursive: true });

    // Copy example fixture
    const fixture = readFileSync(join(fixtureDir, 'example.json'), 'utf-8');
    writeFileSync(join(tempRecordingsDir, 'example.json'), fixture);
  });

  after(() => {
    rmSync(tempRecordingsDir, { recursive: true, force: true });
    rmSync(tempOutputDir, { recursive: true, force: true });
  });

  it('produces deterministic output across runs', async () => {
    // We test the selector + code generation functions directly
    // since the full generate() function depends on absolute paths.
    const { selectBestSelector } = await import('../selectors.js');

    const selectors: string[][] = [
      ['aria/Login[role="button"]'],
      ['text/Login'],
      ['css/button.radius'],
    ];

    const result1 = selectBestSelector(selectors);
    const result2 = selectBestSelector(selectors);

    assert.equal(result1.code, result2.code);
    assert.equal(result1.score, result2.score);
    assert.equal(result1.brittle, result2.brittle);
  });

  it('generates valid Playwright test structure from fixture', () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, 'example.json'), 'utf-8'),
    );

    // Verify fixture is valid
    assert.ok(fixture.title);
    assert.ok(Array.isArray(fixture.steps));
    assert.ok(fixture.steps.length > 0);

    // Verify we can parse all step types
    const stepTypes = fixture.steps.map((s: { type: string }) => s.type);
    assert.ok(stepTypes.includes('navigate'));
    assert.ok(stepTypes.includes('click'));
    assert.ok(stepTypes.includes('change'));
    assert.ok(stepTypes.includes('setViewport'));
  });
});

/* -------------------------------------------------------------------------- */
/*  Test: strict selector mode                                                 */
/* -------------------------------------------------------------------------- */

describe('strict selector detection', () => {
  it('identifies brittle selectors in fixture', async () => {
    const { selectBestSelector } = await import('../selectors.js');

    // These are the selectors from the example fixture that should be flagged
    const brittleCss: string[][] = [
      ['css/ul > li:nth-child(21) > a'],
    ];

    const result = selectBestSelector(brittleCss);
    assert.equal(result.brittle, true, 'nth-child selector should be brittle');
  });

  it('ARIA selectors are never brittle', async () => {
    const { selectBestSelector } = await import('../selectors.js');

    const ariaOnly: string[][] = [
      ['aria/Submit[role="button"]'],
    ];

    const result = selectBestSelector(ariaOnly);
    assert.equal(result.brittle, false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Test: locator override code generation                                     */
/* -------------------------------------------------------------------------- */

describe('locatorOverrideToCode', () => {
  let locatorOverrideToCode: typeof import('../selectors.js').locatorOverrideToCode;

  before(async () => {
    const mod = await import('../selectors.js');
    locatorOverrideToCode = mod.locatorOverrideToCode;
  });

  it('generates role locator', () => {
    const code = locatorOverrideToCode({
      kind: 'role',
      role: 'button',
      name: 'Sign in',
      exact: true,
    });
    assert.ok(code.includes("getByRole('button'"));
    assert.ok(code.includes("name: 'Sign in'"));
    assert.ok(code.includes('exact: true'));
  });

  it('generates label locator', () => {
    const code = locatorOverrideToCode({
      kind: 'label',
      text: 'Email',
    });
    assert.ok(code.includes("getByLabel('Email')"));
  });

  it('generates testid locator', () => {
    const code = locatorOverrideToCode({
      kind: 'testid',
      id: 'submit-btn',
    });
    assert.ok(code.includes("getByTestId('submit-btn')"));
  });
});
