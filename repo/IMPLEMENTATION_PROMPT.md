# Implementation-Ready Specification: Learning Center Operations Platform

---

## 1. SYSTEM OVERVIEW

Build a browser-only Svelte single-page application (English UI) that manages educational space reservations, participant enrollment, internal billing, and organizational communications. All data is stored in IndexedDB (primary) and LocalStorage (lightweight settings). No server, no API calls, no external dependencies beyond static asset serving. Multi-tab concurrency is handled via BroadcastChannel + IndexedDB transaction serialization. WebCrypto is used for all cryptographic operations.

---

## 2. ARCHITECTURE

### 2.1 Service Modules

| Service | Responsibility |
|---|---|
| `idbAccessLayer` | Unified IndexedDB abstraction: DB init, schema creation, transaction management, optimistic locking via `_version` field, user_id namespace filtering on all queries (except `configuration`, `feature_flags`), encryption integration (encrypt before write, decrypt after read when enabled). Broadcasts `record-updated`/`record-deleted` on `data-sync` BroadcastChannel after every successful mutation. |
| `authService` | PBKDF2 password hashing (310,000 iterations, WebCrypto), login/logout, session persistence in LocalStorage, brute-force lockout (10 failures → 15-min lock), password change with re-encryption coordination. Broadcasts `logout`/`session-refresh` on `auth-sync` channel. |
| `rbacService` | Static permission matrix, `checkRole(requiredRoles)` throws `AccessError`, `checkOwnership(resourceOwnerId, currentUserId)`. No role inheritance. Re-validates session before checking permissions. Consults `featureFlagService` for flag-gated operations. |
| `encryptionService` | AES-GCM encrypt/decrypt, PBKDF2 key derivation (310,000 iterations, random salt), re-encryption on password change with migration-in-progress flag and atomic rollback. Uses WebCrypto exclusively. |
| `roomSchedulingService` | Booking CRUD, time-overlap conflict detection via composite index `[room_id, start_time]`, equipment exclusivity checks, maintenance window checks, alternative room scoring and ranking (top 5). Policy enforcement (14-day window, max 3 active reservations). Blacklist validation. |
| `registrationService` | Add/drop/swap with atomic capacity management in single IndexedDB transactions, optimistic locking, one-seat-per-participant enforcement, idempotency, rate limiting (5 attempts/10 seconds) with cross-tab propagation via `registration-sync` channel. |
| `billingService` | Monthly bill generation (housing + metered utilities), waiver application, offline payment recording, overdue detection (10 days), reconciliation CSV export as Blob download. |
| `messageCenterService` | Compose, publish, retract, pin, schedule messages. Role/org-targeted delivery. Read receipts (one per user per message). Analytics: unique opens, time-to-first-read. Keyword search across title/body. Categories: Announcements, Registration, Billing, Tasks. |
| `todoReminderService` | Event-triggered and scheduled reminders, template variable resolution at delivery time, 60-second deduplication, DND enforcement with fire_at recomputation, send logging, batch delivery of queued reminders (throttled 10/sec). |
| `schedulerService` | Centralized scheduling engine: timer init, catch-up execution for missed tasks, DND awareness, cross-tab primary/secondary election via `scheduler-sync` channel, heartbeat (5s timeout), exponential backoff failure recovery (1m→30m, max 5 retries then mark "failed" and notify admins). Uses 60-second polling interval instead of long `setTimeout`. |
| `analyticsService` | Read-only computation: booking conversion rate, no-show rate, slot utilization, payment success rate. Time-period aggregation (daily/weekly/monthly). Filter by room, instructor, department. |
| `opsConfigService` | System policies, maintenance windows, blacklist rules, local JSON config loading. Persists to IndexedDB. SYSTEM_ADMIN only for modifications. |
| `exportImportService` | Full data export (JSON Blob with SCHEMA_VERSION + SHA-256 via WebCrypto). Import with hash verification, sequential schema migration for older versions, rejection of future versions. |
| `featureFlagService` | Flag CRUD in IndexedDB, evaluation by role + org_unit, in-memory cache per session, Svelte store for reactive UI gating, synchronous function for service-layer gating. Cache invalidation via `flag-sync` BroadcastChannel. |
| `idempotencyService` | UUID key management, deduplication checks, result caching, 5-minute abandonment timeout for in-progress keys, 24-hour cleanup via scheduler (runs every 6 hours). |

### 2.2 Svelte Stores (In-Memory)

| Store | Content |
|---|---|
| `authStore` | `{user_id, role, org_unit, token, expires_at}` — synced from LocalStorage |
| `flagStore` | Cached feature flag evaluations for current user (reactive derived store) |
| `uiStore` | Active modal, drawer visibility, retry countdown, sidebar collapsed state |
| `inboxStore` | Current inbox view: filtered messages, search query, pagination cursor |
| `notificationStore` | Pending in-app alert queue |

### 2.3 LocalStorage Keys

| Key | Content |
|---|---|
| `session_{user_id}` | Session token + metadata (cleared on logout) |
| `scheduler_next_run_{task_id}` | Next execution timestamp per scheduled task |
| `dnd_config` | DND window start/end times (default 22:00–07:00) |
| `user_preferences` | Theme, sidebar state, notification prefs |
| `encryption_enabled_{user_id}` | Boolean — at-rest encryption toggle |

### 2.4 BroadcastChannel System

