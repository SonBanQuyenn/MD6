import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /api/users/me — thông tin tài khoản đang đăng nhập (mọi vai trò). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.getById(user.id);
  }

  /** GET /api/users — danh sách người dùng (chỉ ADMIN). */
  @Get()
  @Roles(Role.ADMIN)
  list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  /** PATCH /api/users/:id/role — đổi vai trò (chỉ ADMIN). */
  @Patch(':id/role')
  @Roles(Role.ADMIN)
  changeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.changeRole(actor.id, id, dto.role);
  }

  /** PATCH /api/users/:id/status — khoá / mở khoá tài khoản (chỉ ADMIN). */
  @Patch(':id/status')
  @Roles(Role.ADMIN)
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.changeStatus(actor.id, id, dto.isActive);
  }
}
