/** Where a room stands against its setpoint; `ton` picks the colours (CSS class tb-tone-…). */
export interface RoomState {
  readonly key: 'STABLE' | 'HEATING' | 'TOO_HOT' | 'UNKNOWN';
  readonly label: string;
  readonly tone: 'stable' | 'heating' | 'hot' | 'unknown';
  readonly singular: string;
  readonly plural: string;
}

export const STATES = {
  STABLE: { key: 'STABLE', label: 'Stable', tone: 'stable', singular: 'stable', plural: 'stables' },
  HEATING: { key: 'HEATING', label: 'En chauffe', tone: 'heating', singular: 'en chauffe', plural: 'en chauffe' },
  TOO_HOT: { key: 'TOO_HOT', label: 'Trop chaud', tone: 'hot', singular: 'trop chaude', plural: 'trop chaudes' },
  UNKNOWN: { key: 'UNKNOWN', label: 'Pas de données', tone: 'unknown', singular: 'sans données', plural: 'sans données' },
} as const satisfies Record<string, RoomState>;

/** In this order on the dashboard chips. */
export const STATE_ORDER: RoomState[] = [STATES.STABLE, STATES.HEATING, STATES.TOO_HOT, STATES.UNKNOWN];

/** Within half a degree of the setpoint counts as reached. */
export const TARGET_THRESHOLD = 0.5;

export function stateOf(average: number | null | undefined, setpoint: number | null | undefined): RoomState {
  if (average == null || setpoint == null) return STATES.UNKNOWN;
  const delta = average - setpoint;
  if (delta <= -TARGET_THRESHOLD) return STATES.HEATING;
  if (delta >= TARGET_THRESHOLD) return STATES.TOO_HOT;
  return STATES.STABLE;
}

/** « 3 trop chaudes » */
export function countLabel(state: RoomState, n: number): string {
  return `${n} ${n > 1 ? state.plural : state.singular}`;
}

/** Off the setpoint: what the « À traiter » / « Loin de la consigne » counters count. */
export function offSetpoint(state: RoomState): boolean {
  return state === STATES.HEATING || state === STATES.TOO_HOT;
}
