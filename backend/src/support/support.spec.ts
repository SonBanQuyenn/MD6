import Anthropic from '@anthropic-ai/sdk';
import { ServiceUnavailableException } from '@nestjs/common';
import {
  ClassifiedBy,
  OrderStatus,
  PendingActionStatus,
  Role,
  TicketCategory,
} from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import {
  AnthropicProvider,
  parseClassification,
} from './ai/anthropic.provider';
import { classifyByKeywords } from './ai/keyword-classifier';
import {
  LlmConversation,
  LlmProvider,
  LlmTurn,
  LlmUnavailableError,
  ToolResult,
} from './ai/llm.types';
import { MOCK_LABEL, MockLlmProvider } from './ai/mock.provider';
import { AssistantService, MAX_TOOL_ROUNDS } from './assistant.service';
import { checkAnswer, GUARDRAIL_MESSAGE } from './guardrails';
import { PendingActionsService } from './pending-actions.service';
import { ExecutedToolCall, SupportTools } from './support-tools';
import { TicketClassifierService } from './ticket-classifier.service';
import { TicketDetail, TicketsRepository } from './tickets.repository';

const agent = { id: 'agent-1', email: 'cs@x.com', role: Role.SUPPORT_AGENT };
const CODE = 'SF-20261102-ABCDEF12';

const orderLookup = (overrides: Partial<ExecutedToolCall> = {}) =>
  ({
    name: 'get_order_status',
    input: { order: CODE },
    output: { found: true, code: CODE, status: 'SHIPPING' },
    success: true,
    durationMs: 3,
    ...overrides,
  }) as ExecutedToolCall;

describe('Guardrail chống bịa (F01.3)', () => {
  it('cho phép mã đơn có trong dữ liệu tool', () => {
    expect(checkAnswer(`Đơn ${CODE} đang giao`, [orderLookup()]).allowed).toBe(
      true,
    );
  });

  it('chặn mã đơn KHÔNG được tra cứu', () => {
    const result = checkAnswer('Đơn SF-20261102-00000000 đang giao', [
      orderLookup(),
    ]);
    expect(result.allowed).toBe(false);
  });

  it('chặn mã đơn khi tool tra cứu bị lỗi', () => {
    expect(
      checkAnswer(`Đơn ${CODE} đang giao`, [orderLookup({ success: false })])
        .allowed,
    ).toBe(false);
  });

  it('mã đơn có trong ngữ cảnh ticket (do hệ thống cung cấp) → hợp lệ', () => {
    expect(
      checkAnswer(`Ticket về đơn ${CODE}`, [], `Đơn: ${CODE}`).allowed,
    ).toBe(true);
  });

  it('chặn số tồn kho không có / không khớp dữ liệu', () => {
    expect(checkAnswer('Sản phẩm còn 12 sản phẩm', []).allowed).toBe(false);
    const inventory = {
      name: 'check_product_inventory',
      input: {},
      output: { stock: 7 },
      success: true,
      durationMs: 1,
    };
    expect(checkAnswer('Tồn kho: 7', [inventory]).allowed).toBe(true);
    expect(checkAnswer('tồn kho là 8', [inventory]).allowed).toBe(false);
  });

  it('không nhầm giá tiền với số tồn kho', () => {
    expect(checkAnswer('Giá còn 500000đ sau giảm', []).allowed).toBe(true);
  });
});

describe('Phân loại dự phòng bằng từ khoá', () => {
  it.each([
    ['Tôi muốn hoàn tiền đơn hàng', TicketCategory.RETURN_REFUND],
    ['Shipper giao hàng chậm quá', TicketCategory.SHIPPING],
    ['Không đăng nhập được tài khoản', TicketCategory.ACCOUNT],
    ['Đơn hàng của tôi đang ở trạng thái nào', TicketCategory.ORDER_STATUS],
    ['Xin chào', TicketCategory.OTHER],
  ])('"%s" → %s', (text, category) => {
    expect(classifyByKeywords(text).category).toBe(category);
  });
});

