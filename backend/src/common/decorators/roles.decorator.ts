import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Chỉ cho phép các vai trò được liệt kê, ví dụ: @Roles(Role.ADMIN) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
