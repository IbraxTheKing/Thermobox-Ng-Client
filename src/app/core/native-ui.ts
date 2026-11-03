import { Injectable } from '@angular/core';

/** Tab of a native bar: id = address of the page, icon = name of a drawable of the app. */
export interface NativeTab {
  id: string;
  label: string;
  icon: string;
  badge?: boolean;
}

/** The bar at the bottom (phone held upright) or the rail on the left (tablet, phone sideways). */
export type BarMode = 'bottom' | 'rail';

/** A line of a native menu (a sheet that is a menu). */
export interface NativeMenuOption {
  id: string;
  label: string;
  icon: string;
  danger: boolean;
  checked?: boolean;
}

/**
 * The native components of a mobile app that the page uses in the place of its own: in the
 * Android app, Material 3 (platforms/android/: its menus as bottom sheets, its snackbars and
 * dialogs). Nothing here: the web, iOS and the desktop apps draw their own.
 */
@Injectable({ providedIn: 'root' })
export class NativeUi {
  /** The native components are there. */
  readonly active: boolean = false;
  /** The drawable of the app for an icon of the page (its classes: « pi pi-users »). */
  icon(classes: string, fallback = 'add'): string {
    void classes;
    return fallback;
  }
  /** A sheet that is a menu, as a native one: the id of the line picked, null if dismissed. */
  readonly menu: ((title: string, subtitle: string, options: NativeMenuOption[]) => Promise<string | null>) | null = null;
  /** Toasts and confirmations as native ones (snackbar, dialog). */
  readonly messages: {
    snackbar(text: string, long: boolean): void;
    confirm(title: string, message: string, confirm: string, danger: boolean): Promise<boolean>;
  } | null = null;
}

/**
 * The native navigation bar of a mobile app (the Android app: Material 3, under the page), set by
 * the shell; nothing here: the page draws its own.
 */
@Injectable({ providedIn: 'root' })
export class NativeBar {
  readonly active: boolean = false;
  /** Its tabs, the one of the page shown, whether it is there, what a tab does, where it goes. */
  configureBar(tabs: NativeTab[], activeId: string | null, visible: boolean, onTab: (id: string, repeated: boolean) => void, mode: BarMode = 'bottom'): void {
    void tabs;
    void activeId;
    void visible;
    void onTab;
    void mode;
  }
  /** The shell is gone (logout): nothing native stays on screen. */
  leave(): void {
    // Nothing on the web
  }
}
