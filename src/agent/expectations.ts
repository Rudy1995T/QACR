import type { Page } from '@playwright/test';
import type { LocatorSpec } from './actionSchema.js';
import { locatorFromSpec } from './locator.js';

export interface Expectation {
  type: 'url_contains' | 'visible_text' | 'locator_visible';
  value: string;
  locator?: LocatorSpec;
}

export interface ExpectationResult {
  expectation: Expectation;
  passed: boolean;
  error?: string;
}

/**
 * Evaluate a single expectation
 */
export async function evaluateExpectation(
  page: Page,
  expectation: Expectation,
  timeout: number = 3000
): Promise<ExpectationResult> {
  try {
    switch (expectation.type) {
      case 'url_contains': {
        const currentUrl = page.url();
        const passed = currentUrl.includes(expectation.value);
        return {
          expectation,
          passed,
          error: passed ? undefined : `URL "${currentUrl}" does not contain "${expectation.value}"`,
        };
      }
      
      case 'visible_text': {
        try {
          const locator = page.getByText(expectation.value, { exact: false });
          const isVisible = await locator.first().isVisible({ timeout });
          return {
            expectation,
            passed: isVisible,
            error: isVisible ? undefined : `Text "${expectation.value}" not visible`,
          };
        } catch (e) {
          return {
            expectation,
            passed: false,
            error: `Text "${expectation.value}" not found: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }
      
      case 'locator_visible': {
        try {
          let locator;
          if (expectation.locator) {
            locator = locatorFromSpec(page, expectation.locator);
          } else {
            // Treat value as text to find
            locator = page.getByText(expectation.value, { exact: false });
          }
          const isVisible = await locator.first().isVisible({ timeout });
          return {
            expectation,
            passed: isVisible,
            error: isVisible ? undefined : `Locator not visible`,
          };
        } catch (e) {
          return {
            expectation,
            passed: false,
            error: `Locator check failed: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      }
      
      default:
        return {
          expectation,
          passed: false,
          error: `Unknown expectation type: ${(expectation as Expectation).type}`,
        };
    }
  } catch (e) {
    return {
      expectation,
      passed: false,
      error: `Evaluation error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Evaluate all expectations for a step
 */
export async function evaluateAllExpectations(
  page: Page,
  expectations: Expectation[],
  timeout?: number
): Promise<{ allPassed: boolean; results: ExpectationResult[] }> {
  const results: ExpectationResult[] = [];
  
  for (const expectation of expectations) {
    const result = await evaluateExpectation(page, expectation, timeout);
    results.push(result);
  }
  
  const allPassed = results.every(r => r.passed);
  return { allPassed, results };
}
