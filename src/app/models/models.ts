/*
 * JSON of the ThermoBox REST API (RestServer, branch dev).
 *
 * Two kinds of dates come from the server:
 * - the entities (Temperature, Consigne…) carry a java.time.LocalDateTime, which Jackson writes
 *   either as an array ([2026, 10, 21, 14, 5, 0]) or as a string, depending on its configuration;
 * - the DTOs (/api/hierarchie, /api/climat, /api/updates) carry ISO-8601 strings.
 * Both are read with parseDate (core/dates.ts), always as a local time of the server.
 */

/** A LocalDateTime as Jackson may write it. */
export type DateJson = string | number[] | null;

// ---------------------------------------------------------------- users and authentication

/** UserType: an ADMIN can do everything, a GESTIONNAIRE sets consignes, a VIEWER reads. */
export type UserRole = 'ADMIN' | 'GESTIONNAIRE' | 'VIEWER';

export const ROLES: readonly UserRole[] = ['ADMIN', 'GESTIONNAIRE', 'VIEWER'];

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
export interface Acces {
  restricted: boolean;
  elements: { id: number; name: string | null; kind: SalleKind }[];
}

// ---------------------------------------------------------------- groups

export interface Groupe {
  id: number;
  name: string;
  description: string | null;
  members: { id: number; username: string | null }[];
  elements: { id: number; name: string | null; kind: SalleKind }[];
}

export interface GroupeRequest {
  name: string;
  description?: string | null;
  members: number[];
  elements: number[];
}

// ---------------------------------------------------------------- bâtiments, étages, salles, boîtiers

/** Level in the tree, from the top: Bâtiment → (Étage) → Salle → Boîtier. */
export type SalleKind = 'BATIMENT' | 'ETAGE' | 'SALLE' | 'BOITIER';

/** /api/salles: an element without its kind. Prefer /api/hierarchie. */
export interface Salle {
  id?: number;
  name: string | null;
}

/** An element seen from above (breadcrumb, children). accessible false: name only. */
export interface Element {
  id: number;
  name: string | null;
  kind: SalleKind;
  accessible: boolean;
}

/** The consigne that applies to an element: its own, or its nearest ancestor's (heritee). */
export interface ConsigneEffective {
  value: number | null;
  date: string | null;
  heritee: boolean;
  sourceId: number | null;
  sourceName: string | null;
}

/** One element of GET /api/hierarchie/arbre. */
export interface Noeud {
  id: number;
  name: string | null;
  kind: SalleKind;
  /** null: a bâtiment, or an element not attached yet. */
  parentId: number | null;
  rattache: boolean;
  /** false: an ancestor shown only to place what the user may see below it. */
  accessible: boolean;
  /** Celsius: last measure of a box, average of the boxes below otherwise. */
  temperature: number | null;
  derniereMesure: string | null;
  /** Boxes below (0 for a VIEWER). */
  boitiers: number;
  consigne: ConsigneEffective | null;
  /** Version of the photo, null without photo. */
  image: number | null;
  favori: boolean;
}

export interface Arbre {
  /** The user sees everything (no limited access). */
  tout: boolean;
  /** GESTIONNAIRE or ADMIN: the boxes are part of the tree. */
  boitiersVisibles: boolean;
  noeuds: Noeud[];
}

export interface MesureBoitier {
  id: number;
  name: string | null;
  value: number | null;
  date: string | null;
}

/** GET /api/hierarchie/elements/{id} */
export interface DetailElement {
  element: Noeud;
  ancetres: Element[];
  enfants: Element[];
  mesures: MesureBoitier[];
  consignesPropres: ConsigneEffective[];
  salles: Noeud[];
}

export interface ElementRequest {
  kind?: SalleKind;
  name: string;
  parentId: number | null;
}

// ---------------------------------------------------------------- temperatures and climate

export type TemperatureType = 'consigne' | 'mesurer';

/** Temperature, Consigne or Mesurer (the API doesn't say which: see TemperatureService.byType). */
export interface Temperature {
  id?: number;
  value: number | null;
  date: DateJson;
}

export type Consigne = Temperature;

export interface Point {
  date: string | null;
  value: number | null;
}

export interface Serie {
  id: number;
  name: string | null;
  points: Point[];
}

/** GET /api/climat/{id}/historique */
export interface Historique {
  boitiers: Serie[];
  salles: Serie[];
  moyenne: Point[];
  consignes: Point[];
}

/** PUT /api/climat/{id}/consigne */
export interface EnvoiConsigne {
  conservees: ConsigneEffective[];
  remplacees: Element[];
  boitiers: Element[];
  echecs: Element[];
}

export interface SalleTempAttr {
  id?: number;
  salle: Salle;
  temperature: Temperature;
}

// ---------------------------------------------------------------- updates (/api/updates)

export interface VersionDisponible {
  version: string;
  /** CORRECTIVE or FONCTIONNELLE */
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

export interface EtapeInstallation {
  title: string;
  /** EN_ATTENTE, EN_COURS, OK, IGNOREE, ECHEC */
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
  /** EN_COURS, REDEMARRAGE, TERMINEE, ECHEC */
  state: string;
  message: string;
  backupFile: string | null;
  finishedAt: string | null;
  steps: EtapeInstallation[];
}

export interface EtatMisesAJour {
  component: string | null;
  installedVersion: string | null;
  channel: string;
  dailyCheck: boolean;
  lastCheck: string | null;
  error: string | null;
  updateAvailable: boolean;
  latestPatch: VersionDisponible | null;
  latestFeature: VersionDisponible | null;
  available: VersionDisponible[];
  olderVersions: VersionDisponible[];
  automaticInstall: boolean | null;
  installMode: string | null;
  installation: Installation | null;
}

export interface Controle {
  /** OK, INFO, AVERTISSEMENT, BLOQUANT */
  level: string;
  title: string;
  detail: string;
}

export interface Preparation {
  version: VersionDisponible;
  installedVersion: string | null;
  installable: boolean;
  checks: Controle[];
  backupRequired: boolean;
  simpleRollback: boolean;
  confirmationRequired: boolean;
}

// ---------------------------------------------------------------- settings

/** Look of every client, chosen by an ADMIN. */
export type StyleSite = 'verre' | 'panneau';

export interface Reglages {
  style: StyleSite;
}

/** Body of an error answered by the API ({"error": …} or ErrorResponse). */
export interface ApiError {
  error?: string | null;
  message?: string | null;
  status?: number;
}
