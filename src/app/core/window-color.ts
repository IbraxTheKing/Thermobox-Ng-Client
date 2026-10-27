import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * The colour of the window follows the page: <meta name="theme-color">, which an installed web
 * app (Chrome, Edge on Windows, macOS, ChromeOS; Safari on macOS) uses for its title bar, and
 * mobile browsers for their bars. The page colour is the canvas (--tb-background: theme, look)
 * under the tint of « Maison » (a room's temperature, the dial being turned: BackgroundService),
 * read from what the browser shows, and faded to in a few steps as the page fades.
 */
@Injectable({ providedIn: 'root' })
export class WindowColorService {
  private readonly doc = inject(DOCUMENT);
  private readonly root = this.doc.documentElement;
  private meta: HTMLMetaElement | null = null;
  private shown: [number, number, number] | null = null;
  private frame = 0;
  private fading = 0;
  private probe?: { el: HTMLElement; ctx: CanvasRenderingContext2D };

  start(): void {
    this.meta = this.doc.querySelector('meta[name="theme-color"]');
    if (!this.meta) return;
    // Theme, look, colours following the state, tint of the page: the window follows
    new MutationObserver(() => this.schedule()).observe(this.root, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-style', 'data-tint', 'data-tone', 'data-background', 'data-platform', 'data-accent'],
    });
    this.schedule();
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    // After the styles of the change are applied
    this.frame = requestAnimationFrame(() => this.update());
  }

  private update(): void {
    const target = this.pageColor();
    if (!target) return;
    const from = this.shown;
    clearInterval(this.fading);
    if (!from || this.root.dataset['motion'] === 'off') {
      this.apply(target);
      return;
    }
    // A few steps over the time the page takes to fade (.8 s): the title bar does not jump
    const steps = 8;
    let k = 0;
    this.fading = window.setInterval(() => {
      k++;
      const t = k / steps;
      this.apply([0, 1, 2].map((i) => Math.round(from[i] + (target[i] - from[i]) * t)) as [number, number, number]);
      if (k >= steps) clearInterval(this.fading);
    }, 90);
  }

  private apply(c: [number, number, number]): void {
    this.shown = c;
    this.meta?.setAttribute('content', '#' + c.map((n) => n.toString(16).padStart(2, '0')).join(''));
  }

  /** The canvas, with the tint of the page over it when it shows. */
  private pageColor(): [number, number, number] | null {
    const canvas = this.rgba(getComputedStyle(this.root).backgroundColor);
    if (!canvas) return null;
    const layer = this.doc.querySelector<HTMLElement>('.tb-background-page');
    const tint = this.root.dataset['background'];
    if (!tint || !layer || getComputedStyle(layer).display === 'none') return [canvas[0], canvas[1], canvas[2]];
    // The colour it fades to, not the one it is passing through
    const t = this.rgba(tint);
    if (!t) return [canvas[0], canvas[1], canvas[2]];
    const a = t[3];
    return [0, 1, 2].map((i) => Math.round(t[i] * a + canvas[i] * (1 - a))) as [number, number, number];
  }

  /** Any CSS colour (color-mix(), oklch()…) as sRGB 0-255 and alpha 0-1, drawn by the browser. */
  private rgba(color: string): [number, number, number, number] | null {
    this.probe ??= (() => {
      const el = this.doc.createElement('span');
      el.style.display = 'none';
      this.doc.body.appendChild(el);
      const canvas = this.doc.createElement('canvas');
      canvas.width = canvas.height = 1;
      return { el, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
    })();
    const { el, ctx } = this.probe;
    el.style.color = '';
    el.style.color = color;
    const computed = getComputedStyle(el).color;
    if (!computed) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = computed;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  }
}
