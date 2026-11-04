/*
 * Words of the temperature alerts (ADMIN, 26.12), shared by the Alertes section and its sheets.
 */

/** What may go in a custom message (AlertMessages of the server). */
export const TEMPLATE_FIELDS = ['{type}', '{room}', '{place}', '{temperature}', '{peak}', '{setpoint}', '{threshold}', '{since}', '{duration}', '{devices}', '{rule}', '{channel}', '{date}'];

/** « 30 s », « 10 min », « 1 h 30 », « 2 j » */
export function duration(seconds: number): string {
  if (seconds < 60) return $localize`${seconds} s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (d) return h ? $localize`${d} j ${h} h` : $localize`${d} j`;
  if (h) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  return $localize`${m} min`;
}

/** The reasons the server gives (in English), in the words of the client. */
export function explain(m: string): string {
  const known: [RegExp, string][] = [
    [/on a private or local network/i, $localize`Cette adresse est sur un réseau privé ou local : le serveur la refuse (THERMOBOX_ALERTS_ALLOW_PRIVATE_NETWORKS).`],
    [/^Unknown host/i, $localize`Adresse introuvable : vérifie le nom du serveur.`],
    [/^(Only HTTPS webhooks|The URL must start with https)/i, $localize`Le webhook doit être en HTTPS.`],
    [/^No user name or password in the URL/i, $localize`Pas d'identifiant dans l'adresse : mets-le dans l'en-tête Authorization.`],
    [/^recipients: invalid address/i, $localize`Adresse de destinataire invalide.`],
    [/^from:/i, $localize`Adresse de l'expéditeur invalide.`],
    [/^host:/i, $localize`Serveur SMTP invalide.`],
    [/^scope: at least one/i, $localize`Choisis au moins un bâtiment, un étage ou une salle.`],
    [/^tolerance:/i, $localize`La tolérance va de 0 à 20 °C.`],
    [/^(minDurationSeconds|clearAfterSeconds):/i, $localize`Les durées vont de 0 à 6 h.`],
    [/^reminderSeconds:/i, $localize`Le rappel va de 5 min à 7 jours.`],
  ];
  return known.find(([re]) => re.test(m))?.[1] ?? m;
}
