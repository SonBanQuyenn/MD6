import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { Paginated } from '../common/dto/pagination-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PublicUser, toPublicUser } from './user.mapper';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
  ) {}

  async getById(id: string): Promise<PublicUser> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return toPublicUser(user);
  }

  async list(query: ListUsersQueryDto): Promise<Paginated<PublicUser>> {
    const { page, limit, role } = query;
    const { items, total } = await this.users.findMany({
      skip: (page - 1) * limit,
      take: limit,
      role,
    });
    return {
      items: items.map(toPublicUser),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async changeRole(
    actorId: string,
    targetId: string,
    role: Role,
  ): Promise<PublicUser> {
    // Admin tự hạ quyền mình → có thể không còn ai quản trị hệ thống.
    if (actorId === targetId) {
      throw new BadRequestException(
        'Bạn không thể tự đổi vai trò của chính mình',
      );
    }
    await this.getById(targetId);
    const updated = await this.users.update(targetId, { role });
    // Vai trò mới có hiệu lực ngay ở lần đăng nhập/refresh tiếp theo:
    // thu hồi refresh token để buộc người dùng lấy token mới mang vai trò mới.
    await this.refreshTokens.revokeAllForUser(targetId);
    return toPublicUser(updated);
  }

  async changeStatus(
    actorId: string,
    targetId: string,
    isActive: boolean,
  ): Promise<PublicUser> {
    if (actorId === targetId) {
      throw new BadRequestException(
        'Bạn không thể tự khoá tài khoản của chính mình',
      );
    }
    await this.getById(targetId);
    const updated = await this.users.update(targetId, { isActive });
    if (!isActive) {
      await this.refreshTokens.revokeAllForUser(targetId);
    }
    return toPublicUser(updated);
  }
}
