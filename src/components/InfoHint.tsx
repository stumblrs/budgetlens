import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoHintProps {
  term: string;
  meaning: string;
  whyItMatters?: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * Unobtrusive inline plain-English explainer pill (`?`) for technical budget and forensic terms.
 * Opens cleanly on hover, focus, or click and closes on Escape / outside click.
 */
export const InfoHint: React.FC<InfoHintProps> = ({
  term,
  meaning,
  whyItMatters,
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const positionStyle: React.CSSProperties =
    align === 'right'
      ? { right: 0 }
      : align === 'center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : { left: 0 };

  return (
    <span
      ref={wrapperRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
      }}
    >
      <button
        type="button"
        aria-label={`Explain ${term}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        style={{
          background: 'none',
          border: 'none',
          padding: '0 0.15rem',
          color: open ? 'var(--emerald-primary)' : 'var(--text-light)',
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <HelpCircle size={13} />
      </button>

      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            width: 'min(290px, 78vw)',
            zIndex: 950,
            backgroundColor: '#091017',
            color: '#f8fafc',
            border: '1px solid #1e293b',
            borderRadius: '8px',
            padding: '0.68rem 0.8rem',
            boxShadow: '0 12px 28px rgba(9, 16, 23, 0.35)',
            fontSize: '0.73rem',
            lineHeight: 1.45,
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
            textAlign: 'left',
            ...positionStyle,
          }}
        >
          <div style={{ fontWeight: 700, color: '#34d399', marginBottom: '0.2rem', fontSize: '0.74rem' }}>
            {term}
          </div>
          <div style={{ color: '#e2e8f0' }}>{meaning}</div>
          {whyItMatters && (
            <div style={{ marginTop: '0.35rem', paddingTop: '0.32rem', borderTop: '1px solid rgba(148,163,184,0.2)', color: '#cbd5e1', fontSize: '0.69rem' }}>
              <strong style={{ color: '#fbbf24' }}>Why it matters:</strong> {whyItMatters}
            </div>
          )}
        </div>
      )}
    </span>
  );
};
