import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { errorMessage } from '../core/api.config';
import { ToastService } from '../core/messages';
import { PlatformService } from '../core/platform';
import { ImportCheck, ImportField, ImportResult, ImportRow, ImportSession, ROLES, UserRole } from '../models/models';
import { UserImportService } from '../services/user-import.service';
import { Handover, TbPasswordHandover } from './password-handover';
import { TbSheet } from './sheet';
import { TrPipe } from './tr.pipe';

type Step = 'source' | 'columns' | 'check' | 'done';

/** The fields of an account, in the order of the form. */
const FIELDS: { field: ImportField; label: string; hint: string }[] = [
  { field: 'FIRST_NAME', label: $localize`Prénom`, hint: '' },
  { field: 'LAST_NAME', label: $localize`Nom`, hint: '' },
  { field: 'EMAIL', label: $localize`Adresse e-mail`, hint: $localize`Sert à repérer les doublons` },
  { field: 'USERNAME', label: $localize`Nom d'utilisateur`, hint: $localize`Sans colonne : fait des prénom et nom (jdupont)` },
  { field: 'ROLE', label: $localize`Rôle`, hint: $localize`Administrateur, gestionnaire ou lecteur ; sinon le rôle par défaut` },
];

/**
 * Import of accounts (ADMIN): a list of people — an Excel or CSV file, or a database set on the
 * server — becomes accounts, each with a provisional password its owner replaces at the first
 * login. Four steps:
 *
 * 1. the list: a file dropped or picked, or a database;
 * 2. its columns: which one gives the first name, the name, the address… (suggested by the
 *    server from their names), the role of those without one, how long the passwords last;
 * 3. the check: each line to create, duplicate or invalid, and why; nothing written yet;
 * 4. the accounts created and their passwords, to hand over (TbPasswordHandover).
 */
