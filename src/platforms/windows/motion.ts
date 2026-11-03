import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

import { PageMotion } from '../../app/core/page-motion';

/**
 * The Windows app moves as a WinUI 3 app (windows.css): the new page comes in as one block, as a
 * Frame (html.tb-win-entering: it rises a little and fades in, a third of a second), its parts
 * don't come one after the other. Between the overview and a room, the card morphs as on the web.
 */
@Injectable()
export class WindowsMotion implements PageMotion {
  private readonly root = inject(DOCUMENT).documentElement;
  private timer?: ReturnType<typeof setTimeout>;

  entrance(): boolean {
    clearTimeout(this.timer);
    this.root.classList.remove('tb-win-entering');
    void this.root.offsetWidth;
    this.root.classList.add('tb-win-entering');
    // Only while it runs: a transform left on the page would hold what is fixed inside it
    this.timer = setTimeout(() => this.root.classList.remove('tb-win-entering'), 420);
    return true;
  }
}
