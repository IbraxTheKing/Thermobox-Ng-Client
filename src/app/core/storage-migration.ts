/**
 * What this device kept before the client was written in English (26.12): the same data under
 * French keys and values. Moved once to the English ones, before anything reads them, so the saved
 * accounts, the chosen server and the preferences stay.
 */
const MOVED: Record<string, string> = {
  'tb-serveur': 'tb-server',
  'tb-comptes': 'tb-accounts',
  'tb-compte-actif': 'tb-account-active',
  'tb-plateforme-dev': 'tb-platform-dev',
};

const ROLES: Record<string, string> = { GESTIONNAIRE: 'MANAGER' };

const PREFERENCES: Record<string, string> = {
  teinte: 'tint',
  unite: 'unit',
  clavier: 'keyboard',
  barreReduite: 'sidebarCollapsed',
  couleursMaison: 'homeColors',
  tailleCartes: 'cardSize',
  ordreBatiments: 'buildingOrder',
};

const SECTION = (k: string): string => (k === 'sans' ? 'none' : k);

export function migrateStorage(): void {
  try {
    const s = localStorage;
    for (const [old, key] of Object.entries(MOVED)) {
      const v = s.getItem(old);
      if (v == null) continue;
      if (s.getItem(key) == null) s.setItem(key, key === 'tb-accounts' ? accounts(v) : v);
      s.removeItem(old);
    }
    const session = s.getItem('tb-session');
    if (session?.includes('"GESTIONNAIRE"')) s.setItem('tb-session', session.replace('"GESTIONNAIRE"', '"MANAGER"'));
    const p = s.getItem('tb-preferences');
    if (p) {
      const o = JSON.parse(p) as Record<string, unknown>;
      if (Object.keys(o).some((k) => k in PREFERENCES)) {
        const n: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o)) n[PREFERENCES[k] ?? k] = v;
        if (n['homeColors'] === 'ecart') n['homeColors'] = 'delta';
        if (Array.isArray(n['buildingOrder'])) n['buildingOrder'] = (n['buildingOrder'] as string[]).map(SECTION);
        s.setItem('tb-preferences', JSON.stringify(n));
      }
    }
    const sections = s.getItem('tb-sections');
    if (sections?.includes('"sans"')) s.setItem('tb-sections', JSON.stringify((JSON.parse(sections) as string[]).map(SECTION)));
  } catch {
    /* private browsing, or unreadable data: the defaults then */
  }
}

/** [{cle, serveur, user, token, expiresAt, vu}] → [{key, server, user, token, expiresAt, seen}] */
function accounts(json: string): string {
  const list = JSON.parse(json) as Record<string, unknown>[];
  return JSON.stringify(
    list.map((a) => {
      const user = { ...(a['user'] as Record<string, unknown>) };
      if (typeof user['type'] === 'string') user['type'] = ROLES[user['type']] ?? user['type'];
      return { key: a['cle'] ?? a['key'], server: a['serveur'] ?? a['server'], user, token: a['token'] ?? null, expiresAt: a['expiresAt'] ?? null, seen: a['vu'] ?? a['seen'] ?? 0 };
    }),
  );
}
