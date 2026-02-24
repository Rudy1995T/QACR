import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Recording } from '../schemas.js';
import {
  extractJsonObject,
  mergeOverrideEntries,
  parseReviewResponse,
  suggestOverridesFromFailureContext,
  validateOverridesAgainstRecording,
} from '../review.js';

describe('extractJsonObject', () => {
  it('parses fenced JSON', () => {
    const parsed = extractJsonObject(
      'Model output\n```json\n{"overrides":[]}\n```\n',
    );
    assert.deepEqual(parsed, { overrides: [] });
  });
});

describe('parseReviewResponse', () => {
  it('extracts and validates overrides schema', () => {
    const response = [
      'I found one robust override.',
      '{"overrides":[{"step":1,"action":"click","locator":{"kind":"role","role":"button","name":"Login","exact":true},"note":"extra key should be ignored"}]}',
    ].join('\n');

    const parsed = parseReviewResponse(response);
    assert.equal(parsed.overrides.length, 1);
    assert.equal(parsed.overrides[0]?.step, 1);
    assert.equal(parsed.overrides[0]?.action, 'click');
    assert.equal(parsed.overrides[0]?.locator.kind, 'role');
  });

  it('accepts common alternate keys and normalizes to overrides', () => {
    const response = JSON.stringify({
      suggested_overrides: [
        {
          step: 0,
          action: 'click',
          locator: { kind: 'text', text: 'Login' },
        },
      ],
    });

    const parsed = parseReviewResponse(response);
    assert.equal(parsed.overrides.length, 1);
    assert.equal(parsed.overrides[0]?.step, 0);
  });
});

describe('validateOverridesAgainstRecording', () => {
  const recording: Recording = {
    title: 'Sample Flow',
    steps: [{ type: 'click' }, { type: 'change' }, { type: 'waitForElement' }],
  };

  it('accepts matching step/action overrides', () => {
    validateOverridesAgainstRecording(
      {
        overrides: [
          {
            step: 0,
            action: 'click',
            locator: {
              kind: 'role',
              role: 'button',
              name: 'Login',
              exact: true,
            },
          },
        ],
      },
      recording,
    );
  });

  it('rejects out-of-range step indexes', () => {
    assert.throws(
      () =>
        validateOverridesAgainstRecording(
          {
            overrides: [
              {
                step: 99,
                action: 'click',
                locator: { kind: 'text', text: 'Login' },
              },
            ],
          },
          recording,
        ),
      /out of range/,
    );
  });

  it('rejects step/action mismatches', () => {
    assert.throws(
      () =>
        validateOverridesAgainstRecording(
          {
            overrides: [
              {
                step: 1,
                action: 'click',
                locator: { kind: 'label', text: 'Password' },
              },
            ],
          },
          recording,
        ),
      /action mismatch/,
    );
  });
});

describe('mergeOverrideEntries', () => {
  it('merges by step+action and prefers new entries', () => {
    const merged = mergeOverrideEntries(
      [
        {
          step: 7,
          action: 'click',
          locator: { kind: 'label', text: 'Login' },
        },
      ],
      [
        {
          step: 2,
          action: 'change',
          locator: { kind: 'label', text: 'User Name*' },
        },
        {
          step: 7,
          action: 'click',
          locator: {
            kind: 'role',
            role: 'button',
            name: 'Login',
            exact: true,
          },
        },
      ],
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.step, 2);
    assert.equal(merged[1]?.step, 7);
    assert.equal(merged[1]?.locator.kind, 'role');
  });
});

describe('suggestOverridesFromFailureContext', () => {
  it('infers a role override for failing click step from context snapshot', () => {
    const recording: Recording = {
      title: 'QAC_Login',
      steps: [
        { type: 'navigate' },
        {
          type: 'click',
          selectors: [['aria/Login']],
        },
      ],
    };

    const errorContext = [
      'step 1: click',
      '- button "Login" [ref=e25]',
    ].join('\n');

    const proposed = suggestOverridesFromFailureContext(recording, errorContext);
    assert.equal(proposed.overrides.length, 1);
    assert.equal(proposed.overrides[0]?.step, 1);
    assert.equal(proposed.overrides[0]?.action, 'click');
    assert.equal(proposed.overrides[0]?.locator.kind, 'role');
    if (proposed.overrides[0]?.locator.kind === 'role') {
      assert.equal(proposed.overrides[0].locator.role, 'button');
      assert.equal(proposed.overrides[0].locator.name, 'Login');
      assert.equal(proposed.overrides[0].locator.exact, true);
    }
  });

  it('infers step index even when context has no explicit step header', () => {
    const recording: Recording = {
      title: 'QAC_Login',
      steps: [
        { type: 'setViewport' },
        {
          type: 'click',
          selectors: [['aria/Login'], ['div.Login_loginButtonWrapper__HXgOk span']],
        },
      ],
    };

    const errorContext = '- button "Login" [ref=e25]';
    const proposed = suggestOverridesFromFailureContext(recording, errorContext);

    assert.equal(proposed.overrides.length, 1);
    assert.equal(proposed.overrides[0]?.step, 1);
    assert.equal(proposed.overrides[0]?.action, 'click');
  });

  it('prefers context role candidate whose name matches aria selector name', () => {
    const recording: Recording = {
      title: 'QAC_Login',
      steps: [
        {
          type: 'click',
          selectors: [['aria/Login']],
        },
      ],
    };

    const errorContext = [
      '- link "Forgot Password" [ref=e23]',
      '- button "Login" [ref=e25]',
    ].join('\n');

    const proposed = suggestOverridesFromFailureContext(recording, errorContext);
    assert.equal(proposed.overrides.length, 1);
    if (proposed.overrides[0]?.locator.kind === 'role') {
      assert.equal(proposed.overrides[0].locator.role, 'button');
      assert.equal(proposed.overrides[0].locator.name, 'Login');
    } else {
      assert.fail('Expected role locator');
    }
  });
});
