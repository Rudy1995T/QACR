/**
 * LLM Provider interface for generating actions
 */
export interface LLMProvider {
  /**
   * Generate an action response from the given prompt
   * @param prompt The full prompt including system and user messages
   * @returns The raw LLM response string (should be JSON)
   */
  generateAction(prompt: string): Promise<string>;
}

/**
 * Configuration for LLM providers
 */
export interface LLMConfig {
  model: string;
  baseUrl: string;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
}

/**
 * Stub provider for testing
 */
export class StubProvider implements LLMProvider {
  private responses: string[];
  private index: number = 0;

  constructor(responses: string[] = []) {
    this.responses = responses;
  }

  async generateAction(_prompt: string): Promise<string> {
    if (this.index >= this.responses.length) {
      // Default fail action when no more responses
      return JSON.stringify({
        thinking: 'No more stub responses',
        action: { type: 'fail', reason: 'Stub exhausted' },
      });
    }
    return this.responses[this.index++];
  }

  /**
   * Add a response to the queue
   */
  addResponse(response: string | object): void {
    this.responses.push(
      typeof response === 'string' ? response : JSON.stringify(response)
    );
  }

  /**
   * Reset the response index
   */
  reset(): void {
    this.index = 0;
  }
}
