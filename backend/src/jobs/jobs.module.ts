import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FailedJobsRepository } from './failed-jobs.repository';
import { JobsProducer } from './jobs.producer';
import { OutboxDispatcher } from './outbox.dispatcher';
import { OutboxRepository } from './outbox.repository';
import { ALL_QUEUES } from './queues';
import { bullConnection } from './redis-connection';

/**
 * Hàng đợi BullMQ dùng chung.
 *  - API:    JobsModule.forRoot('producer') — chỉ thêm job
 *  - Worker: JobsModule.forRoot('worker')   — thêm + xử lý job
 */
@Module({})
export class JobsModule {
  static forRoot(role: 'producer' | 'worker'): DynamicModule {
    return {
      module: JobsModule,
      global: true,
      imports: [
        BullModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: bullConnection(
              config.getOrThrow<string>('REDIS_URL'),
              role,
            ),
            // Tách dữ liệu hàng đợi của ShopFast khỏi các khoá khác trong Redis
            prefix: 'shopfast',
          }),
        }),
        BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
      ],
      providers: [
        JobsProducer,
        OutboxRepository,
        OutboxDispatcher,
        FailedJobsRepository,
      ],
      exports: [
        BullModule,
        JobsProducer,
        OutboxRepository,
        OutboxDispatcher,
        FailedJobsRepository,
      ],
    };
  }
}
