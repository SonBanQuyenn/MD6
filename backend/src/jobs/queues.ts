import { JobsOptions } from 'bullmq';

/** Tên các hàng đợi. Mỗi hàng đợi có cấu hình retry riêng phù hợp với loại việc. */
export const QUEUES = {
  EMAIL: 'email',
  INVOICE: 'invoice',
  INVENTORY_SYNC: 'inventory-sync',
  SCHEDULED: 'scheduled',
  SUPPORT: 'support',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

export const JOBS = {
  ORDER_CONFIRMATION: 'order-confirmation',
  PAYMENT_REMINDER: 'payment-reminder',
  VERIFICATION_CODE: 'verification-code',
  GENERATE_INVOICE: 'generate-invoice',
  SYNC_INVENTORY: 'sync-inventory',
  DAILY_REVENUE_REPORT: 'daily-revenue-report',
  OUTBOX_SWEEP: 'outbox-sweep',
  CLASSIFY_TICKET: 'classify-ticket',
} as const;

const DAY = 24 * 60 * 60;

/**
 * Chiến lược retry theo từng hàng đợi (F05.2):
 *  - attempts: số lần chạy tối đa (kể cả lần đầu)
 *  - backoff exponential: chờ delay, 2×delay, 4×delay… giữa các lần thử
 *  - removeOnComplete: giữ job đã xong 7 ngày để xem lại; job lỗi giữ 30 ngày.
 *    Trong thời gian còn giữ, thêm job TRÙNG jobId sẽ bị BullMQ bỏ qua.
 */
export const QUEUE_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  // SMTP thỉnh thoảng lỗi tạm thời → thử 5 lần: chờ 2s, 4s, 8s, 16s
  [QUEUES.EMAIL]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 7 * DAY, count: 5_000 },
    removeOnFail: { age: 30 * DAY },
  },
  [QUEUES.INVOICE]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { age: 7 * DAY, count: 5_000 },
    removeOnFail: { age: 30 * DAY },
  },
  // API đối tác có thể chết lâu → thử nhiều lần hơn, chờ lâu hơn: 5s, 10s, 20s … ~10 phút
  [QUEUES.INVENTORY_SYNC]: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 7 * DAY, count: 5_000 },
    removeOnFail: { age: 30 * DAY },
  },
  // Phân loại ticket: AI lỗi đã có từ khoá dự phòng bên trong → chỉ cần thử lại ít lần
  [QUEUES.SUPPORT]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 7 * DAY, count: 5_000 },
    removeOnFail: { age: 30 * DAY },
  },
  [QUEUES.SCHEDULED]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 7 * DAY, count: 1_000 },
    removeOnFail: { age: 30 * DAY },
  },
};

/**
 * jobId XÁC ĐỊNH TỪ NGHIỆP VỤ (không ngẫu nhiên) → cùng một việc luôn có cùng id,
 * thêm 2 lần thì BullMQ chỉ giữ 1. Lưu ý BullMQ cấm dấu ":" trong jobId.
 */
export const jobIds = {
  orderConfirmation: (orderId: string) => `order-confirmation-${orderId}`,
  paymentReminder: (orderId: string) => `payment-reminder-${orderId}`,
  verificationCode: (codeId: string) => `verification-code-${codeId}`,
  classifyTicket: (ticketId: string) => `classify-ticket-${ticketId}`,
  invoice: (orderId: string) => `invoice-${orderId}`,
  inventorySync: (orderId: string, event: 'placed' | 'cancelled') =>
    `inventory-sync-${orderId}-${event}`,
};

export interface OrderJobData {
  orderId: string;
}

/**
 * Job gửi mã xác thực mang theo MÃ GỐC (DB chỉ có HMAC nên worker không tự đọc được).
 * Vì vậy job này bị xoá khỏi Redis ngay khi xong (xem JobsProducer.verificationCode).
 */
export interface VerificationCodeJobData {
  codeId: string;
  code: string;
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD';
}

export interface TicketJobData {
  ticketId: string;
}

export interface InventorySyncJobData {
  orderId: string;
  event: 'placed' | 'cancelled';
}

export interface DailyReportJobData {
  /** YYYY-MM-DD theo giờ Việt Nam. Bỏ trống → ngày hiện tại. */
  date?: string;
}
