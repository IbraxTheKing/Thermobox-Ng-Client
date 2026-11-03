import { Directive, input } from '@angular/core';

/**
 * One line of a context menu: a command, a check, or a separator. [shortcut]: the keys that do
 * the same, shown on the right ("CmdOrCtrl+C", "Delete": as Tauri writes them).
 */
export type MenuEntry =
  | { label: string; action: () => unknown; disabled?: boolean; checked?: boolean; shortcut?: string }
  | { separator: true };

export const SEPARATOR: MenuEntry = { separator: true };

/** The lines of a menu; null / false / undefined lines are left out (conditions written inline). */
export type MenuList = (MenuEntry | null | false | undefined | 0)[];

/**
 * Who draws the menus of the page. The desktop apps (platforms/desktop/menus.ts): native menus
 * of the system (macOS, Linux), the MenuFlyout of WinUI 3 (platforms/windows/). None on the web
 * and in the mobile apps: the browser keeps its own menu.
 */
export interface MenuHost {
  /** A menu at [x, y] (CSS pixels of the window), or where the pointer last went down. */
  show(entries: MenuEntry[], x?: number, y?: number): void | Promise<void>;
}

let host: MenuHost | null = null;

/** The platform's menus (before Angular starts). */
export function setMenuHost(h: MenuHost): void {
  host = h;
}

/** Menus of the system here (the desktop apps): a page may use one rather than a list of its own. */
export function hasMenus(): boolean {
  return host != null;
}

/** A menu of the system, at the pointer or at [x, y]. Elsewhere nothing. */
export async function showMenu(entries: MenuList, x?: number, y?: number): Promise<void> {
  if (!host) return;
  const list = tidy(entries);
  if (!list.length) return;
  await host.show(list, x, y);
}

/** No separator at the ends nor two in a row; null / false lines dropped. */
export function tidy(entries: MenuList): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (!e) continue;
    if ('separator' in e && (!out.length || 'separator' in out[out.length - 1])) continue;
    out.push(e);
  }
  while (out.length && 'separator' in out[out.length - 1]) out.pop();
  return out;
}

/**
 * `[tbContextMenu]="menuOf(x)"` on an element: in the desktop apps, its right click (or the menu
 * key) opens these commands in a native menu of the system. A function is called at the moment
 * of the click (the menu reflects the state then). On the web, the browser's menu.
 */
@Directive({
  selector: '[tbContextMenu]',
  host: { '(contextmenu)': 'open($event)' },
})
export class TbContextMenu {
  readonly tbContextMenu = input<MenuList | (() => MenuList) | null>(null);

  protected open(e: MouseEvent): void {
    if (!host || e.defaultPrevented) return;
    const v = this.tbContextMenu();
    const entries = typeof v === 'function' ? v() : v;
    if (!entries?.some(Boolean)) return;
    e.preventDefault();
    // Keyboard (menu key, Shift+F10): under the element rather than at a pointer that is elsewhere
    const at = e.button === 0 && e.clientX === 0 && e.clientY === 0 ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null;
    void showMenu(entries, at ? at.left + 8 : e.clientX, at ? at.top + Math.min(at.height, 32) : e.clientY);
  }
}
