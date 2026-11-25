import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getPresidentForYear } from '../data/presidentialTerms';

export type CasebookPinKind =
  | 'line_item'
  | 'padding_diff'
  | 'duplicate_cluster'
  | 'lineage'
  | 'statistical_alert'
  | 'oaugf_query'
  | 'treasury_cash';

export type CasebookLedgerTag =
  | 'OAuGF Query'
  | 'Treasury Cash'
  | 'Bill Insertion'
  | 'Paid on Paper'
  | 'Compound Risk'
  | 'Zombie Lineage';

export const ALL_CASEBOOK_LEDGER_TAGS: CasebookLedgerTag[] = [
  'OAuGF Query',
  'Treasury Cash',
  'Bill Insertion',
  'Paid on Paper',
  'Compound Risk',
  'Zombie Lineage',
];

export interface CasebookLedgerProvenance {
  ledgerTags?: CasebookLedgerTag[];
  compoundRiskScore?: number;
  triggeredRulesCount?: number;
  oaugfQueryCount?: number;
  oaugfRepeatCount?: number;
  mdaIntegrityGrade?: string;
  paidOnPaper?: boolean;
  billInsertionStatus?: string | null;
  personalOrOpaqueCashFlag?: boolean;
}

export interface CasebookPin {
  pinId: string;
  kind: CasebookPinKind;
  financialYear: number;
  presidentName: string;
  projectCode?: string;
  title: string;
  mdaName: string;
  amountNaira: number;
  page?: number;
  sourceFilename?: string;
  sha256?: string | null;
  analystNote: string;
  tags: string[];
  pinnedAtIso: string;
  payloadSnapshot: Record<string, any>;
  ledgerProvenance?: CasebookLedgerProvenance;
}

export interface Casebook {
  id: string;
  name: string;
  description: string;
  createdAtIso: string;
  pins: CasebookPin[];
}

export interface PinCreationInput {
  pinId?: string;
  kind: CasebookPinKind;
  financialYear: number;
  projectCode?: string;
  title: string;
  mdaName: string;
  amountNaira: number;
  page?: number;
  sourceFilename?: string;
  sha256?: string | null;
  analystNote?: string;
  tags?: string[];
  payloadSnapshot?: Record<string, any>;
  ledgerProvenance?: CasebookLedgerProvenance;
}

export const CASEBOOK_STORAGE_KEY = 'budgetlens_casebooks_v1';

