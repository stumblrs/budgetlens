import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../services/apiClient';
import {
  ArrowUp,
  Download,
  FileSpreadsheet,
  Folder,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { useBudgetDatabase } from '../context/BudgetDatabaseContext';
import {
  AiCitationItem,
  AiDuplicateCluster,
  SupplementalDatasetsBundle,
  buildMultiDatasetContextSummary,
  detectAiModeFromQuery,
  findDuplicateClustersForQuery,
  findSimilarItemsForQuery,
  fmtNairaCompact,
  loadSupplementalAiDatasets,
  sanitizeAiPublicText,
} from '../utils/aiForensicEngine';
import { exportAiBriefingDocx, exportAiBriefingPdf } from '../utils/documentExporter';
import { buildCanonicalPermalink } from '../utils/urlState';
import { ExpandableText } from './ExpandableText';

interface Project {
  id: string;
  projectCode: string;
  projectName: string;
  financialYear: number;
  amount: number;
  projectType: string;
  page: number;
  sector: string;
  agency?: string;
  state?: string;
}

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  question?: string;
  groundingVerified?: boolean;
  totalMatches?: number;
  totalExposureNaira?: number;
  timestamp: string;
  citations?: AiCitationItem[];
  duplicateClusters?: AiDuplicateCluster[];
  similarItems?: AiCitationItem[];
  suggestions?: string[];
}

interface ChatFolder {
  id: string;
  name: string;
}

interface ChatThread {
  id: string;
  title: string;
  folderId: string | null;
  updatedAt: number;
  messages: Message[];
}

interface Props {
  projects?: Project[];
  onSelectProject?: (project: Project) => void;
}

const FOLDERS_STORAGE_KEY = 'budgetlens_ai_folders_v2';
const THREADS_STORAGE_KEY = 'budgetlens_ai_threads_v1';

function safeLoadFolders(): ChatFolder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string');
    }
  } catch {
    // Ignore storage read errors
  }
  return [];
}

function safeLoadThreads(): ChatThread[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(THREADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.messages));
    }
  } catch {
    // Ignore storage read errors
  }
  return [];
}

