import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { ServerService, readableAddress } from '../core/api.config';
import { downloadFile } from '../core/file';
import { ToastService } from '../core/messages';
import { UserRole } from '../models/models';
import { TrPipe } from './tr.pipe';

/** An account and its provisional password, to hand to its owner. */
export interface Handover {
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  password: string;
  expiresAt: string | null;
}

/**
 * Provisional passwords, shown once (the server keeps only their hashes): to copy, to download
 * as a CSV file, or to print, one sheet per person to cut out (name, server, username, password,
 * end of validity). Nothing is kept by the client either: once closed, they are gone.
 */
@Component({
  selector: 'tb-password-handover',
  imports: [TrPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tb-message tb-message-warn tb-handover-warning" role="note">
      <i class="pi pi-lock"></i>
      <div i18n>
        <strong>Ces mots de passe ne seront plus affichés</strong>Remets-les à chaque personne (fiche imprimée, en main propre) ; chacun
        choisira le sien à sa première connexion. Ne les envoie pas en clair par courriel ou messagerie de groupe.
      </div>
    </div>
    <div class="tb-handover-actions">
      <button i18n type="button" class="tb-btn tb-tonal" (click)="print()"><i class="pi pi-print"></i>Imprimer les fiches</button>
      <button i18n type="button" class="tb-btn tb-flat" (click)="download()"><i class="pi pi-download"></i>Télécharger (CSV)</button>
      <button i18n type="button" class="tb-btn tb-flat" (click)="copyAll()"><i class="pi pi-copy"></i>Tout copier</button>
    </div>
    <div class="tb-table tb-handover-table">
      <table>
        <thead>
          <tr>
            <th i18n>Utilisateur</th>
            <th i18n>Personne</th>
            <th i18n>Mot de passe provisoire</th>
          </tr>
        </thead>
        <tbody>
          @for (a of accounts(); track a.username) {
            <tr>
              <td><strong>{{ a.username }}</strong></td>
              <td>{{ a.name }}@if (a.email) {<span class="tb-muted tb-handover-mail">{{ a.email }}</span>}</td>
              <td>
                <span class="tb-handover-password">
                  <code>{{ a.password }}</code>
                  <button type="button" class="tb-btn tb-icon tb-flat tb-btn-sm" [attr.aria-label]="('Copier le mot de passe de ' | tr) + a.username" (click)="copy(a)">
                    <i class="pi" [class.pi-copy]="copied() !== a.username" [class.pi-check]="copied() === a.username"></i>
                  </button>
                </span>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    @if (expires(); as at) {
      <p class="tb-muted tb-handover-expiry"><i class="pi pi-clock"></i><span i18n>Valables jusqu'au {{ at | date: 'd MMMM y, HH:mm' }}.</span></p>
    }
  `,
})
export class TbPasswordHandover {
  readonly accounts = input.required<Handover[]>();
  private readonly toasts = inject(ToastService);
  private readonly server = inject(ServerService);
  protected readonly copied = signal<string | null>(null);
  protected readonly expires = computed(() => {
    const at = this.accounts().find((a) => a.expiresAt)?.expiresAt;
    return at ? new Date(at) : null;
  });

  protected async copy(a: Handover): Promise<void> {
    await navigator.clipboard?.writeText(a.password);
    this.copied.set(a.username);
    setTimeout(() => this.copied() === a.username && this.copied.set(null), 1500);
  }

  protected async copyAll(): Promise<void> {
    const text = this.accounts().map((a) => `${a.name || a.username}\t${a.username}\t${a.password}`).join('\n');
    await navigator.clipboard?.writeText(text);
    this.toasts.info($localize`${this.accounts().length} mot(s) de passe copié(s)`);
  }

  /** CSV as Excel reads it in this language (`;` in French), with its BOM. */
  protected download(): void {
    const sep = document.documentElement.lang.startsWith('fr') ? ';' : ',';
    const cell = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const head = [$localize`Utilisateur`, $localize`Personne`, $localize`Adresse e-mail`, $localize`Mot de passe provisoire`, $localize`Valable jusqu'au`];
    const lines = [head, ...this.accounts().map((a) => [a.username, a.name, a.email, a.password, a.expiresAt ? new Date(a.expiresAt).toLocaleString() : ''])];
    void downloadFile($localize`mots-de-passe-provisoires.csv`, '﻿' + lines.map((l) => l.map(cell).join(sep)).join('\r\n'), 'text/csv;charset=utf-8');
  }

  /** One sheet per person, in a window of its own, printed then closed. */
  protected print(): void {
    const server = readableAddress(this.server.base());
    const esc = (v: string | null) => (v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const until = (at: string | null) => (at ? new Date(at).toLocaleString() : '');
    const cards = this.accounts()
      .map(
        (a) => `<section><h1>${esc(a.name || a.username)}</h1>
        <dl><dt>${esc($localize`Serveur ThermoBox`)}</dt><dd>${esc(server)}</dd>
        <dt>${esc($localize`Nom d'utilisateur`)}</dt><dd>${esc(a.username)}</dd>
        <dt>${esc($localize`Mot de passe provisoire`)}</dt><dd class="pw">${esc(a.password)}</dd>
        ${a.expiresAt ? `<dt>${esc($localize`Valable jusqu'au`)}</dt><dd>${esc(until(a.expiresAt))}</dd>` : ''}</dl>
        <p>${esc($localize`À ta première connexion, ThermoBox te demandera de choisir ton propre mot de passe.`)}</p></section>`,
      )
      .join('');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8"><title>ThermoBox</title><style>
      body{font:12pt system-ui,sans-serif;margin:0}section{break-inside:avoid;border:1px dashed #999;border-radius:8px;padding:14px 18px;margin:10mm}
      h1{font-size:15pt;margin:0 0 8px}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0 0 8px}dt{color:#555}dd{margin:0;font-weight:600}
      .pw{font:600 15pt ui-monospace,Consolas,monospace;letter-spacing:.05em}p{margin:0;color:#444;font-size:10pt}</style></head><body>${cards}</body></html>`);
    doc.close();
    const done = () => setTimeout(() => frame.remove(), 1000);
    frame.contentWindow!.onafterprint = done;
    setTimeout(() => {
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      done();
    }, 100);
  }
}