| Channel | Message Types |
|---|---|
| `scheduler-sync` | `task-executed {task_id, new_next_run_at}`, `scheduler-active {tab_id}`, `scheduler-primary {tab_id}`, `scheduler-heartbeat {tab_id, timestamp}` |
| `data-sync` | `record-updated {store, record_id, version, user_id}`, `record-deleted {store, record_id, user_id}` |
| `registration-sync` | `capacity-changed {session_id, new_capacity, version}`, `rate-limit-increment {user_id, attempt_count, window_start}` |
| `flag-sync` | `flag-changed {flag_id, enabled, target_roles, target_org_units}` |
| `auth-sync` | `logout {user_id}`, `session-refresh {user_id, new_expires_at}` |

### 2.5 Frontend Routes

| Route | Component | Permitted Roles |
|---|---|---|
| `/login` | LoginPage | All (unauthenticated) |
| `/dashboard` | DashboardPage | ALL ROLES |
| `/rooms` | RoomSchedulingPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/rooms/:id` | RoomDetailPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/rooms/new` | RoomBookingForm | OPS_COORDINATOR, INSTRUCTOR |
| `/registration` | RegistrationPage | ALL ROLES |
| `/registration/:sessionId` | SessionRegistrationDetail | ALL ROLES |
| `/billing` | BillingPage | SYSTEM_ADMIN, OPS_COORDINATOR, PARTICIPANT |
| `/billing/:billId` | BillDetailPage | SYSTEM_ADMIN, OPS_COORDINATOR, PARTICIPANT |
| `/billing/payments` | PaymentRecordingPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/billing/meter` | MeterEntryPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics` | AnalyticsDashboard | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics/bookings` | BookingAnalyticsPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics/billing` | BillingAnalyticsPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/messages` | MessageCenterPage | ALL ROLES |
| `/messages/compose` | MessageComposePage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/messages/:id` | MessageDetailPage | ALL ROLES |
| `/todos` | ToDoCenterPage | ALL ROLES |
| `/admin` | AdminSettingsPage | SYSTEM_ADMIN |
| `/admin/policies` | PolicyConfigPage | SYSTEM_ADMIN |
| `/admin/flags` | FeatureFlagPage | SYSTEM_ADMIN |
| `/admin/users` | UserManagementPage | SYSTEM_ADMIN |
| `/admin/export-import` | ExportImportPage | SYSTEM_ADMIN |
| `/admin/maintenance` | MaintenanceWindowPage | SYSTEM_ADMIN, OPS_COORDINATOR |

Route guard: `RouteGuard` wrapper reads `authStore.role`, checks against route's `meta.roles`. If unauthenticated → redirect `/login`. If wrong role → redirect `/dashboard`. Check `expires_at` on every transition; redirect to `/login` if expired. Preserve intended destination as query param for post-login redirect. Periodic session check every 60 seconds.

---

## 3. DATA MODELS

### 3.1 IndexedDB Stores

**Database name**: `learning_center_db`

Every mutable record includes a `_version: number` field (starts at 1, incremented on each update) for optimistic locking.

**`users`** — keyPath: `user_id`
```
{
  user_id: string,
  username: string,
  password_hash: ArrayBuffer,
  salt: ArrayBuffer,
  role: "SYSTEM_ADMIN" | "OPS_COORDINATOR" | "INSTRUCTOR" | "PARTICIPANT",
  org_unit: string,
  failed_attempts: number,
  locked_until: number | null,
  encryption_enabled: boolean,
  encryption_salt: ArrayBuffer | null,
  _version: number
}
```
Indexes: `idx_username` (username, unique), `idx_role` (role), `idx_org_unit` (org_unit)

**`bookings`** — keyPath: `booking_id`
```
{
  booking_id: string,
  room_id: string,
  user_id: string,
  start_time: number (timestamp),
  end_time: number (timestamp),
  requested_equipment: string[],
  participant_capacity: number,
  status: "pending" | "confirmed" | "cancelled",
  created_at: number,
  _version: number
}
```
Indexes: `idx_room_time` ([room_id, start_time]), `idx_user` (user_id), `idx_status` (status), `idx_date_range` ([start_time, end_time])

**`sessions`** — keyPath: `session_id`
```
{
  session_id: string,
  instructor_id: string,
  room_id: string,
  booking_id: string,
  title: string,
  start_time: number,
  end_time: number,
  capacity: number,
  current_enrollment: number,
  status: "active" | "cancelled" | "completed",
  _version: number
}
```
Indexes: `idx_instructor` (instructor_id), `idx_room` (room_id), `idx_start_time` (start_time), `idx_status` (status)

**`registrations`** — keyPath: `registration_id`
```
{
  registration_id: string,
  participant_id: string,
  session_id: string,
  status: "active" | "cancelled" | "swapped",
  registered_at: number,
  _version: number
}
```
Indexes: `idx_participant_session` ([participant_id, session_id], unique), `idx_participant` (participant_id), `idx_session` (session_id), `idx_status` (status)

**`bills`** — keyPath: `bill_id`
```
{
  bill_id: string,
  participant_id: string,
  billing_period: string,
  housing_fee: number,
  utility_charge: number,
  waiver_amount: number,
  total: number,
  status: "generated" | "paid" | "overdue" | "partial",
  due_date: number,
  generated_at: number,
  _version: number
}
```
Indexes: `idx_participant` (participant_id), `idx_period` (billing_period), `idx_status` (status), `idx_due_date` (due_date)

