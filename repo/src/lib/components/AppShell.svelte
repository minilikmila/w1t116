<script lang="ts">
  import type { Snippet } from 'svelte';
  import { authStore, uiStore, notificationStore } from '../stores';
  import { navigate, currentPath } from '../utils/router';
  import type { Role } from '../types';

  let { children }: { children: Snippet } = $props();

  const BADGE_CAP = 99;

  // Props for badge counts (will be wired later)
  let unreadMessages = $state(0);
  let activeTodos = $state(0);

  interface NavItem {
    label: string;
    path: string;
    icon: string;
    roles: Role[];
  }

  const navItems: NavItem[] = [
    { label: 'Dashboard', path: '/dashboard', icon: '⌂', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'] },
    { label: 'Rooms', path: '/rooms', icon: '□', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'] },
    { label: 'Registration', path: '/registration', icon: '✎', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'] },
    { label: 'Billing', path: '/billing', icon: '$', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'PARTICIPANT'] },
    { label: 'Messages', path: '/messages', icon: '✉', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'] },
    { label: 'Analytics', path: '/analytics', icon: '◔', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'] },
    { label: 'Admin', path: '/admin', icon: '⚙', roles: ['SYSTEM_ADMIN'] },
    { label: 'Maintenance', path: '/admin/maintenance', icon: '⚠', roles: ['SYSTEM_ADMIN', 'OPS_COORDINATOR'] },
  ];

  function filteredNavItems(role: Role): NavItem[] {
    return navItems.filter((item) => item.roles.includes(role));
  }

  function formatBadge(count: number): string {
    return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  }

  function isActive(itemPath: string, current: string): boolean {
    if (itemPath === '/dashboard') return current === '/dashboard';
    return current.startsWith(itemPath);
  }

  async function handleLogout() {
    const { authService } = await import('../services/authService');
    await authService.logout();
    navigate('/login');
  }

  function toggleSidebar() {
    uiStore.update((s) => ({ ...s, sidebarCollapsed: !s.sidebarCollapsed }));
  }
</script>

{#if $authStore}
  <div class="app-shell" class:sidebar-collapsed={$uiStore.sidebarCollapsed}>
    <!-- Top Bar -->
    <header class="top-bar">
      <button class="menu-toggle" onclick={toggleSidebar} aria-label="Toggle sidebar">
        ☰
      </button>
      <span class="app-title">Learning Center</span>

      <div class="top-bar-actions">
        <button
          class="icon-btn"
          onclick={() => navigate('/messages')}
          aria-label="Messages"
          title="Messages"
        >
          ✉
          {#if unreadMessages > 0}
            <span class="badge">{formatBadge(unreadMessages)}</span>
          {/if}
        </button>

        <button
          class="icon-btn"
          onclick={() => navigate('/todos')}
          aria-label="To-Dos"
          title="To-Dos"
        >
          ☑
          {#if activeTodos > 0}
            <span class="badge">{formatBadge(activeTodos)}</span>
          {/if}
        </button>

        <span class="user-info">
          {$authStore.role.replace('_', ' ')}
        </span>

        <button class="logout-btn" onclick={handleLogout}>
          Sign Out
        </button>
      </div>
    </header>

    <!-- Sidebar -->
    <nav class="sidebar" aria-label="Main navigation">
      {#each filteredNavItems($authStore.role) as item}
        <a
          href={'#' + item.path}
          class="nav-item"
          class:active={isActive(item.path, $currentPath)}
          title={item.label}
        >
          <span class="nav-icon">{item.icon}</span>
          {#if !$uiStore.sidebarCollapsed}
            <span class="nav-label">{item.label}</span>
          {/if}
        </a>
      {/each}
    </nav>

    <!-- Main Content -->
    <main class="content">
      {@render children()}
    </main>
  </div>
{:else}
  {@render children()}
{/if}

<!-- Toast notifications -->
{#if $notificationStore.length > 0}
  <div class="toast-container">
    {#each $notificationStore as notification (notification.id)}
      <div class="toast toast-{notification.type}">
        {notification.text}
      </div>
    {/each}
  </div>
{/if}

<style>
  .app-shell {
    display: grid;
    grid-template-areas:
      "topbar topbar"
      "sidebar content";
    grid-template-columns: 220px 1fr;
    grid-template-rows: 48px 1fr;
    min-height: 100vh;
  }

  .app-shell.sidebar-collapsed {
    grid-template-columns: 56px 1fr;
  }

  .top-bar {
    grid-area: topbar;
    display: flex;
    align-items: center;
    padding: 0 1rem;
    background: #1e293b;
    color: white;
    gap: 0.75rem;
    z-index: 10;
  }

  .menu-toggle {
    background: none;
    border: none;
    color: white;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem;
  }

  .app-title {
    font-weight: 600;
    font-size: 1rem;
  }

  .top-bar-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .icon-btn {
    position: relative;
    background: none;
    border: none;
    color: white;
    font-size: 1.125rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #ef4444;
    color: white;
    font-size: 0.625rem;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 8px;
    min-width: 16px;
    text-align: center;
  }

  .user-info {
    font-size: 0.8rem;
    opacity: 0.8;
    text-transform: capitalize;
  }

  .logout-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .logout-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .sidebar {
    grid-area: sidebar;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    padding: 0.5rem;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    color: #475569;
    text-decoration: none;
    font-size: 0.875rem;
    margin-bottom: 2px;
    transition: background 0.1s;
  }

  .nav-item:hover {
    background: #e2e8f0;
  }

  .nav-item.active {
    background: #dbeafe;
    color: #1e40af;
    font-weight: 500;
  }

  .nav-icon {
    font-size: 1.125rem;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
  }

  .nav-label {
    white-space: nowrap;
  }

  .content {
    grid-area: content;
    padding: 1.5rem;
    overflow-y: auto;
    background: #ffffff;
  }

  .toast-container {
    position: fixed;
    top: 56px;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 400px;
  }

  .toast {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideIn 0.3s ease;
  }

  .toast-error {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
  }

  .toast-success {
    background: #f0fdf4;
    color: #16a34a;
    border: 1px solid #bbf7d0;
  }

  .toast-warning {
    background: #fffbeb;
    color: #d97706;
    border: 1px solid #fde68a;
  }

  .toast-info {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
  }

  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  @media (max-width: 768px) {
    .app-shell {
      grid-template-columns: 56px 1fr;
    }

    .nav-label {
      display: none;
    }
  }
</style>
