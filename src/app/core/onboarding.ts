import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { AuthService } from './auth';

/** Raised when the guide changes enough to be worth showing again to everyone. */
const VERSION = 1;
const KEY = 'tb-guide';

/**
 * The guide of a first visit (TbOnboardingGuide): shown once per account on this device, after
 * the first login (and after the provisional password is replaced), skippable at any step,
 * replayed from Préférences › Divers. Its steps depend on the role of the account.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly auth = inject(AuthService);

  /** Shown now. */
  readonly open = signal(false);
  private readonly seen = signal<Record<string, number>>(read());

  /** The account has not seen this version of the guide on this device. */
  readonly due = computed(() => {
    const key = this.auth.key();
    return !!key && !this.auth.mustChangePassword() && (this.seen()[key] ?? 0) < VERSION;
  });

  constructor() {
    // A little after the first page of the account has appeared
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      clearTimeout(timer);
      if (this.due()) timer = setTimeout(() => untracked(() => this.due() && this.open.set(true)), 700);
    });
  }

  /** From Préférences: again, from its first step. */
  start(): void {
    this.open.set(true);
  }

  /** Ended or skipped: not shown again to this account on this device. */
  done(): void {
    this.open.set(false);
    const key = this.auth.key();
    if (!key) return;
    this.seen.update((s) => ({ ...s, [key]: VERSION }));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.seen()));
    } catch {
      /* private browsing: shown again next time */
    }
  }
}

function read(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
