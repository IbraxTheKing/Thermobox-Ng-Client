import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { migrateStorage } from './app/core/storage-migration';

migrateStorage();
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
