import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { AgentRunner, TestCase, StepResult, maskSecrets } from '../src/agent/index.js';
import { createProvider, ChutesProvider } from '../src/llm/index.js';
import { loadTestCases, resolveVariables, createLogger } from '../src/utils/index.js';

// Load environment variables
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const testcasesDir = join(__dirname, '..', 'testcases');

// Load all test cases
const testCases = loadTestCases(testcasesDir);

// Configuration from environment
const config = {
  maxTicksPerStep: parseInt(process.env.MAX_TICKS_PER_STEP || '25', 10),
  ariaSnapshotMaxChars: parseInt(process.env.ARIA_SNAPSHOT_MAX_CHARS || '8000', 10),
  shortTextMaxChars: parseInt(process.env.SHORT_TEXT_MAX_CHARS || '2000', 10),
  postActionDelayMs: 200,
  expectationTimeoutMs: 3000,
};

// Check Chutes availability before running tests
test.beforeAll(async () => {
  const chutes = new ChutesProvider();
  const available = await chutes.healthCheck();
  
  if (!available) {
    console.warn('\n⚠️  Chutes API is not reachable');
    console.warn('   Make sure CHUTES_API_KEY is set in your .env file');
    console.warn('   Get your API key from https://chutes.ai/app/api\n');
  } else {
    console.log('\n✓ Chutes API is available\n');
  }
  
  const models = await chutes.listModels();
  if (models.length > 0) {
    console.log(`✓ Available models: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}\n`);
  }
});

// Generate tests from YAML test cases
for (const testCase of testCases) {
  test.describe(testCase.name, () => {
    test(`Execute: ${testCase.id}`, async ({ page }, testInfo) => {
      const logger = createLogger(`test:${testCase.id}`);
      const llm = createProvider();
      const variables = resolveVariables(testCase);
      
      const runner = new AgentRunner(page, llm, logger, config, variables);
      
      // Navigate to base URL
      logger.info({ baseUrl: testCase.baseUrl }, 'Navigating to base URL');
      await page.goto(testCase.baseUrl, { waitUntil: 'domcontentloaded' });
      
      const stepResults: StepResult[] = [];
      
      // Execute each step
      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        logger.info({ stepIndex: i, goal: maskSecrets(step.goal) }, `Step ${i + 1}`);
        
        const result = await runner.executeStep(step);
        stepResults.push(result);
        
        // Attach debug info on failure
        if (!result.success) {
          // Attach last observation
          if (result.debugInfo?.lastObservation) {
            const obs = result.debugInfo.lastObservation;
            await testInfo.attach(`step-${i + 1}-aria-snapshot.txt`, {
              body: obs.ariaSnapshot,
              contentType: 'text/plain',
            });
            await testInfo.attach(`step-${i + 1}-debug.json`, {
              body: JSON.stringify({
                url: obs.url,
                title: obs.title,
                tickNumber: obs.tickNumber,
                lastError: obs.lastError,
                previousActions: obs.previousActions,
              }, null, 2),
              contentType: 'application/json',
            });
          }
          
          // Attach actions history
          await testInfo.attach(`step-${i + 1}-actions.json`, {
            body: JSON.stringify(result.actions, null, 2),
            contentType: 'application/json',
          });
          
          // Attach expectation results
          if (result.expectations.length > 0) {
            await testInfo.attach(`step-${i + 1}-expectations.json`, {
              body: JSON.stringify(result.expectations, null, 2),
              contentType: 'application/json',
            });
          }
          
          logger.error({
            step: i + 1,
            goal: maskSecrets(step.goal),
            error: result.error,
            ticksUsed: result.ticksUsed,
          }, 'Step failed');
          
          // Fail the test
          expect(result.success, `Step ${i + 1} failed: ${result.error}`).toBe(true);
        } else {
          logger.info({
            step: i + 1,
            ticksUsed: result.ticksUsed,
          }, 'Step passed');
        }
      }
      
      // Summary
      const passed = stepResults.filter(r => r.success).length;
      const total = stepResults.length;
      logger.info({ passed, total }, 'Test completed');
      
      // Attach summary
      await testInfo.attach('test-summary.json', {
        body: JSON.stringify({
          testCase: testCase.id,
          name: testCase.name,
          baseUrl: testCase.baseUrl,
          stepsTotal: total,
          stepsPassed: passed,
          steps: stepResults.map((r, i) => ({
            index: i + 1,
            goal: maskSecrets(testCase.steps[i].goal),
            success: r.success,
            ticksUsed: r.ticksUsed,
            error: r.error,
          })),
        }, null, 2),
        contentType: 'application/json',
      });
    });
  });
}

// Fallback test if no test cases found
if (testCases.length === 0) {
  test('No test cases found', async () => {
    console.warn(`No test cases found in ${testcasesDir}`);
    console.warn('Create YAML files in the testcases/ directory');
    expect(true).toBe(true);
  });
}
