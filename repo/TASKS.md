# Task Breakdown: Learning Center Operations Platform

Starting from scratch — no existing project scaffolding.

---

## PHASE 0: Project Scaffolding

### T0.1 — Initialize Svelte Project
- Initialize a new Svelte project (SvelteKit or Vite + Svelte)
- Configure TypeScript
- Set up folder structure:
  ```
  src/
    lib/
      services/        # All service modules
      stores/          # Svelte stores
      components/      # Shared UI components
      types/           # TypeScript types/interfaces
      utils/           # Helpers (BroadcastChannel, crypto wrappers)
      config/          # Local JSON config files
    routes/            # Page components per route
  ```
- Install zero external runtime dependencies (browser-only constraint)
- **Acceptance**: `npm run dev` serves a blank page with no errors

### T0.2 — Define All TypeScript Types
- Create type definitions for ALL 22 data models from spec section 3.1 (User, Booking, Session, Registration, Bill, Payment, Message, ReadReceipt, Reminder, SendLog, BillingRegistry, Configuration, FeatureFlag, IdempotencyKey, SchedulerTask, ErrorLog, MaintenanceWindow, BlacklistRule, Attendance, Room, Equipment, Waiver)
- Create error types: `AccessError`, `VersionConflictError`, `ConcurrencyError`, `FeatureDisabledError`, `RateLimitError`
- Create enum/union types for roles: `SYSTEM_ADMIN | OPS_COORDINATOR | INSTRUCTOR | PARTICIPANT`
- Create `Session` type for auth: `{user_id, role, org_unit, token, expires_at}`
- **Acceptance**: All types compile with no errors, every field from spec section 3.1 is represented

### T0.3 — Create Local JSON Configuration Files
- Create `src/lib/config/defaults.json` with default policy values: `housing_fee: 950`, `rate_per_unit`, `booking_window_days: 14`, `max_active_reservations: 3`, `lockout_duration_minutes: 15`, `max_login_attempts: 10`, `rate_limit_attempts: 5`, `rate_limit_window_seconds: 10`, `overdue_days: 10`, `dnd_start: "22:00"`, `dnd_end: "07:00"`, `pbkdf2_iterations: 310000`
- Create `src/lib/config/rooms.json` with sample room data (5+ rooms with building_code, floor_code, capacity, equipment)
- **Acceptance**: JSON files parse without errors, all policy values from the spec are present

---

## PHASE 1: Foundation

### T1.1 — IndexedDB Access Layer: Database Init & Schema
- Create `src/lib/services/idbAccessLayer.ts`
- Implement `init()`: open `learning_center_db`, create all 22 object stores with correct keyPaths
- Create ALL indexes exactly as specified (composite indexes, unique constraints)
- Handle `onupgradeneeded` with versioned schema creation
- Handle IndexedDB unavailability (private browsing) with blocking error
- **Acceptance**: Calling `init()` creates the database with all 22 stores and all indexes visible in DevTools → Application → IndexedDB

### T1.2 — IndexedDB Access Layer: CRUD & Transactions
- Implement `get(store, key, userId?)`, `getAll(store, indexName?, query?, userId?)`, `put(store, record, userId?)`, `delete(store, key, userId?)`
- Implement `transaction(storeNames, mode, fn)` for multi-store atomic operations
- Apply `user_id` namespace filtering on ALL queries except `configuration` and `feature_flags` stores
- **Acceptance**: Can write a record, read it back, read it with wrong user_id and get nothing, delete it, confirm deletion

### T1.3 — IndexedDB Access Layer: Optimistic Locking
- On every `put()`: if record has `_version`, read current stored version first. If stored version !== expected version, throw `VersionConflictError`. Otherwise write with `_version + 1`.
- New records start with `_version: 1`
- **Acceptance**: Two concurrent writes to the same record — first succeeds, second throws `VersionConflictError`

### T1.4 — IndexedDB Access Layer: Encryption Integration Hooks
- Add encrypt-before-write and decrypt-after-read hooks in `put()` and `get()`/`getAll()`
- Check `encryption_enabled_{user_id}` from LocalStorage to decide whether to encrypt/decrypt
- Hooks call `encryptionService.encrypt()` / `encryptionService.decrypt()` (stub for now, will be implemented in T1.5)
- **Acceptance**: With encryption disabled, data is stored as plaintext. Hook points exist and are called when encryption flag is true (can be tested once T1.5 is done)

### T1.5 — Encryption Service
- Create `src/lib/services/encryptionService.ts`
- Implement `deriveKey(password, salt)`: PBKDF2, 310,000 iterations, SHA-256, WebCrypto `crypto.subtle.deriveKey()`
- Implement `encrypt(key, data)`: AES-GCM, random 12-byte IV per call, return `{ciphertext, iv, salt}`
- Implement `decrypt(key, encrypted)`: AES-GCM decrypt using stored IV and salt
- Implement `reEncryptAll(userId, oldPassword, newPassword)`: set migration-in-progress flag, read all encrypted records, decrypt with old key, re-encrypt with new key, write in single transaction, clear flag. On failure: rollback and clear flag.
- **Acceptance**: Encrypt a payload, decrypt it, get original back. Encrypt with key A, fail to decrypt with key B. Re-encrypt flow works end-to-end with migration-in-progress flag.

