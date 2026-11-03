import { MenuEntry, MenuHost, SEPARATOR, setMenuHost, showMenu } from '../../app/core/context-menu';

/**
 * The menus of a desktop app: the context menus of the page (TbContextMenu, showMenu), the menu
 * of the text fields and of a text selected, the lists of the drop-down lists. Native menus of
 * the system on macOS and Linux (tauriMenus, here); the MenuFlyout of WinUI 3 on Windows
 * (platforms/windows/menus.ts).
 */
export interface DesktopMenus extends MenuHost {
  /** Couper / Copier / Coller / Tout sélectionner of a text field, or Copier of a text selected. */
  edit(target: HTMLElement, editable: boolean, x: number, y: number): void;
  /** The options of a drop-down list ([r]: where the list is), the one chosen ticked. */
  list(entries: MenuEntry[], r: DOMRect): void;
}

/** macOS and Linux: menus of the system (Tauri). */
export const tauriMenus: DesktopMenus = {
  async show(list, x, y) {
    const { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
    const { LogicalPosition } = await import('@tauri-apps/api/dpi');
    const items = await Promise.all(
      list.map((e) => {
        if ('separator' in e) return PredefinedMenuItem.new({ item: 'Separator' });
        const common = { text: e.label, enabled: !e.disabled, accelerator: e.shortcut, action: () => void e.action() };
        if (e.checked != null) return CheckMenuItem.new({ ...common, checked: e.checked });
        return MenuItem.new(common);
      }),
    );
    const menu = await Menu.new({ items });
    await menu.popup(x != null && y != null ? new LogicalPosition(x, y) : undefined);
  },
  edit(_target, editable) {
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
  },
  list(entries, r) {
    void showMenu(entries, r.left, r.bottom + 2);
  },
};

/** The menus of the platform for the whole page (prepare of the desktop targets). */
export function installMenus(doc: Document, menus: DesktopMenus): void {
  setMenuHost(menus);
  contextMenus(doc, menus);
  nativeSelects(doc, menus);
}

/**
 * Everywhere else in the page: no menu of the webview (Reload, Inspect…). A text field gets the
 * native Cut / Copy / Paste / Select all, a selected text Copy.
 */
function contextMenus(doc: Document, menus: DesktopMenus): void {
  doc.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    const editable =
      !!target?.closest('textarea, [contenteditable=""], [contenteditable="true"]') ||
      (target instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(target.type));
    const selected = !!doc.getSelection()?.toString();
    if (!editable && !selected) return;
    menus.edit(target!, editable, e.clientX, e.clientY);
  });
}

/**
 * The drop-down lists (<select>) open a menu of the system, under the list, the option chosen
 * ticked. Choosing one sets the list and tells the page (input, change), as the browser's own
 * list does. Opened by a click, or Space / Enter / Alt+↓ / F4 when it has the focus; the arrows
 * still change the option without opening it.
 */
function nativeSelects(doc: Document, menus: DesktopMenus): void {
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
    menus.list(entries, r);
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
