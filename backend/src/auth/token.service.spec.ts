import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const jwt = new JwtService({
    secret: 'test-secret-that-is-at-least-32-characters-long',
    signOptions: { expiresIn: '15m' },
  });
  const config = {
    get: jest.fn().mockReturnValue(7),
  } as unknown as ConfigService;
  const service = new TokenService(jwt, config);

  it('access token chứa id, email, role và có hạn sử dụng', async () => {
    const token = await service.signAccessToken({
      id: 'user-1',
      email: 'a@example.com',
      role: Role.ADMIN,
    });

    const payload = await jwt.verifyAsync(token);
    expect(payload).toMatchObject({
      sub: 'user-1',
      email: 'a@example.com',
      role: Role.ADMIN,
    });
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it('refresh token ngẫu nhiên, không trùng nhau và hash khác token gốc', () => {
    const a = service.issueRefreshToken();
    const b = service.issueRefreshToken();

    expect(a.raw).not.toBe(b.raw);
    expect(a.raw.length).toBeGreaterThanOrEqual(64);
    expect(a.hash).not.toBe(a.raw);
    expect(a.hash).toBe(service.hashRefreshToken(a.raw));
  });

  it('refresh token hết hạn sau đúng số ngày cấu hình', () => {
    const now = new Date('2026-01-01T00:00:00Z');

    const { expiresAt } = service.issueRefreshToken(now);

    expect(expiresAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});