### T1.6 — BroadcastChannel Infrastructure
- Create `src/lib/utils/broadcastChannels.ts`
- Create channel instances: `data-sync`, `auth-sync`, `scheduler-sync`, `registration-sync`, `flag-sync`
- Implement `broadcast(channel, message)` utility
- Implement `onMessage(channel, handler)` listener registration with cleanup
- Implement fallback: if BroadcastChannel not supported, degrade gracefully (log warning, no-op broadcasts)
- **Acceptance**: Open two tabs, broadcast from one, receive in the other. Fallback path logs warning without errors.

### T1.7 — IndexedDB Access Layer: BroadcastChannel Integration
- After every successful `put()`, broadcast `{type: "record-updated", store, record_id, version, user_id}` on `data-sync`
- After every successful `delete()`, broadcast `{type: "record-deleted", store, record_id, user_id}` on `data-sync`
- **Acceptance**: Write a record in Tab A, Tab B receives `record-updated` message with correct payload

### T1.8 — Svelte Stores
- Create `src/lib/stores/authStore.ts`: writable store with `{user_id, role, org_unit, token, expires_at}`, init from LocalStorage
- Create `src/lib/stores/flagStore.ts`: writable store for cached flag evaluations, reactive derived store
- Create `src/lib/stores/uiStore.ts`: writable store for `{activeModal, drawerVisible, retryCountdown, sidebarCollapsed}`
- Create `src/lib/stores/inboxStore.ts`: writable store for `{messages, searchQuery, paginationCursor, category}`
- Create `src/lib/stores/notificationStore.ts`: writable store for pending alert queue
- **Acceptance**: Each store initializes with correct defaults, is subscribable, and updates reactively

### T1.9 — Auth Service: Login & Logout
- Create `src/lib/services/authService.ts`
- Implement `login(username, password)`:
  1. Read user by username from IndexedDB
  2. Check `locked_until` — reject if locked
  3. Derive hash via PBKDF2 (310,000 iterations, stored salt, WebCrypto)
  4. Compare hashes
  5. On mismatch: increment `failed_attempts`, set `locked_until` if >= 10, return error
  6. On match: reset `failed_attempts`, generate token via `crypto.randomUUID()`, write session to LocalStorage `session_{user_id}`, populate `authStore`
- Implement `logout()`: clear LocalStorage session, broadcast `logout` on `auth-sync`, clear `authStore`
- Implement `restoreSession()`: read from LocalStorage, check `expires_at`, populate `authStore` or return null
- **Acceptance**: Login with correct creds succeeds, session in LocalStorage. Login with wrong creds increments counter. 10 failures triggers lockout. Logout clears everything. Session restore works after page refresh.

### T1.10 — Auth Service: Password Change & Re-encryption
- Implement `changePassword(userId, oldPassword, newPassword)`:
  1. Verify old password
  2. Derive new hash + salt
  3. If encryption enabled: call `encryptionService.reEncryptAll()`
  4. Update user record with new hash/salt atomically
- Broadcast `session-refresh` on `auth-sync` after password change
- **Acceptance**: Password change works. Encrypted records are readable with new password. Migration-in-progress flag is set/cleared correctly.

### T1.11 — Auth Service: Cross-Tab Sync
- Listen on `auth-sync` for `logout` messages — clear local session and redirect to `/login`
- Listen for `session-refresh` — update `authStore` with new expiry
- **Acceptance**: Logout in Tab A causes Tab B to redirect to login

### T1.12 — RBAC Service
- Create `src/lib/services/rbacService.ts`
- Implement the full static permission matrix from spec section 3d (all 26 operations × 4 roles)
- Implement `checkRole(requiredRoles)`: read `authStore`, re-validate session expiry, throw `AccessError` if role not in required set or session expired/invalid
- Implement `checkOwnership(resourceOwnerId, currentUserId)`: throw `AccessError` if IDs don't match
- Unknown roles (corrupted session) → zero permissions, force re-auth
- **Acceptance**: PARTICIPANT calling an admin operation throws `AccessError`. INSTRUCTOR can create bookings. SYSTEM_ADMIN cannot register for sessions (no inheritance).

### T1.13 — Feature Flag Service
- Create `src/lib/services/featureFlagService.ts`
- Implement `initialize()`: read all flags from IndexedDB, populate in-memory cache
- Implement `evaluateFlag(flagId, {role, org_unit})`: 5-step evaluation (lookup → enabled check → role check → org_unit check → return true)
- Implement CRUD: `createFlag()`, `updateFlag()`, `deleteFlag()` — SYSTEM_ADMIN only
- Integrate with `flagStore` Svelte store for reactive UI
- Listen on `flag-sync` BroadcastChannel for cache invalidation
- Broadcast `flag-changed` after any flag mutation
- **Acceptance**: Create a flag targeting only INSTRUCTOR role. evaluateFlag returns true for INSTRUCTOR, false for PARTICIPANT. Change flag in Tab A, Tab B cache is invalidated.

### T1.14 — Frontend Routing Setup
- Set up router with all 24 routes from spec section 2.5
- Each route has `meta.roles` array defining permitted roles
- **Acceptance**: All routes are registered and navigate correctly (render placeholder components for now)

