import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { PreferencesService } from './preferences';

export interface Shortcut {
  group: string;
  keys: string[];
  text: string;
  key: string | RegExp | null;
  when?: () => boolean;
  act?: (e: KeyboardEvent) => boolean;
}

/**
 * Keyboard shortcuts on a computer (tbClavier of the JSF interface), the only place they are
 * defined: the Preferences page and the "?" panel list them from here.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);

  /** The "?" panel is open. */
  readonly help = signal(false);

  readonly shortcuts: Shortcut[] = [
    { group: 'Partout', keys: ['1', '…', '6'], text: 'Ouvrir la 1ʳᵉ à la 6ᵉ entrée du menu (Aperçu, Salles, Mesures…)', key: /^[1-6]$/, act: (e) => this.destination(+e.key) },
    { group: 'Partout', keys: ['/'], text: 'Aller au champ de recherche de la page', key: '/', act: () => this.search() },
    { group: 'Partout', keys: ['R'], text: 'Actualiser les données de la page', key: 'r', act: () => this.click('.tb-page-head [data-action="actualiser"]') },
    { group: 'Partout', keys: ['N'], text: 'Action principale de la page (nouvel élément, nouvel utilisateur…)', key: 'n', act: () => this.click('.tb-page-head .tb-fab') },
    { group: 'Partout', keys: ['T'], text: 'Passer du thème clair au thème sombre', key: 't', act: () => (this.prefs.changeTheme(this.prefs.theme() === 'dark' ? 'light' : 'dark'), true) },
    { group: 'Partout', keys: ['P'], text: 'Ouvrir les Préférences', key: 'p', act: () => this.forward('/app/preferences') },
    { group: 'Partout', keys: ['?'], text: 'Afficher ou cacher cette liste', key: '?', act: () => (this.help.update((v) => !v), true) },
    { group: 'Partout', keys: ['Échap'], text: 'Fermer cette liste', key: null },
    { group: "Page d'une salle", keys: ['Espace'], text: "Revenir à l'aperçu", key: ' ', when: () => this.page('/app/room/'), act: () => this.back() },
    { group: "Page d'une salle", keys: ['Retour arrière'], text: "Revenir à l'aperçu (comme Espace)", key: 'Backspace', when: () => this.page('/app/room/'), act: () => this.back() },
    { group: "Page d'une salle", keys: ['F'], text: 'Ajouter aux favoris ou en retirer', key: 'f', when: () => this.page('/app/room/'), act: () => this.click('.tb-page-head .tb-fav') },
    {
      group: 'Aperçu',
      keys: ['F'],
      text: 'Replier ou déplier toutes les sections sauf les favoris',
      key: 'f',
      when: () => this.page('/app/overview'),
      act: () => {
        const sections = this.doc.querySelectorAll<HTMLElement>('.tb-section[data-section]:not([data-section="favoris"]) .tb-section-toggle');
        sections.forEach((b) => b.click());
        return sections.length > 0;
      },
    },
  ];

  constructor() {
    this.doc.addEventListener('keydown', (e) => this.key(e));
  }

  /** The list, by group. */
  groups(): { group: string; shortcuts: Shortcut[] }[] {
    const m = new Map<string, Shortcut[]>();
    for (const r of this.shortcuts) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()].map(([group, shortcuts]) => ({ group, shortcuts }));
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.help()) {
      this.help.set(false);
      e.preventDefault();
      return;
    }
    if (!this.prefs.keyboard() || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || this.typing(e.target)) return;
    if (!this.router.url.startsWith('/app')) return;
    // A dialog of the page is open: only "?"
    const dialog = this.doc.querySelector('.tb-dialog');
    const target = e.target as HTMLElement | null;
    // A focused button or link keeps Space / Enter for itself
    if (e.key === ' ' && target?.closest?.('a, button, [role=button], [tabindex]:not(body):not(section)')) return;
    for (const r of this.shortcuts) {
      if (!this.matches(r, e) || (dialog && r.key !== '?')) continue;
      if (r.act?.(e)) e.preventDefault();
      return;
    }
  }

  private matches(r: Shortcut, e: KeyboardEvent): boolean {
    if (!r.key || (r.when && !r.when())) return false;
    return r.key instanceof RegExp ? r.key.test(e.key) : r.key === e.key.toLowerCase() || r.key === e.key;
  }

  private typing(el: EventTarget | null): boolean {
    const e = el as HTMLElement | null;
    return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName));
  }

  private page(start: string): boolean {
    return this.router.url.startsWith(start);
  }

  private destination(n: number): boolean {
    const dests = this.doc.querySelectorAll<HTMLElement>('.tb-rail .tb-dest:not(.tb-dest-more)');
    const d = dests[n - 1];
    if (!d) return false;
    d.click();
    return true;
  }

  private search(): boolean {
    const field = this.doc.querySelector<HTMLInputElement>('.tb-search input, input[type=search]');
    if (!field) return false;
    field.focus();
    field.select();
    return true;
  }

  private click(selector: string): boolean {
    const el = this.doc.querySelector<HTMLElement>(selector);
    if (!el) return false;
    el.click();
    return true;
  }

  private forward(url: string): boolean {
    void this.router.navigateByUrl(url);
    return true;
  }

  private back(): boolean {
    return this.click('.tb-page-head .tb-back') || this.forward('/app/overview');
  }
}