function isSameLocalDay(tsA: number, tsB: number): boolean {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const SUBJECT_STOP_WORDS = new Set([
  'is', 'are', 'was', 'were', 'there', 'any', 'some', 'do', 'does', 'did',
  'has', 'have', 'had', 'can', 'could', 'would', 'should', 'will', 'please',
  'tell', 'me', 'about', 'show', 'find', 'list', 'get', 'give', 'check',
  'search', 'what', 'which', 'who', 'where', 'when', 'how', 'much', 'many',
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from',
  'by', 'and', 'or', 'this', 'that', 'these', 'those', 'all', 'project',
  'projects', 'contract', 'contracts', 'contractor', 'contractors', 'budget',
  'budgets', 'allocation', 'allocations', 'spending', 'payment', 'payments',
  'paid', 'award', 'awards', 'awarded', 'company', 'firm', 'nigeria',
  'federal', 'year', 'years', 'duplicate', 'duplicates', 'similar', 'like',
]);

function extractCleanSubject(queryText: string): string {
  const cleaned = (queryText || '')
    .replace(/[?!.,'"()]/g, ' ')
    .replace(/\b(1999|20[0-2]\d)\b/g, ' ');
  const kept = cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && !SUBJECT_STOP_WORDS.has(w.toLowerCase()));
  const joined = kept.join(' ').trim();
  if (joined.length < 2 || kept.length > 4) return '';
  return joined;
}

function buildContextualFollowUps(queryText: string, mode: string, year: number): string[] {
  const subject = extractCleanSubject(queryText);

  if (subject) {
    if (mode === 'duplicates') {
      return [
        `Are there other ministries with allocations related to ${subject}?`,
        `How much has been paid out for ${subject}?`,
        `What were the largest ${subject} allocations in ${year}?`,
      ];
    }
    return [
      `Which ministries awarded contracts or allocations for ${subject}?`,
      `How much has actually been paid to ${subject}?`,
      `Are there repeated or split allocations linked to ${subject}?`,
    ];
  }

  if (mode === 'duplicates') {
    return [
      `Which ministries have the most repeated allocations in ${year}?`,
      `What are the largest capital projects in ${year}?`,
      `How much of the ${year} capital budget was actually released?`,
    ];
  }
  if (mode === 'policy') {
    return [
      `How did actual capital spending compare to the ${year} budget?`,
      `What are the largest capital allocations in ${year}?`,
      `Which ministries received the highest funding in ${year}?`,
    ];
  }
  if (mode === 'execution') {
    return [
      'Which contractors received the largest payments?',
      'Are there any same-day split payments to the same beneficiary?',
      `What are the largest capital projects in ${year}?`,
    ];
  }
  if (mode === 'scorecard') {
    return [
      'Which ministries have the lowest composite integrity scores?',
      'Which fiscal years recorded debt service overruns above budgeted limits?',
      `How did actual capital spending compare to the ${year} budget?`,
    ];
  }
  if (mode === 'procurement_risk') {
    return [
      'Which awarded contracts had the largest payment overruns?',
      'How many public procurement awards have zero recorded disbursements?',
      'Which ministries relied most heavily on emergency or direct procurement?',
    ];
  }
  if (mode === 'cash_forensics') {
    return [
      'Which ministries drove the largest December spending surges?',
      'Show top 7-day rolling payment clusters near approval thresholds.',
      `How does federal treasury digit conformity compare across ministries?`,
    ];
  }
  if (mode === 'vendor_capture') {
    return [
      'Which ministry-contractor pairs show captive share concentration?',
      'Which contractors appear across five or more ministries?',
      'Show top off-portal private beneficiaries receiving large treasury payouts.',
    ];
  }
  if (mode === 'follow_money') {
    return [
      'How much legislature-added spending progressed to awarded contracts?',
      'How many recurring project lineages switched contractors or stalled?',
      `What are the largest capital allocations in ${year}?`,
    ];
  }
  if (mode === 'oaugf_audit') {
    return [
      'Which ministries have the most OAuGF audit queries on unvouched payments?',
      'What due process violations did the Auditor-General flag in 2023 and 2024?',
      'Which ministries have the lowest composite integrity scores?',
    ];
  }
  if (mode === 'evidence_engine') {
    return [
      'Which ministries and contractors appear in Red-Flag Convergence with 3+ flags?',
      'What were the top compound-risk projects across 1999–2026?',
      'Compare administrations across enacted scrutiny, Auditor-General queries, and sovereign debt',
    ];
  }
  if (mode === 'convergence') {
    return [
      'Summarize 28-year Evidence Engine v3.0 findings and top compound-risk projects',
      'Which ministries have the most Auditor-General queries on unvouched payments?',
      'Which ministry-contractor pairs show captive share concentration?',
    ];
  }
  if (mode === 'presidential') {
    return [
      'Which federal ministries and contractors appear in Red-Flag Convergence with 3+ flags?',
      'Summarize 28-year Evidence Engine v3.0 findings and top compound-risk projects',
      'Which fiscal years recorded debt service overruns above budgeted limits?',
    ];
  }
  return [
    `What are the largest capital projects in ${year}?`,
    `Which ministries received the highest allocations in ${year}?`,
    `How much of the federal capital budget was released in ${year}?`,
  ];
}

/** Renders **bold** spans cleanly inside plain prose. */
const FormattedBriefText: React.FC<{ text: string; isUser?: boolean }> = ({ text, isUser }) => {
  const lines = (text || '').split('\n');
  const renderInline = (line: string) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={idx} style={{ fontWeight: 600, color: isUser ? '#ffffff' : 'var(--text-primary)' }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={idx}>{part}</React.Fragment>
      )
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.28rem', fontSize: '0.88rem', lineHeight: 1.55 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: '0.25rem' }} />;
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
};

export const GroundedAiAssistantWidget: React.FC<Props> = ({ onSelectProject }) => {
  const {
    search: dbSearch,
    records,
    activeYear,
    getRecordsForYear,
    statisticalForensics,
  } = useBudgetDatabase();

  const [bundle, setBundle] = useState<SupplementalDatasetsBundle | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > 768 : true
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [folders, setFolders] = useState<ChatFolder[]>(safeLoadFolders);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [threads, setThreads] = useState<ChatThread[]>(safeLoadThreads);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSupplementalAiDatasets().then(setBundle);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    } catch {
      // Ignore storage write errors
    }
  }, [folders]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
    } catch {
      // Ignore storage write errors
    }
  }, [threads]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const activeMessages = activeThread?.messages || [];

  const activeFolder = useMemo(
    () => folders.find((f) => f.id === activeFolderId) || null,
    [folders, activeFolderId]
  );

  useEffect(() => {
    if (activeMessages.length > 0 || loading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [activeMessages.length, loading]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of threads) {
      if (t.folderId) counts.set(t.folderId, (counts.get(t.folderId) || 0) + 1);
    }
    return counts;
  }, [threads]);

  const filteredThreads = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return [...threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((t) => {
        if (activeFolderId && t.folderId !== activeFolderId) return false;
        if (!q) return true;
        if (t.title.toLowerCase().includes(q)) return true;
        return t.messages.some((m) => m.text.toLowerCase().includes(q));
      });
  }, [threads, activeFolderId, historyQuery]);

  const { todayThreads, previousThreads } = useMemo(() => {
    const now = Date.now();
    const today: ChatThread[] = [];
    const previous: ChatThread[] = [];
    for (const t of filteredThreads) {
      if (isSameLocalDay(t.updatedAt, now)) today.push(t);
      else previous.push(t);
    }
    return { todayThreads: today, previousThreads: previous };
  }, [filteredThreads]);

  const handleCitationInspect = (c: AiCitationItem) => {
    if (!onSelectProject) return;
    const numericAmt =
      typeof c.amountNaira === 'number' && c.amountNaira > 0
        ? c.amountNaira
        : parseFloat(String(c.amount || '').replace(/[^0-9.]/g, '')) || 0;
    onSelectProject({
      id: c.id || c.code || `PAGE_${c.page}`,
      projectCode: c.code,
      projectName: c.title,
      financialYear: c.year || activeYear,
      amount: numericAmt,
      projectType: 'CAPITAL',
      page: c.page || 1,
      sector: c.sector || 'Federal Budget',
      agency: c.agency,
      state: c.state,
    });
  };

  const buildLocalFallbackResponse = (
    queryText: string,
    effectiveMode: string,
    loadedBundle: SupplementalDatasetsBundle | null
  ): Omit<Message, 'id' | 'sender' | 'timestamp'> => {
    const yrMatch = queryText.match(/\b(1999|20[0-2]\d)\b/);
    const explicitYear = yrMatch ? parseInt(yrMatch[1], 10) : undefined;
    const targetRecords =
      explicitYear && getRecordsForYear(explicitYear).length > 0
        ? getRecordsForYear(explicitYear)
        : records;
    const targetYear = explicitYear || activeYear;

    if (effectiveMode === 'duplicates') {
      const clusters = findDuplicateClustersForQuery(
        queryText,
        targetRecords,
        statisticalForensics,
        targetYear,
        explicitYear ? 'year' : 'all'
      );
      const flatCitations = clusters.flatMap((cl) => cl.items.slice(0, 2)).slice(0, 8);
      const totalExp = clusters.reduce((s, cl) => s + cl.totalAmountNaira, 0);
      const reply =
        clusters.length > 0
          ? `Found ${clusters.length} duplicate cluster(s) totaling ${fmtNairaCompact(totalExp)} across scanned schedules.`
          : `No multi-line duplicate clusters matched "${queryText}" in FY ${targetYear}.`;

      return {
        question: queryText,
        text: sanitizeAiPublicText(reply),
        groundingVerified: true,
        duplicateClusters: clusters,
        citations: flatCitations,
        totalMatches: clusters.length,
        totalExposureNaira: totalExp,
        suggestions: buildContextualFollowUps(queryText, effectiveMode, targetYear).map(sanitizeAiPublicText),
      };
    }

    if (effectiveMode === 'similar') {
      const simRes = findSimilarItemsForQuery(
        queryText,
        targetRecords,
        loadedBundle?.staticSearchRecords || [],
        targetYear,
        explicitYear ? 'year' : 'all'
      );
      const totalExp = simRes.similarItems.reduce((s, item) => s + (item.amountNaira || 0), 0);
      const reply =
        simRes.similarItems.length > 0
          ? `Matched ${simRes.similarItems.length} structurally similar line items totaling ${fmtNairaCompact(totalExp)}.`
          : `No similar appropriation lines found matching "${queryText}".`;

      return {
        question: queryText,
        text: sanitizeAiPublicText(reply),
        groundingVerified: true,
        similarItems: simRes.similarItems,
        citations: simRes.similarItems,
        totalMatches: simRes.similarItems.length,
        totalExposureNaira: totalExp,
        suggestions: buildContextualFollowUps(queryText, effectiveMode, targetYear).map(sanitizeAiPublicText),
      };
    }

    const modeArg = effectiveMode === 'policy' ? 'all' : effectiveMode;
    const suppBrief =
      effectiveMode !== 'all'
        ? buildMultiDatasetContextSummary({
          query: queryText,
          mode: modeArg as Parameters<typeof buildMultiDatasetContextSummary>[0]['mode'],
          activeYear: targetYear,
          statisticalForensics,
          bundle: loadedBundle,
        })
        : null;

    const cleanQuery = extractCleanSubject(queryText) || queryText;
    const matched = dbSearch(cleanQuery, 10);
    const staticMatches: AiCitationItem[] =
      loadedBundle?.staticSearchRecords?.length
        ? findSimilarItemsForQuery(cleanQuery, [], loadedBundle.staticSearchRecords, targetYear, 'all').similarItems.slice(0, 6)
        : [];

    const primaryCitations: AiCitationItem[] = matched.slice(0, 8).map((r) => ({
      id: r.recordIdentity.id,
      code: r.recordIdentity.projectCode || 'ERGP',
      title: r.recordIdentity.verbatimProjectName,
      amount: r.recordIdentity.amountFormatted || fmtNairaCompact(r.recordIdentity.amountNaira),
      amountNaira: r.recordIdentity.amountNaira,
      page: r.sourceProvenance.pdfPage,
      agency: r.mdaGovernanceTaxonomy.mdaName,
      year: r.recordIdentity.financialYear,
      sector: r.mdaGovernanceTaxonomy.sector,
      state: r.geographicTaxonomy.state,
      gemmaReview: r.gemmaAnalyticalOverlay || null,
    }));

    const compoundCitations: AiCitationItem[] =
      effectiveMode === 'evidence_engine' &&
        primaryCitations.length === 0 &&
        loadedBundle?.evidenceEngineAllYears?.topCompoundProjectsAllTime?.length
        ? loadedBundle.evidenceEngineAllYears.topCompoundProjectsAllTime.slice(0, 6).map((c) => ({
          id: c.id || c.projectCode,
          code: c.projectCode || 'ERGP',
          title: `${c.projectName} [Risk ${c.compoundRiskScore}/100 · ${c.ruleCount} rules]`,
          amount: fmtNairaCompact(c.amount),
          amountNaira: c.amount,
          page: c.page || 1,
          agency: c.agency,
          year: c.financialYear,
        }))
        : [];

    const citations =
      primaryCitations.length > 0
        ? primaryCitations
        : compoundCitations.length > 0
          ? compoundCitations
          : staticMatches;
    const totalExp = citations.reduce((s, c) => s + (c.amountNaira || 0), 0);

    const lines: string[] = [];
    if (suppBrief) {
      lines.push(suppBrief.headline.replace(/Bill vs\. Act Legislative Padding Dossier/gi, 'Budget Changes Summary'));
      for (const b of suppBrief.bullets) {
        lines.push(`• ${b.replace(/,\s*p\.\d+/gi, '')}`);
      }
      if (suppBrief.extraLine) lines.push(`• ${suppBrief.extraLine}`);
    }
    if (citations.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`Matched ${citations.length} budget records totaling ${fmtNairaCompact(totalExp)}.`);
    } else if (!suppBrief) {
      lines.push(`No matching budget records found for "${queryText}". Try a shorter keyword or a specific ministry or contractor name.`);
    }

    return {
      question: queryText,
      text: sanitizeAiPublicText(lines.join('\n')),
      groundingVerified: true,
      citations,
      totalMatches: citations.length,
      totalExposureNaira: totalExp,
      suggestions: buildContextualFollowUps(queryText, effectiveMode, targetYear).map(sanitizeAiPublicText),
    };
  };

  const appendMessageToThread = (threadId: string, msg: Message) => {
    const now = Date.now();
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, updatedAt: now, messages: [...t.messages, msg] } : t
      )
    );
  };

  const handleSend = async (textToSend?: string) => {
    const queryText = (textToSend ?? input).trim();
    if (!queryText || loading) return;

    const detectedMode = detectAiModeFromQuery(queryText, 'all');
    const now = Date.now();
    const userMsg: Message = {
      id: `u-${now}`,
      sender: 'user',
      text: queryText,
      timestamp: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    let targetThreadId = activeThreadId;
    if (!targetThreadId) {
      targetThreadId = `chat-${now}`;
      const title = queryText.length > 36 ? `${queryText.slice(0, 36)}…` : queryText;
      const newThread: ChatThread = {
        id: targetThreadId,
        title,
        folderId: activeFolderId,
        updatedAt: now,
        messages: [userMsg],
      };
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(targetThreadId);
    } else {
      appendMessageToThread(targetThreadId, userMsg);
    }

    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const endpoint = apiUrl('/api/ai/query');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: queryText,
          financialYear: null,
          mode: detectedMode === 'all' ? null : detectedMode,
          scope: 'all',
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data?.available) {
          const responseMode = String(data.queryMode || detectedMode);
          const aiMsg: Message = {
            id: `a-${Date.now()}`,
            sender: 'ai',
            question: queryText,
            text: sanitizeAiPublicText(String(data.answer || '')),
            groundingVerified: Boolean(data.groundingVerified),
            totalMatches: data.totalMatches,
            totalExposureNaira: data.totalExposureNaira,
            duplicateClusters: Array.isArray(data.duplicateClusters) ? data.duplicateClusters : [],
            similarItems: Array.isArray(data.similarItems) ? data.similarItems : [],
            citations: Array.isArray(data.citations) ? data.citations : [],
            suggestions: buildContextualFollowUps(queryText, responseMode, activeYear).map(sanitizeAiPublicText),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
          appendMessageToThread(targetThreadId, aiMsg);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Fallback to local multi-dataset search
    }

    const activeBundle = bundle || (await loadSupplementalAiDatasets());
    const fallback = buildLocalFallbackResponse(queryText, detectedMode, activeBundle);
    appendMessageToThread(targetThreadId, {
      id: `a-${Date.now()}`,
      sender: 'ai',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...fallback,
    });
    setLoading(false);
  };

  const handleCreateFolder = () => {
    const clean = newFolderName.trim();
    if (!clean) {
      setCreatingFolder(false);
      return;
    }
    const id = `${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    setFolders((prev) => [...prev, { id, name: clean }]);
    setActiveFolderId(id);
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const handleDeleteFolder = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation();
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setThreads((prev) => prev.map((t) => (t.folderId === folderId ? { ...t, folderId: null } : t)));
    if (activeFolderId === folderId) {
      setActiveFolderId(null);
    }
  };

  const handleDeleteThread = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderComposerBox = (centered: boolean) => (
    <div
      style={{
        width: '100%',
        maxWidth: centered ? '640px' : '720px',
        margin: centered ? undefined : '0 auto',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)',
        padding: centered ? '0.9rem 1rem 0.75rem' : '0.65rem 0.9rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <textarea
        rows={centered ? 3 : 2}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleComposerKeyDown}
        maxLength={350}
        disabled={loading}
        placeholder="Ask me anything..."
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontSize: '0.92rem',
          lineHeight: 1.5,
          color: 'var(--text-primary)',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={loading || !input.trim()}
          aria-label="Send question"
          style={{
            width: '30px',
            height: '30px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: input.trim() && !loading ? 'var(--emerald-primary)' : 'var(--bg-primary)',
            color: input.trim() && !loading ? '#ffffff' : 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            transition: 'background-color 0.15s ease, color 0.15s ease',
          }}
        >
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );

  const renderThreadList = (items: ChatThread[]) =>
    items.map((t) => {
      const isSelected = t.id === activeThreadId;
      return (
        <div
          key={t.id}
          onClick={() => setActiveThreadId(t.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setActiveThreadId(t.id);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.4rem',
            padding: '0.42rem 0.55rem',
            borderRadius: '7px',
            cursor: 'pointer',
            backgroundColor: isSelected ? 'var(--emerald-bg)' : 'transparent',
            color: isSelected ? '#047857' : 'var(--text-primary)',
            fontSize: '0.79rem',
            fontWeight: isSelected ? 600 : 400,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {t.title}
          </span>
          <button
            type="button"
            onClick={(e) => handleDeleteThread(e, t.id)}
            aria-label={`Delete ${t.title}`}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0.12rem',
              color: 'var(--text-light)',
              display: 'inline-flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      );
    });

  return (
    <div className="ai-chat-shell">
      {/* Left AI Sidebar Backdrop (Mobile Overlay) */}
      {sidebarOpen && (
        <div
          className="ai-chat-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left AI Sidebar */}
      {sidebarOpen && (
        <aside className="ai-chat-sidebar">
          {/* Top Brand Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--emerald-primary)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={13} />
              </div>
              <span className="font-editorial" style={{ fontSize: '1.08rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                BudgetLens AI
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="Collapse sidebar"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0.25rem',
                color: 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          {/* Primary Actions: New Chat & Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '1.05rem' }}>
            <button
              type="button"
              onClick={() => setActiveThreadId(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                padding: '0.46rem 0.5rem',
                borderRadius: '7px',
                border: 'none',
                backgroundColor: activeThreadId === null ? 'var(--bg-primary)' : 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 500,
                textAlign: 'left',
              }}
            >
              <SquarePen size={15} color="var(--text-secondary)" />
              <span>New Chat</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSearchOpen((prev) => {
                  if (prev) setHistoryQuery('');
                  return !prev;
                });
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                padding: '0.46rem 0.5rem',
                borderRadius: '7px',
                border: 'none',
                backgroundColor: searchOpen ? 'var(--bg-primary)' : 'transparent',
                color: 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 500,
                textAlign: 'left',
              }}
            >
              <Search size={15} color="var(--text-secondary)" />
              <span>Search</span>
            </button>

            {searchOpen && (
              <div style={{ paddingTop: '0.25rem' }}>
                <input
                  type="text"
                  value={historyQuery}
                  onChange={(e) => setHistoryQuery(e.target.value)}
                  placeholder="Search conversations..."
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0.38rem 0.6rem',
                    borderRadius: '7px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.78rem',
                  }}
                />
              </div>
            )}
          </div>

          {/* Projects Section */}
          <div style={{ marginBottom: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem', paddingLeft: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Projects
              </span>
              <button
                type="button"
                onClick={() => setCreatingFolder((prev) => !prev)}
                aria-label="Create project folder"
                style={{
                  padding: '0.3rem 0.42rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--card-bg)',
                  color: 'var(--text-secondary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FolderPlus size={14} />
              </button>
            </div>

            {creatingFolder && (
              <div style={{ marginBottom: '0.45rem' }}>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder();
                    if (e.key === 'Escape') {
                      setNewFolderName('');
                      setCreatingFolder(false);
                    }
                  }}
                  onBlur={handleCreateFolder}
                  placeholder="Project name..."
                  autoFocus
                  maxLength={32}
                  style={{
                    width: '100%',
                    padding: '0.36rem 0.55rem',
                    borderRadius: '7px',
                    border: '1px solid var(--emerald-primary)',
                    backgroundColor: 'var(--card-bg)',
                    color: 'var(--text-primary)',
                    fontSize: '0.78rem',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
              {folders.length === 0 && !creatingFolder ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', padding: '0.2rem 0.45rem' }}>
                  No projects yet
                </div>
              ) : (
                folders.map((folder) => {
                  const isSelected = activeFolderId === folder.id;
                  const count = folderCounts.get(folder.id) || 0;
                  return (
                    <div
                      key={folder.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveFolderId((prev) => (prev === folder.id ? null : folder.id))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setActiveFolderId((prev) => (prev === folder.id ? null : folder.id));
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.45rem',
                        padding: '0.42rem 0.5rem',
                        borderRadius: '7px',
                        cursor: 'pointer',
                        backgroundColor: isSelected ? 'var(--emerald-bg)' : 'transparent',
                        color: isSelected ? '#047857' : 'var(--text-primary)',
                        fontSize: '0.8rem',
                        fontWeight: isSelected ? 600 : 500,
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden', flex: 1 }}>
                        <Folder size={14} color={isSelected ? '#047857' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {folder.name}
                        </span>
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem', flexShrink: 0 }}>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.68rem',
                            padding: '0.1rem 0.44rem',
                            borderRadius: '999px',
                            backgroundColor: isSelected ? '#d1fae5' : 'var(--bg-primary)',
                            color: isSelected ? '#047857' : 'var(--text-secondary)',
                          }}
                        >
                          {String(count).padStart(2, '0')}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteFolder(e, folder.id)}
                          aria-label={`Delete project ${folder.name}`}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '0.12rem',
                            color: 'var(--text-light)',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Conversation History */}
          <div style={{ flex: 1, overflowY: 'auto', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <div
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 600,
                  letterSpacing: '0.07em',
                  color: 'var(--text-muted)',
                  padding: '0 0.45rem 0.3rem',
                  textTransform: 'uppercase',
                }}
              >
                TODAY
              </div>
              {todayThreads.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  {renderThreadList(todayThreads)}
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', padding: '0.2rem 0.45rem' }}>
                  No conversations yet
                </div>
              )}
            </div>

            {previousThreads.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: '0.66rem',
                    fontWeight: 600,
                    letterSpacing: '0.07em',
                    color: 'var(--text-muted)',
                    padding: '0 0.45rem 0.3rem',
                    textTransform: 'uppercase',
                  }}
                >
                  PREVIOUS
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  {renderThreadList(previousThreads)}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Right Framed Chat Surface */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '14px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Minimal Top Bar only when sidebar collapsed or folder filter active */}
          {(!sidebarOpen || activeFolder) && (
            <div
              style={{
                padding: '0.6rem 0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open sidebar"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '0.25rem',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  <PanelLeftOpen size={16} />
                </button>
              )}
              {activeFolder && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    backgroundColor: 'var(--emerald-bg)',
                    color: '#047857',
                    padding: '0.18rem 0.5rem',
                    borderRadius: '999px',
                  }}
                >
                  <Folder size={12} />
                  {activeFolder.name}
                  <button
                    type="button"
                    onClick={() => setActiveFolderId(null)}
                    aria-label="Clear folder filter"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      color: '#047857',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
            </div>
          )}

          {/* Empty State vs Active Chat */}
          {activeMessages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem 1.5rem',
              }}
            >
              <h1
                style={{
                  fontSize: '1.9rem',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  marginBottom: '1.35rem',
                  textAlign: 'center',
                  background: 'linear-gradient(90deg, #047857 0%, #10b981 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Hey, How Can I Assist?
              </h1>
              {renderComposerBox(true)}
              <div
                style={{
                  marginTop: '1.1rem',
                  maxWidth: '640px',
                  width: '100%',
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '0.45rem',
                }}
              >
                {[
                  'Compare Buhari and Tinubu across Fourth Republic scrutiny, Auditor-General queries, and sovereign debt',
                  'Which federal ministries and contractors appear in Red-Flag Convergence with 3+ flags?',
                  'Summarize 28-year Evidence Engine v3.0 findings and top compound-risk projects',
                  'Which ministries have the most OAuGF audit queries on unvouched payments?',
                ].map((promptText, pIdx) => {
                  const cleanPrompt = sanitizeAiPublicText(promptText);
                  return (
                    <button
                      key={pIdx}
                      type="button"
                      disabled={loading}
                      onClick={() => handleSend(cleanPrompt)}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.35rem 0.7rem',
                        borderRadius: '999px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {cleanPrompt}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.25rem' }}>
                <div
                  style={{
                    maxWidth: '720px',
                    width: '100%',
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1.05rem',
                  }}
                >
                  {activeMessages.map((m) => {
                    const isUser = m.sender === 'user';
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isUser ? 'flex-end' : 'flex-start',
                          gap: '0.35rem',
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '88%',
                            padding: '0.78rem 1rem',
                            borderRadius: '12px',
                            backgroundColor: isUser ? 'var(--sidebar-bg)' : 'var(--bg-secondary)',
                            color: isUser ? '#ffffff' : 'var(--text-primary)',
                            border: isUser ? 'none' : '1px solid var(--border-subtle)',
                          }}
                        >
                          <FormattedBriefText text={m.text} isUser={isUser} />

                          {/* Cited Budget Records */}
                          {!isUser && m.citations && m.citations.length > 0 && (
                            <div
                              style={{
                                marginTop: '0.65rem',
                                paddingTop: '0.55rem',
                                borderTop: '1px solid var(--border-subtle)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.32rem',
                              }}
                            >
                              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                                Cited Budget Records ({m.citations.length})
                              </div>
                              {m.citations.slice(0, 6).map((c, idx) => (
                                <div
                                  key={`${c.id || c.code}-${idx}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleCitationInspect(c)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleCitationInspect(c);
                                    }
                                  }}
                                  style={{
                                    textAlign: 'left',
                                    padding: '0.18rem 0',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.78rem',
                                    cursor: onSelectProject ? 'pointer' : 'default',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: '0.75rem',
                                  }}
                                >
                                  <span>
                                    <span className="font-mono" style={{ color: 'var(--text-muted)', marginRight: '0.4rem' }}>
                                      [{c.year}]
                                    </span>
                                    <ExpandableText text={c.title} maxChars={140} />
                                  </span>
                                  <span className="font-mono tabular-nums" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                                    {c.amount}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Strict PDF / DOCX Export Buttons */}
                          {!isUser && (m.citations?.length || m.question) && (
                            <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() =>
                                  exportAiBriefingPdf({
                                    question: m.question || 'BudgetLens AI Investigation',
                                    answer: m.text,
                                    financialYear: activeYear || 2026,
                                    groundingVerified: m.groundingVerified ?? true,
                                    totalMatches: m.totalMatches,
                                    totalExposureNaira: m.totalExposureNaira,
                                    citations: (m.citations || []).map((c) => ({
                                      code: c.code,
                                      title: c.title,
                                      amount: c.amount,
                                      page: c.page,
                                      agency: c.agency,
                                      year: c.year,
                                      sector: c.sector,
                                    })),
                                    permalink: buildCanonicalPermalink({ tab: 'ai', year: activeYear || 2026 }),
                                  })
                                }
                                className="editorial-btn"
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                              >
                                <Download size={11} /> PDF
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  exportAiBriefingDocx({
                                    question: m.question || 'BudgetLens AI Investigation',
                                    answer: m.text,
                                    financialYear: activeYear || 2026,
                                    groundingVerified: m.groundingVerified ?? true,
                                    totalMatches: m.totalMatches,
                                    totalExposureNaira: m.totalExposureNaira,
                                    citations: (m.citations || []).map((c) => ({
                                      code: c.code,
                                      title: c.title,
                                      amount: c.amount,
                                      page: c.page,
                                      agency: c.agency,
                                      year: c.year,
                                      sector: c.sector,
                                    })),
                                    permalink: buildCanonicalPermalink({ tab: 'ai', year: activeYear || 2026 }),
                                  })
                                }
                                className="editorial-btn"
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                              >
                                <FileSpreadsheet size={11} /> DOCX
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Contextual Follow-up Questions (only suggested during an active chat) */}
                        {!isUser && m.suggestions && m.suggestions.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingLeft: '0.2rem', maxWidth: '88%' }}>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              Suggested follow-up questions:
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {m.suggestions.map((q, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => handleSend(q)}
                                  disabled={loading}
                                  style={{
                                    fontSize: '0.76rem',
                                    padding: '0.24rem 0.6rem',
                                    borderRadius: '7px',
                                    border: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--card-bg)',
                                    color: 'var(--text-primary)',
                                    textAlign: 'left',
                                  }}
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {loading && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Searching records...
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              <div style={{ padding: '0.75rem 1.25rem 0.95rem', borderTop: '1px solid var(--border-subtle)' }}>
                {renderComposerBox(false)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
