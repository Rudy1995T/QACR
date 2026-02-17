import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { TestCase, TestStep, Expectation } from '../agent/index.js';
import type { LocatorSpec } from '../agent/actionSchema.js';

/**
 * Schema for test case YAML files
 */
const ExpectationSchema = z.object({
  type: z.enum(['url_contains', 'visible_text', 'locator_visible']),
  value: z.string(),
  locator: z.any().optional(), // LocatorSpec, validated separately if needed
});

const TestStepSchema = z.object({
  goal: z.string(),
  expect: z.array(ExpectationSchema).optional(),
});

const TestCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  variables: z.record(z.string()).optional(),
  steps: z.array(TestStepSchema).min(1),
});

/**
 * Load a test case from a YAML file
 */
export function loadTestCase(filePath: string): TestCase {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(content);
  const validated = TestCaseSchema.parse(parsed);
  
  return {
    id: validated.id,
    name: validated.name,
    baseUrl: validated.baseUrl,
    variables: validated.variables,
    steps: validated.steps.map(step => ({
      goal: step.goal,
      expect: step.expect as Expectation[] | undefined,
    })),
  };
}

/**
 * Load all test cases from a directory
 */
export function loadTestCases(dirPath: string): TestCase[] {
  const files = readdirSync(dirPath);
  const testCases: TestCase[] = [];
  
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
      const fullPath = join(dirPath, file);
      try {
        const testCase = loadTestCase(fullPath);
        testCases.push(testCase);
      } catch (e) {
        console.error(`Failed to load test case ${file}:`, e);
      }
    }
  }
  
  return testCases;
}

/**
 * Merge variables from test case with environment
 */
export function resolveVariables(
  testCase: TestCase,
  extraVars?: Record<string, string>
): Record<string, string> {
  return {
    ...testCase.variables,
    ...extraVars,
  };
}
