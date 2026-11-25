import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import {
  INSTALL_BANNER_DISMISS_STORAGE_KEY,
  detectMobilePlatform,
  isStandalonePwa,
  shouldShowInstallBanner,
  type MobilePlatform,
} from '../utils/mobilePwa';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function readDismissedTimestamp(): number | null {
  try {
    const raw = window.localStorage.getItem(INSTALL_BANNER_DISMISS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const MobileInstallPrompt: React.FC = () => {
  const [platform, setPlatform] = useState<MobilePlatform>('other');
  const [standalone, setStandalone] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPlatform(
      detectMobilePlatform(window.navigator.userAgent, window.navigator.maxTouchPoints || 0)
    );
    setStandalone(isStandalonePwa(window));
    setDismissedAt(readDismissedTimestamp());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const mode = shouldShowInstallBanner({
    platform,
    isStandalone: standalone,
    hasDeferredPrompt: Boolean(deferredPrompt),
    dismissedAtMs: dismissedAt,
  });

  if (!mode) return null;

  const handleDismiss = () => {
    const now = Date.now();
    setDismissedAt(now);
    try {
      window.localStorage.setItem(INSTALL_BANNER_DISMISS_STORAGE_KEY, String(now));
    } catch {
      // Ignore storage quota / private browsing errors
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setStandalone(true);
      } else {
        handleDismiss();
      }
    } catch {
      handleDismiss();
    } finally {
      setDeferredPrompt(null);
    }
  };

  return (
    <aside
      className="mobile-install-banner no-print"
      aria-label="Install BudgetLens App"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0, flex: 1 }}>
        <div
          style={{
            width: '30px',
            height: '30px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {mode === 'ios-guide' ? <Share size={15} color="#ffffff" /> : <Download size={15} color="#ffffff" />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>
            {mode === 'ios-guide' ? 'Add BudgetLens to Home Screen' : 'Install BudgetLens App'}
          </div>
          <div style={{ fontSize: '0.67rem', color: '#cbd5e1', lineHeight: 1.25, marginTop: '0.1rem' }}>
            {mode === 'ios-guide'
              ? 'Tap Share in Safari, then choose "Add to Home Screen"'
              : 'Fast offline launch and full-screen mobile view'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
        {mode === 'android-prompt' && (
          <button
            type="button"
            onClick={handleInstallClick}
            style={{
              border: 'none',
              borderRadius: '7px',
              backgroundColor: '#10b981',
              color: '#06281e',
              fontSize: '0.72rem',
              fontWeight: 700,
              padding: '0.42rem 0.72rem',
              minHeight: '36px',
            }}
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          style={{
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '7px',
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#cbd5e1',
            width: '34px',
            height: '34px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
};
