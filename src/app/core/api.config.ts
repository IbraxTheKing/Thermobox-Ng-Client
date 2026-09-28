import { InjectionToken } from '@angular/core';

/**
 * URL de base de l'API REST Thermobox.
 * Surcharger dans app.config.ts :
 *   { provide: API_BASE_URL, useValue: 'https://mon-serveur/api' }
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8080/api',
});

/** Convertit une Date (ou une chaîne ISO) en Instant ISO-8601 attendu par le backend (Instant.parse). */
export function toInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
