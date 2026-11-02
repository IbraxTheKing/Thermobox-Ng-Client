import { Pipe, PipeTransform } from '@angular/core';

import { tr } from '../core/i18n';

/** `'Se reconnecter' | tr` or `'Ouvrir {name}' | tr: { name: s.name }`: see tr() (core/i18n.ts). */
@Pipe({ name: 'tr' })
export class TrPipe implements PipeTransform {
  transform(text: string, params?: Record<string, string | number | null | undefined>): string {
    return tr(text, params);
  }
}
