import { Role } from '@prisma/client';

/** Thông tin người dùng lấy từ access token, gắn vào `request.user`. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Nội dung (payload) bên trong access token JWT. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}
