import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class EnvironmentVariables {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === '') return 3000;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseInt(value, 10);
    return 3000;
  })
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsOptional()
  @IsString()
  API_PREFIX: string = 'api/v1';

  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsOptional()
  @IsString()
  DATABASE_URL: string = '';

  @IsOptional()
  @IsString()
  REDIS_URL: string = '';
}

export function validateEnvironment(config: Record<string, unknown>) {
  return config;
}
