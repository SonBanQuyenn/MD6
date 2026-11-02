import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthResult, AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RegisterDto } from './dto/register.dto';
import {
  RequestVerificationCodeDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/verification.dto';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';
import { ApiTags } from '@nestjs/swagger';

export const REFRESH_COOKIE = 'sf_refresh';

@ApiTags('Auth — xác thực')
@Controller('auth')
@Public()
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    private readonly verification: VerificationService,
    tokens: TokenService,
    config: ConfigService,
  ) {
    this.cookieOptions = {
      httpOnly: true, // JavaScript trên trình duyệt không đọc được → chống XSS lấy token
      secure: config.get<boolean>('COOKIE_SECURE', false), // chỉ gửi qua HTTPS
      sameSite: 'strict', // không gửi kèm request từ trang web khác → chống CSRF
      path: '/api/auth', // chỉ gửi tới các endpoint xác thực
      maxAge: tokens.refreshTtlMs,
    };
  }

  /** POST /api/auth/register — đăng ký tài khoản khách hàng, đăng nhập luôn. */
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.authService.register(dto));
  }

  /** POST /api/auth/login — tối đa 5 lần / phút / IP + khoá leo thang theo tài khoản (F03). */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.authService.login(dto));
  }

  /** POST /api/auth/refresh — dùng cookie refresh token để lấy access token mới. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return this.respond(
        res,
        await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]),
      );
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, {
        ...this.cookieOptions,
        maxAge: undefined,
      });
      throw error;
    }
  }

  /** POST /api/auth/logout — thu hồi refresh token hiện tại và xoá cookie. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, {
      ...this.cookieOptions,
      maxAge: undefined,
    });
  }

  /** POST /api/auth/verification-code — gửi mã 6 số qua email (3 lần / 15 phút). */
  @Post('verification-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit('verificationCode')
  requestCode(@Body() dto: RequestVerificationCodeDto) {
    return this.verification.requestCode(dto.email, dto.purpose);
  }

  /** POST /api/auth/verify-email — nhập mã để xác minh email. */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit('verificationCode')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.verification.verifyEmail(dto.email, dto.code);
  }

  /** POST /api/auth/reset-password — đặt lại mật khẩu bằng mã. */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit('verificationCode')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.verification.resetPassword(
      dto.email,
      dto.code,
      dto.newPassword,
    );
  }

  /** Đặt refresh token vào cookie; body chỉ chứa access token + thông tin user. */
  private respond(res: Response, result: AuthResult) {
    res.cookie(REFRESH_COOKIE, result.refreshToken, this.cookieOptions);
    return { accessToken: result.accessToken, user: result.user };
  }
}