**`payments`** — keyPath: `payment_id`
```
{
  payment_id: string,
  bill_id: string,
  amount: number,
  payment_method: "cash" | "check" | "manual",
  payment_date: number,
  recorded_by: string,
  _version: number
}
```
Indexes: `idx_bill` (bill_id), `idx_date` (payment_date), `idx_method` (payment_method)

**`messages`** — keyPath: `message_id`
```
{
  message_id: string,
  author_id: string,
  title: string,
  body: string,
  category: "Announcements" | "Registration" | "Billing" | "Tasks",
  target_roles: string[],
  target_org_scope: "department" | "program" | "all",
  target_org_units: string[],
  status: "draft" | "scheduled" | "published" | "retracted",
  scheduled_at: number | null,
  published_at: number | null,
  pinned: boolean,
  _version: number
}
```
Indexes: `idx_status` (status), `idx_author` (author_id), `idx_scheduled_at` (scheduled_at), `idx_category` (category)

**`read_receipts`** — keyPath: `receipt_id`
```
{
  receipt_id: string,
  message_id: string,
  user_id: string,
  read_at: number
}
```
Indexes: `idx_message_user` ([message_id, user_id], unique), `idx_message` (message_id), `idx_user` (user_id)

**`reminders`** — keyPath: `reminder_id`
```
{
  reminder_id: string,
  user_id: string,
  template: string,
  resolved_text: string | null,
  trigger_type: "event" | "scheduled",
  trigger_time: number | null,
  linked_entity_type: string | null,
  linked_entity_id: string | null,
  status: "pending" | "delivered" | "queued" | "cancelled",
  fire_at: number | null,
  _version: number
}
```
Indexes: `idx_user` (user_id), `idx_trigger_time` (trigger_time), `idx_status` (status)

**`send_logs`** — keyPath: `log_id`
```
{
  log_id: string,
  reminder_id: string,
  user_id: string,
  sent_at: number,
  delivery_status: "delivered" | "suppressed_dnd" | "failed"
}
```
Indexes: `idx_reminder` (reminder_id), `idx_timestamp` (sent_at)

**`billing_registry`** — keyPath: `registry_id`
```
{
  registry_id: string,
  registry_type: string,
  participant_id: string,
  meter_reading: number,
  entered_by: string,
  entered_at: number,
  _version: number
}
```
Indexes: `idx_type` (registry_type)

**`configuration`** — keyPath: `config_key`
```
{
  config_key: string,
  value: any,
  updated_at: number,
  updated_by: string
}
```
No additional indexes.

**`feature_flags`** — keyPath: `flag_id`
```
{
  flag_id: string,
  display_name: string,
  description: string,
  enabled: boolean,
  target_roles: string[],
  target_org_units: string[],
  created_by: string,
  created_at: number,
  updated_at: number
}
```
Indexes: `idx_enabled` (enabled)

**`idempotency_keys`** — keyPath: `key_id`
```
{
  key_id: string,
  status: "in-progress" | "completed",
  result: any | null,
  created_at: number,
  completed_at: number | null
}
```
Indexes: `idx_status` (status), `idx_created_at` (created_at)

**`scheduler_tasks`** — keyPath: `task_id`
```
{
  task_id: string,
  schedule_definition: string,
  task_type: "billing" | "messaging" | "reminder" | "cleanup",
  next_run_at: number,
  status: "active" | "executing" | "completed" | "failed",
  consecutive_failures: number,
  last_error: string | null,
  _version: number
}
```
Indexes: `idx_next_run` (next_run_at), `idx_status` (status)

**`error_logs`** — keyPath: `log_id`
```
{
  log_id: string,
  task_id: string,
  error_message: string,
  stack_trace: string | null,
  timestamp: number
}
```
Indexes: `idx_task` (task_id), `idx_timestamp` (timestamp)

**`maintenance_windows`** — keyPath: `window_id`
```
{
  window_id: string,
  room_id: string,
  start_time: number,
  end_time: number,
  description: string,
  _version: number
}
```
Indexes: `idx_room` (room_id), `idx_time_range` ([start_time, end_time])

**`blacklist_rules`** — keyPath: `rule_id`
```
{
  rule_id: string,
  target_type: "participant" | "room",
  target_id: string,
  reason: string,
  created_by: string,
  created_at: number,
  _version: number
}
```
Indexes: `idx_target_type` (target_type), `idx_target_id` (target_id)

**`attendance`** — keyPath: `attendance_id`
```
{
  attendance_id: string,
  session_id: string,
  participant_id: string,
  attendance_status: "present" | "absent" | "no-show",
  recorded_by: string,
  recorded_at: number,
  _version: number
}
```
Indexes: `idx_session` (session_id), `idx_participant` (participant_id), `idx_status` (attendance_status)

**`rooms`** — keyPath: `room_id`
```
{
  room_id: string,
  name: string,
  building_code: string,
  floor_code: string,
  capacity: number,
  equipment: string[],
  _version: number
}
```
Indexes: `idx_building` (building_code), `idx_capacity` (capacity)

**`equipment`** — keyPath: `equipment_id`
```
{
  equipment_id: string,
  room_id: string,
  equipment_type: string,
  name: string,
  is_exclusive: boolean,
  _version: number
}
```
Indexes: `idx_room` (room_id), `idx_type` (equipment_type)

