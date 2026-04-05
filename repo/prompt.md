You are a senior software architect acting as a planning engine for a
production-grade repository generation system.

You are NOT allowed to write code.

Your only job is to produce a COMPLETE execution plan.

---

# INPUTS

## ORIGINAL PROMPT

Design a Learning Center Scheduling & Billing Desk to manage room reservations, participant registrations, internal billing, and operational communications entirely inside a responsive Svelte single-page application. The interface runs in English and uses frontend routing to separate Room Scheduling, Registration, Billing, Analytics, and Admin Settings while keeping a unified Message Center accessible from a persistent top bar. Roles include System Administrator (sets policies and manages data), Operations Coordinator (publishes announcements, manages maintenance windows, oversees schedules), Instructor (creates and edits session requests and tracks attendance/no-shows), and Participant (registers, swaps, drops, views bills and messages). The Notices & Message Center supports publish, retract, pin, and schedule (e.g., “03/25/2026 9:00 AM”) with precise targeting by role and organizational scope (department, program, or all users), plus read receipts and basic analytics such as unique opens and time-to-first-read; users get a unified inbox with categories (Announcements, Registration, Billing, Tasks) and keyword search across title/body. Room booking and registration flows perform real-time conflict detection (time overlap, exclusive resources like lab kits, equipment unavailability, and maintenance windows) and, on conflict, present ranked alternatives in a Modal with explainable scoring based on capacity fit (within ±10 seats), equipment fit (exact match preferred), continuous availability (no gaps), and a simple “distance” metric derived from locally configured building/floor codes. A To‑Do Center creates event-triggered or scheduled in-app reminders (e.g., “Confirm setup 30 minutes before session”) with template variables (room name, start time, coordinator), deduplication within 60 seconds, send logs, and do-not-disturb windows (default 10:00 PM–7:00 AM) applied to in-app alerts.

All processing and persistence are browser-only: the Svelte service layer reads local JSON configuration, stores operational data in IndexedDB as the primary “database” (with LocalStorage for lightweight settings), and supports admin export/import using browser Blob downloads and file uploads with schema/version validation and SHA-256 file fingerprint checks. “High-concurrency” registration is handled via IndexedDB transactions and an in-app operation queue: add/drop/swap actions carry an idempotency key (UUID) to prevent duplicate submissions, enforce one active seat per participant per session, and apply atomic capacity decrements with optimistic locking (record version must match) to guarantee consistency even with multiple tabs open; when contention is detected, the UI degrades gracefully by rate-limiting to 5 attempts per 10 seconds and showing a retry countdown in a Drawer. Fee and Billing Management generates monthly housing/utilities bills on the 1st at 12:05 AM local time (rule-driven, e.g., $950.00 housing + metered utilities, waivers as fixed amount or percentage), records offline payments (cash/check/manual entry), marks overdue after 10 calendar days, and exports reconciliation CSV. Analytics dashboards compute booking conversion, no-show rate, slot utilization, and payment success rate from local data, while Operations Configuration allows policy changes such as a 14-day booking window, 3 active reservations per participant, blacklist rules, and canary rollout via local feature flags by role/org unit. Security and privacy include salted password hashing via WebCrypto (PBKDF2 with 310,000 iterations) for local login, sensitive-field masking in Tables (show last 4 only), optional at-rest encryption of IndexedDB payloads using AES‑GCM with a key derived from the user’s password, per-role access isolation enforced in the UI/service layer, local backup/restore, and brute-force protection that locks sign-in for 15 minutes after 10 failed attempts.

## QUESTIONS & DECISIONS (BINDING RULES)

---

## 1. Authentication persistence and multi-user isolation

**Question:**
The prompt specifies PBKDF2 local login but does not state how session state persists across browser restarts, or whether multiple users sharing one device get isolated data views.

**Assumption:**
Session tokens are stored in LocalStorage and treated as ephemeral (cleared on explicit logout). Each user's operational data is namespaced in IndexedDB by user_id so a second user logging in on the same device sees only their own records.

**Solution:**
On login, a session record {user_id, role, org_unit, token, expires_at} is written to LocalStorage. All IndexedDB queries are filtered by user_id. On logout, the LocalStorage session is cleared while IndexedDB data remains for future sessions.

---

## 2. Role hierarchy vs. strict siloing and permission inheritance

