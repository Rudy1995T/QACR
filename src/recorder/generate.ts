#!/usr/bin/env tsx
/**
 * Generator: Chrome DevTools Recorder JSON → Playwright Test specs.
 *
 * Usage:  npm run gen:recordings
 *         tsx src/recorder/generate.ts
 *
 * DO NOT EDIT generated files in tests/recordings/ – re-run the generator.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import fg from 'fast-glob';
import {
  RecordingSchema,
  OverridesFileSchema,
  AssertionsFileSchema,
  type Recording,
  type OverridesFile,
  type AssertionsFile,
  type AssertionExpect,
} from './schemas.js';
import {
  selectBestSelector,
  locatorOverrideToCode,
  escapeRegex,
  type ScoredSelector,
} from './selectors.js';

/* -------------------------------------------------------------------------- */
/*  Config                                                                     */
/* -------------------------------------------------------------------------- */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDINGS_DIR = join(ROOT, 'recordings');
const OUTPUT_DIR = join(ROOT, 'tests', 'recordings');
const OVERRIDES_DIR = join(RECORDINGS_DIR, 'overrides');
const ASSERTIONS_DIR = join(RECORDINGS_DIR, 'assertions');

const STRICT_SELECTORS =
  process.env.RECORDINGS_STRICT_SELECTORS === '1' || !!process.env.CI;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function indent(code: string, level: number): string {
  const pad = '  '.repeat(level);
  return code
    .split('\n')
    .map((line) => (line.trim() ? pad + line : ''))
    .join('\n');
}

function loadYamlSidecar<T>(
  dir: string,
  recordingName: string,
  schema: { parse: (data: unknown) => T },
): T | null {
  for (const ext of ['.yaml', '.yml']) {
    const p = join(dir, recordingName + ext);
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8');
      return schema.parse(parseYaml(raw));
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Step code generators                                                       */
/* -------------------------------------------------------------------------- */

interface BrittleReport {
  recording: string;
  step: number;
  type: string;
  selector: ScoredSelector;
}

interface InvalidRecordingReport {
  file: string;
  reason: string;
}

function generateNavigateCode(step: Record<string, unknown>): string {
  const url = step.url as string;
  return `await page.goto('${url.replace(/'/g, "\\'")}');\ntry { await page.waitForLoadState('domcontentloaded'); } catch { /* timeout OK */ }`;
}

function generateClickCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const locCode = overrideCode ?? getBestLocatorCode(step);
  const lines: string[] = [];
  lines.push(`const locator = ${locCode};`);
  lines.push(`await expect(locator).toBeVisible();`);
  if (step.button === 'secondary') {
    lines.push(`await locator.click({ button: 'right' });`);
  } else {
    lines.push(`await locator.click();`);
  }
  return lines.join('\n');
}

function generateDoubleClickCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const locCode = overrideCode ?? getBestLocatorCode(step);
  const lines: string[] = [];
  lines.push(`const locator = ${locCode};`);
  lines.push(`await expect(locator).toBeVisible();`);
  lines.push(`await locator.dblclick();`);
  return lines.join('\n');
}

function generateChangeCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const locCode = overrideCode ?? getBestLocatorCode(step);
  const value = (step.value as string).replace(/'/g, "\\'");
  const lines: string[] = [];
  lines.push(`const locator = ${locCode};`);
  lines.push(`await expect(locator).toBeVisible();`);
  lines.push(`await locator.fill('${value}');`);
  return lines.join('\n');
}

function generateKeyDownCode(step: Record<string, unknown>): string {
  const key = step.key as string;
  return `await page.keyboard.down('${key}');`;
}

function generateKeyUpCode(step: Record<string, unknown>): string {
  const key = step.key as string;
  return `await page.keyboard.up('${key}');`;
}

function generateScrollCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const x = (step.x as number) ?? 0;
  const y = (step.y as number) ?? 0;
  const selectors = step.selectors as string[][] | undefined;
  if (selectors && selectors.length > 0) {
    const locCode = overrideCode ?? getBestLocatorCode(step);
    return `await ${locCode}.evaluate((el) => el.scrollBy(${x}, ${y}));`;
  }
  return `await page.mouse.wheel(${x}, ${y});`;
}

function generateHoverCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const locCode = overrideCode ?? getBestLocatorCode(step);
  const lines: string[] = [];
  lines.push(`const locator = ${locCode};`);
  lines.push(`await expect(locator).toBeVisible();`);
  lines.push(`await locator.hover();`);
  return lines.join('\n');
}

function generateSetViewportCode(step: Record<string, unknown>): string {
  const w = step.width as number;
  const h = step.height as number;
  return `await page.setViewportSize({ width: ${w}, height: ${h} });`;
}

function generateWaitForElementCode(
  step: Record<string, unknown>,
  overrideCode: string | null,
): string {
  const locCode = overrideCode ?? getBestLocatorCode(step);
  return `await expect(${locCode}).toBeVisible();`;
}

