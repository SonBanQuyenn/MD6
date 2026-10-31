import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../types/auth-user';

/**
 * Chạy SAU JwtAuthGuard. Endpoint không gắn @Roles() → mọi người đã đăng nhập đều vào được.
 * Có @Roles(...) → vai trò của người dùng phải nằm trong danh sách, nếu không trả 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user && requiredRoles.includes(user.role)) return true;

    throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
  }
}
