import { describe, it, expect } from 'vitest';
import {
  buildCanonicalPinId,
  computeCasebookMetrics,
  type Casebook,
  type CasebookPin,
} from '../../src/context/CasebookContext';
import {
  calculateFoiStatutoryDeadline,
  resolveFoiDeskForMda,
} from '../../src/data/foiDeskDirectory';
import {
  buildCasebookDossierDocxBytes,
  buildCasebookDossierPdfBytes,
  buildCasebookDossierSpec,
  buildFormalFoiPacketDocxBytes,
  buildFormalFoiPacketPdfBytes,
} from '../../src/utils/documentExporter';

describe('Investigator Casebook & Formal FOI Act 2011 Packets', () => {
  it('computes deterministic pin IDs, multi-year metrics, and skips weekends in 7-working-day FOI deadline', () => {
    const id1 = buildCanonicalPinId({
      kind: 'line_item',
      financialYear: 2025,
      projectCode: 'ERGP101',
      title: 'Procurement of SUVs',
    });
    const id2 = buildCanonicalPinId({
      kind: 'line_item',
      financialYear: 2025,
      projectCode: 'ERGP101',
      title: 'Procurement of SUVs',
    });
    expect(id1).toBe(id2);

    const pins: CasebookPin[] = [
      {
        pinId: id1,
        kind: 'line_item',
        financialYear: 2025,
        presidentName: 'Bola Ahmed Tinubu',
        projectCode: 'ERGP101',
        title: 'Procurement of SUVs',
        mdaName: 'Ministry of Works',
        amountNaira: 400_000_000,
        analystNote: 'Verify unit cost',
        tags: ['vehicles'],
        pinnedAtIso: '2026-11-20T00:00:00Z',
        payloadSnapshot: {},
      },
      {
        pinId: 'padding_diff:2022:zip9',
        kind: 'padding_diff',
        financialYear: 2022,
        presidentName: 'Muhammadu Buhari',
        projectCode: 'ZIP9',
        title: 'Zonal Intervention Boreholes',
        mdaName: 'Ministry of Water Resources',
        amountNaira: 600_000_000,
        analystNote: 'Inserted by NASS',
        tags: ['zip'],
        pinnedAtIso: '2026-11-20T00:00:00Z',
        payloadSnapshot: {},
      },
    ];

    const metrics = computeCasebookMetrics(pins);
    expect(metrics.totalPins).toBe(2);
    expect(metrics.totalExposureNaira).toBe(1_000_000_000);
    expect(metrics.uniqueYears).toEqual([2022, 2025]);
    expect(metrics.uniqueMdasCount).toBe(2);

    // Friday Nov 20, 2026 + 7 working days -> skips Sat 21, Sun 22, Sat 28, Sun 29 -> Tue Dec 1, 2026
    const dl = calculateFoiStatutoryDeadline(new Date(Date.UTC(2026, 10, 20)), 7);
    expect(dl.submittedIso).toBe('2026-11-20');
    expect(dl.deadlineIso).toBe('2026-12-01');

    const desk = resolveFoiDeskForMda('Federal Ministry of Works & Housing');
    expect(desk.ministryTitle).toContain('Works');
    expect(desk.oversightCommittees.length).toBeGreaterThan(0);
  });

  it('produces valid %PDF- and OOXML PK binaries for Casebook Dossiers and Formal FOI Packets', async () => {
    const casebook: Casebook = {
      id: 'cb-1',
      name: 'Cross-Year Fleet Investigation',
      description: 'Repeated SUV procurement across 2022 and 2025.',
      createdAtIso: '2026-11-20T00:00:00Z',
      pins: [
        {
          pinId: 'line_item:2025:ergp101',
          kind: 'line_item',
          financialYear: 2025,
          presidentName: 'Bola Ahmed Tinubu',
          projectCode: 'ERGP101',
          title: 'Procurement of Operational SUVs',
          mdaName: 'Federal Ministry of Works',
          amountNaira: 500_000_000,
          page: 18,
          sourceFilename: '2025 Appropriation ACT as Passed.pdf',
          sha256: 'sha256:abc123',
          analystNote: 'Check BPP certificate',
          tags: ['fleet'],
          pinnedAtIso: '2026-11-20T00:00:00Z',
          payloadSnapshot: {},
        },
      ],
    };

    const cbPdf = await buildCasebookDossierPdfBytes({
      casebook,
      permalink: 'https://budgetlens.ng/?tab=casebook',
    });
    expect(new TextDecoder('ascii').decode(cbPdf.slice(0, 5))).toBe('%PDF-');

    const cbDocx = await buildCasebookDossierDocxBytes({
      casebook,
      permalink: 'https://budgetlens.ng/?tab=casebook',
    });
    expect(cbDocx[0]).toBe(0x50);
    expect(cbDocx[1]).toBe(0x4b);

    const foiInput = {
      financialYear: 2025,
      projectCode: 'ERGP101',
      projectName: 'Procurement of Operational SUVs',
      amountNaira: 500_000_000,
      agencyName: 'Federal Ministry of Works',
      page: 18,
      state: 'FCT',
      sourceFilename: '2025 Appropriation ACT as Passed.pdf',
      sha256: 'sha256:abc123',
      permalink: 'https://budgetlens.ng/?tab=record&year=2025&item=ERGP101&page=18',
    };

    const foiPdf = await buildFormalFoiPacketPdfBytes(foiInput);
    expect(new TextDecoder('ascii').decode(foiPdf.slice(0, 5))).toBe('%PDF-');

    const foiDocx = await buildFormalFoiPacketDocxBytes(foiInput);
    expect(foiDocx[0]).toBe(0x50);
    expect(foiDocx[1]).toBe(0x4b);
  });

  it('tracks 6-ledger provenance tags across computeCasebookMetrics and builds 2-table Casebook dossiers', async () => {
    const crossLedgerCasebook: Casebook = {
      id: 'cb-6l',
      name: '6-Ledger Multi-Agency Inquiry',
      description: 'Pins combining OAuGF queries, Bill insertions, Paid-on-Paper, and Treasury cash risk.',
      createdAtIso: '2026-11-23T00:00:00Z',
      pins: [
        {
          pinId: 'line_item:2025:ergp999',
          kind: 'line_item',
          financialYear: 2025,
          presidentName: 'Bola Ahmed Tinubu',
          projectCode: 'ERGP999',
          title: 'Procurement of Utility SUVs and Honorarium Allowances',
          mdaName: 'STATE HOUSE',
          amountNaira: 1_250_000_000,
          page: 44,
          sourceFilename: '2025 Appropriation ACT as Passed.pdf',
          sha256: 'sha256:123456',
          analystNote: 'High compound convergence across 5 ledgers',
          tags: ['suv', 'oaugf'],
          pinnedAtIso: '2026-11-23T00:00:00Z',
          payloadSnapshot: {},
          ledgerProvenance: {
            ledgerTags: ['OAuGF Query', 'Treasury Cash', 'Bill Insertion', 'Paid on Paper', 'Compound Risk'],
            compoundRiskScore: 92,
            triggeredRulesCount: 4,
            oaugfQueryCount: 21,
            oaugfRepeatCount: 0,
            mdaIntegrityGrade: 'D',
            paidOnPaper: true,
            billInsertionStatus: 'NEW_INSERTION',
            personalOrOpaqueCashFlag: true,
          },
        },
      ],
    };

    const m = computeCasebookMetrics(crossLedgerCasebook.pins);
    expect(m.crossLedgerTaggedCount).toBe(1);
    expect(m.ledgerTagCounts['OAuGF Query']).toBe(1);
    expect(m.ledgerTagCounts['Paid on Paper']).toBe(1);

    const spec = buildCasebookDossierSpec({
      casebook: crossLedgerCasebook,
      permalink: 'https://budgetlens.ng/?tab=casebook',
    });
    expect(spec.tables.length).toBe(2);
    expect(spec.tables[0].columns).toContain('6-Ledger Provenance');
    expect(spec.tables[1].heading).toContain('6-Ledger Cross-Reference Provenance Matrix');
    expect(spec.kpis?.length).toBe(4);

    const pdfBytes = await buildCasebookDossierPdfBytes({ casebook: crossLedgerCasebook });
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(2000);

    const docxBytes = await buildCasebookDossierDocxBytes({ casebook: crossLedgerCasebook });
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
  });
});