**`waivers`** — keyPath: `waiver_id`
```
{
  waiver_id: string,
  participant_id: string,
  waiver_type: "fixed" | "percentage",
  value: number,
  status: "active" | "inactive",
  _version: number
}
```
Indexes: `idx_participant` (participant_id), `idx_type` (waiver_type), `idx_status` (status)

---

## 4. BUSINESS LOGIC

### 4.1 Authentication

1. On login: read user by username from IndexedDB.
2. Check `locked_until` — if set and in the future, reject with "Account locked. Try again at {time}".
3. Derive hash from entered password using PBKDF2 (310,000 iterations, stored salt, WebCrypto).
4. Compare derived hash to stored `password_hash`.
5. If mismatch: increment `failed_attempts`. If `failed_attempts` >= 10, set `locked_until` = now + 15 minutes. Return error.
6. If match: reset `failed_attempts` to 0, clear `locked_until`. Generate session token (`crypto.randomUUID()`). Write to LocalStorage: `session_{user_id}` = `{user_id, role, org_unit, token, expires_at}`. Populate `authStore`. Broadcast `session-refresh` on `auth-sync`.
7. On logout: clear `session_{user_id}` from LocalStorage. Broadcast `logout` on `auth-sync`. Clear `authStore`. Do NOT delete IndexedDB data.
8. On password change: set `migration_in_progress` flag in IndexedDB. Derive old key, derive new key. Read all encrypted records for user. Decrypt each with old key, re-encrypt with new key. Write all in single transaction. Update password hash and salt. Clear `migration_in_progress` flag. If interrupted (flag found on next login): allow retry or rollback.
9. Brute-force counter resets on: successful login, lockout period expiry.

### 4.2 Room Scheduling — Conflict Detection

1. Receive booking request: `{room_id, start_time, end_time, requested_equipment, participant_capacity}`.
2. Enforce policies: reject if `start_time` > now + 14 days. Reject if user has >= 3 active reservations.
3. Check blacklist rules for the room and user.
4. Query `bookings` store using `idx_room_time` for records where `room_id` matches AND time ranges overlap (existing.start_time < requested.end_time AND existing.end_time > requested.start_time) AND status != "cancelled".
5. Query `maintenance_windows` using `idx_room` for overlapping windows.
6. Query `equipment` store — for each requested exclusive equipment item, check if it's reserved by another booking in the time range (cross-room check).
7. If any conflicts found: return conflict list with reasons.

### 4.3 Room Scheduling — Alternative Scoring

When conflicts exist:

1. Query all rooms from `rooms` store.
2. Filter: capacity within ±10 of requested capacity.
3. For each candidate room, compute scores:
   - **Capacity fit (40%)**: `1 - (|room.capacity - requested| / requested)`. Clamp to [0, 1].
   - **Equipment match (30%)**: `(count of requested equipment available in room) / (total requested equipment)`.
   - **Availability (20%)**: 1.0 if no overlapping bookings/maintenance in the time range, 0.0 otherwise.
   - **Distance (10%)**: Compute distance from building/floor codes as numeric difference. Normalize: `1 - (distance / MAX_DISTANCE)` where `MAX_DISTANCE` is derived dynamically from the max distance between any two rooms in the configuration.
4. Weighted total = capacity×0.4 + equipment×0.3 + availability×0.2 + distance×0.1.
5. Sort descending, return top 5 with per-factor score breakdowns.

### 4.4 Registration — Add

1. `rbacService.checkRole(['PARTICIPANT'])`.
2. `idempotencyService.checkKey(idempotencyKey)` — if duplicate completed, return cached result. If in-progress < 5 min, throw `ConcurrencyError`. If in-progress > 5 min, treat as abandoned.
3. Check rate limit: read counter from IndexedDB for `{user_id, window_start}` where `window_start` = floor(now / 10000) * 10000. If count >= 5, throw rate-limit error. Broadcast `rate-limit-increment` on `registration-sync`.
4. Open single readwrite IndexedDB transaction spanning `sessions`, `registrations`, `idempotency_keys`.
5. Read session record. Verify `capacity > 0`.
6. Check composite unique index `[participant_id, session_id]` — if active registration exists, reject (one seat per participant per session).
7. Check blacklist rules for participant.
8. Check session start time against registration blackout period from policy.
9. Decrement session capacity, increment `_version`. If version mismatch → abort transaction.
10. Create registration record with status "active".
11. Mark idempotency key as "completed" with result.
12. Commit transaction.
13. Broadcast `capacity-changed` on `registration-sync`.
14. Send confirmation notification via `messageCenterService`.

### 4.5 Registration — Drop

Same as Add steps 1–3. Then within single transaction: mark registration as "cancelled", increment session capacity with version check, update idempotency key, commit.

### 4.6 Registration — Swap

Same as Add steps 1–3. Then within SINGLE transaction: cancel old registration, increment old session capacity (with version check), check new session capacity > 0, decrement new session capacity (with version check), create new registration. If ANY step fails, ENTIRE transaction rolls back. Original registration preserved.

### 4.7 Billing — Monthly Generation

Triggered by scheduler on 1st of month at 12:05 AM (or catch-up).