@Component({
  selector: 'tb-user-import-sheet',
  imports: [TrPipe, TbSheet, TbPasswordHandover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tb-sheet [(open)]="shown" [title]="'Importer des utilisateurs' | tr" [width]="step() === 'source' ? 560 : 920" (openChange)="!$event && closed()">
      @if (platform.phone()) {
        <!-- Phones: where we are, and a bar of progress (the four steps don't fit on a line) -->
        <div class="tb-steps-compact">
          <span><strong>{{ steps[stepIndex()].label }}</strong> · {{ ('Étape ' | tr) + (stepIndex() + 1) + ('/' + steps.length) }}</span>
          <span class="tb-steps-bar" aria-hidden="true"><span [style.width.%]="((stepIndex() + 1) / steps.length) * 100"></span></span>
        </div>
      } @else {
      <ol class="tb-steps" i18n-aria-label aria-label="Étapes">
        @for (s of steps; track s.id; let i = $index) {
          <li [class.tb-step-on]="step() === s.id" [class.tb-step-done]="stepIndex() > i" [attr.aria-current]="step() === s.id ? 'step' : null">
            <span class="tb-step-n">{{ stepIndex() > i ? '✓' : i + 1 }}</span>{{ s.label }}
          </li>
        }
      </ol>
      }

      @switch (step()) {
        @case ('source') {
          <label class="tb-drop" [class.tb-drop-over]="over()" (dragover)="$event.preventDefault(); over.set(true)" (dragleave)="over.set(false)" (drop)="drop($event)">
            <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="pick($event)" [disabled]="busy()" />
            <i class="pi" [class.pi-file-excel]="!busy()" [class.pi-spinner]="busy()" [class.pi-spin]="busy()" aria-hidden="true"></i>
            @if (touch) {
              <strong i18n>Choisis un fichier Excel ou CSV</strong>
            } @else {
              <strong i18n>Dépose un fichier Excel ou CSV, ou clique pour le choisir</strong>
            }
            <span i18n class="tb-muted">Une ligne par personne, la première ligne donnant les noms des colonnes (Prénom, Nom, Courriel…). 10 Mo au plus.</span>
          </label>
          @if (sources().length) {
            <div class="tb-import-sources">
              <span i18n class="tb-label">Ou depuis une base de données du serveur</span>
              <div class="tb-import-source-list">
                @for (s of sources(); track s.name) {
                  <button type="button" class="tb-btn tb-tonal" [disabled]="busy()" (click)="readSource(s.name)"><i class="pi pi-database"></i>{{ s.name }}</button>
                }
              </div>
            </div>
          }
          @if (error(); as e) {
            <div class="tb-message tb-message-error" role="alert"><i class="pi pi-times-circle"></i><div>{{ e }}</div></div>
          }
          <p i18n class="tb-muted tb-import-privacy"><i class="pi pi-shield"></i> La liste reste sur le serveur le temps de l'import (une demi-heure au plus), elle n'est pas enregistrée.</p>
        }

        @case ('columns') {
          @if (session(); as s) {
            <p class="tb-muted">{{ ('Source : ' | tr) + s.source }} · {{ s.rowCount }} {{ s.rowCount > 1 ? ('lignes' | tr) : ('ligne' | tr) }}</p>
            <div class="tb-import-mapping">
              @for (f of fields; track f.field) {
                <div class="tb-field">
                  <label class="tb-label" [for]="'tb-map-' + f.field">{{ f.label }}</label>
                  <select class="tb-select" [id]="'tb-map-' + f.field" (change)="map(f.field, $any($event.target).value)">
                    <option i18n value="" [selected]="!mapping()[f.field]">— Aucune colonne —</option>
                    @for (c of s.columns; track c) {
                      <option [value]="c" [selected]="mapping()[f.field] === c">{{ c }}</option>
                    }
                  </select>
                  @if (f.hint) {
                    <span class="tb-field-hint">{{ f.hint }}</span>
                  }
                </div>
              }
              <div class="tb-field">
                <label i18n class="tb-label" for="tb-map-role">Rôle par défaut</label>
                <select id="tb-map-role" class="tb-select" (change)="defaultRole.set($any($event.target).value)">
                  @for (r of roles; track r) {
                    <option [value]="r" [selected]="defaultRole() === r">{{ roleName(r) }}</option>
                  }
                </select>
              </div>
              <div class="tb-field">
                <label i18n class="tb-label" for="tb-map-days">Validité des mots de passe provisoires</label>
                <select id="tb-map-days" class="tb-select" (change)="days.set(+$any($event.target).value)">
                  @for (d of dayChoices; track d) {
                    <option [value]="d" [selected]="days() === d">{{ d }} {{ d > 1 ? ('jours' | tr) : ('jour' | tr) }}</option>
                  }
                </select>
              </div>
            </div>
            <span i18n class="tb-label">Aperçu des premières lignes</span>
            <div class="tb-table tb-import-preview">
              <table>
                <thead>
                  <tr>
                    @for (c of s.columns; track c) {
                      <th [class.tb-col-used]="used().has(c)">{{ c }}@if (fieldOf(c); as f) {<span class="tb-tag tb-tag-info">{{ f }}</span>}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of s.sample; track $index) {
                    <tr>
                      @for (cell of row; track $index; let i = $index) {
                        <td [class.tb-col-used]="used().has(s.columns[i])">{{ cell }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!canCheck()) {
              <p i18n class="tb-field-error">Choisis au moins une colonne pour le nom d'utilisateur, ou pour le prénom ou le nom.</p>
            }
            @if (error(); as e) {
              <div class="tb-message tb-message-error" role="alert"><i class="pi pi-times-circle"></i><div>{{ e }}</div></div>
            }
            <div class="tb-actions">
              <button i18n type="button" class="tb-btn tb-flat tb-actions-start" (click)="restart()"><i class="pi pi-arrow-left"></i>Autre liste</button>
              <button i18n type="button" class="tb-btn" [disabled]="!canCheck() || busy()" (click)="runCheck()">
                <i class="pi" [class.pi-search]="!busy()" [class.pi-spinner]="busy()" [class.pi-spin]="busy()"></i>Vérifier les lignes
              </button>
            </div>
          }
        }

        @case ('check') {
          @if (check(); as c) {
            <div class="tb-summary tb-import-summary">
              <button type="button" class="tb-summary-chip tb-import-chip-ok" [class.tb-chip-on]="filter() === 'CREATE'" (click)="toggleFilter('CREATE')">
                <i class="pi pi-user-plus"></i>{{ 'À créer' | tr }}<span class="tb-chip-n">{{ c.create }}</span>
              </button>
              <button type="button" class="tb-summary-chip tb-import-chip-dup" [class.tb-chip-on]="filter() === 'DUPLICATE'" (click)="toggleFilter('DUPLICATE')">
                <i class="pi pi-clone"></i>{{ 'Doublons' | tr }}<span class="tb-chip-n">{{ c.duplicates }}</span>
              </button>
              <button type="button" class="tb-summary-chip tb-import-chip-bad" [class.tb-chip-on]="filter() === 'INVALID'" (click)="toggleFilter('INVALID')">
                <i class="pi pi-exclamation-triangle"></i>{{ 'Invalides' | tr }}<span class="tb-chip-n">{{ c.invalid }}</span>
              </button>
            </div>
            @if (platform.phone()) {
              <!-- Phones: one card per line, nothing cut off -->
              <ul class="tb-import-cards">
                @for (r of shownRows(); track r.line) {
                  <li [class]="'tb-import-' + r.status">
                    <div class="tb-import-card-head">
                      <strong>{{ r.username ?? '—' }}</strong>
                      @if (r.usernameMade) { <span i18n class="tb-tag">auto</span> }
                      @if (r.usernameAdjusted) { <span i18n class="tb-tag">ajusté</span> }
                      <span class="tb-muted tb-import-card-line">{{ ('Ligne ' | tr) + r.line }}</span>
                    </div>
                    <span>{{ personName(r) }} · {{ roleName(r.role) }}</span>
                    @if (r.email) {
                      <span class="tb-muted tb-import-card-mail">{{ r.email }}</span>
                    }
                    <span class="tb-import-state">
                      <i class="pi" [class.pi-check-circle]="r.status === 'CREATE'" [class.pi-clone]="r.status === 'DUPLICATE'" [class.pi-times-circle]="r.status === 'INVALID'"></i>{{ r.status === 'CREATE' ? ('Sera créé' | tr) : problems(r) }}
                    </span>
                  </li>
                }
              </ul>
            } @else {
            <div class="tb-table tb-import-check">
              <table>
                <thead>
                  <tr>
                    <th i18n class="tb-col-line">Ligne</th>
                    <th i18n>Utilisateur</th>
                    <th i18n>Personne</th>
                    <th i18n>Rôle</th>
                    <th i18n>État</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of shownRows(); track r.line) {
                    <tr [class]="'tb-import-' + r.status">
                      <td class="tb-col-line">{{ r.line }}</td>
                      <td>
                        <strong>{{ r.username ?? '—' }}</strong>
                        @if (r.usernameMade) { <span i18n class="tb-tag" title="Fait du prénom et du nom">auto</span> }
                        @if (r.usernameAdjusted) { <span i18n class="tb-tag" title="Accents, points et tirets enlevés">ajusté</span> }
                      </td>
                      <td>{{ personName(r) }}@if (r.email) {<span class="tb-muted tb-handover-mail">{{ r.email }}</span>}</td>
                      <td>{{ roleName(r.role) }}</td>
                      <td>
                        @switch (r.status) {
                          @case ('CREATE') { <span class="tb-import-state"><i class="pi pi-check-circle"></i>{{ 'Sera créé' | tr }}</span> }
                          @case ('DUPLICATE') { <span class="tb-import-state"><i class="pi pi-clone"></i>{{ problems(r) }}</span> }
                          @default { <span class="tb-import-state"><i class="pi pi-times-circle"></i>{{ problems(r) }}</span> }
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            }
            @if (filteredRows().length > shownRows().length) {
              <button type="button" class="tb-btn tb-flat tb-btn-sm" (click)="limit.set(limit() + 200)">{{ ('Afficher plus' | tr) + ' (' + (filteredRows().length - shownRows().length) + ')' }}</button>
            }
            <p i18n class="tb-muted">Les doublons et les lignes invalides ne seront pas importés. Corrige la liste puis relis-la, ou crée les autres comptes maintenant.</p>
            @if (error(); as e) {
              <div class="tb-message tb-message-error" role="alert"><i class="pi pi-times-circle"></i><div>{{ e }}</div></div>
            }
            <div class="tb-actions">
              <button i18n type="button" class="tb-btn tb-flat tb-actions-start" (click)="step.set('columns')"><i class="pi pi-arrow-left"></i>Colonnes</button>
              <button type="button" class="tb-btn" [disabled]="!c.create || busy()" (click)="confirm()">
                <i class="pi" [class.pi-user-plus]="!busy()" [class.pi-spinner]="busy()" [class.pi-spin]="busy()"></i>{{ busy() ? ('Création des comptes…' | tr) : ('Créer ' | tr) + c.create + (c.create > 1 ? (' comptes' | tr) : (' compte' | tr)) }}
              </button>
            </div>
          }
        }

        @case ('done') {
          @if (result(); as r) {
            <p class="tb-import-done">
              <i class="pi pi-check-circle"></i> {{ r.created.length }} {{ r.created.length > 1 ? ('comptes créés' | tr) : ('compte créé' | tr) }}
              @if (r.skipped.length) {
                <span class="tb-muted">· {{ r.skipped.length }} {{ 'ligne(s) laissée(s) de côté' | tr }}</span>
              }
            </p>
            @if (r.failed.length) {
              <div class="tb-message tb-message-error"><i class="pi pi-times-circle"></i><div>{{ ('Lignes non créées (erreur du serveur) : ' | tr) + failedLines() }}</div></div>
            }
            @if (handover().length) {
              <tb-password-handover [accounts]="handover()" />
            }
            <div class="tb-actions">
              <button i18n type="button" class="tb-btn" (click)="shown.set(false)"><i class="pi pi-check"></i>Terminé</button>
            </div>
          }
        }
      }
    </tb-sheet>
  `,
})
export class TbUserImportSheet {
  private readonly api = inject(UserImportService);
  private readonly toasts = inject(ToastService);
  protected readonly platform = inject(PlatformService);
  /** A finger, no mouse: nothing to drop, a file to choose. */
  protected readonly touch = matchMedia('(pointer: coarse)').matches;

  /** Accounts were created. */
  readonly imported = output<void>();

  protected readonly shown = signal(false);
  protected readonly step = signal<Step>('source');
  protected readonly steps: { id: Step; label: string }[] = [
    { id: 'source', label: $localize`Liste` },
    { id: 'columns', label: $localize`Colonnes` },
    { id: 'check', label: $localize`Vérification` },
    { id: 'done', label: $localize`Comptes` },
  ];
  protected readonly stepIndex = computed(() => this.steps.findIndex((s) => s.id === this.step()));
  protected readonly fields = FIELDS;
  protected readonly roles = ROLES;
  protected readonly dayChoices = [1, 3, 7, 14, 30];

  protected readonly busy = signal(false);
  protected readonly over = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sources = signal<{ name: string }[]>([]);
  protected readonly session = signal<ImportSession | null>(null);
  protected readonly mapping = signal<Partial<Record<ImportField, string>>>({});
  protected readonly defaultRole = signal<UserRole>('VIEWER');
  protected readonly days = signal(7);
  protected readonly check = signal<ImportCheck | null>(null);
  protected readonly filter = signal<ImportRow['status'] | null>(null);
  protected readonly limit = signal(200);
  protected readonly result = signal<ImportResult | null>(null);

  protected readonly used = computed(() => new Set(Object.values(this.mapping()).filter(Boolean) as string[]));
  protected readonly canCheck = computed(() => {
    const m = this.mapping();
    return !!(m.USERNAME || m.FIRST_NAME || m.LAST_NAME);
  });
  protected readonly filteredRows = computed(() => {
    const rows = this.check()?.rows ?? [];
    const f = this.filter();
    return f ? rows.filter((r) => r.status === f) : rows;
  });
  protected readonly shownRows = computed(() => this.filteredRows().slice(0, this.limit()));
  protected readonly handover = computed<Handover[]>(() =>
    (this.result()?.created ?? []).map((a) => ({
      username: a.username,
      name: [a.firstName, a.lastName].filter(Boolean).join(' '),
      email: a.email,
      role: a.role,
      password: a.password,
      expiresAt: a.expiresAt,
    })),
  );
  protected readonly failedLines = computed(() => (this.result()?.failed ?? []).map((f) => f.line).join(', '));

  open(): void {
    this.restart();
    this.shown.set(true);
    void firstValueFrom(this.api.sources())
      .then((s) => this.sources.set(s))
      .catch(() => this.sources.set([]));
  }

  protected restart(): void {
    this.cancelSession();
    this.step.set('source');
    this.error.set(null);
    this.check.set(null);
    this.result.set(null);
    this.filter.set(null);
    this.limit.set(200);
  }

  /** Closed: the list goes from the server, the passwords from the memory of the page. */
  protected closed(): void {
    this.cancelSession();
    if (this.result()?.created.length) this.imported.emit();
    this.result.set(null);
  }

  private cancelSession(): void {
    const s = this.session();
    this.session.set(null);
    if (s && this.step() !== 'done') void firstValueFrom(this.api.cancel(s.id)).catch(() => undefined);
  }

  protected pick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.read(this.api.readFile(file));
  }

  protected drop(e: DragEvent): void {
    e.preventDefault();
    this.over.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void this.read(this.api.readFile(file));
  }

  protected readSource(name: string): void {
    void this.read(this.api.readSource(name));
  }

  private async read(request: ReturnType<UserImportService['readSource']>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const s = await firstValueFrom(request);
      this.session.set(s);
      this.mapping.set({ ...s.suggested });
      this.step.set('columns');
    } catch (err) {
      this.error.set(readError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected map(field: ImportField, column: string): void {
    this.mapping.update((m) => ({ ...m, [field]: column || undefined }));
  }

  protected fieldOf(column: string): string | null {
    const f = (Object.entries(this.mapping()) as [ImportField, string][]).find(([, c]) => c === column)?.[0];
    return f ? (FIELDS.find((x) => x.field === f)?.label ?? null) : null;
  }

  private options() {
    const mapping = Object.fromEntries(Object.entries(this.mapping()).filter(([, c]) => !!c));
    return { mapping, defaultRole: this.defaultRole(), validityDays: this.days() };
  }

  protected async runCheck(): Promise<void> {
    const s = this.session();
    if (!s) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.check.set(await firstValueFrom(this.api.check(s.id, this.options())));
      this.filter.set(null);
      this.limit.set(200);
      this.step.set('check');
    } catch (err) {
      this.error.set(readError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleFilter(f: ImportRow['status']): void {
    this.filter.update((x) => (x === f ? null : f));
    this.limit.set(200);
  }

  protected async confirm(): Promise<void> {
    const s = this.session();
    if (!s) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.confirm(s.id, this.options()));
      this.result.set(r);
      this.step.set('done');
      this.session.set(null);
      this.toasts.info($localize`${r.created.length} compte(s) créé(s)`);
    } catch (err) {
      this.error.set(readError(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected roleName(r: string): string {
    return ({ ADMIN: $localize`Administrateur`, MANAGER: $localize`Gestionnaire`, VIEWER: $localize`Lecteur` } as Record<string, string>)[r] ?? r;
  }

  protected personName(r: ImportRow): string {
    return [r.firstName, r.lastName].filter(Boolean).join(' ') || '—';
  }

  protected problems(r: ImportRow): string {
    return r.problems.map(problemText).join(' · ');
  }
}

/** The codes of the lines (UserImport on the server), in words. */
function problemText(code: string): string {
  return (
    {
      username_missing: $localize`Ni nom d'utilisateur, ni prénom, ni nom`,
      username_invalid: $localize`Nom d'utilisateur impossible (lettres seulement)`,
      username_taken: $localize`Nom d'utilisateur déjà pris`,
      username_repeated: $localize`Nom d'utilisateur en double dans la liste`,
      email_invalid: $localize`Adresse e-mail invalide`,
      email_taken: $localize`Adresse déjà utilisée par un compte`,
      email_repeated: $localize`Adresse en double dans la liste`,
      role_unknown: $localize`Rôle inconnu`,
      name_too_long: $localize`Prénom ou nom trop long`,
    } as Record<string, string>
  )[code] ?? code;
}

/** An error of the import, in words (the codes of ImportException on the server). */
function readError(err: unknown): string {
  const code = (err as { error?: { code?: string } })?.error?.code;
  return (
    (
      {
        xls: $localize`Ancien format Excel (.xls) : enregistre le fichier en .xlsx ou en .csv.`,
        unsupported: $localize`Format non pris en charge : enregistre le fichier en .xlsx ou en .csv.`,
        not_xlsx: $localize`Ce fichier n'est pas un classeur Excel lisible.`,
        empty: $localize`La liste est vide (aucune ligne sous les noms des colonnes).`,
        too_large: $localize`Le fichier est trop gros (10 Mo au plus).`,
        too_many_rows: $localize`La liste a trop de lignes (20 000 au plus).`,
        too_many_columns: $localize`La liste a trop de colonnes (200 au plus).`,
        unknown_source: $localize`Cette base de données n'est plus déclarée sur le serveur.`,
        no_driver: $localize`Le serveur n'a pas de pilote pour cette base de données.`,
        source_failed: $localize`La base de données n'a pas pu être lue (adresse, compte ou requête).`,
        import_expired: $localize`L'import a expiré (une demi-heure) : relis la liste.`,
      } as Record<string, string>
    )[code ?? ''] ?? errorMessage(err, $localize`Import impossible`)
  );
}
