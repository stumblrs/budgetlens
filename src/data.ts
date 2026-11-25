import { BudgetProject, EvidenceItem, ProjectLineage } from './types';

export const MOCK_PROJECTS: BudgetProject[] = [
  {
    id: 'P-2026-001',
    budgetCode: 'FMOH-2026-0441',
    projectName: 'Construction and Rehabilitation of Primary Health Centre, Bida',
    agency: 'Federal Ministry of Health',
    ministry: 'Health',
    sector: 'Social Services',
    state: 'Niger',
    lga: 'Bida',
    amount: 1900000000,
    financialYear: 2026,
    page: 441,
    lineageId: 'LIN-000481',
    hasEvidence: true,
    severity: 'medium',
    matchedRules: ['RECURRING_ALLOCATION', 'ABOVE_HISTORICAL_AVERAGE']
  },
  {
    id: 'P-2026-002',
    budgetCode: 'REA-2026-1182',
    projectName: 'Provision and Installation of All-in-One Solar Street Lighting in Kaduna North',
    agency: 'Rural Electrification Agency',
    ministry: 'Power',
    sector: 'Infrastructure',
    state: 'Kaduna',
    lga: 'Kaduna North',
    amount: 2450000000,
    financialYear: 2026,
    page: 218,
    lineageId: 'LIN-000109',
    hasEvidence: true,
    severity: 'high',
    matchedRules: ['POSSIBLE_DUPLICATE_CLUSTER', 'RECURRING_ALLOCATION']
  },
  {
    id: 'P-2026-003',
    budgetCode: 'FMW-2026-0891',
    projectName: 'Dualization of Abuja - Lokoja Highway Section III',
    agency: 'Federal Ministry of Works',
    ministry: 'Works',
    sector: 'Infrastructure',
    state: 'Kogi',
    lga: 'Lokoja',
    amount: 18500000000,
    financialYear: 2026,
    page: 112,
    hasEvidence: false
  },
  {
    id: 'P-2026-004',
    budgetCode: 'FMOE-2026-3012',
    projectName: 'Procurement of High-End SUV Operational Vehicles for Ministry Headquarters',
    agency: 'Federal Ministry of Education',
    ministry: 'Education',
    sector: 'Social Services',
    state: 'FCT',
    lga: 'Abuja Municipal',
    amount: 1250000000,
    financialYear: 2026,
    page: 589,
    hasEvidence: true,
    severity: 'high',
    matchedRules: ['HIGH_VEHICLE_PROCUREMENT']
  },
  {
    id: 'P-2026-005',
    budgetCode: 'FMAG-2026-0199',
    projectName: 'Comprehensive Renovation of Headquarters Complex Annex B',
    agency: 'Federal Ministry of Agriculture & Food Security',
    ministry: 'Agriculture',
    sector: 'Economic Services',
    state: 'FCT',
    lga: 'Abuja Municipal',
    amount: 2800000000,
    financialYear: 2026,
    page: 344,
    hasEvidence: true,
    severity: 'medium',
    matchedRules: ['HIGH_RENOVATION_COST']
  }
];

export const MOCK_EVIDENCE: EvidenceItem[] = [
  {
    id: 'EV-2026-004812',
    ruleId: 'HIGH_RENOVATION_COST',
    ruleName: 'High Renovation Expenditure',
    projectId: 'P-2026-005',
    projectName: 'Comprehensive Renovation of Headquarters Complex Annex B',
    agency: 'Federal Ministry of Agriculture & Food Security',
    amount: 2800000000,
    financialYear: 2026,
    severity: 'medium',
    confidence: 0.94,
    reason: 'Renovation allocation (₦2.8B) exceeds standard threshold (₦1B) for administrative building maintenance.',
    page: 344,
    budgetCode: 'FMAG-2026-0199',
    createdAt: '2026-01-12T10:15:00Z',
    ruleVersion: '1.3.0'
  },
  {
    id: 'EV-2026-009213',
    ruleId: 'RECURRING_ALLOCATION',
    ruleName: 'Repeated Funding Across Budget Years',
    projectId: 'P-2026-001',
    projectName: 'Construction and Rehabilitation of Primary Health Centre, Bida',
    agency: 'Federal Ministry of Health',
    amount: 1900000000,
    financialYear: 2026,
    severity: 'medium',
    confidence: 0.96,
    reason: 'This project has appeared in 3 consecutive budgets (2024–2026) with cumulative allocations of ₦4.55B.',
    page: 441,
    budgetCode: 'FMOH-2026-0441',
    createdAt: '2026-01-12T10:15:00Z',
    ruleVersion: '1.0.0'
  },
  {
    id: 'EV-2026-001102',
    ruleId: 'HIGH_VEHICLE_PROCUREMENT',
    ruleName: 'High Vehicle Procurement Allocation',
    projectId: 'P-2026-004',
    projectName: 'Procurement of High-End SUV Operational Vehicles for Ministry Headquarters',
    agency: 'Federal Ministry of Education',
    amount: 1250000000,
    financialYear: 2026,
    severity: 'high',
    confidence: 0.98,
    reason: 'Vehicle procurement exceeds ₦500M threshold for non-transport agency headquarters.',
    page: 589,
    budgetCode: 'FMOE-2026-3012',
    createdAt: '2026-01-12T10:15:00Z',
    ruleVersion: '1.2.1'
  }
];

export const MOCK_LINEAGES: ProjectLineage[] = [
  {
    lineageId: 'LIN-000481',
    canonicalTitle: 'Construction and Rehabilitation of Primary Health Centre, Bida',
    agency: 'Federal Ministry of Health',
    state: 'Niger',
    lga: 'Bida',
    instances: [
      { year: 2024, projectId: 'P-2024-082', budgetCode: 'H2024-3391', amount: 1200000000, page: 210 },
      { year: 2025, projectId: 'P-2025-110', budgetCode: 'H2025-2287', amount: 1450000000, page: 305 },
      { year: 2026, projectId: 'P-2026-001', budgetCode: 'FMOH-2026-0441', amount: 1900000000, page: 441 }
    ],
    yearsAppeared: [2024, 2025, 2026],
    cumulativeAllocation: 4550000000,
    matchConfidence: 0.96,
    severity: 'medium'
  },
  {
    lineageId: 'LIN-000109',
    canonicalTitle: 'Provision and Installation of All-in-One Solar Street Lighting in Kaduna North',
    agency: 'Rural Electrification Agency',
    state: 'Kaduna',
    lga: 'Kaduna North',
    instances: [
      { year: 2023, projectId: 'P-2023-011', budgetCode: 'REA2023-01', amount: 2800000000, page: 94 },
      { year: 2024, projectId: 'P-2024-099', budgetCode: 'REA2024-44', amount: 3200000000, page: 142 },
      { year: 2025, projectId: 'P-2025-301', budgetCode: 'REA2025-90', amount: 3950000000, page: 188 },
      { year: 2026, projectId: 'P-2026-002', budgetCode: 'REA-2026-1182', amount: 2450000000, page: 218 }
    ],
    yearsAppeared: [2023, 2024, 2025, 2026],
    cumulativeAllocation: 12400000000,
    matchConfidence: 0.98,
    severity: 'high'
  }
];
