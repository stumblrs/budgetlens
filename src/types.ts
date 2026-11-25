export interface BudgetProject {
  id: string;
  budgetCode: string;
  projectCode?: string;
  projectName: string;
  agency: string;
  ministry: string;
  sector: string;
  state: string;
  lga: string;
  amount: number;
  financialYear: number;
  page: number;
  lineageId?: string;
  hasEvidence: boolean;
  severity?: 'low' | 'medium' | 'high';
  matchedRules?: string[];
}

export interface EvidenceItem {
  id: string;
  ruleId: string;
  ruleName: string;
  projectId: string;
  projectName: string;
  agency: string;
  amount: number;
  financialYear: number;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  reason: string;
  page: number;
  budgetCode: string;
  createdAt: string;
  ruleVersion: string;
}

export interface ProjectLineage {
  lineageId: string;
  canonicalTitle: string;
  agency: string;
  state: string;
  lga: string;
  instances: {
    year: number;
    projectId: string;
    budgetCode: string;
    amount: number;
    page: number;
  }[];
  yearsAppeared: number[];
  cumulativeAllocation: number;
  matchConfidence: number;
  severity: 'low' | 'medium' | 'high';
}

export interface DatasetRegistry {
  activeYear: number;
  availableYears: number[];
  totalAllocations: number;
  totalProjects: number;
  totalEvidenceItems: number;
}
