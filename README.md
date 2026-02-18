# QACR - AI QA Executor

A local-first AI-powered test automation framework that uses Playwright ARIA snapshots and Chutes for LLM inference to execute human-readable test cases.

**No screenshots. No vision models.** Just text-based page observations and smart AI decision-making.

## Features

- 🤖 **AI-Driven**: LLM decides actions based on ARIA accessibility snapshots
- 📝 **Human-Readable**: Write test cases in natural language YAML
- 🚀 **Chutes-Powered**: Serverless AI inference on decentralized GPU infrastructure
- 📊 **Playwright Reports**: Full HTML reports with debug attachments
- 🔌 **Swappable LLM**: Easy to add OpenAI-compatible providers
- ✅ **Schema Validated**: All LLM outputs validated with Zod

## Quick Start

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Get a Chutes API Key

1. Go to [chutes.ai](https://chutes.ai) and create an account
2. Navigate to [API Keys](https://chutes.ai/app/api)
3. Create a new API key

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your CHUTES_API_KEY
```

### 4. Run Tests

```bash
# Run all test cases
npm test

# Run with debug output
npm run test:debug

# Run specific test
npx playwright test --grep "Login"
```

### 5. View Report

```bash
npx playwright show-report
```

## Writing Test Cases

Test cases are YAML files in the `testcases/` directory.

### Structure

```yaml
id: my-test-case
name: "Human-readable test name"
baseUrl: "https://example.com"
variables:
  USERNAME: "testuser"
  PASSWORD: "secretpass"

steps:
  - goal: "Navigate to the login page by clicking Sign In."
    expect:
      - type: url_contains
        value: "/login"
      - type: visible_text
        value: "Sign In"

  - goal: "Enter username ${ENV.USERNAME} in the username field."

  - goal: "Enter password ${ENV.PASSWORD} in the password field."

  - goal: "Click the Submit button to log in."
    expect:
      - type: url_contains
        value: "/dashboard"
      - type: visible_text
        value: "Welcome"
```

### Step Format

Each step has:

- **goal**: Natural language description of what to achieve
- **expect** (optional): Conditions to verify before moving to next step

### Expectation Types

| Type | Description | Example |
|------|-------------|---------|
| `url_contains` | URL includes string | `value: "/dashboard"` |
| `visible_text` | Text is visible on page | `value: "Welcome back"` |
| `locator_visible` | Element is visible | `value: "Submit"` |

### Variables

Use `${ENV.VARIABLE_NAME}` in goals. Variables are resolved from:

1. Test case `variables` section
2. Environment variables (process.env)

**Security**: Variables are masked in logs (`[MASKED]`).

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `chutes` | LLM provider (chutes, stub) |
| `LLM_MODEL` | `unsloth/Llama-3.2-3B-Instruct` | Model name |
| `LLM_BASE_URL` | `https://llm.chutes.ai` | Chutes API URL |
| `LLM_TEMPERATURE` | `0.1` | Sampling temperature |
| `LLM_TOP_P` | `0.9` | Top-p sampling |
| `LLM_TIMEOUT_MS` | `60000` | Request timeout |
| `CHUTES_API_KEY` | - | Your Chutes API key (required) |
| `MAX_TICKS_PER_STEP` | `25` | Max actions per step |
| `ARIA_SNAPSHOT_MAX_CHARS` | `8000` | Truncate ARIA snapshot |
| `SHORT_TEXT_MAX_CHARS` | `2000` | Truncate visible text |
| `LOG_LEVEL` | `info` | Logging level |
| `DEBUG` | `false` | Enable debug logging |

### Available Models

Chutes provides access to various models. Some popular options:

- `unsloth/Llama-3.2-3B-Instruct` - Fast, capable instruction model (default)
- `unsloth/Llama-3.2-1B-Instruct` - Smaller, faster
- `meta-llama/Llama-3.1-8B-Instruct` - Larger, more capable

Browse available models at [chutes.ai/app](https://chutes.ai/app)

## Architecture

```
/src
  /agent
    actionSchema.ts   # Zod schemas for LLM actions
    observation.ts    # Page observation collection
    prompt.ts         # LLM prompt building
    expectations.ts   # Expectation evaluation
    locator.ts        # Playwright locator helpers
    runner.ts         # Main agent loop
  /llm
    provider.ts       # LLM provider interface
    chutes.ts         # Chutes implementation
  /utils
    logger.ts         # Pino logging
    testcase.ts       # YAML test case loader
/testcases            # YAML test definitions
/tests
  agent.spec.ts       # Playwright test runner
```

### Agent Loop

For each test step:

1. **Observe**: Collect URL, title, ARIA snapshot, visible text
2. **Prompt**: Build prompt with goal, expectations, observations
3. **Generate**: LLM chooses one action (click, fill, press, etc.)
4. **Validate**: Parse and validate JSON with Zod
5. **Execute**: Run action with Playwright
6. **Verify**: Check if expectations are met
7. **Loop**: Repeat until success or max ticks

### Action Types

| Action | Description | Parameters |
|--------|-------------|------------|
| `click` | Click an element | `locator` |
| `fill` | Type into input | `locator`, `text` |
| `press` | Press keyboard key | `key`, `locator?` |
| `select` | Select dropdown option | `locator`, `value` |
| `check` | Toggle checkbox | `locator`, `checked` |
| `wait` | Wait milliseconds | `ms` |
| `goto` | Navigate to URL | `url` |
| `assert` | Verify condition | `assertType`, `value` |
| `fail` | Give up with reason | `reason` |

### Locator Strategies

The LLM chooses locators based on the ARIA snapshot:

1. **role** (preferred): `{ kind: "role", role: "button", name: "Submit" }`
2. **label**: `{ kind: "label", text: "Email" }`
3. **testid**: `{ kind: "testid", id: "submit-btn" }`
4. **text**: `{ kind: "text", text: "Click here" }`
5. **css** (last resort): `{ kind: "css", selector: ".btn-primary" }`
6. **active**: `{ kind: "active" }` - currently focused element

## Debugging

### View Debug Output

```bash
DEBUG=true npm test
```

### Inspect Failed Steps

On failure, tests attach:

- `step-N-aria-snapshot.txt` - Page ARIA structure
- `step-N-debug.json` - URL, title, last error
- `step-N-actions.json` - All actions attempted
- `step-N-expectations.json` - Expectation results
- `test-summary.json` - Overall test summary

### Common Issues

**LLM returns invalid JSON**

- Check model supports JSON output
- Try a larger model (e.g., `meta-llama/Llama-3.1-8B-Instruct`)
- Increase temperature slightly

**Element not found**

- Check ARIA snapshot in debug output
- Ensure site has good accessibility labels
- Try different locator strategies

**Max ticks exceeded**

- Increase `MAX_TICKS_PER_STEP`
- Simplify the step goal
- Check if expectations are achievable

**Chutes API errors**

- Verify `CHUTES_API_KEY` is set correctly
- Check your API key has sufficient credits
- Try a different model if one is unavailable

**Request timeout**

- Increase `LLM_TIMEOUT_MS`
- Check your network connection
- Try a smaller/faster model

## Extending

### Add Custom Provider

```typescript
// src/llm/custom.ts
import type { LLMProvider, LLMConfig } from './provider.js';

export class CustomProvider implements LLMProvider {
  async generateAction(prompt: string): Promise<string> {
    // Implement your API call
  }
}
```

### Custom Expectations

Add new expectation types in `src/agent/expectations.ts`:

```typescript
case 'element_count': {
  const locator = page.getByText(expectation.value);
  const count = await locator.count();
  return { expectation, passed: count >= 1 };
}
```

## Known Limitations

- **No screenshots/vision** - Relies entirely on text-based observations
- **Accessibility dependent** - Works best on well-structured, accessible sites
- **LLM variability** - Different models may produce different results
- **No parallel execution** - Tests run sequentially for AI stability
- **API key required** - Needs a Chutes account and API key

## License

MIT
