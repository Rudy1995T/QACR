import type { Page, Locator } from '@playwright/test';
import type { LocatorSpec } from './actionSchema.js';

/**
 * Convert a LocatorSpec to a Playwright Locator
 */
export function locatorFromSpec(page: Page, spec: LocatorSpec): Locator {
  switch (spec.kind) {
    case 'role':
      return page.getByRole(spec.role as Parameters<Page['getByRole']>[0], {
        name: spec.name,
        exact: spec.exact,
      });
    
    case 'label':
      return page.getByLabel(spec.text, { exact: spec.exact });
    
    case 'testid':
      return page.getByTestId(spec.id);
    
    case 'text':
      return page.getByText(spec.text, { exact: spec.exact });
    
    case 'css':
      return page.locator(spec.selector);
    
    case 'active':
      // Return focused element, or body as fallback
      return page.locator(':focus').or(page.locator('body'));
    
    default:
      throw new Error(`Unknown locator kind: ${(spec as LocatorSpec).kind}`);
  }
}

/**
 * Check if a locator exists and get count for debugging
 */
export async function checkLocator(
  locator: Locator
): Promise<{ exists: boolean; count: number }> {
  try {
    const count = await locator.count();
    return { exists: count > 0, count };
  } catch (e) {
    return { exists: false, count: 0 };
  }
}

/**
 * Get a description of a locator spec for logging
 */
export function describeLocator(spec: LocatorSpec): string {
  switch (spec.kind) {
    case 'role':
      return `role=${spec.role} name="${spec.name}"${spec.exact ? ' (exact)' : ''}`;
    case 'label':
      return `label="${spec.text}"${spec.exact ? ' (exact)' : ''}`;
    case 'testid':
      return `testid="${spec.id}"`;
    case 'text':
      return `text="${spec.text}"${spec.exact ? ' (exact)' : ''}`;
    case 'css':
      return `css="${spec.selector}"`;
    case 'active':
      return 'active element';
    default:
      return `unknown(${JSON.stringify(spec)})`;
  }
}
