import { ExecutedToolCall } from './support-tools';

const ORDER_CODE = /SF-\d{8}-[A-F0-9]{8}/gi;
/** "tồn kho: 5", "còn 12 sản phẩm", "còn lại 3 cái"… (không bắt "còn 500.000đ") */
const STOCK_CLAIM =
  /(?:tồn kho\s*(?:là|:)?\s*(\d+))|(?:còn(?: lại)?\s*(\d+)\s*(?:sản phẩm|cái|chiếc|đơn vị))/gi;

export const GUARDRAIL_MESSAGE =
  'Trợ lý AI không đưa ra được câu trả lời đã kiểm chứng bằng dữ liệu thật cho câu hỏi này. ' +
  'Vui lòng tra cứu thủ công hoặc hỏi lại kèm mã đơn hàng / mã SKU.';

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Lớp chặn phía server chống BỊA THÔNG TIN (F01.3) — không chỉ dựa vào lời dặn trong prompt.
 *  1. Mọi mã đơn xuất hiện trong câu trả lời phải có trong dữ liệu tool đã trả về ở lượt này
 *     (hoặc trong ngữ cảnh ticket do hệ thống cung cấp).
 *  2. Mọi con số tồn kho phải khớp với `stock` mà tool kiểm tra tồn kho trả về.
 */
export function checkAnswer(
  answer: string,
  calls: ExecutedToolCall[],
  trustedContext = '',
): GuardrailResult {
  const evidence =
    calls
      .filter((c) => c.success)
      .map((c) => JSON.stringify(c.output))
      .join('\n')
      .toUpperCase() +
    '\n' +
    trustedContext.toUpperCase();

  for (const code of answer.match(ORDER_CODE) ?? []) {
    if (!evidence.includes(code.toUpperCase())) {
      return {
        allowed: false,
        reason: `Nhắc tới mã đơn ${code} nhưng không có dữ liệu tra cứu`,
      };
    }
  }

  const stocks = new Set(
    calls
      .filter((c) => c.success && c.name === 'check_product_inventory')
      .map((c) => c.output.stock)
      .filter((s): s is number => typeof s === 'number'),
  );
  for (const match of answer.matchAll(STOCK_CLAIM)) {
    const claimed = Number(match[1] ?? match[2]);
    if (!stocks.has(claimed)) {
      return {
        allowed: false,
        reason: `Nêu số tồn kho ${claimed} nhưng không khớp dữ liệu tra cứu`,
      };
    }
  }
  return { allowed: true };
}
