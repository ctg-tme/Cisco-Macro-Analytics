export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'cisco-macro-analyzer-theme';

export function parseThemeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function loadThemeMode(): ThemeMode {
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Theme selection still applies for this session when storage is unavailable.
  }
}

export function resolvesToDarkTheme(mode: ThemeMode, systemPrefersDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}

export function isWinterActive(date = new Date(), previewOverride = false): boolean {
  return previewOverride || date.getMonth() === 11;
}
