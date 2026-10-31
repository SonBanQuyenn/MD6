import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PublicUser, toPublicUser } from '../users/user.mapper';
import { UsersRepository } from '../users/users.repository';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import { TokenService } from './token.service';

export interface AuthResult {
  accessToken: string;
  /** Token gốc để controller đặt vào cookie httpOnly — không trả trong body. */
  refreshToken: string;
  user: PublicUser;
}

const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng';
const INVALID_SESSION = 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash giả, dùng khi email không tồn tại để thời gian phản hồi giống như email có thật. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email đã được sử dụng');

    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.users.create({
        email: dto.email,
        fullName: dto.fullName,
        passwordHash,
        role: Role.CUSTOMER,
      });
    } catch (error) {
      // 2 request đăng ký cùng email cùng lúc: request thứ 2 vấp ràng buộc UNIQUE.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email đã được sử dụng');
      }
      throw error;
    }
    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);

    // Luôn chạy bcrypt.compare kể cả khi email không tồn tại, để kẻ tấn công
    // không đo được thời gian phản hồi mà đoán ra email nào đã đăng ký.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await this.passwords.compare(dto.password, hash);

    if (!user || !passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!user.isActive) {
      throw new ForbiddenException(
        'Tài khoản đã bị khoá, vui lòng liên hệ hỗ trợ',
      );
    }
    return this.issueSession(user);
  }

  /** Đổi refresh token cũ lấy cặp token mới (xoay vòng). */
  async refresh(rawRefreshToken: string | undefined): Promise<AuthResult> {
    if (!rawRefreshToken) throw new UnauthorizedException(INVALID_SESSION);

    const stored = await this.refreshTokens.findByHash(
      this.tokens.hashRefreshToken(rawRefreshToken),
    );
    if (!stored) throw new UnauthorizedException(INVALID_SESSION);

    if (stored.revokedAt) {
      // Token ĐÃ bị thu hồi mà vẫn có người dùng → có thể token đã bị đánh cắp.
      // Thu hồi mọi phiên của tài khoản để kẻ gian không dùng tiếp được.
      this.logger.warn(
        `Phát hiện tái sử dụng refresh token của user ${stored.userId}`,
      );
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(INVALID_SESSION);
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) {
      await this.refreshTokens.revoke(stored.id);
      throw new UnauthorizedException(INVALID_SESSION);
    }

    const next = this.tokens.issueRefreshToken();
    const rotated = await this.refreshTokens.rotate(stored.id, {
      userId: stored.userId,
      tokenHash: next.hash,
      expiresAt: next.expiresAt,
    });
    if (!rotated) throw new UnauthorizedException(INVALID_SESSION);

    return {
      accessToken: await this.tokens.signAccessToken(stored.user),
      refreshToken: next.raw,
      user: toPublicUser(stored.user),
    };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const stored = await this.refreshTokens.findByHash(
      this.tokens.hashRefreshToken(rawRefreshToken),
    );
    if (stored) await this.refreshTokens.revoke(stored.id);
  }

  private async issueSession(user: User): Promise<AuthResult> {
    const refresh = this.tokens.issueRefreshToken();
    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    return {
      accessToken: await this.tokens.signAccessToken(user),
      refreshToken: refresh.raw,
      user: toPublicUser(user),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash('dummy-password-for-timing');
    return this.dummyHash;
  }
}