**Question:**
Four roles are defined (System Admin, Ops Coordinator, Instructor, Participant) but the prompt does not specify whether roles inherit permissions or whether users may hold multiple roles.

**Assumption:**
Roles are strictly siloed — no inheritance. Each user holds exactly one role. A SYSTEM_ADMIN cannot act as a PARTICIPANT without a separate account. Permission conflicts cannot arise from overlapping roles.

**Solution:**
Each service function maintains an explicit allowlist of permitted roles. A checkRole(requiredRoles) utility throws AccessError before executing any restricted operation. The user record stores a single role field; multi-role assignment is blocked at the service layer.

---

## 3. Real-time conflict detection without a backend

**Question:**
The prompt demands "real-time conflict detection" but the system is entirely browser-only, making the definition of real-time unclear.

**Assumption:**
"Real-time" refers to immediate validation within the current browser context at the time of user interaction.

**Solution:**
Perform synchronous validation using IndexedDB queries before committing transactions, combined with in-memory caching for responsiveness.

---

## 4. Scheduled operations when the app is closed

**Question:**
Scheduled tasks (billing, message scheduling, reminders) require exact timing, but behavior when the app is closed is not defined.

**Assumption:**
Tasks execute only when the application is active. Missed executions are processed on next application load.

**Solution:**
Persist scheduler metadata (next_run_at, last_run_at) in IndexedDB. On app initialization, detect overdue tasks and execute them before rendering the UI.

---

## 5. Distance scoring — MAX_DISTANCE definition and building code format

**Question:**
The scoring formula references MAX_DISTANCE and building/floor codes, but neither format nor calculation method is defined.

**Assumption:**
Building and floor identifiers are numeric internally, and MAX_DISTANCE is derived dynamically from configured data.

**Solution:**
Store building/floor as numeric IDs with display labels. Compute MAX_DISTANCE dynamically from configuration and cache it for scoring calculations.

---

## 6. High concurrency in a browser-only environment

**Question:**
The meaning of "high concurrency" is unclear without a distributed backend.

**Assumption:**
Concurrency refers to rapid repeated actions and multi-tab interactions within the same browser.

**Solution:**
Use IndexedDB transactions with optimistic locking and idempotency keys. Allow concurrent operations and resolve conflicts at commit time. Apply rate limiting (5 attempts per 10 seconds) for stability.

---

## 7. Encryption key lifecycle when password changes

**Question:**
AES-GCM encryption keys are derived from user passwords, but behavior during password changes is undefined.

**Assumption:**
All encrypted data must remain accessible after password changes.

**Solution:**
On password change, decrypt all data using the old key, derive a new key using PBKDF2, re-encrypt all data, and store the new salt. Abort operation if any step fails.

---

## 8. Brute-force counter reset rules

**Question:**
The reset conditions for failed login attempts are not specified.

**Assumption:**
The counter resets after a successful login and after the lockout period expires.

**Solution:**
Store failed_attempts and locked_until in IndexedDB. Reset counters after successful login or when lockout expires.

---

## 9. Metered utilities — data model and calculation method

**Question:**
How should meter readings be stored and how is billing calculated
in a browser-only IndexedDB system?

**Assumption:**
The system uses a per-cycle consumption model, where each reading
represents total units consumed in the current billing cycle.
Readings are manually entered by SYSTEM_ADMIN or OPS_COORDINATOR
before billing runs. No historical meter reading aggregation is
maintained.

**Solution:**
Store meter state in a dedicated billing registry entity in IndexedDB,
separate from participant data. The record contains:

- current_meter_reading (number)
- meter_unit (string, configuration-based display label only —
  arithmetic is unit-agnostic)
- last_updated_at (timestamp)
- last_updated_by (user role identifier)

Billing logic executed as a single atomic IndexedDB transaction:

1. Read current_meter_reading from the billing registry.
2. Read housing_fee and rate_per_unit from policy configuration.
3. Apply billing formula:
   total = housing_fee + (current_meter_reading × rate_per_unit)
4. Apply active waivers: fixed deductions first, then percentage
   deductions applied to the remaining balance.
5. Generate bill record.
6. Reset current_meter_reading to 0.
7. Write last_updated_at and last_updated_by for traceability.

Access to meter entry is restricted to SYSTEM_ADMIN and
OPS_COORDINATOR. INSTRUCTOR and PARTICIPANT roles cannot read
or write meter state.

