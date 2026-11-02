import { Directive, input } from '@angular/core';

import { TAURI } from './tauri';

/** One line of a context menu: a command, a check, or a separator. */
export type MenuEntry =
  | { label: string; action: () => unknown; disabled?: boolean; checked?: boolean }
  | { separator: true };

export const SEPARATOR: MenuEntry = { separator: true };

/** The lines of a menu; null / false / undefined lines are left out (conditions written inline). */
export type MenuList = (MenuEntry | null | false | undefined | 0)[];

/**
 * Desktop apps: a native menu of the system (Tauri), at the pointer or at [x, y] (CSS pixels of
 * the window). Elsewhere nothing: the web keeps the menu of the browser.
 */
export async function showMenu(entries: MenuList, x?: number, y?: number): Promise<void> {
  if (!TAURI) return;
  const list = tidy(entries);
  if (!list.length) return;
  const { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const { LogicalPosition } = await import('@tauri-apps/api/dpi');
  const items = await Promise.all(
    list.map((e) => {
      if ('separator' in e) return PredefinedMenuItem.new({ item: 'Separator' });
      if (e.checked != null) return CheckMenuItem.new({ text: e.label, checked: e.checked, enabled: !e.disabled, action: () => void e.action() });
      return MenuItem.new({ text: e.label, enabled: !e.disabled, action: () => void e.action() });
    }),
  );
  const menu = await Menu.new({ items });
  await menu.popup(x != null && y != null ? new LogicalPosition(x, y) : undefined);
}

/** No separator at the ends nor two in a row; null / false lines dropped. */
function tidy(entries: MenuList): MenuEntry[] {
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
    if (!TAURI || e.defaultPrevented) return;
    const v = this.tbContextMenu();
    const entries = typeof v === 'function' ? v() : v;
    if (!entries?.some(Boolean)) return;
    e.preventDefault();
    // Keyboard (menu key, Shift+F10): under the element rather than at a pointer that is elsewhere
    const at = e.button === 0 && e.clientX === 0 && e.clientY === 0 ? (e.currentTarget as HTMLElement).getBoundingClientRect() : null;
    void showMenu(entries, at ? at.left + 8 : e.clientX, at ? at.top + Math.min(at.height, 32) : e.clientY);
  }
}

/**
 * Desktop apps, everywhere else: no menu of the webview (Reload, Inspect…). A text field gets the
 * native Cut / Copy / Paste / Select all, a selected text Copy.
 */
export function desktopContextMenus(doc: Document): void {
  if (!TAURI) return;
  doc.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    const editable =
      !!target?.closest('textarea, [contenteditable=""], [contenteditable="true"]') ||
      (target instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(target.type));
    const selected = !!doc.getSelection()?.toString();
    if (!editable && !selected) return;
    void (async () => {
      const { Menu, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      const items = editable
        ? await Promise.all([
            PredefinedMenuItem.new({ item: 'Cut', text: $localize`Couper` }),
            PredefinedMenuItem.new({ item: 'Copy', text: $localize`Copier` }),
            PredefinedMenuItem.new({ item: 'Paste', text: $localize`Coller` }),
            PredefinedMenuItem.new({ item: 'Separator' }),
            PredefinedMenuItem.new({ item: 'SelectAll', text: $localize`Tout sélectionner` }),
          ])
        : [await PredefinedMenuItem.new({ item: 'Copy', text: $localize`Copier` })];
      const menu = await Menu.new({ items });
      await menu.popup();
    })();
  });
}

/**
 * Desktop apps: the drop-down lists (<select>) open a native menu of the system, under the list,
 * the option chosen ticked. Choosing one sets the list and tells the page (input, change), as
 * the browser's own list does. Opened by a click, or Space / Enter / Alt+↓ / F4 when it has the
 * focus; the arrows still change the option without opening it.
 */
export function nativeSelects(doc: Document): void {
  if (!TAURI) return;
  const open = (select: HTMLSelectElement) => {
    const r = select.getBoundingClientRect();
    const entries: MenuEntry[] = [];
    for (const child of Array.from(select.children)) {
      if (child instanceof HTMLOptGroupElement) {
        entries.push(SEPARATOR, { label: child.label, action: () => undefined, disabled: true });
        for (const o of Array.from(child.children)) if (o instanceof HTMLOptionElement) entries.push(option(select, o));
      } else if (child instanceof HTMLOptionElement && !child.hidden) {
        entries.push(option(select, child));
      }
    }
    select.focus();
    void showMenu(entries, r.left, r.bottom + 2);
  };
  const option = (select: HTMLSelectElement, o: HTMLOptionElement): MenuEntry => ({
    label: o.label || o.text,
    checked: o.selected,
    disabled: o.disabled,
    action: () => {
      if (select.value === o.value && o.selected) return;
      o.selected = true;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
  const single = (t: EventTarget | null): HTMLSelectElement | null =>
    t instanceof HTMLSelectElement && !t.multiple && !t.disabled && t.size <= 1 ? t : null;
  doc.addEventListener(
    'mousedown',
    (e) => {
      const s = single(e.target);
      if (!s || e.button !== 0) return;
      e.preventDefault();
      open(s);
    },
    true,
  );
  doc.addEventListener(
    'keydown',
    (e) => {
      const s = single(e.target);
      if (!s) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        open(s);
      }
    },
    true,
  );
}
