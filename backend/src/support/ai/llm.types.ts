import { TicketCategory } from '@prisma/client';

/**
 * Hợp đồng chung cho mọi nhà cung cấp LLM (TD-07). Service nghiệp vụ chỉ biết interface này,
 * nên đổi Claude ↔ Mock (test, CI, demo không có key) không phải sửa logic agent.
 */

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Định nghĩa tool trung lập — adapter tự đổi sang định dạng của nhà cung cấp. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema của tham số (object, có `required` và `additionalProperties: false`). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  /** Kết quả dạng JSON string gửi lại cho model. */
  content: string;
  isError: boolean;
}

export type StopReason =
  'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

/** Một lượt trả lời của model: văn bản và/hoặc yêu cầu gọi tool. */
export interface LlmTurn {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
}

/** Một cuộc hội thoại có trạng thái — adapter tự giữ lịch sử theo định dạng của mình. */
export interface LlmConversation {
  /** Lần đầu: không truyền gì. Các lần sau: kết quả của các tool model vừa yêu cầu. */
  next(toolResults?: ToolResult[]): Promise<LlmTurn>;
}

export interface Classification {
  category: TicketCategory;
  confidence: number;
  reason: string;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'mock';
  /** true = KHÔNG phải AI thật. UI và dữ liệu lưu trữ phải ghi nhãn rõ (yêu cầu PRD). */
  readonly isMock: boolean;
  readonly model: string;

  startConversation(input: {
    system: string;
    userText: string;
    tools: ToolDefinition[];
    /** Câu hỏi gốc của nhân viên — Mock dùng để chọn kịch bản. */
    question: string;
  }): LlmConversation;

  classify(text: string): Promise<Classification>;
}

/** Lỗi nhà cung cấp AI (mất mạng, hết hạn mức, key sai…) → service chuyển sang chế độ suy giảm. */
export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}