describe('MockLlmProvider', () => {
  const provider = new MockLlmProvider();
  const start = (question: string) =>
    provider.startConversation({ tools: [], question });

  it('câu hỏi ngoài phạm vi → từ chối, không gọi tool, có nhãn MOCK', async () => {
    const turn = await start('Thủ đô của Pháp là gì?').next();
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toContain(MOCK_LABEL);
    expect(turn.text).toMatch(/chỉ hỗ trợ/);
  });

  it('có mã đơn → gọi get_order_status, rồi tóm tắt từ kết quả tool', async () => {
    const conv = start(`Kiểm tra đơn ${CODE} giúp tôi`);
    const first = await conv.next();
    expect(first.toolCalls[0]).toMatchObject({
      name: 'get_order_status',
      input: { order: CODE },
    });
    const final = await conv.next([
      {
        toolCallId: first.toolCalls[0].id,
        isError: false,
        content: JSON.stringify({
          found: true,
          code: CODE,
          statusLabel: 'Đang giao',
          paymentStatus: 'PAID',
          total: 100000,
        }),
      },
    ]);
    expect(final.text).toContain('Đang giao');
  });

  it('yêu cầu huỷ → đề xuất huỷ SAU KHI đã tra cứu đơn có thật', async () => {
    const conv = start(`Khách muốn huỷ đơn ${CODE}`);
    const first = await conv.next();
    const second = await conv.next([
      {
        toolCallId: first.toolCalls[0].id,
        isError: false,
        content: JSON.stringify({ found: true, code: CODE }),
      },
    ]);
    expect(second.toolCalls[0].name).toBe('propose_cancel_order');
  });

  it('thiếu mã đơn / SKU → hỏi lại, không đoán', async () => {
    const turn = await start('Đơn hàng của khách đang ở đâu?').next();
    expect(turn.toolCalls).toEqual([]);
    expect(turn.text).toMatch(/cần mã đơn hàng/);
  });
});

describe('AnthropicProvider (client giả — không gọi API thật)', () => {
  function fakeClient(responses: unknown[], error?: Error) {
    const sent: unknown[] = [];
    const create = jest.fn(async (params: unknown) => {
      sent.push(JSON.parse(JSON.stringify(params))); // chụp lại tại thời điểm gọi
      if (error) throw error;
      return responses.shift();
    });
    return {
      create,
      sent,
      client: { beta: { messages: { create } } } as unknown as Anthropic,
    };
  }
  const options = {
    apiKey: 'x',
    model: 'claude-opus-5-5',
    timeoutMs: 1000,
    maxRetries: 0,
  };

  it('chuyển tool_use → ToolCall và gửi kết quả tool trong 1 message user', async () => {
    const { client, sent } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Để tôi tra cứu.' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'get_order_status',
            input: { order: CODE },
          },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Xong' }] },
    ]);
    const provider = new AnthropicProvider(options, client);
    const conv = provider.startConversation({
      system: 's',
      userText: 'u',
      tools: [{ name: 'get_order_status', description: 'd', inputSchema: {} }],
    });
    const first = await conv.next();
    expect(first.toolCalls).toEqual([
      { id: 'tu_1', name: 'get_order_status', input: { order: CODE } },
    ]);
    await conv.next([{ toolCallId: 'tu_1', content: '{}', isError: false }]);

    const params = sent[1] as {
      messages: { role: string; content: unknown }[];
      model: string;
      fallbacks: string;
    };
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.fallbacks).toBe('default');
    expect(params.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(params.messages[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tu_1',
        content: '{}',
        is_error: false,
      },
    ]);
  });

  it('lỗi SDK → LlmUnavailableError', async () => {
    const { client } = fakeClient([], new Error('network down'));
    const provider = new AnthropicProvider(options, client);
    await expect(provider.classify('abc')).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });

  it('parseClassification kiểm tra lại JSON của model', () => {
    expect(
      parseClassification(
        '{"category":"PAYMENT","confidence":1.4,"reason":"x"}',
      ),
    ).toEqual({ category: 'PAYMENT', confidence: 1, reason: 'x' });
    expect(() => parseClassification('không phải json')).toThrow(
      LlmUnavailableError,
    );
    expect(() =>
      parseClassification('{"category":"HACK","confidence":1,"reason":""}'),
    ).toThrow(LlmUnavailableError);
  });
});

