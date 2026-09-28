// ⚠️ Les champs sont déduits des resources Kotlin : ajuste-les selon tes entités
// (ax.ibr.thermobox.common.entities.*) si les noms JSON diffèrent.

export interface Salle {
  id?: number;
  name: string;
}

export type TemperatureType = 'consigne' | 'mesurer';

/** Temperature (classe mère de Consigne et Mesurer côté Kotlin). */
export interface Temperature {
  id?: number;
  value: number;
  /** LocalDateTime sérialisé, ex. "2026-09-28T14:30:00" */
  date: string;
  type?: TemperatureType;
}

export interface Consigne extends Temperature {
  type?: 'consigne';
}

export interface Mesurer extends Temperature {
  type?: 'mesurer';
}

export interface SalleTempAttr {
  id?: number;
  salle: Salle;
  temperature: Temperature;
}

export type UserRole = 'ADMIN' | 'GESTIONNAIRE' | 'USER';

export interface User {
  id?: number;
  username: string;
  password?: string;
  role?: UserRole;
}

/** Corps renvoyé par le backend en cas de 409 CONFLICT / 500. */
export interface ApiError {
  error: string | null;
}
