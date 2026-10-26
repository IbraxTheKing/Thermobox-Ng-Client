import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, isDevMode, provideBrowserGlobalErrorListeners, LOCALE_ID } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

import { routes } from './app.routes';
import { apiVersionInterceptor } from './core/api-version';
import { authInterceptor } from './core/http';
import { PageTitleStrategy } from './core/title';
import { TransitionsService } from './core/transitions';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // Cross-fade between pages, the room card morphs into its page (as in the JSF interface);
      // entrance of the new page and colour of the state with it: TransitionsService
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: (info) => inject(TransitionsService).onTransition(info),
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, apiVersionInterceptor])),
    { provide: TitleStrategy, useClass: PageTitleStrategy },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    // Installed web app (PWA): the shell works offline, the data always comes from the server
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
