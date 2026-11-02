import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchCart, removeCartItem, updateCartItem } from '../../api/endpoints';
import type { Cart } from '../../api/types';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { notifyError } from '../../lib/notify';

export function CartPage() {
  const queryClient = useQueryClient();
  const cart = useQuery({ queryKey: ['cart'], queryFn: fetchCart });
  const onCart = (data: Cart) => queryClient.setQueryData(['cart'], data);

  const update = useMutation({
    mutationFn: ({
      productId,
      quantity,
    }: {
      productId: string;
      quantity: number;
    }) => updateCartItem(productId, quantity),
    onSuccess: onCart,
    onError: (e) => notifyError(e),
  });
  const remove = useMutation({
    mutationFn: removeCartItem,
    onSuccess: onCart,
    onError: (e) => notifyError(e),
  });

  if (cart.isPending) return <LoadingState />;
  if (cart.isError)
    return <ErrorState error={cart.error} onRetry={cart.refetch} />;
  const data = cart.data;

  if (data.items.length === 0) {
    return (
      <EmptyState
        title="Giỏ hàng trống"
        description="Hãy chọn vài sản phẩm bạn thích."
        action={
          <Button component={Link} to="/products">
            Mua sắm ngay
          </Button>
        }
      />
    );
  }

  return (
    <Stack>
      <Title order={2}>Giỏ hàng</Title>
      <Card withBorder p={0}>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Sản phẩm</Table.Th>
                <Table.Th>Đơn giá</Table.Th>
                <Table.Th>Số lượng</Table.Th>
                <Table.Th>Thành tiền</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.items.map((line) => (
                <Table.Tr key={line.productId}>
                  <Table.Td>
                    <Text
                      component={Link}
                      to={`/products/${line.productId}`}
                      fw={500}
                    >
                      {line.name}
                    </Text>
                    {line.warning && (
                      <Text size="xs" c="red">
                        {line.warning}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{formatVnd(line.unitPrice)}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      w={90}
                      min={1}
                      max={99}
                      value={line.quantity}
                      onChange={(v) => {
                        const quantity = Number(v);
                        if (quantity >= 1 && quantity !== line.quantity) {
                          update.mutate({
                            productId: line.productId,
                            quantity,
                          });
                        }
                      }}
                    />
                  </Table.Td>
                  <Table.Td fw={600}>{formatVnd(line.lineTotal)}</Table.Td>
                  <Table.Td>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label="Xoá khỏi giỏ"
                      onClick={() => remove.mutate(line.productId)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      {!data.canCheckout && (
        <Alert color="orange">
          Một số sản phẩm không còn đủ hàng hoặc đã ngừng bán — vui lòng chỉnh
          lại trước khi đặt.
        </Alert>
      )}
      <Group justify="flex-end">
        <Text size="lg">
          Tạm tính: <b>{formatVnd(data.subtotal)}</b>
        </Text>
        <Button component={Link} to="/checkout" disabled={!data.canCheckout}>
          Tiến hành đặt hàng
        </Button>
      </Group>
    </Stack>
  );
}
