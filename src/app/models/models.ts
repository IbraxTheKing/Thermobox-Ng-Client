/*
 * JSON of the ThermoBox REST API (RestServer, branch dev).
 *
 * Two kinds of dates come from the server:
 * - the entities (Temperature, Setpoint…) carry a java.time.LocalDateTime, which Jackson writes
 *   either as an array ([2026, 10, 21, 14, 5, 0]) or as a string, depending on its configuration;
 * - the DTOs (/api/hierarchie, /api/climat, /api/updates) carry ISO-8601 strings.
 * Both are read with parseDate (core/dates.ts), always as a local time of the server.
 */

/** A LocalDateTime as Jackson may write it. */
export type DateJson = string | number[] | null;

// ---------------------------------------------------------------- users and authentication

/** UserType: an ADMIN can do everything, a MANAGER sets setpoints, a VIEWER reads. */
export type UserRole = 'ADMIN' | 'MANAGER' | 'VIEWER';

export const ROLES: readonly UserRole[] = ['ADMIN', 'MANAGER', 'VIEWER'];

/** UserDto: the API never sends the password back. */
export interface User {
  id?: number;
  username: string;
  type?: UserRole | null;
}

/** Body of POST /api/users (registration) and PUT /api/users/{id} (partial update). */
export interface UserChanges {
  username?: string;
  password?: string;
  type?: UserRole;
}

export interface LoginResponse {
  token: string;
  tokenType: string;
  /** Instant, ISO-8601 */
  expiresAt: string;
  user: User;
}

/** GET /api/users/{id}/acces. restricted false: sees everything. */
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

/** /api/rooms: an element without its kind. Prefer /api/hierarchie. */
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

/** One element of GET /api/hierarchie/arbre. */
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

/** GET /api/hierarchie/elements/{id} */
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

/** GET /api/climat/{id}/historique */
export interface History {
  devices: Series[];
  rooms: Series[];
  average: Point[];
  setpoints: Point[];
}

/** PUT /api/climat/{id}/consigne */
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

// ---------------------------------------------------------------- updates (/api/updates)

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
  incompatible: boolean;
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
