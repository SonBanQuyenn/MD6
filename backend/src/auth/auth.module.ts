import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { VerificationCodesRepository } from './verification-codes.repository';
import { VerificationService } from './verification.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
        },
        // Chỉ chấp nhận đúng thuật toán đã ký → chặn tấn công đổi "alg".
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    VerificationCodesRepository,
    VerificationService,
    // Thứ tự quan trọng:
    //  1. rate limit — chạy ĐẦU TIÊN để cả request sai token / chưa đăng nhập cũng bị đếm (F03)
    //  2. xác thực (bạn là ai?)  3. phân quyền (bạn được làm gì?)
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
