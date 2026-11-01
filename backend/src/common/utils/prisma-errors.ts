import { Prisma } from '@prisma/client';

/**
 * Mã lỗi Prisma hay gặp:
 *  - P2002: vi phạm ràng buộc UNIQUE (trùng email, trùng SKU…)
 *  - P2003: vi phạm khoá ngoại (xoá danh mục còn sản phẩm…)
 *  - P2025: bản ghi cần cập nhật/xoá không tồn tại
 */
export type PrismaErrorCode = 'P2002' | 'P2003' | 'P2025';

export function isPrismaError(
  error: unknown,
  code: PrismaErrorCode,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
