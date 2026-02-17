import type { LLMProvider, LLMConfig } from './provider.js';

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/**
 * Ollama LLM provider using the local API
 */
export class OllamaProvider implements LLMProvider {
  private config: Required<LLMConfig>;
  private useChat: boolean;

  constructor(config: Partial<LLMConfig> = {}, useChat: boolean = true) {
    this.config = {
      model: config.model || process.env.LLM_MODEL || 'llama3.2:3b',
      baseUrl: config.baseUrl || process.env.LLM_BASE_URL || 'http://localhost:11434',
      temperature: config.temperature ?? parseFloat(process.env.LLM_TEMPERATURE || '0.1'),
      topP: config.topP ?? parseFloat(process.env.LLM_TOP_P || '0.9'),
      timeoutMs: config.timeoutMs ?? parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
    };
    this.useChat = useChat;
  }

  async generateAction(prompt: string): Promise<string> {
    if (this.useChat) {
      return this.generateChat(prompt);
    }
    return this.generateRaw(prompt);
  }

  /**
   * Use the /api/chat endpoint (recommended for instruction-tuned models)
   */
  private async generateChat(prompt: string): Promise<string> {
    // Split prompt into system and user parts (separated by double newline after system)
    const parts = prompt.split('\n\n');
    const systemContent = parts[0];
    const userContent = parts.slice(1).join('\n\n');

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const response = await this.makeRequest<OllamaChatResponse>('/api/chat', {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
      },
      format: 'json', // Request JSON output
    });

    return response.message.content;
  }

  /**
   * Use the /api/generate endpoint (raw completion)
   */
  private async generateRaw(prompt: string): Promise<string> {
    const response = await this.makeRequest<OllamaGenerateResponse>('/api/generate', {
      model: this.config.model,
      prompt,
      stream: false,
      options: {
        temperature: this.config.temperature,
        top_p: this.config.topP,
      },
      format: 'json',
    });

    return response.response;
  }

  private async makeRequest<T>(endpoint: string, body: object): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error ${response.status}: ${errorText}`);
      }

      return await response.json() as T;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`Ollama request timed out after ${this.config.timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if Ollama is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
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
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models.map(m => m.name);
    } catch {
      return [];
    }
  }
}
