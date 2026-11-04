/*
 * JSON of the ThermoBox REST API v2 (RestServer 26.12, English names). A server before 26.12
 * answers the same with French names (API v1): core/api-version.ts translates it.
 *
 * Two kinds of dates come from the server:
 * - the entities (Temperature, Setpoint…) carry a java.time.LocalDateTime, which Jackson writes
 *   either as an array ([2026, 10, 21, 14, 5, 0]) or as a string, depending on its configuration;
 * - the DTOs (/api/v2/hierarchy, /api/v2/climate, /api/v2/updates) carry ISO-8601 strings.
 * Both are read with parseDate (core/dates.ts), always as a local time of the server.
 */

/** A LocalDateTime as Jackson may write it. */
export type DateJson = string | number[] | null;

// ---------------------------------------------------------------- users and authentication

/** UserType: an ADMIN can do everything, a MANAGER sets setpoints, a VIEWER reads. */
export type UserRole = 'ADMIN' | 'MANAGER' | 'VIEWER';

export const ROLES: readonly UserRole[] = ['ADMIN', 'MANAGER', 'VIEWER'];

/**
 * UserDto: the API never sends the password back. [mustChangePassword]: the password is a
 * provisional one (imported account, reset by an admin): it must be replaced before anything else
 * (servers 26.12 and later), until [provisionalExpiresAt].
 */
export interface User {
  id?: number;
  username: string;
  type?: UserRole | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  mustChangePassword?: boolean;
  provisionalExpiresAt?: string | null;
}