1. Read all active participants from `users` store.
2. Read billing registry for current meter readings.
3. Read configuration: `housing_fee`, `rate_per_unit`.
4. For each participant, within a SINGLE atomic transaction:
   a. Compute `utility_charge = meter_reading × rate_per_unit`.
   b. Compute `subtotal = housing_fee + utility_charge`.
   c. Read active waivers for participant from `waivers` store.
   d. Apply fixed waivers first: `subtotal -= fixed_amount`.
   e. Apply percentage waivers on remainder: `subtotal *= (1 - percentage/100)`.
   f. Cap total at 0 (no negative bills). Log anomaly if waiver > 100%.
   g. If meter reading is 0 or missing: utility_charge = 0, log warning.
   h. Generate bill record: `{total, due_date: generated_at + 10 days, status: "generated"}`.
   i. Reset meter reading to 0.
5. Send notification to each participant via `messageCenterService`.
6. After 10 calendar days, mark unpaid bills as "overdue".

### 4.8 Billing — Waiver Formula

```
subtotal = housing_fee + (meter_reading × rate_per_unit)
after_fixed = subtotal - sum(fixed_waivers)
total = after_fixed × (1 - sum(percentage_waivers) / 100)
total = max(total, 0)
```

### 4.9 Message Center

- **Publish**: Set status = "published", set `published_at` = now. Evaluate targeting at publish time (not compose time).
- **Schedule**: Set status = "scheduled", register task with `schedulerService` with `fire_at` = scheduled datetime. At fire time, re-evaluate targeting with current user roles/org membership, then set status = "published".
- **Retract**: Set status = "retracted". Retain record and read receipts for audit. Hide from inboxes.
- **Pin**: Set `pinned = true`. Pinned messages sort to top of inbox.
- **Read receipt**: On opening `/messages/:id`, check `idx_message_user` for existing receipt. If none, create `{message_id, user_id, read_at: now}`.
- **Analytics**: Unique opens = count of read_receipts for message. Time-to-first-read = earliest read_receipt.read_at - message.published_at.
- **Search**: Keyword search across `title` and `body` fields. Paginate results, sort by recency.

### 4.10 Scheduler

- **Initialization**: On app mount, read all `scheduler_tasks` from IndexedDB. Read `next_run_at` from LocalStorage (fallback to IndexedDB). Broadcast `scheduler-active` on `scheduler-sync`, wait 100ms for `scheduler-primary` response. If no response → become primary. If response → become secondary (monitor only).
- **Catch-up**: Before registering timers, find all tasks where `next_run_at` < now. Sort by priority: billing > messaging > reminders. For recurring tasks with multiple missed periods, execute once per missed period. Show progress indicator. After catch-up, advance `next_run_at` to next future occurrence.
- **Polling**: Use 60-second recurring interval to check `Date.now()` against `next_run_at` for all tasks. On `visibilitychange` (tab refocus), immediately check all tasks.
- **DND**: Before executing reminder-type tasks, check `dnd_config` from LocalStorage. If within DND window (default 22:00–07:00): do NOT execute, recompute `fire_at` = DND end time, persist, re-register timer. Billing and messaging tasks are exempt from DND.
- **Cross-tab**: On task execution, broadcast `task-executed {task_id, new_next_run_at}`. Receiving tabs cancel their timer and re-register. Primary sends heartbeat every 5 seconds. If secondary detects no heartbeat for 5 seconds, it becomes primary.
- **Duplicate execution prevention**: Before executing catch-up task, write `status: "executing"` to the task record in a readwrite transaction. Second tab's transaction sees this and skips.
- **Failure recovery**: On task handler exception: log to `error_logs`, do NOT advance `next_run_at`. Retry with backoff: delay = 1min × 2^(consecutive_failures - 1), capped at 30 minutes. After 5 consecutive failures: set task status = "failed", stop retrying, notify SYSTEM_ADMIN and OPS_COORDINATOR via `messageCenterService`. Manual re-enable from Admin Settings resets `consecutive_failures` to 0.

### 4.11 Reminders & DND

- Resolve template variables at delivery time (e.g., `{{room_name}}` → current room name from IndexedDB). If referenced entity deleted, substitute `"[Room removed]"` / `"[Session cancelled]"`.
- Deduplication: suppress reminders with identical content + same user within 60-second window. Use original trigger time for dedup check, NOT delayed `fire_at`.
- DND queued reminders: batch-deliver on app reload outside DND hours or when DND ends. Throttle: 10 per second.
- Before delivering event-triggered reminder, verify linked session is not cancelled.

### 4.12 Feature Flag Evaluation

```
function evaluateFlag(flag_id, {role, org_unit}):
  1. Look up flag_id in memory cache
  2. If not found → return false
  3. If enabled === false → return false
  4. If target_roles is non-empty AND role not in target_roles → return false
  5. If target_org_units is non-empty AND org_unit not in target_org_units → return false
  6. Return true
```

- UI gating: `{#if $flagStore['flag_name']}...{/if}`
- Service gating: call `evaluateFlag()` at start of gated operation. If false, throw `FeatureDisabledError`.

### 4.13 Analytics Formulas

- **Booking conversion rate**: confirmed bookings / total booking requests. If 0 requests → display "N/A".
- **No-show rate**: no-shows / total expected attendees. If 0 expected → display "N/A".
- **Slot utilization**: booked hours / total available hours per room per period.
- **Payment success rate**: paid bills / total generated bills. If 0 bills → display "N/A".

### 4.14 Export/Import

