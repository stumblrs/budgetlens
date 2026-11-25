export type MobilePlatform = 'ios' | 'android' | 'other';

export type MobileNavSlot = 'overview' | 'projects' | 'citizen' | 'forensics' | 'more';

export const INSTALL_BANNER_DISMISS_STORAGE_KEY = 'budgetlens_install_dismissed_v1';

const FORENSICS_TABS = new Set([
  'evidence',
  'rules',
  'forensics',
  'padding',
  'duplicates',
  'oaugf',
  'recurring',
]);

/**
 * Identifies mobile platform from User-Agent + touch capability
 * (treats iPadOS 13+ Macintosh desktop UA with touch points as iOS).
 */
export function detectMobilePlatform(
  userAgent: string,
  maxTouchPoints = 0
): MobilePlatform {
  const ua = String(userAgent || '');
  if (!ua) return 'other';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/**
 * Checks whether the web app is running as an installed standalone PWA
 * on either Android Chrome (display-mode) or iOS Safari (navigator.standalone).
 */
export function isStandalonePwa(win?: Window | null): boolean {
  const target = win !== undefined ? win : typeof window !== 'undefined' ? window : null;
  if (!target) return false;
  const nav = target.navigator as (Navigator & { standalone?: boolean }) | undefined;
  if (nav?.standalone === true) return true;
  if (typeof target.matchMedia === 'function') {
    return (
      target.matchMedia('(display-mode: standalone)').matches ||
      target.matchMedia('(display-mode: fullscreen)').matches
    );
  }
  return false;
}

/**
 * Decides whether and which install hint should surface for mobile users,
 * enforcing a cooldown after explicit dismissal and suppressing when already installed.
 */
export function shouldShowInstallBanner(opts: {
  platform: MobilePlatform;
  isStandalone: boolean;
  hasDeferredPrompt: boolean;
  dismissedAtMs: number | null;
  nowMs?: number;
  cooldownDays?: number;
}): 'android-prompt' | 'ios-guide' | null {
  if (opts.isStandalone) return null;
  const now = opts.nowMs ?? Date.now();
  const cooldownMs = (opts.cooldownDays ?? 7) * 24 * 60 * 60 * 1000;
  if (
    opts.dismissedAtMs !== null &&
    Number.isFinite(opts.dismissedAtMs) &&
    now - opts.dismissedAtMs < cooldownMs
  ) {
    return null;
  }

  if (opts.hasDeferredPrompt) return 'android-prompt';
  if (opts.platform === 'ios') return 'ios-guide';
  return null;
}

/**
 * Evaluates a touch gesture to decide whether it represents an intentional
 * horizontal swipe-left to close the navigation drawer.
 */
export function evaluateDrawerSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  elapsedMs: number
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 700) {
    return false;
  }
  const dx = endX - startX;
  const dy = endY - startY;
  if (dx > -56) return false;
  return Math.abs(dx) > Math.abs(dy) * 1.3;
}

/**
 * Maps any BudgetLens observatory route tab onto one of the 5 bottom-bar slots.
 */
export function resolveMobileNavSlot(activeTab: string): MobileNavSlot {
  const normalized = String(activeTab || '').trim().toLowerCase();
  if (normalized === 'overview' || normalized === '') return 'overview';
  if (normalized === 'projects' || normalized === 'record') return 'projects';
  if (normalized === 'citizen') return 'citizen';
  if (FORENSICS_TABS.has(normalized)) return 'forensics';
  return 'more';
}
