# 🔍 Budget Lens — Comprehensive A-to-Z System Manual & Architecture Documentation

Welcome to the definitive manual for **Budget Lens**, a state-of-the-art public finance transparency platform, forensic audit workstation, and multi-year budget intelligence system.

This document details the platform from **A to Z**, covering its core vision, data ingestion pipelines, forensic analysis engines, user interface workstations, component architecture, and mathematical models.

---

## Table of Contents
1. [Overview & Core Mission](#1-overview--core-mission)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [Data Ingestion & PDF Processing Pipeline](#3-data-ingestion--pdf-processing-pipeline)
4. [Database Engine & Micro-Services (`budgetDatabaseEngine.ts`)](#4-database-engine--micro-services)
5. [Key Platform Features & Workstations (A to Z)](#5-key-platform-features--workstations-a-to-z)
   - [A — Asset Inventory & Antiquity Age Explorer](#a--asset-inventory--antiquity-age-explorer)
   - [B — Benford's Law Audit Engine](#b--benfords-law-audit-engine)
   - [C — Citizen Fiscal Re-allocation Simulator](#c--citizen-fiscal-re-allocation-simulator)
   - [D — Duplicate Ring & Clustering Detector](#d--duplicate-ring--clustering-detector)
   - [E — Executive Audit Report Builder](#e--executive-audit-report-builder)
   - [F — Forensic Rule Engine & Flagging System](#f--forensic-rule-engine--flagging-system)
   - [G — Grounded AI Fiscal Assistant & Citation Modal](#g--grounded-ai-fiscal-assistant--citation-modal)
   - [H — Header Stats & Fiscal Ratios Indicator](#h--header-stats--fiscal-ratios-indicator)
   - [I — Investigator Forensic Heatmap Workstation](#i--investigator-forensic-heatmap-workstation)
   - [M — Multi-Year Project Lineage Explorer](#m--multi-year-project-lineage-explorer)
   - [R — Real-Terms Inflation & Purchasing Power Converter](#r--real-terms-inflation--purchasing-power-converter)
   - [S — Sector & Geo-Political Equity Distribution](#s--sector--geo-political-equity-distribution)
   - [U — Universal Search Workstation](#u--universal-search-workstation)
   - [V — Virement & Off-Budget Analytics](#v--virement--off-budget-analytics)
6. [Component Mapping & Directory Structure](#6-component-mapping--directory-structure)
7. [Getting Started & Operational Guide](#7-getting-started--operational-guide)

---

## 1. Overview & Core Mission

**Budget Lens** transforms official government Appropriation Acts (typically massive, scanned, or complex multi-thousand-page PDFs) into a queryable, interactive, and transparent forensic database.

### Key Objectives:
- **Democratize Public Spending**: Allow citizens, journalists, non-profits, and auditors to query federal budget line items effortlessly.
- **Uncover Anomalies & Waste**: Automatically detect price inflation, duplicate projects, vague line items, and premature asset replacements.
- **Track Multi-Year Lineages**: Trace projects across successive financial years (2023, 2024, 2025, 2026, and beyond) to detect endless re-budgeting.
- **Presumption of Acquisition**: Enforce the rule that enacted line items are 100% funded and physically acquired, establishing usable asset lifespans before replacement funds are approved.

---

## 2. High-Level System Architecture

Budget Lens is built using a modern, performant web technology stack:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE LAYER                            │
│    React 18 + TypeScript + Vite + Lucide Icons + Custom CSS Tokens    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                    REACT CONTEXT & DATA SERVICES                       │
│              BudgetDatabaseContext.tsx (Global State)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                   FORENSIC DATABASE ENGINE LAYER                       │
│    budgetDatabaseEngine.ts (Benford, Asset Ledger, Lineages, Search)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                 PRE-INDEXED JSON DATASETS & PIPELINE                   │
│   public/datasets/{year}/ (statistics.json, projects.min.json, etc.)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Ingestion & PDF Processing Pipeline

The dataset pipeline transforms raw official PDF appropriation documents into lightweight JSON datasets used directly by the frontend.

### Data Flow Steps:
1. **Extraction (`pipeline.py` & `ingest_supplementary.py`)**:
   - Parses official PDF pages using PyMuPDF / pdfplumber.
   - Extracts line item metadata: `MDA Name`, `Project Code / Budget Code`, `Project Description`, `Amount (₦)`, and `PDF Page Number`.
2. **Standardization & Tokenization**:
   - Normalizes text names for fuzzy matching.
   - Extracts asset tokens (e.g. quantity, item category like vehicles, laptops, generators, boreholes).
3. **Multi-Year Lineage Hashing**:
   - Generates lineage IDs (`lineageId`) by matching canonical project titles across consecutive years.
4. **Precomputed JSON Files**:
   - `/public/datasets/{year}/statistics.json`: Macro budget breakdown (Personnel, Overhead, Debt Service, Capital Budget, Statutory Transfers).
   - `/public/datasets/{year}/projects.min.json`: Compact list of capital projects for low network latency.
   - `/public/datasets/recurring_lineages.json`: Cross-year project chains across 16,000+ line items.

---

## 4. Database Engine & Micro-Services (`budgetDatabaseEngine.ts`)

The `BudgetDatabaseEngine` singleton powers all analytical calculations in real time without external backend latency:

- **Indexed Multi-Year Storage**: Maintains a map of `recordsByYear` for fast lookups.
- **Search Scoring Algorithm**: Scores query matches across project names, MDA names, states, and budget codes.
- **Dynamic Quantity Provenance Tagging**: Distinguishes verbatim quantities (extracted directly from text) from benchmark-estimated quantities derived from unit prices.

---

## 5. Key Platform Features & Workstations (A to Z)

### A — Asset Inventory & Antiquity Age Explorer
- **Component**: [AggregatedAssetsExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/AggregatedAssetsExplorer.tsx)
- **Description**: Tracks physical unit quantities (e.g., Hilux trucks, laptops, photocopy machines, generators, boreholes) and their total monetary allocations across all past, present, and future budget datasets.
- **Quantity Estimation**: When a line item omits exact counts, it calculates an honorable estimate:
  $$\text{Estimated Units} = \max\left(1, \operatorname{round}\left(\frac{\text{Amount (₦)}}{\text{Benchmark Unit Price (₦)} \times \text{Inflation Factor}}\right)\right)$$
- **Antiquity Calculation**: Computes asset age relative to the reference year:
  $$\text{Asset Age} = \text{Reference Year} - \text{Budget Year}$$

### B — Benford's Law Audit Engine
- **Engine Method**: `getBenfordAnalysis()`
- **Description**: Applies Benford's Law to inspect the first-digit distribution of budget allocations. Unnatural spikes in leading digits (e.g., disproportionate 9s or 4s) flag potential artificial price splitting or bid rigging.

### C — Citizen Fiscal Re-allocation Simulator
- **Component**: [BudgetAuditCalculatorWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/BudgetAuditCalculatorWidget.tsx)
- **Description**: Allows citizens to simulate cutting administrative overheads by a chosen percentage (e.g. 15%) and reallocating those savings into priority social sectors like Health and Education.

### D — Duplicate Ring & Clustering Detector
- **Component**: [TopDuplicateClustersWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/TopDuplicateClustersWidget.tsx)
- **Description**: Scans budget line items to group verbatim or near-identical project titles across multiple MDAs in the same financial year, highlighting potential double-funding risks.

### E — Executive Audit Report Builder
- **Component**: [ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx)
- **Description**: Enables investigators to assemble custom findings, line-item evidence, and charts into a exportable PDF/Printable Executive Brief for advocacy or oversight committees.

### F — Forensic Rule Engine & Flagging System
- **Components**: [EvidenceEngineSummaryWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/EvidenceEngineSummaryWidget.tsx), `RecentFlaggedProjects.tsx`
- **Description**: Evaluates projects against rules such as:
  - Vague / Non-Specific Descriptions (e.g. *"Empowerment of Youth"* without deliverables)
  - Split Batch Procurement
  - Outlier Cost Allocations

### G — Grounded AI Fiscal Assistant & Citation Modal
- **Components**: [GroundedAiAssistantWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GroundedAiAssistantWidget.tsx), [ProjectEvidenceModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ProjectEvidenceModal.tsx)
- **Description**: AI assistant that answers complex budgetary queries using grounded data citations. Clicking an anomaly pill opens a modal displaying the exact PDF page, budget code, and MDA source verification.

### H — Header Stats & Fiscal Ratios Indicator
- **Components**: [HeaderStats.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HeaderStats.tsx), [BudgetAuditCalculatorWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/BudgetAuditCalculatorWidget.tsx)
- **Description**: Displays macro indicators such as Total Budget, Capital Intensity %, Debt-to-Budget Ratio, Personnel %, and YoY Growth Trajectory.

### I — Investigator Forensic Heatmap Workstation
- **Component**: [InvestigatorHeatmapWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/InvestigatorHeatmapWidget.tsx)
- **Description**: High-density workstation presenting visual heatmaps of budget allocations categorized by risk levels, MDA spending weight, and geographic concentration.

### M — Multi-Year Project Lineage Explorer
- **Component**: [RecurringLineagesExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecurringLineagesExplorer.tsx)
- **Description**: Tracks projects appearing across multiple budget cycles (2023–2026+), uncovering projects that repeatedly consume funding without completion.

### R — Real-Terms Inflation & Purchasing Power Converter
- **Engine Method**: `getRealTermsSpending()`
- **Description**: Adjusts nominal budget amounts for annual inflation, showing whether actual purchasing power grew or shrank in real terms compared to baseline years.

### S — Sector & Geo-Political Equity Distribution
- **Components**: [SectorDistribution.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SectorDistribution.tsx), [GeoMapWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GeoMapWidget.tsx)
- **Description**: Interactive visualizations mapping budget distribution across ministries (Infrastructure, Security, Education, Health) and geopolitical zones (North West, South West, etc.).

### U — Universal Search Workstation
- **Component**: [UniversalSearchModal.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/UniversalSearchModal.tsx)
- **Description**: Full-screen workstation with multi-field filtering (by state, sector, amount range, risk severity) and fuzzy search across all indexed project line items.

### V — Virement & Off-Budget Analytics
- **Engine Method**: `getVirementAnalytics()`
- **Description**: Analyzes off-budget reallocations, virements, and supplementary fund injections to ensure public accountability outside standard appropriation timelines.

---

## 6. Component Mapping & Directory Structure

```
src/
├── App.tsx                        # Main application layout, state routing & active tab views
├── main.tsx                       # React application entry point
├── types.ts                       # Core TypeScript interfaces (BudgetProject, EvidenceItem, Lineage)
├── index.css                      # Global design system tokens, typography, slate themes
├── context/
│   └── BudgetDatabaseContext.tsx  # React Context exposing database engine methods
├── services/
│   └── budgetDatabaseEngine.ts    # Forensic engine (Benford, Asset Ledger, Lineages, Search)
└── components/
    ├── AggregatedAssetsExplorer.tsx        # Physical Asset Inventory & Antiquity Workstation
    ├── BudgetAuditCalculatorWidget.tsx     # Fiscal Indicators & Overhead Re-allocation Simulator
    ├── EvidenceEngineSummaryWidget.tsx     # Forensic Risk Rule Summary
    ├── ExecutiveReportBuilderWidget.tsx    # Executive PDF/Print Report Assembler
    ├── GeoMapWidget.tsx                    # Geopolitical Zone Equity Map
    ├── GroundedAiAssistantWidget.tsx       # AI Fiscal Assistant with Grounded Citations
    ├── HeaderStats.tsx                     # Top KPI Overview Bar
    ├── InvestigatorHeatmapWidget.tsx       # Forensic Risk Heatmap Grid
    ├── ProjectEvidenceModal.tsx            # PDF Document Evidence Verification Modal
    ├── RecurringLineagesExplorer.tsx       # Multi-Year Project Lineage Tracker
    ├── SectorDistribution.tsx              # Ministry & Sector Allocation Breakdown
    ├── Sidebar.tsx                         # Main Navigation Sidebar
    ├── SpendingTrendChart.tsx              # Multi-Year Spending Trajectory Chart
    ├── Topbar.tsx                          # Header Bar with Year Selector
    └── UniversalSearchModal.tsx            # Full-Screen Universal Search Workstation
```

---

## 7. Getting Started & Operational Guide

### Prerequisites
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher

### Local Installation & Development
```bash
# 1. Clone or navigate to the repository directory
cd buget_lens

# 2. Install dependencies
npm install

# 3. Launch the development server
npm run dev

# 4. Open in browser
# http://localhost:5173
```

### Production Build & Type Checking
```bash
# Run TypeScript compilation and build production assets
npm run build
```

---

*Budget Lens is designed for transparency, precision, and civic empowerment. Empowering citizens through data-driven public finance auditing.*
