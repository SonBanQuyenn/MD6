import { HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  const makeIndicator = (ping: jest.Mock) =>
    new RedisHealthIndicator({ ping } as unknown as Redis);

  it('trả về up khi Redis trả lời PONG', async () => {
    const indicator = makeIndicator(jest.fn().mockResolvedValue('PONG'));

    await expect(indicator.pingCheck('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('ném HealthCheckError với status down khi Redis lỗi kết nối', async () => {
    const indicator = makeIndicator(
      jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    );

    const error = await indicator.pingCheck('redis').catch((e) => e);

    expect(error).toBeInstanceOf(HealthCheckError);
    expect(error.causes).toEqual({
      redis: { status: 'down', message: 'connect ECONNREFUSED' },
    });
  });

  it('coi phản hồi khác PONG là down', async () => {
    const indicator = makeIndicator(jest.fn().mockResolvedValue('LOADING'));

    await expect(indicator.pingCheck('redis')).rejects.toBeInstanceOf(
      HealthCheckError,
    );
  });
});
