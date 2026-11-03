import { RoomPalette } from '../../app/core/colors';

/**
 * The Linux app: the colours of the GNOME palette (blue, teal, green, yellow, orange, red of the
 * HIG), clear and saturated as GTK apps show their states, on the neutral window of libadwaita.
 * The soft colours of ThermoBox, made for its green-grey page, came out grey there: a comfortable
 * room was not quite green, a cold one not quite blue, a hot one not quite red.
 */
export const GNOME_PALETTE: RoomPalette = {
  temperature: [
    [16, '#1c71d8'],
    [18.5, '#2190a4'],
    [20, '#26a269'],
    [21.8, '#2ec27e'],
    [23, '#e5a50a'],
    [24.5, '#e66100'],
    [26, '#e01b24'],
  ],
  unknown: '#9a9996',
  deltaHome: [
    [-2.5, '#1c71d8'],
    [-1.2, '#2190a4'],
    [-0.5, '#26a269'],
    [0.5, '#2ec27e'],
    [0.95, '#e5a50a'],
    [1.7, '#e66100'],
    [2.5, '#e01b24'],
  ],
  // Into the card of libadwaita, enough of it for the colour to read as itself
  tintSoft: (color, dark) => `color-mix(in oklab, ${color} ${dark ? 38 : 30}%, var(--lx-card))`,
  tintStrong: (color, dark) =>
    dark ? `color-mix(in oklab, ${color} 62%, #ffffff)` : `color-mix(in oklab, ${color} 72%, #000006)`,
};
