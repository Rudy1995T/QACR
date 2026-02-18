import type { LLMProvider, LLMConfig } from './provider.js';

interface ChutesConfig extends LLMConfig {
  apiKey?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Chutes LLM provider using OpenAI-compatible API
 * 
 * Chutes provides serverless AI inference on decentralized GPU infrastructure.
 * The API is OpenAI-compatible, making it easy to swap in for other providers.
 * 
 * @see https://chutes.ai/docs/getting-started/quickstart
 */
export class ChutesProvider implements LLMProvider {
  private config: Required<ChutesConfig>;

  constructor(config: Partial<ChutesConfig> = {}) {
    this.config = {
      model: config.model || process.env.LLM_MODEL || 'unsloth/Llama-3.2-3B-Instruct',
      baseUrl: config.baseUrl || process.env.LLM_BASE_URL || 'https://llm.chutes.ai',
      temperature: config.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || '0.1'),
      topP: config.topP ?? parseFloat(process.env.LLM_TOP_P || '0.9'),
      timeoutMs: config.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
      apiKey: config.apiKey || process.env.CHUTES_API_KEY || '',
    };

    if (!this.config.apiKey) {
      console.warn('⚠️  CHUTES_API_KEY not set. API calls may fail.');
      console.warn('   Get your API key from https://chutes.ai/app/api');
    }
  }

  async generateAction(prompt: string): Promise<string> {
    // Split prompt into system and user parts (separated by double newline after system)
    const parts = prompt.split('\n\n');
    const systemContent = parts[0];
    const userContent = parts.slice(1).join('\n\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const response = await this.chatCompletion(messages);
    return response.choices[0]?.message?.content || '';
  }

  /**
   * OpenAI-compatible chat completion
   */
  private async chatCompletion(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const body = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        top_p: this.config.topP,
        response_format: { type: 'json_object' }, // Request JSON output
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Chutes API error ${response.status}: ${errorText}`);
      }

      return await response.json() as ChatCompletionResponse;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Chutes request timed out after ${this.config.timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if Chutes API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
      });
      
      if (!response.ok) return [];
      
      const data = await response.json() as { data: Array<{ id: string }> };
      return data.data?.map(m => m.id) || [];
    } catch {
      return [];
    }
  }
}
