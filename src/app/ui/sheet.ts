import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { nativeMenu } from '../core/android-native';

let next = 0;

/** Sheets open at once (one may open while another closes): the page scrolls again at 0. */
let locks = 0;
function lock(doc: Document): void {
  if (locks++ === 0) doc.body.style.overflow = 'hidden';
}
function release(doc: Document): void {
  locks = Math.max(0, locks - 1);
  if (locks === 0) doc.body.style.overflow = '';
}

/** Longest closing animation (controls.css): past it, the sheet is gone even without animationend. */
const CLOSING_DURATION = 320;

/**
 * A dialog (p:dialog): centred on wide screens, a sheet from the bottom of the screen on phones,
 * restyled per platform (iOS: floating glass sheet; Android: Material bottom sheet). Closes with
 * Escape, a tap outside, the × (wide screens only) or by dragging the sheet down: on a phone, the
 * grabber and the « Annuler » of the form say it, as in native apps.
 *
 * While open, the page under it does not scroll; that lock is always given back, also when the
 * sheet goes away with its page (an action of the sheet that opens another page).
 *
 * [nativeMenu]: in the Android app, a sheet that is a menu (a head and .tb-sheet-item rows) opens
 * as a native Material bottom sheet, built from those rows; picking one clicks it. A row marked
 * data-native-web opens the web sheet instead (for what only the page can show: a form…).
 *
 *   <tb-sheet [(open)]="dialog" title="Ajouter">…<div class="tb-actions">…</div></tb-sheet>
 */