### T1.15 — RouteGuard Component
- Create `RouteGuard` wrapper component
- On every route transition: read `authStore.role`, compare to route's `meta.roles`
- If unauthenticated → redirect `/login` (preserve intended URL as query param)
- If wrong role → redirect `/dashboard`
- Check `authStore.expires_at` — if expired → redirect `/login`
- Implement 60-second periodic session validity check
- **Acceptance**: Unauthenticated user going to `/admin` → redirected to `/login?redirect=/admin`. PARTICIPANT going to `/admin` → redirected to `/dashboard`. Expired session → redirected to `/login`.

### T1.16 — UI Shell: Layout, Top Bar, Sidebar
- Create persistent layout with top bar and sidebar
- Top bar: Message Center icon (with badge placeholder), To-Do icon (with badge placeholder), user profile display, logout button
- Sidebar: navigation links for Rooms, Registration, Billing, Analytics, Messages, To-Dos, Admin Settings
- Filter sidebar links based on `authStore.role` using the permission matrix
- Badge count display: cap at "99+" when count > 99
- Responsive: sidebar collapses to icon-only or hamburger menu on narrow viewport
- **Acceptance**: Login as PARTICIPANT — see only Registration, Billing, Messages, To-Dos in sidebar. Login as SYSTEM_ADMIN — see all links. Narrow viewport collapses sidebar.

### T1.17 — Login Page
- Create `/login` page with username/password form
- Call `authService.login()` on submit
- Display error messages (invalid creds, account locked with time remaining)
- On success: redirect to `/dashboard` or preserved redirect URL
- **Acceptance**: Can log in with valid credentials, see error on invalid, see lockout message after 10 failures

### T1.18 — Dashboard Page
- Create `/dashboard` placeholder page
- Display welcome message with user's role
- Placeholder cards for quick stats (will be populated later)
- **Acceptance**: After login, user sees dashboard with their role displayed

---

## PHASE 2: Core Features

### T2.1 — Operations Configuration Service
- Create `src/lib/services/opsConfigService.ts`
- Implement `loadDefaults()`: read from `defaults.json`, write to `configuration` store if not already present
- Implement `getPolicy(key)`, `setPolicy(key, value)` — SYSTEM_ADMIN only for writes
- Validate config changes (e.g., booking window cannot be negative)
- Handle malformed JSON config: fall back to hardcoded defaults, log warning
- **Acceptance**: First load writes defaults. `getPolicy("housing_fee")` returns 950. Non-admin cannot setPolicy.

### T2.2 — Maintenance Window CRUD
- Implement `createMaintenanceWindow()`, `updateMaintenanceWindow()`, `deleteMaintenanceWindow()`
- Implement `getMaintenanceWindows(roomId?)` — filter by room or return all
- SYSTEM_ADMIN and OPS_COORDINATOR only
- When a new window overlaps existing confirmed bookings: flag them but do NOT auto-cancel
- **Acceptance**: Create a maintenance window for Room A. Query returns it. Overlapping bookings are flagged.

### T2.3 — Blacklist Rule Management
- Implement `createBlacklistRule()`, `deleteBlacklistRule()`, `getBlacklistRules()`
- Support target_type: "participant" or "room"
- SYSTEM_ADMIN only
- **Acceptance**: Blacklist a participant. Query returns the rule. Blacklisted participant is checked during booking/registration (integration tested later).

### T2.4 — Room Scheduling Service: Booking CRUD
- Create `src/lib/services/roomSchedulingService.ts`
- Implement `createBooking(request)`: validate inputs, enforce policies (14-day window, max 3 active reservations), check blacklist, persist to IndexedDB
- Implement `updateBooking(bookingId, updates)`: with optimistic locking
- Implement `cancelBooking(bookingId)`: set status to "cancelled" with version check
- RBAC checks: OPS_COORDINATOR and INSTRUCTOR can create; own bookings editable; cancel-any for OPS_COORDINATOR/SYSTEM_ADMIN
- **Acceptance**: Create a booking, read it back. Try to book > 14 days out — rejected. Try 4th active reservation — rejected. Cancel a booking — status changes.

### T2.5 — Room Scheduling Service: Conflict Detection
- Implement `detectConflicts(request)`:
  1. Query `bookings` store via `idx_room_time` for time-range overlaps (existing.start < req.end AND existing.end > req.start) with status != "cancelled"
  2. Query `maintenance_windows` for same room + time overlap
  3. Query `equipment` store — for each requested exclusive equipment item, check cross-room reservations in time range
  4. Return conflict list with reasons for each
- **Acceptance**: Book Room A 9–10 AM. Try booking Room A 9:30–10:30 AM — conflict detected with reason "time overlap". Add maintenance window 9–11 AM — also detected. Book exclusive projector in Room A — detected when trying to book it in Room B for same time.

### T2.6 — Room Scheduling Service: Alternative Scoring
- Implement `getAlternatives(request)`:
  1. Query all rooms
  2. Filter: capacity within ±10 of requested
  3. Score each candidate:
     - Capacity fit (40%): `1 - (|room.capacity - requested| / requested)`, clamp [0,1]
     - Equipment match (30%): `matched_equipment / total_requested`
     - Availability (20%): 1.0 if no overlaps, 0.0 otherwise
     - Distance (10%): `1 - (distance / MAX_DISTANCE)`, MAX_DISTANCE derived dynamically
  4. Weighted total, sort descending, return top 5 with per-factor breakdowns
- Distance = numeric difference from building_code + floor_code
- **Acceptance**: Request Room A (cap 30, projector, 9–10 AM) which is conflicted. Get back up to 5 alternatives with scores. Room with exact capacity + all equipment + available + same building scores highest.