- **Export**: Read all IndexedDB stores (decrypt if encryption enabled). Serialize to JSON. Embed `SCHEMA_VERSION` (integer constant). Compute SHA-256 of data payload via WebCrypto. Wrap in envelope: `{schema_version, sha256, data, exported_at}`. Trigger Blob download.
- **Import**: Read uploaded file. Compute SHA-256 of `data` field. Compare to embedded `sha256` — reject on mismatch with "Integrity check failed" error. Check `schema_version`: if > current → reject with "Please update application". If < current → apply sequential migration functions. If == current → proceed. Write all migrated data in single IndexedDB transaction. On failure → rollback, existing data preserved.

### 4.15 Idempotency Key Lifecycle

- Key generated client-side via `crypto.randomUUID()` on user action.
- Each distinct action gets a fresh key. Retries reuse original key.
- On check: found + "completed" → return cached result (no re-execution). Found + "in-progress" + age < 5min → throw `ConcurrencyError`. Found + "in-progress" + age >= 5min → treat as abandoned, overwrite. Not found → create with "in-progress", proceed.
- Cleanup: every 6 hours (via scheduler), delete records with status "completed" and `created_at` > 24 hours ago. Skip "in-progress" records.

### 4.16 Operation Queue

Each tab maintains an in-memory queue that serializes IndexedDB mutations. Operations are enqueued with `{store, mutationFn, callback}`. Queue processes one at a time: open transaction, execute mutation, invoke callback with result/error.

---

## 5. INTERFACES / CONTRACTS

### 5.1 Service Function Signatures

```typescript
// idbAccessLayer
idbAccessLayer.init(): Promise<void>
idbAccessLayer.get(store: string, key: string, userId?: string): Promise<Record>
idbAccessLayer.getAll(store: string, indexName?: string, query?: IDBKeyRange, userId?: string): Promise<Record[]>
idbAccessLayer.put(store: string, record: Record, userId?: string): Promise<{version: number}>
idbAccessLayer.delete(store: string, key: string, userId?: string): Promise<void>
idbAccessLayer.transaction(storeNames: string[], mode: "readonly"|"readwrite", fn: (tx) => Promise<T>): Promise<T>

// authService
authService.login(username: string, password: string): Promise<Session>
authService.logout(): Promise<void>
authService.changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>
authService.restoreSession(): Session | null

// rbacService
rbacService.checkRole(requiredRoles: string[]): void  // throws AccessError
rbacService.checkOwnership(resourceOwnerId: string, currentUserId: string): void  // throws AccessError

// encryptionService
encryptionService.deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey>
encryptionService.encrypt(key: CryptoKey, data: any): Promise<{ciphertext: ArrayBuffer, iv: ArrayBuffer, salt: ArrayBuffer}>
encryptionService.decrypt(key: CryptoKey, encrypted: {ciphertext, iv, salt}): Promise<any>
encryptionService.reEncryptAll(userId: string, oldPassword: string, newPassword: string): Promise<void>

// roomSchedulingService
roomSchedulingService.createBooking(request: BookingRequest): Promise<Booking | ConflictResult>
roomSchedulingService.updateBooking(bookingId: string, updates: Partial<Booking>): Promise<Booking>
roomSchedulingService.cancelBooking(bookingId: string): Promise<void>
roomSchedulingService.detectConflicts(request: BookingRequest): Promise<Conflict[]>
roomSchedulingService.getAlternatives(request: BookingRequest): Promise<ScoredRoom[]>

// registrationService
registrationService.add(participantId: string, sessionId: string, idempotencyKey: string): Promise<Registration>
registrationService.drop(participantId: string, sessionId: string, idempotencyKey: string): Promise<void>
registrationService.swap(participantId: string, fromSessionId: string, toSessionId: string, idempotencyKey: string): Promise<Registration>

// billingService
billingService.generateMonthlyBills(): Promise<Bill[]>
billingService.recordPayment(billId: string, payment: PaymentInput): Promise<Payment>
billingService.markOverdueBills(): Promise<void>
billingService.exportReconciliationCSV(period: string): Promise<Blob>

// messageCenterService
messageCenterService.compose(message: MessageInput): Promise<Message>
messageCenterService.publish(messageId: string): Promise<void>
messageCenterService.schedule(messageId: string, scheduledAt: number): Promise<void>
messageCenterService.retract(messageId: string): Promise<void>
messageCenterService.pin(messageId: string, pinned: boolean): Promise<void>
messageCenterService.recordReadReceipt(messageId: string, userId: string): Promise<void>
messageCenterService.getInbox(userId: string, filters: InboxFilters): Promise<PaginatedMessages>
messageCenterService.search(query: string, userId: string): Promise<PaginatedMessages>
messageCenterService.getAnalytics(messageId: string): Promise<{uniqueOpens: number, timeToFirstRead: number | null}>

// todoReminderService
todoReminderService.createReminder(reminder: ReminderInput): Promise<Reminder>
todoReminderService.deliverPending(): Promise<void>
todoReminderService.deliverQueuedBatch(): Promise<void>

// schedulerService
schedulerService.initialize(): Promise<void>
schedulerService.registerTask(task: TaskRegistration): Promise<void>
schedulerService.reEnableTask(taskId: string): Promise<void>

// analyticsService
analyticsService.getBookingConversionRate(period: DateRange): Promise<number | "N/A">
analyticsService.getNoShowRate(period: DateRange): Promise<number | "N/A">
analyticsService.getSlotUtilization(roomId: string, period: DateRange): Promise<number>
analyticsService.getPaymentSuccessRate(period: DateRange): Promise<number | "N/A">

// opsConfigService
opsConfigService.loadDefaults(): Promise<void>
opsConfigService.getPolicy(key: string): Promise<any>
opsConfigService.setPolicy(key: string, value: any): Promise<void>
opsConfigService.getMaintenanceWindows(roomId?: string): Promise<MaintenanceWindow[]>
opsConfigService.createMaintenanceWindow(window: MaintenanceWindowInput): Promise<MaintenanceWindow>
opsConfigService.getBlacklistRules(): Promise<BlacklistRule[]>

// exportImportService
exportImportService.exportAll(): Promise<Blob>
exportImportService.importData(file: File): Promise<{success: boolean, error?: string}>

// featureFlagService
featureFlagService.initialize(): Promise<void>
featureFlagService.evaluateFlag(flagId: string, context: {role: string, org_unit: string}): boolean
featureFlagService.createFlag(flag: FlagInput): Promise<FeatureFlag>
featureFlagService.updateFlag(flagId: string, updates: Partial<FeatureFlag>): Promise<void>

// idempotencyService
idempotencyService.checkKey(key: string): Promise<{isDuplicate: boolean, cachedResult?: any}>
idempotencyService.markComplete(key: string, result: any): Promise<void>
idempotencyService.cleanup(): Promise<void>
```