@Component({
  selector: 'tb-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="tb-scrim" [class.tb-scrim-closed]="closing()" [class.tb-sheet-native]="isNative()" (pointerdown)="backdropPress($event)" (click)="backdropClick($event)" (keydown.escape)="close()">
        <section
          #box
          class="tb-dialog"
          [class.tb-closing]="closing()"
          [style.--tb-dialog-w.px]="width()"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          [attr.aria-hidden]="isNative() ? true : null"
          tabindex="-1"
          (animationend)="animationEnd($event)"
          (touchstart)="slideStart($event)"
        >
          <div class="tb-grabber" aria-hidden="true"></div>
          @if (title() || !noHeader()) {
            <header class="tb-dialog-head">
              <h2 [id]="titleId">{{ title() }}</h2>
              <button type="button" class="tb-btn tb-icon tb-flat tb-dialog-close" (click)="close()" title="Fermer" aria-label="Fermer">
                <i class="pi pi-times"></i>
              </button>
            </header>
          }
          <div class="tb-dialog-body">
            <ng-content />
          </div>
        </section>
      </div>
    }
  `,
})
export class TbSheet {
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  readonly open = model(false);
  readonly title = input('');
  readonly width = input(440);
  readonly noHeader = input(false, { transform: booleanAttribute });
  /** Android app: a native Material menu built from the .tb-sheet-item rows. */
  readonly nativeMenu = input(false, { transform: booleanAttribute });

  protected readonly titleId = `tb-sheet-title-${++next}`;
  protected readonly visible = signal(false);
  protected readonly closing = signal(false);
  /** Shown as a native menu: the web sheet is there (its rows are clicked) but not seen. */
  protected readonly isNative = signal(false);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private focusBefore: HTMLElement | null = null;
  /** The touch that began on the dark background around the sheet. */
  private backdropTouched = false;
  private locked = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? this.show() : this.visible() && this.startClosing()));
    });
    // Gone with its page (an action of the sheet opened another one): the page scrolls again
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.unlock();
    });
  }

  close(): void {
    this.open.set(false);
  }

  private show(): void {
    clearTimeout(this.timer);
    this.focusBefore = this.doc.activeElement as HTMLElement | null;
    this.closing.set(false);
    const native = this.nativeMenu() && !!nativeMenu;
    this.isNative.set(native);
    this.visible.set(true);
    if (native) {
      afterNextRender({ read: () => void this.openNativeMenu() }, { injector: this.injector });
      return;
    }
    this.lock();
    afterNextRender({ read: () => this.box()?.nativeElement.focus({ preventScroll: true }) }, { injector: this.injector });
  }

  private startClosing(): void {
    if (this.isNative()) {
      this.finish();
      return;
    }
    this.closing.set(true);
    // Closed even if the animation does not end (reduced motion, page hidden…)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), CLOSING_DURATION);
  }

  protected animationEnd(e: AnimationEvent): void {
    // Only the sheet's own closing animation (its content has animations of its own)
    if (e.target !== e.currentTarget || !this.closing()) return;
    this.finish();
  }

  private finish(): void {
    clearTimeout(this.timer);
    if (!this.visible()) return;
    this.visible.set(false);
    this.closing.set(false);
    this.isNative.set(false);
    this.unlock();
    if (this.focusBefore?.isConnected) this.focusBefore.focus?.({ preventScroll: true });
  }

  private lock(): void {
    if (this.locked) return;
    this.locked = true;
    lock(this.doc);
  }

  private unlock(): void {
    if (!this.locked) return;
    this.locked = false;
    release(this.doc);
  }

  /**
   * A tap outside the sheet only closes it. Closed on the click, not on the press: closing as the
   * finger touched let the end of that same tap go through to whatever was under the sheet.
   */
  protected backdropPress(e: PointerEvent): void {
    this.backdropTouched = e.target === e.currentTarget;
  }

  protected backdropClick(e: MouseEvent): void {
    const outside = this.backdropTouched && e.target === e.currentTarget;
    this.backdropTouched = false;
    if (!outside) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  }

  // ---------------------------------------------------------------- native menu (Android app)

  private async openNativeMenu(): Promise<void> {
    const box = this.box()?.nativeElement;
    if (!box || !nativeMenu) return;
    const items = [...box.querySelectorAll<HTMLElement>('.tb-sheet-item')];
    if (!items.length) {
      // Not a menu after all: the web sheet
      this.toWeb();
      return;
    }
    const head = box.querySelector('.tb-sheet-head, [data-menu-head]');
    const title = this.title() || head?.querySelector('strong')?.textContent?.trim() || '';
    const subtitle = (box.querySelector('[data-menu-subtitle]') ?? head?.querySelector('.tb-muted'))?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const choice = await nativeMenu(
      title,
      subtitle,
      items.map((el, i) => ({
        id: String(i),
        label: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        icon: el.querySelector('.pi')?.className ?? '',
        danger: el.classList.contains('tb-sheet-danger'),
      })),
    );
    if (!this.visible() || !this.isNative()) return;
    const el = choice == null ? null : items[+choice];
    if (el?.hasAttribute('data-native-web')) {
      this.toWeb();
      return;
    }
    el?.click();
    this.close();
  }

  /** The web sheet itself, after all. */
  private toWeb(): void {
    this.isNative.set(false);
    this.lock();
  }

  // ---------------------------------------------------------------- swipe down to close

  /**
   * Phones: the whole sheet follows the finger down, from anywhere on it (its rows and buttons
   * too: the tap that started the drag is then not a tap), as long as what is under the finger is
   * scrolled to its top. Let go far or fast enough and it closes; else it springs back.
   */
  protected slideStart(e: TouchEvent): void {
    const box = this.box()?.nativeElement;
    if (!box || e.touches.length !== 1 || innerWidth > 640) return;
    const target = e.target as HTMLElement;
    // What takes the finger itself: a slider, text being selected, a chart
    if (target.closest('input[type="range"], textarea, .tb-chart-view, [data-no-gesture]')) return;
    // Something scrolled under the finger scrolls back up first
    for (let el: HTMLElement | null = target; el && el !== box.parentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return;
    }
    const t0 = e.touches[0];
    const g: { x: number; y: number; dy: number; t: number; vy: number; mode: '?' | 'oui' | 'non' } = { x: t0.clientX, y: t0.clientY, dy: 0, t: e.timeStamp, vy: 0, mode: '?' };

    const move = (ev: TouchEvent) => {
      const t = ev.touches[0];
      const dy = t.clientY - g.y;
      if (g.mode === '?') {
        if (Math.hypot(t.clientX - g.x, dy) < 8) return;
        g.mode = dy > 0 && Math.abs(dy) > Math.abs(t.clientX - g.x) ? 'oui' : 'non';
        if (g.mode === 'non') {
          finish();
          return;
        }
        box.style.transition = 'none';
        // Not a tap on the row the finger started on
        (this.doc.activeElement as HTMLElement | null)?.blur?.();
      }
      ev.preventDefault();
      const dt = Math.max(1, ev.timeStamp - g.t);
      g.vy = (Math.max(0, dy) - g.dy) / dt;
      g.dy = Math.max(0, dy);
      g.t = ev.timeStamp;
      box.style.transform = `translateY(${g.dy}px)`;
    };
    const release = () => {
      finish();
      if (g.mode !== 'oui') return;
      // The click that ends the drag must not press the button under the finger
      const swallow = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      this.doc.addEventListener('click', swallow, true);
      setTimeout(() => this.doc.removeEventListener('click', swallow, true), 350);
      box.style.transition = 'transform .28s cubic-bezier(.2, 0, 0, 1)';
      if (g.dy > box.offsetHeight / 3 || g.vy > 0.6) {
        box.style.transform = 'translateY(105%)';
        setTimeout(() => {
          box.style.transition = '';
          box.style.transform = '';
          this.open.set(false);
          this.finish();
        }, 260);
      } else {
        box.style.transform = '';
        setTimeout(() => (box.style.transition = ''), 280);
      }
    };
    const finish = () => {
      this.doc.removeEventListener('touchmove', move);
      this.doc.removeEventListener('touchend', release);
      this.doc.removeEventListener('touchcancel', release);
    };
    this.doc.addEventListener('touchmove', move, { passive: false });
    this.doc.addEventListener('touchend', release);
    this.doc.addEventListener('touchcancel', release);
  }
}
