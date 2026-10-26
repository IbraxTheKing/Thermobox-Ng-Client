import { firstValueFrom } from 'rxjs';

import { time } from '../../core/dates';
import { TemperatureType } from '../../models/models';
import { TemperatureService, TemperatureTyped } from '../../services/temperature.service';

/** Temperatures read from the server at a time, per type. */
const CHUNK = 100;

interface Feed {
  type: TemperatureType;
  items: TemperatureTyped[];
  done: boolean;
  total: number | null;
}

/**
 * The raw history (every measurement and setpoint), the latest first, read a little at a time:
 * there can be millions. With both types, the two lists are merged by date as they are read; a
 * page is certain once no list still to read could hold something newer than its last line.
 * A server before 26.12 sends a whole list at once: it is then sorted here.
 */
export class RawFeed {
  private readonly feeds: Feed[];

  constructor(
    private readonly api: TemperatureService,
    types: TemperatureType[],
  ) {
    this.feeds = types.map((type) => ({ type, items: [], done: false, total: null }));
  }

  /** How many there are in all, when the server said (null otherwise). */
  get total(): number | null {
    let n = 0;
    for (const f of this.feeds) {
      if (f.done) n += f.items.length;
      else if (f.total != null) n += f.total;
      else return null;
    }
    return n;
  }

  /** Lines [from, from + count), and whether more follow. */
  async slice(from: number, count: number): Promise<{ items: TemperatureTyped[]; more: boolean }> {
    for (;;) {
      const { merged, certain } = this.merged();
      if (certain >= from + count || this.feeds.every((f) => f.done)) {
        return { items: merged.slice(from, from + count), more: certain > from + count || merged.length > from + count || this.feeds.some((f) => !f.done) };
      }
      await this.readMore();
    }
  }

  private merged(): { merged: TemperatureTyped[]; certain: number } {
    const merged = this.feeds.flatMap((f) => f.items).sort((a, b) => time(b.date) - time(a.date));
    // Lines older than what a list still being read has reached may yet have newer ones above them
    let frontier = -Infinity;
    for (const f of this.feeds) {
      if (f.done) continue;
      frontier = Math.max(frontier, f.items.length ? time(f.items[f.items.length - 1].date) : Infinity);
    }
    const certain = frontier === -Infinity ? merged.length : merged.filter((t) => time(t.date) >= frontier).length;
    return { merged, certain };
  }

  /** The next part of the list that holds the others back (the one read least far). */
  private async readMore(): Promise<void> {
    const open = this.feeds.filter((f) => !f.done);
    const f = open.reduce((a, b) => (frontierOf(b) > frontierOf(a) ? b : a));
    const r = await firstValueFrom(this.api.page(f.type, f.items.length, CHUNK));
    const typed = r.items.map((t) => ({ ...t, type: f.type }));
    if (r.all) {
      // Before 26.12: everything at once, in no particular order
      f.items = typed.sort((a, b) => time(b.date) - time(a.date));
      f.done = true;
      return;
    }
    if (f.items.length === 0 && r.total != null) f.total = r.total;
    f.items.push(...typed);
    if (r.items.length < CHUNK) f.done = true;
  }
}

function frontierOf(f: Feed): number {
  return f.items.length ? time(f.items[f.items.length - 1].date) : Infinity;
}
