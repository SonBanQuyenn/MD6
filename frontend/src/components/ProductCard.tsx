import { Badge, Button, Card, Center, Group, Stack, Text } from '@mantine/core';
import { IconPhoto, IconShoppingCartPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { addToCart } from '../api/endpoints';
import type { Product } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatVnd } from '../lib/format';
import { notifyError, notifySuccess } from '../lib/notify';

export function ProductImage({
  product,
  height = 160,
}: {
  product: Product;
  height?: number;
}) {
  return product.imageUrl ? (
    <img
      src={product.imageUrl}
      alt={product.name}
      style={{ width: '100%', height, objectFit: 'cover', display: 'block' }}
      loading="lazy"
    />
  ) : (
    <Center h={height} bg="var(--mantine-color-default-hover)">
      <IconPhoto size={40} color="var(--mantine-color-dimmed)" />
    </Center>
  );
}

/** Nút thêm vào giỏ: chưa đăng nhập → chuyển tới trang đăng nhập. */
export function AddToCartButton({
  product,
  quantity = 1,
  fullWidth,
}: {
  product: Product;
  quantity?: number;
  fullWidth?: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => addToCart(product.id, quantity),
    onSuccess: (cart) => {
      queryClient.setQueryData(['cart'], cart);
      notifySuccess(`Đã thêm "${product.name}" vào giỏ`);
    },
    onError: (error) => notifyError(error, 'Không thêm được vào giỏ'),
  });

  if (user && user.role !== 'CUSTOMER') return null;
  return (
    <Button
      fullWidth={fullWidth}
      leftSection={<IconShoppingCartPlus size={16} />}
      disabled={!product.inStock}
      loading={mutation.isPending}
      onClick={() =>
        user
          ? mutation.mutate()
          : navigate('/login', { state: { from: `/products/${product.id}` } })
      }
    >
      {product.inStock ? 'Thêm vào giỏ' : 'Hết hàng'}
    </Button>
  );
}

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card withBorder padding="sm" radius="md" h="100%">
      <Card.Section component={Link} to={`/products/${product.id}`}>
        <ProductImage product={product} />
      </Card.Section>
      <Stack gap={6} mt="sm" style={{ flex: 1 }}>
        <Group gap={6}>
          <Badge size="xs" variant="light">
            {product.brand.name}
          </Badge>
          {!product.inStock && (
            <Badge size="xs" color="gray">
              Hết hàng
            </Badge>
          )}
        </Group>
        <Text
          component={Link}
          to={`/products/${product.id}`}
          fw={600}
          size="sm"
          lineClamp={2}
          style={{ flex: 1 }}
        >
          {product.name}
        </Text>
        <Text fw={700} c="orange">
          {formatVnd(product.price)}
        </Text>
        <AddToCartButton product={product} fullWidth />
      </Stack>
    </Card>
  );
}
