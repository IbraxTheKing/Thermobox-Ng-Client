import { ChangeDetectionStrategy, Component } from '@angular/core';

/** macOS: a strip to drag the window by, under the traffic lights (the page is under the title bar). */
@Component({
  selector: 'tb-mac-drag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `<div class="tb-mac-drag" data-tauri-drag-region aria-hidden="true"></div>`,
})
export class TbMacDrag {}
