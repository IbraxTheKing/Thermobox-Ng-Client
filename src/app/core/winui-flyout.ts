import type { MenuEntry } from './context-menu';

/**
 * Windows: the menus of the app as the MenuFlyout of WinUI 3 (the menus of the apps of Windows 11:
 * Photos, Apple Music, the Explorer…), drawn by the page: Acrylic, corners of 8 px, rows of 32 px
 * with their shortcut on the right, a tick in front of a ticked line, the line under the pointer
 * or the keyboard in the grey of WinUI. The menus of Win32 that Tauri opens are the old ones of
 * Windows (squared, grey, no Acrylic).
 *
 * Opens from where it was asked (the pointer, or under a list), slides in from that side, stays
 * in the window. Keyboard: ↑ ↓ Home End, the first letter of a line, Enter or Space, Escape gives
 * the focus back. Closes on a click outside, a scroll, the window left or resized.
 *
 * As a ComboBox ([combo]): the lines of a drop-down list, the chosen one over the list itself and
 * marked by the accent bar of WinUI, at least as wide as the list.
 */

export interface FlyoutOptions {
  /** A drop-down list: its box on the screen (the menu opens over it, its choice under it). */
  combo?: DOMRect;
}

let open: { root: HTMLElement; close: (focus: boolean) => void } | null = null;

export function closeFlyout(): void {
  open?.close(false);
}

export function openFlyout(entries: MenuEntry[], x: number, y: number, options: FlyoutOptions = {}): void {
  closeFlyout();
  const doc = document;
  const before = doc.activeElement as HTMLElement | null;
  const combo = options.combo ?? null;
  const ticks = !combo && entries.some((e) => !('separator' in e) && e.checked != null);

  const root = doc.createElement('div');
  root.className = 'tb-flyout' + (combo ? ' tb-flyout-combo' : '') + (ticks ? ' tb-flyout-ticks' : '');
  root.setAttribute('role', combo ? 'listbox' : 'menu');
  root.tabIndex = -1;
  const items: HTMLElement[] = [];
  let chosen: HTMLElement | null = null;
  for (const e of entries) {
    if ('separator' in e) {
      const line = doc.createElement('div');
      line.className = 'tb-flyout-separator';
      line.setAttribute('role', 'separator');
      root.append(line);
      continue;
    }
    const item = doc.createElement('div');
    item.className = 'tb-flyout-item';
    item.tabIndex = -1;
    if (combo) {
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(!!e.checked));
      if (e.checked) chosen = item;
    } else {
      item.setAttribute('role', e.checked != null ? 'menuitemcheckbox' : 'menuitem');
      if (e.checked != null) item.setAttribute('aria-checked', String(e.checked));
    }
    if (e.disabled) item.setAttribute('aria-disabled', 'true');
    if (ticks) {
      const tick = doc.createElement('span');
      tick.className = 'tb-flyout-tick';
      tick.textContent = e.checked ? '' : '';
      item.append(tick);
    }
    const label = doc.createElement('span');
    label.className = 'tb-flyout-label';
    label.textContent = e.label;
    item.append(label);
    if (e.shortcut && !combo) {
      const key = doc.createElement('span');
      key.className = 'tb-flyout-key';
      key.textContent = e.shortcut;
      item.append(key);
    }
    if (!e.disabled) {
      item.addEventListener('click', () => {
        close(true);
        void e.action();
      });
      item.addEventListener('pointermove', () => item !== doc.activeElement && item.focus({ preventScroll: true }));
      items.push(item);
    }
    root.append(item);
  }
  // The pointer on the menu does not take the focus from the field it acts on (Couper, Coller…)
  root.addEventListener('mousedown', (e) => e.preventDefault());
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('pointerleave', () => root.focus({ preventScroll: true }));
  doc.body.append(root);

  // Where it goes: in the window, under the title bar
  const top0 = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--tb-chrome-top')) || 0;
  const margin = 8;
  const maxH = innerHeight - top0 - 2 * margin;
  root.style.maxHeight = `${maxH}px`;
  if (combo) root.style.minWidth = `${combo.width + 8}px`;
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  let left: number;
  let top: number;
  let fromAbove = true;
  if (combo) {
    // The chosen line over the list, its text where the text of the list was
    left = combo.left - 4;
    top = chosen ? combo.top + combo.height / 2 - (chosen.offsetTop + chosen.offsetHeight / 2) : combo.bottom + 2;
  } else {
    left = x + w > innerWidth - margin ? x - w : x;
    if (y + h > innerHeight - margin && y - h >= top0 + margin) {
      top = y - h;
      fromAbove = false;
    } else top = y;
  }
  left = Math.min(Math.max(left, margin), innerWidth - margin - w);
  top = Math.min(Math.max(top, top0 + margin), innerHeight - margin - h);
  root.style.left = `${Math.round(left)}px`;
  root.style.top = `${Math.round(top)}px`;
  root.classList.add(combo ? 'tb-flyout-open-combo' : fromAbove ? 'tb-flyout-open-down' : 'tb-flyout-open-up');
  if (chosen && combo) {
    chosen.scrollIntoView({ block: 'nearest' });
    root.style.transformOrigin = `50% ${chosen.offsetTop - root.scrollTop + chosen.offsetHeight / 2}px`;
  }

  const focusItem = (i: number) => {
    if (!items.length) return;
    items[(i + items.length) % items.length].focus({ preventScroll: false });
  };
  // Keyboard opened (or a list): the first line, or the chosen one, has the focus; by the
  // pointer, the menu itself (no line lit before the pointer comes on one)
  if (chosen && items.includes(chosen)) chosen.focus({ preventScroll: true });
  else root.focus({ preventScroll: true });

  const onKey = (e: KeyboardEvent) => {
    const i = items.indexOf(doc.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown':
        focusItem(i < 0 ? 0 : i + 1);
        break;
      case 'ArrowUp':
        focusItem(i < 0 ? items.length - 1 : i - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (i >= 0) items[i].click();
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        close(true);
        break;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
        const k = e.key.toLocaleLowerCase();
        const n = items.length;
        for (let j = 1; j <= n; j++) {
          const item = items[(Math.max(i, -1) + j) % n];
          if (item.textContent?.trim().toLocaleLowerCase().startsWith(k)) {
            item.focus();
            break;
          }
        }
      }
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const onOutside = (e: Event) => {
    if (!root.contains(e.target as Node)) close(false);
  };
  const onLeave = () => close(false);
  const onScroll = (e: Event) => {
    if (!root.contains(e.target as Node)) close(false);
  };

  function close(giveFocus: boolean): void {
    if (open?.root !== root) return;
    open = null;
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onOutside, true);
    doc.removeEventListener('scroll', onScroll, true);
    removeEventListener('blur', onLeave);
    removeEventListener('resize', onLeave);
    if (giveFocus && before?.isConnected) before.focus({ preventScroll: true });
    // It fades out quickly, as WinUI's (the command has already run)
    root.classList.add('tb-flyout-closing');
    root.style.pointerEvents = 'none';
    setTimeout(() => root.remove(), 90);
  }

  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('scroll', onScroll, true);
  addEventListener('blur', onLeave);
  addEventListener('resize', onLeave);
  // Not the pointerdown that opened it (a list opens on its mousedown)
  setTimeout(() => open?.root === root && doc.addEventListener('pointerdown', onOutside, true));
  open = { root, close };
}
