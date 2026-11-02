import {
  Classification,
  LlmConversation,
  LlmProvider,
  LlmTurn,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from './llm.types';
import { classifyByKeywords } from './keyword-classifier';

export const MOCK_LABEL = '[MOCK AI — không phải phản hồi AI thật]';

const ORDER_CODE = /SF-\d{8}-[A-F0-9]{8}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SKU = /\bSKU[:\s]+([A-Z0-9-]{2,40})/i;
const IN_SCOPE =
  /(đơn|hàng|sản phẩm|tồn|kho|giao|huỷ|hủy|thanh toán|hoàn|đổi trả|sku|sf-|khách)/i;

/**
 * Nhà cung cấp GIẢ LẬP (TD-07) — chạy test/CI/demo khi không có API key.
 * Theo kịch bản cố định nhưng VẪN gọi tool thật, nên dữ liệu trong câu trả lời là dữ liệu DB thật.
 * Mọi câu trả lời đều mở đầu bằng nhãn MOCK; API cũng trả `mock: true` để UI hiển thị cảnh báo.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly isMock = true;
  readonly model = 'mock-scripted-v1';

  startConversation(input: {
    tools: ToolDefinition[];
    question: string;
  }): LlmConversation {
    const plan = planToolCalls(input.question);
    let round = 0;
    const results: ToolResult[] = [];

    return {
      next: async (toolResults?: ToolResult[]): Promise<LlmTurn> => {
        if (toolResults) results.push(...toolResults);
        const step = plan.steps[round++];
        if (step) {
          // Lượt sau phụ thuộc kết quả lượt trước (vd: cần id đơn thật mới đề xuất huỷ được)
          const calls = step(results);
          if (calls.length > 0) {
            return { text: '', toolCalls: calls, stopReason: 'tool_use' };
          }
        }
        return {
          text: `${MOCK_LABEL}\n${plan.finalText ?? summarize(results)}`,
          toolCalls: [],
          stopReason: 'end_turn',
        };
      },
    };
  }

  async classify(text: string): Promise<Classification> {
    return classifyByKeywords(text);
  }
}

type Step = (previous: ToolResult[]) => ToolCall[];

function planToolCalls(question: string): {
  steps: Step[];
  finalText?: string;
} {
  if (!IN_SCOPE.test(question)) {
    return {
      steps: [],
      finalText:
        'Xin lỗi, tôi chỉ hỗ trợ các câu hỏi về đơn hàng, sản phẩm và dịch vụ của ShopFast.',
    };
  }
  const orderRef = question.match(ORDER_CODE)?.[0] ?? question.match(UUID)?.[0];
  const skuRef = question.match(SKU)?.[1];
  const wantsCancel = /(huỷ|hủy)/i.test(question);
  const steps: Step[] = [];

  const first: ToolCall[] = [];
  if (orderRef) {
    first.push(call('get_order_status', { order: orderRef }));
  }
  if (skuRef) {
    first.push(call('check_product_inventory', { product: skuRef }));
  }
  if (first.length === 0) {
    return {
      steps: [],
      finalText:
        'Tôi cần mã đơn hàng (dạng SF-…) hoặc mã SKU sản phẩm để tra cứu dữ liệu thật — tôi không đoán thông tin.',
    };
  }
  steps.push(() => first);

  if (orderRef && wantsCancel) {
    steps.push((previous) => {
      const order = parse(previous[0]);
      if (!order?.found) return [];
      return [
        call('propose_cancel_order', {
          order: String(order.code),
          reason: 'Khách yêu cầu huỷ đơn (đề xuất từ trợ lý MOCK)',
        }),
      ];
    });
  }
  return { steps };
}

let seq = 0;
function call(name: string, input: Record<string, unknown>): ToolCall {
  seq += 1;
  return { id: `mock_tool_${seq}`, name, input };
}

function parse(result?: ToolResult): Record<string, unknown> | null {
  if (!result || result.isError) return null;
  try {
    return JSON.parse(result.content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Tóm tắt dựa HOÀN TOÀN trên kết quả tool — không thêm dữ liệu nào khác. */
function summarize(results: ToolResult[]): string {
  const lines = results.map((r) => {
    const data = parse(r);
    if (!data) return '- Tra cứu thất bại, vui lòng kiểm tra thủ công.';
    if (data.found === false) return `- Không tìm thấy: ${String(data.query)}.`;
    if (data.pendingActionId) {
      return `- Đã tạo đề xuất huỷ đơn ${String(data.orderCode)} — CHỜ NHÂN VIÊN DUYỆT, chưa thực hiện.`;
    }
    if (data.code) {
      return `- Đơn ${String(data.code)}: ${String(data.statusLabel)}, thanh toán ${String(data.paymentStatus)}, tổng ${String(data.total)}đ.`;
    }
    if (data.sku) {
      return `- Sản phẩm ${String(data.name)} (SKU ${String(data.sku)}): tồn kho ${String(data.stock)}.`;
    }
    return '- (không có dữ liệu)';
  });
  return `Kết quả tra cứu:\n${lines.join('\n')}`;
}
