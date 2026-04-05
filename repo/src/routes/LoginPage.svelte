<script lang="ts">
  import { authStore } from '../lib/stores';
  import { navigate, currentQuery } from '../lib/utils/router';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      // Dynamic import to avoid circular dependency issues at startup
      const { authService } = await import('../lib/services/authService');
      await authService.login(username, password);

      // Redirect to intended destination or dashboard
      const query = $currentQuery;
      const redirect = query.redirect || '/dashboard';
      navigate(redirect);
    } catch (err: any) {
      error = err.message || 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-container">
  <div class="login-card">
    <h1>Learning Center</h1>
    <p class="subtitle">Sign in to continue</p>

    <form onsubmit={handleLogin}>
      <div class="field">
        <label for="username">Username</label>
        <input
          id="username"
          type="text"
          bind:value={username}
          required
          disabled={loading}
          autocomplete="username"
        />
      </div>

      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          required
          disabled={loading}
          autocomplete="current-password"
        />
      </div>

      {#if error}
        <div class="error" role="alert">{error}</div>
      {/if}

      <button type="submit" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  </div>
</div>

<style>
  .login-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: #f5f5f5;
  }

  .login-card {
    background: white;
    border-radius: 8px;
    padding: 2rem;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
    color: #1a1a1a;
  }

  .subtitle {
    color: #666;
    margin-bottom: 1.5rem;
  }

  .field {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: 500;
    font-size: 0.875rem;
    color: #333;
  }

  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 1rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: #4a90d9;
    box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.15);
  }

  input:disabled {
    background: #f5f5f5;
  }

  .error {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  button {
    width: 100%;
    padding: 0.625rem;
    background: #4a90d9;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: #3a7bc8;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
