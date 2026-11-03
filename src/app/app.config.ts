import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners, LOCALE_ID } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import localeEnGb from '@angular/common/locales/en-GB';

import { routes } from './app.routes';
import { apiVersionInterceptor } from './core/api-version';
import { authInterceptor } from './core/http';
import { PageTitleStrategy } from './core/title';
import { TransitionsService } from './core/transitions';
import { TARGET } from '../platforms/current';
import { locale } from './core/i18n';

registerLocaleData(localeFr);
registerLocaleData(localeEnGb);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // From the first page on: it keeps where each page was left (scroll)
    provideAppInitializer(() => void inject(TransitionsService)),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // The scroll of the pages: TransitionsService (in the page transition, before its picture)
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled' }),
      // Cross-fade between pages, the room card morphs into its page (as in the JSF interface);
      // entrance of the new page and colour of the state with it: TransitionsService
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: (info) => inject(TransitionsService).onTransition(info),
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, apiVersionInterceptor])),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    // What the platform of this build puts in the place of the shared services, or beside them
    ...TARGET.providers,
    // French or English (core/i18n.ts, chosen before the app starts)
    { provide: LOCALE_ID, useFactory: locale },
    // Installed web app (PWA): the shell works offline, the data always comes from the server.
    // Not in the desktop app: its files are in it already.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !TARGET.desktopOs,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