---

## 10. Message read receipts and analytics

**Question:**
The prompt does not define when a message is considered "read."

**Assumption:**
A message is considered read when the user opens its detail view.

**Solution:**
Record a single read event per user per message with timestamp. Compute analytics metrics from stored events.

---

## 11. Import/export schema versioning and migration

**Question:**
Schema versioning and backward compatibility rules are not defined.

**Assumption:**
Exports include a schema version and older versions must be supported via migrations.

**Solution:**
Embed SCHEMA_VERSION in exports. Apply sequential migration functions for older versions and reject unsupported future versions.

---

## 12. Do-Not-Disturb (DND) handling and notification delivery

**Question:**
Behavior of suppressed notifications during DND periods is not fully defined.

**Assumption:**
Notifications are delayed, not discarded.

**Solution:**
Store suppressed notifications and deliver them after DND ends or on next app load, using controlled batching to avoid UI overload.

---

## 13. Alternative ranking scoring weights

**Question:**
The prompt specifies multiple scoring factors (capacity fit, equipment match, availability, distance) but does not define their relative importance.

**Assumption:**
All factors contribute with predefined weights, prioritizing capacity and equipment over distance.

**Solution:**
Apply a fixed weighted scoring model:

- Capacity fit: 40%
- Equipment match: 30%
- Availability continuity: 20%
- Distance (building/floor proximity): 10%

Weights are defined as immutable constants inside the scheduling
service. The system computes a normalized composite score for each
alternative room and returns a ranked list capped at 5 candidates,
with per-factor score breakdowns exposed for display in the conflict
resolution Modal. No Admin configuration, persistence layer, or
runtime modification of weights is supported.

---

# YOUR TASK

Produce a structured execution plan covering sections 1 through 7 below.

---

## 1. System Understanding

Include:

- Core problem summary: what system is being built, not a surface
  description of its features.
- Hidden requirements: constraints and behaviours not explicitly stated
  in the original prompt but implied by the decisions in questions.md.
- Key hard constraints: browser-only execution, IndexedDB as primary
  store, no backend, no external API calls.
- Non-functional constraints: performance expectations, consistency
  guarantees, concurrency model, and security requirements as derived
  from both inputs.

---

## 2. Feature Breakdown

For each module provide ALL of the following — no module may omit any
field:

- Purpose: what problem this module solves.
- Inputs: what data or events trigger it.
- Outputs: what it produces or mutates.
- Internal responsibilities: the specific operations it owns.
- Edge cases and failure modes: at least three per module.
- Dependencies: which other modules it calls or is called by.

You MUST cover ALL modules required to fully implement the system.

Special rule — treat the client-side scheduler as a standalone module
with these five named sub-concerns addressed explicitly:

- Timer initialisation and storage of next_run_at in LocalStorage.
- Catch-up execution on app reload when next_run_at is in the past.
- DND engine interaction and fire_at recomputation.
- Cross-tab synchronisation via BroadcastChannel.
- Failure recovery when a scheduled task throws during execution.

---

## 3. Architecture Design

Design the full system architecture. Every subsection is mandatory.

### 3a. Frontend routing

- List every route, the component it renders, and the roles permitted
  to access it.
- Describe the route guard mechanism: how unauthorised access is
  detected and redirected.

### 3b. State management model

- Enumerate what lives in memory (reactive Svelte stores), what is
  persisted in IndexedDB, and what is persisted in LocalStorage.
- For each category give the reason for that storage choice.

### 3c. IndexedDB schema

For each store provide:

- Store name
- keyPath
- All indexes: index name, keyPath, unique flag
- Version number when the store was introduced
- One-sentence migration note

Do NOT enumerate every field — field-level schema belongs in
implementation, not planning.

### 3d. Role-based access control

- Produce an explicit permission matrix: rows are operations, columns
  are roles (SYSTEM_ADMIN, OPS_COORDINATOR, INSTRUCTOR, PARTICIPANT).
- State the inheritance rule explicitly: roles are strictly siloed,
  no role inherits another's permissions, each user holds exactly one
  role.

### 3e. Service layer

- One entry per service file.
- For each: its single responsibility, its inputs, its outputs, and
  its dependencies on other service files.

### 3f. BroadcastChannel system

