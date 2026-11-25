We have already upgraded **Overview**, **Presidential Scrutiny**, **Evidence Engine** (+ **Duplicate Detector** & Project Evidence Modal), **Sources & Methodology**, and **OAuGF Negligences**.

Across the rest of the observatory, here are the remaining tabs that would gain the most from wiring in our new 6-ledger data (**OAuGF Constitutional Audits**, **Open Treasury `₦1.49T` personal accounts & `₦2.44T` opaque vouchers**, **Red-Flag Convergence**, **Evidence Engine v3.0 `22` rules / `49,679` hits**, and the refreshed **`₦24.57T` Fourth Republic baseline**), ranked by impact:

---

### Tier 1 — Highest Investigative & Civic Impact

1. **Statistical Forensics (`?tab=forensics` — [StatisticalForensicsLab.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/StatisticalForensicsLab.tsx))**
   - **Current gap:** The Cash Forensics (`?fsub=govspend`) view currently surfaces December Rush, Threshold Splitting, and Benford's Law, but does **not yet expose** the newly indexed **`33,366` Opaque / Blank-Description & Discretionary Vouchers (`₦2.44T`, including `₦1.41T` blank descriptions)** or the **`10,851` Personal / Staff Bank Account beneficiaries (`₦1.49T`)**, nor cross-link flagged MDAs to their OAuGF audit counts.
   - **Upgrade:** Add dedicated interactive sub-panels and PDF/DOCX export sections for **Personal/Staff Account Payouts**, **Blank & Discretionary Cash Vouchers**, and **OAuGF Cross-Linked MDA Risk**.

2. **Reports & Export (`?tab=reports` — [ExecutiveReportBuilderWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutiveReportBuilderWidget.tsx))**
   - **Current gap:** Still runs legacy `applyRules()` without the 6-ledger cross-join context (missing all 6 cross-ledger rules) and omits OAuGF Constitutional Audit negligence, Bill-vs-Act legislative insertions, Open Treasury personal/opaque cash flags, and Red-Flag Convergence from generated briefings.
   - **Upgrade:** Wire it into **Evidence Engine v3.0 (`22` rules)** and our **6-Ledger Presidential & MDA indices**, adding a new **"6-Ledger Accountability & Audit Brief"** template for publication-ready PDF/DOCX exports.

3. **1999–2026 Compare (`?tab=compare` — [HistoricalPresidentialCompare.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/HistoricalPresidentialCompare.tsx))**
   - **Current gap:** Compares Administrations and Terms across Enacted Budgets, DMO Debt, and BIR Macro Credibility, but has **no OAuGF Constitutional Audit findings**, **no Legislative Bill-vs-Act Padding**, **no Open Treasury December Rush**, and **no Evidence Engine v3.0 metrics** in its Head-to-Head and Term Scorecards.
   - **Upgrade:** Connect directly to the newly enriched `crossLedgerProfile` data so citizens can run full side-by-side Head-to-Head Presidential comparisons across all 6 ledgers.

4. **Ministries & MDAs (`?tab=agencies` — [MdaIntegrityScorecardPanel.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/MdaIntegrityScorecardPanel.tsx))**
   - **Current gap:** Already shows the 5-pillar integrity grade and OAuGF summary, but lacks **Red-Flag Convergence scores** (MDAs triggering 3+ independent red flags simultaneously), **Open Treasury Personal/Opaque Cash exposure per MDA**, **Evidence Engine v3.0 28-year rule hit counts**, and **Asset Lifespan repeat-buy violations**.
   - **Upgrade:** Add Convergence Risk badges, Personal/Opaque Cash indicators, 28-year Evidence Engine rule telemetry, and a "High-Risk Convergent MDAs Only" filter.

5. **Capital Projects (`?tab=projects` — [App.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/App.tsx#L588-L771))**
   - **Current gap:** Currently renders a basic searchable table with `AI Enriched` badges only — no Evidence Engine v3.0 compound risk scores, no cross-ledger filter chips, and no filtered table export.
   - **Upgrade:** Add inline **Compound Risk Score & Cross-Ledger Badges** (`Paid on Paper`, `NASS Insertion`, `OAuGF-Indicted MDA`, `Zombie Lineage`), quick investigative filter pills, and 1-click PDF/DOCX export of filtered rows.

---

### Tier 2 — High-Value Cross-Ledger Polish

6. **Spending Trends (`?tab=trends` — [SpendingTrendChart.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/SpendingTrendChart.tsx))**
   - Currently renders only a single chart card. Can be expanded into a **28-Year Multi-Ledger Trajectory Explorer (`1999–2026`)** overlaying Enacted Budgets, DMO Sovereign Debt, BIR Capital Execution %, Evidence Engine v3.0 Flagged Spend, and OAuGF Audit Queries over time.

7. **Citizen Tax & Area (`?tab=citizen` — [CitizenAccountabilityHub.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CitizenAccountabilityHub.tsx))**
   - Enhance neighborhood project results with **Evidence Engine v3.0 compound risk badges**, **Bill-to-Act insertion indicators**, and a **"Local Accountability Summary"** showing OAuGF & Paid-on-Paper flags for projects in the user's selected State/LGA.

8. **Geo & Anomaly Map (`?tab=map` — [GeoIntelligenceWorkspace.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GeoIntelligenceWorkspace.tsx))**
   - Add **Evidence Engine v3.0 cross-ledger risk counts**, **Zonal Intervention (Bill-vs-Act) insertion intensity**, and **OAuGF-queried MDA exposure** to the 37-State League Table and exported State Briefs.

9. **Execution & Contracts (`?tab=execution` — [ExecutionProcurementExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/ExecutionProcurementExplorer.tsx))**
   - Integrate **Red-Flag Convergence scores** onto contractors and MDAs (linking non-competitive awards & variation overruns directly with OAuGF procurement violations and personal-account payouts).

10. **Asset Inventory (`?tab=assets` — [AggregatedAssetsExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/AggregatedAssetsExplorer.tsx)), Recurring Lineages (`?tab=recurring` — [RecurringLineagesExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/RecurringLineagesExplorer.tsx)) & Bill vs. Act Diff (`?tab=padding` — [BudgetPaddingDiffExplorer.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/BudgetPaddingDiffExplorer.tsx))**
    - Add **OAuGF MDA negligence badges**, **Evidence Engine v3.0 risk scores**, and **PDF/DOCX export** (currently missing on Asset Inventory and Recurring Lineages).

11. **AI Assistant (`?tab=ai` — [GroundedAiAssistantWidget.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/GroundedAiAssistantWidget.tsx) / [aiForensicEngine.ts](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/utils/aiForensicEngine.ts)) & Investigator Casebook (`?tab=casebook` — [CasebookStudioPage.tsx](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/src/components/CasebookStudioPage.tsx))**
    - Feed the AI Assistant the new `evidence_engine_all_years.json` (`22` rules / `49,679` findings), `red_flag_convergence_index.json`, and updated `₦24.57T` Presidential cross-ledger totals so natural-language Q&A reflects the exact numbers on screen, and let Casebook dossiers bundle pinned OAuGF & Treasury Cash records alongside budget items.