/** Body of POST /api/v2/users (registration) and PUT /api/v2/users/{id} (partial update). */
export interface UserChanges {
  username?: string;
  password?: string;
  type?: UserRole;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/** POST /api/v2/users/{id}/provisional-password: shown once, never kept by the server in clear. */
export interface ProvisionalPassword {
  id: number | null;
  username: string;
  password: string;
  /** ISO local date-time; null: no limit. */
  expiresAt: string | null;
}

/** GET /api/v2/auth/password-policy */
export interface PasswordPolicy {
  minLength: number;
  maxBytes: number;
  letter: boolean;
  digit: boolean;
  notUsername: boolean;
}

/** Fields of an account a column of an imported list can give. */
export type ImportField = 'USERNAME' | 'FIRST_NAME' | 'LAST_NAME' | 'EMAIL' | 'ROLE';

/** POST /api/v2/users/import/file or /source: the list read, waiting to be checked. */
export interface ImportSession {
  id: string;
  source: string;
  columns: string[];
  sample: string[][];
  rowCount: number;
  suggested: Partial<Record<ImportField, string>>;
}

export interface ImportOptions {
  mapping: Partial<Record<ImportField, string>>;
  defaultRole: UserRole;
  validityDays: number;
}

export interface ImportRow {
  line: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: UserRole;
  status: 'CREATE' | 'DUPLICATE' | 'INVALID';
  problems: string[];
  usernameMade: boolean;
  usernameAdjusted: boolean;
}

export interface ImportCheck {
  rows: ImportRow[];
  create: number;
  duplicates: number;
  invalid: number;
}

/** An account created by an import, with its provisional password (the only time it is given). */
export interface CreatedAccount {
  line: number;
  id: number | null;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: UserRole;
  password: string;
  expiresAt: string | null;
}

export interface ImportResult {
  created: CreatedAccount[];
  skipped: ImportRow[];
  failed: { line: number; problem: string }[];
}

export interface LoginResponse {
  token: string;
  tokenType: string;
  /** Instant, ISO-8601 */
  expiresAt: string;
  user: User;
}

/** GET /api/v2/users/{id}/access. restricted false: sees everything. */
export interface Access {
  restricted: boolean;
  elements: { id: number; name: string | null; kind: RoomKind }[];
}

// ---------------------------------------------------------------- groups

export interface Group {
  id: number;
  name: string;
  description: string | null;
  members: { id: number; username: string | null }[];
  elements: { id: number; name: string | null; kind: RoomKind }[];
}

export interface GroupRequest {
  name: string;
  description?: string | null;
  members: number[];
  elements: number[];
}

// ---------------------------------------------------------------- buildings, floors, rooms, devices

/** Level in the tree, from the top: Building → (Floor) → Room → Device. */
export type RoomKind = 'BUILDING' | 'FLOOR' | 'ROOM' | 'DEVICE';

/** /api/v2/rooms: an element without its kind. Prefer /api/v2/hierarchy. */
export interface Room {
  id?: number;
  name: string | null;
}

/** An element seen from above (breadcrumb, children). accessible false: name only. */
export interface Element {
  id: number;
  name: string | null;
  kind: RoomKind;
  accessible: boolean;
}

/** The setpoint that applies to an element: its own, or its nearest ancestor's (heritee). */
export interface EffectiveSetpoint {
  value: number | null;
  date: string | null;
  inherited: boolean;
  sourceId: number | null;
  sourceName: string | null;
}

/** One element of GET /api/v2/hierarchy/tree. */
export interface Node {
  id: number;
  name: string | null;
  kind: RoomKind;
  /** null: a building, or an element not attached yet. */
  parentId: number | null;
  attached: boolean;
  /** false: an ancestor shown only to place what the user may see below it. */
  accessible: boolean;
  /** Celsius: last measure of a box, average of the boxes below otherwise. */
  temperature: number | null;
  lastMeasurement: string | null;
  /** Boxes below (0 for a VIEWER). */
  devices: number;
  setpoint: EffectiveSetpoint | null;
  /** Version of the photo, null without photo. */
  image: number | null;
  favorite: boolean;
}

export interface Tree {
  /** The user sees everything (no limited access). */
  all: boolean;
  /** MANAGER or ADMIN: the boxes are part of the tree. */
  devicesVisible: boolean;
  nodes: Node[];
}

export interface DeviceMeasurement {
  id: number;
  name: string | null;
  value: number | null;
  date: string | null;
}

/** GET /api/v2/hierarchy/elements/{id} */
export interface DetailElement {
  element: Node;
  ancestors: Element[];
  children: Element[];
  measurements: DeviceMeasurement[];
  ownSetpoints: EffectiveSetpoint[];
  rooms: Node[];
}

export interface ElementRequest {
  kind?: RoomKind;
  name: string;
  parentId: number | null;
}

// ---------------------------------------------------------------- temperatures and climate

export type TemperatureType = 'setpoint' | 'measurement';

/** Temperature, Setpoint or Mesurer (the API doesn't say which: see TemperatureService.byType). */
export interface Temperature {
  id?: number;
  value: number | null;
  date: DateJson;
}

export type Setpoint = Temperature;

export interface Point {
  date: string | null;
  value: number | null;
}

export interface Series {
  id: number;
  name: string | null;
  points: Point[];
}

/** GET /api/v2/climate/{id}/history */
export interface History {
  devices: Series[];
  rooms: Series[];
  average: Point[];
  setpoints: Point[];
}

/** PUT /api/v2/climate/{id}/setpoint */
export interface SetpointSending {
  kept: EffectiveSetpoint[];
  replaced: Element[];
  devices: Element[];
  failures: Element[];
}

export interface RoomTempAttr {
  id?: number;
  room: Room;
  temperature: Temperature;
}

// ---------------------------------------------------------------- updates (/api/v2/updates)

export interface AvailableVersion {
  version: string;
  /** PATCH or FEATURE */
  type: string;
  typeLabel: string;
  recommended: boolean;
  prerelease: boolean;
  /** stable, nightly, beta, rc… */
  channel: string;
  older: boolean;
  title: string;
  publishedAt: string | null;
  url: string;
  notes: string;
  migration: string | null;
  /** The notes announce an incompatibility; for an older version, also when [blockedBy] is set. */
  incompatible: boolean;
  /**
   * Older version only (server 26.12): the version, up to the installed one, whose notes forbid
   * going back past it (« Rétrocompatibilité : non »); null if none. Absent from older servers.
   */
  blockedBy?: string | null;
}

export interface InstallationStep {
  title: string;
  /** PENDING, RUNNING, OK, SKIPPED, FAILED */
  state: string;
  detail: string;
}

export interface Installation {
  id: string;
  target: string;
  from: string | null;
  type: string;
  component: string;
  user: string;
  startedAt: string;
  /** RUNNING, RESTARTING, DONE, FAILED */
  state: string;
  message: string;
  backupFile: string | null;
  finishedAt: string | null;
  steps: InstallationStep[];
}

export interface UpdatesState {
  component: string | null;
  installedVersion: string | null;
  channel: string;
  dailyCheck: boolean;
  lastCheck: string | null;
  error: string | null;
  updateAvailable: boolean;
  latestPatch: AvailableVersion | null;
  latestFeature: AvailableVersion | null;
  available: AvailableVersion[];
  olderVersions: AvailableVersion[];
  automaticInstall: boolean | null;
  installMode: string | null;
  installation: Installation | null;
  /**
   * Can the version installed be left for an older one (its notes: « Rétrocompatibilité : oui /
   * non »)? null: they don't say. Server 26.12; with an older server (field absent), the client
   * reads the notes of that version on GitHub.
   */
  installedRollback?: boolean | null;
  /** Release notes of the version installed (optional, see installedRollback). */
  installedNotes?: string | null;
}

export interface UpdateCheck {
  /** OK, INFO, WARNING, BLOCKING */
  level: string;
  title: string;
  detail: string;
}

export interface Preparation {
  version: AvailableVersion;
  installedVersion: string | null;
  installable: boolean;
  checks: UpdateCheck[];
  backupRequired: boolean;
  simpleRollback: boolean;
  confirmationRequired: boolean;
}

// ---------------------------------------------------------------- settings

/** Look of every client, chosen by an ADMIN. */
export type StyleSite = 'glass' | 'panel';

export interface Settings {
  style: StyleSite;
}

/** Body of an error answered by the API ({"error": …} or ErrorResponse). */
export interface ApiError {
  error?: string | null;
  message?: string | null;
  status?: number;
}

// ---------------------------------------------------------------- the server (API v2, 26.12)

/** A closed range of temperatures, in Celsius. */
export interface TemperatureRange {
  min: number;
  max: number;
}

/** GET /api/v2/server/limits: what the server accepts, chosen by an ADMIN (-10 to 50 °C by default). */
export interface TemperatureLimits {
  measurement: TemperatureRange;
  setpoint: TemperatureRange;
}

/** GET /api/v2/server/metrics (ADMIN, 26.12): what the server process uses right now. */
export interface ServerMetrics {
  /** CPU of the server process, % of the processors it may use; null if unknown. */
  processCpu: number | null;
  /** CPU of the whole machine (or container). */
  systemCpu: number | null;
  processors: number;
  heapUsedMb: number;
  heapCommittedMb: number;
  /** -1 when unbounded. */
  heapMaxMb: number;
  nonHeapUsedMb: number;
  threads: number;
  /** Collections since the start, and the time the server was paused by them. */
  gcCount: number;
  gcTimeMs: number;
  uptimeSeconds: number;
}

// ---------------------------------------------------------------- temperature alerts (26.12)

/*
 * /api/v2/alerts (ADMIN): the server watches the rooms itself and warns by email or webhook when
 * one stays above its setpoint, then when it is back to normal. The secrets of a channel (SMTP
 * password, webhook URL, Authorization header, signing key) are only ever sent: an answer says
 * whether each one is set (passwordSet, urlSet…), never its value.
 */

export type AlertChannelKind = 'EMAIL' | 'WEBHOOK';
export type SmtpSecurity = 'NONE' | 'STARTTLS' | 'SSL';
export type WebhookFormat = 'DISCORD' | 'SLACK' | 'GENERIC';
export type AlertState = 'ACTIVE' | 'RESOLVED' | 'CANCELLED';
export type DeliveryKind = 'TRIGGERED' | 'REMINDER' | 'RESOLVED' | 'TEST';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

/** MonitorStatusDto: the watch of the rooms on this server. */
export interface AlertMonitorStatus {
  /** THERMOBOX_ALERTS is not false on this server. */
  enabled: boolean;
  running: boolean;
  lastRun: DateJson;
  watchedRooms: number;
  lastError: string | null;
  /** The last run was done by another server sharing the database. */
  runByAnotherServer: boolean;
}

export interface AlertEmailSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  passwordSet: boolean;
  from: string;
  fromName: string | null;
  recipients: string[];
  template: string | null;
}

