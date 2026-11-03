import { Injectable, computed } from '@angular/core';

import { TauriDesktopService } from '../desktop/desktop.service';

/**
 * Windows 11: the Acrylic of the system behind the window, and the blur of the bars of the page
 * (html[data-blur="off"]: windows.css). html[data-backdrop="acrylic"] once Windows draws it: the
 * side bar and the title bar are left clear for it.
 */
export async function applyAcrylic(on: boolean): Promise<void> {
  const root = document.documentElement;
  if (on) delete root.dataset['blur'];
  else root.dataset['blur'] = 'off';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const shown = await invoke<boolean>('window_acrylic', { on });
    if (shown) root.dataset['backdrop'] = 'acrylic';
    else delete root.dataset['backdrop'];
  } catch {
    delete root.dataset['backdrop'];
  }
}

/** The Windows app: its title bar is the page's (titlebar.ts), in the WinUI 3 style. */
@Injectable()
export class WindowsDesktopService extends TauriDesktopService {
  override readonly name = computed(() => $localize`Windows`);

  protected override async listen(): Promise<void> {
    await super.listen();
    // (index.html has already told main.rs that the page draws its title bar)
    await this.followMaximized();
  }

  /** Windows 11: the snap layouts, as a native maximize button shows them under the pointer. */
  async snapLayouts(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('snap_layouts');
  }
}
