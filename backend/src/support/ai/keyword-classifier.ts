import { TicketCategory } from '@prisma/client';
import { Classification } from './llm.types';

/**
 * Phân loại DỰ PHÒNG bằng từ khoá — dùng khi AI lỗi hoặc đang chạy Mock (TD-07, NFR-REL-04).
 * Kém thông minh hơn AI nhưng luôn chạy được, nên ticket không bao giờ bị "kẹt" chưa phân loại.
 * Thứ tự quan trọng: nhóm cụ thể (hoàn tiền) được xét trước nhóm chung (đơn hàng).
 */
const RULES: { category: TicketCategory; keywords: string[] }[] = [
  {
    category: TicketCategory.RETURN_REFUND,
    keywords: [
      'hoàn tiền',
      'đổi trả',
      'trả hàng',
      'đổi hàng',
      'refund',
      'hoàn lại',
    ],
  },
  {
    category: TicketCategory.PAYMENT,
    keywords: [
      'thanh toán',
      'chuyển khoản',
      'trừ tiền',
      'hoá đơn',
      'hóa đơn',
      'thẻ',
      'cod',
    ],
  },
  {
    category: TicketCategory.SHIPPING,
    keywords: [
      'giao hàng',
      'vận chuyển',
      'shipper',
      'chưa nhận',
      'giao chậm',
      'địa chỉ giao',
    ],
  },
  {
    category: TicketCategory.COMPLAINT,
    keywords: [
      'khiếu nại',
      'thất vọng',
      'tệ',
      'bực',
      'lừa',
      'hỏng',
      'vỡ',
      'lỗi',
    ],
  },
  {
    category: TicketCategory.ACCOUNT,
    keywords: [
      'tài khoản',
      'mật khẩu',
      'đăng nhập',
      'email',
      'bị khoá',
      'bị khóa',
    ],
  },
  {
    category: TicketCategory.ORDER_STATUS,
    keywords: [
      'đơn hàng',
      'trạng thái',
      'mã đơn',
      'huỷ đơn',
      'hủy đơn',
      'đặt hàng',
      'sf-',
    ],
  },
  {
    category: TicketCategory.PRODUCT_INQUIRY,
    keywords: [
      'sản phẩm',
      'còn hàng',
      'hết hàng',
      'tồn kho',
      'bảo hành',
      'giá',
      'size',
    ],
  },
];

export function classifyByKeywords(text: string): Classification {
  const normalized = text.toLowerCase();
  for (const rule of RULES) {
    const hit = rule.keywords.find((k) => normalized.includes(k));
    if (hit) {
      return {
        category: rule.category,
        confidence: 0.5,
        reason: `Từ khoá dự phòng: "${hit}"`,
      };
    }
  }
  return {
    category: TicketCategory.OTHER,
    confidence: 0.2,
    reason: 'Không khớp từ khoá nào',
  };
}
