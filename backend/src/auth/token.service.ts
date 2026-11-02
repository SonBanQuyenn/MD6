import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AccessTokenPayload } from '../common/types/auth-user';

export interface IssuedRefreshToken {
  /** Token gốc — chỉ gửi cho client trong cookie, KHÔNG lưu DB. */
  raw: string;
  /** SHA-256 của token gốc — thứ được lưu trong DB. */
  hash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
  }

  /** Access token JWT ngắn hạn (mặc định 15 phút). */
  signAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwt.signAsync(payload);
  }

  /**
   * Refresh token là chuỗi NGẪU NHIÊN (không phải JWT): 48 byte từ bộ sinh số
   * ngẫu nhiên an toàn → không thể đoán. Chỉ lưu hash để lộ DB không lộ token.
   */
  issueRefreshToken(now = new Date()): IssuedRefreshToken {
    const raw = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    return { raw, hash: this.hashRefreshToken(raw), expiresAt };
  }

  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  get refreshTtlMs(): number {
    return this.refreshTtlDays * 24 * 60 * 60 * 1000;
  }
}
