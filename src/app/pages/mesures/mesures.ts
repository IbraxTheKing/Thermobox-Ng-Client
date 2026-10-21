import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { messageErreur } from '../../core/api.config';
import { AuthService } from '../../core/auth';
import { Courbe, courbe, dansLaCible, instants, pas } from '../../core/courbes';
import { complet, heure, jjmmHHmm, parseDate, temps, versChamp, versLocal } from '../../core/dates';
import { EtatSalle, etatDe, horsConsigne } from '../../core/etat';
import { donnerFichier } from '../../core/fichier';
import { ConfirmService, ToastService } from '../../core/messages';
import { normaliser, parNom } from '../../core/texte';
import { UniteService, lireNombre } from '../../core/unite';
import { Noeud, TemperatureType } from '../../models/models';
import { ArbreStore } from '../../services/arbre.store';
import { ClimatService } from '../../services/climat.service';
import { TemperatureService, TemperatureTypee } from '../../services/temperature.service';
import { SerieGraphique, TbGraphique } from '../../ui/graphique';
import { TbSheet } from '../../ui/sheet';

/** One curve: a salle or a bâtiment, with its figures over the period (Celsius). */
interface Ligne {
  element: Noeud;
  chemin: string;
  /** Colour of its curve: --tb-serie-<n> */
  couleur: number;
  actuelle: number | null;
  min: number | null;
  max: number | null;
  moyenne: number | null;
  consigne: number | null;
  ecart: number | null;
  dansLaCible: number | null;
  etat: EtatSalle;
  courbe: Courbe;
}

type Tri = 'nom' | 'actuelle' | 'consigne' | 'min' | 'max' | 'moyenne' | 'cible';

const SANS_BATIMENT = -1;

/**
 * Mesures (temperatures.xhtml): every salle (or every bâtiment) on one chart over 24 h, 7 or 30
 * days, a table that compares them, and the raw history of every measure and consigne.
 */
