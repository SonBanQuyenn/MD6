import { TicketDetail, TicketSummary } from './tickets.repository';

export const CATEGORY_LABELS: Record<string, string> = {
  ORDER_STATUS: 'Trạng thái đơn hàng',
  SHIPPING: 'Giao hàng',
  PAYMENT: 'Thanh toán',
  RETURN_REFUND: 'Đổi trả / hoàn tiền',
  PRODUCT_INQUIRY: 'Hỏi về sản phẩm',
  ACCOUNT: 'Tài khoản',
  COMPLAINT: 'Khiếu nại',
  OTHER: 'Khác',
};

function baseView(t: TicketSummary | TicketDetail) {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    category: t.category,
    categoryLabel: t.category ? CATEGORY_LABELS[t.category] : null,
    categoryConfidence: t.categoryConfidence,
    classifiedBy: t.classifiedBy,
    order: t.order,
    customer: t.customer,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function toTicketSummary(t: TicketSummary) {
  return { ...baseView(t), messageCount: t._count.messages };
}

/** Khách: KHÔNG thấy hội thoại nội bộ với AI, nhật ký tool, đề xuất chờ duyệt. */
export function toCustomerTicketView(t: TicketDetail) {
  return {
    ...baseView(t),
    messages: t.messages
      .filter((m) => !m.internal)
      .map((m) => ({
        id: m.id,
        authorType: m.authorType,
        content: m.content,
        createdAt: m.createdAt,
      })),
  };
}

/** Nhân viên CSKH: xem đầy đủ để kiểm chứng AI đã dựa trên dữ liệu gì. */
export function toStaffTicketView(t: TicketDetail) {
  return {
    ...baseView(t),
    assignedAgent: t.assignedAgent,
    messages: t.messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorId: m.authorId,
      content: m.content,
      internal: m.internal,
      metadata: m.metadata,
      createdAt: m.createdAt,
    })),
    toolCalls: t.toolCalls.map((c) => ({
      id: c.id,
      toolName: c.toolName,
      input: c.input,
      output: c.output,
      success: c.success,
      durationMs: c.durationMs,
      createdAt: c.createdAt,
    })),
    pendingActions: t.pendingActions.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      payload: a.payload,
      reason: a.reason,
      status: a.status,
      result: a.result,
      reviewedById: a.reviewedById,
      reviewedAt: a.reviewedAt,
      createdAt: a.createdAt,
    })),
  };
}
