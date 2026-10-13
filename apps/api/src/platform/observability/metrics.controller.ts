import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from './metrics.registry.js';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  text(): string {
    return metricsRegistry.render();
  }
}
