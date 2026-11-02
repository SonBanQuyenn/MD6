import { Button, Group } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changeOrderStatus } from '../../api/endpoints';
import type { Order, OrderStatus } from '../../api/types';
import { NEXT_STATUSES, ORDER_STATUS_LABEL } from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';

/**
 * Nút chuyển trạng thái cho nhân viên kho — chỉ hiện các bước HỢP LỆ theo máy trạng thái.
 * Mỗi lần bấm → backend phát sự kiện realtime tới khách đang theo dõi đơn (F02).
 */
export function StaffStatusButtons({
  order,
  onChanged,
  size = 'sm',
}: {
  order: Order;
  onChanged?: (order: Order) => void;
  size?: 'xs' | 'sm';
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: OrderStatus) => changeOrderStatus(order.id, status),
    onSuccess: (updated) => {
      notifySuccess(`Đơn ${updated.code} → ${updated.statusLabel}`);
      onChanged?.(updated);
      queryClient.invalidateQueries({ queryKey: ['staff-orders'] });
    },
    onError: (e) => notifyError(e, 'Không đổi được trạng thái'),
  });

  const next = NEXT_STATUSES[order.status];
  if (next.length === 0) return null;
  return (
    <Group gap="xs" wrap="nowrap">
      {next.map((status) => (
        <Button
          key={status}
          size={size}
          variant={status === 'CANCELLED' ? 'light' : 'filled'}
          color={status === 'CANCELLED' ? 'red' : undefined}
          loading={mutation.isPending && mutation.variables === status}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(status)}
        >
          {status === 'CANCELLED' ? 'Huỷ' : `→ ${ORDER_STATUS_LABEL[status]}`}
        </Button>
      ))}
    </Group>
  );
}
