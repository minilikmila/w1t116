# 1. System Understanding

## Core Problem Summary

The system is a self-contained, browser-only operational platform that replaces what would traditionally be a multi-service backend application for managing the lifecycle of educational space reservations, participant enrollment, internal cost allocation, and organizational communications. The core problem is coordinating shared physical resources (rooms, equipment, lab kits) across multiple competing stakeholders (instructors requesting sessions, participants enrolling, coordinators managing logistics) while maintaining data consistency, access isolation, and billing accuracy — all without any server, database, or network dependency beyond serving the initial static assets. The fundamental architectural challenge is implementing transactional guarantees, scheduled automation, and multi-actor coordination patterns within the constraints of a single browser runtime backed by IndexedDB.

## Hidden Requirements

- **Catch-up execution on app load**: Since scheduled tasks (billing on the 1st at 12:05 AM, scheduled messages, reminders) can only fire when the app is open, the system must detect and execute all overdue tasks upon initialization before rendering the UI, implying a blocking startup sequence with progress indication.
- **Cross-tab consistency**: The multi-tab concurrency model requires a BroadcastChannel-based synchronization layer so that a booking confirmed in Tab A is immediately reflected in Tab B's conflict detection, preventing double-booking across tabs.
- **Password-change re-encryption migration**: AES-GCM at-rest encryption tied to the user's password means a password change triggers a full read-decrypt-re-encrypt-write cycle for every encrypted record belonging to that user, which is a potentially long-running blocking operation requiring progress feedback and atomic rollback on failure.
- **Idempotency key persistence and cleanup**: UUID-based idempotency keys for registration operations must be stored durably (not just in memory) to survive page refreshes mid-operation, and must be garbage-collected to prevent unbounded IndexedDB growth.
- **Namespace isolation per user**: All IndexedDB queries must be scoped by user_id to prevent data leakage between users sharing a device, meaning every index and query pattern must incorporate user_id as a filtering dimension.
- **Schema migration pipeline**: Import/export with schema versioning implies the system must maintain an ordered chain of migration functions that can transform data from any prior schema version to the current one, and must reject data from future (unknown) versions.
- **DND notification queuing**: Suppressed notifications during do-not-disturb windows are delayed, not dropped, requiring a persistent queue that is drained in controlled batches when DND ends or the app reloads outside DND hours.
- **Feature flag evaluation at both UI and service layers**: Canary rollout flags must gate not only component rendering but also service-layer function execution, meaning the flag evaluation function is called in two distinct contexts with potentially different failure modes.

## Key Hard Constraints

- **Browser-only execution**: No server-side processing, no WebSocket connections, no REST API calls, no cloud database. All computation happens in the main thread or Web Workers within the browser.
- **IndexedDB as primary store**: All operational data (bookings, registrations, bills, messages, reminders, audit logs) lives in IndexedDB, subject to its asynchronous transaction model, storage quotas, and browser-specific eviction policies.
- **No external API calls**: No third-party authentication providers, no payment gateways, no notification services. All functionality is implemented locally.
- **LocalStorage for lightweight settings**: Session tokens, user preferences, DND configuration, and scheduler metadata use LocalStorage due to its synchronous access pattern, but are subject to its ~5MB limit and string-only storage.

## Non-Functional Constraints

- **Performance**: IndexedDB queries for conflict detection during booking must complete within a perceivable interaction window (under 300ms for the validation pass). Scoring and ranking of up to 5 alternative rooms must not block the UI thread. Startup catch-up execution for overdue scheduled tasks must show progress and complete before interactive rendering.
- **Consistency guarantees**: Optimistic locking via record version fields ensures that concurrent mutations (especially registration add/drop/swap across tabs) are serialized at commit time. IndexedDB transaction atomicity guarantees that partial writes do not corrupt state. Idempotency keys prevent duplicate registrations even under rapid resubmission.
- **Concurrency model**: Multi-tab concurrency is handled through IndexedDB transactions (which serialize within a single origin) combined with BroadcastChannel for cross-tab UI invalidation. Rate limiting (5 attempts per 10 seconds) applies per-user across tabs via a shared counter in IndexedDB.
- **Security requirements**: PBKDF2 with 310,000 iterations for password hashing via WebCrypto. Optional AES-GCM encryption of IndexedDB payloads with keys derived from user passwords. Sensitive field masking (last 4 characters only) in table displays. Brute-force protection: 10 failed attempts triggers a 15-minute lockout. Per-role access isolation enforced at both UI route guards and service-layer permission checks.

---

# 2. Feature Breakdown

## Module: Authentication & Session Management

- **Purpose**: Manages user identity verification, session lifecycle, brute-force protection, and password change workflows including re-encryption of at-rest encrypted data.
- **Inputs**: Login credentials (username, password), logout events, password change requests (old password, new password), app initialization events triggering session restoration from LocalStorage.
- **Outputs**: Session records written to LocalStorage ({user_id, role, org_unit, token, expires_at}), updated password hashes and salts in IndexedDB, re-encrypted data payloads on password change, lockout state mutations.
- **Internal responsibilities**: Derive password hashes using PBKDF2 (310,000 iterations, WebCrypto API) and compare against stored hashes. Generate and validate session tokens. Track failed login attempts per username and enforce 15-minute lockout after 10 failures. On password change, derive new AES-GCM key, decrypt all user-owned encrypted records with old key, re-encrypt with new key, and commit atomically. Clear session from LocalStorage on logout while preserving IndexedDB data.
- **Edge cases and failure modes**: (1) Browser crashes mid-password-change during re-encryption: the system must detect incomplete re-encryption on next login by checking a migration-in-progress flag and either rollback or resume. (2) LocalStorage is full when writing session token: the login succeeds in IndexedDB but the session cannot persist, requiring a graceful error message instructing the user to clear browser data. (3) Clock manipulation by the user to bypass the 15-minute lockout: lockout expiry must be validated against both stored locked_until and a monotonic counter if available, but since browser APIs do not guarantee monotonic time, this is an accepted residual risk. (4) Multiple tabs attempting password change simultaneously: only the first tab's transaction should succeed; subsequent tabs detect version mismatch and abort.
- **Dependencies**: Called by the Route Guard component and the App initialization sequence. Calls the Encryption Service for key derivation and re-encryption. Calls the IndexedDB Access Layer for reading/writing user records and lockout state.

## Module: Role-Based Access Control (RBAC)

- **Purpose**: Enforces permission boundaries across all service-layer operations and UI route access, ensuring that each of the four roles (SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT) can only perform explicitly permitted actions.
- **Inputs**: The current user's role (from session), the operation being attempted (identified by a string key), and optionally the target resource's ownership metadata (e.g., "this session belongs to instructor X").
- **Outputs**: A boolean permit/deny decision, or an AccessError thrown to the calling service function when access is denied.
- **Internal responsibilities**: Maintain a static permission matrix mapping operation keys to allowed role sets. Provide a checkRole(requiredRoles) utility that reads the current session's role and throws AccessError if the role is not in the required set. Provide a checkOwnership(resourceOwnerId, currentUserId) utility for operations where ownership matters (e.g., an instructor editing their own session request). Ensure that no role inheritance exists: SYSTEM_ADMIN does not implicitly inherit PARTICIPANT permissions.
- **Edge cases and failure modes**: (1) Session expires between page load and operation execution: the role check must re-validate the session before consulting the permission matrix, and redirect to login if the session is invalid. (2) A corrupted or tampered LocalStorage session contains an invalid role string: the system must treat unknown roles as having zero permissions and force re-authentication. (3) Feature flags modify available operations for a role: the RBAC module must consult the Feature Flag Service to determine if a gated operation is currently enabled for the user's role and org unit.
- **Dependencies**: Called by every service-layer module before executing restricted operations. Calls the Feature Flag Service for flag-gated permission checks. Reads session data from LocalStorage.

## Module: Room Scheduling Service

- **Purpose**: Manages the lifecycle of room reservations including creation, modification, cancellation, real-time conflict detection, and ranked alternative suggestion when conflicts are found.
- **Inputs**: Booking requests containing room ID, date/time range, requested equipment, instructor/coordinator ID, and participant capacity estimate. Modification and cancellation requests referencing existing booking IDs. Room configuration data (capacity, equipment list, building/floor codes) from local JSON configuration.
- **Outputs**: Confirmed booking records persisted to IndexedDB. Conflict detection results containing the list of conflicting resources and the reason for each conflict. Ranked alternative room suggestions (up to 5) with per-factor score breakdowns (capacity fit, equipment match, availability continuity, distance). Booking conversion metrics emitted to the Analytics module.
- **Internal responsibilities**: Query IndexedDB for overlapping bookings in the requested time range. Check equipment availability against exclusive resource reservations. Check maintenance windows from the Operations Configuration module. When conflicts exist, query all rooms, filter candidates within ±10 seats of requested capacity, score each using weighted formula (capacity 40%, equipment 30%, availability 20%, distance 10%), normalize scores, and return top 5 ranked results. Enforce policy constraints (14-day booking window, max 3 active reservations per participant). Validate bookings against blacklist rules. Compute distance metric from building/floor numeric codes, deriving MAX_DISTANCE dynamically from configuration.
- **Edge cases and failure modes**: (1) All rooms conflict for the requested time: the system must return an empty alternatives list with a clear explanation rather than silently failing. (2) Room configuration changes between conflict check and booking commit: optimistic locking on the room record version prevents stale commits. (3) A maintenance window is created that overlaps existing confirmed bookings: the Operations Configuration module must trigger re-validation and notification to affected bookings, but the Room Scheduling Service must handle the re-validation query. (4) Equipment item is shared across rooms but exclusively reserved: the conflict detection must track equipment at the item level, not just the room level.
- **Dependencies**: Calls the IndexedDB Access Layer for booking CRUD. Calls the Operations Configuration module for policy constraints, maintenance windows, and blacklist rules. Calls the Feature Flag Service to check if specific scheduling features are enabled. Called by the Registration Service (for session-linked bookings). Emits events consumed by the Analytics module and the To-Do/Reminder Service.

## Module: Registration Service

- **Purpose**: Handles participant enrollment in sessions including add, drop, and swap operations with atomic capacity management, idempotency enforcement, and concurrency control.
- **Inputs**: Registration action requests (add, drop, swap) containing participant ID, session ID(s), and an idempotency key (UUID). Current session capacity and version from IndexedDB. Rate-limit state from the operation queue.
- **Outputs**: Updated registration records in IndexedDB. Decremented/incremented session capacity counts. Idempotency key records for deduplication. Rate-limit violation events triggering the Drawer UI. Registration event notifications sent to the Message Center.
- **Internal responsibilities**: Validate idempotency key against stored keys; if duplicate, return cached result. Check that participant does not already hold an active seat in the target session (one seat per participant per session). For add: perform atomic capacity decrement with optimistic locking (read version, decrement, write with version check). For drop: increment capacity and mark registration as cancelled. For swap: execute drop and add as a single IndexedDB transaction to ensure atomicity. Enforce rate limiting (5 attempts per 10 seconds) by reading/writing attempt counters in IndexedDB. On contention (version mismatch), retry internally up to the rate limit, then surface the retry countdown Drawer.
- **Edge cases and failure modes**: (1) Swap where the drop succeeds but the add fails due to capacity: the entire transaction must roll back, restoring the original seat. (2) Browser tab crashes after idempotency key is written but before the registration is committed: on reload, the idempotency key exists without a corresponding result, so the system must treat it as an incomplete operation and allow retry with a new key. (3) Rate limit counter becomes stale across tabs: BroadcastChannel must propagate rate-limit increments so all tabs enforce a unified counter. (4) Participant attempts to register for a session that starts within the blackout period defined by policy: the service must reject with a clear policy-violation message.
- **Dependencies**: Calls the IndexedDB Access Layer for registration CRUD and capacity updates. Calls the RBAC module for permission checks. Calls the Idempotency Service for key validation and result caching. Calls the Room Scheduling Service indirectly when registration triggers room re-validation. Emits events to the Message Center and Analytics module. Uses BroadcastChannel for cross-tab rate-limit synchronization.

## Module: Billing Service

