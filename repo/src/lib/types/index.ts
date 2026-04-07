// ============================================================
// Roles
// ============================================================

export const ROLES = ['SYSTEM_ADMIN', 'OPS_COORDINATOR', 'INSTRUCTOR', 'PARTICIPANT'] as const;
export type Role = (typeof ROLES)[number];

// ============================================================
// Session (Auth)
// ============================================================

export interface Session {
  user_id: string;
  role: Role;
  org_unit: string;
  token: string;
  expires_at: number;
  encryptionRequiresRelogin?: boolean;
}

// ============================================================
// Data Models — all 22 IndexedDB stores
// ============================================================

export interface User {
  user_id: string;
  username: string;
  password_hash: ArrayBuffer;
  salt: ArrayBuffer;
  role: Role;
  org_unit: string;
  failed_attempts: number;
  locked_until: number | null;
  encryption_enabled: boolean;
  encryption_salt: ArrayBuffer | null;
  _version: number;
}

export interface Booking {
  booking_id: string;
  room_id: string;
  user_id: string;
  start_time: number;
  end_time: number;
  requested_equipment: string[];
  participant_capacity: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: number;
  _version: number;
}

export interface SessionRecord {
  session_id: string;
  instructor_id: string;
  room_id: string;
  booking_id: string;
  title: string;
  start_time: number;
  end_time: number;
  capacity: number;
  current_enrollment: number;
  status: 'active' | 'cancelled' | 'completed';
  fee: number;
  _version: number;
}

export interface Registration {
  registration_id: string;
  participant_id: string;
  session_id: string;
  status: 'active' | 'cancelled' | 'swapped';
  registered_at: number;
  _version: number;
}

export interface Bill {
  bill_id: string;
  participant_id: string;
  billing_period: string;
  housing_fee: number;
  utility_charge: number;
  waiver_amount: number;
  total: number;
  status: 'generated' | 'paid' | 'overdue' | 'partial';
  due_date: number;
  generated_at: number;
  _version: number;
}

export interface Payment {
  payment_id: string;
  bill_id: string;
  amount: number;
  payment_method: 'cash' | 'check' | 'manual';
  payment_date: number;
  recorded_by: string;
  _version: number;
}

export interface Message {
  message_id: string;
  author_id: string;
  title: string;
  body: string;
  category: 'Announcements' | 'Registration' | 'Billing' | 'Tasks';
  target_roles: Role[];
  target_org_scope: 'department' | 'program' | 'all';
  target_org_units: string[];
  status: 'draft' | 'scheduled' | 'published' | 'retracted';
  scheduled_at: number | null;
  published_at: number | null;
  pinned: boolean;
  _version: number;
}

export interface ReadReceipt {
  receipt_id: string;
  message_id: string;
  user_id: string;
  read_at: number;
}

export interface Reminder {
  reminder_id: string;
  user_id: string;
  template: string;
  resolved_text: string | null;
  trigger_type: 'event' | 'scheduled';
  trigger_time: number | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  status: 'pending' | 'delivered' | 'queued' | 'cancelled';
  fire_at: number | null;
  _version: number;
}

export interface SendLog {
  log_id: string;
  reminder_id: string;
  user_id: string;
  sent_at: number;
  delivery_status: 'delivered' | 'suppressed_dnd' | 'failed';
}

export interface BillingRegistry {
  registry_id: string;
  registry_type: string;
  participant_id: string;
  meter_reading: number;
  entered_by: string;
  entered_at: number;
  _version: number;
}

export interface Configuration {
  config_key: string;
  value: unknown;
  updated_at: number;
  updated_by: string;
}

