import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, effect, inject, signal } from '@angular/core';

/** A tab: a group of Préférences (its section, its heading). */
interface Tab {
  /** The id of the heading of its section (tb-pref-look…). */
  id: string;
  label: string;
  icon: string;
}

/** The symbols of the groups, as the settings windows of the system (SF Symbols' meaning). */
const ICONS: Record<string, string> = {
  'tb-pref-look': 'pi-palette',
  'tb-pref-tools': 'pi-wrench',
  'tb-pref-notify': 'pi-bell',
  'tb-pref-misc': 'pi-sliders-h',
};
const KEY = 'tb-mac-settings-tab';

/**
 * The settings window of macOS as those of the system (Safari, Mail, Finder): in the toolbar, the
 * name of the tab over a row of tabs, an icon over a label; one group of Préférences at a time
 * (html[data-settings-tab], macos.css), the window as tall as it (settings_height, main.rs: its
 * top edge stays, the height animated by AppKit). The tabs are the groups the page has
 * (Notifications only where it is offered), the one shown kept for the next time.
 */
@Component({
  selector: 'tb-mac-settings-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-mac-settings', 'data-tauri-drag-region': 'deep' },
  template: `
    <span class="tb-mac-settings-title" data-tauri-drag-region>{{ current()?.label ?? defaultTitle }}</span>
    <div class="tb-mac-tabs" role="tablist" data-tauri-drag-region="deep">
      @for (t of tabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="tb-mac-tab"
          tabindex="-1"
          [class.tb-mac-tab-on]="t.id === current()?.id"
          [attr.aria-selected]="t.id === current()?.id"
          [attr.aria-controls]="t.id"
          (click)="select(t.id)"
        >
          <i class="pi {{ t.icon }}" aria-hidden="true"></i>
          <span>{{ t.label }}</span>
        </button>
      }
    </div>
  `,
})
export class TbMacSettingsTabs {
  private readonly doc = inject(DOCUMENT);
  protected readonly defaultTitle = $localize`Réglages`;
  protected readonly tabs = signal<Tab[]>([]);
  private readonly selected = signal<string | null>(read());
  protected readonly current = computed<Tab | null>(() => this.tabs().find((t) => t.id === this.selected()) ?? this.tabs()[0] ?? null);

  constructor() {
    const root = this.doc.documentElement;
    // The groups of the page, once it is there (and when one comes or goes: Notifications)
    const scan = () => {
      // A group without settings of its own here (« Divers »: its links are the app's) is no tab:
      // what it says stays under every tab
      const groups = [...this.doc.querySelectorAll<HTMLElement>('.tb-pref-group[aria-labelledby]')].filter((s) => s.querySelector('.tb-pref'));
      const tabs = groups.map((s) => {
        const id = s.getAttribute('aria-labelledby') ?? '';
        return { id, label: this.doc.getElementById(id)?.textContent?.trim() ?? id, icon: ICONS[id] ?? 'pi-cog' };
      });
      if (tabs.map((t) => t.id + t.label).join() !== this.tabs().map((t) => t.id + t.label).join()) this.tabs.set(tabs);
      this.show();
    };
    const groups = new MutationObserver(scan);
    groups.observe(this.doc.body, { childList: true, subtree: true });
    scan();

    effect(() => {
      const tab = this.current();
      if (tab) root.dataset['settingsTab'] = tab.id;
      else delete root.dataset['settingsTab'];
      this.show();
      // The window menu and Mission Control show the name of the tab, as the system's
      const title = tab?.label ?? this.defaultTitle;
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => undefined);
      requestAnimationFrame(() => this.fit());
    });

    // The window follows the height of the tab (a row that opens, a group that comes)
    let frame = 0;
    const sizes = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.fit());
    });
    const watch = () => {
      const page = this.doc.querySelector('.tb-main .tb-narrow');
      if (page) sizes.observe(page);
    };
    watch();
    const late = new MutationObserver(watch);
    late.observe(this.doc.body, { childList: true, subtree: true });

    // ⌘1, ⌘2…: the tabs, in order
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      const n = Number(e.key);
      const tab = Number.isInteger(n) && n > 0 ? this.tabs()[n - 1] : undefined;
      if (tab) {
        e.preventDefault();
        this.select(tab.id);
      }
    };
    addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => {
      groups.disconnect();
      late.disconnect();
      sizes.disconnect();
      removeEventListener('keydown', onKey);
      delete root.dataset['settingsTab'];
    });
  }

  protected select(id: string): void {
    this.selected.set(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* kept for this window */
    }
    scrollTo({ top: 0 });
  }

  /** The group of the tab shown (macos.css hides the others). */
  private show(): void {
    const id = this.current()?.id;
    for (const s of this.doc.querySelectorAll<HTMLElement>('.tb-pref-group[aria-labelledby]')) {
      s.classList.toggle('tb-mac-tab-shown', s.getAttribute('aria-labelledby') === id || !s.querySelector('.tb-pref'));
    }
  }

  /** The window as tall as the toolbar and the tab shown. */
  private fit(): void {
    const page = this.doc.querySelector('.tb-main .tb-narrow');
    if (!page || !this.current()) return;
    const height = Math.ceil(page.getBoundingClientRect().bottom + scrollY + 20);
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('settings_height', { height }).catch(() => undefined));
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
