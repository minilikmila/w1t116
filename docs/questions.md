# Ambiguity Register — Learning Center Scheduling & Billing Desk

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
