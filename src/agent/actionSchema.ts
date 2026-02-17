import { z } from 'zod';

/**
 * Locator specification - how to find an element on the page.
 * Ordered by preference: role > label > testid > text > css > active
 */
export const LocatorSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('role'),
    role: z.string().describe('ARIA role (e.g., button, textbox, link, heading)'),
    name: z.string().describe('Accessible name from aria-label or text content'),
    exact: z.boolean().optional().describe('Exact match for name'),
  }),
  z.object({
    kind: z.literal('label'),
    text: z.string().describe('Label text (for form fields)'),
    exact: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('testid'),
    id: z.string().describe('data-testid attribute value'),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().describe('Visible text content'),
    exact: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('css'),
    selector: z.string().describe('CSS selector (last resort)'),
  }),
  z.object({
    kind: z.literal('active'),
  }).describe('Currently focused element'),
]);

export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

/**
 * Action types the LLM can choose from
 */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click'),
    locator: LocatorSpecSchema,
    description: z.string().optional().describe('Why this click'),
  }),
  z.object({
    type: z.literal('fill'),
    locator: LocatorSpecSchema,
    text: z.string().describe('Text to type'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('press'),
    key: z.string().describe('Key to press (e.g., Enter, Tab, Escape)'),
    locator: LocatorSpecSchema.optional().describe('Element to focus first'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('select'),
    locator: LocatorSpecSchema,
    value: z.string().describe('Option value to select'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('check'),
    locator: LocatorSpecSchema,
    checked: z.boolean().describe('Check or uncheck'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('wait'),
    ms: z.number().min(100).max(10000).describe('Milliseconds to wait'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('goto'),
    url: z.string().url().describe('URL to navigate to'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('assert'),
    assertType: z.enum(['visible_text', 'url_contains', 'locator_visible']),
    value: z.string().describe('Value to assert'),
    locator: LocatorSpecSchema.optional().describe('For locator_visible'),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('fail'),
    reason: z.string().describe('Why the goal cannot be achieved'),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

/**
 * LLM response wrapper - must contain exactly one action
 */
export const LLMResponseSchema = z.object({
  thinking: z.string().optional().describe('Brief reasoning (for debugging)'),
  action: ActionSchema,
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

/**
 * Parse and validate LLM output
 */
export function parseAction(jsonString: string): LLMResponse {
  // Try to extract JSON from the response (LLMs sometimes add extra text)
  const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON object found in LLM response: ${jsonString.slice(0, 200)}`);
  }
  
  const parsed = JSON.parse(jsonMatch[0]);
  return LLMResponseSchema.parse(parsed);
}
