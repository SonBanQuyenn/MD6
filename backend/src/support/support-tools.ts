import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ProductsService } from '../catalog/products/products.service';
import { canTransition } from '../orders/order-state-machine';
import { OrdersService } from '../orders/orders.service';
import { ToolCall, ToolDefinition, ToolResult } from './ai/llm.types';
import { TicketsRepository } from './tickets.repository';

export const CANCEL_ORDER = 'CANCEL_ORDER';

/** Ngữ cảnh khi chạy tool: ticket nào, nhân viên nào hỏi. */
export interface ToolContext {
  ticketId: string;
  ticketCustomerId: string;
  agentId: string;
}

export interface ExecutedToolCall {
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  success: boolean;
  durationMs: number;
}

/**
 * Bộ công cụ của trợ lý AI (F01.2, F01.4).
 *  - 2 tool ĐỌC lấy dữ liệu thật qua TẦNG NGHIỆP VỤ (OrdersService, ProductsService).
 *  - 1 tool GHI nhưng KHÔNG ghi trực tiếp: chỉ tạo "đề xuất chờ duyệt"; nhân viên duyệt mới thực thi.
 * Mọi lần gọi đều được lưu vào ai_tool_calls để nhân viên xem lại AI đã dựa trên dữ liệu gì.
 */
@Injectable()
export class SupportTools {
  private readonly logger = new Logger(SupportTools.name);

  constructor(
    private readonly orders: OrdersService,
    private readonly products: ProductsService,
    private readonly tickets: TicketsRepository,
  ) {}

  definitions(): ToolDefinition[] {
    return [
      {
        name: 'get_order_status',
        description:
          'Tra cứu trạng thái THẬT của một đơn hàng ShopFast trong cơ sở dữ liệu. ' +
          'Bắt buộc gọi trước khi nói bất cứ điều gì về một đơn hàng. ' +
          'Tham số `order`: mã đơn dạng SF-YYYYMMDD-XXXXXXXX hoặc id (UUID).',
        inputSchema: {
          type: 'object',
          properties: {
            order: { type: 'string', description: 'Mã đơn SF-… hoặc UUID' },
          },
          required: ['order'],
          additionalProperties: false,
        },
      },
      {
        name: 'check_product_inventory',
        description:
          'Kiểm tra tồn kho THẬT của một sản phẩm theo mã SKU hoặc id (UUID). ' +
          'Bắt buộc gọi trước khi nói về số lượng còn hàng.',
        inputSchema: {
          type: 'object',
          properties: {
            product: { type: 'string', description: 'Mã SKU hoặc UUID' },
          },
          required: ['product'],
          additionalProperties: false,
        },
      },
      {
        name: 'propose_cancel_order',
        description:
          'ĐỀ XUẤT huỷ một đơn hàng. Tool này KHÔNG huỷ đơn: nó chỉ tạo một đề xuất để nhân viên ' +
          'duyệt hoặc từ chối. Chỉ dùng khi khách yêu cầu huỷ rõ ràng.',
        inputSchema: {
          type: 'object',
          properties: {
            order: { type: 'string', description: 'Mã đơn SF-… hoặc UUID' },
            reason: { type: 'string', description: 'Lý do huỷ' },
          },
          required: ['order', 'reason'],
          additionalProperties: false,
        },
      },
    ];
  }

  /** Chạy 1 tool, ghi nhật ký, trả kết quả dạng JSON cho model. Tool lỗi → is_error, không ném. */
  async execute(
    call: ToolCall,
    ctx: ToolContext,
  ): Promise<{ result: ToolResult; record: ExecutedToolCall }> {
    const startedAt = Date.now();
    let output: Record<string, unknown>;
    let success = true;
    try {
      output = await this.run(call, ctx);
    } catch (error) {
      // Lỗi tool KHÔNG làm sập cả câu hỏi: báo cho model biết là không có dữ liệu.
      success = false;
      output = {
        error: 'TOOL_FAILED',
        message:
          'Tra cứu thất bại, không có dữ liệu. Không được đoán thông tin.',
      };
      this.logger.warn(`Tool ${call.name} lỗi: ${String(error)}`);
    }
    const durationMs = Date.now() - startedAt;
    await this.tickets.recordToolCall({
      ticketId: ctx.ticketId,
      requestedById: ctx.agentId,
      toolName: call.name,
      input: call.input as Prisma.InputJsonValue,
      output: output as Prisma.InputJsonValue,
      success,
      durationMs,
    });
    return {
      result: {
        toolCallId: call.id,
        content: JSON.stringify(output),
        isError: !success,
      },
      record: {
        name: call.name,
        input: call.input,
        output,
        success,
        durationMs,
      },
    };
  }

  private async run(
    call: ToolCall,
    ctx: ToolContext,
  ): Promise<Record<string, unknown>> {
    switch (call.name) {
      case 'get_order_status':
        return this.getOrderStatus(stringArg(call.input.order), ctx);
      case 'check_product_inventory':
        return this.checkInventory(stringArg(call.input.product));
      case 'propose_cancel_order':
        return this.proposeCancel(
          stringArg(call.input.order),
          stringArg(call.input.reason),
          ctx,
        );
      default:
        throw new Error(`Tool không tồn tại: ${call.name}`);
    }
  }

  private async getOrderStatus(ref: string, ctx: ToolContext) {
    const order = await this.orders.findForSupport(ref);
    if (!order) return { found: false, query: ref };
    return {
      found: true,
      id: order.id,
      code: order.code,
      status: order.status,
      statusLabel: order.statusLabel,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      total: order.total,
      items: order.items.map((i) => ({
        name: i.productName,
        sku: i.sku,
        quantity: i.quantity,
      })),
      createdAt: order.createdAt,
      history: (order.statusHistory ?? []).slice(-5),
      // AI cần biết đơn có thuộc khách đang hỏi hay không để không tiết lộ đơn của người khác
      belongsToTicketCustomer: order.userId === ctx.ticketCustomerId,
    };
  }

  private async checkInventory(ref: string) {
    const product = await this.products.findForSupport(ref);
    if (!product) return { found: false, query: ref };
    return {
      found: true,
      id: product.id,
      sku: product.sku,
      name: product.name,
      stock: product.stock,
      inStock: product.inStock,
      isActive: product.isActive,
      price: product.price,
    };
  }

  private async proposeCancel(ref: string, reason: string, ctx: ToolContext) {
    const order = await this.orders.findForSupport(ref);
    if (!order) return { found: false, query: ref };
    if (order.userId !== ctx.ticketCustomerId) {
      return {
        created: false,
        reason: 'Đơn hàng không thuộc khách hàng của ticket này',
      };
    }
    if (!canTransition(order.status, OrderStatus.CANCELLED)) {
      return {
        created: false,
        reason: `Không thể huỷ đơn đang ở trạng thái "${order.statusLabel}"`,
      };
    }
    const action = await this.tickets.createPendingAction({
      ticketId: ctx.ticketId,
      actionType: CANCEL_ORDER,
      payload: { orderId: order.id, orderCode: order.code },
      reason: reason.slice(0, 500),
    });
    return {
      created: true,
      pendingActionId: action.id,
      orderCode: order.code,
      status: 'PENDING_HUMAN_APPROVAL',
      note: 'Đơn CHƯA bị huỷ. Nhân viên cần duyệt đề xuất này.',
    };
  }
}

function stringArg(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Tham số không hợp lệ');
  }
  return value.trim().slice(0, 200);
}
