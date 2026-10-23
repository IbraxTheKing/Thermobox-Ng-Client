import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners, LOCALE_ID } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

import { routes } from './app.routes';
import { authInterceptor } from './core/http';
import { TitreStrategie } from './core/titre';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // Cross-fade between pages, the salle card glides into its page (as in the JSF interface)
      withViewTransitions({
        skipInitialTransition: true,
        // Préférences « Animations » off, or the system asks for less motion: no transition
        onViewTransitionCreated: ({ transition }) => {
          const reduit = document.documentElement.dataset['motion'] === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduit) transition.skipTransition();
        },
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    { provide: TitleStrategy, useClass: TitreStrategie },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    // Installed web app (PWA): the shell works offline, the data always comes from the server
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
