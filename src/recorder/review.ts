#!/usr/bin/env tsx
/**
 * LLM-assisted selector override reviewer.
 *
 * Reads one DevTools Recorder JSON file plus a Playwright failure context and
 * asks the configured LLM to propose robust locator overrides. The output is
 * validated against OverridesFileSchema and written to:
 *   recordings/overrides/<recording-name>.yaml
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import fg from 'fast-glob';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import 'dotenv/config';
import { createProvider } from '../llm/index.js';
import {
  OverridesFileSchema,
  RecordingSchema,
  type OverridesFile,
  type Recording,
} from './schemas.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORDINGS_DIR = join(ROOT, 'recordings');
const OVERRIDES_DIR = join(RECORDINGS_DIR, 'overrides');
const TEST_RESULTS_DIR = join(ROOT, 'test-results');

type OverrideEntry = OverridesFile['overrides'][number];

export interface ReviewOptions {
  recording?: string;
  context?: string;
  model?: string;
  dryRun?: boolean;
}

export interface ReviewResult {
  recordingPath: string;
  contextPath: string;
  outputPath: string;
  proposedOverrideCount: number;
  totalOverrideCount: number;
  dryRun: boolean;
}

function sanitizeFilename(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function summarizeParseIssues(
  issues: Array<{ path: (string | number)[]; message: string }>,
): string {
  return issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function listRecordingFiles(): string[] {
  const pattern = join(RECORDINGS_DIR, '**/*.json').replace(/\\/g, '/');
  const allJson = fg.sync(pattern, { absolute: true }).sort();
  return allJson.filter((f) => {
    const rel = relative(RECORDINGS_DIR, f);
    return (
      !rel.startsWith('assertions') &&
      !rel.startsWith('overrides') &&
      !rel.includes('node_modules')
    );
  });
}

function loadRecording(filePath: string): Recording {
  const raw = readFileSync(filePath, 'utf-8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid recording JSON in ${relative(ROOT, filePath)}: ${msg}`);
  }

  const parsed = RecordingSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `Recording schema mismatch in ${relative(ROOT, filePath)}: ${summarizeParseIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

function resolveRecordingPath(recordingArg?: string): string {
  const files = listRecordingFiles();
  if (files.length === 0) {
    throw new Error(`No recording JSON files found in ${relative(ROOT, RECORDINGS_DIR)}.`);
  }

  if (!recordingArg) {
    if (files.length === 1) return files[0]!;
    const options = files.map((f) => `- ${relative(ROOT, f)}`).join('\n');
    throw new Error(
      `Multiple recordings found. Pass --recording.\n${options}`,
    );
  }

  const directCandidates = [
    recordingArg,
    resolve(process.cwd(), recordingArg),
    resolve(ROOT, recordingArg),
  ];
  for (const candidate of directCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  const query = recordingArg.toLowerCase();
  const querySlug = sanitizeFilename(recordingArg);

  for (const file of files) {
    const base = basename(file, '.json').toLowerCase();
    if (base === query || sanitizeFilename(base) === querySlug) {
      return file;
    }
  }

  for (const file of files) {
    const recording = loadRecording(file);
    if (
      recording.title.toLowerCase() === query ||
      sanitizeFilename(recording.title) === querySlug
    ) {
      return file;
    }
  }

  throw new Error(`Could not resolve recording "${recordingArg}".`);
}

function resolveContextPath(contextArg?: string): string {
  if (contextArg) {
    const directCandidates = [
      contextArg,
      resolve(process.cwd(), contextArg),
      resolve(ROOT, contextArg),
    ];
    for (const candidate of directCandidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`Could not find context file "${contextArg}".`);
  }

  const pattern = join(TEST_RESULTS_DIR, '**/error-context.md').replace(/\\/g, '/');
  const contexts = fg.sync(pattern, { absolute: true });
  if (contexts.length === 0) {
    throw new Error(
      `No error-context.md files found in ${relative(ROOT, TEST_RESULTS_DIR)}. Run tests first or pass --context.`,
    );
  }

  contexts.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return contexts[0]!;
}

function loadExistingOverrides(path: string): OverridesFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  const parsedYaml = parseYaml(raw);
  const parsed = OverridesFileSchema.safeParse(parsedYaml);
  if (!parsed.success) {
    throw new Error(
      `Invalid overrides YAML in ${relative(ROOT, path)}: ${summarizeParseIssues(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1]!, text] : [text];

  for (const candidate of candidates) {
    const objectMatch = candidate.match(/\{[\s\S]*\}/);
    if (!objectMatch) continue;
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Keep trying other candidate forms.
    }
  }

  throw new Error(`No parseable JSON object found in LLM response: ${text.slice(0, 200)}`);
}