### T2.7 — Idempotency Service
- Create `src/lib/services/idempotencyService.ts`
- Implement `checkKey(key)`:
  - Found + "completed" → return `{isDuplicate: true, cachedResult}`
  - Found + "in-progress" + age < 5 min → throw `ConcurrencyError`
  - Found + "in-progress" + age >= 5 min → treat as abandoned, overwrite
  - Not found → create record with "in-progress", return `{isDuplicate: false}`
- Implement `markComplete(key, result)`: update status to "completed", store result
- Implement `cleanup()`: delete "completed" records older than 24 hours, skip "in-progress"
- **Acceptance**: First check returns not-duplicate. Second check with same key returns duplicate with cached result. In-progress key older than 5 min is overridable. Cleanup removes old completed keys.

### T2.8 — Registration Service: Add
- Create `src/lib/services/registrationService.ts`
- Implement `add(participantId, sessionId, idempotencyKey)`:
  1. `rbacService.checkRole(['PARTICIPANT'])`
  2. `idempotencyService.checkKey(idempotencyKey)`
  3. Rate limit check: read counter for `{user_id, window_start}`, reject if >= 5
  4. Single readwrite transaction: read session, verify capacity > 0, check unique index (one seat per participant per session), check blacklist, decrement capacity with version check, create registration, mark idempotency key complete
  5. Broadcast `capacity-changed` on `registration-sync`
  6. Send confirmation via `messageCenterService` (stub for now)
- **Acceptance**: Register successfully, capacity decremented. Duplicate idempotency key returns cached result. Full session (capacity 0) rejects. Same participant same session rejects. 6th attempt in 10 seconds rejected.

### T2.9 — Registration Service: Drop
- Implement `drop(participantId, sessionId, idempotencyKey)`:
  1. RBAC check, idempotency check, rate limit check
  2. Single transaction: mark registration "cancelled", increment capacity with version check, mark idempotency complete
  3. Broadcast `capacity-changed`
- **Acceptance**: Drop succeeds, capacity incremented. Original registration marked cancelled.

### T2.10 — Registration Service: Swap
- Implement `swap(participantId, fromSessionId, toSessionId, idempotencyKey)`:
  1. RBAC check, idempotency check, rate limit check
  2. SINGLE transaction spanning both sessions: cancel old registration, increment old capacity (version check), check new capacity > 0, decrement new capacity (version check), create new registration
  3. If ANY step fails → entire transaction rolls back
  4. Broadcast `capacity-changed` for both sessions
- **Acceptance**: Swap succeeds — old registration cancelled, new created, both capacities updated. Target full → entire swap rolls back, original preserved. Version conflict → rolls back.

### T2.11 — Registration Service: Rate Limiting & Cross-Tab Sync
- Rate limit counter stored in IndexedDB keyed by `{user_id, window_start}` where `window_start = floor(now / 10000) * 10000`
- On each attempt: increment counter in transaction, broadcast `rate-limit-increment` on `registration-sync`
- Listen on `registration-sync` for `rate-limit-increment` from other tabs
- Listen for `capacity-changed` to update displayed availability
- **Acceptance**: 5 attempts from Tab A, 6th from Tab B is rejected. Both tabs see consistent counter.

### T2.12 — Billing Service: Bill Generation
- Create `src/lib/services/billingService.ts`
- Implement `generateMonthlyBills()`:
  1. Read all active participants
  2. Read billing registry for meter readings
  3. Read config: housing_fee, rate_per_unit
  4. Single atomic transaction per participant: compute total (housing + meter × rate), apply waivers (fixed first, then percentage on remainder), cap at 0, create bill with due_date = generated_at + 10 days, reset meter to 0
  5. Handle zero/missing meter: utility_charge = 0, log warning
  6. Handle waiver > 100%: cap at 0, log anomaly
- **Acceptance**: Generate bill with meter=50, rate=2, housing=950, 10% waiver → total = (950+100)×0.9 = $945. Zero meter → housing only. Waiver > 100% → total = 0.

### T2.13 — Billing Service: Payments & Overdue
- Implement `recordPayment(billId, {amount, method, date})`:
  - Validate payment
  - Create payment record
  - Update bill status to "paid" if fully paid, "partial" if not
  - SYSTEM_ADMIN and OPS_COORDINATOR only
- Implement `markOverdueBills()`: query bills where status = "generated" AND `due_date` < now - 10 days, set status to "overdue"
- **Acceptance**: Record a payment, bill status updates. After 10 days, unpaid bill marked overdue.

### T2.14 — Billing Service: Reconciliation CSV Export
- Implement `exportReconciliationCSV(period)`:
  - Query all bills and payments for the period
  - Format as CSV (participant, billing_period, housing, utility, waivers, total, payments, status)
  - Return as Blob for browser download
- SYSTEM_ADMIN and OPS_COORDINATOR only
- **Acceptance**: Export CSV, download it, contents match bill/payment data for the period.

### T2.15 — Room Scheduling UI: Booking Form & Calendar
- Create `/rooms/new` — RoomBookingForm component
  - Fields: room selector, date, start time, end time, expected participants, equipment checkboxes
  - On submit: call `roomSchedulingService.createBooking()`
  - Display validation errors (policy violations, etc.)
