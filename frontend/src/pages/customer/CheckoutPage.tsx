import {
  Alert,
  Button,
  Card,
  Grid,
  Group,
  Radio,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { fetchCart, placeOrder } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { notifySuccess } from '../../lib/notify';

export function CheckoutPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: fetchCart });
  const [error, setError] = useState<string | null>(null);
  // MỘT key cho mỗi lần vào trang đặt hàng: bấm 2 lần / mạng gửi lại → backend trả đơn cũ.
  const idempotencyKey = useRef(crypto.randomUUID());

  const form = useForm({
    initialValues: {
      fullName: user?.fullName ?? '',
      phone: '',
      addressLine: '',
      city: '',
      note: '',
      paymentMethod: 'COD' as 'COD' | 'MOCK_ONLINE',
      promotionCode: '',
    },
    validate: {
      fullName: (v: string) =>
        v.trim().length >= 2 ? null : 'Vui lòng nhập họ tên người nhận',
      phone: (v: string) =>
        /^(0|\+84)\d{9,10}$/.test(v.trim())
          ? null
          : 'Số điện thoại không hợp lệ',
      addressLine: (v: string) =>
        v.trim().length >= 5 ? null : 'Vui lòng nhập địa chỉ',
      city: (v: string) =>
        v.trim().length >= 2 ? null : 'Vui lòng nhập tỉnh / thành phố',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      placeOrder(
        {
          paymentMethod: values.paymentMethod,
          shippingAddress: {
            fullName: values.fullName.trim(),
            phone: values.phone.trim(),
            addressLine: values.addressLine.trim(),
            city: values.city.trim(),
          },
          note: values.note.trim() || undefined,
          promotionCode: values.promotionCode.trim() || undefined,
        },
        idempotencyKey.current,
      ),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      notifySuccess(`Đặt hàng thành công — mã đơn ${order.code}`);
      navigate(`/orders/${order.id}`, { replace: true });
    },
    onError: (e) => {
      setError(errorMessage(e));
      // Lỗi nghiệp vụ (hết hàng, sai mã KM…) → lần thử sau là một yêu cầu MỚI
      idempotencyKey.current = crypto.randomUUID();
    },
  });

  if (cart.isPending) return <LoadingState />;
  if (cart.isError)
    return <ErrorState error={cart.error} onRetry={cart.refetch} />;
  if (cart.data.items.length === 0 && !mutation.isSuccess)
    return <Navigate to="/cart" replace />;

  return (
    <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
      <Stack>
        <Title order={2}>Đặt hàng</Title>
        {error && <Alert color="red">{error}</Alert>}
        <Grid>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Card withBorder>
              <Stack>
                <Text fw={600}>Thông tin giao hàng</Text>
                <Group grow align="flex-start">
                  <TextInput
                    label="Người nhận"
                    {...form.getInputProps('fullName')}
                  />
                  <TextInput
                    label="Số điện thoại"
                    {...form.getInputProps('phone')}
                  />
                </Group>
                <TextInput
                  label="Địa chỉ"
                  {...form.getInputProps('addressLine')}
                />
                <TextInput
                  label="Tỉnh / Thành phố"
                  {...form.getInputProps('city')}
                />
                <Textarea
                  label="Ghi chú"
                  autosize
                  minRows={2}
                  {...form.getInputProps('note')}
                />
                <Radio.Group
                  label="Thanh toán"
                  {...form.getInputProps('paymentMethod')}
                >
                  <Stack gap="xs" mt="xs">
                    <Radio value="COD" label="Thanh toán khi nhận hàng (COD)" />
                    <Radio
                      value="MOCK_ONLINE"
                      label="Thanh toán online (giả lập — chưa có cổng thanh toán thật)"
                    />
                  </Stack>
                </Radio.Group>
                <TextInput
                  label="Mã khuyến mãi"
                  description="Đơn khuyến mãi bị giới hạn 3 lần / phút"
                  {...form.getInputProps('promotionCode')}
                />
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder>
              <Stack gap="xs">
                <Text fw={600}>Đơn hàng ({cart.data.itemCount} sản phẩm)</Text>
                {cart.data.items.map((line) => (
                  <Group
                    key={line.productId}
                    justify="space-between"
                    wrap="nowrap"
                  >
                    <Text size="sm" lineClamp={1}>
                      {line.quantity} × {line.name}
                    </Text>
                    <Text size="sm">{formatVnd(line.lineTotal)}</Text>
                  </Group>
                ))}
                <Group justify="space-between" mt="sm">
                  <Text fw={600}>Tạm tính</Text>
                  <Text fw={700} c="orange">
                    {formatVnd(cart.data.subtotal)}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  Giảm giá (nếu có mã) được tính khi xác nhận đơn.
                </Text>
                <Button
                  type="submit"
                  size="md"
                  loading={mutation.isPending}
                  disabled={!cart.data.canCheckout}
                >
                  Xác nhận đặt hàng
                </Button>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Stack>
    </form>
  );
}