describe('AssistantService — vòng lặp agent', () => {
  const ticket = {
    id: 't1',
    customerId: 'c1',
    subject: 'Hỏi đơn',
    customer: { fullName: 'Khách' },
    order: null,
    messages: [],
  } as unknown as TicketDetail;

  /** Provider giả: trả lần lượt các lượt đã định sẵn. */
  function scripted(turns: LlmTurn[], error?: Error): LlmProvider {
    return {
      name: 'mock',
      isMock: true,
      model: 'test',
      classify: jest.fn(),
      startConversation: (): LlmConversation => ({
        next: async () => {
          if (error) throw error;
          return turns.shift()!;
        },
      }),
    };
  }

  function setup(provider: LlmProvider) {
    const tickets = { addMessage: jest.fn() };
    const tools = {
      definitions: () => [],
      execute: jest.fn(async (call) => ({
        result: {
          toolCallId: call.id,
          content: '{}',
          isError: false,
        } as ToolResult,
        record: orderLookup(),
      })),
    };
    const service = new AssistantService(
      provider,
      tools as unknown as SupportTools,
      tickets as unknown as TicketsRepository,
    );
    return { service, tools, tickets };
  }

  const toolTurn: LlmTurn = {
    text: '',
    stopReason: 'tool_use',
    toolCalls: [{ id: '1', name: 'get_order_status', input: { order: CODE } }],
  };

  it('gọi tool rồi trả lời; lưu câu hỏi + câu trả lời dạng nội bộ', async () => {
    const { service, tools, tickets } = setup(
      scripted([
        toolTurn,
        {
          text: `Đơn ${CODE} đang giao`,
          toolCalls: [],
          stopReason: 'end_turn',
        },
      ]),
    );
    const result = await service.ask(ticket, agent, 'Đơn này sao rồi?');
    expect(tools.execute).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe(`Đơn ${CODE} đang giao`);
    expect(result.guardrail.blocked).toBe(false);
    expect(tickets.addMessage).toHaveBeenCalledTimes(2);
    expect(
      tickets.addMessage.mock.calls.every(([m]) => m.internal === true),
    ).toBe(true);
  });

  it(`dừng sau ${MAX_TOOL_ROUNDS} vòng tool (chống vòng lặp vô hạn)`, async () => {
    const turns = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => toolTurn);
    const { service, tools } = setup(scripted(turns));
    const result = await service.ask(ticket, agent, 'Đơn?');
    expect(tools.execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(result.answer).toMatch(/quá nhiều bước/);
  });

  it('câu trả lời bịa mã đơn → bị guardrail thay bằng thông báo an toàn', async () => {
    const { service } = setup(
      scripted([
        {
          text: 'Đơn SF-20261102-99999999 đã giao',
          toolCalls: [],
          stopReason: 'end_turn',
        },
      ]),
    );
    const result = await service.ask(ticket, agent, 'Đơn?');
    expect(result.answer).toBe(GUARDRAIL_MESSAGE);
    expect(result.guardrail.blocked).toBe(true);
  });

  it('nhà cung cấp AI lỗi → 503 kèm thông báo, có ghi chú hệ thống', async () => {
    const { service, tickets } = setup(
      scripted([], new LlmUnavailableError('down')),
    );
    await expect(service.ask(ticket, agent, 'Đơn?')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(tickets.addMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorType: 'SYSTEM' }),
    );
  });
});

