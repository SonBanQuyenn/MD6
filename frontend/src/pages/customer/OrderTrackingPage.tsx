import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Stack,
  Stepper,
  Table,
  Text,
  Timeline,
  Title,
} from '@mantine/core';
import {
  IconCircleX,
  IconPlugConnected,
  IconPlugConnectedX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  cancelOrder,
  fetchInvoiceHtml,
  fetchOrder,
  payOrder,
} from '../../api/endpoints';
import type { Order } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { OrderStatusBadge } from '../../components/OrderStatusBadge';
import { ErrorState, LoadingState } from '../../components/States';
import { StaffStatusButtons } from '../staff/StaffStatusButtons';
import {
  formatDateTime,
  formatVnd,
  ORDER_FLOW,
  ORDER_STATUS_LABEL,
} from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';
import {
  TrackingState,
  useOrderTracking,
} from '../../realtime/useOrderTracking';

const CONNECTION: Record<TrackingState, { color: string; label: string }> = {
  connecting: { color: 'gray', label: 'Đang kết nối…' },
  live: { color: 'green', label: 'Đang cập nhật trực tiếp' },
  reconnecting: { color: 'orange', label: 'Mất kết nối — đang thử lại…' },
  forbidden: { color: 'red', label: 'Không có quyền theo dõi đơn này' },
  unauthorized: { color: 'red', label: 'Phiên đăng nhập hết hạn' },
};

/** Theo dõi đơn hàng realtime (F02): trạng thái đổi ngay khi kho cập nhật, không tải lại trang. */
export function OrderTrackingPage() {
  const { id = '' } = useParams();
  const { getToken, user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const canManage = user?.role === 'WAREHOUSE_STAFF' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrder(id),
  });

  const tracking = useOrderTracking(id, {
    getToken,
    onStatus: (event) => {
      notifySuccess(`Đơn ${event.code}: ${event.statusLabel}`);
      // Lấy lại chi tiết (lịch sử trạng thái, thanh toán) từ REST — nguồn dữ liệu chuẩn
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    },
    // Vừa kết nối lại sau khi mất mạng → bù các sự kiện có thể đã lỡ
    onResync: () => queryClient.invalidateQueries({ queryKey: ['order', id] }),
  });

  const onDone = (data: Order) => queryClient.setQueryData(['order', id], data);
  const cancel = useMutation({
    mutationFn: () => cancelOrder(id),
    onSuccess: (data) => {
      onDone(data);
      notifySuccess('Đã huỷ đơn hàng');
    },
    onError: (e) => notifyError(e),
  });
  const pay = useMutation({
    mutationFn: () => payOrder(id),
    onSuccess: (data) => {
      onDone(data);
      notifySuccess('Thanh toán thành công (giả lập)');
    },
    onError: (e) => notifyError(e),
  });

  // Hoá đơn cần token (chỉ nằm trong bộ nhớ) → tải qua API rồi mở trong tab mới
  const invoice = useMutation({
    mutationFn: () => fetchInvoiceHtml(id),
    onSuccess: (html) => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (e) => notifyError(e, 'Chưa có hoá đơn'),
  });

  if (order.isPending) return <LoadingState />;
  if (order.isError)
    return <ErrorState error={order.error} onRetry={order.refetch} />;
  const o = order.data;
  const step = o.status === 'CANCELLED' ? -1 : ORDER_FLOW.indexOf(o.status);
  const conn = CONNECTION[tracking];

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Đơn {o.code}</Title>
          <Text size="sm" c="dimmed">
            Đặt lúc {formatDateTime(o.createdAt)}
          </Text>
        </div>
        <Group gap="xs">
          <Badge
            color={conn.color}
            variant="light"
            leftSection={
              tracking === 'live' ? (
                <IconPlugConnected size={12} />
              ) : (
                <IconPlugConnectedX size={12} />
              )
            }
          >
            {conn.label}
          </Badge>
          <OrderStatusBadge status={o.status} />
        </Group>
      </Group>

      <Card withBorder>
        {o.status === 'CANCELLED' ? (
          <Alert color="gray" icon={<IconCircleX />}>
            Đơn hàng đã bị huỷ
            {o.cancelledAt ? ` lúc ${formatDateTime(o.cancelledAt)}` : ''}.
          </Alert>
        ) : (
          <Stepper active={step} size="sm" allowNextStepsSelect={false}>
            {ORDER_FLOW.map((s) => (
              <Stepper.Step key={s} label={ORDER_STATUS_LABEL[s]} />
            ))}
          </Stepper>
        )}
      </Card>

      <Grid>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder p={0}>
            <Table.ScrollContainer minWidth={420}>
              <Table verticalSpacing="xs">
                <Table.Tbody>
                  {o.items.map((i) => (
                    <Table.Tr key={i.productId}>
                      <Table.Td>{i.productName}</Table.Td>
                      <Table.Td>× {i.quantity}</Table.Td>
                      <Table.Td ta="right">{formatVnd(i.lineTotal)}</Table.Td>
                    </Table.Tr>
                  ))}
                  {o.discount > 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={2}>
                        Giảm giá ({o.promotionCode})
                      </Table.Td>
                      <Table.Td ta="right">−{formatVnd(o.discount)}</Table.Td>
                    </Table.Tr>
                  )}
                  <Table.Tr>
                    <Table.Td colSpan={2} fw={700}>
                      Tổng cộng
                    </Table.Td>
                    <Table.Td ta="right" fw={700} c="orange">
                      {formatVnd(o.total)}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
          <Group mt="md">
            {canManage && <StaffStatusButtons order={o} onChanged={onDone} />}
            {isCustomer &&
              o.paymentMethod === 'MOCK_ONLINE' &&
              o.paymentStatus === 'UNPAID' &&
              o.status === 'PENDING' && (
                <Button loading={pay.isPending} onClick={() => pay.mutate()}>
                  Thanh toán (giả lập)
                </Button>
              )}
            {isCustomer && o.status === 'PENDING' && (
              <Button
                color="red"
                variant="light"
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Huỷ đơn
              </Button>
            )}
            <Button
              variant="subtle"
              loading={invoice.isPending}
              onClick={() => invoice.mutate()}
            >
              Xem hoá đơn
            </Button>
          </Group>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder>
            <Stack gap="xs">
              <Text fw={600}>Giao tới</Text>
              <Text size="sm">
                {o.shippingAddress.fullName} · {o.shippingAddress.phone}
                <br />
                {o.shippingAddress.addressLine}, {o.shippingAddress.city}
              </Text>
              <Text size="sm">
                Thanh toán:{' '}
                {o.paymentMethod === 'COD'
                  ? 'Khi nhận hàng'
                  : 'Online (giả lập)'}{' '}
                —{' '}
                {o.paymentStatus === 'PAID'
                  ? 'đã thanh toán'
                  : o.paymentStatus === 'REFUNDED'
                    ? 'đã hoàn tiền'
                    : 'chưa thanh toán'}
              </Text>
              <Text fw={600} mt="sm">
                Lịch sử
              </Text>
              <Timeline
                bulletSize={14}
                lineWidth={2}
                active={(o.statusHistory?.length ?? 1) - 1}
              >
                {o.statusHistory?.map((h, idx) => (
                  <Timeline.Item
                    key={idx}
                    title={ORDER_STATUS_LABEL[h.toStatus]}
                  >
                    <Text size="xs" c="dimmed">
                      {formatDateTime(h.at)}
                      {h.note ? ` · ${h.note}` : ''}
                    </Text>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
