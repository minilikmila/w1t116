<script lang="ts">
  import { onMount } from 'svelte';
  import { idbAccessLayer } from '../services/idbAccessLayer';
  import { rbacService } from '../services/rbacService';
  import type { Attendance, Registration } from '../types';

  let { sessionId }: { sessionId: string } = $props();

  let registrations = $state<Registration[]>([]);
  let attendanceRecords = $state<Map<string, Attendance>>(new Map());
  let loading = $state(true);
  let saving = $state(false);
  let message = $state('');

  const session = rbacService.getCurrentSession();
  const canTrack = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR'].includes(session.role);

  onMount(async () => {
    if (!canTrack) return;
    try {
      const regs = await idbAccessLayer.getAll<Registration>('registrations', 'idx_session', sessionId);
      registrations = regs.filter((r) => r.status === 'active');

      const allAttendance = await idbAccessLayer.getAll<Attendance>('attendance', 'idx_session', sessionId);
      const map = new Map<string, Attendance>();
      for (const a of allAttendance) {
        map.set(a.participant_id, a);
      }
      attendanceRecords = map;
    } catch (err: any) {
      message = err.message;
    } finally {
      loading = false;
    }
  });

  async function setAttendance(participantId: string, status: Attendance['attendance_status']) {
    saving = true;
    message = '';
    try {
      const existing = attendanceRecords.get(participantId);
      const record: Attendance = existing
        ? { ...existing, attendance_status: status, recorded_by: session.user_id, recorded_at: Date.now(), _version: existing._version }
        : {
            attendance_id: crypto.randomUUID(),
            session_id: sessionId,
            participant_id: participantId,
            attendance_status: status,
            recorded_by: session.user_id,
            recorded_at: Date.now(),
            _version: 1,
          };

      await idbAccessLayer.put('attendance', record);
      attendanceRecords.set(participantId, record);
      attendanceRecords = new Map(attendanceRecords);
      message = 'Saved';
    } catch (err: any) {
      message = err.message;
    } finally {
      saving = false;
    }
  }

  function getStatus(participantId: string): string {
    const record = attendanceRecords.get(participantId);
    return record ? record.attendance_status : 'unmarked';
  }
</script>

{#if canTrack}
  <div class="attendance-tracker">
    <h3>Attendance Tracking</h3>

    {#if loading}
      <p>Loading...</p>
    {:else if registrations.length === 0}
      <p class="empty">No registered participants.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Participant</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each registrations as reg}
            <tr>
              <td>{reg.participant_id}</td>
              <td>
                <span class="status-badge" class:present={getStatus(reg.participant_id) === 'present'}
                  class:absent={getStatus(reg.participant_id) === 'absent'}
                  class:no-show={getStatus(reg.participant_id) === 'no-show'}>
                  {getStatus(reg.participant_id)}
                </span>
              </td>
              <td class="actions">
                <button disabled={saving} onclick={() => setAttendance(reg.participant_id, 'present')}>Present</button>
                <button disabled={saving} onclick={() => setAttendance(reg.participant_id, 'absent')}>Absent</button>
                <button disabled={saving} onclick={() => setAttendance(reg.participant_id, 'no-show')}>No-Show</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if message}
      <p class="msg">{message}</p>
    {/if}
  </div>
{/if}

<style>
  .attendance-tracker {
    margin-top: 1.5rem;
    border-top: 1px solid #e2e8f0;
    padding-top: 1rem;
  }

  h3 { font-size: 1rem; margin-bottom: 0.75rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
  th { font-weight: 600; color: #64748b; }

  .status-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: capitalize;
  }
  .status-badge.present { background: #dcfce7; color: #166534; }
  .status-badge.absent { background: #fef3c7; color: #92400e; }
  .status-badge.no-show { background: #fef2f2; color: #dc2626; }

  .actions { display: flex; gap: 0.25rem; }
  .actions button {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    cursor: pointer;
  }
  .actions button:hover { background: #f3f4f6; }
  .actions button:disabled { opacity: 0.5; }

  .empty { color: #94a3b8; font-style: italic; }
  .msg { margin-top: 0.5rem; font-size: 0.8rem; color: #64748b; }
</style>
