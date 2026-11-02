import {
  Anchor,
  Badge,
  Breadcrumbs,
  Card,
  Grid,
  Group,
  NumberInput,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProduct } from '../../api/endpoints';
import { AddToCartButton, ProductImage } from '../../components/ProductCard';
import { ErrorState, LoadingState } from '../../components/States';
import { formatVnd } from '../../lib/format';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const [quantity, setQuantity] = useState(1);
  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id),
  });

  if (product.isPending) return <LoadingState />;
  if (product.isError)
    return <ErrorState error={product.error} onRetry={product.refetch} />;
  const p = product.data;

  return (
    <Stack>
      <Breadcrumbs>
        <Anchor component={Link} to="/products">
          Sản phẩm
        </Anchor>
        <Anchor component={Link} to={`/products?categoryId=${p.category.id}`}>
          {p.category.name}
        </Anchor>
        <Text size="sm">{p.name}</Text>
      </Breadcrumbs>
      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder padding={0} radius="md">
            <ProductImage product={p} height={360} />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack>
            <Group gap="xs">
              <Badge variant="light">{p.brand.name}</Badge>
              <Badge variant="outline" color="gray">
                SKU {p.sku}
              </Badge>
            </Group>
            <Title order={2}>{p.name}</Title>
            <Text size="xl" fw={800} c="orange">
              {formatVnd(p.price)}
            </Text>
            <Text c={p.inStock ? 'green' : 'red'} fw={500}>
              {p.inStock ? `Còn ${p.stock} sản phẩm` : 'Tạm hết hàng'}
            </Text>
            {p.inStock && (
              <Group align="flex-end">
                <NumberInput
                  label="Số lượng"
                  min={1}
                  max={Math.min(p.stock, 99)}
                  value={quantity}
                  onChange={(v) => setQuantity(Number(v) || 1)}
                  w={120}
                />
                <AddToCartButton product={p} quantity={quantity} />
              </Group>
            )}
            <Text style={{ whiteSpace: 'pre-line' }}>
              {p.description || 'Chưa có mô tả.'}
            </Text>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