---

## 6. IMPLEMENTATION RULES

### 6.1 Constraints

- Zero server-side code. Zero external API calls. Zero WebSocket connections.
- All crypto via WebCrypto API only (no third-party crypto libraries).
- Never use `{@html}` for user-generated content in Svelte. Always use text interpolation `{variable}` which auto-escapes.
- All IndexedDB queries on user-owned data MUST include `user_id` filtering (namespace isolation), EXCEPT for `configuration` and `feature_flags` stores.
- All mutable records MUST include `_version` field for optimistic locking.
- All related writes (e.g., registration + capacity decrement) MUST occur within a SINGLE IndexedDB transaction.
- PBKDF2 iterations: exactly 310,000. No less.
- Rate limit: exactly 5 attempts per 10-second window.
- Lockout: exactly 10 failures, exactly 15 minutes.
- Billing: exactly 10 calendar days for overdue.
- DND default: exactly 10:00 PM to 7:00 AM.
- Scheduler heartbeat: exactly 5-second interval.
- Idempotency abandonment: exactly 5-minute timeout.
- Idempotency cleanup: every 6 hours, records older than 24 hours.
- Deduplication window: exactly 60 seconds.
- Alternative room scoring weights: capacity 40%, equipment 30%, availability 20%, distance 10%.
- Maximum 5 alternative room suggestions.
- Capacity filter for alternatives: ±10 seats of requested.
- Scheduler retry backoff: 1min × 2^(n-1), capped at 30 min, max 5 retries.
- Badge count cap: display "99+" when count exceeds 99.

### 6.2 Forbidden Patterns

- No role inheritance. SYSTEM_ADMIN does NOT inherit PARTICIPANT permissions.
- No `{@html}` for user-supplied content.
- No long-duration `setTimeout` for scheduling. Use 60-second polling.
- No separate IndexedDB transactions for related writes that must be atomic.
- No deletion of read receipts on message retraction (retain for audit).
- No negative bill totals (cap at 0).
- No discarding of DND-suppressed notifications (delay, not drop).
- No executing reminder-type tasks during DND window.
- No advancing `next_run_at` on task failure.
- No evaluating message targeting at compose/schedule time (evaluate at delivery time).

### 6.3 Required Patterns

- Optimistic locking on every mutable record write: read version, compare, write with incremented version, abort on mismatch.
- BroadcastChannel notification after every IndexedDB mutation.
- Idempotency key check before every registration operation.
- Rate limit check before every registration operation.
- RBAC check before every service-layer operation.
- Feature flag check before every flag-gated operation (both UI and service layer).
- Migration-in-progress flag set before re-encryption, cleared after.
- Progress indicator during scheduler catch-up execution.
- Startup consistency check validating referential integrity between stores.
- Periodic session validity check every 60 seconds.
- On `visibilitychange`, re-evaluate all scheduled task timers.

---

## 7. BUILD ORDER

### Phase 1: Foundation

1. **IndexedDB Access Layer** (`idbAccessLayer`): Database initialization with `learning_center_db`, schema creation for ALL 22 stores with all indexes as defined in section 3.1. Transaction management. Optimistic locking. User_id namespace filtering. Encryption integration hooks (encrypt before write, decrypt after read). `data-sync` BroadcastChannel broadcast after mutations.

2. **Encryption Service** (`encryptionService`): PBKDF2 key derivation (310,000 iterations, WebCrypto). AES-GCM encrypt/decrypt with random IV per operation. Re-encryption flow with migration-in-progress flag.

3. **Auth Service** (`authService`): Login flow with PBKDF2 hash comparison. Session persistence in LocalStorage. Brute-force lockout (10 attempts → 15-min lock, counter reset on success/expiry). Logout with LocalStorage cleanup. Password change with re-encryption coordination. `auth-sync` BroadcastChannel integration.