export interface FeatureFlag {
  flag_id: string;
  display_name: string;
  description: string;
  enabled: boolean;
  target_roles: Role[];
  target_org_units: string[];
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface IdempotencyKey {
  key_id: string;
  status: 'in-progress' | 'completed';
  result: unknown | null;
  created_at: number;
  completed_at: number | null;
}

export interface SchedulerTask {
  task_id: string;
  schedule_definition: string;
  task_type: 'billing' | 'messaging' | 'reminder' | 'cleanup';
  next_run_at: number;
  status: 'active' | 'executing' | 'completed' | 'failed';
  consecutive_failures: number;
  last_error: string | null;
  _version: number;
}

export interface ErrorLogEntry {
  log_id: string;
  task_id: string;
  error_message: string;
  stack_trace: string | null;
  timestamp: number;
}

export interface MaintenanceWindow {
  window_id: string;
  room_id: string;
  start_time: number;
  end_time: number;
  description: string;
  _version: number;
}

export interface BlacklistRule {
  rule_id: string;
  target_type: 'participant' | 'room';
  target_id: string;
  reason: string;
  created_by: string;
  created_at: number;
  _version: number;
}

export interface Attendance {
  attendance_id: string;
  session_id: string;
  participant_id: string;
  attendance_status: 'present' | 'absent' | 'no-show';
  recorded_by: string;
  recorded_at: number;
  _version: number;
}

export interface Room {
  room_id: string;
  name: string;
  building_code: string;
  floor_code: string;
  capacity: number;
  equipment: string[];
  _version: number;
}

export interface Equipment {
  equipment_id: string;
  room_id: string;
  equipment_type: string;
  name: string;
  is_exclusive: boolean;
  _version: number;
}

export interface Waiver {
  waiver_id: string;
  participant_id: string;
  waiver_type: 'fixed' | 'percentage';
  value: number;
  status: 'active' | 'inactive';
  _version: number;
}

// ============================================================
// Error Types
// ============================================================

export class AccessError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AccessError';
  }
}

export class VersionConflictError extends Error {
  constructor(message = 'Record has been modified by another operation') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export class ConcurrencyError extends Error {
  constructor(message = 'Operation is already in progress') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export class FeatureDisabledError extends Error {
  constructor(message = 'This feature is currently disabled') {
    super(message);
    this.name = 'FeatureDisabledError';
  }
}

export class RateLimitError extends Error {
  public retryAfter: number;
  constructor(retryAfter: number, message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

// ============================================================
// Service Input/Output Types
// ============================================================

export interface BookingRequest {
  room_id: string;
  start_time: number;
  end_time: number;
  requested_equipment: string[];
  participant_capacity: number;
  user_id: string;
}

export interface Conflict {
  type: 'time_overlap' | 'equipment' | 'maintenance';
  description: string;
  conflicting_record_id: string;
}

export interface ConflictResult {
  conflicts: Conflict[];
  alternatives: ScoredRoom[];
}

export interface ScoredRoom {
  room: Room;
  total_score: number;
  scores: {
    capacity_fit: number;
    equipment_match: number;
    availability: number;
    distance: number;
  };
}

export interface PaymentInput {
  amount: number;
  payment_method: 'cash' | 'check' | 'manual';
  payment_date: number;
}

export interface MessageInput {
  title: string;
  body: string;
  category: Message['category'];
  target_roles: Role[];
  target_org_scope: Message['target_org_scope'];
  target_org_units: string[];
}

export interface InboxFilters {
  category?: Message['category'];
  page?: number;
  pageSize?: number;
}

export interface PaginatedMessages {
  messages: Message[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReminderInput {
  user_id: string;
  template: string;
  trigger_type: Reminder['trigger_type'];
  trigger_time?: number;
  linked_entity_type?: string;
  linked_entity_id?: string;
}

export interface TaskRegistration {
  task_id: string;
  schedule_definition: string;
  task_type: SchedulerTask['task_type'];
  handler: () => Promise<void>;
}

export interface FlagInput {
  flag_id: string;
  display_name: string;
  description: string;
  enabled: boolean;
  target_roles: Role[];
  target_org_units: string[];
}

export interface MaintenanceWindowInput {
  room_id: string;
  start_time: number;
  end_time: number;
  description: string;
}

export interface DateRange {
  start: number;
  end: number;
}

// ============================================================
// BroadcastChannel Message Types
// ============================================================

export interface DataSyncMessage {
  type: 'record-updated' | 'record-deleted';
  store: string;
  record_id: string;
  version?: number;
  user_id?: string;
}

export interface AuthSyncMessage {
  type: 'logout' | 'session-refresh';
  user_id: string;
  new_expires_at?: number;
}

export interface SchedulerSyncMessage {
  type: 'task-executed' | 'scheduler-active' | 'scheduler-primary' | 'scheduler-heartbeat';
  task_id?: string;
  tab_id: string;
  new_next_run_at?: number;
  timestamp?: number;
}

export interface RegistrationSyncMessage {
  type: 'capacity-changed' | 'rate-limit-increment';
  session_id?: string;
  new_capacity?: number;
  version?: number;
  user_id?: string;
  attempt_count?: number;
  window_start?: number;
}

export interface FlagSyncMessage {
  type: 'flag-changed';
  flag_id: string;
  enabled: boolean;
  target_roles: Role[];
  target_org_units: string[];
}
