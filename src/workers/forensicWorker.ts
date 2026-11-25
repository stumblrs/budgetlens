import {
  applyRules,
  buildCompoundFlaggedProjects,
  type CompoundFlaggedProject,
  type EvidenceItem,
} from '../utils/ruleEngine';
import { detectDuplicates, type DuplicateCluster } from '../utils/duplicateDetector';
import type { CrossLedgerContextWire } from '../utils/evidenceEngineV3';

export interface ForensicWorkerRequest {
  requestId: number;
  financialYear: number;
  projects: any[];
  crossLedgerContext?: CrossLedgerContextWire | null;
}

export interface ForensicWorkerResponse {
  requestId: number;
  financialYear: number;
  evidenceItems: EvidenceItem[];
  compoundProjects: CompoundFlaggedProject[];
  duplicateClusters: DuplicateCluster[];
  durationMs: number;
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<ForensicWorkerRequest>) => void) | null;
  postMessage: (msg: ForensicWorkerResponse) => void;
};

workerScope.onmessage = (ev: MessageEvent<ForensicWorkerRequest>) => {
  const { requestId, financialYear, projects, crossLedgerContext } = ev.data;
  const startedAt = performance.now();

  try {
    const safeProjects = Array.isArray(projects) ? projects : [];
    const evidenceItems = applyRules(safeProjects, crossLedgerContext);
    const compoundProjects = buildCompoundFlaggedProjects(evidenceItems);
    const duplicateClusters = detectDuplicates(safeProjects);
    const durationMs = Math.round(performance.now() - startedAt);

    workerScope.postMessage({
      requestId,
      financialYear,
      evidenceItems,
      compoundProjects,
      duplicateClusters,
      durationMs,
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    workerScope.postMessage({
      requestId,
      financialYear,
      evidenceItems: [],
      compoundProjects: [],
      duplicateClusters: [],
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