- **Purpose**: Generates monthly bills based on housing fees and metered utility consumption, applies waivers, records offline payments, tracks overdue status, and exports reconciliation data.
- **Inputs**: Billing policy configuration (housing fee, rate per unit, waiver rules). Meter readings from the billing registry in IndexedDB (entered by SYSTEM_ADMIN or OPS_COORDINATOR). Payment recording requests (cash/check/manual entry). Scheduled trigger from the Client-Side Scheduler on the 1st of each month at 12:05 AM.
- **Outputs**: Bill records in IndexedDB containing line items (housing, utilities, waivers, total). Payment records linked to bills. Overdue status flags (set 10 calendar days after bill generation). Reconciliation CSV exported as browser Blob download. Billing event notifications sent to the Message Center.
- **Internal responsibilities**: On scheduled trigger: read all active participants, read current meter readings from billing registry, compute bills using formula (housing_fee + current_meter_reading × rate_per_unit), apply waivers (fixed deductions first, then percentage on remainder), generate bill records, reset meter readings to zero — all within a single atomic IndexedDB transaction. Record offline payments with payment method, amount, and date. Mark bills as overdue 10 calendar days after generation if unpaid. Generate reconciliation CSV with all billing data for a given period. Enforce that only SYSTEM_ADMIN and OPS_COORDINATOR can enter meter readings.
- **Edge cases and failure modes**: (1) App is not open on the 1st at 12:05 AM: the catch-up scheduler detects the missed billing run on next app load and executes it retroactively. (2) Meter reading is zero or missing: the system generates a bill with zero utility charge but still applies the housing fee, and logs a warning for the coordinator. (3) Waiver percentage exceeds 100%: the system caps the total at zero (no negative bills) and logs the anomaly. (4) IndexedDB transaction fails mid-billing-run: the atomic transaction ensures no partial bills are written; the scheduler marks the task as failed and retries on next execution cycle.
- **Dependencies**: Calls the IndexedDB Access Layer for bill, payment, and meter registry CRUD. Calls the Client-Side Scheduler for trigger registration. Calls the RBAC module for permission enforcement on meter entry and payment recording. Emits events to the Message Center (bill generated, payment received, overdue notice). Called by the Export/Import Service for reconciliation CSV generation.

## Module: Message Center

- **Purpose**: Provides a unified communication hub supporting message composition, publishing, retraction, pinning, scheduling, role/org-targeted delivery, read receipts, and analytics (unique opens, time-to-first-read).
- **Inputs**: Message composition data (title, body, target roles, target org scope, schedule datetime, pin flag). User interactions (open message, search query). Automated notifications from other modules (registration confirmations, billing alerts, to-do reminders).
- **Outputs**: Message records in IndexedDB with status (draft, scheduled, published, retracted). Read receipt records (one per user per message with timestamp). Inbox views filtered by category (Announcements, Registration, Billing, Tasks) and keyword search results across title and body. Analytics metrics (unique opens count, time-to-first-read distribution).
- **Internal responsibilities**: Compose and persist message drafts. Publish messages immediately or schedule for future delivery via the Client-Side Scheduler. Apply targeting rules to determine which users see a message based on role and org scope (department, program, or all). Retract published messages (mark as retracted, hide from inboxes but retain for audit). Pin messages to top of inbox. Record read receipt on message detail view open (one per user per message). Compute analytics: count unique opens, calculate time-to-first-read as the difference between publish time and earliest read receipt. Support keyword search across title and body fields using IndexedDB text indexes.
- **Edge cases and failure modes**: (1) Scheduled message's target audience changes between scheduling and delivery (e.g., user role changes): the system evaluates targeting at delivery time, not scheduling time, so the audience is always current. (2) Message is retracted after some users have read it: read receipts are retained for analytics but the message body is hidden from future inbox views. (3) Keyword search returns too many results: results are paginated with a default page size and sorted by relevance (recency as tiebreaker).
- **Dependencies**: Calls the IndexedDB Access Layer for message and read receipt CRUD. Calls the Client-Side Scheduler for scheduled message delivery. Calls the RBAC module for permission checks (only OPS_COORDINATOR and SYSTEM_ADMIN can publish announcements; INSTRUCTOR can send session-related messages). Called by the Registration Service, Billing Service, and To-Do/Reminder Service to deliver automated notifications.

## Module: To-Do / Reminder Service

- **Purpose**: Creates, manages, and delivers event-triggered and scheduled in-app reminders with template variable resolution, deduplication, send logging, and DND window enforcement.
- **Inputs**: Reminder creation requests with template (e.g., "Confirm setup 30 minutes before session"), trigger conditions (event-based or time-based), and template variables (room name, start time, coordinator). DND window configuration (default 10:00 PM–7:00 AM). Events from other modules that trigger reminders (e.g., booking confirmed, session approaching).
- **Outputs**: Reminder records in IndexedDB with resolved template text and delivery status. Send log entries recording each delivery attempt. Suppressed reminders queued for post-DND delivery.
- **Internal responsibilities**: Register reminder templates with trigger conditions. Resolve template variables at delivery time by querying current data (room names, times, coordinator names). Deduplicate reminders: suppress any reminder with identical content targeting the same user within a 60-second window. Check DND window before delivering; if within DND, compute fire_at as DND end time and queue for delayed delivery. Log every send attempt with timestamp, target user, and delivery status. Batch-deliver queued reminders when DND ends or on app reload outside DND hours.
- **Edge cases and failure modes**: (1) Template variable references a deleted room: the system must substitute a fallback string (e.g., "[Room removed]") rather than failing delivery. (2) Deduplication window spans a DND boundary: the 60-second dedup check uses the original trigger time, not the delayed fire_at, to avoid suppressing legitimate repeated reminders that happen to queue together. (3) Hundreds of reminders queue during a long DND period (e.g., overnight): batch delivery on app reload must be throttled (e.g., 10 per second) to avoid UI freeze. (4) Event-triggered reminder fires for a cancelled session: the service must check session status at delivery time and suppress reminders for cancelled events.
- **Dependencies**: Calls the Client-Side Scheduler for time-based reminder scheduling. Calls the IndexedDB Access Layer for reminder and send log CRUD. Calls the Message Center for in-app alert delivery. Called by the Room Scheduling Service and Registration Service when events trigger reminders. Reads DND configuration from LocalStorage.

## Module: Client-Side Scheduler

- **Purpose**: Provides a centralized scheduling engine that manages timed task execution, catch-up processing for missed executions, DND awareness, cross-tab coordination, and failure recovery — acting as the sole mechanism for all time-based automation in the system.

### Sub-concern 1: Timer Initialization and Storage of next_run_at in LocalStorage

- The scheduler initializes on app mount by reading all registered scheduled tasks from IndexedDB, each of which has a task_id, schedule definition (cron-like or one-shot datetime), and next_run_at timestamp. For each task, a setTimeout (or setInterval for recurring tasks) is set using the delta between now and next_run_at. The next_run_at value is persisted in LocalStorage keyed by task_id for fast synchronous access during initialization and cross-tab reads. When a task completes, the scheduler computes the subsequent next_run_at from the schedule definition, writes it to both LocalStorage and IndexedDB, and re-registers the timer. If LocalStorage is unavailable, the scheduler falls back to IndexedDB-only storage with a warning logged to the console.

### Sub-concern 2: Catch-up Execution on App Reload

- On app initialization, before rendering the UI, the scheduler reads all next_run_at values from LocalStorage (falling back to IndexedDB if LocalStorage is empty). For each task where next_run_at is in the past, the scheduler marks it as overdue and executes it immediately in priority order (billing before messages before reminders). If multiple periods were missed (e.g., the app was closed for two months), the scheduler executes once per missed period for recurring tasks (e.g., two billing runs for two missed months) to maintain data integrity. A progress indicator is shown during catch-up to inform the user. After all catch-up executions complete, normal timer registration resumes.

### Sub-concern 3: DND Engine Interaction and fire_at Recomputation

- Before executing a reminder-type task, the scheduler queries the DND configuration (default 10:00 PM–7:00 AM) from LocalStorage. If the current time falls within the DND window, the scheduler does not execute the task but instead recomputes fire_at to the DND end time (7:00 AM by default), persists the updated fire_at, and re-registers the timer. Non-reminder tasks (billing, message publishing) are exempt from DND and execute regardless of the window. The DND check is performed at execution time, not at registration time, to handle configuration changes between registration and execution.

### Sub-concern 4: Cross-tab Synchronization via BroadcastChannel

- The scheduler uses a dedicated BroadcastChannel ("scheduler-sync") to coordinate with other tabs. When a task executes in one tab, that tab broadcasts a message {type: "task-executed", task_id, new_next_run_at} to all other tabs. Receiving tabs cancel their local timer for that task_id and re-register with the new next_run_at, preventing duplicate execution. On tab initialization, the scheduler broadcasts {type: "scheduler-active", tab_id} and waits 100ms for a response; if another tab responds with {type: "scheduler-primary", tab_id}, the new tab defers scheduling to the primary tab and only takes over if the primary becomes unresponsive (no heartbeat for 5 seconds).

### Sub-concern 5: Failure Recovery When a Scheduled Task Throws

- If a task execution throws an error, the scheduler catches the exception, logs it to an error log store in IndexedDB (with task_id, error message, timestamp), and does NOT advance next_run_at. Instead, it schedules a retry after a backoff delay (1 minute for first failure, doubling up to 30 minutes). After 5 consecutive failures for the same task, the scheduler marks the task as "failed" in IndexedDB, stops retrying, and surfaces a notification to SYSTEM_ADMIN and OPS_COORDINATOR via the Message Center. The failed task can be manually re-enabled from the Admin Settings UI.

- **Inputs**: Task registration requests (task_id, schedule definition, handler function reference, task type). App mount/unmount lifecycle events. BroadcastChannel messages from other tabs. DND configuration from LocalStorage.
- **Outputs**: Executed task results (passed to the registered handler). Updated next_run_at values in LocalStorage and IndexedDB. Error log entries for failed executions. Notification events for permanently failed tasks.
- **Edge cases and failure modes**: (1) System clock changes (DST, manual adjustment) cause next_run_at to be in the far future or far past: the scheduler must re-evaluate all timers when a visibilitychange event indicates the tab has regained focus, recalculating deltas from the current time. (2) LocalStorage quota exceeded when persisting next_run_at: fall back to IndexedDB-only with degraded cross-tab sync performance. (3) BroadcastChannel not supported (older browsers): fall back to polling IndexedDB for next_run_at changes every 5 seconds. (4) Two tabs simultaneously detect an overdue task on reload: the IndexedDB transaction for marking the task as "executing" serializes access, and only the first transaction to commit proceeds with execution.
- **Dependencies**: Called by the Billing Service, Message Center, and To-Do/Reminder Service to register scheduled tasks. Calls the IndexedDB Access Layer for task metadata and error log persistence. Uses BroadcastChannel for cross-tab coordination. Reads DND configuration from LocalStorage.

## Module: Analytics Service

- **Purpose**: Computes and presents operational metrics from local data, including booking conversion rate, no-show rate, slot utilization, and payment success rate.
- **Inputs**: Booking records (created, confirmed, cancelled). Attendance/no-show records per session. Room capacity and scheduled slot data. Billing and payment records.
- **Outputs**: Computed metric values for display on analytics dashboards. Time-series data for trend visualization. Exportable analytics summaries.
- **Internal responsibilities**: Calculate booking conversion rate (confirmed bookings / total booking requests). Calculate no-show rate (no-shows / total expected attendees). Calculate slot utilization (booked hours / total available hours per room per period). Calculate payment success rate (paid bills / total generated bills). Aggregate metrics by time period (daily, weekly, monthly). Provide filtered views by room, instructor, department.
- **Edge cases and failure modes**: (1) Division by zero when no bookings exist for a period: display "N/A" rather than zero or infinity. (2) Large datasets (thousands of records) cause slow computation: implement incremental computation with cached intermediate results, recomputing only when underlying data changes. (3) Analytics data includes records from before a schema migration: the service must handle records with missing fields gracefully by using default values.
- **Dependencies**: Reads from the IndexedDB Access Layer (bookings, registrations, attendance, bills, payments). Called by the Analytics Dashboard UI components. Does not write operational data; only reads and computes.

## Module: Operations Configuration