describe('PendingActionsService — con người duyệt (F01.4)', () => {
  const action = {
    id: 'a1',
    ticketId: 't1',
    actionType: 'CANCEL_ORDER',
    payload: { orderId: 'o1', orderCode: CODE },
  };

  function setup(claim = true) {
    const tickets = {
      findPendingAction: jest.fn().mockResolvedValue(action),
      claimPendingAction: jest.fn().mockResolvedValue(claim),
      finishPendingAction: jest.fn(),
      addMessage: jest.fn(),
    };
    const orders = {
      changeStatusByStaff: jest.fn().mockResolvedValue({
        id: 'o1',
        code: CODE,
        status: OrderStatus.CANCELLED,
      }),
    };
    const service = new PendingActionsService(
      tickets as unknown as TicketsRepository,
      orders as unknown as OrdersService,
    );
    return { service, tickets, orders };
  }

  it('duyệt → mới gọi OrdersService huỷ đơn (kiểm tra nghiệp vụ lại)', async () => {
    const { service, orders, tickets } = setup();
    const result = await service.approve(agent, 'a1');
    expect(orders.changeStatusByStaff).toHaveBeenCalledWith(
      agent,
      'o1',
      OrderStatus.CANCELLED,
      expect.any(String),
    );
    expect(result.status).toBe(PendingActionStatus.EXECUTED);
    expect(tickets.finishPendingAction).toHaveBeenCalledWith(
      'a1',
      PendingActionStatus.EXECUTED,
      expect.anything(),
    );
  });

  it('đề xuất đã được xử lý → 409, không huỷ lần 2', async () => {
    const { service, orders } = setup(false);
    await expect(service.approve(agent, 'a1')).rejects.toThrow(/đã được xử lý/);
    expect(orders.changeStatusByStaff).not.toHaveBeenCalled();
  });

  it('thực thi lỗi (đơn đã giao) → đánh dấu FAILED', async () => {
    const { service, orders, tickets } = setup();
    orders.changeStatusByStaff.mockRejectedValue(new Error('đơn đã giao'));
    await expect(service.approve(agent, 'a1')).rejects.toThrow(/đơn đã giao/);
    expect(tickets.finishPendingAction).toHaveBeenCalledWith(
      'a1',
      PendingActionStatus.FAILED,
      { error: 'đơn đã giao' },
    );
  });

  it('từ chối → không đụng tới đơn hàng', async () => {
    const { service, orders } = setup();
    await service.reject(agent, 'a1', 'Khách đổi ý');
    expect(orders.changeStatusByStaff).not.toHaveBeenCalled();
  });
});

describe('TicketClassifierService', () => {
  const ticketText = {
    subject: 'Hoàn tiền',
    classifiedBy: null,
    messages: [{ content: 'Tôi muốn hoàn tiền đơn hàng' }],
  };

  function setup(provider: Partial<LlmProvider>, text = ticketText) {
    const tickets = {
      findTextForClassification: jest.fn().mockResolvedValue(text),
      saveClassification: jest.fn().mockResolvedValue(true),
    };
    const service = new TicketClassifierService(
      { isMock: false, ...provider } as LlmProvider,
      tickets as unknown as TicketsRepository,
    );
    return { service, tickets };
  }

  it('AI phân loại → classifiedBy = AI', async () => {
    const { service } = setup({
      classify: jest.fn().mockResolvedValue({
        category: TicketCategory.PAYMENT,
        confidence: 0.9,
        reason: 'x',
      }),
    });
    await expect(service.classify('t1')).resolves.toMatchObject({
      by: ClassifiedBy.AI,
      classification: { category: TicketCategory.PAYMENT },
    });
  });

  it('AI lỗi → dùng từ khoá dự phòng (FALLBACK), ticket vẫn được phân loại', async () => {
    const { service } = setup({
      classify: jest.fn().mockRejectedValue(new LlmUnavailableError('x')),
    });
    await expect(service.classify('t1')).resolves.toMatchObject({
      by: ClassifiedBy.FALLBACK,
      classification: { category: TicketCategory.RETURN_REFUND },
    });
  });

  it('chạy MOCK → ghi FALLBACK, không gắn nhãn AI', async () => {
    const classify = jest.fn();
    const { service } = setup({ isMock: true, classify });
    await expect(service.classify('t1')).resolves.toMatchObject({
      by: ClassifiedBy.FALLBACK,
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('nhân viên đã phân loại tay → AI không ghi đè', async () => {
    const { service, tickets } = setup({ classify: jest.fn() }, {
      ...ticketText,
      classifiedBy: ClassifiedBy.HUMAN,
    } as never);
    await expect(service.classify('t1')).resolves.toMatchObject({
      status: 'skipped',
    });
    expect(tickets.saveClassification).not.toHaveBeenCalled();
  });
});