function generateWaitForExpressionCode(
  step: Record<string, unknown>,
): string {
  const expr = (step.expression as string).replace(/'/g, "\\'");
  return `await page.waitForFunction('${expr}');`;
}

function generateCustomStepCode(step: Record<string, unknown>): string {
  const name = step.name as string;
  return `// Custom step: ${name}`;
}

function getBestLocatorCode(step: Record<string, unknown>): string {
  const selectors = step.selectors as string[][] | undefined;
  if (!selectors || selectors.length === 0) return "page.locator('body')";
  return selectBestSelector(selectors).code;
}

function getBestScoredSelector(
  step: Record<string, unknown>,
): ScoredSelector | null {
  const selectors = step.selectors as string[][] | undefined;
  if (!selectors || selectors.length === 0) return null;
  return selectBestSelector(selectors);
}

function isHarExport(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const log = obj.log;
  return (
    !!log &&
    typeof log === 'object' &&
    Array.isArray((log as Record<string, unknown>).entries)
  );
}

function summarizeParseIssues(
  issues: Array<{ path: (string | number)[]; message: string }>,
): string {
  return issues
    .slice(0, 2)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/* -------------------------------------------------------------------------- */
/*  Assertion code generation                                                  */
/* -------------------------------------------------------------------------- */

function generateAssertionCode(exp: AssertionExpect): string {
  switch (exp.type) {
    case 'url_contains':
      return `await expect(page).toHaveURL(new RegExp('${escapeRegex(exp.value)}'));`;
    case 'visible_text':
      return `await expect(page.getByText('${exp.value.replace(/'/g, "\\'")}', { exact: false }).first()).toBeVisible();`;
    case 'role_visible': {
      const role = exp.role ?? 'button';
      const opts: string[] = [];
      if (exp.name) opts.push(`name: '${exp.name.replace(/'/g, "\\'")}'`);
      if (exp.exact != null) opts.push(`exact: ${exp.exact}`);
      const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
      return `await expect(page.getByRole('${role}'${optsStr})).toBeVisible();`;
    }
    default:
      return `// Unknown assertion type: ${(exp as AssertionExpect).type}`;
  }
}

/* -------------------------------------------------------------------------- */
/*  Main generator                                                             */
/* -------------------------------------------------------------------------- */

export interface GenerateResult {
  filesWritten: string[];
  brittleSelectors: BrittleReport[];
}

export function generate(): GenerateResult {
  // 1. Discover recording JSON files
  const pattern = join(RECORDINGS_DIR, '**/*.json').replace(/\\/g, '/');
  const allJson = fg.sync(pattern, { absolute: true }).sort();

  // Filter out assertion and override dirs
  const recordingFiles = allJson.filter((f) => {
    const rel = relative(RECORDINGS_DIR, f);
    return (
      !rel.startsWith('assertions') &&
      !rel.startsWith('overrides') &&
      !rel.includes('node_modules')
    );
  });

  if (recordingFiles.length === 0) {
    console.log(`ℹ  No recording JSON files found in ${relative(ROOT, RECORDINGS_DIR)}`);
    return { filesWritten: [], brittleSelectors: [] };
  }

  // Ensure output dir
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const filesWritten: string[] = [];
  const brittleSelectors: BrittleReport[] = [];
  const invalidRecordings: InvalidRecordingReport[] = [];

  for (const filePath of recordingFiles) {
    const raw = readFileSync(filePath, 'utf-8');
    const relFilePath = relative(ROOT, filePath);
    let json: unknown;

    try {
      json = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      invalidRecordings.push({
        file: relFilePath,
        reason: `invalid JSON (${msg})`,
      });
      continue;
    }

    const parsed = RecordingSchema.safeParse(json);
    if (!parsed.success) {
      if (isHarExport(json)) {
        invalidRecordings.push({
          file: relFilePath,
          reason:
            'HAR detected (Network export). Expected DevTools Recorder JSON with top-level "title" and "steps".',
        });
      } else {
        invalidRecordings.push({
          file: relFilePath,
          reason: `schema mismatch (${summarizeParseIssues(parsed.error.issues)})`,
        });
      }
      continue;
    }

    const recording = parsed.data;
    const recordingName = sanitizeFilename(recording.title);

    // Load sidecars
    const overrides = loadYamlSidecar(
      OVERRIDES_DIR,
      recordingName,
      OverridesFileSchema,
    );
    const assertions = loadYamlSidecar(
      ASSERTIONS_DIR,
      recordingName,
      AssertionsFileSchema,
    );

    // Build override lookup: step index → override locator code
    const overrideMap = new Map<string, string>();
    if (overrides) {
      for (const o of overrides.overrides) {
        const key = `${o.step}:${o.action}`;
        overrideMap.set(key, locatorOverrideToCode(o.locator));
      }
    }

    // Build assertion lookup: afterStep → assertions
    const assertionMap = new Map<number, AssertionExpect[]>();
    if (assertions) {
      for (const a of assertions.assertions) {
        assertionMap.set(a.afterStep, a.expect);
      }
    }

    // Generate spec lines
    const specLines: string[] = [];
    specLines.push(
      '// DO NOT EDIT — auto-generated by npm run gen:recordings',
    );
    specLines.push(
      "import { test, expect } from '@playwright/test';",
    );
    specLines.push('');
    specLines.push(
      `test('${recording.title.replace(/'/g, "\\'")}', async ({ page }) => {`,
    );

    let stepIndex = 0;
    for (const rawStep of recording.steps) {
      const type = rawStep.type as string;
      const overrideKey = `${stepIndex}:${type}`;
      const overrideCode = overrideMap.get(overrideKey) ?? null;

      // Track brittle selectors
      if (!overrideCode) {
        const scored = getBestScoredSelector(rawStep as Record<string, unknown>);
        if (scored?.brittle) {
          brittleSelectors.push({
            recording: recording.title,
            step: stepIndex,
            type,
            selector: scored,
          });
        }
      }

      let stepCode: string;
      switch (type) {
        case 'navigate':
          stepCode = generateNavigateCode(rawStep);
          break;
        case 'click':
          stepCode = generateClickCode(rawStep, overrideCode);
          break;
        case 'doubleClick':
          stepCode = generateDoubleClickCode(rawStep, overrideCode);
          break;
        case 'change':
          stepCode = generateChangeCode(rawStep, overrideCode);
          break;
        case 'keyDown':
          stepCode = generateKeyDownCode(rawStep);
          break;
        case 'keyUp':
          stepCode = generateKeyUpCode(rawStep);
          break;
        case 'scroll':
          stepCode = generateScrollCode(rawStep, overrideCode);
          break;
        case 'hover':
          stepCode = generateHoverCode(rawStep, overrideCode);
          break;
        case 'setViewport':
          stepCode = generateSetViewportCode(rawStep);
          break;
        case 'waitForElement':
          stepCode = generateWaitForElementCode(rawStep, overrideCode);
          break;
        case 'waitForExpression':
          stepCode = generateWaitForExpressionCode(rawStep);
          break;
        case 'customStep':
          stepCode = generateCustomStepCode(rawStep);
          break;
        default:
          stepCode = `// Unsupported step type: ${type}`;
      }

      specLines.push(
        `  await test.step('step ${stepIndex}: ${type}', async () => {`,
      );
      specLines.push(indent(stepCode, 2));
      specLines.push('  });');
      specLines.push('');

      // Inject assertions after this step
      const stepAssertions = assertionMap.get(stepIndex);
      if (stepAssertions) {
        specLines.push(
          `  await test.step('assert after step ${stepIndex}', async () => {`,
        );
        for (const exp of stepAssertions) {
          specLines.push(indent(generateAssertionCode(exp), 2));
        }
        specLines.push('  });');
        specLines.push('');
      }

      stepIndex++;
    }

    specLines.push('});');
    specLines.push('');

    const outPath = join(OUTPUT_DIR, `${recordingName}.spec.ts`);
    writeFileSync(outPath, specLines.join('\n'), 'utf-8');
    filesWritten.push(outPath);
    console.log(`✓ ${relative(ROOT, outPath)}`);
  }

  if (filesWritten.length === 0 && invalidRecordings.length > 0) {
    const badCount = invalidRecordings.length;
    const noun = badCount === 1 ? 'file' : 'files';
    throw new Error(
      [
        `No valid DevTools Recorder JSON files found in ${relative(ROOT, RECORDINGS_DIR)}.`,
        `Rejected ${badCount} ${noun}:`,
        ...invalidRecordings.map((r) => `- ${r.file}: ${r.reason}`),
        'Export from Chrome DevTools -> Recorder -> Export as JSON.',
      ].join('\n'),
    );
  }

  // Report brittle selectors
  if (brittleSelectors.length > 0) {
    console.log('');
    console.log('⚠  Brittle selectors detected:');
    for (const b of brittleSelectors) {
      console.log(
        `   → ${b.recording} step ${b.step} (${b.type}): ${b.selector.reason} — "${b.selector.raw}"`,
      );
      console.log(
        `     Fix: add override in recordings/overrides/${sanitizeFilename(b.recording)}.yaml`,
      );
    }
    console.log('');

    if (STRICT_SELECTORS) {
      console.error(
        '✗  RECORDINGS_STRICT_SELECTORS is enabled — failing due to brittle selectors.',
      );
      console.error(
        '   Add selector overrides for the steps listed above.',
      );
      process.exit(1);
    }
  }

  console.log(`\n✓ Generated ${filesWritten.length} spec file(s)`);
  return { filesWritten, brittleSelectors };
}

/* -------------------------------------------------------------------------- */
/*  CLI entry point                                                            */
/* -------------------------------------------------------------------------- */

// Only run when executed directly (not imported)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('generate.ts') ||
    process.argv[1].endsWith('generate.js'));

if (isDirectRun) {
  try {
    generate();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
}
