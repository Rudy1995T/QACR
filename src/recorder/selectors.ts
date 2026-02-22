/**
 * Selector scoring and Playwright locator code generation.
 *
 * Chrome DevTools Recorder exports a `selectors` array where each element is
 * an array of strings (one per frame depth).  For most interactions the inner
 * array has exactly one entry.
 *
 * This module picks the *best* alternative and converts it to Playwright
 * locator source code.
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ScoredSelector {
  /** Playwright TS expression (e.g. `page.getByRole('button', { name: 'OK' })`) */
  code: string;
  /** Numeric score – higher is better */
  score: number;
  /** Original raw selector string */
  raw: string;
  /** True if the selector is considered "brittle" */
  brittle: boolean;
  /** Human-readable reason for the score */
  reason: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const GENERATED_TOKEN_RE =
  /(?:[a-z]{1,3}[A-Z][a-zA-Z0-9]{6,}|[a-f0-9]{8,}|_[a-zA-Z0-9]{5,}_|css-[a-z0-9]{5,}|sc-[a-zA-Z]{4,}|styled-[a-z])/;

function looksGenerated(token: string): boolean {
  return GENERATED_TOKEN_RE.test(token);
}

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------------------------------------------------------------- */
/*  ARIA selector → Playwright locator                                         */
/* -------------------------------------------------------------------------- */

/**
 * DevTools ARIA selectors look like `aria/Sign in[role="button"]` or
 * `aria/Email`.
 */
