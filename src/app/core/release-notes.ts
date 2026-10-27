/**
 * What the release notes of a version say about going back (GitHub, written by hand). One line,
 * anywhere in the notes, in French or English, bold or in a list allowed:
 *
 *   Rétrocompatibilité : oui      (going back to the previous version works as it is)
 *   Rétrocompatibilité : non      (once installed, older versions no longer work with the data)
 *
 *   Retour arrière : possible / impossible       Rollback: yes / no       Backward compatible: yes / no
 *
 * null: the notes do not say.
 */
export type Rollback = 'yes' | 'no' | null;

const LINE =
  /^[\s>*_-]*(?:\*\*|__)?\s*(r[ée]tro-?compatib\p{L}*|retour\s+arri[èe]re|rollback|backward[\s-]compatib\p{L}*|downgrade)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(oui|non|yes|no|possible|impossible|true|false|ok)(?![\p{L}\d])/imu;

export function rollbackOf(notes: string | null | undefined): Rollback {
  const m = LINE.exec(notes ?? '');
  if (!m) return null;
  return ['oui', 'yes', 'possible', 'true', 'ok'].includes(m[2].toLowerCase()) ? 'yes' : 'no';
}
