/**
 * Zod schemas for Chrome DevTools Recorder JSON, assertion sidecars,
 * and selector override sidecars.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*  Chrome DevTools Recorder JSON                                             */
/* -------------------------------------------------------------------------- */

/**
 * A single selector alternative.  DevTools exports selectors as an array of
 * alternatives; each alternative is itself an array of strings (one per
 * frame nesting level).  For top-level interactions the inner array has
 * length 1.
 */
const SelectorAlternativeSchema = z.array(z.string());

const BaseStepSchema = z.object({
  type: z.string(),
  timeout: z.number().optional(),
  assertedEvents: z.array(z.any()).optional(),
});

const NavigateStepSchema = BaseStepSchema.extend({
  type: z.literal('navigate'),
  url: z.string(),
});

const ClickStepSchema = BaseStepSchema.extend({
  type: z.literal('click'),
  selectors: z.array(SelectorAlternativeSchema),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  button: z.enum(['primary', 'secondary', 'middle']).optional(),
  duration: z.number().optional(),
});

const DoubleClickStepSchema = BaseStepSchema.extend({
  type: z.literal('doubleClick'),
  selectors: z.array(SelectorAlternativeSchema),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
});

const ChangeStepSchema = BaseStepSchema.extend({
  type: z.literal('change'),
  selectors: z.array(SelectorAlternativeSchema),
  value: z.string(),
});

const KeyDownStepSchema = BaseStepSchema.extend({
  type: z.literal('keyDown'),
  key: z.string(),
});

const KeyUpStepSchema = BaseStepSchema.extend({
  type: z.literal('keyUp'),
  key: z.string(),
});

const ScrollStepSchema = BaseStepSchema.extend({
  type: z.literal('scroll'),
  x: z.number().optional(),
  y: z.number().optional(),
  selectors: z.array(SelectorAlternativeSchema).optional(),
});

const HoverStepSchema = BaseStepSchema.extend({
  type: z.literal('hover'),
  selectors: z.array(SelectorAlternativeSchema),
});

const SetViewportStepSchema = BaseStepSchema.extend({
  type: z.literal('setViewport'),
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number().optional(),
  isMobile: z.boolean().optional(),
  hasTouch: z.boolean().optional(),
  isLandscape: z.boolean().optional(),
});

const WaitForElementStepSchema = BaseStepSchema.extend({
  type: z.literal('waitForElement'),
  selectors: z.array(SelectorAlternativeSchema),
  operator: z.string().optional(),
  count: z.number().optional(),
  visible: z.boolean().optional(),
  properties: z.record(z.any()).optional(),
  attributes: z.record(z.any()).optional(),
});

const WaitForExpressionStepSchema = BaseStepSchema.extend({
  type: z.literal('waitForExpression'),
  expression: z.string(),
});

const CustomStepStepSchema = BaseStepSchema.extend({
  type: z.literal('customStep'),
  name: z.string(),
  parameters: z.record(z.any()).optional(),
});

/** Union of all known step types.  Unknown types fall through to BaseStepSchema. */
export const RecorderStepSchema = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  DoubleClickStepSchema,
  ChangeStepSchema,
  KeyDownStepSchema,
  KeyUpStepSchema,
  ScrollStepSchema,
  HoverStepSchema,
  SetViewportStepSchema,
  WaitForElementStepSchema,
  WaitForExpressionStepSchema,
  CustomStepStepSchema,
]);

export const RecordingSchema = z.object({
  title: z.string(),
  steps: z.array(z.record(z.any())),
});

export type Recording = z.infer<typeof RecordingSchema>;
export type RecorderStep = z.infer<typeof RecorderStepSchema>;

/* -------------------------------------------------------------------------- */
/*  Override sidecar YAML                                                      */
/* -------------------------------------------------------------------------- */

const LocatorOverrideSchema = z.object({
  kind: z.enum(['role', 'label', 'text', 'testid', 'css']),
  role: z.string().optional(),
  name: z.string().optional(),
  exact: z.boolean().optional(),
  selector: z.string().optional(),
  text: z.string().optional(),
  id: z.string().optional(),
});

const OverrideEntrySchema = z.object({
  step: z.number(),
  action: z.string(),
  locator: LocatorOverrideSchema,
});

export const OverridesFileSchema = z.object({
  overrides: z.array(OverrideEntrySchema),
});

export type OverridesFile = z.infer<typeof OverridesFileSchema>;
export type LocatorOverride = z.infer<typeof LocatorOverrideSchema>;

/* -------------------------------------------------------------------------- */
/*  Assertion sidecar YAML                                                     */
/* -------------------------------------------------------------------------- */

const AssertionExpectSchema = z.object({
  type: z.enum(['url_contains', 'visible_text', 'role_visible']),
  value: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  exact: z.boolean().optional(),
});

const AssertionEntrySchema = z.object({
  afterStep: z.number(),
  expect: z.array(AssertionExpectSchema),
});

export const AssertionsFileSchema = z.object({
  assertions: z.array(AssertionEntrySchema),
});

export type AssertionsFile = z.infer<typeof AssertionsFileSchema>;
export type AssertionExpect = z.infer<typeof AssertionExpectSchema>;
