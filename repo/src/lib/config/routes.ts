import type { RouteDefinition } from '../utils/router';
import type { Role } from '../types';

const allRoles: Role[] = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'];

export const routeDefinitions: RouteDefinition[] = [
  {
    path: '/login',
    component: () => import('../../routes/LoginPage.svelte'),
    roles: 'public',
  },
  {
    path: '/dashboard',
    component: () => import('../../routes/DashboardPage.svelte'),
    roles: allRoles,
  },
  {
    path: '/rooms',
    component: () => import('../../routes/rooms/RoomSchedulingPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'],
  },
  {
    path: '/rooms/new',
    component: () => import('../../routes/rooms/RoomBookingForm.svelte'),
    roles: ['OPS_COORDINATOR', 'INSTRUCTOR'],
  },
  {
    path: '/rooms/:id',
    component: () => import('../../routes/rooms/RoomDetailPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'],
  },
  {
    path: '/registration',
    component: () => import('../../routes/registration/RegistrationPage.svelte'),
    roles: allRoles,
  },
  {
    path: '/registration/new',
    component: () => import('../../routes/registration/SessionCreatePage.svelte'),
    roles: ['INSTRUCTOR'],
  },
  {
    path: '/registration/:sessionId',
    component: () => import('../../routes/registration/SessionRegistrationDetail.svelte'),
    roles: allRoles,
  },
  {
    path: '/billing',
    component: () => import('../../routes/billing/BillingPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'PARTICIPANT'],
  },
  {
    path: '/billing/payments',
    component: () => import('../../routes/billing/PaymentRecordingPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
  {
    path: '/billing/meter',
    component: () => import('../../routes/billing/MeterEntryPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
  {
    path: '/billing/:billId',
    component: () => import('../../routes/billing/BillDetailPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'PARTICIPANT'],
  },
  {
    path: '/analytics',
    component: () => import('../../routes/analytics/AnalyticsDashboard.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
  {
    path: '/analytics/bookings',
    component: () => import('../../routes/analytics/BookingAnalyticsPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
  {
    path: '/analytics/billing',
    component: () => import('../../routes/analytics/BillingAnalyticsPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
  {
    path: '/messages',
    component: () => import('../../routes/messages/MessageCenterPage.svelte'),
    roles: allRoles,
  },
  {
    path: '/messages/compose',
    component: () => import('../../routes/messages/MessageComposePage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'],
  },
  {
    path: '/messages/:id',
    component: () => import('../../routes/messages/MessageDetailPage.svelte'),
    roles: allRoles,
  },
  {
    path: '/todos',
    component: () => import('../../routes/todos/ToDoCenterPage.svelte'),
    roles: allRoles,
  },
  {
    path: '/admin',
    component: () => import('../../routes/admin/AdminSettingsPage.svelte'),
    roles: ['SYSTEM_ADMIN'],
  },
  {
    path: '/admin/policies',
    component: () => import('../../routes/admin/PolicyConfigPage.svelte'),
    roles: ['SYSTEM_ADMIN'],
  },
  {
    path: '/admin/flags',
    component: () => import('../../routes/admin/FeatureFlagPage.svelte'),
    roles: ['SYSTEM_ADMIN'],
  },
  {
    path: '/admin/users',
    component: () => import('../../routes/admin/UserManagementPage.svelte'),
    roles: ['SYSTEM_ADMIN'],
  },
  {
    path: '/admin/export-import',
    component: () => import('../../routes/admin/ExportImportPage.svelte'),
    roles: ['SYSTEM_ADMIN'],
  },
  {
    path: '/admin/maintenance',
    component: () => import('../../routes/admin/MaintenanceWindowPage.svelte'),
    roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'],
  },
];
