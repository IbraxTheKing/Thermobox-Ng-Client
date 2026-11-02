# Accounts: import, provisional passwords, guide of a first visit

ThermoBox server 26.12 and later (`features` of `GET /api/v2/server`: `user-import`,
`provisional-passwords`). With an older server, nothing of this shows.

## Import of users (ADMIN)

Gérer › Utilisateurs et groupes › **Importer** (`src/app/ui/user-import-sheet.ts`), four steps:

1. **Liste**: an Excel (`.xlsx`) or CSV file, dropped or picked, or a database declared on the
   server (`GET /api/v2/users/import/sources`). The server reads it and keeps it in memory for
   half an hour, for this admin only.
2. **Colonnes**: which column gives the first name, the last name, the email address, the
   username, the role (suggested by the server from the names of the columns), the role of the
   people without one, how long the provisional passwords last (1 to 30 days). The first lines
   are shown, the columns used highlighted.
3. **Vérification**: every line, to create, duplicate (username or address taken by an account or
   an earlier line) or invalid, and why; filtered by state. A username is made from the names
   when there is none (`auto`), put in the form of ThermoBox when it has accents or signs
   (`ajusté`).
4. **Comptes**: the accounts created and their provisional passwords (`TbPasswordHandover`):
   shown once, to print (one sheet per person, to hand over), download as CSV or copy. Neither
   the server nor the client keeps them.

An admin can also give one account a new provisional password (forgotten password, expired
provisional one): right click / menu of the user › « Mot de passe provisoire… », or the sheet of
the user on phones. The list of users shows the name and address of the people, and a tag on the
accounts whose password is still provisional (or expired).

## Provisional password at the first login

`POST /api/v2/auth/login` answers `user.mustChangePassword: true`: the app goes to `/password`
(`src/app/pages/auth/password.ts`, `passwordGuard`; `loggedInGuard` sends every page of the app
there until then). The provisional password typed at login is not asked again (kept in memory
only); the rules of the server (`GET /api/v2/auth/password-policy`) are ticked as the new password
meets them. `POST /api/v2/auth/password`, then the app opens as usual. A request refused with
`403 password_change_required` (the account was reset meanwhile) also leads there
(`authInterceptor`). An expired provisional password is told at login (`401 provisional_expired`).

## Guide of a first visit

`src/app/ui/onboarding-guide.ts`, `src/app/core/onboarding.ts`: after the first login of an
account on a device (and after its provisional password is replaced), a card in the middle of the
screen, one step at a time, the place of the app it speaks of ringed in the navigation. Its steps
follow the role:

| | Lecteur | Gestionnaire | Administrateur |
|---|---|---|---|
| Welcome, overview, a room, history, buildings and rooms, preferences | ✓ | ✓ (a room: changing its setpoint) | ✓ |
| Gérer: setpoints of several rooms, boxes | | ✓ | ✓ (also creating and arranging the elements) |
| Accounts (creation, import, accesses, groups), server | | | ✓ |

« Passer le guide » (or Escape) at every step; seen once per account and device
(`localStorage` `tb-guide`, raised with its version), replayed from Préférences › Divers ›
« Revoir le guide de démarrage ».