export interface AlertWebhookSettings {
  format: WebhookFormat;
  /** « https://discord.com/… »: the URL itself is a secret. */
  urlPreview: string | null;
  urlSet: boolean;
  authorizationSet: boolean;
  signingSecretSet: boolean;
  template: string | null;
}

/** AlertChannelDto: where to send. */
export interface AlertChannel {
  id: number;
  name: string;
  kind: AlertChannelKind;
  enabled: boolean;
  email: AlertEmailSettings | null;
  webhook: AlertWebhookSettings | null;
  /** The stored secrets cannot be read any more (key changed): enter them again. */
  secretUnreadable: boolean;
  createdAt: DateJson;
  updatedAt: DateJson;
}

/**
 * POST / PUT /api/v2/alerts/channels. Each secret (password, url, authorization, signingSecret):
 * left out keeps the stored one, "" removes it. [kind] does not change after the creation.
 */
export interface AlertChannelRequest {
  name: string;
  kind: AlertChannelKind;
  enabled: boolean;
  email?: {
    host: string;
    port: number;
    security: SmtpSecurity;
    username?: string;
    password?: string;
    from: string;
    fromName?: string;
    recipients: string[];
    template?: string;
  };
  webhook?: {
    format: WebhookFormat;
    url?: string;
    authorization?: string;
    signingSecret?: string;
    template?: string;
  };
}

