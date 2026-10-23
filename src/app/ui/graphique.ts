import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CategoryScale,
  Chart,
  ChartType,
  ChartDataset,
  ChartOptions,
  Legend,
  LineController,
  Plugin,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { PlateformeService } from '../core/plateforme';
import { PreferencesService } from '../core/preferences';
import { UniteService } from '../core/unite';

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    tbReticule?: { couleur?: string };
  }
}

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

/** One curve. Values in Celsius (shown in the unit of the Préférences page). */
export interface SerieGraphique {
  label: string;
  /** A CSS colour, or a custom property of the theme ("--tb-serie-1"). */
  couleur: string;
  valeurs: (number | null)[];
  /** consigne: dashed steps (a consigne holds until the next one); moyenne: thick line. */
  role?: 'consigne' | 'moyenne';
}

/** Values at one instant, read under the finger (phones). */
interface Lecture {
  titre: string;
  valeurs: { index: number; label: string; couleur: string; texte: string; visible: boolean; consigne: boolean }[];
}

/** Vertical line at the instant under the finger or the pointer. */
const reticule: Plugin<'line'> = {
  id: 'tbReticule',
  afterDatasetsDraw(chart) {
    const actif = chart.tooltip?.getActiveElements?.() ?? [];
    if (!actif.length) return;
    const x = actif[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = chart.options.plugins?.tbReticule?.couleur ?? 'rgba(0,0,0,.3)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * Temperature chart (p:lineChart + tbChartExtender of the JSF interface): Chart.js styled with the
 * theme colours, redrawn when the theme, the look or the unit changes.
 *
 * Phones: no floating tooltip under the finger; the values at the instant touched are read in a
 * strip above the curves (at rest: the last ones), whose chips show or hide each curve. A vertical
 * line marks the instant. The chart can open full screen (turn the phone to see it wide).
 */
@Component({
  selector: 'tb-graphique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tb-graphique',
    '[class.tb-graphique-tel]': 'tel()',
    '[class.tb-graphique-plein]': 'plein()',
    '(keydown.escape)': 'plein.set(false)',
  },
  template: `
    @if (tel() && lecture(); as l) {
      <div class="tb-lecture">
        <div class="tb-lecture-tete">
          <span class="tb-lecture-titre">{{ l.titre }}</span>
          <button type="button" class="tb-btn tb-icon tb-flat tb-lecture-plein" (click)="basculerPlein()" [attr.aria-label]="plein() ? 'Réduire le graphique' : 'Graphique en plein écran'" [title]="plein() ? 'Réduire' : 'Plein écran'">
            <i class="pi" [class.pi-window-maximize]="!plein()" [class.pi-window-minimize]="plein()"></i>
          </button>
        </div>
        <div class="tb-lecture-valeurs">
          @for (v of l.valeurs; track v.index) {
            <button type="button" class="tb-lecture-valeur" [class.tb-lecture-off]="!v.visible" [class.tb-lecture-consigne]="v.consigne" (click)="basculerDepuisLecture(v.index)" [attr.aria-pressed]="v.visible">
              <span class="tb-lecture-pastille" [style.background]="v.couleur"></span>
              <span class="tb-lecture-nom">{{ v.label }}</span>
              <strong>{{ v.texte }}</strong>
            </button>
          }
        </div>
      </div>
    }
    <div class="tb-graphique-zone"><canvas #canvas role="img" [attr.aria-label]="description()"></canvas></div>
  `,
})
export class TbGraphique implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly unite = inject(UniteService);
  protected readonly tel = inject(PlateformeService).telephone;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly hote = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly labels = input.required<string[]>();
  readonly series = input.required<SerieGraphique[]>();
  readonly description = input('Graphique des températures');
  /** A curve was shown or hidden from the legend. */
  readonly basculee = output<{ index: number; visible: boolean }>();

  private chart?: Chart<'line', (number | null)[], string>;

  protected readonly lecture = signal<Lecture | null>(null);
  protected readonly plein = signal(false);

  constructor() {
    afterRenderEffect(() => {
      // Read every signal the drawing depends on, so it is redone when one changes
      const labels = this.labels();
      const series = this.series();
      this.prefs.theme();
      this.prefs.style();
      this.prefs.teinte();
      this.prefs.animer();
      this.unite.fahrenheit();
      this.tel();
      this.dessiner(labels, series);
    });
  }

  /** Shows or hides curve [i] (colour chip of the Mesures table). */
  basculer(i: number): boolean {
    if (!this.chart) return true;
    const visible = !this.chart.isDatasetVisible(i);
    this.chart.setDatasetVisibility(i, visible);
    this.chart.update();
    this.lire(null);
    return visible;
  }

  protected basculerDepuisLecture(i: number): void {
    const visible = this.basculer(i);
    this.basculee.emit({ index: i, visible });
  }

  private place?: { parent: Node; suivant: Node | null };

  /**
   * Full screen: the chart moves to the end of the page while open (a glass card, being blurred,
   * would otherwise hold it inside itself), and comes back to its place.
   */
  protected basculerPlein(): void {
    const hote = this.hote.nativeElement;
    if (!this.plein()) {
      this.place = { parent: hote.parentNode!, suivant: hote.nextSibling };
      this.doc.body.appendChild(hote);
      this.plein.set(true);
    } else {
      this.plein.set(false);
      if (this.place?.parent.isConnected) this.place.parent.insertBefore(hote, this.place.suivant);
      else hote.remove();
      this.place = undefined;
    }
    this.doc.body.classList.toggle('tb-graphique-ouvert', this.plein());
    // The canvas follows its new size on the next frame
    requestAnimationFrame(() => this.chart?.resize());
  }

  /** Values at instant [i] (null: the last instant with values). */
  private lire(i: number | null): void {
    const chart = this.chart;
    if (!chart || !this.tel()) {
      this.lecture.set(null);
      return;
    }
    const labels = (chart.data.labels ?? []) as string[];
    const datasets = chart.data.datasets as (ChartDataset<'line', (number | null)[]> & { tbOrigine?: string; tbConsigne?: boolean })[];
    let k = i;
    if (k == null) {
      k = labels.length - 1;
      while (k > 0 && datasets.every((d) => d.data[k!] == null)) k--;
    }
    const symbole = this.unite.symbole();
    this.lecture.set({
      titre: i == null ? 'Dernières valeurs' : (labels[k] ?? ''),
      valeurs: datasets.map((d, index) => {
        // A consigne holds until the next one: the last one set before this instant
        let v = d.data[k!];
        if (v == null && d.tbConsigne) for (let j = k!; j >= 0 && v == null; j--) v = d.data[j];
        return {
          index,
          label: d.label ?? '',
          couleur: d.tbOrigine ?? (d.borderColor as string),
          texte: v == null ? '—' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${symbole}`,
          visible: chart.isDatasetVisible(index),
          consigne: !!d.tbConsigne,
        };
      }),
    });
  }

  /** Brings curve [i] forward, the others fade; -1: all back. */
  surligner(i: number): void {
    const chart = this.chart;
    if (!chart) return;
    chart.data.datasets.forEach((ds, j) => {
      const d = ds as ChartDataset<'line', (number | null)[]> & { tbOrigine?: string };
      const c = d.tbOrigine ?? (d.borderColor as string);
      const couleur = i < 0 || i === j ? c : this.couleur(c, 0.18);
      d.borderColor = d.backgroundColor = d.pointBackgroundColor = couleur;
      d.borderWidth = i === j ? 4 : undefined;
    });
    chart.update('none');
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.sonde?.el.remove();
    this.doc.body.classList.remove('tb-graphique-ouvert');
    // Opened full screen when its page went away: it was moved out of it
    if (this.plein()) this.hote.nativeElement.remove();
  }

  /**
   * A colour Chart.js can draw with: the theme colours may be color-mix() / oklch() expressions
   * (tint of the page), resolved here by the browser to plain rgba.
   */
  private couleur(c: string, alpha = 1): string {
    const sonde = (this.sonde ??= this.creerSonde());
    sonde.el.style.color = '';
    sonde.el.style.color = c.startsWith('--') ? `var(${c})` : c;
    const calculee = getComputedStyle(sonde.el).color;
    const ctx = sonde.ctx;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#2160cc';
    ctx.fillStyle = calculee;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${((a / 255) * alpha).toFixed(3)})`;
  }

  private sonde?: { el: HTMLElement; ctx: CanvasRenderingContext2D };

  private creerSonde(): { el: HTMLElement; ctx: CanvasRenderingContext2D } {
    const el = this.doc.createElement('span');
    el.style.display = 'none';
    this.doc.body.appendChild(el);
    const toile = this.doc.createElement('canvas');
    toile.width = toile.height = 1;
    const ctx = toile.getContext('2d', { willReadFrequently: true })!;
    return { el, ctx };
  }

  private dessiner(labels: string[], series: SerieGraphique[]): void {
    const mobile = this.tel();
    const datasets: ChartDataset<'line', (number | null)[]>[] = series.map((s) => {
      const couleur = this.couleur(s.couleur);
      const ds: ChartDataset<'line', (number | null)[]> & { tbOrigine?: string; tbConsigne?: boolean } = {
        label: s.label,
        data: s.valeurs.map((v) => (v == null ? null : Math.round(this.unite.depuisCelsius(v) * 10) / 10)),
        borderColor: couleur,
        backgroundColor: couleur,
        pointBackgroundColor: couleur,
        spanGaps: true,
        tbOrigine: couleur,
        tbConsigne: s.role === 'consigne',
      };
      if (s.role === 'consigne') {
        ds.stepped = true;
        ds.borderDash = [8, 6];
        ds.pointRadius = 0;
      } else if (s.role === 'moyenne') {
        ds.borderWidth = 4;
      }
      return ds;
    });
    const options = this.options(mobile, series.length);
    const visibles = this.chart ? this.chart.data.datasets.map((_, i) => this.chart!.isDatasetVisible(i)) : [];
    if (this.chart && this.chart.data.datasets.length === datasets.length) {
      this.chart.data.labels = labels;
      this.chart.data.datasets = datasets;
      this.chart.options = options;
      visibles.forEach((v, i) => this.chart!.setDatasetVisibility(i, v));
      this.chart.update();
      this.lire(null);
      return;
    }
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, { type: 'line', data: { labels, datasets }, options, plugins: [reticule] });
    this.lire(null);
  }

  private options(mobile: boolean, n: number): ChartOptions<'line'> {
    const texte = this.couleur('--md-on-surface-variant');
    const grille = this.couleur('--md-outline-variant');
    const police = { family: 'Manrope, "Segoe UI", system-ui, sans-serif', size: mobile ? 11 : 13 };
    const symbole = this.unite.symbole();
    const animer = this.prefs.animer();
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: mobile ? 8 : 4, right: mobile ? 0 : 4, bottom: 0, left: 0 } },
      // Phones: shorter (each frame of it redraws the whole chart, during the page transition)
      animation: animer ? { duration: mobile ? 450 : 900, easing: 'easeOutQuart' } : false,
      interaction: { mode: 'index', intersect: false },
      // Phones: the values under the finger go to the reading strip; lifted, back to the last ones
      onHover: mobile
        ? (_e, actifs) => {
            this.lire(actifs.length ? actifs[0].index : null);
          }
        : undefined,
      events: mobile ? ['mousemove', 'mouseout', 'touchstart', 'touchmove', 'touchend'] : undefined,
      elements: {
        point: { radius: 0, hoverRadius: 6, hitRadius: 12 },
        line: { tension: 0.4, borderWidth: mobile ? 2.5 : 3, borderCapStyle: 'round' },
      },
      plugins: {
        tbReticule: { couleur: this.couleur('--md-on-surface-variant', 0.55) },
        legend: {
          // Phones: the reading strip above says which curve is which and toggles them
          display: !mobile && n > 0,
          position: mobile ? 'bottom' : 'top',
          align: 'start',
          labels: { color: texte, font: police, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: mobile ? 12 : 20 },
          onClick: (_e, item, legend) => {
            const i = item.datasetIndex ?? 0;
            const chart = legend.chart;
            const visible = !chart.isDatasetVisible(i);
            chart.setDatasetVisibility(i, visible);
            chart.update();
            this.basculee.emit({ index: i, visible });
          },
        },
        tooltip: {
          enabled: !mobile,
          mode: 'index',
          intersect: false,
          titleFont: police,
          bodyFont: police,
          padding: 12,
          cornerRadius: 12,
          backgroundColor: this.couleur('--md-inverse-surface'),
          titleColor: this.couleur('--md-inverse-on-surface'),
          bodyColor: this.couleur('--md-inverse-on-surface'),
          usePointStyle: true,
          boxPadding: 4,
          callbacks: {
            label: (ctx) => {
              const y = ctx.parsed.y;
              if (y == null) return '';
              return ` ${ctx.dataset.label} : ${y.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${symbole}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: grille },
          ticks: {
            color: texte,
            font: { ...police, size: mobile ? 10.5 : 13 },
            padding: 8,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: mobile ? 4 : 8,
            // "29/09 10:07" on two lines
            callback(value) {
              return (this.getLabelForValue(value as number) || '').split(' ');
            },
          },
        },
        y: {
          grid: { color: grille, drawTicks: false },
          border: { display: false },
          // Phones: the figures inside the chart, over the grid lines, so the curves get the width
          position: mobile ? 'right' : 'left',
          ticks: {
            color: texte,
            font: police,
            padding: mobile ? 4 : 10,
            mirror: mobile,
            z: 1,
            maxTicksLimit: mobile ? 6 : 7,
            callback: (v) => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}°`,
          },
        },
      },
    };
  }
}
