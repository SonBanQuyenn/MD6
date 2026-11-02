import { Injectable } from '@nestjs/common';
import { RefreshToken, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findByHash(
    tokenHash: string,
  ): Promise<(RefreshToken & { user: User }) | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * Xoay vòng token trong 1 transaction: tạo token mới + thu hồi token cũ.
   * Điều kiện `revokedAt: null` đảm bảo 2 request refresh đồng thời với cùng 1 token
   * thì chỉ 1 request thành công (request kia nhận `null`).
   */
  async rotate(
    oldTokenId: string,
    next: { userId: string; tokenHash: string; expiresAt: Date },
  ): Promise<RefreshToken | null> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({ data: next });
      const { count } = await tx.refreshToken.updateMany({
        where: { id: oldTokenId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
      if (count === 0) {
        // Token cũ đã bị thu hồi bởi request khác → huỷ token vừa tạo.
        await tx.refreshToken.delete({ where: { id: created.id } });
        return null;
      }
      return created;
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
