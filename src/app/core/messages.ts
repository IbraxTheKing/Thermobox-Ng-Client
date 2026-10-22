import { Injectable, signal } from '@angular/core';

import { natifMessages } from './android-natif';

export type Gravite = 'info' | 'warn' | 'error';

export interface Toast {
  id: number;
  gravite: Gravite;
  titre: string;
  detail?: string | null;
}

/** Notifications (p:growl of the JSF interface): a title, an optional detail, gone after a while. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private suivant = 1;

  info(titre: string, detail?: string | null): void {
    this.ajouter('info', titre, detail);
  }

  warn(titre: string, detail?: string | null): void {
    this.ajouter('warn', titre, detail);
  }

  error(titre: string, detail?: string | null): void {
    this.ajouter('error', titre, detail, 7000);
  }

  fermer(id: number): void {
    this.toasts.update((l) => l.filter((t) => t.id !== id));
  }

  private ajouter(gravite: Gravite, titre: string, detail?: string | null, duree = 4500): void {
    // Android app: a Material snackbar, above the navigation bar
    if (natifMessages) {
      natifMessages.snackbar(detail ? `${titre} — ${detail}` : titre, gravite === 'error' || !!detail);
      return;
    }
    const id = this.suivant++;
    // At most three at once: the oldest goes
    this.toasts.update((l) => [...l.slice(-2), { id, gravite, titre, detail }]);
    setTimeout(() => this.fermer(id), duree + (detail ? 1500 : 0));
  }
}

export interface Confirmation {
  titre: string;
  message: string;
  /** Label of the confirming button. */
  confirmer?: string;
  danger?: boolean;
  resoudre: (ok: boolean) => void;
}

/** "Are you sure?" before deleting (p:confirm). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly courante = signal<Confirmation | null>(null);

  demander(titre: string, message: string, options: { confirmer?: string; danger?: boolean } = {}): Promise<boolean> {
    // Android app: a Material dialog
    if (natifMessages) return natifMessages.confirmer(titre, message, options.confirmer ?? 'Confirmer', options.danger ?? true);
    this.courante()?.resoudre(false);
    return new Promise((resoudre) => {
      this.courante.set({ titre, message, confirmer: options.confirmer ?? 'Confirmer', danger: options.danger ?? true, resoudre });
    });
  }

  repondre(ok: boolean): void {
    const c = this.courante();
    this.courante.set(null);
    c?.resoudre(ok);
  }
}
