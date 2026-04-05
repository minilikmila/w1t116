<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, onDestroy } from 'svelte';
  import { authStore } from '../stores';
  import { currentPath, navigate, getRouteRoles, resolveCurrentRoute } from '../utils/router';
  import type { Role } from '../types';

  let { children }: { children: Snippet } = $props();

  let unsubPath: (() => void) | undefined;
  let sessionCheckInterval: ReturnType<typeof setInterval> | undefined;

  function checkAccess(path: string): void {
    const roles = getRouteRoles(path);
    const session = $authStore;

    // Public route (login)
    if (roles === 'public') {
      // If already logged in, redirect to dashboard
      if (session && session.expires_at > Date.now()) {
        navigate('/dashboard');
      }
      return;
    }

    // No matching route
    if (roles === null) {
      if (session) {
        navigate('/dashboard');
      } else {
        navigate('/login', { redirect: path });
      }
      return;
    }

    // Not authenticated
    if (!session || session.expires_at <= Date.now()) {
      navigate('/login', { redirect: path });
      return;
    }

    // Role check
    const allowedRoles = roles as Role[];
    if (!allowedRoles.includes(session.role)) {
      navigate('/dashboard');
      return;
    }
  }

  function checkSessionExpiry(): void {
    const session = $authStore;
    if (session && session.expires_at <= Date.now()) {
      authStore.set(null);
      const path = $currentPath;
      navigate('/login', { redirect: path });
    }
  }

  onMount(() => {
    // Check access on every path change
    unsubPath = currentPath.subscribe((path) => {
      checkAccess(path);
      resolveCurrentRoute();
    });

    // Periodic session validity check every 60 seconds
    sessionCheckInterval = setInterval(checkSessionExpiry, 60_000);
  });

  onDestroy(() => {
    unsubPath?.();
    if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  });
</script>

{@render children()}
