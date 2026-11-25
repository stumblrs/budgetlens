import React, { useEffect, useState } from 'react';
import { datasetUrl } from '../services/apiClient';
import { BookOpen, ChevronDown, ChevronUp, FileText, Quote } from 'lucide-react';

interface MacroFramework {
  benchmarkOilPriceUSD?: number | null;
  dailyOilProductionMBPD?: number | null;
  exchangeRateNairaPerUSD?: number | null;
  projectedGdpGrowthPercent?: number | null;
  inflationRatePercent?: number | null;
}

interface DocumentBreakdownItem {
  filename: string;
  docCategory: string;
  totalPages: number;
  extractedChars: number;
  extractionMode: string;
}

interface VerbatimExcerpt {
  sourceFile: string;
  page: number;
  docCategory: string;
  excerpt: string;
}

export interface YearNarrativeDossier {
  financialYear: number;
  lastUpdated?: string;
  budgetTheme: string;
  sourcesAnalyzed: number;
  documentBreakdown?: DocumentBreakdownItem[];
  macroeconomicFramework?: MacroFramework;
  policyPriorities?: string[];
  executiveSummary?: string;
  verbatimExcerpts?: VerbatimExcerpt[];
}

interface MacroNarrativeBriefProps {
  financialYear: number;
}

function formatMetric(value: number | null | undefined, prefix = '', suffix = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${prefix}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

export const MacroNarrativeBrief: React.FC<MacroNarrativeBriefProps> = ({ financialYear }) => {
  const [dossier, setDossier] = useState<YearNarrativeDossier | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showExcerpts, setShowExcerpts] = useState<boolean>(false);
  const [showSources, setShowSources] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch(datasetUrl(`/datasets/narratives/${financialYear}.json`), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: YearNarrativeDossier | null) => {
        if (!active) return;
        setDossier(data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setDossier(null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [financialYear]);

  if (loading) {
    return (
      <section className="dossier-card" style={{ padding: '1.5rem' }} aria-label="Fiscal Policy Dossier Loading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            FY {financialYear} Policy & Macroeconomic Brief — Loading...
          </span>
        </div>
      </section>
    );
  }

  if (!dossier) {
    return null;
  }

  const macro = dossier.macroeconomicFramework ?? {};
  const priorities = (dossier.policyPriorities ?? []).slice(0, 6);
  const excerpts = (dossier.verbatimExcerpts ?? []).slice(0, 4);
  const docs = dossier.documentBreakdown ?? [];

  const benchmarks = [
    { label: 'Oil Benchmark', value: formatMetric(macro.benchmarkOilPriceUSD, '$', '/bbl') },
    { label: 'Daily Output', value: formatMetric(macro.dailyOilProductionMBPD, '', ' mbpd') },
    { label: 'Official FX', value: formatMetric(macro.exchangeRateNairaPerUSD, '₦', '/$') },
    { label: 'GDP Growth', value: formatMetric(macro.projectedGdpGrowthPercent, '', '%') },
    { label: 'Inflation Est.', value: formatMetric(macro.inflationRatePercent, '', '%') },
  ];

  return (
    <section
      className="dossier-card"
      style={{
        padding: '1.5rem 1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}
      aria-label={`FY ${financialYear} Policy and Macroeconomic Brief`}
    >
      {/* Editorial Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ flex: '1 1 340px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.4rem',
            }}
          >
            <BookOpen size={14} style={{ color: 'var(--accent-primary)' }} />
            <span
              className="font-mono"
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--accent-primary)',
                fontWeight: 600,
              }}
            >
              FY {financialYear} Policy & Macroeconomic Dossier
            </span>
          </div>
          <h2
            className="font-editorial"
            style={{
              fontSize: '1.45rem',
              lineHeight: 1.25,
              color: 'var(--text-primary)',
              margin: 0,
              fontWeight: 600,
            }}
          >
            {dossier.budgetTheme || `Federal Budget Policy Framework (${financialYear})`}
          </h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowSources((prev) => !prev)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.35rem 0.7rem',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--text-secondary)',
              fontSize: '0.75rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <FileText size={13} />
            <span className="tabular-nums">{dossier.sourcesAnalyzed} Source Docs</span>
            {showSources ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {excerpts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowExcerpts((prev) => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.35rem 0.7rem',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: showExcerpts ? 'var(--text-primary)' : 'var(--bg-canvas)',
                color: showExcerpts ? '#ffffff' : 'var(--text-primary)',
                fontSize: '0.75rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Quote size={13} />
              <span>{showExcerpts ? 'Hide Citations' : `Verbatim Citations (${excerpts.length})`}</span>
            </button>
          )}
        </div>
      </div>

      {/* 5-Metric Macroeconomic Benchmark Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {benchmarks.map((item) => (
          <div
            key={item.label}
            style={{
              padding: '0.7rem 0.85rem',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            <span
              style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              {item.label}
            </span>
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: '1.05rem',
                fontWeight: 600,
                color: item.value === '—' ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Executive Summary & Policy Priorities */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: priorities.length > 0 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
          gap: '1.25rem',
          alignItems: 'start',
        }}
      >
        {dossier.executiveSummary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <span
              style={{
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              Executive Policy Summary
            </span>
            <p
              style={{
                margin: 0,
                fontSize: '0.88rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
              }}
            >
              {dossier.executiveSummary}
            </p>
          </div>
        )}

        {priorities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <span
              style={{
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              Key Fiscal & Sector Priorities
            </span>
            <ol
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              {priorities.map((priority, idx) => (
                <li
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.6rem',
                    paddingBottom: '0.35rem',
                    borderBottom: idx < priorities.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    fontSize: '0.83rem',
                    lineHeight: 1.45,
                    color: 'var(--text-primary)',
                  }}
                >
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--accent-primary)',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span>{priority}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Collapsible Source Breakdown */}
      {showSources && docs.length > 0 && (
        <div
          style={{
            paddingTop: '0.9rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <span
            style={{
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            Primary Narrative Documents Indexed ({docs.length})
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {docs.map((doc) => (
              <div
                key={doc.filename}
                style={{
                  padding: '0.4rem 0.65rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-canvas)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{doc.filename}</span>
                <span className="font-mono tabular-nums" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  {doc.docCategory} · {doc.totalPages}p
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Verbatim Excerpts */}
      {showExcerpts && excerpts.length > 0 && (
        <div
          style={{
            paddingTop: '0.9rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <span
            style={{
              fontSize: '0.72rem',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            Verbatim Archival Excerpts
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {excerpts.map((item, idx) => (
              <blockquote
                key={`${item.sourceFile}-${item.page}-${idx}`}
                style={{
                  margin: 0,
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-canvas)',
                  borderLeft: '3px solid var(--accent-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.8rem',
                    lineHeight: 1.55,
                    color: 'var(--text-secondary)',
                    fontStyle: 'italic',
                  }}
                >
                  “{item.excerpt}”
                </p>
                <footer
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  {item.sourceFile} · p. {item.page} ({item.docCategory})
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