export function parseReviewResponse(raw: string): OverridesFile {
  const extracted = extractJsonObject(raw);
  const normalized = normalizeOverridesPayload(extracted);
  const parsed = OverridesFileSchema.safeParse(normalized);
  if (!parsed.success) {
    const preview = raw.replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(
      `LLM response failed OverridesFileSchema validation: ${summarizeParseIssues(parsed.error.issues)} | preview: ${preview}`,
    );
  }
  return parsed.data;
}

export function validateOverridesAgainstRecording(
  overrides: OverridesFile,
  recording: Recording,
): void {
  const issues: string[] = [];

  for (const entry of overrides.overrides) {
    if (entry.step < 0 || entry.step >= recording.steps.length) {
      issues.push(
        `step ${entry.step}:${entry.action} is out of range (recording has ${recording.steps.length} steps)`,
      );
      continue;
    }

    const step = recording.steps[entry.step] as Record<string, unknown> | undefined;
    const stepType = typeof step?.type === 'string' ? step.type : null;
    if (!stepType) {
      issues.push(`recording step ${entry.step} has no valid "type" field`);
      continue;
    }

    if (stepType !== entry.action) {
      issues.push(
        `step ${entry.step} action mismatch: override uses "${entry.action}" but recording step type is "${stepType}"`,
      );
    }
  }

  if (issues.length > 0) {
    throw new Error(`Override validation failed: ${issues.join('; ')}`);
  }
}

export function mergeOverrideEntries(
  existing: OverrideEntry[],
  proposed: OverrideEntry[],
): OverrideEntry[] {
  const merged = new Map<string, OverrideEntry>();
  for (const entry of existing) {
    merged.set(`${entry.step}:${entry.action}`, entry);
  }
  for (const entry of proposed) {
    merged.set(`${entry.step}:${entry.action}`, entry);
  }
  return [...merged.values()].sort(
    (a, b) => a.step - b.step || a.action.localeCompare(b.action),
  );
}

function normalizeOverridesPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return { overrides: payload };
  }

  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const obj = payload as Record<string, unknown>;
  const resultObj =
    obj.result && typeof obj.result === 'object'
      ? (obj.result as Record<string, unknown>)
      : null;
  const dataObj =
    obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : null;

  const candidates: unknown[] = [
    obj.overrides,
    obj.suggested_overrides,
    obj.overrideSuggestions,
    obj.recommendations,
    resultObj?.overrides,
    dataObj?.overrides,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return { overrides: candidate };
    }
  }

  return payload;
}

