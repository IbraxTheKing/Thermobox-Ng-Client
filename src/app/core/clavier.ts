import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { PreferencesService } from './preferences';

export interface Raccourci {
  groupe: string;
  touches: string[];
  texte: string;
  cle: string | RegExp | null;
  si?: () => boolean;
  agir?: (e: KeyboardEvent) => boolean;
}

/**
 * Keyboard shortcuts on a computer (tbClavier of the JSF interface), the only place they are
 * defined: the Préférences page and the "?" panel list them from here.
 */
@Injectable({ providedIn: 'root' })
export class ClavierService {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly prefs = inject(PreferencesService);

  /** The "?" panel is open. */
  readonly aide = signal(false);

  readonly raccourcis: Raccourci[] = [
    { groupe: 'Partout', touches: ['1', '…', '6'], texte: 'Ouvrir la 1ʳᵉ à la 6ᵉ entrée du menu (Aperçu, Salles, Mesures…)', cle: /^[1-6]$/, agir: (e) => this.destination(+e.key) },
    { groupe: 'Partout', touches: ['/'], texte: 'Aller au champ de recherche de la page', cle: '/', agir: () => this.chercher() },
    { groupe: 'Partout', touches: ['R'], texte: 'Actualiser les données de la page', cle: 'r', agir: () => this.cliquer('.tb-page-head [data-action="actualiser"]') },
    { groupe: 'Partout', touches: ['N'], texte: 'Action principale de la page (nouvel élément, nouvel utilisateur…)', cle: 'n', agir: () => this.cliquer('.tb-page-head .tb-fab') },
    { groupe: 'Partout', touches: ['T'], texte: 'Passer du thème clair au thème sombre', cle: 't', agir: () => this.cliquer('.tb-theme-btn') },
    { groupe: 'Partout', touches: ['P'], texte: 'Ouvrir les Préférences', cle: 'p', agir: () => this.aller('/app/preferences') },
    { groupe: 'Partout', touches: ['?'], texte: 'Afficher ou cacher cette liste', cle: '?', agir: () => (this.aide.update((v) => !v), true) },
    { groupe: 'Partout', touches: ['Échap'], texte: 'Fermer cette liste', cle: null },
    { groupe: "Page d'une salle", touches: ['Espace'], texte: "Revenir à l'aperçu", cle: ' ', si: () => this.page('/app/salle/'), agir: () => this.retour() },
    { groupe: "Page d'une salle", touches: ['Retour arrière'], texte: "Revenir à l'aperçu (comme Espace)", cle: 'Backspace', si: () => this.page('/app/salle/'), agir: () => this.retour() },
    { groupe: "Page d'une salle", touches: ['F'], texte: 'Ajouter aux favoris ou en retirer', cle: 'f', si: () => this.page('/app/salle/'), agir: () => this.cliquer('.tb-page-head .tb-fav') },
    {
      groupe: 'Aperçu',
      touches: ['F'],
      texte: 'Replier ou déplier toutes les sections sauf les favoris',
      cle: 'f',
      si: () => this.page('/app/apercu'),
      agir: () => {
        const sections = this.doc.querySelectorAll<HTMLElement>('.tb-section[data-section]:not([data-section="favoris"]) .tb-section-toggle');
        sections.forEach((b) => b.click());
        return sections.length > 0;
      },
    },
  ];

  constructor() {
    this.doc.addEventListener('keydown', (e) => this.touche(e));
  }

  /** The list, by group. */
  groupes(): { groupe: string; raccourcis: Raccourci[] }[] {
    const m = new Map<string, Raccourci[]>();
    for (const r of this.raccourcis) m.set(r.groupe, [...(m.get(r.groupe) ?? []), r]);
    return [...m.entries()].map(([groupe, raccourcis]) => ({ groupe, raccourcis }));
  }

  private touche(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.aide()) {
      this.aide.set(false);
      e.preventDefault();
      return;
    }
    if (!this.prefs.clavier() || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || this.enSaisie(e.target)) return;
    if (!this.router.url.startsWith('/app')) return;
    // A dialog of the page is open: only "?"
    const dialogue = this.doc.querySelector('.tb-dialog');
    const cible = e.target as HTMLElement | null;
    // A focused button or link keeps Space / Enter for itself
    if (e.key === ' ' && cible?.closest?.('a, button, [role=button], [tabindex]:not(body):not(section)')) return;
    for (const r of this.raccourcis) {
      if (!this.correspond(r, e) || (dialogue && r.cle !== '?')) continue;
      if (r.agir?.(e)) e.preventDefault();
      return;
    }
  }

  private correspond(r: Raccourci, e: KeyboardEvent): boolean {
    if (!r.cle || (r.si && !r.si())) return false;
    return r.cle instanceof RegExp ? r.cle.test(e.key) : r.cle === e.key.toLowerCase() || r.cle === e.key;
  }

  private enSaisie(el: EventTarget | null): boolean {
    const e = el as HTMLElement | null;
    return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName));
  }

  private page(debut: string): boolean {
    return this.router.url.startsWith(debut);
  }

  private destination(n: number): boolean {
    const dests = this.doc.querySelectorAll<HTMLElement>('.tb-rail .tb-dest:not(.tb-dest-plus)');
    const d = dests[n - 1];
    if (!d) return false;
    d.click();
    return true;
  }

  private chercher(): boolean {
    const champ = this.doc.querySelector<HTMLInputElement>('.tb-search input, input[type=search]');
    if (!champ) return false;
    champ.focus();
    champ.select();
    return true;
  }

  private cliquer(selecteur: string): boolean {
    const el = this.doc.querySelector<HTMLElement>(selecteur);
    if (!el) return false;
    el.click();
    return true;
  }

  private aller(url: string): boolean {
    void this.router.navigateByUrl(url);
    return true;
  }

  private retour(): boolean {
    return this.cliquer('.tb-page-head .tb-back') || this.aller('/app/apercu');
  }
}