- Create `/rooms` — RoomSchedulingPage with calendar/list view of bookings
- Create `/rooms/:id` — RoomDetailPage showing booking details
- **Acceptance**: Fill out form, submit, booking created. Policy violation shows error message. Calendar shows bookings.

### T2.16 — Room Scheduling UI: Conflict Alternatives Modal
- When `createBooking()` returns conflicts, display a Modal
- Modal shows: conflict reasons, up to 5 alternative rooms
- Each alternative shows: room name, capacity, equipment, and per-factor scores (capacity %, equipment %, availability %, distance %)
- Selecting an alternative triggers new booking for that room
- If no alternatives available: show clear message "No alternative rooms available for this time"
- **Acceptance**: Trigger conflict, Modal shows alternatives with numeric scores. Select one, booking created for alternative room.

### T2.17 — Registration UI
- Create `/registration` — RegistrationPage: browse sessions with capacity display
- Create `/registration/:sessionId` — SessionRegistrationDetail: add/drop/swap forms
- Add button generates UUID idempotency key via `crypto.randomUUID()`, calls `registrationService.add()`
- Drop button with confirmation
- Swap: select current registration + target session, calls `registrationService.swap()`
- Display success/error messages. On swap failure: "Your original registration has been preserved."
- **Acceptance**: Browse sessions, see capacity. Register, capacity updates. Drop, capacity restores. Swap works or shows clear rollback message.

### T2.18 — Registration UI: Retry Countdown Drawer
- Create Drawer component shown when rate limit triggered
- Shows countdown timer: `window_start + 10 seconds - now`
- Auto-dismisses when window expires
- User can continue browsing (read-only) while rate-limited
- **Acceptance**: After 5 rapid registrations, Drawer appears with countdown. Countdown reaches 0, Drawer closes, user can register again.

### T2.19 — Billing UI
- Create `/billing` — BillingPage: list of bills (filterable by status, period)
- Create `/billing/:billId` — BillDetailPage: line items (housing, utilities, waivers, total), linked payments
- Create `/billing/payments` — PaymentRecordingPage: select bill, enter amount/method/date
- Create `/billing/meter` — MeterEntryPage: enter meter readings per participant (SYSTEM_ADMIN, OPS_COORDINATOR only)
- CSV export button on BillingPage
- **Acceptance**: View bills, see line items. Record payment, bill status updates. Enter meter reading. Export CSV downloads file.

### T2.20 — Admin UI: Policies, Flags, Users, Maintenance
- Create `/admin` — AdminSettingsPage (SYSTEM_ADMIN only)
- Create `/admin/policies` — PolicyConfigPage: edit booking window, reservation limit, etc.
- Create `/admin/flags` — FeatureFlagPage: CRUD feature flags with targeting rules (roles, org units)
- Create `/admin/users` — UserManagementPage: create/edit user accounts, assign roles
- Create `/admin/maintenance` — MaintenanceWindowPage: CRUD maintenance windows (SYSTEM_ADMIN + OPS_COORDINATOR)
- **Acceptance**: Admin can change policies, create flags, manage users, create maintenance windows. Non-admin cannot access.

---

## PHASE 3: Advanced Systems

### T3.1 — Scheduler Service: Core Timer & Polling
- Create `src/lib/services/schedulerService.ts`
- Implement `initialize()`: read all `scheduler_tasks` from IndexedDB, read `next_run_at` from LocalStorage (fallback IndexedDB)
- Use 60-second `setInterval` polling: on each tick, compare `Date.now()` against each task's `next_run_at`, execute if overdue
- On `visibilitychange` (tab regains focus): immediately check all tasks
- Implement `registerTask(task)`: persist task to IndexedDB + LocalStorage
- After task execution: compute next `next_run_at`, write to both LocalStorage and IndexedDB
- **Acceptance**: Register a task with `next_run_at` = now + 2 min. After ~2 min, task handler fires. Tab hidden and refocused → immediate check.

### T3.2 — Scheduler Service: Catch-Up Execution
- During `initialize()`, before registering timers: find all tasks where `next_run_at` < now
- Sort by priority: billing > messaging > reminders
- For recurring tasks with multiple missed periods: execute once per missed period
- Show progress indicator in UI during catch-up (e.g., "Processing 2 missed billing runs...")
- After catch-up: advance `next_run_at` to next future occurrence
- Before executing: write `status: "executing"` to task record in readwrite transaction to prevent duplicate execution from other tabs
- **Acceptance**: Close app for 2 months, reopen. Scheduler detects 2 missed billing runs, executes sequentially, shows progress. Bills generated for both months.

### T3.3 — Scheduler Service: Cross-Tab Primary/Secondary Election
- On init: broadcast `scheduler-active {tab_id}` on `scheduler-sync`, wait 100ms for `scheduler-primary` response
- If no response → become primary, begin executing tasks
- If response → become secondary, only monitor `scheduler-sync`
- Primary sends `scheduler-heartbeat {tab_id, timestamp}` every 5 seconds
- Secondary: if no heartbeat for 5 seconds → become primary
- On task execution: broadcast `task-executed {task_id, new_next_run_at}` — receiving tabs cancel their timer and re-register
- **Acceptance**: Open Tab A (becomes primary). Open Tab B (becomes secondary). Close Tab A. After 5s Tab B becomes primary and executes tasks.

