import { describe, expect, it } from 'vitest';
import { isWinterActive, parseThemeMode, resolvesToDarkTheme } from './theme';

describe('theme presentation', () => {
  it('defaults missing and unknown saved values to the system theme', () => {
    expect(parseThemeMode(null)).toBe('system');
    expect(parseThemeMode('sepia')).toBe('system');
  });

  it('resolves the system theme from the operating-system preference', () => {
    expect(resolvesToDarkTheme('system', true)).toBe(true);
    expect(resolvesToDarkTheme('system', false)).toBe(false);
    expect(resolvesToDarkTheme('light', true)).toBe(false);
    expect(resolvesToDarkTheme('dark', false)).toBe(true);
  });

  it('enables the winter treatment in December and for explicit previews', () => {
    expect(isWinterActive(new Date(2026, 11, 1))).toBe(true);
    expect(isWinterActive(new Date(2026, 6, 28))).toBe(false);
    expect(isWinterActive(new Date(2026, 6, 28), true)).toBe(true);
  });
});
