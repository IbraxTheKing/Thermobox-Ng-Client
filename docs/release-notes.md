# Release notes on GitHub: what the client reads

The Mises à jour tab (Serveur page) reads a few things in the notes of each GitHub release.

## Going back to an older version

Put one line anywhere in the notes (a list item or bold is fine):

```
Rétrocompatibilité : oui
```

- `oui`: once this version is installed, the previous one can be put back as it is. Badge
  « Rétrocompatible ».
- `non`: once this version is installed, older versions no longer work with the data (database
  migration that cannot be undone). Badge « Sans retour arrière »; after it is installed, every
  older version shows « Incompatible depuis <this version> ».

Also accepted: `Retour arrière : possible / impossible`, `Rollback: yes / no`,
`Backward compatible: yes / no`.

Without the line: a corrective (same monthly series) is shown as rétrocompatible, a new series as
« Retour arrière non garanti ».

## Template

```markdown
## Nouveautés
- …

## Corrections
- …

## Migration
- Rétrocompatibilité : non
- Faire une sauvegarde de la base avant d'installer.
```

The « Migration » section (or lines starting with `Migration :`) is also read by the server: its
items are shown as « Opérations à prévoir ».
