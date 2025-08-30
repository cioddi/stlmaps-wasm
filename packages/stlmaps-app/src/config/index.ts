import { developmentConfig } from './environments/development';
import { productionConfig } from './environments/production';

type Environment = 'development' | 'production' | 'test';

const getEnvironment = (): Environment => {
  // Check Vite environment variable first
  if (import.meta.env.MODE === 'production') return 'production';
  if (import.meta.env.MODE === 'test') return 'test';
  return 'development';
};

const environment = getEnvironment();

// Configuration selection based on environment
const configurations = {
  development: developmentConfig,
  production: productionConfig,
  test: developmentConfig, // Use development config for tests
};

export const config = configurations[environment];

export type AppConfig = typeof config;

// Environment checks
export const isDevelopment = environment === 'development';
export const isProduction = environment === 'production';
export const isTest = environment === 'test';

// Configuration validation
const validateConfig = (config: typeof developmentConfig): void => {
  const requiredKeys = [
    'api.baseUrl',
    'tileServers.vectorTiles.url',
    'processing.maxConcurrentRequests',
  ];

  for (const key of requiredKeys) {
    const keys = key.split('.');
    let current: unknown = config;
    
    for (const k of keys) {
      if (!(k in current)) {
        throw new Error(`Missing required configuration key: ${key}`);
      }
      current = current[k];
    }
  }
};

// Validate configuration on load
try {
  validateConfig(config);
} catch (error) {
  console.error('Configuration validation failed:', error);
  throw error;
}

export { environment };