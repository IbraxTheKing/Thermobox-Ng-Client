import { loadLanguage } from './app/core/i18n';
import { migrateStorage } from './app/core/storage-migration';

migrateStorage();

// The language first (its texts must be there before any module of the app reads them), then
// the app: imported afterwards for that reason. Desktop app (Tauri): the server calls through
// Rust, the settings window on its page.
loadLanguage()
  .catch((err) => console.error(err))
  .then(() => import('./bootstrap'))
  .then(({ start }) => start())
  .catch((err) => console.error(err));