- **Purpose**: Manages system-wide policies, maintenance windows, blacklist rules, and operational parameters that govern the behavior of scheduling, registration, and billing modules.
- **Inputs**: Configuration changes from SYSTEM_ADMIN (policy values, maintenance windows, blacklist entries). Local JSON configuration files loaded at app initialization.
- **Outputs**: Policy values consumed by other modules (14-day booking window, 3-reservation limit, lockout duration). Maintenance window records used by conflict detection. Blacklist rules applied during registration and booking validation.
- **Internal responsibilities**: Load default configuration from local JSON files on first run. Allow SYSTEM_ADMIN to modify policy values through the Admin Settings UI. Persist configuration changes to IndexedDB. Provide a configuration query API for other modules. Manage maintenance windows (create, modify, delete) with start/end times and affected rooms. Manage blacklist rules (participant restrictions, room restrictions). Validate configuration changes for consistency (e.g., booking window cannot be negative).
- **Edge cases and failure modes**: (1) Local JSON configuration file is malformed: the system must fall back to hardcoded defaults and alert the admin. (2) Policy change retroactively invalidates existing bookings (e.g., reducing max reservations from 3 to 2): the system flags affected bookings for review but does not automatically cancel them. (3) Maintenance window overlaps existing confirmed bookings: the system notifies affected instructors and coordinators but requires manual resolution.
- **Dependencies**: Called by the Room Scheduling Service, Registration Service, Billing Service, and RBAC module for policy lookups. Calls the IndexedDB Access Layer for configuration CRUD. Calls the Feature Flag Service to determine if policy changes are gated behind flags.

## Module: Export/Import Service

- **Purpose**: Enables full data backup via browser Blob downloads and restoration via file uploads, with schema versioning, sequential migration, and SHA-256 integrity verification.
- **Inputs**: Export requests from SYSTEM_ADMIN. Import file uploads (JSON). Current schema version constant. SHA-256 hash computed from uploaded file content.
- **Outputs**: Downloadable JSON Blob files containing all IndexedDB data with schema version and SHA-256 fingerprint. Imported and migrated data written to IndexedDB. Validation results (schema version check, hash verification, migration success/failure).
- **Internal responsibilities**: On export: read all IndexedDB stores, serialize to JSON, embed current SCHEMA_VERSION, compute SHA-256 hash of payload via WebCrypto, append hash to export envelope, trigger browser Blob download. On import: read uploaded file, verify SHA-256 hash matches embedded fingerprint, check SCHEMA_VERSION against current version, apply sequential migration functions if version is older, reject if version is newer than current, write migrated data to IndexedDB within a transaction. Maintain an ordered registry of migration functions (one per schema version increment).
- **Edge cases and failure modes**: (1) Uploaded file has been tampered with (hash mismatch): reject import with a clear error message identifying the integrity failure. (2) Import file is from a future schema version: reject with a message suggesting the user update the application. (3) Migration function fails mid-import: the IndexedDB transaction rolls back, leaving existing data intact, and the error is surfaced to the user. (4) Export file is very large (hundreds of MB): use streaming serialization if available, or warn the user about potential memory pressure.
- **Dependencies**: Calls the IndexedDB Access Layer for full-store reads and writes. Uses WebCrypto for SHA-256 computation. Called by the Admin Settings UI. Calls the Billing Service for reconciliation CSV export (separate from full data export).

## Module: Encryption Service

- **Purpose**: Provides optional at-rest encryption of IndexedDB payloads using AES-GCM with keys derived from the user's password via PBKDF2, and manages the encryption lifecycle including key derivation, encrypt/decrypt operations, and re-encryption on password change.
- **Inputs**: User password (for key derivation). Plaintext data payloads to encrypt. Encrypted data payloads to decrypt. Password change events (old password, new password).
- **Outputs**: Encrypted payloads (ciphertext + IV + salt). Decrypted plaintext data. Derived CryptoKey objects (non-extractable, stored in memory only during session).
- **Internal responsibilities**: Derive AES-GCM keys from passwords using PBKDF2 with 310,000 iterations and a random salt via WebCrypto. Encrypt data payloads by generating a random IV per encryption, producing ciphertext, and bundling {ciphertext, iv, salt} for storage. Decrypt by reading the stored salt and IV, re-deriving the key, and decrypting. On password change: derive old key, derive new key, iterate all encrypted records, decrypt with old key, re-encrypt with new key, commit atomically, and update stored salt. Set a migration-in-progress flag before re-encryption and clear it on completion to enable recovery from interrupted migrations.
- **Edge cases and failure modes**: (1) User forgets password: encrypted data is unrecoverable since the key is derived from the password; the system must clearly warn users before enabling encryption. (2) Browser does not support WebCrypto SubtleCrypto API: encryption feature must be disabled with a visible warning. (3) Re-encryption of large datasets on password change takes significant time: a progress indicator must be shown, and the operation must be non-interruptible to prevent partial re-encryption.
- **Dependencies**: Called by the Authentication module during password changes. Called by the IndexedDB Access Layer when encryption is enabled (encrypt before write, decrypt after read). Uses WebCrypto API exclusively for all cryptographic operations.

## Module: Feature Flag Service

- **Purpose**: Implements canary rollout and feature gating via locally stored feature flags that control both UI rendering and service-layer execution based on role and organizational unit.
- **Inputs**: Flag definitions in IndexedDB (flag_id, enabled, target_roles, target_org_units). Current user's role and org_unit from session. Flag evaluation requests from UI components and service functions.
- **Outputs**: Boolean evaluation results (flag is on/off for the current user). Flag metadata for admin management UI.
- **Internal responsibilities**: Store flag definitions in IndexedDB with targeting rules (which roles, which org units). Evaluate flags by checking if the current user's role and org_unit match the flag's targeting criteria. Cache evaluated flags in memory for the duration of the session to avoid repeated IndexedDB reads. Provide a Svelte store that UI components can subscribe to for reactive flag evaluation. Provide a synchronous evaluation function for service-layer gating. Allow SYSTEM_ADMIN to create, modify, enable, and disable flags.
- **Edge cases and failure modes**: (1) Flag definition is missing from IndexedDB (deleted or never created): default to "disabled" to prevent unintended feature exposure. (2) Cache becomes stale when admin changes a flag in another tab: BroadcastChannel must propagate flag changes to invalidate caches in all tabs. (3) Flag evaluation during catch-up scheduler execution: flags must be evaluated with the execution context's timestamp, not the current time, but since flags are not time-scoped in this design, current evaluation is used with an acknowledged limitation.
- **Dependencies**: Called by the RBAC module for permission gating. Called by UI components for conditional rendering. Called by all service modules for feature-gated behavior. Calls the IndexedDB Access Layer for flag CRUD. Uses BroadcastChannel for cross-tab cache invalidation.

## Module: IndexedDB Access Layer

- **Purpose**: Provides a unified, low-level abstraction over IndexedDB operations including transaction management, optimistic locking, user-namespace isolation, and optional encryption integration.
- **Inputs**: CRUD operation requests from all service modules, specifying store name, data, query parameters, and the current user_id for namespace filtering.
- **Outputs**: Query results (single records or collections). Write confirmations with updated version numbers. Transaction failure errors (version mismatch, constraint violation).
- **Internal responsibilities**: Open and manage the IndexedDB database connection with versioned schema upgrades. Execute all reads and writes within explicit transactions. Apply user_id namespace filtering to all queries (except system-wide stores like configuration and feature flags). Implement optimistic locking by reading and comparing record versions before writes, rejecting writes when versions do not match. Integrate with the Encryption Service to encrypt payloads before writes and decrypt after reads when encryption is enabled. Handle schema migrations by executing upgrade functions sequentially from the stored version to the current version.
- **Edge cases and failure modes**: (1) IndexedDB is unavailable (private browsing mode in some browsers): detect on initialization and surface a blocking error explaining that the app requires IndexedDB. (2) Transaction aborts due to QuotaExceededError: surface storage pressure warning to the user and suggest data export/cleanup. (3) Concurrent writes from multiple modules within the same tab cause transaction serialization delays: accept this as inherent to IndexedDB and ensure no module holds transactions open longer than necessary. (4) Schema upgrade fails mid-migration: IndexedDB's built-in versioning prevents partial upgrades, but the system must handle the case where the database is left at an intermediate version.
- **Dependencies**: Called by every service module. Calls the Encryption Service when at-rest encryption is enabled. No upstream dependencies.

## Module: Idempotency Service

- **Purpose**: Prevents duplicate registration operations by managing UUID-based idempotency keys with result caching and lifecycle cleanup.
- **Inputs**: Idempotency keys (UUIDs) attached to registration action requests. Operation results to cache for duplicate detection.
- **Outputs**: Duplicate detection results (is-duplicate flag + cached result if duplicate). Stored idempotency records in IndexedDB.
- **Internal responsibilities**: On receiving an operation with an idempotency key, query IndexedDB for an existing record with that key. If found and completed, return the cached result without re-executing. If found but incomplete (in-progress), reject with a concurrency error. If not found, create a new record with status "in-progress", allow the operation to proceed, and update the record with the result on completion. Purge idempotency records older than 24 hours to prevent unbounded storage growth. Run purge as a low-priority scheduled task via the Client-Side Scheduler.
- **Edge cases and failure modes**: (1) Key exists with "in-progress" status but the originating tab has crashed: implement a staleness timeout (e.g., 5 minutes) after which in-progress records are considered abandoned and can be overridden. (2) Purge runs while an operation with an old key is still referencing the record: the purge must skip records with status "in-progress". (3) UUID collision (astronomically unlikely but theoretically possible): the system treats it as a duplicate, which is the safe failure mode for registration operations.
- **Dependencies**: Called by the Registration Service before executing add/drop/swap operations. Calls the IndexedDB Access Layer for idempotency record CRUD. Registers a cleanup task with the Client-Side Scheduler.

## Module: UI Shell & Navigation

- **Purpose**: Provides the persistent application layout including the top bar with Message Center access, the sidebar/navigation for route switching, and the role-aware rendering of navigation items.
- **Inputs**: Current user session (role, user_id). Current route. Unread message count from the Message Center. Active to-do count from the To-Do/Reminder Service.
- **Outputs**: Rendered navigation structure with role-appropriate menu items. Badge counts on Message Center and To-Do icons. Route transitions via the frontend router.
- **Internal responsibilities**: Render the persistent top bar with the Message Center icon (showing unread badge count), the To-Do Center icon (showing active count), and user profile/logout controls. Render the sidebar navigation with links to Room Scheduling, Registration, Billing, Analytics, and Admin Settings, filtered by the current user's role permissions. Handle route transitions and integrate with the route guard for access control. Display the retry countdown Drawer when rate limiting is triggered.
- **Edge cases and failure modes**: (1) Session expires while the user is viewing a page: the route guard on next navigation detects the expired session and redirects to login, but the current page remains visible until navigation occurs — a periodic session check (every 60 seconds) mitigates this. (2) Badge count exceeds display space (e.g., 9999 unread): display "99+" as a cap. (3) Browser window is extremely narrow: the sidebar collapses to an icon-only mode or hamburger menu for responsive design.
- **Dependencies**: Reads session data from LocalStorage. Calls the Message Center for unread counts. Calls the To-Do/Reminder Service for active counts. Calls the RBAC module to determine which navigation items to display.

---

# 3. Architecture Design

## 3a. Frontend Routing

