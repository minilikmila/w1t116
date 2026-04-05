<script lang="ts">
  const adminLinks = [
    { href: '/admin/policies', title: 'Policy Configuration', description: 'Manage housing fees, booking windows, rate limits, and other system policies.' },
    { href: '/admin/feature-flags', title: 'Feature Flags', description: 'Toggle features on or off, target specific roles and org units.' },
    { href: '/admin/users', title: 'User Management', description: 'View all users, create new accounts, and assign roles.' },
    { href: '/admin/maintenance', title: 'Maintenance & Blacklist', description: 'Schedule maintenance windows and manage blacklist rules.' },
    { href: '/admin/export-import', title: 'Export / Import', description: 'Bulk export or import system data for backup and migration.' },
  ];
</script>

<div class="page">
  <h2>Admin Settings</h2>
  <p class="subtitle">System administration hub. Select a section below.</p>

  <div class="card-grid">
    {#each adminLinks as link}
      <a class="card" href={link.href}>
        <h3>{link.title}</h3>
        <p>{link.description}</p>
      </a>
    {/each}
  </div>
</div>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h2 {
    margin: 0 0 0.25rem;
    font-size: 1.5rem;
  }

  .subtitle {
    color: #555;
    margin: 0 0 1.5rem;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
  }

  .card {
    display: block;
    padding: 1.25rem;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    background: #fff;
    transition: box-shadow 0.15s, border-color 0.15s;
  }

  .card:hover {
    border-color: #4a90d9;
    box-shadow: 0 2px 8px rgba(74, 144, 217, 0.15);
  }

  .card h3 {
    margin: 0 0 0.5rem;
    font-size: 1.1rem;
    color: #2c3e50;
  }

  .card p {
    margin: 0;
    font-size: 0.9rem;
    color: #666;
    line-height: 1.4;
  }
</style>
