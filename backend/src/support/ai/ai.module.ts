import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from './anthropic.provider';
import { LLM_PROVIDER, LlmProvider } from './llm.types';
import { MockLlmProvider } from './mock.provider';

/**
 * Chọn nhà cung cấp AI theo AI_PROVIDER (TD-07). API key CHỈ nằm ở backend (biến môi trường / SSM),
 * frontend không bao giờ gọi LLM trực tiếp.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider => {
        const logger = new Logger('AiModule');
        if (config.get<string>('AI_PROVIDER') === 'anthropic') {
          const model = config.get<string>('AI_MODEL', 'claude-opus-5-5');
          logger.log(`Trợ lý AI: Anthropic Claude (${model})`);
          return new AnthropicProvider({
            apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
            model,
            timeoutMs: config.get<number>('AI_TIMEOUT_MS', 20_000),
            maxRetries: 2,
          });
        }
        logger.warn(
          'Trợ lý AI đang chạy MOCK (AI_PROVIDER=mock) — phản hồi KHÔNG phải AI thật',
        );
        return new MockLlmProvider();
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class AiModule {}
