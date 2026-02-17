import type { Page } from '@playwright/test';
import type { Action } from './actionSchema.js';

export interface Observation {
  url: string;
  title: string;
  ariaSnapshot: string;
  shortText: string;
  lastError: string | null;
  previousActions: Array<{ action: Action; success: boolean; error?: string }>;
  tickNumber: number;
}

export interface ObservationConfig {
  ariaSnapshotMaxChars: number;
  shortTextMaxChars: number;
  goalKeywords: string[];
}

const DEFAULT_CONFIG: ObservationConfig = {
  ariaSnapshotMaxChars: 8000,
  shortTextMaxChars: 2000,
  goalKeywords: [],
};

/**
 * Extract text-based observations from the page
 */
export async function collectObservation(
  page: Page,
  previousActions: Observation['previousActions'],
  tickNumber: number,
  lastError: string | null,
  config: Partial<ObservationConfig> = {}
): Promise<Observation> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  const url = page.url();
  const title = await page.title();
  
  // Get ARIA snapshot
  let ariaSnapshot: string;
  try {
    ariaSnapshot = await page.locator('body').ariaSnapshot();
  } catch (e) {
    ariaSnapshot = `[Error getting ARIA snapshot: ${e instanceof Error ? e.message : String(e)}]`;
  }
  
  // Filter and truncate ARIA snapshot if needed
  ariaSnapshot = filterAriaSnapshot(ariaSnapshot, cfg.goalKeywords, cfg.ariaSnapshotMaxChars);
  
  // Get short visible text excerpt
  let shortText: string;
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    shortText = truncateText(bodyText, cfg.shortTextMaxChars);
  } catch (e) {
    shortText = `[Error getting text: ${e instanceof Error ? e.message : String(e)}]`;
  }
  
  return {
    url,
    title,
    ariaSnapshot,
    shortText,
    lastError,
    previousActions: previousActions.slice(-5), // Keep last 5 actions for context
    tickNumber,
  };
}

/**
 * Filter ARIA snapshot to prioritize relevant content
 */
function filterAriaSnapshot(
  snapshot: string,
  keywords: string[],
  maxChars: number
): string {
  if (snapshot.length <= maxChars && keywords.length === 0) {
    return snapshot;
  }
  
  const lines = snapshot.split('\n');
  
  // If we have keywords, prioritize lines containing them
  if (keywords.length > 0) {
    const keywordLower = keywords.map(k => k.toLowerCase());
    const relevantLines: string[] = [];
    const otherLines: string[] = [];
    
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (keywordLower.some(kw => lineLower.includes(kw))) {
        relevantLines.push(line);
      } else {
        otherLines.push(line);
      }
    }
    
    // Combine: all relevant lines first, then fill with others
    let result = relevantLines.join('\n');
    let remaining = maxChars - result.length;
    
    if (remaining > 100 && otherLines.length > 0) {
      const otherText = otherLines.join('\n');
      result += '\n...\n' + otherText.slice(0, remaining - 10);
    }
    
    return result.slice(0, maxChars);
  }
  
  // No keywords: simple truncation with structure preservation
  return truncateWithStructure(snapshot, maxChars);
}

/**
 * Truncate while trying to preserve hierarchical structure
 */
function truncateWithStructure(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  
  const lines = text.split('\n');
  const result: string[] = [];
  let charCount = 0;
  
  for (const line of lines) {
    if (charCount + line.length + 1 > maxChars - 50) {
      result.push('... [truncated]');
      break;
    }
    result.push(line);
    charCount += line.length + 1;
  }
  
  return result.join('\n');
}

/**
 * Simple text truncation
 */
function truncateText(text: string, maxChars: number): string {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();
  
  if (normalized.length <= maxChars) return normalized;
  
  return normalized.slice(0, maxChars - 20) + ' ... [truncated]';
}

/**
 * Extract keywords from a goal string
 */
export function extractKeywords(goal: string): string[] {
  // Remove common words and extract potential keywords
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'click', 'type', 'enter', 'select', 'check', 'fill', 'press', 'wait',
    'then', 'after', 'before', 'when', 'if', 'that', 'this', 'it',
  ]);
  
  const words = goal
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  return [...new Set(words)];
}
