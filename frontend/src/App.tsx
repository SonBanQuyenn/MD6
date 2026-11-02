import { Button, Center, Stack, Text, Title } from '@mantine/core';
import { Link, Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth/RequireRole';
import { AppLayout } from './components/AppLayout';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import {
  AdminDashboardPage,
  QueuesPage,
  SystemPage,
  UsersPage,
} from './pages/admin/AdminPages';
import { CartPage } from './pages/customer/CartPage';
import { CheckoutPage } from './pages/customer/CheckoutPage';
import { OrdersPage } from './pages/customer/OrdersPage';
import { OrderTrackingPage } from './pages/customer/OrderTrackingPage';
import { CustomerTicketPage, SupportPage } from './pages/customer/SupportPages';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
} from './pages/public/AuthPages';
import { HomePage } from './pages/public/HomePage';
import { ProductDetailPage } from './pages/public/ProductDetailPage';
import { ProductsPage } from './pages/public/ProductsPage';
import {
  StaffTicketPage,
  SupportDeskPage,
} from './pages/staff/SupportDeskPages';
import {
  InventoryPage,
  WarehouseOrdersPage,
} from './pages/staff/WarehousePages';

function NotFound() {
  return (
    <Center py="xl">
      <Stack align="center">
        <Title order={2}>404</Title>
        <Text c="dimmed">Không tìm thấy trang</Text>
        <Button component={Link} to="/">
          Về trang chủ
        </Button>
      </Stack>
    </Center>
  );
}

const customer = ['CUSTOMER'] as const;

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Công khai */}
        <Route index element={<HomePage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />

        {/* Khách hàng */}
        <Route
          path="cart"
          element={
            <RequireRole roles={[...customer]}>
              <CartPage />
            </RequireRole>
          }
        />
        <Route
          path="checkout"
          element={
            <RequireRole roles={[...customer]}>
              <CheckoutPage />
            </RequireRole>
          }
        />
        <Route
          path="orders"
          element={
            <RequireRole roles={[...customer]}>
              <OrdersPage />
            </RequireRole>
          }
        />
        {/* Mọi vai trò: khách theo dõi đơn của mình; nhân viên xem + cập nhật (backend kiểm quyền) */}
        <Route
          path="orders/:id"
          element={
            <RequireRole>
              <OrderTrackingPage />
            </RequireRole>
          }
        />
        <Route
          path="support"
          element={
            <RequireRole roles={[...customer]}>
              <SupportPage />
            </RequireRole>
          }
        />
        <Route
          path="support/:id"
          element={
            <RequireRole roles={[...customer]}>
              <CustomerTicketPage />
            </RequireRole>
          }
        />

        {/* Nhân viên */}
        <Route
          path="staff/support"
          element={
            <RequireRole roles={['SUPPORT_AGENT', 'ADMIN']}>
              <SupportDeskPage />
            </RequireRole>
          }
        />
        <Route
          path="staff/support/:id"
          element={
            <RequireRole roles={['SUPPORT_AGENT', 'ADMIN']}>
              <StaffTicketPage />
            </RequireRole>
          }
        />
        <Route
          path="staff/orders"
          element={
            <RequireRole roles={['WAREHOUSE_STAFF', 'ADMIN', 'SUPPORT_AGENT']}>
              <WarehouseOrdersPage />
            </RequireRole>
          }
        />
        <Route
          path="staff/inventory"
          element={
            <RequireRole roles={['WAREHOUSE_STAFF', 'ADMIN']}>
              <InventoryPage />
            </RequireRole>
          }
        />

        {/* Quản trị */}
        <Route
          path="admin"
          element={
            <RequireRole roles={['ADMIN']}>
              <AdminDashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/products"
          element={
            <RequireRole roles={['ADMIN']}>
              <AdminProductsPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireRole roles={['ADMIN']}>
              <UsersPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/queues"
          element={
            <RequireRole roles={['ADMIN']}>
              <QueuesPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/system"
          element={
            <RequireRole roles={['ADMIN']}>
              <SystemPage />
            </RequireRole>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