@Component({
  selector: 'tb-mesures',
  imports: [RouterLink, DecimalPipe, TbGraphique, TbSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesures.html',
})
export class MesuresPage implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly unite = inject(UniteService);
  private readonly store = inject(ArbreStore);
  private readonly climat = inject(ClimatService);
  private readonly temperatures = inject(TemperatureService);
  private readonly toasts = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  private readonly graphique = viewChild(TbGraphique);

  protected readonly periodeHeures = signal(24);
  protected readonly parBatiment = signal(false);
  protected readonly batimentId = signal<number | null>(null);
  protected readonly lignes = signal<Ligne[]>([]);
  protected readonly instants = signal<number[]>([]);
  protected readonly chargement = signal(false);
  protected readonly masquees = signal<Set<number>>(new Set());
  protected readonly tri = signal<{ par: Tri; desc: boolean } | null>(null);

  protected readonly SANS_BATIMENT = SANS_BATIMENT;

  protected readonly batiments = computed(() => [...this.store.batiments()].sort(parNom((b) => b.name)));
  protected readonly avecDonnees = computed(() => this.lignes().filter((l) => l.actuelle != null));
  protected readonly plusChaude = computed(() => this.avecDonnees().reduce<Ligne | null>((m, l) => (!m || l.actuelle! > m.actuelle! ? l : m), null));
  protected readonly plusFroide = computed(() => this.avecDonnees().reduce<Ligne | null>((m, l) => (!m || l.actuelle! < m.actuelle! ? l : m), null));
  protected readonly moyenneGenerale = computed(() => {
    const l = this.avecDonnees();
    return l.length ? l.reduce((s, x) => s + x.actuelle!, 0) / l.length : null;
  });
  protected readonly horsConsigne = computed(() => this.lignes().filter((l) => horsConsigne(l.etat)).length);

  protected readonly series = computed<SerieGraphique[]>(() =>
    this.lignes().map((l) => ({ label: l.element.name ?? '', couleur: `--tb-serie-${l.couleur}`, valeurs: l.courbe.valeurs })),
  );
  protected readonly labels = computed(() => {
    const format = this.periodeHeures() <= 24 ? heure : jjmmHHmm;
    return this.instants().map((t) => format(new Date(t)));
  });

  /** The table, sorted as asked (clicking a column title). */
  protected readonly lignesTriees = computed(() => {
    const t = this.tri();
    const l = this.lignes().map((x, i) => ({ l: x, i }));
    if (!t) return l;
    const cle = (x: Ligne): number | string | null =>
      t.par === 'nom' ? normaliser(x.element.name) : t.par === 'cible' ? x.dansLaCible : x[t.par];
    return [...l].sort((a, b) => {
      const va = cle(a.l);
      const vb = cle(b.l);
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'fr') : (va as number) - (vb as number);
      return t.desc ? -c : c;
    });
  });

  protected readonly pasTexte = computed(() => (this.periodeHeures() <= 24 ? "quart d'heure" : this.periodeHeures() <= 168 ? 'heure' : 'tranche de 4 h'));

  async ngOnInit(): Promise<void> {
    try {
      await this.store.charger(this.store.arbre() != null);
    } catch (e) {
      this.toasts.error('Impossible de charger les salles', messageErreur(e));
    }
    await this.charger();
  }

  protected async charger(): Promise<void> {
    this.chargement.set(true);
    try {
      // A bâtiment's curve aggregates all its boxes: only for a user who may see all of it
      const elements = this.parBatiment()
        ? this.store.batiments().filter((b) => b.accessible).map((b) => ({ n: b, chemin: '' }))
        : this.store
            .salles()
            .filter((s) => {
              const b = this.batimentId();
              const bat = this.store.batimentDe(s.id);
              return b == null || (b === SANS_BATIMENT ? bat == null : bat?.id === b);
            })
            .map((s) => ({ n: s, chemin: this.store.cheminTexte(s.id) }));
      elements.sort((a, b) => normaliser(a.chemin).localeCompare(normaliser(b.chemin), 'fr') || normaliser(a.n.name).localeCompare(normaliser(b.n.name), 'fr'));

      const fin = new Date();
      fin.setSeconds(0, 0);
      const debut = new Date(fin.getTime() - this.periodeHeures() * 3_600_000);
      const p = pas(debut.getTime(), fin.getTime());
      const moyennes: Record<string, { date: string | null; value: number | null }[]> = {};
      for (let i = 0; i < elements.length; i += 200) {
        Object.assign(moyennes, await firstValueFrom(this.climat.moyennes(elements.slice(i, i + 200).map((e) => e.n.id), debut, fin)));
      }
      const lignes = elements.map(({ n, chemin }, i): Ligne => {
        const points = (moyennes[String(n.id)] ?? []).filter((x) => x.value != null).map((x) => ({ t: temps(x.date), v: x.value! }));
        const c = courbe(points, debut.getTime(), fin.getTime(), p);
        const consigne = n.consigne?.value ?? null;
        return {
          element: n,
          chemin,
          couleur: (i % 8) + 1,
          actuelle: n.temperature,
          min: c.min,
          max: c.max,
          moyenne: c.moyenne,
          consigne,
          ecart: n.temperature != null && consigne != null ? n.temperature - consigne : null,
          dansLaCible: dansLaCible(c, consigne),
          etat: etatDe(n.temperature, consigne),
          courbe: c,
        };
      });
      this.instants.set(instants(debut.getTime(), fin.getTime(), p));
      this.lignes.set(lignes);
      this.masquees.set(new Set());
    } catch (e) {
      this.toasts.error('Impossible de charger les courbes', messageErreur(e));
    } finally {
      this.chargement.set(false);
    }
  }

  protected async actualiser(): Promise<void> {
    await this.store.charger(true).catch(() => undefined);
    await this.charger();
  }

  protected periode(h: number): void {
    this.periodeHeures.set(h);
    void this.charger();
  }

  protected regrouper(parBatiment: boolean): void {
    this.parBatiment.set(parBatiment);
    void this.charger();
  }

  protected choisirBatiment(v: string): void {
    this.batimentId.set(v === '' ? null : Number(v));
    void this.charger();
  }

  protected trier(par: Tri): void {
    this.tri.update((t) => (t?.par === par ? (t.desc ? null : { par, desc: true }) : { par, desc: false }));
  }

  protected iconeTri(par: Tri): string {
    const t = this.tri();
    return t?.par !== par ? 'pi-sort-alt' : t.desc ? 'pi-sort-amount-down' : 'pi-sort-amount-up-alt';
  }

  /** Colour chip of a row: shows or hides its curve. */
  protected basculerCourbe(i: number): void {
    const visible = this.graphique()?.basculer(i) ?? true;
    this.surBascule({ index: i, visible });
  }

  protected surBascule(e: { index: number; visible: boolean }): void {
    this.masquees.update((s) => {
      const r = new Set(s);
      if (e.visible) r.delete(e.index);
      else r.add(e.index);
      return r;
    });
  }

  protected surligner(i: number): void {
    this.graphique()?.surligner(i);
  }

  /** Points of the chart: one line per moment, one column per curve (French spreadsheet format). */
  protected async exporter(): Promise<void> {
    const symbole = this.unite.symbole();
    const cellule = (t: string) => `"${t.replace(/"/g, '""')}"`;
    const lignes = [['Moment', ...this.lignes().map((l) => `${l.element.name} (${symbole})`)].map(cellule).join(';')];
    this.instants().forEach((t, k) => {
      lignes.push(
        [
          cellule(complet(new Date(t))),
          ...this.lignes().map((l) => {
            const v = l.courbe.valeurs[k];
            return v == null ? '' : String(Math.round(this.unite.depuisCelsius(v) * 10) / 10).replace('.', ',');
          }),
        ].join(';'),
      );
    });
    await donnerFichier('thermobox-temperatures.csv', '﻿' + lignes.join('\r\n'), 'text/csv;charset=utf-8');
  }

  // ============================================================== raw history

  protected readonly brutOuvert = signal(false);
  protected readonly brutCharge = signal(false);
  protected readonly filtre = signal<TemperatureType | 'tous'>('tous');
  protected readonly brut = signal<TemperatureTypee[]>([]);
  protected readonly pageBrut = signal(0);
  protected readonly pagesBrut = computed(() => Math.max(1, Math.ceil(this.brut().length / 20)));
  protected readonly brutPage = computed(() => this.brut().slice(this.pageBrut() * 20, this.pageBrut() * 20 + 20));

  /** Read only once its section is opened (every temperature of the base). */
  protected surBrut(e: Event): void {
    const ouvert = (e.target as HTMLDetailsElement).open;
    this.brutOuvert.set(ouvert);
    if (ouvert && !this.brutCharge()) void this.chargerBrut();
  }

  protected filtrer(f: TemperatureType | 'tous'): void {
    this.filtre.set(f);
    void this.chargerBrut();
  }

  private async chargerBrut(): Promise<void> {
    try {
      const l = await firstValueFrom(this.temperatures.getTypees(this.filtre()));
      this.brut.set(l.sort((a, b) => temps(b.date) - temps(a.date)));
      this.pageBrut.set(0);
      this.brutCharge.set(true);
    } catch (e) {
      this.toasts.error("Impossible de charger l'historique", messageErreur(e));
    }
  }

  protected complet = complet;

  // Dialog (ADMIN)
  protected readonly edition = signal<TemperatureTypee | null>(null);
  protected readonly dialogue = signal(false);
  protected readonly formType = signal<TemperatureType>('mesurer');
  protected readonly formValeur = signal('');
  protected readonly formDate = signal('');
  protected readonly formEnvoye = signal(false);

  protected creer(): void {
    this.edition.set(null);
    this.formType.set('mesurer');
    this.formValeur.set('');
    this.formDate.set(versChamp(new Date()));
    this.formEnvoye.set(false);
    this.dialogue.set(true);
  }

  protected modifier(t: TemperatureTypee): void {
    this.edition.set(t);
    this.formType.set(t.type);
    this.formValeur.set(t.value != null ? String(Math.round(this.unite.depuisCelsius(t.value) * 10) / 10).replace('.', ',') : '');
    const d = parseDate(t.date);
    this.formDate.set(d ? versChamp(d) : '');
    this.formEnvoye.set(false);
    this.dialogue.set(true);
  }

  protected readonly formErreur = computed(() => {
    const v = lireNombre(this.formValeur());
    if (v == null) return 'Valeur obligatoire';
    if (v < this.unite.valeurMin() || v > this.unite.valeurMax()) return `Entre ${this.unite.valeurMin()} et ${this.unite.valeurMax()} ${this.unite.symbole()}`;
    if (!this.formDate()) return 'Date obligatoire';
    return null;
  });

  protected async enregistrer(e: Event): Promise<void> {
    e.preventDefault();
    this.formEnvoye.set(true);
    if (this.formErreur()) return;
    // Entered in the unit of the Préférences page, stored in Celsius
    const value = this.unite.saisieVersCelsius(lireNombre(this.formValeur())!);
    const date = versLocal(new Date(this.formDate()));
    const t = this.edition();
    try {
      if (t?.id != null) {
        await firstValueFrom(this.temperatures.update(t.id, { value, date }));
        this.toasts.info('Température modifiée');
      } else {
        await firstValueFrom(this.temperatures.addTyped(this.formType(), value, date));
        this.toasts.info('Température ajoutée');
      }
      this.dialogue.set(false);
      await this.chargerBrut();
    } catch (err) {
      this.toasts.error('Enregistrement impossible', messageErreur(err));
    }
  }

  protected async supprimer(t: TemperatureTypee): Promise<void> {
    if (t.id == null) return;
    if (!(await this.confirm.demander('Supprimer', 'Supprimer cette température ?', { confirmer: 'Supprimer' }))) return;
    try {
      await firstValueFrom(this.temperatures.remove(t.id));
      this.toasts.info('Température supprimée');
    } catch (e) {
      this.toasts.error('Suppression impossible', messageErreur(e));
    }
    await this.chargerBrut();
  }
}