### T3.4 — Scheduler Service: DND Interaction
- Before executing reminder-type tasks: read `dnd_config` from LocalStorage
- If current time within DND window (default 22:00–07:00): do NOT execute, recompute `fire_at` = DND end time, persist, re-register
- Billing and messaging tasks are EXEMPT from DND — execute regardless
- DND check at execution time, not registration time
- **Acceptance**: Reminder triggers at 10:30 PM → not delivered, rescheduled to 7:00 AM. Billing triggers at 12:05 AM → executes normally.

### T3.5 — Scheduler Service: Failure Recovery
- On task handler exception: catch, log to `error_logs` store (task_id, error, stack, timestamp)
- Do NOT advance `next_run_at`
- Retry with exponential backoff: delay = 1min × 2^(consecutive_failures - 1), capped at 30 min
- Store `consecutive_failures` in `scheduler_tasks` record
- After 5 consecutive failures: set status = "failed", stop retrying, notify SYSTEM_ADMIN + OPS_COORDINATOR via messageCenterService
- Implement `reEnableTask(taskId)`: reset `consecutive_failures` to 0, set status = "active"
- **Acceptance**: Task that always throws → retries with increasing delays (1m, 2m, 4m, 8m, 16m). After 5 failures → marked failed, notification sent. Re-enable resets counter.

### T3.6 — Message Center Service: Compose, Publish, Retract, Pin
- Create `src/lib/services/messageCenterService.ts`
- Implement `compose(message)`: create message record with status "draft"
- Implement `publish(messageId)`: set status "published", set `published_at` = now. Evaluate targeting at publish time.
- Implement `retract(messageId)`: set status "retracted". Retain record + receipts for audit. Hidden from inboxes.
- Implement `pin(messageId, pinned)`: toggle `pinned` flag. Pinned messages sort to top.
- RBAC: SYSTEM_ADMIN + OPS_COORDINATOR can publish announcements. INSTRUCTOR can compose session-related messages.
- **Acceptance**: Compose draft, publish it, it appears in targeted inboxes. Retract it, gone from inboxes but record retained. Pin a message, it sorts to top.

### T3.7 — Message Center Service: Scheduling
- Implement `schedule(messageId, scheduledAt)`: set status "scheduled", register task with `schedulerService` with `fire_at` = scheduledAt
- At fire time: scheduler triggers publication — re-evaluate targeting with CURRENT user roles/org membership, then set status "published"
- **Acceptance**: Schedule message for 5 minutes from now. After 5 min, message status changes to "published" and appears in inboxes.

### T3.8 — Message Center Service: Read Receipts & Analytics
- Implement `recordReadReceipt(messageId, userId)`: on opening `/messages/:id`, check `idx_message_user` for existing receipt. If none, create `{message_id, user_id, read_at: now}`.
- Implement `getAnalytics(messageId)`: unique opens = count of read_receipts. Time-to-first-read = earliest receipt.read_at - message.published_at.
- **Acceptance**: Open message → receipt created. Open again → no duplicate. Analytics shows correct unique opens and time-to-first-read.

### T3.9 — Message Center Service: Inbox, Search, Categories
- Implement `getInbox(userId, filters)`: return messages targeted at user's role/org, filter by category, paginate, sort by recency (pinned first)
- Implement `search(query, userId)`: keyword search across title + body, paginated, sorted by recency
- Categories: Announcements, Registration, Billing, Tasks
- Exclude retracted messages from inbox
- **Acceptance**: User sees only messages targeted at their role/org. Filter by category works. Search finds matching messages. Retracted messages hidden.

### T3.10 — To-Do/Reminder Service: Core
- Create `src/lib/services/todoReminderService.ts`
- Implement `createReminder(reminder)`: persist with template, trigger type, linked entity
- Implement template variable resolution at delivery time: query current data for `{{room_name}}`, `{{start_time}}`, `{{coordinator}}`. If entity deleted → substitute `"[Room removed]"` / `"[Session cancelled]"`
- Before delivering event-triggered reminder: verify linked session is not cancelled
- **Acceptance**: Create reminder with template "Setup {{room_name}} at {{start_time}}". At delivery time, variables resolved to current values. Deleted room → "[Room removed]".

### T3.11 — To-Do/Reminder Service: Deduplication & DND
- 60-second dedup: suppress reminders with identical content + same user within 60s. Use original trigger time for dedup check, NOT delayed fire_at.
- DND enforcement: if within DND window, recompute fire_at = DND end time, set status "queued", persist
- Implement `deliverQueuedBatch()`: on app reload outside DND or when DND ends, deliver queued reminders throttled at 10/sec
- **Acceptance**: Two identical reminders 30s apart → second suppressed. Reminder at 11 PM → queued until 7 AM. App reload at 8 AM → queued reminders delivered.

### T3.12 — To-Do/Reminder Service: Send Logging
- Log every delivery attempt to `send_logs` store: `{reminder_id, user_id, sent_at, delivery_status}`
- Status: "delivered", "suppressed_dnd", "failed"
- **Acceptance**: Deliver a reminder → send log created with "delivered". DND suppressed → log with "suppressed_dnd".

### T3.13 — Analytics Service
- Create `src/lib/services/analyticsService.ts`
- Implement `getBookingConversionRate(period)`: confirmed / total. If 0 total → "N/A"
- Implement `getNoShowRate(period)`: no-shows / expected. If 0 expected → "N/A"
- Implement `getSlotUtilization(roomId, period)`: booked hours / available hours
- Implement `getPaymentSuccessRate(period)`: paid / total bills. If 0 bills → "N/A"
- Support time-period aggregation: daily, weekly, monthly
- Support filters: by room, instructor, department
- Handle records with missing fields (pre-migration) by using defaults
- **Acceptance**: With 10 bookings (7 confirmed) → conversion = 70%. With 0 bookings → "N/A". Utilization computed correctly per room.

