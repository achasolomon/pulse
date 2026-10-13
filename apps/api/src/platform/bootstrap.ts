import { ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { HttpProblemFilter } from './common/filters/http-problem.filter.js';

/**
 * Single application pipeline shared by production bootstrap and tests
 * (SEC-001: tests verify the real headers/pipes/filters, not a copy).
 */
export function configureApp<T extends INestApplication>(app: T): T {
  app.use(helmet());
  app.enableCors();
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(app.get(HttpProblemFilter));
  app.enableShutdownHooks();
  return app;
}
