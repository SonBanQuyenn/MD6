import { Global, Module } from '@nestjs/common';
import { CacheMetrics } from './cache-metrics';
import { CacheMetricsController } from './cache-metrics.controller';
import { CacheService } from './cache.service';
import { CatalogCacheInvalidator } from './catalog-cache';

@Global()
@Module({
  controllers: [CacheMetricsController],
  providers: [CacheMetrics, CacheService, CatalogCacheInvalidator],
  exports: [CacheMetrics, CacheService, CatalogCacheInvalidator],
})
export class CacheModule {}
