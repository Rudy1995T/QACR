export type { LLMProvider, LLMConfig } from './provider.js';
export { StubProvider } from './provider.js';
export { OllamaProvider } from './ollama.js';

import { OllamaProvider } from './ollama.js';
import { StubProvider } from './provider.js';
import type { LLMProvider, LLMConfig } from './provider.js';

/**
 * Create an LLM provider based on environment configuration
 */
export function createProvider(config?: Partial<LLMConfig>): LLMProvider {
  const providerType = process.env.LLM_PROVIDER || 'ollama';
  
  switch (providerType.toLowerCase()) {
    case 'ollama':
      return new OllamaProvider(config);
    
    case 'stub':
      return new StubProvider();
    
    // Future: add OpenAI-compatible provider here
    // case 'openai':
    //   return new OpenAIProvider(config);
    
    default:
      console.warn(`Unknown LLM provider "${providerType}", falling back to Ollama`);
      return new OllamaProvider(config);
  }
}
