export interface PulseAppConfig {
  port: number;
  apiPrefix: string;
  env: string;
}

export function defaultConfig(): PulseAppConfig {
  return { port: 3000, apiPrefix: 'api/v1', env: 'development' };
}
