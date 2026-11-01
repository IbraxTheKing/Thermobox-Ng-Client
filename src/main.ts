import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { prepareDesktop } from './app/core/desktop';
import { migrateStorage } from './app/core/storage-migration';

migrateStorage();

// Desktop app (Tauri): the server calls through Rust, the settings window on its page
prepareDesktop()
  .catch((err) => console.error(err))
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
