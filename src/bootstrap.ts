import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { App } from './app/app';
import { prepareDesktop } from './app/core/desktop';

/** Starts the app, once the language is loaded (main.ts). */
export function start(): Promise<unknown> {
  return prepareDesktop()
    .catch((err) => console.error(err))
    .then(() => bootstrapApplication(App, appConfig));
}
