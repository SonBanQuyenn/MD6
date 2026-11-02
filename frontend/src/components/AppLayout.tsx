import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Group,
  Indicator,
  Menu,
  NavLink,
  Text,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingWarehouse,
  IconChartBar,
  IconHeadset,
  IconHome,
  IconLogout,
  IconMoon,
  IconPackage,
  IconReceipt,
  IconServer,
  IconShoppingCart,
  IconSun,
  IconTag,
  IconUsers,
  IconBuildingStore,
  IconMessageCircle,
  IconStack2,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { fetchCart } from '../api/endpoints';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: Role[]; // không khai báo = ai cũng thấy
}

const NAV: NavItem[] = [
  { to: '/', label: 'Trang chủ', icon: <IconHome size={18} /> },
  { to: '/products', label: 'Sản phẩm', icon: <IconBuildingStore size={18} /> },
  {
    to: '/orders',
    label: 'Đơn hàng của tôi',
    icon: <IconReceipt size={18} />,
    roles: ['CUSTOMER'],
  },
  {
    to: '/support',
    label: 'Hỗ trợ',
    icon: <IconMessageCircle size={18} />,
    roles: ['CUSTOMER'],
  },
  {
    to: '/staff/support',
    label: 'Ticket CSKH',
    icon: <IconHeadset size={18} />,
    roles: ['SUPPORT_AGENT', 'ADMIN'],
  },
  {
    to: '/staff/orders',
    label: 'Quản lý đơn',
    icon: <IconPackage size={18} />,
    roles: ['WAREHOUSE_STAFF', 'ADMIN', 'SUPPORT_AGENT'],
  },
  {
    to: '/staff/inventory',
    label: 'Tồn kho',
    icon: <IconBuildingWarehouse size={18} />,
    roles: ['WAREHOUSE_STAFF', 'ADMIN'],
  },
  {
    to: '/admin',
    label: 'Bảng điều khiển',
    icon: <IconChartBar size={18} />,
    roles: ['ADMIN'],
  },
  {
    to: '/admin/products',
    label: 'Sản phẩm (quản trị)',
    icon: <IconTag size={18} />,
    roles: ['ADMIN'],
  },
  {
    to: '/admin/users',
    label: 'Người dùng',
    icon: <IconUsers size={18} />,
    roles: ['ADMIN'],
  },
  {
    to: '/admin/queues',
    label: 'Hàng đợi',
    icon: <IconStack2 size={18} />,
    roles: ['ADMIN'],
  },
  {
    to: '/admin/system',
    label: 'Sức khoẻ hệ thống',
    icon: <IconServer size={18} />,
    roles: ['ADMIN'],
  },
];

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');

  const isCustomer = user?.role === 'CUSTOMER';
  const { data: cart } = useQuery({
    queryKey: ['cart'],
    queryFn: fetchCart,
    enabled: isCustomer,
  });

  const items = NAV.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );
  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <UnstyledButton component={Link} to="/">
              <Text fw={800} size="xl" c="orange">
                ShopFast
              </Text>
            </UnstyledButton>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              aria-label="Đổi giao diện sáng / tối"
              onClick={() =>
                setColorScheme(scheme === 'dark' ? 'light' : 'dark')
              }
            >
              {scheme === 'dark' ? (
                <IconSun size={18} />
              ) : (
                <IconMoon size={18} />
              )}
            </ActionIcon>
            {isCustomer && (
              <Indicator
                label={cart?.itemCount ?? 0}
                size={16}
                disabled={!cart?.itemCount}
              >
                <ActionIcon
                  variant="subtle"
                  aria-label="Giỏ hàng"
                  component={Link}
                  to="/cart"
                >
                  <IconShoppingCart size={20} />
                </ActionIcon>
              </Indicator>
            )}
            {user ? (
              <Menu position="bottom-end" withArrow>
                <Menu.Target>
                  <UnstyledButton aria-label="Tài khoản">
                    <Group gap={8} wrap="nowrap">
                      <Avatar color="orange" radius="xl" size="sm">
                        {user.fullName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text size="sm" visibleFrom="sm" lineClamp={1} maw={140}>
                        {user.fullName}
                      </Text>
                    </Group>
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>
                    {user.email}
                    <br />
                    <Badge size="xs" variant="light" mt={4}>
                      {ROLE_LABEL[user.role]}
                    </Badge>
                  </Menu.Label>
                  <Menu.Item
                    color="red"
                    leftSection={<IconLogout size={16} />}
                    onClick={async () => {
                      await logout();
                      navigate('/login');
                    }}
                  >
                    Đăng xuất
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Group gap="xs" wrap="nowrap">
                <Button variant="subtle" size="xs" component={Link} to="/login">
                  Đăng nhập
                </Button>
                <Button
                  size="xs"
                  component={Link}
                  to="/register"
                  visibleFrom="xs"
                >
                  Đăng ký
                </Button>
              </Group>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {items.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            leftSection={item.icon}
            active={isActive(item.to)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
