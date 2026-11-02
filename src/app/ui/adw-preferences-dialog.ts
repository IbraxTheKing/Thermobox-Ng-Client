import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  Injector,
} from '@angular/core';

import { AdwPreferencesService } from '../core/adw-preferences';
import { PreferencesPage } from '../pages/preferences/preferences';

/** How long AdwDialog takes to go (linux.css, adw-dialog-out). */
const CLOSING = 200;

/**
 * The Linux app: Préférences as an AdwPreferencesDialog of libadwaita (the preferences of
 * Fichiers, of Paramètres…). A dialog over the window, its own header bar: the search button at
 * the start, the title in the middle, the round close button at the end. The groups of the page,
 * their title above their boxed list. The search (the button, Ctrl+F, or typing) keeps the rows
 * whose title or description match, and the groups that still have one; « Aucun résultat »
 * otherwise. Escape closes the search, then the dialog.
 *
 * A link of the page (À propos, the guide) closes the dialog: what it opens is behind it.
 */
@Component({
  selector: 'tb-adw-preferences-dialog',
  imports: [PreferencesPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div
        class="tb-adw-scrim"
        [class.tb-adw-closing]="closing()"
        (pointerdown)="pressed = $event.target === $event.currentTarget"
      >
        <section
          #box
          class="tb-adw-dialog"
          [class.tb-adw-closing]="closing()"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tb-adw-prefs-title"
          tabindex="-1"
          (keydown)="key($event)"
        >
          <header class="tb-adw-head">
            <button
              type="button"
              class="tb-adw-head-btn"
              [class.tb-adw-on]="searching()"
              [attr.aria-pressed]="searching()"
              (click)="toggleSearch()"
              i18n-title
              title="Rechercher"
              i18n-aria-label
              aria-label="Rechercher"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle
                  cx="6.5"
                  cy="6.5"
                  r="4.75"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                />
                <path
                  d="M10 10l4.25 4.25"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            @if (searching()) {
              <label class="tb-adw-search">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle
                    cx="6.5"
                    cy="6.5"
                    r="4.75"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path
                    d="M10 10l4.25 4.25"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                  />
                </svg>
                <input
                  #search
                  type="search"
                  [value]="query()"
                  (input)="query.set($any($event.target).value)"
                  i18n-placeholder
                  placeholder="Rechercher les préférences"
                  i18n-aria-label
                  aria-label="Rechercher les préférences"
                />
              </label>
              <h2 id="tb-adw-prefs-title" class="tb-adw-visually-hidden">{{ title() }}</h2>
            } @else {
              <h2 id="tb-adw-prefs-title" class="tb-adw-title">{{ title() }}</h2>
            }
            <button
              type="button"
              class="tb-adw-head-btn tb-adw-close"
              (click)="close()"
              i18n-title
              title="Fermer"
              i18n-aria-label
              aria-label="Fermer"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4.5 4.5l7 7M11.5 4.5l-7 7"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>
          <div
            #body
            class="tb-adw-body"
            [class.tb-adw-searching]="query().trim() !== ''"
            (click)="bodyClick($event)"
          >
            <!-- Loaded the first time the dialog opens (the page of Préférences is a chunk of its own) -->
            @defer (on immediate) {
              <tb-preferences dialog [standalone]="dialog.standalone()" />
            }
            @if (empty()) {
              <div class="tb-adw-empty" role="status">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle
                    cx="6.5"
                    cy="6.5"
                    r="4.75"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                  <path
                    d="M10 10l4.25 4.25"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                  />
                </svg>
                <strong i18n>Aucun résultat</strong>
                <span i18n>Aucune préférence ne correspond à la recherche.</span>
              </div>
            }
          </div>
        </section>
      </div>
    }
  `,
})
export class TbAdwPreferencesDialog {
  protected readonly dialog = inject(AdwPreferencesService);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly shown = signal(false);
  protected readonly closing = signal(false);
  protected readonly searching = signal(false);
  protected readonly query = signal('');
  protected readonly empty = signal(false);
  protected pressed = false;

  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private before: HTMLElement | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  protected readonly title = () =>
    this.dialog.standalone() ? $localize`Paramètres` : $localize`Préférences`;

  constructor() {
    effect(() => {
      const open = this.dialog.open();
      untracked(() => (open ? this.opened() : this.closed()));
    });
    effect(() => {
      const q = this.query();
      if (this.shown()) untracked(() => this.filter(q));
    });
    // A click on the scrim (pressed and released on it) closes, as AdwDialog
    this.doc.addEventListener('click', (e) => {
      if (this.pressed && (e.target as Element | null)?.classList?.contains('tb-adw-scrim'))
        this.close();
      this.pressed = false;
    });
  }

  close(): void {
    this.dialog.close();
  }

  private opened(): void {
    clearTimeout(this.timer);
    if (!this.shown()) this.before = this.doc.activeElement as HTMLElement | null;
    this.closing.set(false);
    this.searching.set(false);
    this.query.set('');
    this.shown.set(true);
    this.doc.body.style.overflow = 'hidden';
    afterNextRender(() => this.box()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  private closed(): void {
    if (!this.shown()) return;
    this.closing.set(true);
    this.doc.body.style.overflow = '';
    this.timer = setTimeout(() => {
      this.shown.set(false);
      this.closing.set(false);
      if (this.before?.isConnected) this.before.focus({ preventScroll: true });
    }, CLOSING);
  }

  protected toggleSearch(): void {
    if (this.searching()) this.stopSearch();
    else this.startSearch('');
  }

  private startSearch(text: string): void {
    this.searching.set(true);
    this.query.set(text);
    afterNextRender(
      () => {
        const input = this.search()?.nativeElement;
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      },
      { injector: this.injector },
    );
  }

  private stopSearch(): void {
    this.searching.set(false);
    this.query.set('');
    this.box()?.nativeElement.focus({ preventScroll: true });
  }

  protected key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (this.searching()) this.stopSearch();
      else this.close();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.startSearch(this.query());
      return;
    }
    // Typing starts the search (type-to-search of GTK), not in a field nor on a control; the
    // keys typed before the entry has the focus go into it
    const t = e.target as HTMLElement;
    const typed = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (this.searching() && typed && !t.closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      this.startSearch(this.query() + e.key);
      e.stopPropagation();
      return;
    }
    if (
      !this.searching() &&
      e.key.length === 1 &&
      e.key !== ' ' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !t.closest('input, textarea, select, [contenteditable]')
    ) {
      e.preventDefault();
      this.startSearch(e.key);
    }
    // The shortcuts of the app don't run under the dialog
    e.stopPropagation();
  }

  protected bodyClick(e: MouseEvent): void {
    if ((e.target as Element).closest('a.tb-pref-link, a[href]')) this.close();
  }

  /** The rows whose title or description match, and the groups that still have one. */
  private filter(q: string): void {
    const body = this.body()?.nativeElement;
    if (!body) return;
    const words = fold(q).split(/\s+/).filter(Boolean);
    let any = false;
    for (const group of body.querySelectorAll<HTMLElement>('.tb-pref-group')) {
      let inGroup = false;
      for (const row of group.querySelectorAll<HTMLElement>('.tb-pref')) {
        const text = fold(row.querySelector('.tb-pref-text')?.textContent ?? row.textContent ?? '');
        const match = words.every((w) => text.includes(w));
        row.classList.toggle('tb-adw-hidden', !match);
        inGroup ||= match;
      }
      group.classList.toggle('tb-adw-hidden', !inGroup);
      any ||= inGroup;
    }
    this.empty.set(words.length > 0 && !any);
  }
}

/** Lower case, without accents: « thème » is found by « theme ». */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
