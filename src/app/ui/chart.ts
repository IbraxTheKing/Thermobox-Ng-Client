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

import { PlatformService } from '../core/platform';
import { PreferencesService } from '../core/preferences';
import { UnitService } from '../core/unit';

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    tbCrosshair?: { color?: string };
  }
}

/** Beyond this many curves, the chart is drawn without animation. */
const MAX_ANIMATED = 8;

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

/** One curve. Values in Celsius (shown in the unit of the Preferences page). */
export interface ChartSeries {
  label: string;
  /** A CSS colour, or a custom property of the theme ("--tb-series-1"). */
  color: string;
  values: (number | null)[];
  /** setpoint: dashed steps (a setpoint holds until the next one); moyenne: thick line. */
  role?: 'setpoint' | 'average';
  /** Given: the curve is hidden (true) or shown (false) whatever was toggled before. */
  hidden?: boolean;
}

/** Values at one instant, read under the finger (phones). */
interface Reading {
  title: string;
  values: { index: number; label: string; color: string; text: string; visible: boolean; setpoint: boolean }[];
}

/** Vertical line at the instant under the finger or the pointer. */
const crosshair: Plugin<'line'> = {
  id: 'tbReticule',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() ?? [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = chart.options.plugins?.tbCrosshair?.color ?? 'rgba(0,0,0,.3)';
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
  selector: 'tb-chart-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tb-chart-view',
    '[class.tb-chart-phone]': 'phone()',
    '[class.tb-chart-full]': 'full()',
    '(keydown.escape)': 'full.set(false)',
  },
  template: `
    @if (phone() && reading(); as l) {
      <div class="tb-reading">
        <div class="tb-reading-head">
          <span class="tb-reading-title">{{ l.title }}</span>
          <button type="button" class="tb-btn tb-icon tb-flat tb-reading-full" (click)="toggleFull()" [attr.aria-label]="full() ? 'Réduire le graphique' : 'Graphique en plein écran'" [title]="full() ? 'Réduire' : 'Plein écran'">
            <i class="pi" [class.pi-window-maximize]="!full()" [class.pi-window-minimize]="full()"></i>
          </button>
        </div>
        <div class="tb-reading-values">
          @for (v of l.values; track v.index) {
            <button type="button" class="tb-reading-value" [class.tb-reading-off]="!v.visible" [class.tb-reading-setpoint]="v.setpoint" (click)="toggleFromReading(v.index)" [attr.aria-pressed]="v.visible">
              <span class="tb-reading-badge" [style.background]="v.color"></span>
              <span class="tb-reading-name">{{ v.label }}</span>
              <strong>{{ v.text }}</strong>
            </button>
          }
        </div>
      </div>
    }
    <div class="tb-chart-zone"><canvas #canvas role="img" [attr.aria-label]="description()"></canvas></div>
  `,
})
export class TbChart implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly prefs = inject(PreferencesService);
  private readonly unit = inject(UnitService);
  protected readonly phone = inject(PlatformService).phone;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly labels = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly description = input('Graphique des températures');
  /**
   * Values in this unit as they are (« % », « Mo »…), not temperatures: no conversion to the unit
   * of the Preferences page. null: temperatures in Celsius.
   */
  readonly valueUnit = input<string | null>(null);
  /** Lowest value of the vertical axis (0 for a percentage), none by default. */
  readonly yMin = input<number | null>(null);
  /** A curve was shown or hidden from the legend. */
  readonly toggled = output<{ index: number; visible: boolean }>();

  private chart?: Chart<'line', (number | null)[], string>;

  protected readonly reading = signal<Reading | null>(null);
  protected readonly full = signal(false);

  constructor() {
    afterRenderEffect(() => {
      // Read every signal the drawing depends on, so it is redone when one changes
      const labels = this.labels();
      const series = this.series();
      this.prefs.theme();
      this.prefs.style();
      this.prefs.tint();
      this.prefs.animate();
      this.unit.fahrenheit();
      this.valueUnit();
      this.yMin();
      this.phone();
      this.draw(labels, series);
    });
  }

  /** Shows or hides curve [i] (colour chip of the Mesures table). */
  toggle(i: number): boolean {
    if (!this.chart) return true;
    const visible = !this.chart.isDatasetVisible(i);
    this.chart.setDatasetVisibility(i, visible);
    this.chart.update();
    this.read(null);
    return visible;
  }

  protected toggleFromReading(i: number): void {
    const visible = this.toggle(i);
    this.toggled.emit({ index: i, visible });
  }

  private place?: { parent: Node; next: Node | null };

  /**
   * Full screen: the chart moves to the end of the page while open (a glass card, being blurred,
   * would otherwise hold it inside itself), and comes back to its place.
   */
  protected toggleFull(): void {
    const host = this.host.nativeElement;
    if (!this.full()) {
      this.place = { parent: host.parentNode!, next: host.nextSibling };
      this.doc.body.appendChild(host);
      this.full.set(true);
    } else {
      this.full.set(false);
      if (this.place?.parent.isConnected) this.place.parent.insertBefore(host, this.place.next);
      else host.remove();
      this.place = undefined;
    }
    this.doc.body.classList.toggle('tb-chart-open', this.full());
    // The canvas follows its new size on the next frame
    requestAnimationFrame(() => this.chart?.resize());
  }

  /** Values at instant [i] (null: the last instant with values). */
  private read(i: number | null): void {
    const chart = this.chart;
    if (!chart || !this.phone()) {
      this.reading.set(null);
      return;
    }
    const labels = (chart.data.labels ?? []) as string[];
    const datasets = chart.data.datasets as (ChartDataset<'line', (number | null)[]> & { tbOrigin?: string; tbSetpoint?: boolean })[];
    let k = i;
    if (k == null) {
      k = labels.length - 1;
      while (k > 0 && datasets.every((d) => d.data[k!] == null)) k--;
    }
    const symbol = this.valueUnit() ?? this.unit.symbol();
    this.reading.set({
      title: i == null ? 'Dernières valeurs' : (labels[k] ?? ''),
      values: datasets.map((d, index) => {
        // A setpoint holds until the next one: the last one set before this instant
        let v = d.data[k!];
        if (v == null && d.tbSetpoint) for (let j = k!; j >= 0 && v == null; j--) v = d.data[j];
        return {
          index,
          label: d.label ?? '',
          color: d.tbOrigin ?? (d.borderColor as string),
          text: v == null ? '—' : `${v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${symbol}`,
          visible: chart.isDatasetVisible(index),
          setpoint: !!d.tbSetpoint,
        };
      }),
    });
  }

  /** Brings curve [i] forward, the others fade; -1: all back. */
  highlight(i: number): void {
    const chart = this.chart;
    if (!chart) return;
    chart.data.datasets.forEach((ds, j) => {
      const d = ds as ChartDataset<'line', (number | null)[]> & { tbOrigin?: string };
      const c = d.tbOrigin ?? (d.borderColor as string);
      const color = i < 0 || i === j ? c : this.color(c, 0.18);
      d.borderColor = d.backgroundColor = d.pointBackgroundColor = color;
      d.borderWidth = i === j ? 4 : undefined;
    });
    chart.update('none');
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.probe?.el.remove();
    this.doc.body.classList.remove('tb-chart-open');
    // Opened full screen when its page went away: it was moved out of it
    if (this.full()) this.host.nativeElement.remove();
  }

  /**
   * A colour Chart.js can draw with: the theme colours may be color-mix() / oklch() expressions
   * (tint of the page), resolved here by the browser to plain rgba.
   */
  private color(c: string, alpha = 1): string {
    const probe = (this.probe ??= this.createProbe());
    probe.el.style.color = '';
    probe.el.style.color = c.startsWith('--') ? `var(${c})` : c;
    const computed = getComputedStyle(probe.el).color;
    const ctx = probe.ctx;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#2160cc';
    ctx.fillStyle = computed;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${((a / 255) * alpha).toFixed(3)})`;
  }

  private probe?: { el: HTMLElement; ctx: CanvasRenderingContext2D };

  private createProbe(): { el: HTMLElement; ctx: CanvasRenderingContext2D } {
    const el = this.doc.createElement('span');
    el.style.display = 'none';
    this.doc.body.appendChild(el);
    const canvas = this.doc.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return { el, ctx };
  }

  private draw(labels: string[], series: ChartSeries[]): void {
    const mobile = this.phone();
    const datasets: ChartDataset<'line', (number | null)[]>[] = series.map((s) => {
      const color = this.color(s.color);
      const ds: ChartDataset<'line', (number | null)[]> & { tbOrigin?: string; tbSetpoint?: boolean } = {
        label: s.label,
        data: s.values.map((v) => (v == null ? null : Math.round((this.valueUnit() != null ? v : this.unit.fromCelsius(v)) * 10) / 10)),
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        spanGaps: true,
        tbOrigin: color,
        tbSetpoint: s.role === 'setpoint',
      };
      if (s.role === 'setpoint') {
        ds.stepped = true;
        ds.borderDash = [8, 6];
        ds.pointRadius = 0;
      } else if (s.role === 'average') {
        ds.borderWidth = 4;
      }
      return ds;
    });
    const options = this.options(mobile, series.length);
    const visible = this.chart ? this.chart.data.datasets.map((_, i) => this.chart!.isDatasetVisible(i)) : [];
    if (this.chart && this.chart.data.datasets.length === datasets.length) {
      this.chart.data.labels = labels;
      this.chart.data.datasets = datasets;
      this.chart.options = options;
      visible.forEach((v, i) => this.chart!.setDatasetVisibility(i, series[i].hidden != null ? !series[i].hidden : v));
      this.chart.update();
      this.read(null);
      return;
    }
    this.chart?.destroy();
    this.chart = new Chart(this.canvas().nativeElement, { type: 'line', data: { labels, datasets }, options, plugins: [crosshair] });
    if (series.some((s) => s.hidden)) {
      series.forEach((s, i) => this.chart!.setDatasetVisibility(i, !s.hidden));
      this.chart.update('none');
    }
    this.read(null);
  }

  private options(mobile: boolean, n: number): ChartOptions<'line'> {
    const text = this.color('--md-on-surface-variant');
    const grid = this.color('--md-outline-variant');
    const font = { family: 'Manrope, "Segoe UI", system-ui, sans-serif', size: mobile ? 11 : 13 };
    const symbol = this.valueUnit() ?? this.unit.symbol();
    const animate = this.prefs.animate();
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: mobile ? 8 : 4, right: mobile ? 0 : 4, bottom: 0, left: 0 } },
      // Phones: shorter (each frame of it redraws the whole chart, during the page transition)
      // Many curves (the measurements page): drawn at once, an animation of each would cost more
      // than it shows
      animation: animate && n <= MAX_ANIMATED ? { duration: mobile ? 450 : 900, easing: 'easeOutQuart' } : false,
      normalized: true,
      interaction: { mode: 'index', intersect: false },
      // Phones: the values under the finger go to the reading strip; lifted, back to the last ones
      onHover: mobile
        ? (_e, active) => {
            this.read(active.length ? active[0].index : null);
          }
        : undefined,
      events: mobile ? ['mousemove', 'mouseout', 'touchstart', 'touchmove', 'touchend'] : undefined,
      elements: {
        point: { radius: 0, hoverRadius: 6, hitRadius: 12 },
        line: { tension: 0.4, borderWidth: mobile ? 2.5 : 3, borderCapStyle: 'round' },
      },
      plugins: {
        tbCrosshair: { color: this.color('--md-on-surface-variant', 0.55) },
        legend: {
          // Phones: the reading strip above says which curve is which and toggles them
          display: !mobile && n > 0,
          position: mobile ? 'bottom' : 'top',
          align: 'start',
          labels: { color: text, font: font, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: mobile ? 12 : 20 },
          onClick: (_e, item, legend) => {
            const i = item.datasetIndex ?? 0;
            const chart = legend.chart;
            const visible = !chart.isDatasetVisible(i);
            chart.setDatasetVisibility(i, visible);
            chart.update();
            this.toggled.emit({ index: i, visible });
          },
        },
        tooltip: {
          enabled: !mobile,
          mode: 'index',
          intersect: false,
          titleFont: font,
          bodyFont: font,
          padding: 12,
          cornerRadius: 12,
          backgroundColor: this.color('--md-inverse-surface'),
          titleColor: this.color('--md-inverse-on-surface'),
          bodyColor: this.color('--md-inverse-on-surface'),
          usePointStyle: true,
          boxPadding: 4,
          callbacks: {
            label: (ctx) => {
              const y = ctx.parsed.y;
              if (y == null) return '';
              return ` ${ctx.dataset.label} : ${y.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${symbol}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: grid },
          ticks: {
            color: text,
            font: { ...font, size: mobile ? 10.5 : 13 },
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
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          // Phones: the figures inside the chart, over the grid lines, so the curves get the width
          position: mobile ? 'right' : 'left',
          ticks: {
            color: text,
            font: font,
            padding: mobile ? 4 : 10,
            mirror: mobile,
            z: 1,
            maxTicksLimit: mobile ? 6 : 7,
            callback: (v) => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${this.valueUnit() != null ? ' ' + this.valueUnit() : '°'}`,
          },
          ...(this.yMin() != null ? { min: this.yMin()! } : {}),
        },
      },
    };
  }
}
