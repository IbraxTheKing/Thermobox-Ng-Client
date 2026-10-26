import { Injectable, signal } from '@angular/core';

import { nativeMessages } from './android-native';

export type Severity = 'info' | 'warn' | 'error';

export interface Toast {
  id: number;
  severity: Severity;
  title: string;
  detail?: string | null;
}

/** Notifications (p:growl of the JSF interface): a title, an optional detail, gone after a while. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private next = 1;

  info(title: string, detail?: string | null): void {
    this.add('info', title, detail);
  }

  warn(title: string, detail?: string | null): void {
    this.add('warn', title, detail);
  }

  error(title: string, detail?: string | null): void {
    this.add('error', title, detail, 7000);
  }

  close(id: number): void {
    this.toasts.update((l) => l.filter((t) => t.id !== id));
  }

  private add(severity: Severity, title: string, detail?: string | null, duration = 4500): void {
    // Android app: a Material snackbar, above the navigation bar
    if (nativeMessages) {
      nativeMessages.snackbar(detail ? `${title} — ${detail}` : title, severity === 'error' || !!detail);
      return;
    }
    const id = this.next++;
    // At most three at once: the oldest goes
    this.toasts.update((l) => [...l.slice(-2), { id, severity, title, detail }]);
    setTimeout(() => this.close(id), duration + (detail ? 1500 : 0));
  }
}

export interface Confirmation {
  title: string;
  message: string;
  /** Label of the confirming button. */
  confirm?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

/** "Are you sure?" before deleting (p:confirm). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<Confirmation | null>(null);

  ask(title: string, message: string, options: { confirm?: string; danger?: boolean } = {}): Promise<boolean> {
    // Android app: a Material dialog
    if (nativeMessages) return nativeMessages.confirm(title, message, options.confirm ?? 'Confirmer', options.danger ?? true);
    this.current()?.resolve(false);
    return new Promise((resolve) => {
      this.current.set({ title, message, confirm: options.confirm ?? 'Confirmer', danger: options.danger ?? true, resolve });
    });
  }

  answer(ok: boolean): void {
    const c = this.current();
    this.current.set(null);
    c?.resolve(ok);
  }
}
