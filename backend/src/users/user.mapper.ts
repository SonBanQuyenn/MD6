import { Role, User } from '@prisma/client';

/** Dữ liệu người dùng an toàn để trả cho client — KHÔNG có passwordHash. */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
