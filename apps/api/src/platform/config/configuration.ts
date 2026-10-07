import { registerAs } from '@nestjs/config';

export interface ApiConfig {
  port: number;
  apiPrefix: string;
  env: string;
}

export default registerAs(
  'api',
  (): ApiConfig => ({
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    env: process.env.NODE_ENV ?? 'development',
  }),
);
