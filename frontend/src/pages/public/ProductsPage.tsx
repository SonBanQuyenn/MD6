import {
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchBrands,
  fetchCategories,
  fetchProducts,
} from '../../api/endpoints';
import { ProductCard } from '../../components/ProductCard';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';

const SORTS = [
  { value: 'newest', label: 'Mới nhất' },
  { value: 'price_asc', label: 'Giá tăng dần' },
  { value: 'price_desc', label: 'Giá giảm dần' },
  { value: 'name_asc', label: 'Tên A → Z' },
];

/** Danh sách sản phẩm: lọc theo danh mục, thương hiệu, khoảng giá, từ khoá + phân trang (F06.1). */
export function ProductsPage() {
  // Bộ lọc nằm trên URL → bấm "quay lại" / chia sẻ link vẫn giữ đúng bộ lọc.
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debouncedQ] = useDebouncedValue(q, 400);

  const filter = {
    categoryId: params.get('categoryId') ?? undefined,
    brandId: params.get('brandId') ?? undefined,
    minPrice: params.get('minPrice')
      ? Number(params.get('minPrice'))
      : undefined,
    maxPrice: params.get('maxPrice')
      ? Number(params.get('maxPrice'))
      : undefined,
    q: params.get('q') ?? undefined,
    sort: params.get('sort') ?? 'newest',
    page: Number(params.get('page') ?? 1),
    limit: 12,
  };

  const update = (
    patch: Record<string, string | number | undefined | null>,
  ) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null || value === '')
        next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page'); // đổi bộ lọc → về trang 1
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('q') ?? '') !== debouncedQ)
      update({ q: debouncedQ || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });
  const products = useQuery({
    queryKey: ['products', filter],
    queryFn: () => fetchProducts(filter),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <Title order={2}>Sản phẩm</Title>
      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Card withBorder>
            <Stack gap="sm">
              <TextInput
                label="Tìm kiếm"
                placeholder="Tên sản phẩm…"
                leftSection={<IconSearch size={16} />}
                value={q}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
              <Select
                label="Danh mục"
                placeholder="Tất cả"
                clearable
                data={
                  categories.data?.map((c) => ({
                    value: c.id,
                    label: c.name,
                  })) ?? []
                }
                value={filter.categoryId ?? null}
                onChange={(v) => update({ categoryId: v })}
              />
              <Select
                label="Thương hiệu"
                placeholder="Tất cả"
                clearable
                searchable
                data={
                  brands.data?.map((b) => ({ value: b.id, label: b.name })) ??
                  []
                }
                value={filter.brandId ?? null}
                onChange={(v) => update({ brandId: v })}
              />
              <Group grow>
                <NumberInput
                  label="Giá từ"
                  min={0}
                  step={100000}
                  thousandSeparator="."
                  decimalSeparator=","
                  value={filter.minPrice ?? ''}
                  onChange={(v) =>
                    update({ minPrice: v === '' ? undefined : Number(v) })
                  }
                />
                <NumberInput
                  label="Đến"
                  min={0}
                  step={100000}
                  thousandSeparator="."
                  decimalSeparator=","
                  value={filter.maxPrice ?? ''}
                  onChange={(v) =>
                    update({ maxPrice: v === '' ? undefined : Number(v) })
                  }
                />
              </Group>
              <Select
                label="Sắp xếp"
                data={SORTS}
                value={filter.sort}
                onChange={(v) => update({ sort: v ?? 'newest' })}
              />
              <Button
                variant="subtle"
                onClick={() => {
                  setQ('');
                  setParams({}, { replace: true });
                }}
              >
                Xoá bộ lọc
              </Button>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 9 }}>
          {products.isPending && <LoadingState />}
          {products.isError && (
            <ErrorState error={products.error} onRetry={products.refetch} />
          )}
          {products.data && (
            <>
              <Text size="sm" c="dimmed" mb="sm">
                {products.data.total} sản phẩm
              </Text>
              {products.data.items.length === 0 ? (
                <EmptyState
                  title="Không có sản phẩm phù hợp"
                  description="Thử bỏ bớt bộ lọc hoặc đổi từ khoá."
                />
              ) : (
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }}>
                  {products.data.items.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </SimpleGrid>
              )}
              <Pager
                page={filter.page}
                totalPages={products.data.totalPages}
                onChange={(page) => update({ page })}
              />
            </>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
