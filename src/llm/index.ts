export type { LLMProvider, LLMConfig } from './provider.js';
export { StubProvider } from './provider.js';
export { ChutesProvider } from './chutes.js';

import { ChutesProvider } from './chutes.js';
import { StubProvider } from './provider.js';
import type { LLMProvider, LLMConfig } from './provider.js';

/**
 * Create an LLM provider based on environment configuration
 */
export function createProvider(config?: Partial<LLMConfig>): LLMProvider {
  const providerType = process.env.LLM_PROVIDER || 'chutes';
  
  switch (providerType.toLowerCase()) {
    case 'chutes':
      return new ChutesProvider(config);
    
    case 'stub':
      return new StubProvider();
    
    default:
      console.warn(`Unknown LLM provider "${providerType}", falling back to Chutes`);
      return new ChutesProvider(config);
  }
}