### T3.14 — Message Center UI
- Create `/messages` — MessageCenterPage: inbox with category tabs, search bar, message list (pinned first), unread indicators
- Create `/messages/compose` — MessageComposePage: title, body, category dropdown, target audience (role checkboxes + org scope), optional schedule datetime, pin toggle
- Create `/messages/:id` — MessageDetailPage: full message view, triggers read receipt on open. Show retract/pin buttons for OPS_COORDINATOR/SYSTEM_ADMIN.
- Wire up badge count on top bar (unread messages count)
- **Acceptance**: View inbox filtered by category. Compose and publish a message. Open it — receipt recorded. Retract it. Pin another. Badge shows unread count.

### T3.15 — To-Do Center UI
- Create `/todos` — ToDoCenterPage: list of reminders (pending, delivered, queued)
- Create/edit reminder form: template text, trigger type (event/scheduled), linked entity selector
- Template variable preview showing what resolved text will look like
- DND configuration: editable start/end times, saved to LocalStorage `dnd_config`
- **Acceptance**: View reminders. Create new one with template. See preview. Change DND window. Queued reminders visible.

### T3.16 — Analytics Dashboard UI
- Create `/analytics` — AnalyticsDashboard: metric cards showing conversion rate, no-show rate, utilization, payment success rate
- Create `/analytics/bookings` — BookingAnalyticsPage: trend charts for bookings over time
- Create `/analytics/billing` — BillingAnalyticsPage: billing/payment trends
- Filter controls: period selector (daily/weekly/monthly), room filter, instructor filter
- Division by zero → "N/A" display
- **Acceptance**: Dashboard shows all 4 metrics. Filters change displayed data. Zero-data periods show "N/A".

### T3.17 — Attendance Tracking UI
- Add attendance tracking to session detail views (accessible by INSTRUCTOR, OPS_COORDINATOR, SYSTEM_ADMIN)
- Per-participant status: present / absent / no-show
- Persist to `attendance` store
- **Acceptance**: Instructor opens session, marks participants as present/absent/no-show. Data persists and feeds into analytics.

---

## PHASE 4: Hardening

### T4.1 — Export/Import Service: Export
- Create `src/lib/services/exportImportService.ts`
- Implement `exportAll()`:
  1. Read ALL IndexedDB stores (decrypt if encryption enabled)
  2. Serialize to JSON
  3. Embed `SCHEMA_VERSION` (integer constant)
  4. Compute SHA-256 of data payload via WebCrypto `crypto.subtle.digest()`
  5. Wrap in envelope: `{schema_version, sha256, data, exported_at}`
  6. Return as Blob for browser download
- SYSTEM_ADMIN only
- **Acceptance**: Export triggers download. File contains all data, schema version, and SHA-256 hash.

### T4.2 — Export/Import Service: Import with Verification
- Implement `importData(file)`:
  1. Read uploaded JSON file
  2. Compute SHA-256 of `data` field
  3. Compare to embedded `sha256` — reject on mismatch: "Integrity check failed"
  4. Check `schema_version`: if > current → "Please update application". If < current → apply migrations. If == current → proceed.
  5. Write all data in single IndexedDB transaction. On failure → rollback, existing data preserved.
- Implement sequential migration function registry (one per schema version increment)
- **Acceptance**: Import valid file → data loaded. Modify one byte → SHA mismatch error. Future version → rejected. Older version → migrated then loaded. Failed migration → existing data untouched.

### T4.3 — Password Change Re-encryption: Progress UI
- Add progress indicator to password change flow
- Show "Re-encrypting X of Y records..." during `reEncryptAll()`
- Operation is non-interruptible (disable UI during process)
- On browser crash mid-process: detect `migration_in_progress` flag on next login, offer retry or rollback
- **Acceptance**: Change password with 100 encrypted records → progress bar fills. Force-close mid-process → next login detects flag and offers recovery.

### T4.4 — Sensitive Field Masking
- Create a table display modifier/utility that masks sensitive fields showing only last 4 characters
- Apply to designated fields in billing tables, user tables (e.g., billing amounts shown partially, user identifiers masked)
- Format: `****1234`
- **Acceptance**: Bill table shows masked values. Full values only visible in detail views with proper authorization.

### T4.5 — Startup Consistency Checker
- On app initialization (after IndexedDB opens, before UI renders):
  - Validate registrations reference valid sessions
  - Validate payments reference valid bills
  - Validate bookings reference valid rooms
  - Validate attendance records reference valid sessions and participants
- Flag anomalies for admin review (store in a diagnostics list)
- Do NOT auto-delete orphaned records
- **Acceptance**: Create an orphaned registration (session deleted). On reload, consistency checker flags it.

### T4.6 — Operation Queue
- Create per-tab in-memory queue that serializes IndexedDB mutations
- Operations enqueued with `{store, mutationFn, callback}`
- Queue processes one at a time: open transaction → execute → callback → next
- Prevents intra-tab transaction conflicts
- **Acceptance**: Enqueue 3 rapid writes to the same store. All succeed in order without transaction abort errors.

