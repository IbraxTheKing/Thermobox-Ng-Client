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
  viewChild,
} from '@angular/core';
import {
  CategoryScale,
  Chart,
  ChartDataset,
  ChartOptions,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { PreferencesService } from '../core/preferences';
import { UniteService } from '../core/unite';

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

/**
 * Temperature chart (p:lineChart + tbChartExtender of the JSF interface): Chart.js styled with the
 * theme colours, redrawn when the theme, the look or the unit changes.
 */
@Component({
  selector: 'tb-graphique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tb-graphique', style: 'display: block; position: relative; height: 100%' },
  template: `<canvas #canvas role="img" [attr.aria-label]="description()"></canvas>`,
})
export class TbGraphique implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly unite = inject(UniteService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly labels = input.required<string[]>();
  readonly series = input.required<SerieGraphique[]>();
  readonly description = input('Graphique des températures');
  /** A curve was shown or hidden from the legend. */
  readonly basculee = output<{ index: number; visible: boolean }>();

  private chart?: Chart<'line', (number | null)[], string>;

  constructor() {
    afterRenderEffect(() => {
      // Read every signal the drawing depends on, so it is redone when one changes
      const labels = this.labels();
      const series = this.series();
      this.prefs.theme();
      this.prefs.style();
      this.prefs.teinte();
      this.prefs.animations();
      this.unite.fahrenheit();
      this.dessiner(labels, series);
    });
  }

  /** Shows or hides curve [i] (colour chip of the Mesures table). */
  basculer(i: number): boolean {
    if (!this.chart) return true;
    const visible = !this.chart.isDatasetVisible(i);
    this.chart.setDatasetVisibility(i, visible);
    this.chart.update();
    return visible;
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
    const mobile = matchMedia('(max-width: 640px)').matches;
    const datasets: ChartDataset<'line', (number | null)[]>[] = series.map((s) => {
      const couleur = this.couleur(s.couleur);
      const ds: ChartDataset<'line', (number | null)[]> & { tbOrigine?: string } = {
        label: s.label,
        data: s.valeurs.map((v) => (v == null ? null : Math.round(this.unite.depuisCelsius(v) * 10) / 10)),
        borderColor: couleur,
        backgroundColor: couleur,
        pointBackgroundColor: couleur,
        spanGaps: true,
        tbOrigine: couleur,
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
      return;
    }
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, { type: 'line', data: { labels, datasets }, options });
  }

  private options(mobile: boolean, n: number): ChartOptions<'line'> {
    const texte = this.couleur('--md-on-surface-variant');
    const grille = this.couleur('--md-outline-variant');
    const police = { family: 'Manrope, "Segoe UI", system-ui, sans-serif', size: mobile ? 11 : 13 };
    const symbole = this.unite.symbole();
    const animer = this.prefs.animations() && !this.prefs.mouvementReduit;
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 4, right: 4, bottom: 0, left: 0 } },
      animation: animer ? { duration: 900, easing: 'easeOutQuart' } : false,
      interaction: { mode: 'index', intersect: false },
      elements: {
        point: { radius: 0, hoverRadius: 6, hitRadius: 12 },
        line: { tension: 0.4, borderWidth: mobile ? 2.5 : 3, borderCapStyle: 'round' },
      },
      plugins: {
        legend: {
          // Phones: many curves would make a legend taller than the chart (the table says which is which)
          display: !(n > 5 && mobile),
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
            font: police,
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
          ticks: {
            color: texte,
            font: police,
            padding: 10,
            maxTicksLimit: mobile ? 5 : 7,
            callback: (v) => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}°`,
          },
        },
      },
    };
  }
}
