import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { App } from './app/app';
import { TARGET } from './platforms/current';

/** Starts the app, once the language is loaded (main.ts): what the platform does first, then Angular. */
export function start(): Promise<unknown> {
  return (TARGET.prepare?.() ?? Promise.resolve())
    .catch((err) => console.error(err))
    .then(() => bootstrapApplication(App, appConfig));
}