| Route | Component | Permitted Roles |
|---|---|---|
| `/login` | LoginPage | All (unauthenticated) |
| `/dashboard` | DashboardPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/rooms` | RoomSchedulingPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/rooms/:id` | RoomDetailPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/rooms/new` | RoomBookingForm | OPS_COORDINATOR, INSTRUCTOR |
| `/registration` | RegistrationPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/registration/:sessionId` | SessionRegistrationDetail | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/billing` | BillingPage | SYSTEM_ADMIN, OPS_COORDINATOR, PARTICIPANT |
| `/billing/:billId` | BillDetailPage | SYSTEM_ADMIN, OPS_COORDINATOR, PARTICIPANT |
| `/billing/payments` | PaymentRecordingPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/billing/meter` | MeterEntryPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics` | AnalyticsDashboard | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics/bookings` | BookingAnalyticsPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/analytics/billing` | BillingAnalyticsPage | SYSTEM_ADMIN, OPS_COORDINATOR |
| `/messages` | MessageCenterPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/messages/compose` | MessageComposePage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR |
| `/messages/:id` | MessageDetailPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/todos` | ToDoCenterPage | SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT |
| `/admin` | AdminSettingsPage | SYSTEM_ADMIN |
| `/admin/policies` | PolicyConfigPage | SYSTEM_ADMIN |
| `/admin/flags` | FeatureFlagPage | SYSTEM_ADMIN |
| `/admin/users` | UserManagementPage | SYSTEM_ADMIN |
| `/admin/export-import` | ExportImportPage | SYSTEM_ADMIN |
| `/admin/maintenance` | MaintenanceWindowPage | SYSTEM_ADMIN, OPS_COORDINATOR |

**Route guard mechanism**: A reactive Svelte store (`authStore`) holds the current session. A `RouteGuard` wrapper component is placed around the router outlet. On every route transition, the guard reads the target route's `meta.roles` array, compares it against `authStore.role`, and if the role is not in the permitted list, redirects to `/dashboard` (if authenticated) or `/login` (if unauthenticated). The guard also checks `authStore.expires_at` against the current time and redirects to `/login` if the session has expired. All redirects preserve the intended destination URL as a query parameter for post-login redirect.

## 3b. State Management Model

### In-memory (Svelte reactive stores)

- **authStore**: Current session (user_id, role, org_unit, token, expires_at). Reason: Needs synchronous, frequent access for route guards and permission checks on every interaction; reading from LocalStorage on every check would be unnecessarily slow.
- **flagStore**: Cached feature flag evaluations for the current user. Reason: Flags are evaluated frequently by UI components and service functions; caching avoids repeated IndexedDB reads during a session.
- **uiStore**: Transient UI state (active modal, drawer visibility, retry countdown, sidebar collapsed state). Reason: Purely presentational state with no persistence requirement.
- **inboxStore**: Current inbox view (filtered messages, search query, pagination cursor). Reason: Derived from IndexedDB data but held in memory for reactive rendering; re-queried on category or search changes.
- **notificationStore**: Pending in-app alert queue for display. Reason: Transient display state that is consumed as notifications are shown and dismissed.

### IndexedDB

- All operational data: bookings, registrations, sessions, bills, payments, messages, read receipts, reminders, send logs, users, meter readings, configuration, feature flags, idempotency records, scheduler task metadata, error logs. Reason: Primary durable storage required to survive page refreshes, browser restarts, and multi-tab access; IndexedDB provides transactional guarantees and indexed querying needed for conflict detection and complex queries.

### LocalStorage

- **session_{user_id}**: Session token and metadata. Reason: Synchronous access needed for route guards; ephemeral (cleared on logout).
- **scheduler_next_run_{task_id}**: Next execution timestamps for scheduled tasks. Reason: Synchronous read on app initialization for fast catch-up detection without waiting for IndexedDB to open.
- **dnd_config**: Do-not-disturb window start/end times. Reason: Synchronous read needed by the scheduler before executing reminder tasks.
- **user_preferences**: UI preferences (theme, sidebar state, notification preferences). Reason: Lightweight settings that benefit from synchronous access and do not require transactional guarantees.
- **encryption_enabled_{user_id}**: Boolean flag indicating whether at-rest encryption is active for the user. Reason: Must be known synchronously during IndexedDB access layer initialization to determine whether to decrypt reads.

## 3c. IndexedDB Schema

**Database name**: `learning_center_db`

| Store Name | keyPath | Indexes | Version | Migration Note |
|---|---|---|---|---|
| `users` | `user_id` | `idx_username` (username, unique: true), `idx_role` (role, unique: false), `idx_org_unit` (org_unit, unique: false) | 1 | Initial store for user accounts and password hashes. |
| `bookings` | `booking_id` | `idx_room_time` ([room_id, start_time], unique: false), `idx_user` (user_id, unique: false), `idx_status` (status, unique: false), `idx_date_range` ([start_time, end_time], unique: false) | 1 | Initial store for room reservations with composite index for overlap queries. |
| `sessions` | `session_id` | `idx_instructor` (instructor_id, unique: false), `idx_room` (room_id, unique: false), `idx_start_time` (start_time, unique: false), `idx_status` (status, unique: false) | 1 | Initial store for instructional sessions linked to bookings. |
| `registrations` | `registration_id` | `idx_participant_session` ([participant_id, session_id], unique: true), `idx_participant` (participant_id, unique: false), `idx_session` (session_id, unique: false), `idx_status` (status, unique: false) | 1 | Initial store; composite unique index enforces one seat per participant per session. |
| `bills` | `bill_id` | `idx_participant` (participant_id, unique: false), `idx_period` (billing_period, unique: false), `idx_status` (status, unique: false), `idx_due_date` (due_date, unique: false) | 1 | Initial store for generated billing records. |
| `payments` | `payment_id` | `idx_bill` (bill_id, unique: false), `idx_date` (payment_date, unique: false), `idx_method` (payment_method, unique: false) | 1 | Initial store for offline payment records linked to bills. |
| `messages` | `message_id` | `idx_status` (status, unique: false), `idx_author` (author_id, unique: false), `idx_scheduled_at` (scheduled_at, unique: false), `idx_category` (category, unique: false) | 1 | Initial store for all message types including announcements and automated notifications. |
| `read_receipts` | `receipt_id` | `idx_message_user` ([message_id, user_id], unique: true), `idx_message` (message_id, unique: false), `idx_user` (user_id, unique: false) | 1 | Initial store; composite unique index ensures one receipt per user per message. |
| `reminders` | `reminder_id` | `idx_user` (user_id, unique: false), `idx_trigger_time` (trigger_time, unique: false), `idx_status` (status, unique: false) | 1 | Initial store for to-do items and scheduled reminders. |
| `send_logs` | `log_id` | `idx_reminder` (reminder_id, unique: false), `idx_timestamp` (sent_at, unique: false) | 1 | Initial store for reminder delivery audit trail. |
| `billing_registry` | `registry_id` | `idx_type` (registry_type, unique: false) | 1 | Initial store for meter readings and billing configuration state. |
| `configuration` | `config_key` | (none; accessed by primary key) | 1 | Initial store for system-wide policy values and operational settings. |
| `feature_flags` | `flag_id` | `idx_enabled` (enabled, unique: false) | 1 | Initial store for feature flag definitions and targeting rules. |
| `idempotency_keys` | `key_id` | `idx_status` (status, unique: false), `idx_created_at` (created_at, unique: false) | 1 | Initial store for registration operation deduplication. |
| `scheduler_tasks` | `task_id` | `idx_next_run` (next_run_at, unique: false), `idx_status` (status, unique: false) | 1 | Initial store for scheduler task metadata and execution state. |
| `error_logs` | `log_id` | `idx_task` (task_id, unique: false), `idx_timestamp` (timestamp, unique: false) | 1 | Initial store for scheduler failure logs and diagnostic records. |
| `maintenance_windows` | `window_id` | `idx_room` (room_id, unique: false), `idx_time_range` ([start_time, end_time], unique: false) | 1 | Initial store for planned maintenance periods affecting rooms. |
| `blacklist_rules` | `rule_id` | `idx_target_type` (target_type, unique: false), `idx_target_id` (target_id, unique: false) | 1 | Initial store for booking and registration restriction rules. |
| `attendance` | `attendance_id` | `idx_session` (session_id, unique: false), `idx_participant` (participant_id, unique: false), `idx_status` (attendance_status, unique: false) | 1 | Initial store for tracking attendance and no-shows per session. |
| `rooms` | `room_id` | `idx_building` (building_code, unique: false), `idx_capacity` (capacity, unique: false) | 1 | Initial store for room definitions including capacity, equipment, and location codes. |
| `equipment` | `equipment_id` | `idx_room` (room_id, unique: false), `idx_type` (equipment_type, unique: false) | 1 | Initial store for equipment inventory linked to rooms. |
| `waivers` | `waiver_id` | `idx_participant` (participant_id, unique: false), `idx_type` (waiver_type, unique: false), `idx_status` (status, unique: false) | 1 | Initial store for billing waiver definitions (fixed amount or percentage). |

## 3d. Role-Based Access Control

**Inheritance rule**: Roles are strictly siloed. No role inherits another role's permissions. Each user holds exactly one role. SYSTEM_ADMIN does not implicitly have PARTICIPANT permissions.

| Operation | SYSTEM_ADMIN | OPS_COORDINATOR | INSTRUCTOR | PARTICIPANT |
|---|---|---|---|---|
| Create/edit user accounts | ✓ | ✗ | ✗ | ✗ |
| Modify system policies | ✓ | ✗ | ✗ | ✗ |
| Manage feature flags | ✓ | ✗ | ✗ | ✗ |
| Export/import data | ✓ | ✗ | ✗ | ✗ |
| Enter meter readings | ✓ | ✓ | ✗ | ✗ |
| Manage maintenance windows | ✓ | ✓ | ✗ | ✗ |
| Publish announcements | ✓ | ✓ | ✗ | ✗ |
| Retract messages | ✓ | ✓ | ✗ | ✗ |
| Pin messages | ✓ | ✓ | ✗ | ✗ |
| Schedule messages | ✓ | ✓ | ✗ | ✗ |
| View all bookings | ✓ | ✓ | ✗ | ✗ |
| Create room bookings | ✓ | ✓ | ✓ | ✗ |
| Edit own bookings | ✓ | ✓ | ✓ | ✗ |
| Cancel any booking | ✓ | ✓ | ✗ | ✗ |
| Cancel own booking | ✓ | ✓ | ✓ | ✗ |
| Create session requests | ✗ | ✗ | ✓ | ✗ |
| Edit own session requests | ✗ | ✗ | ✓ | ✗ |
| Track attendance/no-shows | ✓ | ✓ | ✓ | ✗ |
| Register for sessions (add/drop/swap) | ✗ | ✗ | ✗ | ✓ |
| View own registrations | ✗ | ✗ | ✗ | ✓ |
| View own bills | ✓ | ✗ | ✗ | ✓ |
| Record payments | ✓ | ✓ | ✗ | ✗ |
| Generate billing run | ✓ | ✓ | ✗ | ✗ |
| Export reconciliation CSV | ✓ | ✓ | ✗ | ✗ |
| Apply waivers | ✓ | ✓ | ✗ | ✗ |
| View analytics dashboards | ✓ | ✓ | ✗ | ✗ |
| Compose session-related messages | ✗ | ✗ | ✓ | ✗ |
| View inbox / read messages | ✓ | ✓ | ✓ | ✓ |
| Search messages | ✓ | ✓ | ✓ | ✓ |
| Manage own reminders/to-dos | ✓ | ✓ | ✓ | ✓ |
| Manage blacklist rules | ✓ | ✗ | ✗ | ✗ |
| View room conflict alternatives | ✓ | ✓ | ✓ | ✗ |
| Change own password | ✓ | ✓ | ✓ | ✓ |
| Enable/disable own encryption | ✓ | ✓ | ✓ | ✓ |

## 3e. Service Layer

| Service File | Responsibility | Inputs | Outputs | Dependencies |
|---|---|---|---|---|
| `authService` | Authenticates users, manages sessions, handles password changes with re-encryption coordination, enforces brute-force lockouts. | Credentials, password change requests, session restoration events. | Session records, updated hashes, lockout mutations. | `encryptionService`, `idbAccessLayer` |
| `rbacService` | Evaluates role-based permissions for operations, provides checkRole and checkOwnership utilities. | Current role, operation key, resource ownership metadata. | Permit/deny decisions, AccessError throws. | `featureFlagService`, reads LocalStorage session |
| `roomSchedulingService` | Manages room booking lifecycle, conflict detection, alternative scoring and ranking. | Booking requests, room config, policy values. | Booking records, conflict results, ranked alternatives. | `idbAccessLayer`, `opsConfigService`, `featureFlagService` |
| `registrationService` | Handles add/drop/swap with atomic capacity management, idempotency, rate limiting. | Registration actions with idempotency keys. | Updated registrations and capacities, rate-limit events. | `idbAccessLayer`, `rbacService`, `idempotencyService`, `messageCenterService` |
| `billingService` | Generates bills, records payments, tracks overdue, exports reconciliation CSV. | Billing policy, meter readings, payment data, scheduler triggers. | Bill records, payment records, overdue flags, CSV Blobs. | `idbAccessLayer`, `schedulerService`, `rbacService`, `messageCenterService` |
| `messageCenterService` | Composes, publishes, retracts, pins, schedules messages; tracks read receipts and computes analytics. | Message data, user interactions, automated notification events. | Message records, receipts, analytics metrics. | `idbAccessLayer`, `schedulerService`, `rbacService` |
| `todoReminderService` | Creates reminders, resolves templates, deduplicates, enforces DND, manages send logs. | Reminder templates, trigger events, DND config. | Reminder records, send logs, queued alerts. | `schedulerService`, `idbAccessLayer`, `messageCenterService` |
| `schedulerService` | Manages all timed task execution, catch-up processing, cross-tab coordination, failure recovery. | Task registrations, app lifecycle events, BroadcastChannel messages. | Executed task results, updated next_run_at, error logs. | `idbAccessLayer`, BroadcastChannel, LocalStorage |
| `analyticsService` | Computes booking conversion, no-show rate, utilization, payment success rate. | Booking, attendance, billing, payment records. | Computed metrics and trend data. | `idbAccessLayer` (read-only) |
| `opsConfigService` | Manages policies, maintenance windows, blacklist rules, loads JSON config. | Config changes, JSON config files. | Policy values, maintenance windows, blacklist rules. | `idbAccessLayer`, `featureFlagService` |
| `exportImportService` | Full data export/import with schema versioning, migration, and SHA-256 verification. | Export requests, uploaded files. | Downloadable Blobs, imported migrated data. | `idbAccessLayer`, WebCrypto |
| `encryptionService` | AES-GCM encrypt/decrypt, PBKDF2 key derivation, re-encryption on password change. | Passwords, plaintext/ciphertext payloads. | Encrypted/decrypted data, derived keys. | WebCrypto |
| `featureFlagService` | Stores, evaluates, and caches feature flags by role and org unit. | Flag definitions, user context (role, org_unit). | Boolean flag evaluations, flag metadata. | `idbAccessLayer`, BroadcastChannel |
| `idbAccessLayer` | Unified IndexedDB abstraction: transactions, versioning, namespace isolation, encryption integration. | CRUD requests with store name, data, user_id. | Query results, version-stamped write confirmations. | `encryptionService` |
| `idempotencyService` | Manages UUID keys, deduplication checks, result caching, and cleanup. | Idempotency keys, operation results. | Duplicate detection results, cached results. | `idbAccessLayer`, `schedulerService` |

## 3f. BroadcastChannel System

| Channel Name | Message Types | Sender Module | Receiver Module(s) |
|---|---|---|---|
| `scheduler-sync` | `task-executed` (payload: {task_id, new_next_run_at}): Notifies other tabs that a scheduled task has been executed so they cancel their local timer. Sent by the tab that executed the task. | `schedulerService` | `schedulerService` (all other tabs) |
| `scheduler-sync` | `scheduler-active` (payload: {tab_id}): Broadcast on tab initialization to discover if another tab is already the primary scheduler. | `schedulerService` | `schedulerService` (all other tabs) |
| `scheduler-sync` | `scheduler-primary` (payload: {tab_id}): Response to `scheduler-active`, indicating this tab is the primary scheduler. | `schedulerService` | `schedulerService` (newly opened tab) |
| `scheduler-sync` | `scheduler-heartbeat` (payload: {tab_id, timestamp}): Periodic heartbeat from primary tab; if absent for 5 seconds, other tabs elect a new primary. | `schedulerService` | `schedulerService` (all other tabs) |
| `data-sync` | `record-updated` (payload: {store, record_id, version, user_id}): Notifies other tabs that a record has been created or updated, so they can invalidate in-memory caches and re-query if displaying affected data. | `idbAccessLayer` | All service modules with in-memory caches, UI components displaying affected data |
| `data-sync` | `record-deleted` (payload: {store, record_id, user_id}): Notifies other tabs of a deletion for cache invalidation. | `idbAccessLayer` | All service modules with in-memory caches |
| `registration-sync` | `capacity-changed` (payload: {session_id, new_capacity, version}): Notifies other tabs of a capacity change so they can update displayed availability in real time. | `registrationService` | `registrationService` (all other tabs), Registration UI components |
| `registration-sync` | `rate-limit-increment` (payload: {user_id, attempt_count, window_start}): Propagates rate-limit counter updates so all tabs enforce a unified rate limit. | `registrationService` | `registrationService` (all other tabs) |
| `flag-sync` | `flag-changed` (payload: {flag_id, enabled, target_roles, target_org_units}): Notifies other tabs of feature flag changes so they invalidate their cached evaluations. | `featureFlagService` | `featureFlagService` (all other tabs) |
| `auth-sync` | `logout` (payload: {user_id}): Notifies other tabs that the user has logged out, so they redirect to the login page. | `authService` | UI Shell / Route Guard (all other tabs) |
| `auth-sync` | `session-refresh` (payload: {user_id, new_expires_at}): Notifies other tabs of session extension. | `authService` | `authStore` in-memory update (all other tabs) |

## 3g. Feature Flag System

**Storage model**: Feature flags are stored in the `feature_flags` IndexedDB store with keyPath `flag_id`. Each record contains: flag_id (string), display_name (string), description (string), enabled (boolean), target_roles (array of role strings, empty array means all roles), target_org_units (array of org_unit strings, empty array means all org units), created_by (user_id), created_at (timestamp), updated_at (timestamp). Flags are created and managed exclusively by SYSTEM_ADMIN through the Admin Settings UI.

**Runtime evaluation function**: The evaluation function `evaluateFlag(flag_id, userContext)` takes a flag_id and the current user context ({role, org_unit}). Logic: (1) Look up flag_id in the in-memory cache (populated from IndexedDB on session start). (2) If flag not found, return `false` (default to disabled). (3) If `enabled` is `false`, return `false`. (4) If `target_roles` is non-empty and user's role is not in the array, return `false`. (5) If `target_org_units` is non-empty and user's org_unit is not in the array, return `false`. (6) Otherwise return `true`. The function returns a boolean indicating whether the feature is active for the given user context.

**UI rendering gating**: Svelte components use a reactive derived store (`$flagStore`) that subscribes to flag evaluation results. Components wrap feature-gated sections in `{#if $flagStore['flag_name']}...{/if}` blocks, which reactively show or hide content when flags change (propagated via BroadcastChannel). **Service-layer gating**: Service functions call `evaluateFlag()` synchronously at the start of flag-gated operations and throw a `FeatureDisabledError` if the flag evaluates to `false`, preventing execution of the gated logic regardless of whether the UI allowed the user to reach the operation.

---

# 4. Data Flow Design

## 4a. User Flows Per Role

### PARTICIPANT: Registration (Add, Drop, Swap)

**Add**: The participant navigates to `/registration`, browses available sessions with displayed capacity counts, and selects a session. The UI generates a UUID idempotency key and submits an add request to `registrationService`. The service calls `rbacService.checkRole(['PARTICIPANT'])`, then `idempotencyService.checkKey(key)` to detect duplicates. If new, it opens an IndexedDB transaction, reads the session record's current capacity and version, verifies capacity > 0 and the participant has no existing active registration for this session (via the composite unique index), decrements capacity with version increment, creates a registration record, marks the idempotency key as complete with the result, commits the transaction, broadcasts `capacity-changed` on the `registration-sync` channel, and delivers a confirmation notification via `messageCenterService`. If version mismatch occurs, the transaction aborts and the UI shows the retry countdown Drawer after rate-limit threshold is reached.

**Drop**: The participant views their registrations at `/registration`, selects one, and confirms cancellation. The service validates role and idempotency, opens a transaction, marks the registration as cancelled, increments session capacity with version check, commits, broadcasts the change, and notifies the participant.

**Swap**: The participant selects their current registration and a target session. The service executes drop and add as a single IndexedDB transaction: it cancels the current registration, increments old session capacity, checks new session capacity, decrements new session capacity, creates new registration — all with version checks on both session records. If any step fails, the entire transaction rolls back, leaving the original registration intact. The UI shows either success or a specific failure message (target full, version conflict, rate limit).

### INSTRUCTOR: Room Booking and Scheduling

The instructor navigates to `/rooms/new` and fills in the booking form (date, time range, expected participants, required equipment). On form submission, `roomSchedulingService` queries IndexedDB for overlapping bookings on the selected room using the `idx_room_time` composite index, checks equipment exclusivity across all rooms for the time range, and queries `maintenance_windows` for conflicts. If no conflicts, the booking is created and persisted. If conflicts exist, the service queries all rooms, filters candidates by capacity (±10 seats), scores each using the weighted formula (capacity 40%, equipment 30%, availability 20%, distance 10%), and returns the top 5 alternatives. The UI presents these in a Modal with per-factor score breakdowns and explainable labels. The instructor can select an alternative, which triggers a new booking creation for that room. Policy checks (14-day window, 3 active reservations) are enforced before the conflict check. `todoReminderService` automatically creates a reminder "Confirm setup 30 minutes before session" linked to the booking.

### SYSTEM_ADMIN / OPS_COORDINATOR: Billing

On the 1st of each month at 12:05 AM (or on catch-up if the app was closed), the `schedulerService` triggers `billingService.generateMonthlyBills()`. The service reads all active participants from IndexedDB, reads the billing registry for current meter readings, reads housing fee and rate per unit from configuration, and for each participant: computes total = housing_fee + (meter_reading × rate_per_unit), applies waivers (fixed first, then percentage on remainder), generates a bill record with due date = generation date + 10 days, and writes it in a single atomic transaction. Meter readings are reset to zero. Notifications are sent to each participant via `messageCenterService`. For payment recording, OPS_COORDINATOR navigates to `/billing/payments`, selects an outstanding bill, enters payment details (amount, method: cash/check/manual, date), and submits. The service validates the payment, creates a payment record, updates the bill status if fully paid, and sends a receipt notification. For reconciliation export, the admin navigates to `/billing`, selects a period, and clicks export; the service queries all bills and payments for the period, formats as CSV, and triggers a Blob download.

### OPS_COORDINATOR: Messaging (Compose, Publish, Read, Retract)

**Compose**: The coordinator navigates to `/messages/compose`, fills in title, body, category (Announcements, Registration, Billing, Tasks), target audience (role filter and org scope: department, program, or all), optional schedule datetime (e.g., "03/25/2026 9:00 AM"), and pin flag. On save as draft, a message record with status "draft" is created in IndexedDB.

**Publish**: On clicking publish (for immediate delivery) or schedule (for future delivery), the service validates the message, updates status to "published" or "scheduled". If scheduled, `schedulerService` registers a task with fire_at set to the scheduled datetime. At the scheduled time, the scheduler triggers publication: the message status changes to "published" and targeted users see it in their inboxes.

**Read**: Any user navigates to `/messages`, sees their inbox filtered by targeting rules. Messages are categorized (Announcements, Registration, Billing, Tasks) and support keyword search across title and body. Opening a message detail view at `/messages/:id` triggers a read receipt: `messageCenterService` checks for an existing receipt (via composite index), creates one if absent, recording user_id and timestamp. Analytics (unique opens, time-to-first-read) are computed from receipt data.

**Retract**: The coordinator selects a published message and clicks retract. The service updates status to "retracted", hides it from inboxes, but retains the record and read receipts for audit purposes.

## 4b. Data Lifecycle

**Creation**: Data originates from user interactions (form submissions, button clicks) or automated processes (scheduler triggers, event-based reminders). Each creation event passes through the relevant service function, which first validates the caller's role via `rbacService`.

**Validation**: The service layer performs structural validation (required fields, data types, value ranges), business rule validation (policy constraints, capacity limits, conflict checks), and idempotency validation (for registration operations). Validation failures are returned as typed errors with human-readable messages for UI display.

**Persistence**: Validated data is written to IndexedDB via `idbAccessLayer` within explicit transactions. Each write includes a version field (integer, starting at 1, incremented on each update) for optimistic locking. If encryption is enabled, the `idbAccessLayer` passes payloads through `encryptionService.encrypt()` before writing. After successful commit, `data-sync` BroadcastChannel broadcasts the change to other tabs.

**Mutation**: Updates follow a read-validate-write cycle within a single IndexedDB transaction. The current record is read, its version is compared to the expected version (optimistic lock check), the mutation is applied, and the write is committed with an incremented version. If the version does not match, the transaction aborts and the caller receives a `VersionConflictError`.

**Export**: `exportImportService` reads all stores from IndexedDB (decrypting if encryption is enabled), serializes the data as JSON, embeds the current `SCHEMA_VERSION`, computes a SHA-256 fingerprint of the payload via WebCrypto, wraps everything in an export envelope `{schema_version, sha256, data, exported_at}`, and triggers a Blob download in the browser.

**Import**: The user uploads a JSON file. The service reads the file, computes SHA-256 of the data payload and compares it to the embedded fingerprint (rejecting on mismatch). It checks the schema_version: if older than current, it applies sequential migration functions to transform the data; if newer, it rejects with an error. Migrated data is written to IndexedDB within a transaction; if any write fails, the transaction rolls back and existing data is preserved.

## 4c. Multi-Tab Concurrency Model

**Operation queue**: Each tab maintains an in-memory operation queue (`operationQueue`) that serializes mutations to IndexedDB. When a service function initiates a write, it enqueues an operation descriptor (containing the store, the mutation function, and a callback). The queue processes operations one at a time, opening an IndexedDB transaction for each, executing the mutation, and calling the callback with the result or error. This prevents multiple in-flight transactions from the same tab from interfering with each other, though IndexedDB itself serializes transactions across tabs.

**BroadcastChannel sync**: After each successful mutation, the `idbAccessLayer` broadcasts a `record-updated` or `record-deleted` message on the `data-sync` channel with the affected store name, record ID, and new version. Receiving tabs use this to invalidate in-memory caches (Svelte stores) and, if the affected data is currently displayed, re-query IndexedDB to refresh the UI. The `registration-sync` channel carries `capacity-changed` messages so that other tabs display up-to-date session availability without polling. The `scheduler-sync` channel prevents duplicate task execution by coordinating a primary/secondary tab model.

**Optimistic locking**: Every mutable record includes a `_version` integer field. On read, the service notes the current version. On write, the transaction includes a condition: the stored version must equal the noted version. If it does, the write proceeds with `_version` incremented. If it does not (another tab or operation updated the record between read and write), the transaction aborts with a `VersionConflictError`. The service may retry internally (up to the rate limit for registration operations) or surface the error to the UI, which shows an appropriate message (e.g., "This session's availability changed — please review and try again").

**Rate limiting**: The rate-limit counter is stored in IndexedDB keyed by `{user_id, window_start}` where `window_start` is the start of the current 10-second window (truncated timestamp). Each registration attempt increments the counter within a transaction. If the counter reaches 5, subsequent attempts are rejected with a rate-limit error. The `registration-sync` channel broadcasts `rate-limit-increment` messages so all tabs see the shared counter. When rate-limited, the UI displays a Drawer component showing a countdown timer to the next window (computed as `window_start + 10 seconds - now`). The Drawer auto-dismisses when the window expires.

## 4d. Idempotency System

**Key generation**: A UUID v4 is generated by the client (using `crypto.randomUUID()`) at the moment the user initiates a registration action (clicks "Register", "Drop", or "Swap"). The key is attached to the operation request before it enters the service layer. Each distinct user action generates a fresh key; retries of the same action reuse the original key.

**Deduplication check**: At the very start of `registrationService.add/drop/swap()`, before any IndexedDB transaction is opened for the actual operation, the service calls `idempotencyService.checkKey(key)`. This queries the `idempotency_keys` store in IndexedDB. If a record exists with status "completed", the cached result is returned immediately and the operation is not re-executed. If a record exists with status "in-progress" and was created less than 5 minutes ago, a `ConcurrencyError` is thrown (the original operation is still running, possibly in another tab). If a record exists with status "in-progress" but is older than 5 minutes, it is considered abandoned and overwritten.

**Cached result handling**: When a duplicate key is detected with status "completed", the `idempotencyService` returns the stored result (the registration record and the updated capacity snapshot). The calling service function returns this cached result to the UI as if the operation succeeded, producing the same confirmation UX. No IndexedDB mutation occurs for the duplicate.

**Cleanup lifecycle**: Idempotency records are retained for 24 hours after creation. The `idempotencyService` registers a recurring cleanup task with the `schedulerService` that runs every 6 hours. The cleanup task queries the `idempotency_keys` store for records with `created_at` older than 24 hours and status "completed", and deletes them in a batch transaction. Records with status "in-progress" are skipped (they may be stale, but are handled by the 5-minute abandonment logic rather than the purge).

## 4e. Scheduler Execution Flow

**Initialization**: On app mount, the `schedulerService.initialize()` function is called. It reads all records from the `scheduler_tasks` IndexedDB store. For each task, it reads `next_run_at` from LocalStorage (keyed by `scheduler_next_run_{task_id}`) for fast access, falling back to the IndexedDB record if LocalStorage is empty. It broadcasts `scheduler-active` on the `scheduler-sync` channel and waits 100ms for a `scheduler-primary` response. If no response, the tab becomes the primary scheduler and begins registering `setTimeout` timers for each task based on the delta between now and `next_run_at`. If a response is received, the tab becomes a secondary and only monitors the `scheduler-sync` channel for task-executed messages and heartbeat timeouts.

**Catch-up execution**: During initialization, before registering timers, the scheduler identifies all tasks where `next_run_at` is in the past. These are sorted by priority (billing > messaging > reminders) and executed sequentially. For recurring tasks that missed multiple periods, the scheduler computes how many periods were missed and executes the task handler once per missed period. A progress indicator is rendered in the UI during catch-up (e.g., "Processing 2 missed billing runs..."). After all catch-up tasks complete, the scheduler advances their `next_run_at` to the next future occurrence and proceeds with normal timer registration.

**next_run_at advancement**: After each successful task execution, the scheduler computes the next occurrence from the task's schedule definition. For cron-like schedules (e.g., "1st of month at 12:05 AM"), it calculates the next matching datetime after now. For one-shot tasks, it marks the task as "completed" and does not re-register. The new `next_run_at` is written to both LocalStorage (synchronous, for cross-tab reads) and IndexedDB (durable, for persistence across sessions). A `task-executed` message is broadcast on `scheduler-sync` to synchronize other tabs.

**Failure recovery**: If a task handler throws an exception, the scheduler catches it, logs the error to the `error_logs` store (with task_id, error message, stack trace, and timestamp), and does NOT advance `next_run_at`. It computes a retry delay using exponential backoff (1 minute × 2^(consecutive_failures - 1), capped at 30 minutes) and schedules a retry via `setTimeout`. The `consecutive_failures` counter is stored in the `scheduler_tasks` record. After 5 consecutive failures, the scheduler sets the task status to "failed", stops retrying, and delivers a notification to SYSTEM_ADMIN and OPS_COORDINATOR via `messageCenterService` describing the failed task and the last error. The task remains in "failed" status until manually re-enabled via the Admin Settings UI, which resets `consecutive_failures` to 0 and status to "active".

---

# 5. Risk Analysis

## Browser Performance and Memory Limits

**Risk**: Large IndexedDB datasets (thousands of bookings, registrations, messages) cause slow query performance, particularly for conflict detection which requires range queries across time-overlapping records.
- **Likelihood**: Medium
- **Impact severity**: Medium
- **Root cause**: IndexedDB queries are asynchronous and can be slow on large datasets, especially without careful index design; conflict detection requires scanning all bookings in a time range and all equipment reservations.
- **Mitigation strategy**: Use composite indexes (e.g., `[room_id, start_time]`) to narrow query scope. Implement in-memory caching of frequently accessed room and equipment data, invalidated by BroadcastChannel events. Paginate analytics queries rather than loading all records at once. Monitor IndexedDB store sizes and surface warnings when approaching browser quota limits.

**Risk**: Catch-up execution of many missed scheduled tasks on app reload causes a long blocking startup, making the app appear unresponsive.
- **Likelihood**: Medium
- **Impact severity**: Medium
- **Root cause**: If the app was closed for an extended period (e.g., a month), the scheduler must execute multiple missed billing runs, message deliveries, and reminder batches before the UI becomes interactive.
- **Mitigation strategy**: Display a progress indicator during catch-up. Set a maximum catch-up batch size (e.g., 12 months of billing) and warn the admin if more are pending. Execute catch-up tasks asynchronously where possible, allowing the UI to render in a read-only state during processing.

## IndexedDB Consistency and Transaction Failures

**Risk**: An IndexedDB transaction aborts mid-write due to a browser crash, tab closure, or storage quota error, leaving application state inconsistent between related stores (e.g., registration created but capacity not decremented).
- **Likelihood**: Low
- **Impact severity**: High
- **Root cause**: IndexedDB transactions are atomic within a single transaction scope, but if the application logic spans multiple separate transactions (due to a design error), partial state updates could occur; additionally, `QuotaExceededError` can abort transactions unexpectedly.
- **Mitigation strategy**: Ensure all related writes (registration + capacity update, billing + meter reset) occur within a single IndexedDB transaction. Monitor storage usage and warn users before quotas are reached. Implement a consistency check on app startup that validates referential integrity between related stores and flags anomalies for admin review.

**Risk**: Schema migration during IndexedDB `onupgradeneeded` fails partway through, leaving the database in an inconsistent state.
- **Likelihood**: Low
- **Impact severity**: High
- **Root cause**: If the migration logic throws during the `onupgradeneeded` handler, the transaction is aborted, but the version number may or may not have been incremented depending on the browser implementation, potentially blocking future opens.
- **Mitigation strategy**: Keep individual migration steps small and idempotent. Test migration sequences extensively. Implement a pre-migration export that automatically saves a backup before any version upgrade, allowing manual recovery.

## Multi-Tab Concurrency and Race Conditions

**Risk**: Two tabs simultaneously attempt the same registration add for the last available seat, and both read the same capacity before either commits, resulting in a double-booking despite optimistic locking.
- **Likelihood**: Medium
- **Impact severity**: High
- **Root cause**: If both tabs read the same version and capacity within their respective transaction's read phase, they will both attempt to write; however, IndexedDB serializes readwrite transactions on the same store, so the second transaction's read will actually see the first's committed state — the real risk is if the implementation incorrectly uses separate transactions for read and write.
- **Mitigation strategy**: Ensure that the read (version check) and write (capacity decrement) occur within the same IndexedDB readwrite transaction. The second transaction will see the first's committed state because IndexedDB serializes overlapping readwrite transactions on the same store. Verify this behavior in integration tests across target browsers.

**Risk**: BroadcastChannel messages are lost or delayed during high-frequency mutations, causing stale data in secondary tabs.
- **Likelihood**: Medium
- **Impact severity**: Low
- **Root cause**: BroadcastChannel is best-effort and messages may be delayed or dropped if a tab is throttled by the browser (e.g., background tab throttling). Stale UI state could confuse users.
- **Mitigation strategy**: Treat BroadcastChannel as an optimization, not a guarantee. Always re-query IndexedDB before committing any mutation (the optimistic lock check). Implement a periodic background refresh (every 30 seconds) for data displayed in active views to catch any missed broadcasts.

## Security Vulnerabilities Specific to Browser-Only Storage

**Risk**: A malicious user with physical access to the device can read IndexedDB data using browser developer tools, exposing sensitive data (passwords, bills, personal information) even if at-rest encryption is enabled, because the encryption key is derived from a password that may be brute-forced offline.
- **Likelihood**: Medium
- **Impact severity**: High
- **Root cause**: Browser storage has no OS-level access control. The at-rest encryption's strength depends entirely on the user's password quality, and PBKDF2 with 310,000 iterations, while compliant, may not withstand dedicated offline attacks against weak passwords.
- **Mitigation strategy**: Enforce minimum password complexity requirements (length, character classes). Display sensitive fields with masking (last 4 only) even in the UI. Warn users that at-rest encryption protects against casual inspection but not sophisticated attacks. Recommend that the device itself be secured with OS-level encryption (FileVault, BitLocker). Consider implementing session-based in-memory key storage that requires password re-entry after browser restart.

**Risk**: XSS attacks via message content (title/body) that is rendered in the inbox, potentially stealing session tokens or exfiltrating data.
- **Likelihood**: Medium
- **Impact severity**: High
- **Root cause**: If message content is rendered using `{@html}` in Svelte without sanitization, malicious HTML/JavaScript could execute in the context of other users' sessions.
- **Mitigation strategy**: Never use `{@html}` for user-generated content. Use Svelte's default text interpolation (`{variable}`) which auto-escapes HTML. If rich text is needed, use a sanitization library (e.g., DOMPurify) before rendering. Apply Content Security Policy headers if the app is served from a static host.

## UX Degradation Under Failure Conditions

**Risk**: Rate limiting triggers the retry countdown Drawer during legitimate rapid navigation between sessions, frustrating participants who are browsing (not spamming) registration actions.
- **Likelihood**: Medium
- **Impact severity**: Medium
- **Root cause**: The rate limit (5 attempts per 10 seconds) does not distinguish between distinct sessions and repeated attempts on the same session; a participant quickly registering for 5 different sessions within 10 seconds would trigger the limit.
- **Mitigation strategy**: Scope the rate limit to per-session rather than globally, or increase the threshold for distinct-session operations. Ensure the Drawer clearly explains why the limit was triggered and shows the exact countdown. Allow the user to continue browsing (read-only) while rate-limited.

**Risk**: Optimistic locking failures during a swap operation leave the participant confused about whether the drop succeeded but the add failed, or neither happened.
- **Likelihood**: Low
- **Impact severity**: Medium
- **Root cause**: The swap is atomic (single transaction), so partial state is not possible, but the user may perceive the error message as ambiguous if it does not clearly state that the entire swap was rolled back.
- **Mitigation strategy**: On swap failure, display a clear message: "The swap could not be completed. Your original registration has been preserved. Please try again." Include the specific reason (capacity exhausted, version conflict) and suggest next steps.

## Scheduler Drift, Timing Inaccuracy, and Missed Executions

**Risk**: JavaScript `setTimeout` drift over long periods (hours to days) causes billing to execute significantly before or after 12:05 AM, potentially causing incorrect meter reads or billing period boundaries.
- **Likelihood**: High
- **Impact severity**: Medium
- **Root cause**: `setTimeout` is not a precision timer; the browser may delay callbacks due to tab throttling, system sleep, or event loop congestion. A timeout set for 8 hours from now may fire minutes late.
- **Mitigation strategy**: Do not rely on a single long-duration `setTimeout`. Instead, use a recurring short-interval check (every 60 seconds) that compares `Date.now()` against the stored `next_run_at`. This limits drift to at most 60 seconds. On `visibilitychange` (tab regains focus), immediately check all scheduled tasks, as the tab may have been suspended by the OS for hours.

**Risk**: Multiple tabs detect the same overdue task during catch-up and execute it concurrently, causing duplicate billing runs or double message delivery.
- **Likelihood**: Medium
- **Impact severity**: High
- **Root cause**: If two tabs open simultaneously while the app was closed, both run initialization and detect the same overdue task before either can broadcast "task-executed."
- **Mitigation strategy**: Before executing a catch-up task, the scheduler writes a "executing" status with a timestamp to the `scheduler_tasks` IndexedDB record within a readwrite transaction. The second tab's transaction will see this status and skip execution. The BroadcastChannel primary/secondary election also reduces this risk, as only the primary tab should execute tasks, but the IndexedDB lock is the authoritative guard.

---

# 6. Implementation Phases

## Phase 1: Foundation

**Deliverables**:
- `idbAccessLayer` service: full IndexedDB abstraction with database initialization, schema creation for all stores defined in 3c, transaction management, optimistic locking, and user_id namespace filtering.
- `authService`: PBKDF2 password hashing via WebCrypto, login/logout flow, session persistence in LocalStorage, brute-force lockout (10 attempts, 15-minute lock).
- `rbacService`: Permission matrix implementation with `checkRole()` and `checkOwnership()` utilities, `AccessError` type.
- `encryptionService`: AES-GCM key derivation, encrypt/decrypt functions, encryption toggle per user.
- Frontend routing skeleton: all routes defined in 3a with `RouteGuard` wrapper implementing role-based redirect logic.
- `UI Shell & Navigation` component: persistent top bar, sidebar navigation with role-filtered menu items, login/logout pages.
- `BroadcastChannel` infrastructure: `data-sync`, `auth-sync` channels with message dispatch and listener registration utilities.

**Acceptance criteria**:
- Given a user with role PARTICIPANT, when they attempt to navigate to `/admin`, then they are redirected to `/dashboard` and no admin content is rendered.
- Given a user entering an incorrect password 10 times, when they attempt an 11th login, then the system rejects the attempt with a lockout message and the `locked_until` timestamp in IndexedDB is set to 15 minutes in the future.
- Given two browser tabs open with the same user logged in, when Tab A writes a booking record via `idbAccessLayer`, then Tab B receives a `record-updated` message on the `data-sync` BroadcastChannel within 1 second.

**Blocking dependencies**: None — this is the foundational phase.

## Phase 2: Core Features

**Deliverables**:
- `roomSchedulingService`: Booking CRUD, time-overlap conflict detection using composite indexes, equipment exclusivity checks, maintenance window conflict checks, alternative room scoring (capacity 40%, equipment 30%, availability 20%, distance 10%) with ranked results in conflict Modal.
- `registrationService`: Add/drop/swap with atomic capacity management, optimistic locking, one-seat-per-participant enforcement.
- `idempotencyService`: UUID key management, deduplication checks, result caching, 5-minute abandonment timeout.
- `opsConfigService`: Policy management (14-day booking window, 3-reservation limit), maintenance window CRUD, blacklist rule management, JSON config loading.
- `billingService`: Bill generation with housing + metered utilities formula, waiver application (fixed then percentage), payment recording, overdue detection (10 days), reconciliation CSV export.
- Registration UI: session browsing, capacity display, add/drop/swap forms, conflict resolution Modal with scored alternatives, retry countdown Drawer.
- Room Scheduling UI: booking form, calendar view, conflict alternatives Modal with per-factor score breakdowns.
- Billing UI: bill list, bill detail, payment recording form, meter entry form, CSV export button.
- `featureFlagService`: Flag CRUD, evaluation function, in-memory caching, `flag-sync` BroadcastChannel integration.

**Acceptance criteria**:
- Given a session with 1 remaining seat and two tabs open, when both tabs submit an add registration simultaneously, then exactly one succeeds and the other receives a `VersionConflictError`, and the session capacity is decremented to 0 (not -1).
- Given a participant attempting a swap where the target session is full, when the swap transaction executes, then both the drop and add are rolled back atomically, the participant retains their original registration, and the UI displays "Your original registration has been preserved."
- Given a booking request that conflicts with an existing reservation, when the conflict Modal is shown, then at least one alternative room is displayed (if available) with numeric scores for capacity fit, equipment match, availability, and distance.
- Given a billing run triggered with a meter reading of 50 units and a rate of $2.00/unit plus $950 housing fee, when a participant has a 10% waiver, then the generated bill total is ($950 + $100) × 0.90 = $945.00.

**Blocking dependencies**: Phase 1 must be complete (IndexedDB layer, auth, RBAC, encryption, routing, BroadcastChannel infrastructure).

## Phase 3: Advanced Systems

**Deliverables**:
- `schedulerService`: Full implementation including timer initialization, catch-up execution, DND interaction, cross-tab synchronization via `scheduler-sync` BroadcastChannel (primary/secondary election, heartbeat, task-executed broadcast), exponential backoff failure recovery, and admin notification for permanently failed tasks.
- `messageCenterService`: Compose, publish, retract, pin, schedule (with `schedulerService` integration), role/org-targeted delivery, read receipt recording, analytics (unique opens, time-to-first-read), keyword search across title/body, category filtering (Announcements, Registration, Billing, Tasks).
- `todoReminderService`: Event-triggered and scheduled reminders, template variable resolution, 60-second deduplication, DND enforcement with fire_at recomputation, send logging, batch delivery of queued reminders.
- `analyticsService`: Booking conversion rate, no-show rate, slot utilization, payment success rate computation with time-period aggregation.
- Message Center UI: unified inbox with categories, search bar, message detail with read receipt trigger, compose form with targeting and scheduling, pin/retract controls.
- To-Do Center UI: reminder list, create/edit forms with template variable preview, DND configuration.
- Analytics Dashboard UI: metric cards, trend charts, filter controls (by room, instructor, period).
- Attendance tracking UI: per-session attendance/no-show recording for instructors.

**Acceptance criteria**:
- Given the app was closed for 2 months and is reopened, when the scheduler initializes, then it detects 2 missed billing runs, executes them sequentially, generates bills for both months, and displays a progress indicator during catch-up.
- Given a message scheduled for "03/25/2026 9:00 AM" and the current time is 03/25/2026 8:59 AM, when the scheduler tick fires at 9:00 AM, then the message status changes to "published" and it appears in targeted users' inboxes within 60 seconds.
- Given a reminder "Confirm setup 30 minutes before session" triggers at 10:30 PM (within DND 10:00 PM–7:00 AM), then the reminder is not delivered immediately but is queued and delivered at 7:00 AM the next day.

**Blocking dependencies**: Phase 2 must be complete (all core services that the scheduler, message center, and analytics depend on for data and triggers).

## Phase 4: Hardening and Testing

**Deliverables**:
- `exportImportService`: Full data export with schema version and SHA-256 fingerprint, import with hash verification, sequential schema migration, and rejection of future versions.
- Password change re-encryption flow: full decrypt-re-encrypt cycle with progress indicator, migration-in-progress flag, and atomic rollback on failure.
- Rate limiting with cross-tab propagation: `registration-sync` channel `rate-limit-increment` messages, Drawer component with countdown timer.
- Sensitive field masking: table component modifier that displays only last 4 characters for designated fields.
- Startup consistency checker: validates referential integrity between related IndexedDB stores (e.g., registrations reference valid sessions, payments reference valid bills) and flags anomalies.
- Operation queue implementation: per-tab mutation serialization for IndexedDB writes to prevent intra-tab transaction conflicts.
- Comprehensive integration tests: multi-tab concurrency scenarios, scheduler catch-up, billing edge cases, swap atomicity, rate-limit enforcement, export/import round-trip, encryption toggle and password change re-encryption.
- Accessibility audit: keyboard navigation, ARIA labels, focus management for modals and drawers, screen reader compatibility.
- Performance profiling: IndexedDB query benchmarks for conflict detection with 10,000+ booking records, catch-up execution time for 12 missed months.

**Acceptance criteria**:
- Given an exported JSON file that is modified (one byte changed), when imported, then the SHA-256 verification fails and the import is rejected with a clear error message identifying the integrity failure, and no data in IndexedDB is modified.
- Given a user changes their password while at-rest encryption is enabled and has 500 encrypted records, when the re-encryption process completes, then all 500 records are readable with the new password, and if the browser is force-closed mid-process, the migration-in-progress flag allows recovery on next login.
- Given 5 registration attempts within 10 seconds from Tab A and Tab B combined (3 from A, 2 from B), when a 6th attempt is made from either tab, then the Drawer appears showing a countdown to the next 10-second window, and the attempt is rejected.

**Blocking dependencies**: Phases 1–3 must be complete (all services, UI components, and scheduler are implemented and functional).

---

# 7. Requirements Coverage Matrix

## Step 1: Requirement Extraction

1. **REQ-001**: Responsive Svelte single-page application with frontend routing.
2. **REQ-002**: English-language interface.
3. **REQ-003**: Route separation for Room Scheduling, Registration, Billing, Analytics, and Admin Settings.
4. **REQ-004**: Unified Message Center accessible from persistent top bar.
5. **REQ-005**: Role: System Administrator (sets policies, manages data).
6. **REQ-006**: Role: Operations Coordinator (publishes announcements, manages maintenance, oversees schedules).
7. **REQ-007**: Role: Instructor (creates/edits session requests, tracks attendance/no-shows).
8. **REQ-008**: Role: Participant (registers, swaps, drops, views bills and messages).
9. **REQ-009**: Notices & Message Center with publish, retract, pin, and schedule.
10. **REQ-010**: Message scheduling with precise datetime (e.g., "03/25/2026 9:00 AM").
11. **REQ-011**: Message targeting by role and org scope (department, program, all users).
12. **REQ-012**: Read receipts for messages.
13. **REQ-013**: Message analytics: unique opens and time-to-first-read.
14. **REQ-014**: Unified inbox with categories (Announcements, Registration, Billing, Tasks).
15. **REQ-015**: Keyword search across message title/body.
16. **REQ-016**: Real-time conflict detection for room booking (time overlap, exclusive resources, equipment unavailability, maintenance windows).
17. **REQ-017**: Conflict resolution Modal with ranked alternatives and explainable scoring.
18. **REQ-018**: Scoring based on capacity fit (±10 seats), equipment fit, continuous availability, distance metric.
19. **REQ-019**: Distance metric derived from locally configured building/floor codes.
20. **REQ-020**: To-Do Center with event-triggered and scheduled in-app reminders.
21. **REQ-021**: Reminder template variables (room name, start time, coordinator).
22. **REQ-022**: Reminder deduplication within 60 seconds.
23. **REQ-023**: Reminder send logs.
24. **REQ-024**: Do-not-disturb windows (default 10:00 PM–7:00 AM) applied to in-app alerts.
25. **REQ-025**: Browser-only processing and persistence.
26. **REQ-026**: Local JSON configuration loading.
27. **REQ-027**: IndexedDB as primary database.
28. **REQ-028**: LocalStorage for lightweight settings.
29. **REQ-029**: Admin export/import using browser Blob downloads and file uploads.
30. **REQ-030**: Schema/version validation on import.
31. **REQ-031**: SHA-256 file fingerprint checks on import.
32. **REQ-032**: IndexedDB transactions for high-concurrency registration.
33. **REQ-033**: In-app operation queue for registration operations.
34. **REQ-034**: Idempotency key (UUID) to prevent duplicate submissions.
35. **REQ-035**: One active seat per participant per session enforcement.
36. **REQ-036**: Atomic capacity decrements with optimistic locking (version match).
37. **REQ-037**: Multi-tab consistency guarantee.
38. **REQ-038**: Rate limiting: 5 attempts per 10 seconds with retry countdown Drawer.
39. **REQ-039**: Monthly bill generation on the 1st at 12:05 AM local time.
40. **REQ-040**: Rule-driven billing: $950 housing + metered utilities.
41. **REQ-041**: Waivers as fixed amount or percentage.
42. **REQ-042**: Offline payment recording (cash/check/manual entry).
43. **REQ-043**: Overdue marking after 10 calendar days.
44. **REQ-044**: Reconciliation CSV export.
45. **REQ-045**: Analytics: booking conversion rate.
46. **REQ-046**: Analytics: no-show rate.
47. **REQ-047**: Analytics: slot utilization.
48. **REQ-048**: Analytics: payment success rate.
49. **REQ-049**: 14-day booking window policy.
50. **REQ-050**: 3 active reservations per participant policy.
51. **REQ-051**: Blacklist rules.
52. **REQ-052**: Canary rollout via local feature flags by role/org unit.
53. **REQ-053**: Salted password hashing via WebCrypto (PBKDF2, 310,000 iterations).
54. **REQ-054**: Sensitive-field masking in tables (last 4 only).
55. **REQ-055**: Optional at-rest encryption of IndexedDB (AES-GCM, key from password).
56. **REQ-056**: Per-role access isolation in UI/service layer.
57. **REQ-057**: Local backup/restore.
58. **REQ-058**: Brute-force protection: 15-minute lockout after 10 failed attempts.
59. **REQ-059**: Session token in LocalStorage, cleared on logout.
60. **REQ-060**: User data namespaced in IndexedDB by user_id.
61. **REQ-061**: Roles strictly siloed, no inheritance, single role per user.
62. **REQ-062**: Catch-up execution for missed scheduled tasks on app load.
63. **REQ-063**: Encryption key lifecycle on password change (decrypt-re-encrypt).
64. **REQ-064**: Brute-force counter resets on success and lockout expiry.
65. **REQ-065**: Metered utilities: per-cycle consumption, manual entry, billing formula.
66. **REQ-066**: Message read defined as opening detail view.
67. **REQ-067**: Import migration for older schema versions, rejection of future versions.
68. **REQ-068**: DND suppressed notifications are delayed, not discarded.
69. **REQ-069**: Alternative scoring weights: capacity 40%, equipment 30%, availability 20%, distance 10%.
70. **REQ-070**: Attendance/no-show tracking by instructor.

## Step 2: Coverage Matrix

| REQ-ID | Requirement Summary | Architecture Section | Module(s) | Flow(s) |
|---|---|---|---|---|
| REQ-001 | Responsive Svelte SPA with frontend routing | 3a Frontend routing | UI Shell & Navigation | 4a (all role flows) |
| REQ-002 | English-language interface | 3a Frontend routing | UI Shell & Navigation | 4a (all role flows) |
| REQ-003 | Route separation: Rooms, Registration, Billing, Analytics, Admin | 3a Frontend routing | UI Shell & Navigation | 4a (all role flows) |
| REQ-004 | Unified Message Center in persistent top bar | 3a Frontend routing, 3b State management | UI Shell & Navigation, Message Center | 4a Messaging flow |
| REQ-005 | System Administrator role | 3d RBAC | RBAC, Operations Configuration | 4a Billing, 4a Messaging |
| REQ-006 | Operations Coordinator role | 3d RBAC | RBAC, Message Center | 4a Messaging, 4a Billing |
| REQ-007 | Instructor role (sessions, attendance) | 3d RBAC | RBAC, Room Scheduling Service | 4a Room booking, 4a Registration |
| REQ-008 | Participant role (register, swap, drop, bills, messages) | 3d RBAC | RBAC, Registration Service | 4a Registration, 4a Billing |
| REQ-009 | Message publish, retract, pin, schedule | 3e Service layer (messageCenterService) | Message Center | 4a Messaging flow |
| REQ-010 | Message scheduling with precise datetime | 3e (messageCenterService, schedulerService) | Message Center, Client-Side Scheduler | 4a Messaging, 4e Scheduler |
| REQ-011 | Message targeting by role and org scope | 3e (messageCenterService) | Message Center | 4a Messaging flow |
| REQ-012 | Read receipts for messages | 3c (read_receipts store) | Message Center | 4a Messaging read flow |
| REQ-013 | Message analytics: unique opens, time-to-first-read | 3e (messageCenterService) | Message Center | 4a Messaging read flow |
| REQ-014 | Unified inbox with categories | 3b State management (inboxStore) | Message Center, UI Shell | 4a Messaging flow |
| REQ-015 | Keyword search across title/body | 3c (messages store indexes) | Message Center | 4a Messaging flow |
| REQ-016 | Real-time conflict detection (overlap, resources, equipment, maintenance) | 3e (roomSchedulingService) | Room Scheduling Service | 4a Room booking |
| REQ-017 | Conflict Modal with ranked alternatives and explainable scoring | 3e (roomSchedulingService) | Room Scheduling Service | 4a Room booking |
| REQ-018 | Scoring: capacity fit, equipment fit, availability, distance | 3e (roomSchedulingService) | Room Scheduling Service | 4a Room booking |
| REQ-019 | Distance metric from building/floor codes | 3e (roomSchedulingService) | Room Scheduling Service, Operations Configuration | 4a Room booking |
| REQ-020 | To-Do Center with event-triggered and scheduled reminders | 3e (todoReminderService) | To-Do/Reminder Service | 4e Scheduler flow |
| REQ-021 | Template variables (room name, start time, coordinator) | 3e (todoReminderService) | To-Do/Reminder Service | 4e Scheduler flow |
| REQ-022 | Reminder deduplication within 60 seconds | 3e (todoReminderService) | To-Do/Reminder Service | 4e Scheduler flow |
| REQ-023 | Reminder send logs | 3c (send_logs store) | To-Do/Reminder Service | 4e Scheduler flow |
| REQ-024 | DND windows (default 10 PM–7 AM) for in-app alerts | 3b (LocalStorage dnd_config), 3e (schedulerService) | Client-Side Scheduler, To-Do/Reminder Service | 4e Scheduler DND interaction |
| REQ-025 | Browser-only processing and persistence | 1 System Understanding | All modules | All flows |
| REQ-026 | Local JSON configuration loading | 3e (opsConfigService) | Operations Configuration | 4b Data lifecycle creation |
| REQ-027 | IndexedDB as primary database | 3b State management, 3c Schema | IndexedDB Access Layer | All flows |
| REQ-028 | LocalStorage for lightweight settings | 3b State management | Authentication, Client-Side Scheduler | 4a, 4e |
| REQ-029 | Admin export/import via Blob download/file upload | 3e (exportImportService) | Export/Import Service | 4b Data lifecycle export/import |
| REQ-030 | Schema/version validation on import | 3e (exportImportService) | Export/Import Service | 4b Import flow |
| REQ-031 | SHA-256 fingerprint checks on import | 3e (exportImportService) | Export/Import Service | 4b Import flow |
| REQ-032 | IndexedDB transactions for registration concurrency | 3e (registrationService), 4c Concurrency | Registration Service, IndexedDB Access Layer | 4a Registration, 4c |
| REQ-033 | In-app operation queue | 4c Operation queue | Registration Service | 4c Multi-tab concurrency |
| REQ-034 | Idempotency key (UUID) for dedup | 3e (idempotencyService), 4d Idempotency | Idempotency Service | 4d Idempotency flow |
| REQ-035 | One active seat per participant per session | 3c (registrations composite unique index) | Registration Service | 4a Registration add |
| REQ-036 | Atomic capacity decrements with optimistic locking | 4c Optimistic locking | Registration Service, IndexedDB Access Layer | 4c Optimistic locking flow |
| REQ-037 | Multi-tab consistency | 3f BroadcastChannel, 4c | IndexedDB Access Layer, all services | 4c Multi-tab model |
| REQ-038 | Rate limiting: 5/10s with retry Drawer | 4c Rate limiting | Registration Service, UI Shell | 4c Rate limiting flow |
| REQ-039 | Monthly bill generation on 1st at 12:05 AM | 3e (billingService, schedulerService) | Billing Service, Client-Side Scheduler | 4a Billing, 4e Scheduler |
| REQ-040 | $950 housing + metered utilities billing | 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-041 | Waivers: fixed amount or percentage | 3c (waivers store), 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-042 | Offline payment recording (cash/check/manual) | 3c (payments store), 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-043 | Overdue marking after 10 calendar days | 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-044 | Reconciliation CSV export | 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-045 | Analytics: booking conversion rate | 3e (analyticsService) | Analytics Service | 4a Analytics |
| REQ-046 | Analytics: no-show rate | 3e (analyticsService) | Analytics Service | 4a Analytics |
| REQ-047 | Analytics: slot utilization | 3e (analyticsService) | Analytics Service | 4a Analytics |
| REQ-048 | Analytics: payment success rate | 3e (analyticsService) | Analytics Service | 4a Analytics |
| REQ-049 | 14-day booking window policy | 3e (opsConfigService) | Operations Configuration, Room Scheduling Service | 4a Room booking |
| REQ-050 | 3 active reservations per participant | 3e (opsConfigService) | Operations Configuration, Registration Service | 4a Registration |
| REQ-051 | Blacklist rules | 3c (blacklist_rules store), 3e (opsConfigService) | Operations Configuration, Room Scheduling Service, Registration Service | 4a Room booking, 4a Registration |
| REQ-052 | Canary rollout via feature flags by role/org unit | 3g Feature flags | Feature Flag Service | 4a all role flows |
| REQ-053 | PBKDF2 310,000 iterations via WebCrypto | 3e (authService) | Authentication | 4a Login flow |
| REQ-054 | Sensitive-field masking (last 4) in tables | 3e (UI Shell) | UI Shell & Navigation | 4a Billing view |
| REQ-055 | Optional AES-GCM at-rest encryption from password | 3e (encryptionService) | Encryption Service, IndexedDB Access Layer | 4b Persistence/mutation |
| REQ-056 | Per-role access isolation in UI/service layer | 3d RBAC, 3a Route guards | RBAC, UI Shell & Navigation | All flows |
| REQ-057 | Local backup/restore | 3e (exportImportService) | Export/Import Service | 4b Export/import |
| REQ-058 | Brute-force lockout: 15 min after 10 failures | 3e (authService) | Authentication | 4a Login flow |
| REQ-059 | Session token in LocalStorage, cleared on logout | 3b State management | Authentication | 4a Login/logout |
| REQ-060 | User data namespaced by user_id in IndexedDB | 3e (idbAccessLayer) | IndexedDB Access Layer | All data flows |
| REQ-061 | Roles strictly siloed, no inheritance, single role | 3d RBAC | RBAC | All permission checks |
| REQ-062 | Catch-up execution for missed tasks on app load | 3e (schedulerService), 4e Catch-up | Client-Side Scheduler | 4e Catch-up flow |
| REQ-063 | Decrypt-re-encrypt on password change | 3e (encryptionService, authService) | Encryption Service, Authentication | 4b Mutation flow |
| REQ-064 | Brute-force counter reset on success/lockout expiry | 3e (authService) | Authentication | 4a Login flow |
| REQ-065 | Metered utilities: per-cycle consumption, manual entry, formula | 3c (billing_registry store), 3e (billingService) | Billing Service | 4a Billing flow |
| REQ-066 | Message read = opening detail view | 3e (messageCenterService) | Message Center | 4a Messaging read |
| REQ-067 | Import migration for older schemas, reject future | 3e (exportImportService) | Export/Import Service | 4b Import flow |
| REQ-068 | DND suppressed notifications delayed, not discarded | 3e (todoReminderService, schedulerService) | To-Do/Reminder Service, Client-Side Scheduler | 4e DND interaction |
| REQ-069 | Scoring weights: capacity 40%, equipment 30%, availability 20%, distance 10% | 3e (roomSchedulingService) | Room Scheduling Service | 4a Room booking |
| REQ-070 | Attendance/no-show tracking by instructor | 3c (attendance store), 3d RBAC | Room Scheduling Service, Analytics Service | 4a Room booking, 4a Analytics |

## Step 3: Missing Requirements Check

All 70 extracted requirements are mapped to at least one architecture section, module, and flow. No requirements are marked as MISSING. Every requirement from the original prompt and the binding decisions document has been traced to specific architectural components, service modules, and data flows within this plan.