function parseAriaSelector(raw: string): ScoredSelector | null {
  // Format: aria/<name>[role="<role>"] or aria/<name>
  const match = raw.match(/^aria\/(.+?)(?:\[role="([^"]+)"\])?$/);
  if (!match) return null;
  const [, name, role] = match;
  const cleanName = name!.trim();

  if (role) {
    const code = `page.getByRole('${escapeString(role)}', { name: '${escapeString(cleanName)}' })`;
    return { code, score: 100, raw, brittle: false, reason: 'ARIA role+name' };
  }

  // No explicit role – use getByLabel as a reasonable fallback
  const code = `page.getByLabel('${escapeString(cleanName)}')`;
  return { code, score: 90, raw, brittle: false, reason: 'ARIA label' };
}

/* -------------------------------------------------------------------------- */
/*  Text selector → Playwright locator                                         */
/* -------------------------------------------------------------------------- */

function parseTextSelector(raw: string): ScoredSelector | null {
  const match = raw.match(/^text\/(.+)$/);
  if (!match) return null;
  const text = match[1]!.trim();
  const code = `page.getByText('${escapeString(text)}', { exact: true })`;
  return { code, score: 80, raw, brittle: false, reason: 'text content' };
}

/* -------------------------------------------------------------------------- */
/*  XPath selector                                                             */
/* -------------------------------------------------------------------------- */

function parseXpathSelector(raw: string): ScoredSelector | null {
  const match = raw.match(/^xpath\/(.+)$/);
  if (!match) return null;
  const xpath = match[1]!;
  const code = `page.locator('xpath=${escapeString(xpath)}')`;
  return { code, score: 20, raw, brittle: true, reason: 'XPath (brittle)' };
}

/* -------------------------------------------------------------------------- */
/*  CSS selector → Playwright locator                                          */
/* -------------------------------------------------------------------------- */

function scoreCssSelector(raw: string): ScoredSelector {
  let score = 60;
  let brittle = false;
  const reasons: string[] = [];

  // Strip DevTools prefix if present
  const css = raw.startsWith('css/') ? raw.slice(4) : raw;

  // ---- Bonus: simple #id ------------------------------------------------
  const idMatch = css.match(/^#([\w-]+)$/);
  if (idMatch) {
    const code = `page.locator('#${escapeString(idMatch[1]!)}')`;
    return { code, score: 70, raw, brittle: false, reason: 'stable #id' };
  }

  // ---- Bonus: data-testid / data-test / data-cy -------------------------
  const tidMatch = css.match(
    /^\[data-(?:testid|test-id|test|cy)=["']?([^"'\]]+)["']?\]$/,
  );
  if (tidMatch) {
    const code = `page.getByTestId('${escapeString(tidMatch[1]!)}')`;
    return { code, score: 85, raw, brittle: false, reason: 'data-testid' };
  }

  // ---- Penalize: nth-child / nth-of-type ---------------------------------
  if (/nth-(?:child|of-type)/.test(css)) {
    score -= 25;
    brittle = true;
    reasons.push('nth-child/nth-of-type');
  }

  // ---- Penalize: long chains (>3 combinators) ----------------------------
  const combinators = (css.match(/\s*[>\s+~]\s*/g) ?? []).length;
  if (combinators > 3) {
    score -= 10 * (combinators - 3);
    brittle = true;
    reasons.push(`long chain (${combinators} combinators)`);
  }

  // ---- Penalize: many class names ----------------------------------------
  const classCount = (css.match(/\./g) ?? []).length;
  if (classCount > 3) {
    score -= 5 * (classCount - 3);
    brittle = true;
    reasons.push(`many classes (${classCount})`);
  }

  // ---- Penalize: generated-looking tokens --------------------------------
  if (looksGenerated(css)) {
    score -= 20;
    brittle = true;
    reasons.push('generated-looking token');
  }

  score = Math.max(0, score);
  const code = `page.locator('${escapeString(css)}')`;
  const reason = reasons.length
    ? `CSS (${reasons.join(', ')})`
    : 'CSS selector';
  return { code, score, raw, brittle, reason };
}

/* -------------------------------------------------------------------------- */
/*  Parse any single selector string                                           */
/* -------------------------------------------------------------------------- */

function parseSelector(raw: string): ScoredSelector {
  const trimmed = raw.trim();

  // 1. ARIA
  if (trimmed.startsWith('aria/')) {
    const result = parseAriaSelector(trimmed);
    if (result) return result;
  }

  // 2. Text
  if (trimmed.startsWith('text/')) {
    const result = parseTextSelector(trimmed);
    if (result) return result;
  }

  // 3. XPath
  if (trimmed.startsWith('xpath/')) {
    const result = parseXpathSelector(trimmed);
    if (result) return result;
  }

  // 4. Pierce (shadow DOM) – treat as CSS
  if (trimmed.startsWith('pierce/')) {
    return scoreCssSelector(trimmed.slice(7));
  }

  // 5. Plain CSS (possibly with css/ prefix)
  return scoreCssSelector(trimmed);
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Given the `selectors` array from a DevTools Recorder step (array of
 * selector alternatives, each of which is an array of strings for frame
 * nesting), pick the best one and return Playwright locator code.
 *
 * Returns the best `ScoredSelector`.
 */
export function selectBestSelector(
  selectors: string[][],
): ScoredSelector {
  const candidates: ScoredSelector[] = [];

  for (const alt of selectors) {
    // For now we only handle top-level (first frame).
    // Multi-frame nesting would require frameLocator chaining.
    if (alt.length === 0) continue;
    const primary = alt[0]!;
    candidates.push(parseSelector(primary));
  }

  if (candidates.length === 0) {
    return {
      code: "page.locator('body')",
      score: 0,
      raw: 'body',
      brittle: true,
      reason: 'no selectors provided',
    };
  }

  // Sort descending by score, stable order for ties (first wins)
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!;
}

/**
 * Generate locator code from a LocatorOverride (from YAML sidecar).
 */
export function locatorOverrideToCode(
  override: { kind: string; role?: string; name?: string; exact?: boolean; selector?: string; text?: string; id?: string },
): string {
  switch (override.kind) {
    case 'role': {
      const opts: string[] = [];
      if (override.name != null) opts.push(`name: '${escapeString(override.name)}'`);
      if (override.exact != null) opts.push(`exact: ${override.exact}`);
      const optsStr = opts.length ? `, { ${opts.join(', ')} }` : '';
      return `page.getByRole('${escapeString(override.role ?? 'button')}'${optsStr})`;
    }
    case 'label':
      return `page.getByLabel('${escapeString(override.text ?? override.name ?? '')}')`;
    case 'text':
      return `page.getByText('${escapeString(override.text ?? override.name ?? '')}', { exact: true })`;
    case 'testid':
      return `page.getByTestId('${escapeString(override.id ?? '')}')`;
    case 'css':
      return `page.locator('${escapeString(override.selector ?? '')}')`;
    default:
      return `page.locator('${escapeString(override.selector ?? 'body')}')`;
  }
}

export { escapeRegex };
