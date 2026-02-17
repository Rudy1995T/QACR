import type { Page } from '@playwright/test';
import type { Logger } from '../utils/logger.js';
import type { LLMProvider } from '../llm/provider.js';
import type { Action } from './actionSchema.js';
import type { Expectation, ExpectationResult } from './expectations.js';
import type { Observation } from './observation.js';
import { parseAction } from './actionSchema.js';
import { collectObservation, extractKeywords } from './observation.js';
import { buildSystemPrompt, buildUserPrompt, maskSecrets } from './prompt.js';
import { evaluateAllExpectations } from './expectations.js';
import { locatorFromSpec, checkLocator, describeLocator } from './locator.js';

export interface TestStep {
  goal: string;
  expect?: Expectation[];
}

export interface TestCase {
  id: string;
  name: string;
  baseUrl: string;
  variables?: Record<string, string>;
  steps: TestStep[];
}

export interface RunnerConfig {
  maxTicksPerStep: number;
  ariaSnapshotMaxChars: number;
  shortTextMaxChars: number;
  postActionDelayMs: number;
  expectationTimeoutMs: number;
}

export interface StepResult {
  step: TestStep;
  success: boolean;
  ticksUsed: number;
  actions: Array<{ action: Action; success: boolean; error?: string }>;
  expectations: ExpectationResult[];
  error?: string;
  debugInfo?: DebugInfo;
}

export interface DebugInfo {
  lastObservation: Observation;
  lastLLMResponse: string;
  lastError: string | null;
}

const DEFAULT_CONFIG: RunnerConfig = {
  maxTicksPerStep: 25,
  ariaSnapshotMaxChars: 8000,
  shortTextMaxChars: 2000,
  postActionDelayMs: 200,
  expectationTimeoutMs: 3000,
};

/**
 * Main agent runner for executing test steps
 */
export class AgentRunner {
  private page: Page;
  private llm: LLMProvider;
  private logger: Logger;
  private config: RunnerConfig;
  private variables: Record<string, string>;

  constructor(
    page: Page,
    llm: LLMProvider,
    logger: Logger,
    config: Partial<RunnerConfig> = {},
    variables: Record<string, string> = {}
  ) {
    this.page = page;
    this.llm = llm;
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.variables = variables;
  }

  /**
   * Execute a single test step
   */
  async executeStep(step: TestStep): Promise<StepResult> {
    const goal = this.interpolateVariables(step.goal);
    const expectations = step.expect || [];
    const keywords = extractKeywords(goal);
    
    this.logger.info({ goal: maskSecrets(goal), expectations }, 'Starting step');
    
    const actions: StepResult['actions'] = [];
    let lastError: string | null = null;
    let lastObservation: Observation | null = null;
    let lastLLMResponse = '';
    
    for (let tick = 1; tick <= this.config.maxTicksPerStep; tick++) {
      this.logger.debug({ tick }, 'Agent tick');
      
      // Collect observation
      lastObservation = await collectObservation(
        this.page,
        actions,
        tick,
        lastError,
        {
          ariaSnapshotMaxChars: this.config.ariaSnapshotMaxChars,
          shortTextMaxChars: this.config.shortTextMaxChars,
          goalKeywords: keywords,
        }
      );
      
      // Build prompt
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt({
        goal,
        expectations,
        observation: lastObservation,
      });
      
      // Call LLM
      let llmResponse: string;
      try {
        llmResponse = await this.llm.generateAction(
          systemPrompt + '\n\n' + userPrompt
        );
        lastLLMResponse = llmResponse;
        this.logger.debug({ response: llmResponse.slice(0, 500) }, 'LLM response');
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.logger.error({ error }, 'LLM call failed');
        lastError = `LLM error: ${error}`;
        continue;
      }
      
      // Parse action
      let action: Action;
      try {
        const parsed = parseAction(llmResponse);
        action = parsed.action;
        if (parsed.thinking) {
          this.logger.debug({ thinking: parsed.thinking }, 'LLM reasoning');
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.logger.warn({ error, response: llmResponse.slice(0, 300) }, 'Failed to parse action');
        lastError = `Parse error: ${error}`;
        continue;
      }
      
      this.logger.info({ action: { type: action.type } }, 'Executing action');
      
      // Handle fail action
      if (action.type === 'fail') {
        return {
          step,
          success: false,
          ticksUsed: tick,
          actions,
          expectations: [],
          error: `Agent gave up: ${action.reason}`,
          debugInfo: {
            lastObservation,
            lastLLMResponse,
            lastError,
          },
        };
      }
      
      // Handle assert action (verify but don't execute)
      if (action.type === 'assert') {
        const assertExpectation: Expectation = {
          type: action.assertType,
          value: action.value,
          locator: action.locator,
        };
        const { results } = await evaluateAllExpectations(
          this.page,
          [assertExpectation],
          this.config.expectationTimeoutMs
        );
        const passed = results[0]?.passed ?? false;
        actions.push({
          action,
          success: passed,
          error: passed ? undefined : results[0]?.error,
        });
        lastError = passed ? null : results[0]?.error ?? 'Assert failed';
        continue;
      }
      
      // Execute page action
      const result = await this.executeAction(action);
      actions.push(result);
      lastError = result.error ?? null;
      
      // Small delay for page stability
      await this.page.waitForTimeout(this.config.postActionDelayMs);
      
      // Check if navigation occurred
      if (action.type === 'click' || action.type === 'goto') {
        try {
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 });
        } catch {
          // Timeout is fine, page might not have navigated
        }
      }
      
      // Evaluate expectations
      if (expectations.length > 0) {
        const { allPassed, results } = await evaluateAllExpectations(
          this.page,
          expectations,
          this.config.expectationTimeoutMs
        );
        
        if (allPassed) {
          this.logger.info({ ticksUsed: tick }, 'Step completed - all expectations met');
          return {
            step,
            success: true,
            ticksUsed: tick,
            actions,
            expectations: results,
          };
        }
        
        this.logger.debug(
          { results: results.filter(r => !r.passed) },
          'Some expectations not yet met'
        );
      }
    }
    
