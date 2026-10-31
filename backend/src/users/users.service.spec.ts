import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'target',
  email: 't@example.com',
  passwordHash: 'secret-hash',
  fullName: 'Target',
  role: Role.CUSTOMER,
  emailVerified: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UsersService', () => {
  let users: jest.Mocked<
    Pick<UsersRepository, 'findById' | 'findMany' | 'update'>
  >;
  let refreshTokens: jest.Mocked<
    Pick<RefreshTokensRepository, 'revokeAllForUser'>
  >;
  let service: UsersService;

  beforeEach(() => {
    users = { findById: jest.fn(), findMany: jest.fn(), update: jest.fn() };
    refreshTokens = { revokeAllForUser: jest.fn() };
    service = new UsersService(
      users as unknown as UsersRepository,
      refreshTokens as unknown as RefreshTokensRepository,
    );
  });

  it('getById không trả passwordHash', async () => {
    users.findById.mockResolvedValue(user());

    const result = await service.getById('target');

    expect(result).not.toHaveProperty('passwordHash');
  });

  it('getById → 404 khi không tồn tại', async () => {
    users.findById.mockResolvedValue(null);

    await expect(service.getById('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('list tính đúng skip và totalPages', async () => {
    users.findMany.mockResolvedValue({ items: [user()], total: 45 });

    const result = await service.list({ page: 3, limit: 20 });

    expect(users.findMany).toHaveBeenCalledWith({
      skip: 40,
      take: 20,
      role: undefined,
    });
    expect(result.totalPages).toBe(3);
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });

  it('changeRole cập nhật vai trò và thu hồi refresh token', async () => {
    users.findById.mockResolvedValue(user());
    users.update.mockResolvedValue(user({ role: Role.WAREHOUSE_STAFF }));

    const result = await service.changeRole(
      'admin',
      'target',
      Role.WAREHOUSE_STAFF,
    );

    expect(result.role).toBe(Role.WAREHOUSE_STAFF);
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('target');
  });

  it('admin không thể tự đổi vai trò của chính mình', async () => {
    await expect(
      service.changeRole('admin', 'admin', Role.CUSTOMER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('khoá tài khoản → thu hồi mọi phiên đăng nhập', async () => {
    users.findById.mockResolvedValue(user());
    users.update.mockResolvedValue(user({ isActive: false }));

    await service.changeStatus('admin', 'target', false);

    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('target');
  });

  it('mở khoá tài khoản → không thu hồi phiên', async () => {
    users.findById.mockResolvedValue(user({ isActive: false }));
    users.update.mockResolvedValue(user());

    await service.changeStatus('admin', 'target', true);

    expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('admin không thể tự khoá chính mình', async () => {
    await expect(
      service.changeStatus('admin', 'admin', false),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
