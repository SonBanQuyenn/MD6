import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @IsBoolean({ message: 'isActive phải là true hoặc false' })
  isActive!: boolean;
}