    // Max ticks exceeded
    const { results } = await evaluateAllExpectations(
      this.page,
      expectations,
      this.config.expectationTimeoutMs
    );
    
    return {
      step,
      success: expectations.length === 0, // Pass if no expectations defined
      ticksUsed: this.config.maxTicksPerStep,
      actions,
      expectations: results,
      error: expectations.length > 0 
        ? `Max ticks (${this.config.maxTicksPerStep}) exceeded without meeting expectations`
        : undefined,
      debugInfo: lastObservation ? {
        lastObservation,
        lastLLMResponse,
        lastError,
      } : undefined,
    };
  }

  /**
   * Execute a single page action
   */
  private async executeAction(
    action: Exclude<Action, { type: 'fail' } | { type: 'assert' }>
  ): Promise<{ action: Action; success: boolean; error?: string }> {
    try {
      switch (action.type) {
        case 'click': {
          const locator = locatorFromSpec(this.page, action.locator);
          const { exists, count } = await checkLocator(locator);
          if (!exists) {
            return {
              action,
              success: false,
              error: `Locator not found: ${describeLocator(action.locator)}`,
            };
          }
          this.logger.debug({ locator: describeLocator(action.locator), count }, 'Clicking');
          await locator.first().click({ timeout: 10000 });
          return { action, success: true };
        }
        
        case 'fill': {
          const locator = locatorFromSpec(this.page, action.locator);
          const { exists } = await checkLocator(locator);
          if (!exists) {
            return {
              action,
              success: false,
              error: `Locator not found: ${describeLocator(action.locator)}`,
            };
          }
          const textToFill = this.interpolateVariables(action.text);
          this.logger.debug({ locator: describeLocator(action.locator) }, 'Filling');
          await locator.first().fill(textToFill, { timeout: 10000 });
          return { action, success: true };
        }
        
        case 'press': {
          if (action.locator) {
            const locator = locatorFromSpec(this.page, action.locator);
            await locator.first().press(action.key, { timeout: 10000 });
          } else {
            await this.page.keyboard.press(action.key);
          }
          return { action, success: true };
        }
        
        case 'select': {
          const locator = locatorFromSpec(this.page, action.locator);
          await locator.first().selectOption(action.value, { timeout: 10000 });
          return { action, success: true };
        }
        
        case 'check': {
          const locator = locatorFromSpec(this.page, action.locator);
          if (action.checked) {
            await locator.first().check({ timeout: 10000 });
          } else {
            await locator.first().uncheck({ timeout: 10000 });
          }
          return { action, success: true };
        }
        
        case 'wait': {
          await this.page.waitForTimeout(action.ms);
          return { action, success: true };
        }
        
        case 'goto': {
          await this.page.goto(action.url, { waitUntil: 'domcontentloaded' });
          return { action, success: true };
        }
        
        default:
          return {
            action: action as Action,
            success: false,
            error: `Unknown action type`,
          };
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.warn({ action: action.type, error }, 'Action failed');
      return { action, success: false, error };
    }
  }

  /**
   * Replace ${ENV.XXX} variables in text
   */
  private interpolateVariables(text: string): string {
    return text.replace(/\$\{ENV\.(\w+)\}/g, (match, name) => {
      // Check test variables first, then process.env
      if (this.variables[name] !== undefined) {
        return this.variables[name];
      }
      const envValue = process.env[name];
      if (envValue !== undefined) {
        return envValue;
      }
      this.logger.warn({ variable: name }, 'Variable not found');
      return match; // Keep original if not found
    });
  }
}