### T4.7 — Idempotency Cleanup Scheduled Task
- On app init: register a recurring task with `schedulerService` that runs every 6 hours
- Task: query `idempotency_keys` where status = "completed" AND `created_at` < now - 24 hours, delete in batch
- Skip "in-progress" records
- **Acceptance**: Create old completed idempotency key. After cleanup runs, key is deleted. In-progress keys are preserved.

### T4.8 — Wire Up Billing to Scheduler
- Register billing task with `schedulerService`: cron-like schedule "1st of month at 12:05 AM"
- On trigger: call `billingService.generateMonthlyBills()`
- Integrate overdue check as a daily scheduled task
- **Acceptance**: Scheduler triggers billing on the 1st. Bills generated. Overdue bills flagged after 10 days.

### T4.9 — Wire Up Automated Reminders
- When booking is confirmed: auto-create reminder "Confirm setup 30 minutes before session"
- When registration is confirmed: auto-create confirmation reminder
- Register reminder delivery check as a scheduled task
- **Acceptance**: Book a room → reminder auto-created. 30 min before session → reminder delivered (respecting DND).

### T4.10 — Wire Up Message Center Notifications
- Registration events → notification to participant via messageCenterService
- Billing events (bill generated, payment received, overdue) → notification to participant
- Scheduler failure → notification to SYSTEM_ADMIN + OPS_COORDINATOR
- **Acceptance**: Register for session → inbox notification. Bill generated → inbox notification. Scheduler task fails 5 times → admin notified.

### T4.11 — Integration Testing: Multi-Tab Concurrency
- Test: two tabs submit registration for last seat simultaneously → exactly one succeeds
- Test: logout in Tab A → Tab B redirects to login
- Test: flag change in Tab A → Tab B re-evaluates immediately
- Test: scheduler primary in Tab A, close Tab A → Tab B takes over within 5s
- **Acceptance**: All multi-tab scenarios produce correct behavior

### T4.12 — Integration Testing: Scheduler & Billing Edge Cases
- Test: app closed 2 months, reopen → 2 billing runs execute with progress
- Test: billing with zero meter reading → housing-only bill with warning
- Test: waiver exceeding 100% → total capped at 0
- Test: scheduler task throws → retries with exponential backoff, fails after 5
- **Acceptance**: All edge cases produce correct results per spec

### T4.13 — Integration Testing: Registration Edge Cases
- Test: swap where target is full → entire swap rolls back
- Test: 5 attempts in 10s from two tabs combined → 6th rejected with Drawer
- Test: idempotency key reuse → cached result returned
- Test: browser crash after idempotency key written but before commit → retry with new key works
- **Acceptance**: All registration edge cases behave per spec

### T4.14 — Integration Testing: Export/Import Round-Trip
- Test: export all data → import into fresh database → all data matches
- Test: tampered file → rejected
- Test: older schema version → migrated correctly
- Test: future schema version → rejected
- **Acceptance**: Full round-trip preserves data integrity

### T4.15 — Integration Testing: Encryption
- Test: enable encryption → data encrypted in IndexedDB (not readable as plaintext)
- Test: disable encryption → data decrypted and stored as plaintext
- Test: password change with encryption → all records re-encrypted, readable with new password
- Test: force-close during re-encryption → migration-in-progress flag detected on next login
- **Acceptance**: Encryption lifecycle works end-to-end

### T4.16 — Accessibility
- Keyboard navigation for all interactive elements
- ARIA labels on all controls, icons, badges
- Focus management: modals trap focus, drawers return focus on close
- Screen reader compatibility: semantic HTML, live regions for notifications
- **Acceptance**: Full keyboard navigation works. Screen reader announces all interactive elements correctly.

---

## SUMMARY

| Phase | Tasks | Description |
|---|---|---|
| Phase 0 | T0.1–T0.3 (3 tasks) | Project scaffolding, types, config |
| Phase 1 | T1.1–T1.18 (18 tasks) | Foundation: IDB, auth, RBAC, encryption, routing, UI shell |
| Phase 2 | T2.1–T2.20 (20 tasks) | Core features: scheduling, registration, billing, core UI |
| Phase 3 | T3.1–T3.17 (17 tasks) | Advanced: scheduler, messages, reminders, analytics |
| Phase 4 | T4.1–T4.16 (16 tasks) | Hardening: export/import, testing, accessibility |
| **Total** | **74 tasks** | |

### Parallelization Opportunities

Within each phase, some tasks can run in parallel:
- **Phase 0**: T0.2 + T0.3 (after T0.1)
- **Phase 1**: T1.5 + T1.6 + T1.8 (independent). T1.9 + T1.12 + T1.13 (after IDB layer). T1.14 + T1.15 + T1.16 (UI tasks, independent of services)
- **Phase 2**: T2.1 + T2.7 (independent). T2.4–T2.6 (sequential, depend on each other). T2.8–T2.11 (sequential). T2.15–T2.20 (UI tasks, can parallel after services done)
- **Phase 3**: T3.1–T3.5 (sequential scheduler). T3.6–T3.9 (sequential messaging). T3.10–T3.12 (sequential reminders). T3.13 (independent). T3.14–T3.17 (UI, after services)
- **Phase 4**: T4.1–T4.2 (sequential). T4.3–T4.7 (mostly parallel). T4.8–T4.10 (integration wiring). T4.11–T4.16 (testing, after all wiring)
