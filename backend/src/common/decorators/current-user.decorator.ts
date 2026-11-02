import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

/** Lấy người dùng đang đăng nhập trong controller: `me(@CurrentUser() user: AuthUser)` */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);
