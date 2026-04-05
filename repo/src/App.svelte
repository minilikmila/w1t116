<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { authStore } from './lib/stores';
  import { registerRoutes, startRouter, resolvedRoute } from './lib/utils/router';
  import { routeDefinitions } from './lib/config/routes';
  import RouteGuard from './lib/components/RouteGuard.svelte';
  import AppShell from './lib/components/AppShell.svelte';
  import type { Snippet } from 'svelte';

  let initialized = $state(false);
  let initError = $state('');
  let initProgress = $state('');
  let stopRouter: (() => void) | undefined;

  onMount(async () => {
    try {
      // Full app initialization (IDB, config, scheduler, wiring)
      const { initializeApp, shutdownApp } = await import('./lib/services/appInitializer');
      await initializeApp((msg) => { initProgress = msg; });

      // Register routes and start router
      registerRoutes(routeDefinitions);
      stopRouter = startRouter();

      initialized = true;
    } catch (err: any) {
      initError = err.message || 'Failed to initialize application';
      console.error('Init error:', err);
    }
  });

  onDestroy(() => {
    stopRouter?.();
    import('./lib/services/appInitializer').then(({ shutdownApp }) => shutdownApp());
  });
</script>

{#if initError}
  <div class="init-error">
    <h2>Application Error</h2>
    <p>{initError}</p>
    <p>Please ensure your browser supports IndexedDB and try refreshing the page.</p>
  </div>
{:else if !initialized}
  <div class="loading">
    <p>Loading application...</p>
    {#if initProgress}
      <p class="progress">{initProgress}</p>
    {/if}
  </div>
{:else}
  <RouteGuard>
    {#snippet children()}
      <AppShell>
        {#snippet children()}
          {#if $resolvedRoute.component}
            {@const Component = $resolvedRoute.component}
            <Component params={$resolvedRoute.params} />
          {:else}
            <div class="not-found">
              <h2>Page Not Found</h2>
              <p>The requested page does not exist.</p>
            </div>
          {/if}
        {/snippet}
      </AppShell>
    {/snippet}
  </RouteGuard>
{/if}

<style>
  .init-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
    text-align: center;
    color: #dc2626;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: #666;
  }

  .progress {
    font-size: 0.85rem;
    color: #999;
    margin-top: 0.5rem;
  }

  .not-found {
    text-align: center;
    padding: 3rem;
    color: #666;
  }
</style>
