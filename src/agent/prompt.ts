import type { Observation } from './observation.js';
import type { Expectation } from './expectations.js';

export interface PromptContext {
  goal: string;
  expectations: Expectation[];
  observation: Observation;
}

/**
 * Build the system prompt for the LLM
 */
export function buildSystemPrompt(): string {
  return `You are a web automation agent. Your task is to achieve a given goal by choosing ONE action at a time based on the current page state.

RULES:
1. Output ONLY valid JSON matching the schema below. No explanations outside JSON.
2. Choose locators based ONLY on what you see in the ARIA snapshot.
3. DO NOT invent or guess selectors - use what's visible in the snapshot.
4. Prefer locator strategies in this order: role > label > text > css (css is last resort).
5. For role locators, use the exact role and name from the ARIA snapshot.
6. One action per response. The runner will loop until the goal is met.
7. If you believe the goal is impossible, use the "fail" action with a reason.

ACTION SCHEMA:
{
  "thinking": "brief reasoning (optional)",
  "action": {
    "type": "click" | "fill" | "press" | "select" | "check" | "wait" | "goto" | "assert" | "fail",
    // For click/fill/select/check:
    "locator": {
      "kind": "role" | "label" | "testid" | "text" | "css" | "active",
      // For role: "role": string, "name": string, "exact"?: boolean
      // For label/text: "text": string, "exact"?: boolean
      // For testid: "id": string
      // For css: "selector": string
      // For active: no additional fields
    },
    // For fill: "text": string (the text to type)
    // For press: "key": string (e.g., "Enter", "Tab")
    // For select: "value": string
    // For check: "checked": boolean
    // For wait: "ms": number (100-10000)
    // For goto: "url": string
    // For assert: "assertType": "visible_text" | "url_contains" | "locator_visible", "value": string
    // For fail: "reason": string
  }
}

LOCATOR EXAMPLES:
- Button: {"kind": "role", "role": "button", "name": "Submit"}
- Link: {"kind": "role", "role": "link", "name": "Sign in"}
- Text input: {"kind": "role", "role": "textbox", "name": "Username"}
- By label: {"kind": "label", "text": "Email address"}
- By visible text: {"kind": "text", "text": "Click here"}
- Currently focused: {"kind": "active"}`;
}

/**
 * Build the user prompt with current context
 */
export function buildUserPrompt(context: PromptContext): string {
  const { goal, expectations, observation } = context;
  
  const parts: string[] = [];
  
  // Goal
  parts.push(`GOAL: ${goal}`);
  
  // Expectations
  if (expectations.length > 0) {
    const expList = expectations
      .map(e => `  - ${e.type}: "${e.value}"`)
      .join('\n');
    parts.push(`\nEXPECTED OUTCOMES (runner will verify):\n${expList}`);
  }
  
  // Current state
  parts.push(`\nCURRENT PAGE STATE:`);
  parts.push(`URL: ${observation.url}`);
  parts.push(`Title: ${observation.title}`);
  parts.push(`Tick: ${observation.tickNumber}`);
  
  // Last error
  if (observation.lastError) {
    parts.push(`\nLAST ERROR: ${observation.lastError}`);
  }
  
  // Previous actions
  if (observation.previousActions.length > 0) {
    const actionsStr = observation.previousActions
      .map((a, i) => {
        const status = a.success ? '✓' : '✗';
        const err = a.error ? ` (${a.error})` : '';
        return `  ${i + 1}. [${status}] ${a.action.type}${err}`;
      })
      .join('\n');
    parts.push(`\nPREVIOUS ACTIONS:\n${actionsStr}`);
  }
  
  // ARIA snapshot
  parts.push(`\nARIA SNAPSHOT:\n${observation.ariaSnapshot}`);
  
  // Short text (if different enough from ARIA)
  if (observation.shortText.length > 100) {
    parts.push(`\nVISIBLE TEXT EXCERPT:\n${observation.shortText}`);
  }
  
  // Instruction
  parts.push(`\nChoose the next action to achieve the goal. Output JSON only.`);
  
  return parts.join('\n');
}

/**
 * Mask environment variable references in text
 */
export function maskSecrets(text: string): string {
  // Mask ${ENV.XXX} patterns with [MASKED]
  return text.replace(/\$\{ENV\.\w+\}/g, '[MASKED]');
}
