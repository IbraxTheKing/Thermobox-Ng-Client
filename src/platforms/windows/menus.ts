import { MenuEntry, SEPARATOR, showMenu, tidy } from '../../app/core/context-menu';
import { DesktopMenus } from '../desktop/menus';
import { openFlyout } from './flyout';

/** Where the pointer last went down: a menu asked without a place opens there. */
const pointer = { x: 0, y: 0 };

/**
 * Windows: the menus are drawn by the page as the MenuFlyout of WinUI 3 (flyout.ts), the lists
 * of the drop-down lists as the one of a ComboBox, over the list.
 */
export const winuiMenus: DesktopMenus = {
  show(list, x, y) {
    openFlyout(
      list.map((e) => ('separator' in e || !e.shortcut ? e : { ...e, shortcut: keys(e.shortcut) })),
      x ?? pointer.x,
      y ?? pointer.y,
    );
  },
  edit(target, editable, x, y) {
    void editMenu(target, editable, x, y);
  },
  list(entries: MenuEntry[], r: DOMRect) {
    // A ComboBox of WinUI: the lines over the list, the chosen one over its text
    openFlyout(tidy(entries), r.left, r.bottom, { combo: r });
  },
};

/** Follows the pointer for the menus asked without a place. */
export function trackPointer(): void {
  addEventListener('pointerdown', (e) => ((pointer.x = e.clientX), (pointer.y = e.clientY)), true);
}

/** "CmdOrCtrl+C" → "Ctrl+C", "Delete" → "Suppr" (the names of the keys on Windows). */
function keys(shortcut: string): string {
  return shortcut
    .split('+')
    .map((k) => (k === 'CmdOrCtrl' || k === 'CommandOrControl' ? 'Ctrl' : k === 'Delete' ? $localize`Suppr` : k))
    .join('+');
}

/**
 * Couper / Copier / Coller / Tout sélectionner of a text field (or Copier of a text selected), in
 * the flyout of WinUI. The page does the commands itself (execCommand); the text to paste comes
 * from Rust (clipboard_text: WebView2 keeps the clipboard from the page), inserted as typed (it
 * can be undone, the field hears it).
 */
async function editMenu(target: HTMLElement, editable: boolean, x: number, y: number): Promise<void> {
  const doc = target.ownerDocument;
  if (!editable) {
    void showMenu([{ label: $localize`Copier`, shortcut: 'CmdOrCtrl+C', action: () => doc.execCommand('copy') }], x, y);
    return;
  }
  const field = (target.closest('textarea, [contenteditable=""], [contenteditable="true"]') as HTMLElement | null) ?? target;
  const input = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field : null;
  const readOnly = input ? input.readOnly || input.disabled : false;
  const hasSelection = input ? (input.selectionStart ?? 0) !== (input.selectionEnd ?? 0) && input.type !== 'password' : !!doc.getSelection()?.toString();
  const { invoke } = await import('@tauri-apps/api/core');
  const clipboard = readOnly ? null : await invoke<string | null>('clipboard_text').catch(() => null);
  const act = (command: () => void) => () => {
    field.focus({ preventScroll: true });
    command();
  };
  void showMenu(
    [
      { label: $localize`Couper`, shortcut: 'CmdOrCtrl+X', disabled: readOnly || !hasSelection, action: act(() => doc.execCommand('cut')) },
      { label: $localize`Copier`, shortcut: 'CmdOrCtrl+C', disabled: !hasSelection, action: act(() => doc.execCommand('copy')) },
      { label: $localize`Coller`, shortcut: 'CmdOrCtrl+V', disabled: readOnly || !clipboard, action: act(() => doc.execCommand('insertText', false, clipboard ?? '')) },
      SEPARATOR,
      { label: $localize`Tout sélectionner`, shortcut: 'CmdOrCtrl+A', action: act(() => (input ? input.select() : doc.execCommand('selectAll'))) },
    ],
    x,
    y,
  );
}
