import { Role } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateUserRoleDto {
  @IsEnum(Role, {
    message: `role phải là một trong: ${Object.values(Role).join(', ')}`,
  })
  role!: Role;
}
