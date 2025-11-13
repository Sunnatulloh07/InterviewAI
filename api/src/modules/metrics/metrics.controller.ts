import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Metrics Controller
 * Exposes Prometheus-compatible metrics endpoint
 */
@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Prometheus metrics endpoint
   * This endpoint is typically scraped by Prometheus or compatible monitoring tools
   */
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain')
  @ApiOperation({ summary: 'Get Prometheus metrics' })
  @ApiResponse({ status: 200, description: 'Prometheus metrics in text format' })
  @ApiExcludeEndpoint() // Hide from Swagger UI for security
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