function parseAriaSelector(selector: string): { name: string; role?: string } | null {
  const match = selector.match(/^aria\/(.+?)(?:\[role="([^"]+)"\])?$/);
  if (!match) return null;
  const name = match[1]?.trim();
  const role = match[2]?.trim();
  if (!name) return null;
  return role ? { name, role } : { name };
}

function flattenStepSelectors(step: Record<string, unknown>): string[] {
  const selectors = step.selectors;
  if (!Array.isArray(selectors)) return [];
  const out: string[] = [];
  for (const alt of selectors) {
    if (Array.isArray(alt) && typeof alt[0] === 'string') {
      out.push(alt[0]);
    } else if (typeof alt === 'string') {
      out.push(alt);
    }
  }
  return out;
}

function extractRoleCandidatesFromContext(
  context: string,
): Array<{ role: string; name: string }> {
  const matches = [...context.matchAll(/-\s+([a-zA-Z][\w-]*)\s+"([^"]+)"/g)];
  return matches.map((m) => ({
    role: m[1]!.toLowerCase(),
    name: m[2]!.trim(),
  }));
}

function findLikelyStepIndexFromContext(
  recording: Recording,
  errorContext: string,
): number | null {
  const roleCandidates = extractRoleCandidatesFromContext(errorContext);
  if (roleCandidates.length === 0) return null;

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < recording.steps.length; i++) {
    const step = recording.steps[i] as Record<string, unknown>;
    const stepType = typeof step.type === 'string' ? step.type : '';
    const selectors = flattenStepSelectors(step);
    const lowerSelectors = selectors.map((s) => s.toLowerCase());

    let score = 0;
    if (stepType === 'click' || stepType === 'doubleClick' || stepType === 'hover') {
      score += 2;
    }

    for (const candidate of roleCandidates) {
      const nameLower = candidate.name.toLowerCase();
      for (const selector of selectors) {
        const aria = parseAriaSelector(selector);
        if (aria) {
          if (aria.name.toLowerCase() === nameLower) score += 12;
          if (aria.role && aria.role.toLowerCase() === candidate.role) score += 6;
        }
      }

      if (lowerSelectors.some((s) => s.includes(nameLower))) {
        score += 4;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore > 0 ? bestIndex : null;
}

function inferLocatorFromFailure(
  stepType: string,
  selectors: string[],
  context: string,
): OverrideEntry['locator'] | null {
  const ariaCandidates = selectors
    .filter((s) => s.startsWith('aria/'))
    .map((s) => parseAriaSelector(s))
    .filter((v): v is { name: string; role?: string } => !!v);

  const roleCandidates = extractRoleCandidatesFromContext(context);
  const clickableRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option']);
  const formRoles = new Set(['textbox', 'combobox', 'spinbutton', 'searchbox']);

  if (stepType === 'click' || stepType === 'doubleClick' || stepType === 'hover') {
    const ariaNames = new Set(ariaCandidates.map((c) => c.name.toLowerCase()));
    const matchingByName = roleCandidates.find(
      (c) => clickableRoles.has(c.role) && ariaNames.has(c.name.toLowerCase()),
    );
    if (matchingByName) {
      return {
        kind: 'role',
        role: matchingByName.role,
        name: matchingByName.name,
        exact: true,
      };
    }

    const fromContext = roleCandidates.find((c) => clickableRoles.has(c.role));
    if (fromContext) {
      return {
        kind: 'role',
        role: fromContext.role,
        name: fromContext.name,
        exact: true,
      };
    }

    const withRole = ariaCandidates.find((c) => !!c.role);
    if (withRole?.role) {
      return {
        kind: 'role',
        role: withRole.role,
        name: withRole.name,
        exact: true,
      };
    }

    const withName = ariaCandidates.find((c) => c.name.length > 0);
    if (withName) {
      return {
        kind: 'role',
        role: 'button',
        name: withName.name,
        exact: true,
      };
    }
  }

  if (stepType === 'change') {
    const fromContext = roleCandidates.find((c) => formRoles.has(c.role));
    if (fromContext) {
      return {
        kind: 'role',
        role: fromContext.role,
        name: fromContext.name,
        exact: true,
      };
    }

    const withName = ariaCandidates.find((c) => c.name.length > 0);
    if (withName) {
      return {
        kind: 'label',
        text: withName.name,
      };
    }
  }

  if (stepType === 'waitForElement') {
    const fromContext = roleCandidates.find((c) => c.name.length > 0);
    if (fromContext) {
      return {
        kind: 'role',
        role: fromContext.role,
        name: fromContext.name,
        exact: true,
      };
    }
  }

  return null;
}

export function suggestOverridesFromFailureContext(
  recording: Recording,
  errorContext: string,
): OverridesFile {
  const stepMatch = errorContext.match(/step\s+(\d+):\s*([a-zA-Z]+)/i);
  const stepIndex = stepMatch
    ? Number.parseInt(stepMatch[1]!, 10)
    : findLikelyStepIndexFromContext(recording, errorContext);
  if (stepIndex == null) return { overrides: [] };

  if (!Number.isFinite(stepIndex) || stepIndex < 0 || stepIndex >= recording.steps.length) {
    return { overrides: [] };
  }

  const step = recording.steps[stepIndex] as Record<string, unknown>;
  const stepType = typeof step.type === 'string' ? step.type : null;
  if (!stepType) return { overrides: [] };

  const selectors = flattenStepSelectors(step);
  const locator = inferLocatorFromFailure(stepType, selectors, errorContext);
  if (!locator) return { overrides: [] };

  const proposal: OverridesFile = {
    overrides: [
      {
        step: stepIndex,
        action: stepType,
        locator,
      },
    ],
  };

  return OverridesFileSchema.parse(proposal);
}

function buildStepDigest(recording: Recording): string {
  return recording.steps
    .map((rawStep, index) => {
      const step = rawStep as Record<string, unknown>;
      const type = typeof step.type === 'string' ? step.type : 'unknown';
      const selectors = Array.isArray(step.selectors)
        ? JSON.stringify(step.selectors)
        : 'none';
      return `${index}. type=${type} selectors=${selectors}`;
    })
    .join('\n');
}

function buildPrompt(
  recordingPath: string,
  recording: Recording,
  contextPath: string,
  errorContext: string,
  existing: OverridesFile | null,
): string {
  const systemPrompt = [
    'You are a Playwright selector reviewer.',
    'Return only a single JSON object with this exact shape:',
    '{"overrides":[{"step":number,"action":string,"locator":{"kind":"role|label|text|testid|css","role?":string,"name?":string,"exact?":boolean,"text?":string,"id?":string,"selector?":string}}]}',
    'Rules:',
    '- step is zero-based index from the recording.',
    '- action must exactly equal the recording step type.',
    '- include only overrides needed to make selectors robust.',
    '- prefer role/testid/label/text locators; use css only as last resort.',
    '- for clickable controls like Login button, prefer role locators with stable name.',
    '- do not include markdown, explanation text, comments, or extra top-level keys.',
  ].join('\n');

  const maxContextChars = 16000;
  const clippedContext =
    errorContext.length > maxContextChars
      ? `${errorContext.slice(0, maxContextChars)}\n...[truncated]`
      : errorContext;

  const userPrompt = [
    `Recording path: ${relative(ROOT, recordingPath)}`,
    `Recording title: ${recording.title}`,
    `Failure context path: ${relative(ROOT, contextPath)}`,
    '',
    'Failure context:',
    clippedContext,
    '',
    'Recording step digest:',
    buildStepDigest(recording),
    '',
    'Recording JSON:',
    JSON.stringify(recording, null, 2),
    '',
    'Existing overrides JSON:',
    JSON.stringify(existing ?? { overrides: [] }, null, 2),
  ].join('\n');

  return `${systemPrompt}\n\n${userPrompt}`;
}

function formatYaml(file: OverridesFile): string {
  const yaml = stringifyYaml(file);
  return yaml.endsWith('\n') ? yaml : `${yaml}\n`;
}

function parseArgs(argv: string[]): ReviewOptions {
  const options: ReviewOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--recording':
        options.recording = argv[++i];
        if (!options.recording) throw new Error('Missing value for --recording');
        break;
      case '--context':
        options.context = argv[++i];
        if (!options.context) throw new Error('Missing value for --context');
        break;
      case '--model':
        options.model = argv[++i];
        if (!options.model) throw new Error('Missing value for --model');
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log('Usage: npm run review:recordings -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --recording <path|name>   Recording JSON path, file name, title, or slug');
  console.log('  --context <path>          Playwright error-context.md path');
  console.log('  --model <name>            Override LLM model');
  console.log('  --dry-run                 Print YAML without writing file');
  console.log('  --help                    Show this message');
  console.log('');
  console.log('Defaults:');
  console.log('  recording: auto (only if exactly one recording exists)');
  console.log('  context: latest test-results/**/error-context.md');
}

export async function reviewRecording(options: ReviewOptions = {}): Promise<ReviewResult> {
  const recordingPath = resolveRecordingPath(options.recording);
  const contextPath = resolveContextPath(options.context);

  const recording = loadRecording(recordingPath);
  const errorContext = readFileSync(contextPath, 'utf-8');

  const recordingName = sanitizeFilename(recording.title);
  const outputPath = join(OVERRIDES_DIR, `${recordingName}.yaml`);
  const existingOverrides = loadExistingOverrides(outputPath);

  const llm = createProvider({
    model: options.model,
    temperature: 0,
  });

  const prompt = buildPrompt(
    recordingPath,
    recording,
    contextPath,
    errorContext,
    existingOverrides,
  );

  let proposed: OverridesFile;
  try {
    const raw = await llm.generateAction(prompt);
    proposed = parseReviewResponse(raw);
    validateOverridesAgainstRecording(proposed, recording);
  } catch (err) {
    const fallback = suggestOverridesFromFailureContext(recording, errorContext);
    if (fallback.overrides.length === 0) {
      throw err;
    }
    proposed = fallback;
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`warn LLM review unavailable (${reason}); using heuristic override inferred from failure context`);
  }

  if (proposed.overrides.length === 0) {
    const fallback = suggestOverridesFromFailureContext(recording, errorContext);
    if (fallback.overrides.length > 0) {
      proposed = fallback;
      console.warn('warn LLM returned no overrides; using heuristic override inferred from failure context');
    }
  }

  const mergedOverrides = mergeOverrideEntries(
    existingOverrides?.overrides ?? [],
    proposed.overrides,
  );
  const mergedFile = OverridesFileSchema.parse({ overrides: mergedOverrides });
  validateOverridesAgainstRecording(mergedFile, recording);

  if (options.dryRun) {
    console.log(formatYaml(mergedFile));
  } else {
    mkdirSync(OVERRIDES_DIR, { recursive: true });
    writeFileSync(outputPath, formatYaml(mergedFile), 'utf-8');
    console.log(`ok wrote ${relative(ROOT, outputPath)}`);
  }

  return {
    recordingPath,
    contextPath,
    outputPath,
    proposedOverrideCount: proposed.overrides.length,
    totalOverrideCount: mergedFile.overrides.length,
    dryRun: !!options.dryRun,
  };
}

async function runFromCli(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await reviewRecording(options);
  const out = relative(ROOT, result.outputPath);
  const mode = result.dryRun ? 'dry-run' : 'written';
  console.log(
    `ok review completed (${mode}): ${result.proposedOverrideCount} proposed, ${result.totalOverrideCount} total -> ${out}`,
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('review.ts') || process.argv[1].endsWith('review.js'));

if (isDirectRun) {
  runFromCli().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`x ${msg}`);
    process.exit(1);
  });
}
