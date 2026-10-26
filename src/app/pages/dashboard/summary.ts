import { Sparkline } from '../../core/curves';
import { RoomState } from '../../core/state';
import { Node } from '../../models/models';

/** A dashboard card: a room and the average of its boxes (RoomSummary of the JSF interface). */
export interface RoomSummary {
  room: Node;
  /** « Bâtiment A › Étage 1 » */
  path: string;
  building: Node | null;
  state: RoomState;
  /** Moyenne − consigne, Celsius. */
  delta: number | null;
  trend: Sparkline | null | undefined;
}
