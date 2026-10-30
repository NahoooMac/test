import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '@dp/shared';
import { en } from './en.ts';
import { am } from './am.ts';

const STORAGE_KEY = 'ui.language';

function initialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'am') return stored;
  } catch {
    // storage unavailable (private mode) — fall through
  }
  return navigator.language.startsWith('am') ? 'am' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, am: { translation: am } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