export function buildCanonicalPinId(input: Pick<PinCreationInput, 'kind' | 'financialYear' | 'projectCode' | 'title'>): string {
  const ref = (input.projectCode || input.title || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${input.kind}:${input.financialYear}:${ref || 'item'}`;
}

export function computeCasebookMetrics(pins: CasebookPin[]): {
  totalPins: number;
  totalExposureNaira: number;
  uniqueYears: number[];
  uniqueMdasCount: number;
  crossLedgerTaggedCount: number;
  ledgerTagCounts: Record<string, number>;
} {
  let totalExposureNaira = 0;
  const years = new Set<number>();
  const mdas = new Set<string>();
  let crossLedgerTaggedCount = 0;
  const ledgerTagCounts: Record<string, number> = {};

  for (const p of pins) {
    totalExposureNaira += Number(p.amountNaira) || 0;
    if (p.financialYear) years.add(p.financialYear);
    if (p.mdaName) mdas.add(p.mdaName);
    const prov = p.ledgerProvenance;
    const pTags = new Set<string>(prov?.ledgerTags || []);
    if (prov?.paidOnPaper) pTags.add('Paid on Paper');
    if (prov?.oaugfQueryCount && prov.oaugfQueryCount > 0) pTags.add('OAuGF Query');
    if (prov?.personalOrOpaqueCashFlag) pTags.add('Treasury Cash');
    if (prov?.billInsertionStatus) pTags.add('Bill Insertion');
    if ((prov?.triggeredRulesCount || 0) >= 2 || (prov?.compoundRiskScore || 0) >= 50) {
      pTags.add('Compound Risk');
    }
    if (pTags.size > 0) {
      crossLedgerTaggedCount += 1;
      for (const t of pTags) {
        ledgerTagCounts[t] = (ledgerTagCounts[t] || 0) + 1;
      }
    }
  }
  return {
    totalPins: pins.length,
    totalExposureNaira,
    uniqueYears: Array.from(years).sort((a, b) => a - b),
    uniqueMdasCount: mdas.size,
    crossLedgerTaggedCount,
    ledgerTagCounts,
  };
}

function createDefaultCasebook(): Casebook {
  return {
    id: 'default-casebook',
    name: 'Active Investigation Dossier',
    description: 'Multi-year appropriation evidence basket across Fourth Republic Federal Schedules (1999–2026).',
    createdAtIso: new Date().toISOString(),
    pins: [],
  };
}

interface CasebookContextType {
  casebooks: Casebook[];
  activeCasebook: Casebook;
  activeCasebookId: string;
  isDrawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  createCasebook: (name: string, description?: string) => void;
  switchCasebook: (id: string) => void;
  deleteCasebook: (id: string) => void;
  pinItem: (input: PinCreationInput) => CasebookPin;
  removePin: (pinId: string) => void;
  movePin: (pinId: string, direction: 'up' | 'down') => void;
  updatePinNote: (pinId: string, analystNote: string) => void;
  updatePinTags: (pinId: string, tags: string[]) => void;
  updatePinLedgerProvenance: (pinId: string, ledgerProvenance: CasebookLedgerProvenance) => void;
  isPinned: (pinId: string) => boolean;
}

const CasebookContext = createContext<CasebookContextType | undefined>(undefined);

export const CasebookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [casebooks, setCasebooks] = useState<Casebook[]>(() => {
    if (typeof window === 'undefined') return [createDefaultCasebook()];
    try {
      const raw = window.localStorage.getItem(CASEBOOK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.casebooks) && parsed.casebooks.length > 0) {
          return parsed.casebooks;
        }
      }
    } catch {
      // Ignore corrupt storage
    }
    return [createDefaultCasebook()];
  });

  const [activeCasebookId, setActiveCasebookId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'default-casebook';
    try {
      const raw = window.localStorage.getItem(CASEBOOK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.activeCasebookId === 'string') return parsed.activeCasebookId;
      }
    } catch {
      // Ignore
    }
    return 'default-casebook';
  });

  const [isDrawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        CASEBOOK_STORAGE_KEY,
        JSON.stringify({ activeCasebookId, casebooks })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [casebooks, activeCasebookId]);

  const activeCasebook = useMemo(
    () => casebooks.find((c) => c.id === activeCasebookId) || casebooks[0],
    [casebooks, activeCasebookId]
  );

  const createCasebook = useCallback((name: string, description = '') => {
    const clean = name.trim();
    if (!clean) return;
    const next: Casebook = {
      id: `cb-${Date.now()}`,
      name: clean,
      description: description.trim() || 'Cross-year investigative evidence dossier.',
      createdAtIso: new Date().toISOString(),
      pins: [],
    };
    setCasebooks((prev) => [...prev, next]);
    setActiveCasebookId(next.id);
  }, []);

  const switchCasebook = useCallback((id: string) => {
    setActiveCasebookId(id);
  }, []);

  const deleteCasebook = useCallback(
    (id: string) => {
      setCasebooks((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        const safe = filtered.length > 0 ? filtered : [createDefaultCasebook()];
        if (activeCasebookId === id) setActiveCasebookId(safe[0].id);
        return safe;
      });
    },
    [activeCasebookId]
  );

  const pinItem = useCallback(
    (input: PinCreationInput): CasebookPin => {
      const pinId = input.pinId || buildCanonicalPinId(input);
      const pres = getPresidentForYear(input.financialYear || 2026);
      const newPin: CasebookPin = {
        pinId,
        kind: input.kind,
        financialYear: input.financialYear || 2026,
        presidentName: pres.presidentName,
        projectCode: input.projectCode,
        title: input.title,
        mdaName: input.mdaName || 'Federal MDA',
        amountNaira: Number(input.amountNaira) || 0,
        page: input.page,
        sourceFilename: input.sourceFilename,
        sha256: input.sha256 ?? null,
        analystNote: input.analystNote || '',
        tags: input.tags || [],
        pinnedAtIso: new Date().toISOString(),
        payloadSnapshot: input.payloadSnapshot || {},
        ...(input.ledgerProvenance ? { ledgerProvenance: input.ledgerProvenance } : {}),
      };

      setCasebooks((prev) =>
        prev.map((cb) => {
          if (cb.id !== activeCasebook.id) return cb;
          if (cb.pins.some((p) => p.pinId === pinId)) return cb;
          return { ...cb, pins: [newPin, ...cb.pins] };
        })
      );
      return newPin;
    },
    [activeCasebook.id]
  );

  const removePin = useCallback(
    (pinId: string) => {
      setCasebooks((prev) =>
        prev.map((cb) =>
          cb.id === activeCasebook.id
            ? { ...cb, pins: cb.pins.filter((p) => p.pinId !== pinId) }
            : cb
        )
      );
    },
    [activeCasebook.id]
  );

  const movePin = useCallback(
    (pinId: string, direction: 'up' | 'down') => {
      setCasebooks((prev) =>
        prev.map((cb) => {
          if (cb.id !== activeCasebook.id) return cb;
          const idx = cb.pins.findIndex((p) => p.pinId === pinId);
          if (idx < 0) return cb;
          const target = direction === 'up' ? idx - 1 : idx + 1;
          if (target < 0 || target >= cb.pins.length) return cb;
          const nextPins = [...cb.pins];
          const [moved] = nextPins.splice(idx, 1);
          nextPins.splice(target, 0, moved);
          return { ...cb, pins: nextPins };
        })
      );
    },
    [activeCasebook.id]
  );

  const updatePinNote = useCallback(
    (pinId: string, analystNote: string) => {
      setCasebooks((prev) =>
        prev.map((cb) =>
          cb.id === activeCasebook.id
            ? {
                ...cb,
                pins: cb.pins.map((p) => (p.pinId === pinId ? { ...p, analystNote } : p)),
              }
            : cb
        )
      );
    },
    [activeCasebook.id]
  );

  const updatePinTags = useCallback(
    (pinId: string, tags: string[]) => {
      setCasebooks((prev) =>
        prev.map((cb) =>
          cb.id === activeCasebook.id
            ? {
                ...cb,
                pins: cb.pins.map((p) => (p.pinId === pinId ? { ...p, tags } : p)),
              }
            : cb
        )
      );
    },
    [activeCasebook.id]
  );

  const updatePinLedgerProvenance = useCallback(
    (pinId: string, ledgerProvenance: CasebookLedgerProvenance) => {
      setCasebooks((prev) =>
        prev.map((cb) =>
          cb.id === activeCasebook.id
            ? {
                ...cb,
                pins: cb.pins.map((p) =>
                  p.pinId === pinId
                    ? { ...p, ledgerProvenance: { ...p.ledgerProvenance, ...ledgerProvenance } }
                    : p
                ),
              }
            : cb
        )
      );
    },
    [activeCasebook.id]
  );

  const isPinned = useCallback(
    (pinId: string) => activeCasebook.pins.some((p) => p.pinId === pinId),
    [activeCasebook.pins]
  );

  return (
    <CasebookContext.Provider
      value={{
        casebooks,
        activeCasebook,
        activeCasebookId: activeCasebook.id,
        isDrawerOpen,
        setDrawerOpen,
        createCasebook,
        switchCasebook,
        deleteCasebook,
        pinItem,
        removePin,
        movePin,
        updatePinNote,
        updatePinTags,
        updatePinLedgerProvenance,
        isPinned,
      }}
    >
      {children}
    </CasebookContext.Provider>
  );
};

export const useCasebook = () => {
  const ctx = useContext(CasebookContext);
  if (!ctx) {
    throw new Error('useCasebook must be used within a CasebookProvider');
  }
  return ctx;
};
