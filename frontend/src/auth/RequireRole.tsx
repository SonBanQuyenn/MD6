import { Button, Center, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { LoadingState } from '../components/States';
import { useAuth } from './AuthContext';

/**
 * Bảo vệ trang theo vai trò. Đây chỉ là trải nghiệm người dùng — quyền THẬT luôn do backend
 * kiểm tra (JwtAuthGuard + RolesGuard); gọi API trái quyền vẫn nhận 401/403.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles?: Role[];
  children: ReactNode;
}) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return <LoadingState label="Đang kiểm tra đăng nhập…" />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <Center py="xl">
        <Stack align="center" gap="xs">
          <Title order={3}>Không có quyền truy cập</Title>
          <Text c="dimmed">Trang này dành cho vai trò khác.</Text>
          <Button component={Link} to="/" variant="light">
            Về trang chủ
          </Button>
        </Stack>
      </Center>
    );
  }
  return <>{children}</>;
}
