import {
  Badge,
  Button,
  Card,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconArrowRight,
  IconBolt,
  IconHeadset,
  IconTruckDelivery,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchCategories, fetchProducts } from '../../api/endpoints';
import { ProductCard } from '../../components/ProductCard';
import { ErrorState, LoadingState } from '../../components/States';

export function HomePage() {
  const newest = useQuery({
    queryKey: ['products', { sort: 'newest', limit: 8 }],
    queryFn: () => fetchProducts({ sort: 'newest', limit: 8 }),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });

  return (
    <Stack gap="xl">
      <Paper
        radius="lg"
        p={{ base: 'lg', sm: 'xl' }}
        style={{
          background:
            'linear-gradient(135deg, var(--mantine-color-orange-6), var(--mantine-color-red-6))',
          color: 'white',
        }}
      >
        <Stack gap="sm" maw={560}>
          <Title order={1} c="white">
            Mua sắm nhanh, theo dõi đơn từng giây
          </Title>
          <Text c="white" opacity={0.9}>
            Hàng chính hãng, cập nhật trạng thái đơn theo thời gian thực và đội
            ngũ hỗ trợ có trợ lý AI.
          </Text>
          <Group>
            <Button
              component={Link}
              to="/products"
              color="dark"
              rightSection={<IconArrowRight size={16} />}
            >
              Xem sản phẩm
            </Button>
          </Group>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {[
          {
            icon: <IconBolt />,
            title: 'Trang tải siêu nhanh',
            text: 'Dữ liệu được lưu đệm Redis',
          },
          {
            icon: <IconTruckDelivery />,
            title: 'Theo dõi đơn realtime',
            text: 'Không cần tải lại trang',
          },
          {
            icon: <IconHeadset />,
            title: 'Hỗ trợ tận tâm',
            text: 'CSKH có trợ lý AI tra cứu tức thì',
          },
        ].map((f) => (
          <Card key={f.title} withBorder>
            <Group wrap="nowrap">
              {f.icon}
              <div>
                <Text fw={600}>{f.title}</Text>
                <Text size="sm" c="dimmed">
                  {f.text}
                </Text>
              </div>
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Stack gap="sm">
        <Title order={3}>Danh mục</Title>
        {categories.isPending && <LoadingState />}
        {categories.isError && (
          <ErrorState error={categories.error} onRetry={categories.refetch} />
        )}
        <Group gap="xs">
          {categories.data?.map((c) => (
            <Badge
              key={c.id}
              component={Link}
              to={`/products?categoryId=${c.id}`}
              size="lg"
              variant="light"
              style={{ cursor: 'pointer' }}
            >
              {c.name} ({c.productCount ?? 0})
            </Badge>
          ))}
        </Group>
      </Stack>

      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3}>Sản phẩm mới</Title>
          <Button variant="subtle" component={Link} to="/products">
            Xem tất cả
          </Button>
        </Group>
        {newest.isPending && <LoadingState />}
        {newest.isError && (
          <ErrorState error={newest.error} onRetry={newest.refetch} />
        )}
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }}>
          {newest.data?.items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}
