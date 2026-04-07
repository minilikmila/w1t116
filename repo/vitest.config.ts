import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./unit_tests/setup.ts'],
    include: [
      'unit_tests/**/*.test.ts',
      'API_tests/**/*.test.ts',
      'integration_tests/**/*.test.ts',
      'component_tests/**/*.test.ts',
    ],
    alias: {
      '$lib': '/src/lib',
    },
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '$lib': '/src/lib',
    },
  },
});