- List every channel by name.
- For each channel: every message type it carries, which module sends
  it, and which module(s) receive it.

### 3g. Feature flag system

- Describe the storage model for flags in IndexedDB.
- Describe the runtime evaluation function: inputs, logic, output.
- Describe how flags gate UI rendering and service-layer execution
  per role and per org unit.

---

## 4. Data Flow Design

For each flow provide full lifecycle detail. Every subsection is
mandatory.

### 4a. User flows per role

Describe the complete interaction sequence for each role across these
four operations:

- Registration (add, drop, swap)
- Room booking and scheduling
- Billing (bill generation, payment recording, waiver application)
- Messaging (compose, publish, read, retract)

### 4b. Data lifecycle

Trace data from creation through every stage:
creation → validation → persistence → mutation → export → import

### 4c. Multi-tab concurrency model

Cover in full:

- Operation queue: structure, sequencing, and how it serialises
  mutations.
- BroadcastChannel sync: which events are broadcast, what receivers
  do with them.
- Optimistic locking: version check flow, failure path, UI response.
- Rate limiting: counter storage, cross-tab propagation, Drawer
  trigger condition.

### 4d. Idempotency system

Cover in full:

- Key generation: when, by whom, using what algorithm.
- Deduplication check: at what point in the flow, against what store.
- Cached result handling: what is returned on a duplicate detection.
- Cleanup lifecycle: retention period and purge trigger.

### 4e. Scheduler execution flow

Cover in full:

- Initialisation: how schedulers register on app mount.
- Catch-up execution: detection of overdue next_run_at on reload.
- next_run_at advancement: how the next trigger time is computed
  and persisted after each execution.
- Failure recovery: what happens if a scheduled task throws, how
  next_run_at is handled to prevent skipping or infinite retry.

---

## 5. Risk Analysis

For each risk provide ALL of the following:

- Risk description
- Likelihood: high / medium / low
- Impact severity: high / medium / low
- Root cause
- Mitigation strategy

You MUST cover risks in each of these categories:

- Browser performance and memory limits
- IndexedDB consistency and transaction failures
- Multi-tab concurrency and race conditions
- Security vulnerabilities specific to browser-only storage
- UX degradation under failure conditions
- Scheduler drift, timing inaccuracy, and missed executions

---

## 6. Implementation Phases

Divide implementation into exactly FOUR phases.

### Phase 1: Foundation

### Phase 2: Core Features

### Phase 3: Advanced Systems

### Phase 4: Hardening and Testing

For each phase provide:

- Deliverables: what is produced, named specifically.
- Acceptance criteria: written as verifiable conditions using the
  form "Given [state], when [action], then [observable outcome]."
  Minimum two criteria per phase.
- Blocking dependencies: what must be complete before this phase
  can begin.

No phase may be vague or use placeholder language.

---

## 7. Requirements Coverage Matrix (MANDATORY)

### Step 1

Before building the matrix, extract every discrete requirement from
the original prompt and assign it an ID using the format REQ-001,
REQ-002, etc. List all REQ-IDs with a one-line description in a
numbered block above the matrix.

### Step 2

Produce a markdown table with these columns:
REQ-ID | Requirement summary | Architecture section | Module(s) | Flow(s)

### Step 3

If any requirement is not covered:

- Mark it as MISSING in the Architecture section column.
- Add a one-sentence explanation of why it is missing.
- Propose a resolution strategy.

---

# STRICT RULES

- DO NOT generate code.
- DO NOT generate a folder structure.
- DO NOT simplify or omit any requirement from either input.
- DO NOT use vague placeholders such as "etc", "and so on", or
  "as needed".
- DO NOT add assumptions not present in either input document.
- DO NOT silently invent behaviour — if uncertain, write
  UNKNOWN DECISION.
- Every bullet must be a minimum of two sentences.
- Output must be internally consistent across all seven sections —
  every module named in Section 2 must appear in Section 3, every
  flow in Section 4 must trace to a module in Section 2, and every
  requirement in Section 7 must map to a named section or module.
- No extra top-level sections are permitted. Additional findings may
  be appended as subsections within the most relevant section.

---

# OUTPUT FORMAT

- Structured Markdown only.
- Sections numbered 1 through 7 exactly as defined above.
- Subsections use the labels defined above (3a, 3b, etc.).
- No commentary, preamble, or summary outside the required structure.

---

Now begin.
