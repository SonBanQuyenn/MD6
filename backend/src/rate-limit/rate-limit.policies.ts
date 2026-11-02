/**
 * Hạn mức tần suất (F03.1). Mỗi chính sách = tối đa `limit` request trong `windowMs`
 * cho MỘT định danh (tài khoản nếu đã đăng nhập, IP nếu chưa — F03.2).
 *
 * - `global` áp cho MỌI request API.
 * - Các chính sách còn lại gắn thêm vào endpoint nhạy cảm bằng @RateLimit('<tên>'),
 *   tức endpoint đó phải qua CẢ hạn mức chung LẪN hạn mức riêng.
 */
export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  /** Lời nhắc tiếng Việt khi vượt hạn mức (F03.3). */
  message: string;
}

export type PolicyName = 'global' | 'login' | 'verificationCode' | 'promoOrder';

const MINUTE = 60_000;

export function buildPolicies(globalPerMinute: number) {
  return {
    global: {
      limit: globalPerMinute,
      windowMs: MINUTE,
      message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau {s} giây.',
    },
    // Đăng nhập: chưa có tài khoản → luôn đếm theo IP
    login: {
      limit: 5,
      windowMs: MINUTE,
      message:
        'Bạn đã thử đăng nhập quá nhiều lần, vui lòng thử lại sau {s} giây.',
    },
    // Gửi mã xác thực tốn tiền (email/SMS) và dễ bị lạm dụng để "spam" hộp thư người khác
    verificationCode: {
      limit: 3,
      windowMs: 15 * MINUTE,
      message:
        'Bạn đã yêu cầu gửi mã quá nhiều lần, vui lòng thử lại sau {s} giây.',
    },
    // Đơn khuyến mãi: chặn "bot săn mã" đặt liên tục
    promoOrder: {
      limit: 3,
      windowMs: MINUTE,
      message:
        'Bạn đặt đơn khuyến mãi quá nhanh, vui lòng thử lại sau {s} giây.',
    },
  } satisfies Record<PolicyName, RateLimitPolicy>;
}

export type RateLimitPolicies = ReturnType<typeof buildPolicies>;

/** "Vui lòng thử lại sau {s} giây" → điền số giây. */
export function formatMessage(policy: RateLimitPolicy, retryAfterSec: number) {
  return policy.message.replace('{s}', String(retryAfterSec));
}
