# Seasonal looks and notifications of the setpoint

## Seasonal looks (every platform, « Maison » style only)

`src/app/core/seasons.ts` lists the holidays: New Year (31 Dec – 2 Jan), Valentine's Day
(13–14 Feb), Easter (Good Friday – Easter Monday, computed each year), Bastille Day (13–14 Jul),
Halloween (25 Oct – 1 Nov), Christmas (1–26 Dec). On those days, in the « Maison » style:

- the app takes the colour of the holiday, unless the user picked an accent colour (AccentService);
- a few shapes cross the page behind the cards (snow, bats, eggs, hearts, confetti:
  `TbSeasonDecor`, `src/styles/seasons.css`), still when the system asks for less motion;
- « Maison » greets (« Joyeux Noël »), the logo of the side bar wears the colours.

Nothing changes in the « Panneau de configuration » style. Préférences › Thèmes de saison turns it
off. `SeasonService` checks again at midnight and when the app comes back; `?season=christmas` in
the address shows one at once (preview).

To add a holiday: one entry in `SEASONS` (its first day, the day after the last one, its accent,
what crosses the page); `seasons.css` can add touches under `html[data-season="<id>"]`.

## Notifications of the setpoint (iOS, Android, Windows, macOS, Linux)

Préférences › Notifications de consigne (off by default; the system asks once), and the rooms
followed: the favorites or all. « Salle A001 a atteint sa consigne », « … est sous sa consigne »,
« … est trop chaude »; more than four at once: one notification that sums them up. On a phone, a
notification touched opens its room.

The app asks the server every 2 minutes while it is open, and when it comes back:
`GET /api/v2/notifications/setpoints?since=…&ids=…` (ThermoBox server 26.12: `SetpointWatch`).
The server reads the changes from the measures (a state counts once it has lasted 10 minutes), so
what changed while a phone slept is notified when it wakes, up to 6 hours back. An older server
answers 404: Préférences says it.

Plugins: `@capacitor/local-notifications` (run `npx cap sync`), `tauri-plugin-notification`
(capability `notification:default`).
