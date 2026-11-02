import {
  Alert,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import {
  createProduct,
  deactivateProduct,
  fetchBrands,
  fetchCategories,
  fetchProducts,
  updateProduct,
} from '../../api/endpoints';
import type { Product } from '../../api/types';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pager,
} from '../../components/States';
import { formatVnd } from '../../lib/format';
import { notifyError, notifySuccess } from '../../lib/notify';

/** Quản trị sản phẩm. Đổi giá → cache sản phẩm & danh sách được làm mới ngay (F04.2). */
export function AdminProductsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 400);
  const [editing, setEditing] = useState<Product | null>(null);
  const [opened, { open, close }] = useDisclosure();
  const products = useQuery({
    queryKey: ['products', 'admin', page, debounced],
    queryFn: () =>
      fetchProducts({ page, q: debounced || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const deactivate = useMutation({
    mutationFn: deactivateProduct,
    onSuccess: () => {
      notifySuccess('Đã ngừng bán sản phẩm');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => notifyError(e),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Sản phẩm</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            setEditing(null);
            open();
          }}
        >
          Thêm sản phẩm
        </Button>
      </Group>
      <TextInput
        placeholder="Tìm theo tên…"
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setPage(1);
        }}
        maw={320}
      />
      {products.isPending && <LoadingState />}
      {products.isError && (
        <ErrorState error={products.error} onRetry={products.refetch} />
      )}
      {products.data?.items.length === 0 && (
        <EmptyState title="Không có sản phẩm" />
      )}
      {products.data && products.data.items.length > 0 && (
        <Card withBorder p={0}>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>SKU</Table.Th>
                  <Table.Th>Tên</Table.Th>
                  <Table.Th>Danh mục</Table.Th>
                  <Table.Th ta="right">Giá</Table.Th>
                  <Table.Th ta="right">Tồn</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {products.data.items.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{p.sku}</Table.Td>
                    <Table.Td>{p.name}</Table.Td>
                    <Table.Td>{p.category.name}</Table.Td>
                    <Table.Td ta="right">{formatVnd(p.price)}</Table.Td>
                    <Table.Td ta="right">{p.stock}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            setEditing(p);
                            open();
                          }}
                        >
                          Sửa
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          loading={
                            deactivate.isPending &&
                            deactivate.variables === p.id
                          }
                          onClick={() => {
                            if (window.confirm(`Ngừng bán "${p.name}"?`))
                              deactivate.mutate(p.id);
                          }}
                        >
                          Ngừng bán
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}
      {products.data && (
        <Pager
          page={page}
          totalPages={products.data.totalPages}
          onChange={setPage}
        />
      )}
      <ProductFormModal
        key={editing?.id ?? 'new'}
        opened={opened}
        onClose={close}
        product={editing}
      />
    </Stack>
  );
}

function ProductFormModal({
  opened,
  onClose,
  product,
}: {
  opened: boolean;
  onClose: () => void;
  product: Product | null;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  });
  const brands = useQuery({ queryKey: ['brands'], queryFn: fetchBrands });
  const form = useForm({
    initialValues: {
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      description: product?.description ?? '',
      price: product?.price ?? 100000,
      stock: 0,
      imageUrl: product?.imageUrl ?? '',
      categoryId: product?.category.id ?? '',
      brandId: product?.brand.id ?? '',
    },
    validate: {
      sku: (v: string) =>
        product || /^[A-Za-z0-9-]{2,40}$/.test(v)
          ? null
          : 'SKU 2–40 ký tự: chữ, số, gạch ngang',
      name: (v: string) =>
        v.trim().length >= 2 ? null : 'Tên tối thiểu 2 ký tự',
      price: (v: number) => (v > 0 ? null : 'Giá phải lớn hơn 0'),
      categoryId: (v: string) => (v ? null : 'Chọn danh mục'),
      brandId: (v: string) => (v ? null : 'Chọn thương hiệu'),
    },
  });

  const mutation = useMutation({
    mutationFn: (v: typeof form.values) => {
      const common = {
        name: v.name.trim(),
        description: v.description.trim(),
        price: v.price,
        imageUrl: v.imageUrl.trim() || undefined,
        categoryId: v.categoryId,
        brandId: v.brandId,
      };
      return product
        ? updateProduct(product.id, common)
        : createProduct({
            ...common,
            sku: v.sku.trim().toUpperCase(),
            stock: v.stock,
          });
    },
    onSuccess: () => {
      notifySuccess(product ? 'Đã cập nhật sản phẩm' : 'Đã thêm sản phẩm');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (product)
        queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={product ? `Sửa ${product.sku}` : 'Thêm sản phẩm'}
      size="lg"
    >
      <form onSubmit={form.onSubmit((v) => mutation.mutate(v))}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          {!product && <TextInput label="SKU" {...form.getInputProps('sku')} />}
          <TextInput label="Tên" {...form.getInputProps('name')} />
          <Group grow>
            <Select
              label="Danh mục"
              data={
                categories.data?.map((c) => ({ value: c.id, label: c.name })) ??
                []
              }
              {...form.getInputProps('categoryId')}
            />
            <Select
              label="Thương hiệu"
              searchable
              data={
                brands.data?.map((b) => ({ value: b.id, label: b.name })) ?? []
              }
              {...form.getInputProps('brandId')}
            />
          </Group>
          <Group grow>
            <NumberInput
              label="Giá (₫)"
              min={1}
              step={10000}
              thousandSeparator="."
              decimalSeparator=","
              {...form.getInputProps('price')}
            />
            {!product && (
              <NumberInput
                label="Tồn kho ban đầu"
                min={0}
                {...form.getInputProps('stock')}
              />
            )}
          </Group>
          {product && (
            <Text size="xs" c="dimmed">
              Tồn kho chỉ đổi qua trang Tồn kho (nhập / xuất có lịch sử).
            </Text>
          )}
          <TextInput label="Ảnh (URL)" {...form.getInputProps('imageUrl')} />
          <Textarea
            label="Mô tả"
            autosize
            minRows={3}
            {...form.getInputProps('description')}
          />
          <Button type="submit" loading={mutation.isPending}>
            Lưu
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
