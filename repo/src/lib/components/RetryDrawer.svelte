<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';

  let {
    visible,
    retryAfter,
    onClose,
    children,
  }: {
    visible: boolean;
    retryAfter: number;
    onClose: () => void;
    children?: Snippet;
  } = $props();

  let secondsLeft = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function startCountdown(ms: number): void {
    stopCountdown();
    secondsLeft = Math.ceil(ms / 1000);
    intervalId = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        stopCountdown();
        onClose();
      }
    }, 1000);
  }

  function stopCountdown(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  $effect(() => {
    if (visible && retryAfter > 0) {
      startCountdown(retryAfter);
    } else {
      stopCountdown();
    }
  });

  onDestroy(() => {
    stopCountdown();
  });
</script>

{#if visible}
  <div class="retry-drawer-backdrop" role="presentation" onclick={onClose}></div>
  <div class="retry-drawer" role="dialog" aria-label="Rate limit retry countdown">
    <div class="retry-drawer-content">
      <p class="retry-drawer-message">
        Rate limit reached. You can try again in <strong>{secondsLeft}</strong> second{secondsLeft !== 1 ? 's' : ''}.
      </p>
      {#if children}
        {@render children()}
      {/if}
      <button class="retry-drawer-close" onclick={onClose}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .retry-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999;
  }

  .retry-drawer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: #fff;
    border-top: 2px solid #e74c3c;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
    transform: translateY(0);
    transition: transform 0.3s ease;
    padding: 1.5rem;
    border-radius: 12px 12px 0 0;
  }

  .retry-drawer-content {
    max-width: 600px;
    margin: 0 auto;
    text-align: center;
  }

  .retry-drawer-message {
    font-size: 1rem;
    color: #333;
    margin: 0 0 1rem 0;
  }

  .retry-drawer-message strong {
    color: #e74c3c;
    font-size: 1.25rem;
  }

  .retry-drawer-close {
    padding: 0.5rem 1.5rem;
    background: #e74c3c;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .retry-drawer-close:hover {
    background: #c0392b;
  }
</style>
