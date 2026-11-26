import React, { useEffect, useState } from 'react';
import { Download, Eye, FileText, Loader2 } from 'lucide-react';
import {
  buildTabularDossierPdfBytes,
  exportTabularDossierPdf,
  type TabularDossierSpec,
} from '../utils/documentExporter';

interface ExtractedPdfPreviewProps {
  spec: TabularDossierSpec | null;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  minHeight?: string;
}

export const ExtractedPdfPreview: React.FC<ExtractedPdfPreviewProps> = ({
  spec,
  title = 'Verified Extract PDF',
  subtitle,
  children,
  minHeight = '72vh',
}) => {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [viewMode, setViewMode] = useState<'pdf' | 'sheet'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'sheet' : 'pdf'
  );
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!spec || !isDesktop || viewMode !== 'pdf') return;
    let active = true;
    let createdUrl: string | null = null;
    setGenerating(true);
    setGenError(null);

    const timer = window.setTimeout(async () => {
      try {
        const bytes = await buildTabularDossierPdfBytes(spec);
        if (!active) return;
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const blob = new Blob([copy], { type: 'application/pdf' });
        createdUrl = URL.createObjectURL(blob);
        setPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return createdUrl;
        });
      } catch {
        if (active) setGenError('Unable to render inline PDF preview; use Searchable Sheet or Download PDF.');
      } finally {
        if (active) setGenerating(false);
      }
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [spec, isDesktop, viewMode]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const handleDownload = async () => {
    if (!spec || downloading) return;
    setDownloading(true);
    try {
      await exportTabularDossierPdf(spec);
    } finally {
      setDownloading(false);
    }
  };

  const showInlinePdf = isDesktop && viewMode === 'pdf' && Boolean(spec);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '0.75rem' }}>
      {/* Option A Mode Switcher + Download Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.6rem',
          padding: '0.55rem 0.85rem',
          borderRadius: '8px',
          backgroundColor: '#1e293b',
          border: '1px solid #334155',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <FileText size={15} color="#34d399" />
          <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{title}</span>
          {subtitle && (
            <span className="font-mono" style={{ fontSize: '0.69rem', color: '#94a3b8' }}>
              · {subtitle}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          {isDesktop && (
            <div
              style={{
                display: 'inline-flex',
                borderRadius: '6px',
                border: '1px solid #334155',
                overflow: 'hidden',
                backgroundColor: '#0f172a',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                style={{
                  padding: '0.32rem 0.65rem',
                  border: 'none',
                  backgroundColor: viewMode === 'pdf' ? '#047857' : 'transparent',
                  color: viewMode === 'pdf' ? '#ffffff' : '#cbd5e1',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <FileText size={13} /> Live PDF Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sheet')}
                style={{
                  padding: '0.32rem 0.65rem',
                  border: 'none',
                  backgroundColor: viewMode === 'sheet' ? '#047857' : 'transparent',
                  color: viewMode === 'sheet' ? '#ffffff' : '#cbd5e1',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <Eye size={13} /> Searchable Sheet
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={!spec || downloading}
            onClick={handleDownload}
            style={{
              padding: '0.34rem 0.72rem',
              borderRadius: '6px',
              border: '1px solid #10b981',
              backgroundColor: '#059669',
              color: '#ffffff',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: !spec || downloading ? 'not-allowed' : 'pointer',
              opacity: !spec || downloading ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.32rem',
            }}
          >
            <Download size={13} />
            {downloading ? 'Building PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {showInlinePdf ? (
        <div
          style={{
            width: '100%',
            minHeight,
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #475569',
            backgroundColor: '#0f172a',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {generating && !pdfUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#e2e8f0', fontSize: '0.85rem', padding: '2rem' }}>
              <Loader2 size={16} className="animate-spin" /> Generating typeset PDF from extracted records…
            </div>
          ) : genError ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: '#fca5a5', fontSize: '0.82rem' }}>
              {genError}
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={title}
              style={{
                width: '100%',
                height: minHeight,
                border: 'none',
                backgroundColor: '#ffffff',
              }}
            />
          ) : null}
        </div>
      ) : (
        children
      )}
    </div>
  );
};
