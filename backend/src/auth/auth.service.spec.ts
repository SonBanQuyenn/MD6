import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, RefreshToken, Role, User } from '@prisma/client';
import { UsersRepository } from '../users/users.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { TokenService } from './token.service';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: '11111111-1111-1111-1111-111111111111',
  email: 'khach@example.com',
  passwordHash: 'hashed:Matkhau123',
  fullName: 'Khách Hàng',
  role: Role.CUSTOMER,
  emailVerified: false,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeStoredToken = (
  overrides: Partial<RefreshToken> = {},
  user: User = makeUser(),
): RefreshToken & { user: User } => ({
  id: 'token-1',
  userId: user.id,
  tokenHash: 'hash-of-old',
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  replacedById: null,
  createdAt: new Date(),
  user,
  ...overrides,
});

describe('AuthService', () => {
  let users: jest.Mocked<
    Pick<UsersRepository, 'findByEmail' | 'create' | 'findById'>
  >;
  let refreshTokens: jest.Mocked<
    Pick<
      RefreshTokensRepository,
      'create' | 'findByHash' | 'rotate' | 'revoke' | 'revokeAllForUser'
    >
  >;
  let passwords: jest.Mocked<Pick<PasswordService, 'hash' | 'compare'>>;
  let tokens: jest.Mocked<
    Pick<
      TokenService,
      'signAccessToken' | 'issueRefreshToken' | 'hashRefreshToken'
    >
  >;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };
    refreshTokens = {
      create: jest.fn(),
      findByHash: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    // Mật khẩu giả lập: hash(x) = "hashed:x" → dễ kiểm tra mà không chạy bcrypt chậm.
    passwords = {
      hash: jest.fn(async (plain: string) => `hashed:${plain}`),
      compare: jest.fn(
        async (plain: string, hash: string) => hash === `hashed:${plain}`,
      ),
    };
    tokens = {
      signAccessToken: jest.fn().mockResolvedValue('access-token'),
      issueRefreshToken: jest.fn().mockReturnValue({
        raw: 'new-raw',
        hash: 'hash-of-new',
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      }),
      hashRefreshToken: jest.fn((raw: string) => `hash-of-${raw}`),
    };
    service = new AuthService(
      users as unknown as UsersRepository,
      refreshTokens as unknown as RefreshTokensRepository,
      passwords as unknown as PasswordService,
      tokens as unknown as TokenService,
    );
  });

  describe('register', () => {
    const dto = {
      email: 'moi@example.com',
      password: 'Matkhau123',
      fullName: 'Người Mới',
    };

    it('băm mật khẩu, luôn tạo vai trò CUSTOMER và trả về phiên đăng nhập', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockImplementation(async (data) =>
        makeUser({
          email: data.email,
          passwordHash: data.passwordHash,
          role: data.role,
        }),
      );

      const result = await service.register(dto);

      expect(users.create).toHaveBeenCalledWith({
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: 'hashed:Matkhau123',
        role: Role.CUSTOMER,
      });
      expect(refreshTokens.create).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: 'hash-of-new' }),
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('new-raw');
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('trả 409 khi email đã tồn tại', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('trả 409 khi 2 request đăng ký trùng email cùng lúc (lỗi UNIQUE P2002)', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    it('đăng nhập thành công với mật khẩu đúng', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      const result = await service.login({
        email: 'khach@example.com',
        password: 'Matkhau123',
      });

      expect(result.user.email).toBe('khach@example.com');
      expect(refreshTokens.create).toHaveBeenCalled();
    });

    it('trả 401 khi sai mật khẩu', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expect(
        service.login({ email: 'khach@example.com', password: 'SaiMatKhau1' }),
      ).rejects.toThrow('Email hoặc mật khẩu không đúng');
    });

    it('email không tồn tại: vẫn chạy so khớp mật khẩu và trả cùng thông báo lỗi', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'khongco@example.com', password: 'Matkhau123' }),
      ).rejects.toThrow('Email hoặc mật khẩu không đúng');
      expect(passwords.compare).toHaveBeenCalledTimes(1);
    });

    it('trả 403 khi tài khoản bị khoá', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ isActive: false }));

      await expect(
        service.login({ email: 'khach@example.com', password: 'Matkhau123' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(refreshTokens.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('xoay vòng: thu hồi token cũ, cấp token mới', async () => {
      refreshTokens.findByHash.mockResolvedValue(makeStoredToken());
      refreshTokens.rotate.mockResolvedValue({} as RefreshToken);

      const result = await service.refresh('old');

      expect(refreshTokens.findByHash).toHaveBeenCalledWith('hash-of-old');
      expect(refreshTokens.rotate).toHaveBeenCalledWith(
        'token-1',
        expect.objectContaining({ tokenHash: 'hash-of-new' }),
      );
      expect(result.refreshToken).toBe('new-raw');
    });

    it('không có cookie → 401', async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('token không tồn tại → 401', async () => {
      refreshTokens.findByHash.mockResolvedValue(null);

      await expect(service.refresh('unknown')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('token đã bị thu hồi được dùng lại → thu hồi MỌI phiên của tài khoản', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        makeStoredToken({ revokedAt: new Date() }),
      );

      await expect(service.refresh('old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        makeUser().id,
      );
      expect(refreshTokens.rotate).not.toHaveBeenCalled();
    });

    it('token hết hạn → 401', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        makeStoredToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokens.revoke).toHaveBeenCalledWith('token-1');
    });

    it('tài khoản đã bị khoá → 401', async () => {
      refreshTokens.findByHash.mockResolvedValue(
        makeStoredToken({}, makeUser({ isActive: false })),
      );

      await expect(service.refresh('old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('2 request refresh đồng thời: request thua cuộc nhận 401', async () => {
      refreshTokens.findByHash.mockResolvedValue(makeStoredToken());
      refreshTokens.rotate.mockResolvedValue(null);

      await expect(service.refresh('old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('thu hồi token hiện tại', async () => {
      refreshTokens.findByHash.mockResolvedValue(makeStoredToken());

      await service.logout('old');

      expect(refreshTokens.revoke).toHaveBeenCalledWith('token-1');
    });

    it('không có cookie → không làm gì, không lỗi', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokens.findByHash).not.toHaveBeenCalled();
    });
  });
});