4. **RBAC Service** (`rbacService`): Static permission matrix (implement the full table from section 3d). `checkRole()` and `checkOwnership()` utilities. `AccessError` type. Session re-validation before permission check.

5. **Feature Flag Service** (`featureFlagService`): Flag CRUD in IndexedDB. `evaluateFlag()` function with the 5-step evaluation logic. In-memory cache. Svelte `flagStore` reactive store. `flag-sync` BroadcastChannel integration.

6. **BroadcastChannel Infrastructure**: Create utilities for `data-sync`, `auth-sync`, `scheduler-sync`, `registration-sync`, `flag-sync` channels. Message dispatch and listener registration.

7. **Frontend Routing & UI Shell**: All routes from section 2.5. `RouteGuard` component with role check, session expiry check, and redirect logic. Persistent top bar with Message Center icon (badge), To-Do icon (badge), user profile/logout. Sidebar with role-filtered navigation links. Responsive: sidebar collapses to icons/hamburger on narrow viewport. Login/logout pages.

### Phase 2: Core Features

8. **Operations Configuration Service** (`opsConfigService`): Load defaults from local JSON config. Policy CRUD (14-day booking window, 3-reservation limit, etc.). Maintenance window CRUD. Blacklist rule management. Configuration validation.

9. **Room Scheduling Service** (`roomSchedulingService`): Booking CRUD. Conflict detection (time overlap via composite index, equipment exclusivity, maintenance windows). Alternative room scoring with weighted formula. Policy enforcement. Blacklist validation.

10. **Idempotency Service** (`idempotencyService`): UUID key management. Deduplication check with 3 states (completed/in-progress/not-found). 5-minute abandonment. Result caching.

11. **Registration Service** (`registrationService`): Add/drop/swap with single-transaction atomicity. Capacity management with optimistic locking. One-seat enforcement. Rate limiting (5/10s) with `registration-sync` cross-tab propagation. Idempotency integration.

12. **Billing Service** (`billingService`): Bill generation with housing + utility formula. Waiver application (fixed first, then percentage). Payment recording. Overdue detection. Reconciliation CSV export as Blob.

13. **Room Scheduling UI**: Booking form, calendar view, conflict alternatives Modal with per-factor score breakdowns.

14. **Registration UI**: Session browsing with capacity display, add/drop/swap forms, retry countdown Drawer.

15. **Billing UI**: Bill list, bill detail, payment recording form, meter entry form, CSV export button.

16. **Admin UI**: Policy configuration page. Feature flag management page. User management page. Maintenance window page.

### Phase 3: Advanced Systems

17. **Scheduler Service** (`schedulerService`): Timer initialization from IndexedDB + LocalStorage. 60-second polling. Catch-up execution with priority ordering and progress indicator. DND interaction. Cross-tab primary/secondary election with heartbeat. `visibilitychange` handler. Failure recovery with exponential backoff. Admin notification for permanently failed tasks.

18. **Message Center Service** (`messageCenterService`): Compose, publish, retract, pin, schedule (with scheduler integration). Role/org targeting evaluated at delivery time. Read receipts. Analytics (unique opens, time-to-first-read). Keyword search. Category filtering.

19. **To-Do/Reminder Service** (`todoReminderService`): Event-triggered and scheduled reminders. Template variable resolution at delivery time with fallback strings. 60-second deduplication. DND enforcement with fire_at recomputation. Send logging. Batch delivery throttled at 10/sec.

20. **Analytics Service** (`analyticsService`): Booking conversion rate, no-show rate, slot utilization, payment success rate. Time-period aggregation. Filter by room/instructor/department. Handle division-by-zero with "N/A".

21. **Message Center UI**: Inbox with categories (Announcements, Registration, Billing, Tasks), search bar, message detail with read receipt trigger, compose form with targeting + scheduling, pin/retract controls.

22. **To-Do Center UI**: Reminder list, create/edit forms with template variable preview, DND configuration.

23. **Analytics Dashboard UI**: Metric cards, trend charts, filter controls.

24. **Attendance Tracking UI**: Per-session attendance/no-show recording for instructors.

### Phase 4: Hardening

25. **Export/Import Service** (`exportImportService`): Full export with SCHEMA_VERSION + SHA-256. Import with hash verification, sequential migration, future version rejection.

26. **Password Change Re-encryption Flow**: Full decrypt-re-encrypt cycle with progress indicator, migration-in-progress flag, atomic rollback.

27. **Rate Limiting with Cross-Tab Propagation**: `registration-sync` channel `rate-limit-increment` messages. Retry countdown Drawer component.

28. **Sensitive Field Masking**: Table component modifier showing only last 4 characters for designated fields.

29. **Startup Consistency Checker**: Validates referential integrity between related stores (registrations → sessions, payments → bills, etc.). Flags anomalies for admin review.

30. **Operation Queue**: Per-tab in-memory mutation serialization for IndexedDB writes.

31. **Idempotency Cleanup Task**: Register with scheduler to run every 6 hours. Purge completed keys older than 24 hours. Skip in-progress keys.

32. **Integration Tests**: Multi-tab concurrency, scheduler catch-up, billing edge cases (zero meter, waiver > 100%), swap atomicity, rate-limit enforcement, export/import round-trip, encryption toggle and password change re-encryption.

33. **Accessibility**: Keyboard navigation, ARIA labels, focus management for modals and drawers, screen reader compatibility.