/** An element (building, floor, room) or a channel named in a rule. */
export interface AlertElement {
  id: number;
  /** null: deleted since. */
  name: string | null;
  kind: string | null;
}

/** AlertRuleDto: when to warn, and whom. */
export interface AlertRule {
  id: number;
  name: string;
  enabled: boolean;
  /** °C above the setpoint before a measurement counts as an excess. */
  tolerance: number;
  /** How long a box must stay above before the alert is sent. */
  minDurationSeconds: number;
  /** How long every box must stay back under before the alert ends. */
  clearAfterSeconds: number;
  /** Sent again every … while it lasts (0: never). */
  reminderSeconds: number;
  notifyResolution: boolean;
  /** The whole installation; otherwise the elements of [scope] and what they contain. */
  global: boolean;
  scope: AlertElement[];
  channels: AlertElement[];
  createdAt: DateJson;
  updatedAt: DateJson;
}

/** POST / PUT /api/v2/alerts/rules: [scope] and [channels] by their ids. */
export interface AlertRuleRequest {
  name: string;
  enabled: boolean;
  tolerance: number;
  minDurationSeconds: number;
  clearAfterSeconds: number;
  reminderSeconds: number;
  notifyResolution: boolean;
  global: boolean;
  scope: number[];
  channels: number[];
}

export interface AlertDevice {
  id: number;
  name: string | null;
  temperature: number | null;
  at: DateJson;
  exceeding: boolean;
}

/** AlertDeliveryDto: one message about an alert (or a test). */
export interface AlertDelivery {
  id: number;
  eventId: number | null;
  channelId: number | null;
  channelName: string;
  kind: DeliveryKind;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: DateJson;
  lastError: string | null;
  createdAt: DateJson;
  sentAt: DateJson;
}

/** AlertEventDto: a room above its setpoint under a rule. */
export interface AlertEvent {
  id: number;
  ruleId: number | null;
  ruleName: string;
  roomId: number;
  roomName: string | null;
  /** « Bâtiment A › Étage 1 » */
  place: string;
  state: AlertState;
  exceededSince: DateJson;
  triggeredAt: DateJson;
  resolvedAt: DateJson;
  setpoint: number;
  threshold: number;
  currentSetpoint: number | null;
  temperature: number;
  peak: number;
  lastTemperature: number | null;
  devices: AlertDevice[];
  lastNotifiedAt: DateJson;
  reminders: number;
  reason: string | null;
  /** A message about it could not be delivered. */
  deliveryFailed: boolean;
  /** Only for GET /events/{id}. */
  deliveries: AlertDelivery[] | null;
}

/** GET /api/v2/alerts: everything the page of alerts shows at once. */
export interface AlertOverview {
  status: AlertMonitorStatus;
  channels: AlertChannel[];
  rules: AlertRule[];
  active: AlertEvent[];
  /** The last messages that could not be delivered. */
  failedDeliveries: AlertDelivery[];
}
