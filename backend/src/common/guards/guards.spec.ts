import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/** Tạo ExecutionContext giả với request và metadata cho trước. */
function makeContext(
  request: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
) {
  const handler = () => undefined;
  Object.entries(metadata).forEach(([key, value]) =>
    Reflect.defineMetadata(key, value, handler),
  );
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('extractBearerToken', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer abc.def', 'abc.def'],
  ])('%p → %p', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });
});

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({
    secret: 'test-secret-that-is-at-least-32-characters-long',
  });
  const guard = new JwtAuthGuard(jwt, new Reflector());

  it('cho qua endpoint @Public() mà không cần token', async () => {
    const ctx = makeContext({ headers: {} }, { [IS_PUBLIC_KEY]: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('không có token → 401', async () => {
    const ctx = makeContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token giả mạo (sai chữ ký) → 401', async () => {
    const forged = await new JwtService({
      secret: 'another-secret-that-is-at-least-32-chars',
    }).signAsync({ sub: 'x', email: 'x@x.com', role: Role.ADMIN });
    const ctx = makeContext({
      headers: { authorization: `Bearer ${forged}` },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token hết hạn → 401', async () => {
    const expired = await jwt.signAsync(
      { sub: 'u1', email: 'a@a.com', role: Role.CUSTOMER },
      { expiresIn: -10 },
    );
    const ctx = makeContext({
      headers: { authorization: `Bearer ${expired}` },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token hợp lệ → gắn user vào request', async () => {
    const token = await jwt.signAsync({
      sub: 'u1',
      email: 'a@a.com',
      role: Role.CUSTOMER,
    });
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      email: 'a@a.com',
      role: Role.CUSTOMER,
    });
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const asUser = (role: Role) => ({ user: { id: 'u', email: 'e', role } });

  it('endpoint không yêu cầu vai trò → cho qua', () => {
    expect(guard.canActivate(makeContext(asUser(Role.CUSTOMER)))).toBe(true);
  });

  it('vai trò nằm trong danh sách → cho qua', () => {
    const ctx = makeContext(asUser(Role.ADMIN), {
      [ROLES_KEY]: [Role.ADMIN, Role.WAREHOUSE_STAFF],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('vai trò không nằm trong danh sách → 403', () => {
    const ctx = makeContext(asUser(Role.CUSTOMER), {
      [ROLES_KEY]: [Role.ADMIN],
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
