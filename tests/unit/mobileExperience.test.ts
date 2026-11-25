import { describe, expect, it } from 'vitest';
import {
  detectMobilePlatform,
  evaluateDrawerSwipe,
  isStandalonePwa,
  resolveMobileNavSlot,
  shouldShowInstallBanner,
} from '../../src/utils/mobilePwa';

describe('mobilePwa utilities', () => {
  it('detects iOS, iPadOS desktop UA, Android, and Desktop platforms accurately', () => {
    expect(
      detectMobilePlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
        5
      )
    ).toBe('ios');
    expect(
      detectMobilePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        5
      )
    ).toBe('ios');
    expect(
      detectMobilePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        0
      )
    ).toBe('other');
    expect(
      detectMobilePlatform(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile'
      )
    ).toBe('android');
    expect(
      detectMobilePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0')
    ).toBe('other');
  });

  it('detects standalone PWA mode on both iOS navigator.standalone and display-mode media query', () => {
    const iosStandaloneWin = {
      navigator: { standalone: true },
    } as unknown as Window;
    expect(isStandalonePwa(iosStandaloneWin)).toBe(true);

    const androidStandaloneWin = {
      navigator: {},
      matchMedia: (q: string) => ({ matches: q.includes('standalone') }),
    } as unknown as Window;
    expect(isStandalonePwa(androidStandaloneWin)).toBe(true);

    const browserWin = {
      navigator: {},
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    expect(isStandalonePwa(browserWin)).toBe(false);
  });

  it('controls Android and iOS install banner visibility with standalone suppression and 7-day cooldown', () => {
    const now = 1_750_000_000_000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(
      shouldShowInstallBanner({
        platform: 'android',
        isStandalone: false,
        hasDeferredPrompt: true,
        dismissedAtMs: null,
        nowMs: now,
      })
    ).toBe('android-prompt');

    expect(
      shouldShowInstallBanner({
        platform: 'ios',
        isStandalone: false,
        hasDeferredPrompt: false,
        dismissedAtMs: null,
        nowMs: now,
      })
    ).toBe('ios-guide');

    expect(
      shouldShowInstallBanner({
        platform: 'ios',
        isStandalone: true,
        hasDeferredPrompt: false,
        dismissedAtMs: null,
        nowMs: now,
      })
    ).toBeNull();

    // Suppressed inside 7-day cooldown
    expect(
      shouldShowInstallBanner({
        platform: 'ios',
        isStandalone: false,
        hasDeferredPrompt: false,
        dismissedAtMs: now - sevenDaysMs + 10_000,
        nowMs: now,
      })
    ).toBeNull();

    // Re-shown after cooldown expires
    expect(
      shouldShowInstallBanner({
        platform: 'ios',
        isStandalone: false,
        hasDeferredPrompt: false,
        dismissedAtMs: now - sevenDaysMs - 1_000,
        nowMs: now,
      })
    ).toBe('ios-guide');
  });

  it('evaluates drawer swipe-left gestures safely without triggering on short taps or vertical scroll', () => {
    expect(evaluateDrawerSwipe(250, 300, 140, 310, 220)).toBe(true);
    expect(evaluateDrawerSwipe(250, 300, 215, 305, 180)).toBe(false);
    expect(evaluateDrawerSwipe(250, 300, 180, 420, 250)).toBe(false);
    expect(evaluateDrawerSwipe(250, 300, 120, 305, 1100)).toBe(false);
  });

  it('maps observatory tabs cleanly across the 5 mobile bottom-nav slots', () => {
    expect(resolveMobileNavSlot('overview')).toBe('overview');
    expect(resolveMobileNavSlot('projects')).toBe('projects');
    expect(resolveMobileNavSlot('record')).toBe('projects');
    expect(resolveMobileNavSlot('citizen')).toBe('citizen');

    for (const tab of ['evidence', 'rules', 'forensics', 'padding', 'duplicates', 'oaugf', 'recurring']) {
      expect(resolveMobileNavSlot(tab)).toBe('forensics');
    }

    for (const tab of ['agencies', 'network', 'map', 'anomalies', 'assets', 'compare', 'scrutiny', 'trends', 'execution', 'ai', 'reports', 'casebook', 'methodology']) {
      expect(resolveMobileNavSlot(tab)).toBe('more');
    }
  });
});
