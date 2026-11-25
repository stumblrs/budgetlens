import {
  applyRules,
  buildCompoundFlaggedProjects,
  type CompoundFlaggedProject,
  type EvidenceItem,
} from '../utils/ruleEngine';
import { detectDuplicates, type DuplicateCluster } from '../utils/duplicateDetector';
import type { CrossLedgerContextWire } from '../utils/evidenceEngineV3';
import type { ForensicWorkerRequest, ForensicWorkerResponse } from '../workers/forensicWorker';

export interface ForensicScanResult {
  evidenceItems: EvidenceItem[];
  compoundProjects: CompoundFlaggedProject[];
  duplicateClusters: DuplicateCluster[];
  durationMs: number;
  usedWorker: boolean;
}

interface PendingScan {
  resolve: (result: ForensicScanResult) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let workerInstance: Worker | null = null;
let workerDisabled = false;
let nextRequestId = 0;
const pendingScans = new Map<number, PendingScan>();

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Forensic scan aborted', 'AbortError');
  }
  const err = new Error('Forensic scan aborted');
  err.name = 'AbortError';
  return err;
}

function runInlineScan(
  projects: any[],
  crossLedgerContext?: CrossLedgerContextWire | null
): ForensicScanResult {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const safeProjects = Array.isArray(projects) ? projects : [];
  const evidenceItems = applyRules(safeProjects, crossLedgerContext);
  const compoundProjects = buildCompoundFlaggedProjects(evidenceItems);
  const duplicateClusters = detectDuplicates(safeProjects);
  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    evidenceItems,
    compoundProjects,
    duplicateClusters,
    durationMs: Math.max(0, Math.round(finishedAt - startedAt)),
    usedWorker: false,
  };
}

function cleanupPending(requestId: number): PendingScan | undefined {
  const entry = pendingScans.get(requestId);
  if (!entry) return undefined;
  pendingScans.delete(requestId);
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener('abort', entry.onAbort);
  }
  return entry;
}

function getForensicWorker(): Worker | null {
  if (workerDisabled || typeof Worker === 'undefined') {
    return null;
  }
  if (workerInstance) {
    return workerInstance;
  }

  try {
    const worker = new Worker(new URL('../workers/forensicWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (ev: MessageEvent<ForensicWorkerResponse>) => {
      const {
        requestId,
        evidenceItems,
        compoundProjects,
        duplicateClusters,
        durationMs,
        error,
      } = ev.data;
      const entry = cleanupPending(requestId);
      if (!entry) return;
      if (error) {
        entry.reject(new Error(error));
        return;
      }
      entry.resolve({
        evidenceItems,
        compoundProjects: compoundProjects || buildCompoundFlaggedProjects(evidenceItems),
        duplicateClusters,
        durationMs,
        usedWorker: true,
      });
    };

    worker.onerror = () => {
      workerDisabled = true;
      workerInstance = null;
      const entries = Array.from(pendingScans.keys());
      for (const id of entries) {
        const entry = cleanupPending(id);
        entry?.reject(new Error('Forensic worker encountered an unexpected error'));
      }
    };

    workerInstance = worker;
    return workerInstance;
  } catch {
    workerDisabled = true;
    return null;
  }
}

/**
 * Runs deterministic Rule Engine v3.0 (22 rules) + Compound Project Grouping + O(N) duplicate detection
 * off the main thread via a module Web Worker, falling back cleanly to inline execution where Workers are unsupported.
 */
export async function runForensicScan(
  projects: any[],
  financialYear: number,
  signal?: AbortSignal,
  crossLedgerContext?: CrossLedgerContextWire | null
): Promise<ForensicScanResult> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  if (!projects || projects.length === 0) {
    return {
      evidenceItems: [],
      compoundProjects: [],
      duplicateClusters: [],
      durationMs: 0,
      usedWorker: false,
    };
  }

  const worker = getForensicWorker();
  if (!worker) {
    const res = runInlineScan(projects, crossLedgerContext);
    if (signal?.aborted) {
      throw createAbortError();
    }
    return res;
  }

  const requestId = ++nextRequestId;

  return new Promise<ForensicScanResult>((resolve, reject) => {
    const onAbort = () => {
      const entry = cleanupPending(requestId);
      if (entry) {
        entry.reject(createAbortError());
      }
    };

    pendingScans.set(requestId, {
      resolve,
      reject,
      signal,
      onAbort,
    });

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const payload: ForensicWorkerRequest = {
        requestId,
        financialYear,
        projects,
        crossLedgerContext,
      };
      worker.postMessage(payload);
    } catch {
      cleanupPending(requestId);
      workerDisabled = true;
      workerInstance = null;
      try {
        resolve(runInlineScan(projects, crossLedgerContext));
      } catch (fallbackErr) {
        reject(fallbackErr);
      }
    }
  });
}
