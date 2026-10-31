import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mặc định MỌI endpoint đều cần đăng nhập (JwtAuthGuard toàn cục).
 * Gắn @Public() để mở một endpoint cho khách chưa đăng nhập.
 * → Quên gắn guard sẽ "an toàn mặc định" thay vì vô tình lộ endpoint.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
