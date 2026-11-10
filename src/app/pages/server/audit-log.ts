import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';

import { errorMessage } from '../../core/api.config';
import { clockTime, ddmmAtHHmm, parseDate } from '../../core/dates';
import { locale } from '../../core/i18n';
import { ToastService } from '../../core/messages';
import { UnitService } from '../../core/unit';
import { AuditEntry, AuditFilter } from '../../models/models';
import { AuditStore } from '../../services/audit.store';
import { TbPager } from '../../ui/pager';
import { TrPipe } from '../../ui/tr.pipe';

/** An entry as a sentence: who, what was done, to what, and the values. */
interface Line {
  entry: AuditEntry;
  icon: string;
  verb: string;
  target: string | null;
  suffix: string;
  time: string;
  /** The day it belongs to (a heading before the first entry of each day). */
  day: string;
  facts: { key: string; value: string }[];
}

const PAGE = 30;

/**
 * Serveur › Journal (ADMIN, ThermoBox 26.12): every change made through the API, whoever made it
 * (ADMIN or MANAGER), the most recent first, day by day: who, what, on what (its name at the
 * time), the values sent and what they replaced. Filtered by user, by kind of change, by period
 * and by text; in pages. How long the server keeps it, chosen here.
 */
@Component({
  selector: 'tb-audit-log',
  imports: [TrPipe, TbPager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (audit.available() === false) {
      <section class="tb-panel tb-audit">
        <p i18n class="tb-muted tb-audit-note">Ce serveur ne tient pas encore de journal des modifications (ThermoBox 26.12 ou plus récent).</p>
      </section>
    } @else {
      <section class="tb-panel tb-audit" aria-labelledby="tb-audit-title">
        <div class="tb-audit-head">
          <div>
            <h2 i18n class="tb-pref-heading" id="tb-audit-title">Journal des modifications</h2>
            <p i18n class="tb-muted tb-audit-note">Toute modification faite par un administrateur ou un gestionnaire : consignes, salles, comptes, alertes, réglages du serveur…</p>
          </div>
          @if (audit.retention() !== undefined) {
            <label class="tb-audit-retention">
              <span i18n class="tb-muted">Conserver</span>
              <select class="tb-select" [disabled]="savingRetention()" (change)="setRetention($any($event.target).value)" i18n-aria-label aria-label="Durée de conservation du journal">
                @for (o of retentions; track o.days) {
                  <option [value]="o.days ?? 'forever'" [selected]="audit.retention() === o.days">{{ o.label }}</option>
                }
                @if (!knownRetention()) {
                  <option [value]="audit.retention()" selected>{{ audit.retention() }} {{ 'jours' | tr }}</option>
                }
              </select>
            </label>
          }
        </div>

        <!-- Filters -->
        <div class="tb-audit-filters">
          <span class="tb-search tb-audit-search">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input class="tb-input" type="search" i18n-placeholder placeholder="Rechercher une salle, un compte, une valeur…" autocomplete="off"
                   i18n-aria-label aria-label="Rechercher dans le journal" [value]="search()" (input)="search.set($any($event.target).value)" />
          </span>
          <select class="tb-select" (change)="setUser($any($event.target).value)" i18n-aria-label aria-label="Utilisateur">
            <option i18n value="">Tous les utilisateurs</option>
            @for (u of audit.users(); track u.id) {
              <option [value]="u.id" [selected]="filter().user === u.id">{{ u.username }}</option>
            }
          </select>
          <select class="tb-select" (change)="setDomain($any($event.target).value)" i18n-aria-label aria-label="Type de modification">
            @for (d of domains; track d.id) {
              <option [value]="d.id" [selected]="(filter().action ?? '') === d.id">{{ d.label }}</option>
            }
          </select>
          <select class="tb-select" (change)="setDays($any($event.target).value)" i18n-aria-label aria-label="Période">
            @for (p of periods; track p.days) {
              <option [value]="p.days ?? ''" [selected]="filter().days === p.days">{{ p.label }}</option>
            }
          </select>
        </div>

        @if (audit.error(); as e) {
          <p class="tb-field-error">{{ e }}</p>
        }
        @if (audit.page(); as p) {
          <p class="tb-muted tb-audit-count">
            @if (p.total > 1) { {{ p.total }} {{ 'modifications' | tr }} } @else if (p.total === 1) { <ng-container i18n>1 modification</ng-container> } @else { <ng-container i18n>Aucune modification</ng-container> }
            @if (pages() > 1) { · {{ 'page' | tr }} {{ index() + 1 }}/{{ pages() }} }
          </p>
          <ol class="tb-audit-list" [class.tb-audit-loading]="audit.loading()">
            @for (l of lines(); track l.entry.id; let i = $index) {
              @if (i === 0 || lines()[i - 1].day !== l.day) {
                <li class="tb-audit-day" aria-hidden="true">{{ l.day }}</li>
              }
              <li class="tb-audit-entry">
                <span class="tb-section-icon"><i class="pi" [class]="l.icon"></i></span>
                <div class="tb-audit-text">
                  <span class="tb-audit-sentence">
                    <strong>{{ l.entry.username }}</strong>{{ ' ' + l.verb }}@if (l.target) {{{ ' ' }}<strong>{{ l.target }}</strong>}{{ l.suffix }}
                  </span>
                  <span class="tb-muted tb-audit-meta">
                    {{ l.time }}@if (l.entry.details?.place; as place) { · {{ place }} }@if (l.entry.role; as r) { · {{ roleLabel(r) }} }
                  </span>
                  @if (open().has(l.entry.id)) {
                    <dl class="tb-audit-facts">
                      @for (f of l.facts; track $index) {
                        <dt>{{ f.key }}</dt>
                        <dd>{{ f.value }}</dd>
                      }
                    </dl>
                  }
                </div>
                @if (l.facts.length) {
                  <button type="button" class="tb-btn tb-icon tb-flat tb-audit-more" [attr.aria-expanded]="open().has(l.entry.id)"
                          [title]="open().has(l.entry.id) ? ('Masquer le détail' | tr) : ('Voir le détail' | tr)" (click)="toggle(l.entry.id)">
                    <i class="pi" [class.pi-chevron-down]="!open().has(l.entry.id)" [class.pi-chevron-up]="open().has(l.entry.id)"></i>
                  </button>
                }
              </li>
            } @empty {
              <li i18n class="tb-muted tb-audit-empty">Rien ne correspond à ces filtres.</li>
            }
          </ol>
          <tb-pager [total]="p.total" [size]="pageSize" [page]="index()" (pageChange)="go($event)" />
        } @else if (audit.loading()) {
          <p i18n class="tb-muted">Chargement…</p>
        }
      </section>
    }
  `,
})
export class TbAuditLog {
  protected readonly audit = inject(AuditStore);
  private readonly unit = inject(UnitService);
  private readonly toasts = inject(ToastService);

  protected readonly pageSize = PAGE;
  protected readonly index = signal(0);
  protected readonly search = signal('');
  /** The search, a moment after the typing stops. */
  private readonly query = signal('');
  protected readonly filter = signal<AuditFilter>({ user: null, action: null, q: '', days: 30 });
  protected readonly open = signal<ReadonlySet<number>>(new Set());
  protected readonly savingRetention = signal(false);

  protected readonly domains = [
    { id: '', label: $localize`Toutes les modifications` },
    { id: 'setpoint', label: $localize`Consignes` },
    { id: 'element', label: $localize`Bâtiments, étages et salles` },
    { id: 'measurement', label: $localize`Mesures` },
    { id: 'user', label: $localize`Comptes` },
    { id: 'group', label: $localize`Groupes` },
    { id: 'users', label: $localize`Imports de comptes` },
    { id: 'rule', label: $localize`Règles d'alerte` },
    { id: 'channel', label: $localize`Canaux d'alerte` },
    { id: 'limits', label: $localize`Températures acceptées` },
    { id: 'logo', label: $localize`Logo du serveur` },
    { id: 'name', label: $localize`Nom du serveur` },
    { id: 'style', label: $localize`Style` },
    { id: 'update', label: $localize`Mises à jour` },
    { id: 'account', label: $localize`Mots de passe` },
    { id: 'audit', label: $localize`Journal` },
  ];
  protected readonly periods = [
    { days: 1, label: $localize`Dernières 24 heures` },
    { days: 7, label: $localize`7 derniers jours` },
    { days: 30, label: $localize`30 derniers jours` },
    { days: 365, label: $localize`12 derniers mois` },
    { days: null, label: $localize`Tout le journal` },
  ];
  protected readonly retentions: { days: number | null; label: string }[] = [
    { days: 30, label: $localize`30 jours` },
    { days: 90, label: $localize`90 jours` },
    { days: 180, label: $localize`6 mois` },
    { days: 365, label: $localize`1 an` },
    { days: 730, label: $localize`2 ans` },
    { days: 1825, label: $localize`5 ans` },
    { days: null, label: $localize`Pour toujours` },
  ];
  protected readonly knownRetention = computed(() => this.retentions.some((r) => r.days === this.audit.retention()));

  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.audit.page()?.total ?? 0) / PAGE)));
  protected readonly lines = computed(() => (this.audit.page()?.entries ?? []).map((e) => this.line(e)));

  private typing?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.audit.loadUsers();
    void this.audit.loadRetention();
    effect(() => {
      const s = this.search();
      clearTimeout(this.typing);
      this.typing = setTimeout(() => this.query.set(s), 350);
    });
    effect(() => {
      const q = this.query();
      untracked(() => {
        if (q === this.filter().q) return;
        this.filter.update((f) => ({ ...f, q }));
        this.index.set(0);
      });
    });
    // Read again when a filter or the page changes
    effect(() => {
      const f = this.filter();
      const i = this.index();
      untracked(() => void this.audit.load(f, i, PAGE));
    });
  }

  protected go(i: number): void {
    this.index.set(i);
    this.open.set(new Set());
  }

  protected setUser(v: string): void {
    this.filter.update((f) => ({ ...f, user: v ? Number(v) : null }));
    this.index.set(0);
  }

  protected setDomain(v: string): void {
    this.filter.update((f) => ({ ...f, action: v || null }));
    this.index.set(0);
  }

  protected setDays(v: string): void {
    this.filter.update((f) => ({ ...f, days: v ? Number(v) : null }));
    this.index.set(0);
  }

  protected toggle(id: number): void {
    this.open.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async setRetention(v: string): Promise<void> {
    const days = v === 'forever' ? null : Number(v);
    this.savingRetention.set(true);
    try {
      await this.audit.setRetention(days);
      this.toasts.info(days == null ? $localize`Le journal est gardé pour toujours` : $localize`Le journal est gardé ${days}:days: jours`);
      void this.audit.load(this.filter(), this.index(), PAGE, true);
    } catch (e) {
      this.toasts.error($localize`Réglage non enregistré`, errorMessage(e));
    } finally {
      this.savingRetention.set(false);
    }
  }

  protected roleLabel(r: string): string {
    return ({ ADMIN: $localize`administrateur`, MANAGER: $localize`gestionnaire`, VIEWER: $localize`lecteur` } as Record<string, string>)[r] ?? r;
  }

  // ---------------------------------------------------------------- the sentences

  private line(e: AuditEntry): Line {
    const c = (e.details?.changes ?? {}) as Record<string, unknown>;
    const before = e.details?.before ?? {};
    const name = e.targetName ?? (e.targetId != null ? `#${e.targetId}` : null);
    const t = (v: unknown) => (typeof v === 'number' ? this.unit.withSymbol(v) : '—');
    let icon = 'pi-pencil';
    let verb = e.action;
    let target: string | null = name;
    let suffix = '';
    const [domain, act] = e.action.split('.', 2);
    const created = act === 'create';
    const deleted = act === 'delete';
    switch (domain) {
      case 'setpoint': {
        icon = 'pi-sliders-h';
        verb = $localize`a réglé la consigne de`;
        const was = (before as Record<string, unknown>)['setpoint'];
        suffix = ` : ${typeof was === 'number' ? t(was) + ' → ' : ''}${t(c['value'])}` + (c['force'] === true ? $localize` (imposée en dessous)` : '');
        break;
      }
      case 'element':
        icon = created ? 'pi-plus' : deleted ? 'pi-trash' : act === 'move' ? 'pi-arrows-alt' : act?.startsWith('image') ? 'pi-image' : 'pi-building';
        verb = {
          create: $localize`a créé`,
          update: $localize`a modifié`,
          move: $localize`a déplacé`,
          delete: $localize`a supprimé`,
          image: $localize`a changé la photo de`,
          'image-delete': $localize`a retiré la photo de`,
        }[act] ?? e.action;
        if (act === 'update' && typeof c['name'] === 'string' && c['name'] !== e.targetName) suffix = $localize` (renommé « ${c['name']} »)`;
        break;
      case 'measurement':
        icon = 'pi-chart-line';
        verb = created ? $localize`a ajouté une mesure` : deleted ? $localize`a supprimé une mesure` : $localize`a modifié une mesure`;
        target = null;
        if (typeof c['value'] === 'number') suffix = ` : ${t(c['value'])}`;
        break;
      case 'roomtemp':
        icon = 'pi-sliders-h';
        verb = created ? $localize`a ajouté une consigne ou une mesure` : deleted ? $localize`a supprimé une consigne ou une mesure` : $localize`a modifié une consigne ou une mesure`;
        target = null;
        break;
      case 'user':
        icon = created ? 'pi-user-plus' : deleted ? 'pi-user-minus' : act === 'access' ? 'pi-lock' : act === 'provisional-password' ? 'pi-key' : 'pi-user-edit';
        verb = {
          create: $localize`a créé le compte`,
          update: $localize`a modifié le compte`,
          delete: $localize`a supprimé le compte`,
          access: $localize`a changé les accès de`,
          'provisional-password': $localize`a donné un mot de passe provisoire à`,
        }[act] ?? e.action;
        if (act === 'update' && typeof c['type'] === 'string') suffix = ` (${this.roleLabel(String(c['type']))})`;
        break;
      case 'users':
        icon = 'pi-upload';
        verb = $localize`a importé des comptes`;
        target = null;
        break;
      case 'group':
        icon = 'pi-users';
        verb = created ? $localize`a créé le groupe` : deleted ? $localize`a supprimé le groupe` : $localize`a modifié le groupe`;
        break;
      case 'channel':
      case 'rule': {
        icon = domain === 'rule' ? 'pi-bell' : 'pi-send';
        const what = domain === 'rule' ? $localize`la règle d'alerte` : $localize`le canal d'alerte`;
        verb =
          act === 'enable'
            ? c['enabled'] === false
              ? $localize`a coupé ${what}:what:`
              : $localize`a activé ${what}:what:`
            : created
              ? $localize`a créé ${what}:what:`
              : deleted
                ? $localize`a supprimé ${what}:what:`
                : $localize`a modifié ${what}:what:`;
        break;
      }
      case 'logo':
        icon = 'pi-image';
        verb = act === 'reset' ? $localize`a remis le logo automatique du serveur` : $localize`a changé le logo du serveur`;
        target = null;
        break;
      case 'limits': {
        icon = 'pi-sliders-v';
        target = null;
        if (act === 'reset') verb = $localize`a remis les températures acceptées par défaut`;
        else {
          verb = $localize`a changé les températures acceptées`;
          const range = (k: string, label: string) => {
            const r = c[k] as { min?: number; max?: number } | undefined;
            return r ? `${label} ${t(r.min)} – ${t(r.max)}` : null;
          };
          const parts = [range('setpoint', $localize`consignes`), range('measurement', $localize`mesures`)].filter(Boolean);
          if (parts.length) suffix = ' : ' + parts.join(', ');
        }
        break;
      }
      case 'name':
        icon = 'pi-tag';
        target = null;
        verb = act === 'reset' || !c['name'] ? $localize`a retiré le nom du serveur` : $localize`a renommé le serveur « ${c['name']}:name: »`;
        break;
      case 'style':
        icon = 'pi-palette';
        target = null;
        verb = c['style'] === 'panel' ? $localize`a choisi le style « Panneau de configuration »` : $localize`a choisi le style « Maison »`;
        break;
      case 'update':
        icon = 'pi-cloud-download';
        verb = $localize`a installé la version`;
        break;
      case 'account':
        icon = 'pi-key';
        verb = $localize`a changé son mot de passe`;
        target = null;
        break;
      case 'audit': {
        icon = 'pi-history';
        target = null;
        const d = c['retentionDays'];
        verb = typeof d === 'number' ? $localize`a réglé la conservation du journal à ${d}:days: jours` : $localize`a choisi de garder le journal pour toujours`;
        break;
      }
    }
    const date = parseDate(e.at);
    return {
      entry: e,
      icon,
      verb,
      target,
      suffix,
      time: date ? clockTime(date) : '',
      day: date ? this.dayOf(date) : '',
      facts: this.facts(e),
    };
  }

  /** « Aujourd'hui », « Hier », « lundi 3 novembre » (with the year when it is not this one). */
  private dayOf(d: Date): string {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return $localize`Aujourd'hui`;
    if (d.toDateString() === yesterday.toDateString()) return $localize`Hier`;
    return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  }

  /** The values sent and those replaced, one per line, for the detail. */
  private facts(e: AuditEntry): { key: string; value: string }[] {
    const out: { key: string; value: string }[] = [];
    const show = (v: unknown): string => {
      if (v == null) return '—';
      if (typeof v === 'boolean') return v ? $localize`oui` : $localize`non`;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };
    const changes = e.details?.changes;
    if (Array.isArray(changes)) out.push({ key: $localize`envoyé`, value: show(changes) });
    else if (changes) Object.entries(changes).forEach(([k, v]) => out.push({ key: k, value: show(v) }));
    Object.entries(e.details?.before ?? {}).forEach(([k, v]) => out.push({ key: $localize`avant : ${k}:key:`, value: show(v) }));
    if (e.targetType && e.targetId != null) out.push({ key: $localize`identifiant`, value: `${e.targetType} ${e.targetId}` });
    out.push({ key: $localize`date`, value: ddmmAtHHmm(e.at) });
    return out;
  }
}
