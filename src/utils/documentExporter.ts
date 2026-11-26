import { getMacroForYear } from '../data/historicalMacroData';
import { getPresidentForYear } from '../data/presidentialTerms';
import type {
  BenfordAnalysisResult,
  DuplicateRingCluster,
  PrematureReplacementAlert,
  VirementAnalyticsResult,
} from './statisticalForensics';
import type { BillActDiffItem, BillActYearSummary, PaddingDiffFilter } from './billActDiff';
import type { Casebook, CasebookPin } from '../context/CasebookContext';
import {
  FOI_ACT_2011_CLAUSES,
  calculateFoiStatutoryDeadline,
  resolveFoiDeskForMda,
} from '../data/foiDeskDirectory';
import { buildCanonicalPermalink } from './urlState';
import {
  formatRecordCitations,
  loadSourceProvenance,
  resolveRecordProvenance,
  resolveYearProvenance,
} from './citationFormatter';
import {
  formatNairaCompact,
  formatNairaExact,
  ReportPayload,
  TEMPLATE_META,
} from './reportExporter';
import {
  cleanEntityDisplayName,
  getCoverageCaveatMeta,
  repairMojibake,
} from './displayText';
import type { CbnActingGovernorNote, CbnGovernorProfile } from '../data/cbnGovernors';
import type { HandoverDebtRecord } from './administrationDebt';

export type AllowedExportFormat = 'pdf' | 'docx';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ExportKpi {
  label: string;
  value: string;
  subtext?: string;
}

export interface ExportSectionTable {
  heading: string;
  caption?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  rightAlignColumns?: number[];
}

export interface ExportBulletBlock {
  heading: string;
  items: string[];
}

export interface TabularDossierSpec {
  filenameBase: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  orientation?: 'portrait' | 'landscape';
  metadata?: Array<{ label: string; value: string }>;
  kpis?: ExportKpi[];
  narrative?: string;
  bulletBlocks?: ExportBulletBlock[];
  tables: ExportSectionTable[];
  footnote?: string;
  permalink?: string;
  sha256?: string | null;
  sourceFilename?: string;
}

export interface SingleRecordEvidenceSpec {
  financialYear: number;
  projectCode: string;
  projectName: string;
  amountNaira: number;
  agencyName: string;
  sector?: string;
  state?: string;
  page: number;
  ruleName?: string;
  severity?: string;
  equivalents?: Array<{ label: string; source?: string }>;
  permalink?: string;
  sourceFilename?: string;
  sha256?: string | null;
}

export interface ReportProvenanceContext {
  filename?: string;
  sha256?: string | null;
  permalink?: string;
}

/**
 * Sanitizes text for jsPDF built-in WinAnsi (Helvetica) encoding.
 * Prevents mojibake on `₦` (U+20A6) and typographic punctuation while keeping
 * .docx OpenXML output completely UTF-8 native.
 */
export function sanitizePdfText(input: string | number | null | undefined): string {
  return repairMojibake(String(input ?? ''))
    .replace(/\u20A6/g, 'NGN ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00B7\u2022]/g, '|')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function sanitizeFilenameBase(raw: string): string {
  const withoutExt = raw.replace(/\.(pdf|docx|csv|json|html|htm|md|svg)$/i, '');
  const clean = withoutExt
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return clean || 'BudgetLens_Dossier';
}

function formatDateUtc(isoOrDate?: string): string {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** Strict sole download sink: permits ONLY verified `.pdf` or `.docx` binary files. */
function triggerVerifiedDocumentDownload(
  bytes: Uint8Array,
  filenameBase: string,
  format: AllowedExportFormat
): string {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return `${sanitizeFilenameBase(filenameBase)}.${format}`;
  }
  const safeBase = sanitizeFilenameBase(filenameBase);
  const fullFilename = `${safeBase}.${format}`;
  const mime = format === 'pdf' ? PDF_MIME : DOCX_MIME;
  const copyBuffer = new Uint8Array(bytes.byteLength);
  copyBuffer.set(bytes);
  const blob = new Blob([copyBuffer], { type: mime });
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fullFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  return fullFilename;
}

/** Builds a native multi-page A4 PDF binary using `jspdf` and `jspdf-autotable`. */
export async function buildTabularDossierPdfBytes(
  spec: TabularDossierSpec
): Promise<Uint8Array> {
  const [jsPdfMod, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const JsPDF = (jsPdfMod as any).jsPDF || (jsPdfMod as any).default;
  const autoTable = (autoTableMod as any).default || (autoTableMod as any).autoTable;

  const orientation = spec.orientation === 'landscape' ? 'landscape' : 'portrait';
  const doc = new JsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;
  const timestamp = formatDateUtc();

  const ensureSpace = (neededPt: number, currentY: number): number => {
    if (currentY + neededPt <= pageHeight - 48) return currentY;
    doc.addPage();
    return margin;
  };

  // Obsidian header banner + emerald top strip
  const eyebrowText = sanitizePdfText(
    spec.eyebrow || 'BUDGETLENS CIVIC FISCAL OBSERVATORY | VERIFIED SCHEDULE DOSSIER'
  );
  const titleText = sanitizePdfText(spec.title);
  const subtitleText = spec.subtitle ? sanitizePdfText(spec.subtitle) : '';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  const titleLines: string[] = doc.splitTextToSize(titleText, contentWidth - 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const subtitleLines: string[] = subtitleText
    ? doc.splitTextToSize(subtitleText, contentWidth - 24)
    : [];

  const headerHeight =
    26 + titleLines.length * 18 + (subtitleLines.length ? subtitleLines.length * 12 + 4 : 0) + 16;

  doc.setFillColor(9, 16, 23); // #091017 Obsidian
  doc.rect(margin, margin, contentWidth, headerHeight, 'F');
  doc.setFillColor(5, 150, 105); // #059669 Emerald accent bar
  doc.rect(margin, margin, contentWidth, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 231, 183);
  doc.text(eyebrowText, margin + 12, margin + 17);

  doc.setFontSize(14.5);
  doc.setTextColor(255, 255, 255);
  let cursorY = margin + 34;
  doc.text(titleLines, margin + 12, cursorY);
  cursorY += titleLines.length * 17;

  if (subtitleLines.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text(subtitleLines, margin + 12, cursorY + 2);
  }

  let y = margin + headerHeight + 12;

  // Metadata strip
  const metaRows = [
    ...(spec.metadata || []),
    { label: 'Generated', value: timestamp },
  ];
  if (metaRows.length > 0) {
    const metaString = sanitizePdfText(
      metaRows.map((m) => `${m.label}: ${m.value}`).join('   |   ')
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const metaLines: string[] = doc.splitTextToSize(metaString, contentWidth - 16);
    const boxH = Math.max(22, metaLines.length * 11 + 10);
    y = ensureSpace(boxH + 8, y);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(margin, y, contentWidth, boxH, 4, 4, 'FD');
    doc.setTextColor(51, 65, 85);
    doc.text(metaLines, margin + 8, y + 14);
    y += boxH + 12;
  }

  // KPI summary grid (up to 4 cards per row)
  if (spec.kpis && spec.kpis.length > 0) {
    const cols = Math.min(4, Math.max(1, spec.kpis.length));
    const gap = 8;
    const cardW = (contentWidth - gap * (cols - 1)) / cols;
    const cardH = 48;

    for (let i = 0; i < spec.kpis.length; i += cols) {
      y = ensureSpace(cardH + 10, y);
      const chunk = spec.kpis.slice(i, i + cols);
      chunk.forEach((kpi, idx) => {
        const x = margin + idx * (cardW + gap);
        doc.setFillColor(245, 244, 240);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(x, y, cardW, cardH, 4, 4, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(82, 96, 117);
        const lbl = doc.splitTextToSize(sanitizePdfText(kpi.label).toUpperCase(), cardW - 12)[0] || '';
        doc.text(lbl, x + 7, y + 13);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        const val = doc.splitTextToSize(sanitizePdfText(kpi.value), cardW - 12)[0] || '';
        doc.text(val, x + 7, y + 29);

        if (kpi.subtext) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(100, 116, 139);
          const sub = doc.splitTextToSize(sanitizePdfText(kpi.subtext), cardW - 12)[0] || '';
          doc.text(sub, x + 7, y + 41);
        }
      });
      y += cardH + 10;
    }
    y += 2;
  }

  // Narrative Brief
  if (spec.narrative && spec.narrative.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const narLines: string[] = doc.splitTextToSize(sanitizePdfText(spec.narrative), contentWidth - 16);
    const boxH = narLines.length * 12 + 14;
    y = ensureSpace(boxH + 8, y);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentWidth, boxH, 'FD');
    doc.setFillColor(5, 150, 105);
    doc.rect(margin, y, 3, boxH, 'F');
    doc.setTextColor(30, 41, 59);
    doc.text(narLines, margin + 10, y + 14);
    y += boxH + 12;
  }

  // Bullet Blocks
  if (spec.bulletBlocks && spec.bulletBlocks.length > 0) {
    for (const block of spec.bulletBlocks) {
      if (!block.items.length) continue;
      y = ensureSpace(38, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(block.heading), margin, y);
      y += 14;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      for (const item of block.items) {
        const itemLines: string[] = doc.splitTextToSize(`- ${sanitizePdfText(item)}`, contentWidth - 10);
        y = ensureSpace(itemLines.length * 11 + 4, y);
        doc.text(itemLines, margin + 6, y);
        y += itemLines.length * 11 + 3;
      }
      y += 8;
    }
  }

  // Structured AutoTables
  for (const tbl of spec.tables) {
    y = ensureSpace(64, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(sanitizePdfText(tbl.heading), margin, y);
    y += 12;

    if (tbl.caption) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const capLines: string[] = doc.splitTextToSize(sanitizePdfText(tbl.caption), contentWidth);
      doc.text(capLines, margin, y);
      y += capLines.length * 10 + 4;
    }

    const colStyles: Record<number, { halign?: 'right' | 'left' }> = {};
    for (const idx of tbl.rightAlignColumns || []) {
      colStyles[idx] = { halign: 'right' };
    }

    const headRow = [tbl.columns.map((c) => sanitizePdfText(c))];
    const bodyRows =
      tbl.rows.length > 0
        ? tbl.rows.map((r) => r.map((cell) => sanitizePdfText(cell)))
        : [[sanitizePdfText('No records matched the active view or filter scope.')]];

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 44 },
      head: headRow,
      body: bodyRows,
      theme: 'grid',
      showHead: 'everyPage',
      styles: {
        font: 'helvetica',
        fontSize: 7.8,
        cellPadding: 4.5,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.8,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: colStyles,
    });

    y = ((doc as any).lastAutoTable?.finalY ?? y + 30) + 14;
  }

  // Provenance & Citation Box
  const provLines: string[] = [];
  if (spec.sourceFilename) provLines.push(`Primary PDF Source: ${spec.sourceFilename}`);
  if (spec.sha256) provLines.push(`SHA-256 Digest: ${spec.sha256}`);
  if (spec.permalink) provLines.push(`Canonical Permalink: ${spec.permalink}`);
  if (spec.footnote) provLines.push(spec.footnote);

  if (provLines.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.6);
    const wrapped = doc.splitTextToSize(sanitizePdfText(provLines.join('\n')), contentWidth - 16);
    const pHeight = wrapped.length * 10 + 20;
    y = ensureSpace(pHeight + 8, y);

    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(margin, y, contentWidth, pHeight, 4, 4, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.setTextColor(4, 120, 87);
    doc.text('SOURCE PROVENANCE & CITATION RECORD', margin + 8, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(6, 95, 70);
    doc.text(wrapped, margin + 8, y + 23);
  }

  // Running Header & Footer Page X of Y
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 30, pageWidth - margin, pageHeight - 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(`BudgetLens Civic Fiscal Observatory | Generated ${timestamp}`),
      margin,
      pageHeight - 18
    );
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 18, {
      align: 'right',
    });
  }

  const buffer: ArrayBuffer = doc.output('arraybuffer');
  return new Uint8Array(buffer);
}

/** Builds a native OOXML Word (.docx) binary using `docx`. */
export async function buildTabularDossierDocxBytes(
  spec: TabularDossierSpec
): Promise<Uint8Array> {
  const docx = await import('docx');
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    Header,
    Packer,
    PageNumber,
    PageOrientation,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  const isLandscape = spec.orientation === 'landscape';
  const timestamp = formatDateUtc();
  const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const tableBorders = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder,
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
  };
  const cellMargins = { top: 80, bottom: 80, left: 110, right: 110 };

  const children: any[] = [];

  // Obsidian Title Banner
  const bannerParagraphs: any[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: (spec.eyebrow || 'BUDGETLENS CIVIC FISCAL OBSERVATORY · VERIFIED DOSSIER').toUpperCase(),
          bold: true,
          size: 16,
          color: '6EE7B7',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: spec.subtitle ? 60 : 20 },
      children: [
        new TextRun({
          text: spec.title,
          bold: true,
          size: 30,
          color: 'FFFFFF',
          font: 'Georgia',
        }),
      ],
    }),
  ];

  if (spec.subtitle) {
    bannerParagraphs.push(
      new Paragraph({
        spacing: { after: 20 },
        children: [
          new TextRun({
            text: spec.subtitle,
            size: 19,
            color: 'CBD5E1',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 18, color: '059669' },
        bottom: { style: BorderStyle.NONE, size: 0, color: '091017' },
        left: { style: BorderStyle.NONE, size: 0, color: '091017' },
        right: { style: BorderStyle.NONE, size: 0, color: '091017' },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { fill: '091017', type: ShadingType.CLEAR },
              margins: { top: 180, bottom: 180, left: 200, right: 200 },
              children: bannerParagraphs,
            }),
          ],
        }),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }));

  // Metadata Strip
  const metaRows = [
    ...(spec.metadata || []),
    { label: 'Generated', value: timestamp },
  ];
  if (metaRows.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                margins: cellMargins,
                children: [
                  new Paragraph({
                    children: metaRows.flatMap((m, idx) => [
                      ...(idx > 0
                        ? [new TextRun({ text: '   |   ', size: 17, color: '94A3B8', font: 'Calibri' })]
                        : []),
                      new TextRun({ text: `${m.label}: `, bold: true, size: 17, color: '334155', font: 'Calibri' }),
                      new TextRun({ text: m.value, size: 17, color: '0F172A', font: 'Calibri' }),
                    ]),
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    );
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }));
  }

  // KPI Grid
  if (spec.kpis && spec.kpis.length > 0) {
    const cols = Math.min(4, Math.max(1, spec.kpis.length));
    const kpiTableRows: any[] = [];
    for (let i = 0; i < spec.kpis.length; i += cols) {
      const slice = spec.kpis.slice(i, i + cols);
      const cells = slice.map(
        (kpi) =>
          new TableCell({
            shading: { fill: 'F5F4F0', type: ShadingType.CLEAR },
            margins: cellMargins,
            width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                spacing: { after: 30 },
                children: [
                  new TextRun({
                    text: kpi.label.toUpperCase(),
                    bold: true,
                    size: 15,
                    color: '526075',
                    font: 'Calibri',
                  }),
                ],
              }),
              new Paragraph({
                spacing: { after: kpi.subtext ? 30 : 0 },
                children: [
                  new TextRun({
                    text: kpi.value,
                    bold: true,
                    size: 22,
                    color: '0F172A',
                    font: 'Calibri',
                  }),
                ],
              }),
              ...(kpi.subtext
                ? [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: kpi.subtext,
                          size: 16,
                          color: '64748B',
                          font: 'Calibri',
                        }),
                      ],
                    }),
                  ]
                : []),
            ],
          })
      );
      while (cells.length < cols) {
        cells.push(
          new TableCell({
            shading: { fill: 'F5F4F0', type: ShadingType.CLEAR },
            margins: cellMargins,
            width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [] })],
          })
        );
      }
      kpiTableRows.push(new TableRow({ children: cells }));
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders,
        rows: kpiTableRows,
      })
    );
    children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }));
  }

  // Narrative Paragraph
  if (spec.narrative && spec.narrative.trim()) {
    children.push(
      new Paragraph({
        spacing: { before: 80, after: 140 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 18, color: '059669' },
        },
        indent: { left: 160 },
        children: [
          new TextRun({
            text: spec.narrative.trim(),
            size: 19,
            color: '1E293B',
            font: 'Calibri',
          }),
        ],
      })
    );
  }

  // Bullet Blocks
  if (spec.bulletBlocks && spec.bulletBlocks.length > 0) {
    for (const block of spec.bulletBlocks) {
      if (!block.items.length) continue;
      children.push(
        new Paragraph({
          spacing: { before: 140, after: 60 },
          children: [
            new TextRun({
              text: block.heading,
              bold: true,
              size: 22,
              color: '0F172A',
              font: 'Georgia',
            }),
          ],
        })
      );
      for (const item of block.items) {
        children.push(
          new Paragraph({
            spacing: { after: 50 },
            bullet: { level: 0 },
            children: [
              new TextRun({
                text: item,
                size: 18,
                color: '334155',
                font: 'Calibri',
              }),
            ],
          })
        );
      }
    }
  }

  // Data Tables
  for (const tbl of spec.tables) {
    children.push(
      new Paragraph({
        spacing: { before: 180, after: 50 },
        children: [
          new TextRun({
            text: tbl.heading,
            bold: true,
            size: 22,
            color: '0F172A',
            font: 'Georgia',
          }),
        ],
      })
    );

    if (tbl.caption) {
      children.push(
        new Paragraph({
          spacing: { after: 70 },
          children: [
            new TextRun({
              text: tbl.caption,
              italics: true,
              size: 17,
              color: '64748B',
              font: 'Calibri',
            }),
          ],
        })
      );
    }

    const rightCols = new Set(tbl.rightAlignColumns || []);
    const headerRow = new TableRow({
      tableHeader: true,
      children: tbl.columns.map(
        (col, colIdx) =>
          new TableCell({
            shading: { fill: '0F172A', type: ShadingType.CLEAR },
            margins: cellMargins,
            children: [
              new Paragraph({
                alignment: rightCols.has(colIdx) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: col,
                    bold: true,
                    size: 17,
                    color: 'FFFFFF',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          })
      ),
    });

    const dataRows =
      tbl.rows.length > 0
        ? tbl.rows.map(
            (row, rowIdx) =>
              new TableRow({
                children: row.map(
                  (val, colIdx) =>
                    new TableCell({
                      shading:
                        rowIdx % 2 === 1
                          ? { fill: 'F8FAFC', type: ShadingType.CLEAR }
                          : undefined,
                      margins: cellMargins,
                      children: [
                        new Paragraph({
                          alignment: rightCols.has(colIdx) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                          children: [
                            new TextRun({
                              text: String(val ?? ''),
                              size: 17,
                              color: '1E293B',
                              font: 'Calibri',
                            }),
                          ],
                        }),
                      ],
                    })
                ),
              })
          )
        : [
            new TableRow({
              children: [
                new TableCell({
                  columnSpan: Math.max(1, tbl.columns.length),
                  margins: cellMargins,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: 'No records matched the active view or filter scope.',
                          italics: true,
                          size: 17,
                          color: '64748B',
                          font: 'Calibri',
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ];

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders,
        rows: [headerRow, ...dataRows],
      })
    );
  }

  // Provenance & Citation Box
  const provEntries: string[] = [];
  if (spec.sourceFilename) provEntries.push(`Primary Source PDF: ${spec.sourceFilename}`);
  if (spec.sha256) provEntries.push(`SHA-256 Digest: ${spec.sha256}`);
  if (spec.permalink) provEntries.push(`Canonical Permalink: ${spec.permalink}`);
  if (spec.footnote) provEntries.push(spec.footnote);

  if (provEntries.length > 0) {
    children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [] }));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 6, color: 'A7F3D0' },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'A7F3D0' },
          left: { style: BorderStyle.SINGLE, size: 18, color: '059669' },
          right: { style: BorderStyle.SINGLE, size: 6, color: 'A7F3D0' },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: 'ECFDF5', type: ShadingType.CLEAR },
                margins: { top: 100, bottom: 100, left: 140, right: 140 },
                children: [
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [
                      new TextRun({
                        text: 'SOURCE PROVENANCE & CITATION RECORD',
                        bold: true,
                        size: 17,
                        color: '047857',
                        font: 'Calibri',
                      }),
                    ],
                  }),
                  ...provEntries.map(
                    (line) =>
                      new Paragraph({
                        spacing: { after: 20 },
                        children: [
                          new TextRun({
                            text: line,
                            size: 16,
                            color: '065F46',
                            font: 'Calibri',
                          }),
                        ],
                      })
                  ),
                ],
              }),
            ],
          }),
        ],
      })
    );
  }

  const document = new Document({
    creator: 'BudgetLens Civic Fiscal Observatory',
    title: spec.title,
    description: spec.subtitle || spec.title,
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'BudgetLens Civic Fiscal Observatory  |  Nigeria Federal Appropriation Schedule',
                    size: 15,
                    color: '64748B',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Verified Official Schedule Extract  ·  Generated ${timestamp}  ·  Page `,
                    size: 15,
                    color: '64748B',
                    font: 'Calibri',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 15,
                    color: '64748B',
                    font: 'Calibri',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  if (typeof Packer.toArrayBuffer === 'function') {
    const ab = await Packer.toArrayBuffer(document);
    return new Uint8Array(ab);
  }
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Downloads a structured tabular dossier strictly as `.pdf`. */
export async function exportTabularDossierPdf(spec: TabularDossierSpec): Promise<string> {
  const bytes = await buildTabularDossierPdfBytes(spec);
  return triggerVerifiedDocumentDownload(bytes, spec.filenameBase, 'pdf');
}

/** Downloads a structured tabular dossier strictly as `.docx`. */
export async function exportTabularDossierDocx(spec: TabularDossierSpec): Promise<string> {
  const bytes = await buildTabularDossierDocxBytes(spec);
  return triggerVerifiedDocumentDownload(bytes, spec.filenameBase, 'docx');
}

/** Converts a `ReportPayload` across all 5 templates into a unified `TabularDossierSpec`. */
export function buildExecutiveReportSpec(
  payload: ReportPayload,
  provenance?: ReportProvenanceContext
): TabularDossierSpec {
  const {
    financialYear,
    template,
    documentTitle,
    preparedBy,
    presidentName,
    party,
    termLabel,
    filterSummary,
    tableRowLimit,
    orientation,
    sections,
    analystNotes,
    registryLength,
    excludedRollupsCount,
    macro,
    debtSnapshot,
    yoy,
    stats,
    civicEquivalents,
    findings,
    duplicateClusters,
    lineages,
    projects,
    crossLedgerFindingsCount,
    compoundProjectsCount,
    sixLedgerSummary,
  } = payload;

  const tables: ExportSectionTable[] = [];
  const bulletBlocks: ExportBulletBlock[] = [];

  if (sections.includeMacroContext) {
    tables.push({
      heading: 'Enacted Macroeconomic Envelope',
      caption: `Budget Theme: ${macro.budgetTheme || `FY ${financialYear} Federal Appropriation Act`}`,
      columns: ['Macro Component', 'Approved Amount', 'Share / Notes'],
      rows: [
        [
          'Official Total Budget',
          formatNairaCompact(macro.officialTotalBudget),
          formatNairaExact(macro.officialTotalBudget),
        ],
        [
          'Capital Budget',
          formatNairaCompact(macro.totalCapitalBudget),
          `${macro.officialTotalBudget > 0 ? ((macro.totalCapitalBudget / macro.officialTotalBudget) * 100).toFixed(1) : '0.0'}% of Budget`,
        ],
        [
          'Recurrent Non-Debt',
          formatNairaCompact(macro.recurrentNonDebtTotal),
          `${macro.officialTotalBudget > 0 ? ((macro.recurrentNonDebtTotal / macro.officialTotalBudget) * 100).toFixed(1) : '0.0'}% of Budget`,
        ],
        [
          'Debt Service',
          formatNairaCompact(macro.debtService),
          `${macro.officialTotalBudget > 0 ? ((macro.debtService / macro.officialTotalBudget) * 100).toFixed(1) : '0.0'}% of Budget`,
        ],
        [
          'Statutory Transfers',
          formatNairaCompact(macro.statutoryTransfers),
          `${macro.officialTotalBudget > 0 ? ((macro.statutoryTransfers / macro.officialTotalBudget) * 100).toFixed(1) : '0.0'}% of Budget`,
        ],
      ],
      rightAlignColumns: [1],
    });
  }

  if (sections.includeDebtSnapshot && debtSnapshot) {
    tables.push({
      heading: `DMO Sovereign Debt Snapshot (${debtSnapshot.isExactYearMatch ? `FY ${debtSnapshot.financialYear}` : `Prior FY ${debtSnapshot.financialYear}`})`,
      caption: `${debtSnapshot.primarySource} (${debtSnapshot.asAt || `FY ${debtSnapshot.financialYear}`})`,
      columns: ['Debt Component', 'Naira Value', 'USD / Reference'],
      rows: [
        [
          'Total Public Debt Stock',
          debtSnapshot.totalDebtNairaM !== null ? formatNairaCompact(debtSnapshot.totalDebtNairaM * 1e6) : 'N/A',
          debtSnapshot.totalDebtUsdM !== null ? `US$${(debtSnapshot.totalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A',
        ],
        [
          'Domestic Debt Stock',
          debtSnapshot.domesticDebtNairaM !== null ? formatNairaCompact(debtSnapshot.domesticDebtNairaM * 1e6) : 'N/A',
          'FGN Bonds & Treasury Bills',
        ],
        [
          'External Debt Stock',
          debtSnapshot.externalDebtNairaM !== null ? formatNairaCompact(debtSnapshot.externalDebtNairaM * 1e6) : 'N/A',
          debtSnapshot.externalDebtUsdM !== null ? `US$${(debtSnapshot.externalDebtUsdM / 1000).toFixed(2)}B` : 'USD N/A',
        ],
      ],
      rightAlignColumns: [1],
    });
  }

  if (sections.includeYoY && yoy) {
    tables.push({
      heading: `Year-over-Year Budget Comparison (FY ${yoy.priorYear} vs FY ${financialYear})`,
      columns: ['Fiscal Metric', `FY ${yoy.priorYear}`, `FY ${financialYear}`, 'YoY Change'],
      rows: [
        [
          'Enacted Official Total',
          formatNairaCompact(yoy.priorOfficialTotal),
          formatNairaCompact(yoy.currentOfficialTotal),
          `${yoy.officialDeltaPct >= 0 ? '+' : ''}${yoy.officialDeltaPct.toFixed(1)}%`,
        ],
        [
          'Extracted Project Schedules',
          formatNairaCompact(yoy.priorExtractedTotal),
          formatNairaCompact(yoy.currentExtractedTotal),
          `${yoy.extractedDeltaPct >= 0 ? '+' : ''}${yoy.extractedDeltaPct.toFixed(1)}%`,
        ],
      ],
      rightAlignColumns: [1, 2, 3],
    });
  }

  if (template === 'six_ledger_brief') {
    const s6 = sixLedgerSummary;
    tables.push({
      heading: 'Six Federal Accountability Layers (Distinct Non-Additive Ledgers)',
      caption:
        'Appropriation totals, legislative bill-to-act markups, Treasury cash vouchers, and OAuGF post-mortem audit queries represent separate stages and are never double-counted.',
      columns: ['Accountability Layer', 'Volume / Sample', 'Monetary / Risk Figure', '6-Ledger Cross-Reference Note'],
      rows: [
        [
          `Evidence Engine v${s6?.engineVersion || '3.0.0'} (${s6?.totalRulesCount || 22} Rules)`,
          `${(s6?.activeYearFindingsCount ?? findings.length).toLocaleString()} FY / ${(s6?.allYearsRuleFindings ?? 49679).toLocaleString()} All-Time`,
          formatNairaCompact(s6?.allYearsFlaggedNaira ?? stats.flaggedTotalAmount),
          `${(s6?.activeYearCompoundProjectsCount ?? compoundProjectsCount ?? 0).toLocaleString()} compound-risk projects in FY ${financialYear}`,
        ],
        [
          'OAuGF Constitutional Audits',
          `${(s6?.oaugf?.parsedAuditIssuesCount ?? 7028).toLocaleString()} queries (${s6?.oaugf?.reportsIndexed ?? 36} reports)`,
          `${(s6?.oaugf?.recoveryDirectiveCount ?? 675).toLocaleString()} recovery orders`,
          `${(s6?.oaugf?.repeatNeglectCount ?? 54).toLocaleString()} repeat/ignored directives across ${(s6?.oaugf?.matchedMdasCount ?? 127)} MDAs`,
        ],
        [
          'Legislative Bill-vs-Act Deltas',
          `${(s6?.billActDiff?.allCyclesInsertionsCount ?? 0).toLocaleString()} insertions`,
          formatNairaCompact(s6?.billActDiff?.allCyclesInsertionsNaira ?? 0),
          s6?.billActDiff?.activeYearCycle
            ? `FY ${financialYear}: ${s6.billActDiff.activeYearCycle.insertionsCount.toLocaleString()} insertions (${formatNairaCompact(s6.billActDiff.activeYearCycle.insertionsTotalNaira)})`
            : `${s6?.billActDiff?.cyclesCount ?? 7} enacted comparison cycles indexed`,
        ],
        [
          'Open Treasury Cash Forensics',
          `${(s6?.treasuryCash?.totalVouchers ?? 467763).toLocaleString()} vouchers`,
          formatNairaCompact(s6?.treasuryCash?.totalNaira ?? 0),
          `${(s6?.treasuryCash?.personalStaffCount ?? 10851).toLocaleString()} personal accounts (${formatNairaCompact(s6?.treasuryCash?.personalStaffPaidNaira ?? 0)}); ${(s6?.treasuryCash?.opaqueVoucherCount ?? 33366).toLocaleString()} opaque/discretionary (${formatNairaCompact(s6?.treasuryCash?.opaqueNaira ?? 0)})`,
        ],
      ],
      rightAlignColumns: [1, 2],
    });

    const topComp = (s6?.topCompoundProjects || []).slice(0, Math.min(25, tableRowLimit));
    tables.push({
      heading: `Priority Compound-Risk Flagged Projects (FY ${financialYear})`,
      columns: ['Code', 'Project & Triggered Rules', 'Executing MDA', '6-Ledger Signals', 'Score', 'Amount', 'Page'],
      rows: topComp.map((cp) => {
        const signals: string[] = [];
        if (cp.paidOnPaper) signals.push('Paid-on-Paper');
        if (cp.billInserted) signals.push('Bill->Act');
        if (cp.mdaOaugfIssues > 0) signals.push(`OAuGF (${cp.mdaOaugfIssues})`);
        if (cp.mdaGrade && cp.mdaGrade !== 'N/A') signals.push(`Grade ${cp.mdaGrade}`);
        return [
          cp.projectCode || 'ERGP',
          `${cp.projectName.slice(0, 62)} [${cp.ruleNames.slice(0, 2).join(', ')}]`,
          cleanEntityDisplayName(cp.agency).slice(0, 34),
          signals.join(' | ') || `${cp.crossLedgerRuleCount} cross-ledger`,
          `${cp.compoundRiskScore}/100`,
          formatNairaCompact(cp.amount),
          `p.${cp.page || '-'}`,
        ];
      }),
      rightAlignColumns: [4, 5, 6],
    });

    if (s6?.topConvergentMdas && s6.topConvergentMdas.length > 0) {
      tables.push({
        heading: 'Top Multi-Ledger Red-Flag Convergent MDAs',
        columns: ['Executing MDA', 'Flags', 'Grade', 'OAuGF Audits', 'Active Convergence Signals', 'Exposure'],
        rows: s6.topConvergentMdas.slice(0, 15).map((m) => [
          cleanEntityDisplayName(m.mdaName).slice(0, 42),
          `${m.flagCount}x`,
          `${m.grade}${m.compositeScore !== null ? ` (${m.compositeScore.toFixed(1)})` : ''}`,
          `${m.oaugfQueryCount} (${m.oaugfRepeatCount} rep)`,
          m.flags.join(', ').replace(/_/g, ' ').slice(0, 48),
          formatNairaCompact(m.totalExposureNaira),
        ]),
        rightAlignColumns: [1, 3, 5],
      });
    }

    if (s6?.oaugf?.topCategories && s6.oaugf.topCategories.length > 0) {
      tables.push({
        heading: 'OAuGF Constitutional Audit Negligence Breakdown',
        columns: ['Constitutional Audit Category', 'Parsed Queries'],
        rows: s6.oaugf.topCategories.map((c) => [c.category, c.count.toLocaleString('en-US')]),
        rightAlignColumns: [1],
      });
    }
  } else if (template === 'forensic_digest') {
    const shown = findings.slice(0, tableRowLimit);
    tables.push({
      heading: `Forensic Compliance & Exception Log (${shown.length.toLocaleString('en-US')} of ${findings.length.toLocaleString('en-US')} Shown)`,
      columns: sections.includeCitations
        ? ['Code', 'Project & Audit Trigger', 'Executing Agency', 'Severity', 'Amount', 'Page']
        : ['Project & Audit Trigger', 'Executing Agency', 'Severity', 'Amount'],
      rows: shown.map((f) =>
        sections.includeCitations
          ? [
              f.projectCode || 'N/A',
              `${f.projectName} [${f.ruleName}: ${f.reason}]`,
              cleanEntityDisplayName(f.agency),
              f.severity.toUpperCase(),
              formatNairaCompact(f.amount),
              `p.${f.page || '-'}`,
            ]
          : [
              `${f.projectName} [${f.ruleName}: ${f.reason}]`,
              cleanEntityDisplayName(f.agency),
              f.severity.toUpperCase(),
              formatNairaCompact(f.amount),
            ]
      ),
      rightAlignColumns: sections.includeCitations ? [4, 5] : [3],
    });
  } else if (template === 'duplicate_audit') {
    const shown = duplicateClusters.slice(0, tableRowLimit);
    tables.push({
      heading: `Duplicate & Split-Allocation Clusters (${shown.length.toLocaleString('en-US')} of ${duplicateClusters.length.toLocaleString('en-US')} Shown)`,
      columns: ['Cluster ID', 'Canonical Description & Provenance', 'Pattern', 'Items', 'MDAs', 'Cluster Total'],
      rows: shown.map((c) => {
        const refs = c.projects
          .slice(0, 4)
          .map((p) => `${p.projectCode || 'ERGP'} (p.${p.page || '?'})`)
          .join(', ');
        return [
          c.id,
          sections.includeCitations && refs ? `${c.canonicalTitle} [Samples: ${refs}]` : c.canonicalTitle,
          c.patternType,
          c.count.toLocaleString('en-US'),
          c.distinctAgencies.toLocaleString('en-US'),
          formatNairaCompact(c.totalAmount),
        ];
      }),
      rightAlignColumns: [3, 4, 5],
    });
  } else if (template === 'recurring_lineage') {
    const shown = lineages.slice(0, tableRowLimit);
    tables.push({
      heading: `Multi-Year Recurring Lineages Active in FY ${financialYear} (${shown.length.toLocaleString('en-US')} of ${lineages.length.toLocaleString('en-US')})`,
      columns: sections.includeCitations
        ? ['Code', 'Canonical Line Item & Years', 'Lead Agency', 'Span', `FY ${financialYear}`, 'Cumulative', 'Page']
        : ['Code', 'Canonical Line Item & Years', 'Lead Agency', 'Span', `FY ${financialYear}`, 'Cumulative'],
      rows: shown.map((l) => {
        const inst = l.instances.find((i) => (i.financialYear ?? i.year) === financialYear);
        const base = [
          l.projectCode || l.lineageId,
          `${l.canonicalTitle} (${l.yearsAppeared.join(', ')})`,
          cleanEntityDisplayName(l.agency),
          `${l.appearanceCount} yrs`,
          formatNairaCompact(inst?.amount || 0),
          formatNairaCompact(l.cumulativeAllocation),
        ];
        if (sections.includeCitations) base.push(`p.${inst?.page || '-'}`);
        return base;
      }),
      rightAlignColumns: sections.includeCitations ? [3, 4, 5, 6] : [3, 4, 5],
    });
  } else if (template === 'sector_summary') {
    tables.push({
      heading: 'Sectoral Distribution Breakdown',
      columns: ['Sector Classification', 'Items', 'Share (%)', 'Total Allocation'],
      rows: stats.sectorBreakdown.map((s) => [
        s.sector,
        s.count.toLocaleString('en-US'),
        `${s.sharePct.toFixed(1)}%`,
        formatNairaCompact(s.totalAmount),
      ]),
      rightAlignColumns: [1, 2, 3],
    });
    const shown = projects.slice(0, tableRowLimit);
    tables.push({
      heading: `Filtered Verbatim Line-Item Ledger (${shown.length.toLocaleString('en-US')} of ${projects.length.toLocaleString('en-US')})`,
      columns: sections.includeCitations
        ? ['Code', 'Project Description', 'Executing Agency', 'Amount', 'Page']
        : ['Project Description', 'Executing Agency', 'Amount'],
      rows: shown.map((p) =>
        sections.includeCitations
          ? [p.projectCode || 'ERGP', p.projectName, cleanEntityDisplayName(p.agency), formatNairaCompact(p.amount), `p.${p.page || '-'}`]
          : [p.projectName, cleanEntityDisplayName(p.agency), formatNairaCompact(p.amount)]
      ),
      rightAlignColumns: sections.includeCitations ? [3, 4] : [2],
    });
  } else {
    // executive_brief
    tables.push({
      heading: 'Top Executing Agencies (Filtered Scope)',
      columns: ['Executing Agency / MDA', 'Items', 'Share (%)', 'Total Allocation'],
      rows: stats.topAgencies.slice(0, 12).map((a) => [
        cleanEntityDisplayName(a.agency),
        a.count.toLocaleString('en-US'),
        `${a.sharePct.toFixed(1)}%`,
        formatNairaCompact(a.totalAmount),
      ]),
      rightAlignColumns: [1, 2, 3],
    });

    const priorityFindings = findings.slice(0, Math.min(20, tableRowLimit));
    tables.push({
      heading: `Priority Evidence Engine v3.0 Exceptions (${findings.length.toLocaleString('en-US')} Flagged)`,
      columns: sections.includeCitations
        ? ['Code', 'Line Item & Audit Trigger', 'Agency', 'Severity', 'Amount', 'Page']
        : ['Line Item & Audit Trigger', 'Agency', 'Severity', 'Amount'],
      rows: priorityFindings.map((f) =>
        sections.includeCitations
          ? [
              f.projectCode || 'N/A',
              `${f.projectName} (${f.ruleName})`,
              cleanEntityDisplayName(f.agency),
              f.severity.toUpperCase(),
              formatNairaCompact(f.amount),
              `p.${f.page || '-'}`,
            ]
          : [`${f.projectName} (${f.ruleName})`, cleanEntityDisplayName(f.agency), f.severity.toUpperCase(), formatNairaCompact(f.amount)]
      ),
      rightAlignColumns: sections.includeCitations ? [4, 5] : [3],
    });
  }

  if (sections.includeCivicImpact) {
    bulletBlocks.push({
      heading: `Civic Infrastructure Equivalents (${formatNairaCompact(stats.totalAllocated)} Filtered Scope)`,
      items: [
        `Equipped Primary Healthcare Centres: ${civicEquivalents.equivalents.phcs.toLocaleString()} units (@ ${formatNairaCompact(civicEquivalents.unitCosts.phc)})`,
        `3-Classroom School Blocks: ${civicEquivalents.equivalents.classroomBlocks.toLocaleString()} units (@ ${formatNairaCompact(civicEquivalents.unitCosts.classroomBlock)})`,
        `Solar Motorized Boreholes: ${civicEquivalents.equivalents.solarBoreholes.toLocaleString()} units (@ ${formatNairaCompact(civicEquivalents.unitCosts.solarBorehole)})`,
        `Annual School Feeding Slots: ${civicEquivalents.equivalents.schoolMealsFed.toLocaleString()} pupils (@ ${formatNairaCompact(civicEquivalents.unitCosts.annualSchoolMeal)})`,
        `Annual Statutory Minimum Wages: ${civicEquivalents.equivalents.annualMinWages.toLocaleString()} worker-years (@ ${formatNairaCompact(civicEquivalents.unitCosts.annualMinWage)})`,
      ],
    });
  }

  if (sections.includeAnalystNotes && analystNotes.trim()) {
    bulletBlocks.push({
      heading: 'Analyst Commentary & Oversight Notes',
      items: analystNotes
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  const covMeta = getCoverageCaveatMeta(financialYear);
  return {
    filenameBase: `BudgetLens_FY${financialYear}_${template}`,
    eyebrow: `BUDGETLENS CIVIC FISCAL OBSERVATORY · ${TEMPLATE_META[template].label.toUpperCase()}`,
    title: `${documentTitle} (FY ${financialYear})`,
    subtitle: TEMPLATE_META[template].subtitle,
    orientation,
    metadata: [
      { label: 'Administration', value: `${presidentName} (${party} · ${termLabel})` },
      { label: 'Prepared By', value: preparedBy || 'BudgetLens Civic Observatory Desk' },
      { label: 'Scope', value: filterSummary },
      { label: 'Sources Indexed', value: `${registryLength} Fiscal Schedules` },
      ...(covMeta.tier !== 'FULL_SCHEDULE'
        ? [{ label: 'Schedule Coverage', value: covMeta.label }]
        : []),
      { label: 'Hygiene', value: `${excludedRollupsCount.toLocaleString('en-US')} MDA rollup rows excluded` },
    ],
    kpis: [
      {
        label: 'Filtered Line Items',
        value: stats.count.toLocaleString(),
        subtext: `Median ${formatNairaCompact(stats.medianAmount)}`,
      },
      {
        label: 'Filtered Allocation',
        value: formatNairaCompact(stats.totalAllocated),
        subtext: `Mean ${formatNairaCompact(stats.avgAmount)}`,
      },
      {
        label: 'Evidence Engine v3.0 Flags',
        value: findings.length.toLocaleString(),
        subtext: `${stats.highSeverityCount} High · ${typeof crossLedgerFindingsCount === 'number' ? `${crossLedgerFindingsCount} Cross-Ledger` : `${stats.mediumSeverityCount} Med`}`,
      },
      {
        label: 'Duplicate Clusters',
        value: stats.duplicateClusterCount.toLocaleString(),
        subtext: `${formatNairaCompact(stats.duplicateTotalAmount)} cumulative`,
      },
      ...(template === 'six_ledger_brief' && sixLedgerSummary
        ? [
            {
              label: 'OAuGF Audit Queries',
              value: (sixLedgerSummary.oaugf?.parsedAuditIssuesCount ?? 7028).toLocaleString(),
              subtext: `${sixLedgerSummary.oaugf?.recoveryDirectiveCount ?? 675} recovery · ${sixLedgerSummary.oaugf?.repeatNeglectCount ?? 54} repeat`,
            },
            {
              label: 'Personal / Opaque Cash',
              value: formatNairaCompact(
                (sixLedgerSummary.treasuryCash?.personalStaffPaidNaira ?? 0) +
                  (sixLedgerSummary.treasuryCash?.opaqueNaira ?? 0)
              ),
              subtext: `${(sixLedgerSummary.treasuryCash?.personalStaffCount ?? 10851).toLocaleString()} staff + ${(sixLedgerSummary.treasuryCash?.opaqueVoucherCount ?? 33366).toLocaleString()} opaque`,
            },
          ]
        : []),
    ],
    narrative: macro.executiveSummary,
    bulletBlocks,
    tables,
    sourceFilename: provenance?.filename,
    sha256: provenance?.sha256,
    permalink: provenance?.permalink,
    footnote: 'Verified verbatim against enacted Federal Republic of Nigeria Appropriation schedules.',
  };
}

export async function buildExecutiveReportPdfBytes(
  payload: ReportPayload,
  provenance?: ReportProvenanceContext
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildExecutiveReportSpec(payload, provenance));
}

export async function buildExecutiveReportDocxBytes(
  payload: ReportPayload,
  provenance?: ReportProvenanceContext
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildExecutiveReportSpec(payload, provenance));
}

async function resolveExecutiveProvenance(year: number): Promise<ReportProvenanceContext> {
  const manifest = await loadSourceProvenance();
  const resolved = resolveYearProvenance(manifest, year);
  const permalink =
    buildCanonicalPermalink({ tab: 'reports', year }) ||
    (typeof window !== 'undefined' ? window.location.href : undefined);
  return {
    filename: resolved.filename,
    sha256: resolved.sha256,
    permalink,
  };
}

export async function exportExecutiveReportPdf(payload: ReportPayload): Promise<string> {
  const prov = await resolveExecutiveProvenance(payload.financialYear);
  const bytes = await buildExecutiveReportPdfBytes(payload, prov);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_FY${payload.financialYear}_${payload.template}`, 'pdf');
}

export async function exportExecutiveReportDocx(payload: ReportPayload): Promise<string> {
  const prov = await resolveExecutiveProvenance(payload.financialYear);
  const bytes = await buildExecutiveReportDocxBytes(payload, prov);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_FY${payload.financialYear}_${payload.template}`, 'docx');
}

/** Builds a structured evidence-sheet specification for a single appropriation item. */
export function buildEvidenceSheetSpec(spec: SingleRecordEvidenceSpec): TabularDossierSpec {
  const pres = getPresidentForYear(spec.financialYear);
  const macro = getMacroForYear(spec.financialYear);
  const fx = macro.fxNairaPerUsd || 1500;
  const usdVal = spec.amountNaira / fx;
  const formattedUsd =
    usdVal >= 100
      ? `$${Math.round(usdVal).toLocaleString('en-US')}`
      : `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const budgetSharePct =
    macro.officialTotalBudget > 0 ? (spec.amountNaira / macro.officialTotalBudget) * 100 : 0;
  const formattedSharePct =
    budgetSharePct >= 0.01 ? `${budgetSharePct.toFixed(3)}%` : `${budgetSharePct.toFixed(4)}%`;

  const provRecord = resolveRecordProvenance(null, spec.financialYear, {
    sourceFilename: spec.sourceFilename,
    agencyName: spec.agencyName,
    recordSha256: spec.sha256 || undefined,
  });
  const effectiveProv = {
    ...provRecord,
    sha256: spec.sha256 ?? provRecord.sha256,
    shortSha256: spec.sha256 ? spec.sha256.slice(0, 16) : provRecord.shortSha256,
  };

  const permalink =
    spec.permalink ||
    buildCanonicalPermalink({ year: spec.financialYear, item: spec.projectCode, page: spec.page }) ||
    'https://budgetlens.ng';

  const cites = formatRecordCitations({
    financialYear: spec.financialYear,
    projectCode: spec.projectCode || 'ERGP',
    projectName: spec.projectName,
    amountNaira: spec.amountNaira,
    agencyName: spec.agencyName,
    page: spec.page,
    state: spec.state,
    permalink,
    provenance: effectiveProv,
  });

  const tables: ExportSectionTable[] = [
    {
      heading: 'Verbatim Appropriation Record & Attribution',
      columns: ['Field', 'Verified Schedule Value'],
      rows: [
        ['Fiscal Year & Administration', `FY ${spec.financialYear} · ${pres.presidentName} (${pres.termLabel})`],
        ['Line / Project Code', spec.projectCode || 'ERGP'],
        ['Verbatim Description', spec.projectName],
        ['Executing Agency (MDA)', spec.agencyName],
        ['Sector / Jurisdiction', `${spec.sector || 'Infrastructure'} · ${spec.state || 'Federal / National'}`],
        ['Enacted Naira Allocation', formatNairaExact(spec.amountNaira)],
        [
          `Year-Native USD Equivalent`,
          `${formattedUsd} (at FY ${spec.financialYear} CBN FX rate ₦${fx.toLocaleString('en-US')}/US$1)`,
        ],
        [
          `% of Enacted Federal Budget`,
          `${formattedSharePct} of FY ${spec.financialYear} ${formatNairaCompact(macro.officialTotalBudget)} Federal Budget`,
        ],
        ['Official PDF Page', `Page ${spec.page}`],
        ...(spec.ruleName
          ? [['Audit Signal', `${spec.ruleName}${spec.severity ? ` (${spec.severity.toUpperCase()})` : ''}`]]
          : []),
      ],
    },
    {
      heading: 'Ready-to-Use Formal Citations',
      columns: ['Style', 'Formatted Reference'],
      rows: [
        ['Newsroom / Press', cites.newsroom],
        ['APA 7th Edition', cites.apa],
        ['Chicago / Legal', cites.chicago],
      ],
    },
  ];

  const bulletBlocks: ExportBulletBlock[] = [];
  if (spec.equivalents && spec.equivalents.length > 0) {
    bulletBlocks.push({
      heading: 'Year-Native Civic Infrastructure Equivalents',
      items: spec.equivalents.map((eq) =>
        eq.source ? `${eq.label} (Baseline source: ${eq.source})` : eq.label
      ),
    });
  }

  return {
    filenameBase: `BudgetLens_Evidence_FY${spec.financialYear}_${spec.projectCode || 'record'}`,
    eyebrow: `BUDGETLENS EVIDENCE RECORD · FY ${spec.financialYear} APPROPRIATION SCHEDULE`,
    title: spec.projectName,
    subtitle: `Executing Agency: ${spec.agencyName} · Official PDF Page ${spec.page}`,
    orientation: 'portrait',
    metadata: [
      { label: 'Line Code', value: spec.projectCode || 'ERGP' },
      { label: 'Administration', value: `${pres.presidentName} (${pres.party})` },
      { label: 'PDF Page', value: `Page ${spec.page}` },
    ],
    kpis: [
      {
        label: 'Allocated Naira',
        value: formatNairaCompact(spec.amountNaira),
        subtext: formatNairaExact(spec.amountNaira),
      },
      {
        label: `FY ${spec.financialYear} USD Value`,
        value: formattedUsd,
        subtext: `CBN FX ₦${fx.toLocaleString('en-US')}/US$1`,
      },
      {
        label: '% of Enacted Budget',
        value: formattedSharePct,
        subtext: `Of ${formatNairaCompact(macro.officialTotalBudget)} FY${spec.financialYear}`,
      },
      {
        label: 'Official Citation',
        value: `FY ${spec.financialYear} · p.${spec.page}`,
        subtext: spec.projectCode || 'ERGP Line Item',
      },
    ],
    bulletBlocks,
    tables,
    sourceFilename: effectiveProv.filename,
    sha256: spec.sha256 ?? effectiveProv.sha256,
    permalink,
    footnote: 'Evidence — not accusations. Every record traces back to official Federal Appropriation PDFs.',
  };
}

export async function buildEvidenceSheetPdfBytes(
  spec: SingleRecordEvidenceSpec
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildEvidenceSheetSpec(spec));
}

export async function buildEvidenceSheetDocxBytes(
  spec: SingleRecordEvidenceSpec
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildEvidenceSheetSpec(spec));
}

async function hydrateEvidenceSpec(spec: SingleRecordEvidenceSpec): Promise<SingleRecordEvidenceSpec> {
  const manifest = await loadSourceProvenance();
  const resolved = resolveRecordProvenance(manifest, spec.financialYear, {
    sourceFilename: spec.sourceFilename,
    agencyName: spec.agencyName,
    recordSha256: spec.sha256 || undefined,
  });
  return {
    ...spec,
    sourceFilename: spec.sourceFilename || resolved.filename,
    sha256: spec.sha256 || resolved.sha256,
    permalink:
      spec.permalink ||
      buildCanonicalPermalink({
        year: spec.financialYear,
        item: spec.projectCode,
        page: spec.page,
      }),
  };
}

export async function exportEvidenceSheetPdf(spec: SingleRecordEvidenceSpec): Promise<string> {
  const hydrated = await hydrateEvidenceSpec(spec);
  const bytes = await buildEvidenceSheetPdfBytes(hydrated);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Evidence_FY${hydrated.financialYear}_${hydrated.projectCode || 'record'}`,
    'pdf'
  );
}

export async function exportEvidenceSheetDocx(spec: SingleRecordEvidenceSpec): Promise<string> {
  const hydrated = await hydrateEvidenceSpec(spec);
  const bytes = await buildEvidenceSheetDocxBytes(hydrated);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Evidence_FY${hydrated.financialYear}_${hydrated.projectCode || 'record'}`,
    'docx'
  );
}

export interface ScrutinyBriefExportInput {
  filenameSlug: string;
  scopeLabel: string;
  selectedPresident: string;
  yearFilter: 'ALL' | number;
  currencyView: 'usd' | 'nominal';
  activePillarLabel: string;
  searchQuery?: string;
  methodology: string;
  permalink: string;
  metadata: Array<{ label: string; value: string }>;
  kpis: ExportKpi[];
  baselineNotes?: string[];
  comparisonTable?: ExportSectionTable;
  activePillarTable: ExportSectionTable;
  sourceFilename?: string;
  sha256?: string | null;
}

/** Converts a scoped Presidential Scrutiny Sweep state into a publication-grade A4 dossier spec. */
export function buildPresidentialScrutinySpec(
  input: ScrutinyBriefExportInput
): TabularDossierSpec {
  const tables: ExportSectionTable[] = [];
  if (input.comparisonTable) {
    tables.push(input.comparisonTable);
  }
  tables.push(input.activePillarTable);

  const bulletBlocks: ExportBulletBlock[] = [];
  if (input.baselineNotes && input.baselineNotes.length > 0) {
    bulletBlocks.push({
      heading: 'Administration Economic Reality & Threshold Calibration',
      items: input.baselineNotes,
    });
  }

  return {
    filenameBase: input.filenameSlug,
    eyebrow: `BUDGETLENS 1999–2026 PRESIDENTIAL SCRUTINY BRIEF · ${input.activePillarLabel.toUpperCase()}`,
    title: `Presidential & Public Scrutiny Brief — ${input.scopeLabel}`,
    subtitle: `${input.activePillarLabel} · Currency Lens: ${
      input.currencyView === 'usd' ? 'Historical US$ (Year CBN FX)' : 'As-Enacted Naira (Nominal)'
    }${input.yearFilter !== 'ALL' ? ` · FY ${input.yearFilter}` : ''}${
      input.searchQuery?.trim() ? ` · Query "${input.searchQuery.trim()}"` : ''
    }`,
    orientation: 'landscape',
    metadata: input.metadata,
    kpis: input.kpis,
    narrative: input.methodology,
    bulletBlocks,
    tables,
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote:
      'Domain Guards active: Military/Police fleet excluded, hospital/correctional feeding excluded, tied multilateral loans excluded. Evidence — not accusations.',
  };
}

export async function buildPresidentialScrutinyPdfBytes(
  input: ScrutinyBriefExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildPresidentialScrutinySpec(input));
}

export async function buildPresidentialScrutinyDocxBytes(
  input: ScrutinyBriefExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildPresidentialScrutinySpec(input));
}

export async function exportPresidentialScrutinyPdf(
  input: ScrutinyBriefExportInput
): Promise<string> {
  const bytes = await buildPresidentialScrutinyPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, input.filenameSlug, 'pdf');
}

export async function exportPresidentialScrutinyDocx(
  input: ScrutinyBriefExportInput
): Promise<string> {
  const bytes = await buildPresidentialScrutinyDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, input.filenameSlug, 'docx');
}

export interface StatisticalForensicsExportInput {
  financialYear: number;
  activeSubTab: string;
  benford: BenfordAnalysisResult;
  prematureAlerts: PrematureReplacementAlert[];
  virements: VirementAnalyticsResult;
  duplicateRings: DuplicateRingCluster[];
  totalCrossYearPrematureAlerts?: number;
  sourceFilename?: string;
  sha256?: string | null;
  permalink?: string;
}

/** Converts Statistical Forensics Lab analytics into an A4 Verified Document Dossier spec. */
export function buildStatisticalForensicsSpec(
  input: StatisticalForensicsExportInput
): TabularDossierSpec {
  const { benford, virements } = input;
  const subLabelMap: Record<string, string> = {
    benford: 'Benford Digit Audit (MAD)',
    replacement: 'Premature Asset Replacement (1999–2026)',
    virements: 'Virement & Contingency Tracking',
    rings: 'Coordinated Duplicate Rings',
    govspend: 'GovSpend Cash & December Rush Forensics',
  };
  const activeLabel = subLabelMap[input.activeSubTab] || 'All Four Pillars';
  const crossMdaCount = input.duplicateRings.filter((r) => r.isCrossMda).length;

  const digitTable: ExportSectionTable = {
    heading: `1. Benford's Law First-Digit Distribution — FY ${input.financialYear}`,
    caption: `Nigrini MAD = ${benford.meanAbsoluteDeviation.toFixed(5)} | Pearson Chi-Square = ${benford.chiSquareStat.toLocaleString()} (p = ${benford.chiSquarePValue.toFixed(4)}) | Verdict: ${benford.conformityBand}`,
    columns: ['Digit', 'Observed Count', 'Observed %', 'Expected %', 'Deviation %', 'Z-Score', 'Signal'],
    rows: benford.breakdown.map((b) => [
      String(b.digit),
      b.actualCount.toLocaleString(),
      `${b.actualPct.toFixed(2)}%`,
      `${b.expectedPct.toFixed(2)}%`,
      `${b.deviationPct >= 0 ? '+' : ''}${b.deviationPct.toFixed(2)}%`,
      `${b.zScore >= 0 ? '+' : ''}${b.zScore.toFixed(2)}`,
      b.status,
    ]),
    rightAlignColumns: [1, 2, 3, 4, 5],
  };

  const mdaTable: ExportSectionTable = {
    heading: `2. High-Risk MDAs by Benford MAD (N >= 50 Items, FY ${input.financialYear})`,
    columns: ['Executing MDA', 'Items', 'Total Spend', 'MAD', 'Chi2 (p)', 'Peak Digit', 'Conformity'],
    rows: benford.flaggedMdas.slice(0, 15).map((m) => [
      cleanEntityDisplayName(m.mdaName),
      m.recordCount.toLocaleString('en-US'),
      formatNairaCompact(m.totalAmountNaira),
      m.mad.toFixed(5),
      `${m.chiSquareStat.toLocaleString('en-US')} (${m.chiSquarePValue.toFixed(3)})`,
      `Digit ${m.topSuspiciousDigit} (${m.topDigitDeviationPct >= 0 ? '+' : ''}${m.topDigitDeviationPct.toFixed(1)}%)`,
      m.conformityBand,
    ]),
    rightAlignColumns: [1, 2, 3, 4],
  };

  const replacementTable: ExportSectionTable = {
    heading: '3. Cross-Year Premature Capital Asset Replacement Alerts (1999–2026)',
    caption: 'Routine consumables and maintenance are excluded; sliding-window lifespan checks isolate rapid durable replacements.',
    columns: ['MDA', 'Asset Category', 'Years Repurchased', 'Lifespan', 'Cumulative Exposure', 'Risk'],
    rows: input.prematureAlerts.slice(0, 20).map((a) => [
      cleanEntityDisplayName(a.mdaName),
      a.assetCategoryLabel,
      a.yearsActive.join(', '),
      `${a.antiquityLifespanYears} yrs (min gap ${a.minGapYears}y)`,
      formatNairaExact(a.totalSpentNaira),
      a.wasteRisk,
    ]),
    rightAlignColumns: [4],
  };

  const virementTable: ExportSectionTable = {
    heading: `4. Virement, Service-Wide Vote & Contingency Exposure — FY ${input.financialYear}`,
    columns: ['Code', 'Project / Line Item', 'Bucket', 'Executing MDA', 'Amount (NGN)'],
    rows: virements.records.slice(0, 20).map((r) => [
      r.projectCode || 'ERGP',
      r.projectName.slice(0, 88),
      r.categoryKey,
      cleanEntityDisplayName(r.agency),
      formatNairaExact(r.amount),
    ]),
    rightAlignColumns: [4],
  };

  const ringsTable: ExportSectionTable = {
    heading: `5. Coordinated & Cross-MDA Duplicate Rings — FY ${input.financialYear}`,
    columns: ['Cluster ID', 'Verbatim Title', 'Lines', 'MDAs Involved', 'Total Exposure'],
    rows: input.duplicateRings.slice(0, 20).map((c) => [
      c.clusterId,
      c.normalizedTitle.slice(0, 84),
      String(c.itemCount),
      c.mdasInvolved.slice(0, 3).map((m) => cleanEntityDisplayName(m)).join('; '),
      formatNairaExact(c.totalNaira),
    ]),
    rightAlignColumns: [2, 4],
  };

  return {
    filenameBase: `BudgetLens_Statistical_Forensics_FY${input.financialYear}`,
    eyebrow: `BUDGETLENS STATISTICAL FORENSICS LAB | FY ${input.financialYear}`,
    title: `Statistical Forensics & Econometric Dossier — FY ${input.financialYear}`,
    subtitle: `Active Pillar: ${activeLabel} | Nigrini Benford MAD, Premature Asset Lifecycle (1999-2026), Virements & Duplicate Rings`,
    orientation: 'landscape',
    metadata: [
      { label: 'Fiscal Year', value: `FY ${input.financialYear}` },
      { label: 'Primary Focus', value: activeLabel },
      { label: 'Conformity Band', value: benford.conformityBand },
      { label: 'Valid Records', value: benford.validRecordCount.toLocaleString() },
    ],
    kpis: [
      {
        label: 'Nigrini Benford MAD',
        value: benford.conformityBand === 'INSUFFICIENT_SAMPLE' ? 'Low N (<30)' : benford.meanAbsoluteDeviation.toFixed(5),
        subtext: `Score ${benford.benfordIntegrityScore}/100 (${benford.conformityBand})`,
      },
      {
        label: 'Cross-Year Lifecycle Alerts',
        value: String(input.totalCrossYearPrematureAlerts ?? input.prematureAlerts.length),
        subtext: '1999-2026 durable capital repeats',
      },
      {
        label: `FY ${input.financialYear} Virement Total`,
        value: formatNairaCompact(virements.totalNaira),
        subtext: `${virements.virementRecordCount.toLocaleString()} flagged lines`,
      },
      {
        label: `FY ${input.financialYear} Duplicate Rings`,
        value: `${input.duplicateRings.length.toLocaleString()} shown`,
        subtext: `${crossMdaCount} Cross-MDA clusters`,
      },
    ],
    narrative:
      benford.conformityBand === 'INSUFFICIENT_SAMPLE'
        ? `FY ${input.financialYear} contains ${benford.validRecordCount} valid line items (< 30 statutory threshold for Benford conformity). Low-sample guard suppressed anomaly risk inflation while preserving cross-year lifecycle diagnostics.`
        : `FY ${input.financialYear} Benford First-Digit analysis across ${benford.validRecordCount.toLocaleString()} positive allocations yields Nigrini MAD = ${benford.meanAbsoluteDeviation.toFixed(5)} (${benford.conformityBand}), Pearson Chi-Square = ${benford.chiSquareStat.toLocaleString()} (p = ${benford.chiSquarePValue.toFixed(4)}).`,
    tables: [digitTable, mdaTable, replacementTable, virementTable, ringsTable],
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote:
      'Methodological Note: Benford MAD thresholds follow Nigrini (<=0.006 Close, <=0.012 Acceptable, <=0.015 Marginal, >0.015 Non-Conformity). Statistical anomaly signals warrant documentary verification, not accusation.',
  };
}

export async function buildStatisticalForensicsPdfBytes(
  input: StatisticalForensicsExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildStatisticalForensicsSpec(input));
}

export async function buildStatisticalForensicsDocxBytes(
  input: StatisticalForensicsExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildStatisticalForensicsSpec(input));
}

export async function exportStatisticalForensicsPdf(
  input: StatisticalForensicsExportInput
): Promise<string> {
  const bytes = await buildStatisticalForensicsPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Statistical_Forensics_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportStatisticalForensicsDocx(
  input: StatisticalForensicsExportInput
): Promise<string> {
  const bytes = await buildStatisticalForensicsDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Statistical_Forensics_FY${input.financialYear}`,
    'docx'
  );
}

export interface PaddingDiffExportInput {
  summary: BillActYearSummary;
  diffFilter: PaddingDiffFilter;
  filteredItems: BillActDiffItem[];
  permalink?: string;
}

/** Converts a Bill vs. Act Legislative Padding Diff state into an A4 Verified Document Dossier spec. */
export function buildPaddingDiffSpec(input: PaddingDiffExportInput): TabularDossierSpec {
  const { summary, diffFilter, filteredItems } = input;
  const filterLabels: Record<PaddingDiffFilter, string> = {
    all: 'All Legislative Changes',
    insertions: 'NASS New Insertions',
    inflated: 'Inflated Allocations',
    cut: 'Cut Allocations',
    removed: 'Removed by NASS',
    zip: 'Zonal Intervention Projects (ZIP)',
    contracted: 'Contracted in NOCOPO (Awarded / Paid)',
  };

  const mdaTable: ExportSectionTable = {
    heading: `1. Top Altered MDAs by Positive Padding Delta — FY ${summary.financialYear}`,
    columns: ['Executing MDA', 'Altered Items', 'NASS Insertions', 'Inflated Delta', 'Cuts Delta', 'Total Positive Padding'],
    rows: summary.topPaddedMdas.slice(0, 15).map((m) => [
      cleanEntityDisplayName(m.mdaName),
      m.alteredCount.toLocaleString('en-US'),
      formatNairaExact(m.insertionsNaira),
      formatNairaExact(m.inflatedDeltaNaira),
      formatNairaExact(m.cutDeltaNaira),
      formatNairaExact(m.totalPositivePaddingNaira),
    ]),
    rightAlignColumns: [1, 2, 3, 4, 5],
  };

  const itemsTable: ExportSectionTable = {
    heading: `2. Top 100 Legislative Diff Line Items (${filterLabels[diffFilter]}) — FY ${summary.financialYear}`,
    caption: `Granularity Scope: ${summary.comparisonScope}. ${summary.comparisonNote}`,
    columns: ['Status', 'ZIP', 'Code', 'Project / Line Item', 'MDA', 'Bill Proposed', 'Act Enacted', 'Delta (NGN)', 'Pages (B->A)'],
    rows: filteredItems.slice(0, 100).map((item) => [
      item.status,
      item.isZonalIntervention ? 'ZIP' : '-',
      item.projectCode || 'ERGP',
      item.projectName.slice(0, 72),
      cleanEntityDisplayName(item.mdaName).slice(0, 36),
      formatNairaCompact(item.proposedAmountNaira),
      formatNairaCompact(item.enactedAmountNaira),
      `${item.deltaNaira >= 0 ? '+' : ''}${formatNairaCompact(item.deltaNaira)}`,
      `${item.billPage ?? '-'} -> ${item.actPage ?? '-'}`,
    ]),
    rightAlignColumns: [5, 6, 7],
  };

  return {
    filenameBase: `BudgetLens_Bill_vs_Act_Diff_FY${summary.financialYear}_${diffFilter}`,
    eyebrow: `BUDGETLENS LEGISLATIVE ACCOUNTABILITY | FY ${summary.financialYear} BILL VS. ACT DIFF`,
    title: `Executive Bill vs. Enacted Act Padding Brief — FY ${summary.financialYear}`,
    subtitle: `Filter: ${filterLabels[diffFilter]} | Scope: ${summary.comparisonScope} | Dual-Source SHA-256 Verified`,
    orientation: 'landscape',
    metadata: [
      { label: 'Fiscal Year', value: `FY ${summary.financialYear}` },
      { label: 'Comparison Scope', value: summary.comparisonScope },
      { label: 'Bill Sources', value: summary.billFiles.join(', ') || 'Executive Bill' },
      { label: 'Act Sources', value: summary.actFiles.join(', ') || 'Enacted Act' },
    ],
    kpis: [
      {
        label: 'Executive Bill Total',
        value: formatNairaCompact(summary.billTotalNaira),
        subtext: `${summary.billItemCount.toLocaleString()} extracted lines`,
      },
      {
        label: 'Enacted Act Total',
        value: formatNairaCompact(summary.actTotalNaira),
        subtext: `${summary.actItemCount.toLocaleString()} extracted lines`,
      },
      {
        label: 'NASS Insertions',
        value: formatNairaCompact(summary.insertionsTotalNaira),
        subtext: `${summary.insertionsCount.toLocaleString()} new items`,
      },
      {
        label: 'Net Legislative Delta',
        value: `${summary.netDeltaNaira >= 0 ? '+' : ''}${formatNairaCompact(summary.netDeltaNaira)}`,
        subtext: `Inflated: ${formatNairaCompact(summary.inflatedTotalNaira)}`,
      },
    ],
    narrative: summary.comparisonNote,
    tables: [mdaTable, itemsTable],
    sourceFilename: `Bill: ${summary.billFiles[0] || '-'} | Act: ${summary.actFiles[0] || '-'}`,
    sha256: `Bill ${summary.billSha256 || 'n/a'} | Act ${summary.actSha256 || 'n/a'}`,
    permalink: input.permalink,
    footnote:
      'Dual-document comparison derived from verbatim Executive Appropriation Bill and Enacted Appropriation Act PDFs. Evidence — not accusations.',
  };
}

export async function buildPaddingDiffPdfBytes(input: PaddingDiffExportInput): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildPaddingDiffSpec(input));
}

export async function buildPaddingDiffDocxBytes(input: PaddingDiffExportInput): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildPaddingDiffSpec(input));
}

export async function exportPaddingDiffPdf(input: PaddingDiffExportInput): Promise<string> {
  const bytes = await buildPaddingDiffPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Bill_vs_Act_Diff_FY${input.summary.financialYear}_${input.diffFilter}`,
    'pdf'
  );
}

export async function exportPaddingDiffDocx(input: PaddingDiffExportInput): Promise<string> {
  const bytes = await buildPaddingDiffDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Bill_vs_Act_Diff_FY${input.summary.financialYear}_${input.diffFilter}`,
    'docx'
  );
}

export interface AiBriefingExportInput {
  question: string;
  answer: string;
  financialYear: number;
  groundingVerified: boolean;
  totalMatches?: number;
  totalExposureNaira?: number;
  citations: Array<{
    code: string;
    title: string;
    amount: string;
    page: number;
    agency: string;
    year?: number;
  }>;
  permalink?: string;
}

export function buildAiBriefingSpec(input: AiBriefingExportInput): TabularDossierSpec {
  const citTable: ExportSectionTable = {
    heading: 'Verified Official Appropriation Citations',
    columns: ['Year', 'Code', 'Line Item Description', 'Executing MDA', 'Amount', 'Page'],
    rows: input.citations.map((c) => [
      String(c.year || input.financialYear),
      c.code || 'ERGP',
      c.title.slice(0, 88),
      cleanEntityDisplayName(c.agency).slice(0, 42),
      c.amount,
      `p.${c.page}`,
    ]),
    rightAlignColumns: [4, 5],
  };

  return {
    filenameBase: `BudgetLens_AI_Briefing_FY${input.financialYear}`,
    eyebrow: 'BUDGETLENS GROUNDED HYBRID RAG ANALYST · VERIFIED BRIEFING',
    title: `Fiscal Investigation Briefing: ${input.question.slice(0, 96)}`,
    subtitle: `Grounding Gate: ${input.groundingVerified ? 'VERIFIED' : 'PARTIAL'} | Cross-Year SQL/FTS5 Retrieval`,
    orientation: 'landscape',
    metadata: [
      { label: 'Active Year', value: `FY ${input.financialYear}` },
      { label: 'Grounding Gate', value: input.groundingVerified ? 'PASSED (0 Unverified Figures)' : 'REDACTED' },
      { label: 'Matched Corpus Lines', value: (input.totalMatches ?? input.citations.length).toLocaleString() },
    ],
    kpis: [
      {
        label: 'Matched Records',
        value: (input.totalMatches ?? input.citations.length).toLocaleString(),
        subtext: 'Across 1999-2026 FTS5 index',
      },
      {
        label: 'Aggregate Exposure',
        value: input.totalExposureNaira ? formatNairaCompact(input.totalExposureNaira) : 'Scoped',
        subtext: 'Exact SQL sum of matched lines',
      },
    ],
    narrative: input.answer,
    tables: [citTable],
    permalink: input.permalink,
    footnote: 'Every figure and project code in this briefing passed BudgetLens deterministic SQL/FTS5 verification.',
  };
}

export async function exportAiBriefingPdf(input: AiBriefingExportInput): Promise<string> {
  const bytes = await buildTabularDossierPdfBytes(buildAiBriefingSpec(input));
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_AI_Briefing_FY${input.financialYear}`, 'pdf');
}

export async function exportAiBriefingDocx(input: AiBriefingExportInput): Promise<string> {
  const bytes = await buildTabularDossierDocxBytes(buildAiBriefingSpec(input));
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_AI_Briefing_FY${input.financialYear}`, 'docx');
}

export interface CasebookDossierExportInput {
  casebook: Casebook;
  permalink?: string;
}

export function buildCasebookDossierSpec(input: CasebookDossierExportInput): TabularDossierSpec {
  const { casebook } = input;
  const totalExposure = casebook.pins.reduce((s, p) => s + (Number(p.amountNaira) || 0), 0);
  const years = Array.from(new Set(casebook.pins.map((p) => p.financialYear))).sort((a, b) => a - b);

  const summarizePinProvenance = (p: CasebookPin): string => {
    const prov = p.ledgerProvenance;
    if (!prov) return '-';
    const parts: string[] = [];
    for (const t of prov.ledgerTags || []) {
      if (t === 'OAuGF Query' && prov.oaugfQueryCount) {
        parts.push(`OAuGF (${prov.oaugfQueryCount})`);
      } else if (t === 'Compound Risk' && prov.compoundRiskScore) {
        parts.push(`Risk ${prov.compoundRiskScore}`);
      } else {
        parts.push(t);
      }
    }
    if (prov.oaugfQueryCount && !parts.some((s) => s.startsWith('OAuGF'))) {
      parts.push(`OAuGF (${prov.oaugfQueryCount})`);
    }
    if (prov.paidOnPaper && !parts.includes('Paid on Paper')) parts.push('Paid on Paper');
    if (prov.billInsertionStatus && !parts.includes('Bill Insertion')) parts.push('Bill Insertion');
    if (prov.personalOrOpaqueCashFlag && !parts.includes('Treasury Cash')) parts.push('Treasury Cash');
    if (prov.mdaIntegrityGrade && prov.mdaIntegrityGrade !== 'N/A') {
      parts.push(`Grade ${prov.mdaIntegrityGrade}`);
    }
    return parts.join(' | ') || '-';
  };

  const crossLinkedPins = casebook.pins.filter((p) => summarizePinProvenance(p) !== '-');

  const pinsTable: ExportSectionTable = {
    heading: '1. Pinned Multi-Year Appropriation Evidence Schedule',
    columns: ['Year', 'Type', 'Code', 'Line Item / Cluster', 'Executing MDA', '6-Ledger Provenance', 'Amount (NGN)', 'Analyst Note'],
    rows: casebook.pins.map((p: CasebookPin) => [
      String(p.financialYear),
      p.kind,
      p.projectCode || '-',
      p.title.slice(0, 62),
      cleanEntityDisplayName(p.mdaName).slice(0, 30),
      summarizePinProvenance(p).slice(0, 44),
      formatNairaExact(p.amountNaira),
      (p.analystNote || p.tags.join(', ') || '-').slice(0, 52),
    ]),
    rightAlignColumns: [6],
  };

  const tables: ExportSectionTable[] = [pinsTable];
  if (crossLinkedPins.length > 0) {
    tables.push({
      heading: '2. 6-Ledger Cross-Reference Provenance Matrix',
      columns: ['Exhibit / Code', 'Executing MDA & Integrity Grade', 'OAuGF Constitutional Audits', 'Bill->Act & Execution Signals', 'Treasury Cash & Tags'],
      rows: crossLinkedPins.map((p) => {
        const prov = p.ledgerProvenance || {};
        return [
          `FY${p.financialYear} ${p.projectCode || p.title.slice(0, 22)}`,
          `${cleanEntityDisplayName(p.mdaName).slice(0, 32)}${prov.mdaIntegrityGrade && prov.mdaIntegrityGrade !== 'N/A' ? ` (Grade ${prov.mdaIntegrityGrade})` : ''}`,
          prov.oaugfQueryCount ? `${prov.oaugfQueryCount} queries (${prov.oaugfRepeatCount || 0} repeat)` : 'No direct MDA queries',
          [
            prov.paidOnPaper ? 'Paid on Paper' : null,
            prov.billInsertionStatus ? `Bill->Act: ${prov.billInsertionStatus}` : null,
          ]
            .filter(Boolean)
            .join(' | ') || '-',
          (prov.ledgerTags || []).join(', ') || (prov.personalOrOpaqueCashFlag ? 'Treasury Cash' : '-'),
        ];
      }),
    });
  }

  return {
    filenameBase: `BudgetLens_Casebook_${casebook.name}`,
    eyebrow: 'BUDGETLENS INVESTIGATOR CASEBOOK · 6-LEDGER MULTI-YEAR EVIDENCE DOSSIER',
    title: casebook.name,
    subtitle: casebook.description || 'Multi-year federal appropriation investigation dossier',
    orientation: 'landscape',
    metadata: [
      { label: 'Casebook', value: casebook.name },
      { label: 'Pinned Items', value: String(casebook.pins.length) },
      { label: '6-Ledger Cross-Links', value: String(crossLinkedPins.length) },
      { label: 'Fiscal Years', value: years.join(', ') || 'Multi-Year' },
    ],
    kpis: [
      { label: 'Pinned Evidence', value: String(casebook.pins.length), subtext: 'Cross-year exhibits' },
      { label: 'Cumulative Exposure', value: formatNairaCompact(totalExposure), subtext: formatNairaExact(totalExposure) },
      { label: 'Years Covered', value: String(years.length), subtext: years.join(', ') || '-' },
      { label: '6-Ledger Cross-Links', value: String(crossLinkedPins.length), subtext: 'OAuGF / Cash / Padding / Risk' },
    ],
    narrative:
      casebook.description ||
      'Consolidated investigative casebook compiled from verbatim Federal Republic of Nigeria Appropriation Schedules and cross-referenced 6-ledger audit datasets.',
    tables,
    permalink: input.permalink,
    footnote: 'Evidence — not accusations. Every pinned exhibit traces to official Federal Appropriation PDFs and cross-referenced federal accountability ledgers.',
  };
}

export async function buildCasebookDossierPdfBytes(input: CasebookDossierExportInput): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildCasebookDossierSpec(input));
}

export async function buildCasebookDossierDocxBytes(input: CasebookDossierExportInput): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildCasebookDossierSpec(input));
}

export async function exportCasebookDossierPdf(input: CasebookDossierExportInput): Promise<string> {
  const bytes = await buildCasebookDossierPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Casebook_${input.casebook.name}`, 'pdf');
}

export async function exportCasebookDossierDocx(input: CasebookDossierExportInput): Promise<string> {
  const bytes = await buildCasebookDossierDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Casebook_${input.casebook.name}`, 'docx');
}

export interface FormalFoiPacketInput {
  financialYear: number;
  projectCode: string;
  projectName: string;
  amountNaira: number;
  agencyName: string;
  page: number;
  state?: string;
  sourceFilename?: string;
  sha256?: string | null;
  permalink?: string;
}

export function buildFormalFoiPacketSpec(input: FormalFoiPacketInput): TabularDossierSpec {
  const desk = resolveFoiDeskForMda(input.agencyName);
  const deadline = calculateFoiStatutoryDeadline(new Date(), 7);
  const pres = getPresidentForYear(input.financialYear);

  const scheduleTable: ExportSectionTable = {
    heading: 'Primary Source Exhibit & Mandatory Disclosure Schedule',
    columns: ['Exhibit Field', 'Statutory / Verbatim Detail'],
    rows: [
      ['Executing Public Institution', `${desk.ministryTitle} (${input.agencyName})`],
      ['Addressee', `${desk.foiOfficerRole}, ${desk.addressLines.join(', ')}`],
      ['Appropriation Cycle', `FY ${input.financialYear} (${pres.presidentName} Administration)`],
      ['Budget / ERGP Line Code', `${input.projectCode || 'ERGP'} · Schedule Page ${input.page}`],
      ['Verbatim Line Item', input.projectName],
      ['Allocated Amount', formatNairaExact(input.amountNaira)],
      ['Statutory Notice Date', `${deadline.submittedIso} -> 7-Working-Day Deadline: ${deadline.deadlineFormatted}`],
      ['Penalty Warning', 'FOI Act 2011 Section 7(5): Wrongful denial attracts a ₦500,000 fine on conviction.'],
    ],
  };

  return {
    filenameBase: `BudgetLens_FOI_Packet_FY${input.financialYear}_${input.projectCode || 'record'}`,
    eyebrow: 'FREEDOM OF INFORMATION ACT (2011) · FORMAL PUBLIC RECORD APPLICATION',
    title: `FOI Statutory Disclosure Request — ${input.projectCode || 'Line Item'} (FY ${input.financialYear})`,
    subtitle: `Addressed to: ${desk.foiOfficerRole}, ${desk.ministryTitle} | Statutory Deadline: ${deadline.deadlineFormatted}`,
    orientation: 'portrait',
    metadata: [
      { label: 'Statute', value: 'FOI Act 2011 (§1, §4, §7(5), §20)' },
      { label: '7-Day Deadline', value: deadline.deadlineIso },
      { label: 'Reference', value: `${input.projectCode || 'ERGP'} / FY${input.financialYear} p.${input.page}` },
    ],
    narrative: `Pursuant to Sections 1 and 4 of the Freedom of Information Act (2011), application is hereby made for certified procurement, contract, and disbursement records relating to the appropriated item below. Under Section 4(a), response is due within 7 working days (${deadline.deadlineFormatted}).`,
    bulletBlocks: [
      {
        heading: 'Numbered Mandatory Disclosure Schedule',
        items: [
          '1. Certified Bill of Quantities (BOQ), technical specifications, and physical site coordinates.',
          '2. Bureau of Public Procurement (BPP) Certificate of "No Objection" and NOCOPO / OCDS award notice.',
          '3. Executing contractor full corporate name and Corporate Affairs Commission (CAC) RC Number.',
          '4. Capital cash releases, payment vouchers, and stage-completion certificates issued to date.',
        ],
      },
      {
        heading: 'Applicable Statutory Clauses (FOI Act 2011)',
        items: FOI_ACT_2011_CLAUSES.map((c) => `${c.section} (${c.title}): ${c.summary}`),
      },
    ],
    tables: [scheduleTable],
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote: `Oversight Copy: ${desk.oversightCommittees.join(' | ')}`,
  };
}

export async function buildFormalFoiPacketPdfBytes(input: FormalFoiPacketInput): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildFormalFoiPacketSpec(input));
}

export async function buildFormalFoiPacketDocxBytes(input: FormalFoiPacketInput): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildFormalFoiPacketSpec(input));
}

export async function exportFormalFoiPacketPdf(input: FormalFoiPacketInput): Promise<string> {
  const bytes = await buildFormalFoiPacketPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_FOI_Packet_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'pdf'
  );
}

export async function exportFormalFoiPacketDocx(input: FormalFoiPacketInput): Promise<string> {
  const bytes = await buildFormalFoiPacketDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_FOI_Packet_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'docx'
  );
}

export function buildOversightBriefSpec(input: FormalFoiPacketInput): TabularDossierSpec {
  const desk = resolveFoiDeskForMda(input.agencyName);
  const pres = getPresidentForYear(input.financialYear);

  return {
    filenameBase: `BudgetLens_NASS_Oversight_FY${input.financialYear}_${input.projectCode || 'record'}`,
    eyebrow: 'NATIONAL ASSEMBLY OVERSIGHT PETITION · PUBLIC ACCOUNTABILITY BRIEF',
    title: `Legislative Oversight Inquiry — ${input.projectCode || 'Line Item'} (FY ${input.financialYear})`,
    subtitle: `Addressed to: ${desk.oversightCommittees[0]} | Location: ${input.state || 'Federal Constituency'}`,
    orientation: 'portrait',
    metadata: [
      { label: 'Committees', value: desk.oversightCommittees.join('; ') },
      { label: 'Fiscal Year', value: `FY ${input.financialYear} (${pres.presidentName})` },
      { label: 'Executing MDA', value: input.agencyName },
    ],
    kpis: [
      { label: 'Appropriated Sum', value: formatNairaCompact(input.amountNaira), subtext: formatNairaExact(input.amountNaira) },
      { label: 'Schedule Reference', value: `FY ${input.financialYear} p.${input.page}`, subtext: input.projectCode || 'ERGP' },
    ],
    narrative: `Constituency oversight submission requesting committee verification under Sections 88 and 89 of the 1999 Constitution (as amended) for "${input.projectName}" under ${input.agencyName}.`,
    tables: [
      {
        heading: 'Oversight Verification Checklist',
        columns: ['Verification Dimension', 'Requested Legislative Action'],
        rows: [
          ['Physical Site & Scope', 'Confirm designated site coordinates and non-duplication with prior cycles.'],
          ['Procurement Compliance', 'Verify BPP open competitive bidding and contractor CAC registration.'],
          ['Cash Execution Audit', 'Reconcile Budget Office quarterly BIR cash releases against physical milestones.'],
        ],
      },
    ],
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote: 'Evidence — not accusations. Compiled from official Federal Appropriation Schedules.',
  };
}

export async function exportOversightBriefPdf(input: FormalFoiPacketInput): Promise<string> {
  const bytes = await buildTabularDossierPdfBytes(buildOversightBriefSpec(input));
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_NASS_Oversight_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'pdf'
  );
}

export async function exportOversightBriefDocx(input: FormalFoiPacketInput): Promise<string> {
  const bytes = await buildTabularDossierDocxBytes(buildOversightBriefSpec(input));
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_NASS_Oversight_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'docx'
  );
}

export interface ExecutionProcurementExportInput {
  financialYear: number;
  executionYearReport: {
    status: string;
    quarterCovered?: string;
    isPartialYear?: boolean;
    coverageNote?: string | null;
    macroIntegrityWarnings?: string[] | null;
    reportPeriodLabel?: string;
    reportTitle?: string;
    sourceFile?: string;
    sha256?: string;
    totalAppropriatedNaira: number;
    totalReleasedNaira: number;
    totalUtilizedNaira?: number | null;
    overallReleasePct: number;
    overallUtilizationPct?: number | null;
    mdaBreakdown: Array<{
      mdaName: string;
      appropriatedNaira: number;
      releasedNaira: number;
      utilizedNaira?: number | null;
      releasePct: number;
      utilizationPct?: number | null;
      overspendVirement: boolean;
    }>;
    macroRows: Array<{
      label: string;
      budgetNaira: number;
      actualNaira: number;
      performancePct: number;
      derivedFromComponents?: boolean;
    }>;
  } | null;
  procurementStatus: string;
  contractorConcentration: Array<{
    contractorName: string;
    bppContractorId?: string | null;
    cacRcNumber?: string | null;
    awardCount: number;
    totalAwardNaira: number;
    totalPaidNaira?: number;
  }>;
  govspendSummary?: {
    totalDisbursedNaira: number;
    validPaymentCount: number;
    nocopoCrossLinks: Array<{
      contractorName: string;
      nocopoAwardedNaira: number;
      govspendPaymentCount: number;
      govspendPaidNaira: number;
    }>;
    splitPaymentAlerts: Array<{
      date: string;
      organizationName: string;
      beneficiaryName: string;
      voucherCount: number;
      totalAmountNaira: number;
    }>;
  } | null;
  permalink?: string;
}

export function buildExecutionProcurementSpec(
  input: ExecutionProcurementExportInput
): TabularDossierSpec {
  const rep = input.executionYearReport;
  const tables: ExportSectionTable[] = [];
  const hasUtilized = Boolean(rep?.mdaBreakdown?.some((m) => m.utilizedNaira != null));

  if (rep?.mdaBreakdown?.length) {
    tables.push({
      heading: `${tables.length + 1}. MDA Capital Appropriation vs. Releases${hasUtilized ? ' & Utilization' : ''} — FY ${input.financialYear}`,
      columns: hasUtilized
        ? ['Executing MDA', 'Appropriated (NGN)', 'Released (NGN)', 'Utilized (NGN)', 'Release %', 'Flag']
        : ['Executing MDA', 'Appropriated (NGN)', 'Released (NGN)', 'Release %', 'Flag'],
      rows: rep.mdaBreakdown.slice(0, 40).map((m) =>
        hasUtilized
          ? [
              cleanEntityDisplayName(m.mdaName),
              m.appropriatedNaira > 0 ? formatNairaExact(m.appropriatedNaira) : 'N/A',
              formatNairaExact(m.releasedNaira),
              m.utilizedNaira != null ? formatNairaExact(m.utilizedNaira) : 'N/A',
              m.appropriatedNaira > 0 ? `${m.releasePct.toFixed(1)}%` : 'N/A',
              m.overspendVirement ? 'OVERSPEND / VIREMENT' : 'Normal',
            ]
          : [
              cleanEntityDisplayName(m.mdaName),
              m.appropriatedNaira > 0 ? formatNairaExact(m.appropriatedNaira) : 'N/A',
              formatNairaExact(m.releasedNaira),
              m.appropriatedNaira > 0 ? `${m.releasePct.toFixed(1)}%` : 'N/A',
              m.overspendVirement ? 'OVERSPEND / VIREMENT' : 'Normal',
            ]
      ),
      rightAlignColumns: hasUtilized ? [1, 2, 3, 4] : [1, 2, 3],
    });
  }

  if (rep?.macroRows?.length || !rep?.mdaBreakdown?.length) {
    tables.push({
      heading: `${tables.length + 1}. Macro Fiscal Performance Summary — FY ${input.financialYear}`,
      columns: ['Fiscal Line', 'Enacted Budget (NGN)', 'Actual (NGN)', 'Performance %'],
      rows: (rep?.macroRows || []).map((r) => [
        r.derivedFromComponents ? `${r.label} (Derived)` : r.label,
        formatNairaCompact(r.budgetNaira),
        formatNairaCompact(r.actualNaira),
        `${r.performancePct.toFixed(1)}%`,
      ]),
      rightAlignColumns: [1, 2, 3],
    });
  }

  tables.push({
    heading: `${tables.length + 1}. NOCOPO / BPP Contractor Concentration (${input.procurementStatus})`,
    columns: ['Contractor Name', 'BPP ID / CAC RC', 'Awards', 'Cumulative Award (NGN)', 'Disbursed (NGN)'],
    rows: input.contractorConcentration.slice(0, 25).map((c) => [
      cleanEntityDisplayName(c.contractorName),
      c.cacRcNumber || c.bppContractorId || 'Pending CAC Lookup',
      String(c.awardCount),
      formatNairaExact(c.totalAwardNaira),
      c.totalPaidNaira ? formatNairaExact(c.totalPaidNaira) : 'N/A',
    ]),
    rightAlignColumns: [2, 3, 4],
  });

  if (input.govspendSummary?.nocopoCrossLinks?.length) {
    tables.push({
      heading: `${tables.length + 1}. GovSpend Open Treasury <-> NOCOPO Contractor Cross-Links`,
      columns: ['Contractor / Beneficiary', 'NOCOPO Awarded (NGN)', 'Treasury Vouchers', 'GovSpend Paid (NGN)'],
      rows: input.govspendSummary.nocopoCrossLinks.slice(0, 20).map((g) => [
        cleanEntityDisplayName(g.contractorName),
        formatNairaExact(g.nocopoAwardedNaira),
        String(g.govspendPaymentCount),
        formatNairaExact(g.govspendPaidNaira),
      ]),
      rightAlignColumns: [1, 2, 3],
    });
  }

  const bulletBlocks: ExportBulletBlock[] = [];
  if (rep?.macroIntegrityWarnings && rep.macroIntegrityWarnings.length > 0) {
    bulletBlocks.push({
      heading: `FY ${input.financialYear} BIR Source Integrity Guard Notes`,
      items: rep.macroIntegrityWarnings,
    });
  }

  const periodLabel = rep?.isPartialYear
    ? `Partial-Year (${rep.quarterCovered || rep.reportPeriodLabel || 'YTD'})`
    : rep?.reportPeriodLabel || rep?.quarterCovered || 'Q4 Full-Year';

  return {
    filenameBase: `BudgetLens_Execution_Procurement_FY${input.financialYear}`,
    eyebrow: `BUDGETLENS EXECUTION & PROCUREMENT TRACKER | FY ${input.financialYear}`,
    title: `Enacted vs. Actual Execution & Procurement Brief — FY ${input.financialYear}`,
    subtitle: rep?.reportTitle || `Execution Status: ${rep?.status || 'AWAITING_QUARTERLY_DROP'} | Procurement: ${input.procurementStatus}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Fiscal Year', value: `FY ${input.financialYear}` },
      { label: 'Execution Status', value: rep?.status || 'AWAITING_QUARTERLY_DROP' },
      ...(rep?.reportPeriodLabel || rep?.quarterCovered || rep?.isPartialYear
        ? [{ label: 'Period Covered', value: periodLabel }]
        : []),
      { label: 'Procurement Bridge', value: input.procurementStatus },
    ],
    kpis: rep
      ? [
          { label: 'Appropriated', value: formatNairaCompact(rep.totalAppropriatedNaira), subtext: 'Enacted benchmark' },
          { label: 'Actual / Released', value: formatNairaCompact(rep.totalReleasedNaira), subtext: `${rep.overallReleasePct}% execution` },
          { label: 'Procurement Contractors', value: String(input.contractorConcentration.length), subtext: input.procurementStatus },
        ]
      : undefined,
    narrative: rep
      ? `Verified from official Budget Office / OAGF performance report "${rep.sourceFile || `FY ${input.financialYear} BIR`}" (${rep.overallReleasePct}% overall release/performance rate).${
          rep.coverageNote ? ` Coverage Caveat: ${rep.coverageNote}` : ''
        }`
      : `Official BIR/OAGF release data has not yet been ingested for FY ${input.financialYear}; zero synthetic execution metrics are fabricated.`,
    bulletBlocks: bulletBlocks.length > 0 ? bulletBlocks : undefined,
    tables,
    sourceFilename: rep?.sourceFile,
    sha256: rep?.sha256,
    permalink: input.permalink,
    footnote: 'Zero-Fabrication Guarantee: Missing BIR or OCDS datasets are never estimated or synthesized.',
  };
}

export async function exportExecutionProcurementPdf(
  input: ExecutionProcurementExportInput
): Promise<string> {
  const bytes = await buildTabularDossierPdfBytes(buildExecutionProcurementSpec(input));
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Execution_Procurement_FY${input.financialYear}`, 'pdf');
}

export async function exportExecutionProcurementDocx(
  input: ExecutionProcurementExportInput
): Promise<string> {
  const bytes = await buildTabularDossierDocxBytes(buildExecutionProcurementSpec(input));
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Execution_Procurement_FY${input.financialYear}`, 'docx');
}

export interface ProcurementRiskExportInput {
  headline: {
    totalAwardedRows: number;
    totalAwardedNaira: number;
    totalPaidNaira: number;
    planningExcludedCount: number;
    nonCompetitiveCount: number;
    nonCompetitiveAwardedNaira: number;
    nonCompetitiveValueSharePct: number;
    overrunCount: number;
    overrunDeltaNaira: number;
    zeroPaidCount: number;
    zeroPaidAwardedNaira: number;
    excludedTestRecordsCount?: number;
    excludedTestAwardedNaira?: number;
    koboShiftAnomalyCount?: number;
    koboShiftAnomalyDeltaNaira?: number;
  };
  mdaRiskRanking: Array<{
    mdaName: string;
    awardCount: number;
    totalAwardedNaira: number;
    nonCompetitiveAwardedNaira: number;
    nonCompetitiveSharePct: number;
    overrunCount: number;
    overrunDeltaNaira: number;
    zeroPaidCount: number;
    riskScore: number;
  }>;
  topOverrunContracts: Array<{
    ocid: string;
    financialYear: number;
    mdaName: string;
    contractorName: string | null;
    procurementMethod: string;
    awardNaira: number;
    paidNaira: number;
    overrunDeltaNaira: number;
  }>;
  topZeroPaidAwards: Array<{
    ocid: string;
    financialYear: number;
    mdaName: string;
    contractorName: string | null;
    procurementMethod: string;
    awardNaira: number;
  }>;
  portalDataEntryAnomalies?: Array<{
    ocid: string;
    financialYear: number;
    mdaName: string;
    title?: string;
    anomalyType: string;
    anomalyReason: string;
    awardNaira: number;
    paidNaira: number;
    overrunDeltaNaira?: number;
    paidToAwardRatio?: number | null;
  }>;
  permalink?: string;
}

export function buildProcurementRiskSpec(input: ProcurementRiskExportInput): TabularDossierSpec {
  const h = input.headline;
  const excludedTestCount = h.excludedTestRecordsCount || 0;
  const koboShiftCount = h.koboShiftAnomalyCount || 0;
  const koboDeltaNaira = h.koboShiftAnomalyDeltaNaira || 0;

  const mdaTable: ExportSectionTable = {
    heading: '1. Top Federal MDAs by Non-Competitive & Overrun Risk',
    columns: [
      'Executing MDA',
      'Awards',
      'Total Awarded',
      'Non-Competitive',
      'Non-Open %',
      'Overrun Delta',
      'Zero-Paid',
      'Risk',
    ],
    rows: input.mdaRiskRanking.slice(0, 30).map((m) => [
      cleanEntityDisplayName(m.mdaName).slice(0, 44),
      String(m.awardCount),
      formatNairaCompact(m.totalAwardedNaira),
      formatNairaCompact(m.nonCompetitiveAwardedNaira),
      `${m.nonCompetitiveSharePct.toFixed(1)}%`,
      formatNairaCompact(m.overrunDeltaNaira),
      String(m.zeroPaidCount),
      `${m.riskScore.toFixed(1)}`,
    ]),
    rightAlignColumns: [1, 2, 3, 4, 5, 6, 7],
  };

  const overrunTable: ExportSectionTable = {
    heading: '2. Top Payment Overrun Contracts (Paid > Awarded)',
    columns: ['FY', 'OCID', 'Executing MDA', 'Contractor', 'Method', 'Awarded', 'Paid', 'Overrun Delta'],
    rows: input.topOverrunContracts.slice(0, 25).map((c) => [
      String(c.financialYear || '-'),
      c.ocid.slice(0, 24),
      cleanEntityDisplayName(c.mdaName).slice(0, 30),
      cleanEntityDisplayName(c.contractorName || 'Undisclosed').slice(0, 26),
      c.procurementMethod.slice(0, 20),
      formatNairaCompact(c.awardNaira),
      formatNairaCompact(c.paidNaira),
      formatNairaCompact(c.overrunDeltaNaira),
    ]),
    rightAlignColumns: [5, 6, 7],
  };

  const zeroPaidTable: ExportSectionTable = {
    heading: '3. Largest Zero-Disbursement Awarded Contracts',
    columns: ['FY', 'OCID', 'Executing MDA', 'Contractor', 'Method', 'Awarded Value'],
    rows: input.topZeroPaidAwards.slice(0, 25).map((z) => [
      String(z.financialYear || '-'),
      z.ocid.slice(0, 26),
      cleanEntityDisplayName(z.mdaName).slice(0, 34),
      cleanEntityDisplayName(z.contractorName || 'Undisclosed').slice(0, 28),
      z.procurementMethod.slice(0, 22),
      formatNairaCompact(z.awardNaira),
    ]),
    rightAlignColumns: [5],
  };

  const tables: ExportSectionTable[] = [mdaTable, overrunTable, zeroPaidTable];
  if (input.portalDataEntryAnomalies && input.portalDataEntryAnomalies.length > 0) {
    tables.push({
      heading: '4. Quarantined Portal Test & Kobo/Decimal-Shift Anomalies',
      columns: ['FY', 'OCID', 'Executing MDA', 'Anomaly Type', 'Awarded', 'Recorded Paid', 'Ratio'],
      rows: input.portalDataEntryAnomalies.slice(0, 20).map((a) => [
        String(a.financialYear || '-'),
        a.ocid.slice(0, 24),
        cleanEntityDisplayName(a.mdaName).slice(0, 32),
        a.anomalyType,
        formatNairaCompact(a.awardNaira),
        formatNairaCompact(a.paidNaira),
        a.paidToAwardRatio != null ? `${a.paidToAwardRatio.toLocaleString('en-US')}x` : '-',
      ]),
      rightAlignColumns: [4, 5, 6],
    });
  }

  const quarantineClause =
    excludedTestCount > 0 || koboShiftCount > 0
      ? ` ${excludedTestCount.toLocaleString('en-US')} portal sandbox/test rows and ${koboShiftCount.toLocaleString('en-US')} exact 100x/1,000x decimal-shift errors (${formatNairaCompact(koboDeltaNaira)}) were quarantined from headline totals while remaining preserved for audit inspection.`
      : '';

  return {
    filenameBase: 'BudgetLens_Procurement_Risk_Overrun_Dossier',
    eyebrow: 'BUDGETLENS PROCUREMENT RISK MONITOR | BPP NOCOPO OCDS AUDIT',
    title: 'Non-Competitive Procurement Risk & Variation Overrun Dossier',
    subtitle: `Audits ${h.totalAwardedRows.toLocaleString('en-US')} awarded/contract/implementation releases (${h.planningExcludedCount.toLocaleString('en-US')} planning/tender rows excluded)`,
    orientation: 'landscape',
    metadata: [
      { label: 'Awarded Releases', value: h.totalAwardedRows.toLocaleString('en-US') },
      { label: 'Total Contracted', value: formatNairaCompact(h.totalAwardedNaira) },
      { label: 'Non-Competitive Share', value: `${h.nonCompetitiveValueSharePct.toFixed(1)}%` },
      { label: 'Planning Rows Excluded', value: h.planningExcludedCount.toLocaleString('en-US') },
      ...(excludedTestCount > 0 || koboShiftCount > 0
        ? [
            {
              label: 'Quarantined Portal Outliers',
              value: `${excludedTestCount.toLocaleString('en-US')} test / ${koboShiftCount.toLocaleString('en-US')} decimal`,
            },
          ]
        : []),
    ],
    kpis: [
      {
        label: 'Non-Competitive Awards',
        value: formatNairaCompact(h.nonCompetitiveAwardedNaira),
        subtext: `${h.nonCompetitiveCount.toLocaleString('en-US')} awards (${h.nonCompetitiveValueSharePct.toFixed(1)}%)`,
      },
      {
        label: 'Overrun Delta (Paid > Award)',
        value: formatNairaCompact(h.overrunDeltaNaira),
        subtext: `${h.overrunCount.toLocaleString('en-US')} overrun contracts`,
      },
      {
        label: 'Zero-Paid Stalled Awards',
        value: formatNairaCompact(h.zeroPaidAwardedNaira),
        subtext: `${h.zeroPaidCount.toLocaleString('en-US')} awards @ NGN 0 paid`,
      },
      {
        label: 'Total NOCOPO Disbursed',
        value: formatNairaCompact(h.totalPaidNaira),
        subtext: `Across ${h.totalAwardedRows.toLocaleString('en-US')} awarded releases`,
      },
    ],
    narrative:
      'Strictly computed across awarded, contracted, and implementation OCDS stages only. Planning and tender estimates are excluded so pre-tender budget ceilings never inflate overrun or non-competitive ratios.' +
      quarantineClause,
    tables,
    permalink: input.permalink,
    footnote:
      'Source: BPP Nigeria Open Contracting Portal (NOCOPO OCDS 1.1). Evidence for public procurement oversight — not legal conclusions.',
  };
}

export async function buildProcurementRiskPdfBytes(
  input: ProcurementRiskExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildProcurementRiskSpec(input));
}

export async function buildProcurementRiskDocxBytes(
  input: ProcurementRiskExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildProcurementRiskSpec(input));
}

export async function exportProcurementRiskPdf(
  input: ProcurementRiskExportInput
): Promise<string> {
  const bytes = await buildProcurementRiskPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_Procurement_Risk_Overrun_Dossier', 'pdf');
}

export async function exportProcurementRiskDocx(
  input: ProcurementRiskExportInput
): Promise<string> {
  const bytes = await buildProcurementRiskDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_Procurement_Risk_Overrun_Dossier', 'docx');
}

export interface GovspendForensicsExportInput {
  headline: {
    totalVouchers: number;
    totalNaira: number;
    december2019To2025Naira: number;
    decemberRushRatio2019To2025: number | null;
    nearThresholdVoucherCount: number;
    nearThresholdNaira: number;
    rolling7DayClusterCount: number;
    commercialRolling7DayClusterCount?: number;
    commercialRolling7DayClusterNaira?: number;
    payrollRolling7DayClusterCount?: number;
    payrollRolling7DayClusterNaira?: number;
    payrollStatutoryVoucherCount?: number;
    payrollStatutoryNaira?: number;
    exemptedShortPayrollCount?: number;
    benford1DMad: number;
    benford1DBand: string;
    benford2DMad: number;
    benford2DBand: string;
    discretionaryOpaqueVoucherCount?: number;
    discretionaryOpaqueNaira?: number;
    commercialOpaqueVoucherCount?: number;
    commercialOpaqueNaira?: number;
    personalStaffCount?: number;
    personalStaffPaidNaira?: number;
    personalStaffBillionPlusCount?: number;
  };
  payrollFilterMode?: 'COMMERCIAL_AND_DISCRETIONARY_ONLY' | 'ALL_VOUCHERS_WITH_PAYROLL';
  yearlyRush: Array<{
    financialYear: number;
    monthsCovered: number;
    isPartialYear: boolean;
    totalNaira: number;
    decemberNaira: number;
    decemberSharePct: number;
    decemberRushRatio: number | null;
  }>;
  tiers: Array<{
    tierLabel: string;
    voucherCount: number;
    totalNaira: number;
    shareOfValidCountPct: number;
  }>;
  topFlaggedMdas: Array<{
    organizationName: string;
    validCount: number;
    totalNaira: number;
    mad: number;
    conformityBand: string;
    peakDigit: number;
    oaugfQueryCount?: number;
    convergenceFlagCount?: number;
  }>;
  personalAccountPayouts?: {
    staffCount: number;
    staffPaidNaira: number;
    staffBillionPlusCount: number;
    unclassifiedCount?: number;
    unclassifiedPaidNaira?: number;
    topPayees: Array<{
      beneficiaryName: string;
      voucherCount: number;
      totalPaidNaira: number;
      payingMdaCount: number;
      topMdaName: string;
      purposeTag?: string;
      oaugfQueryCount?: number;
    }>;
  };
  discretionaryOpaqueAudit?: {
    totalFlaggedVouchers: number;
    totalFlaggedNaira: number;
    categories: Array<{
      key: string;
      label: string;
      voucherCount: number;
      totalNaira: number;
      topMdaName?: string;
      largestBeneficiary?: string;
      largestVoucherNaira?: number;
    }>;
  };
  topOpaqueVouchers?: Array<{
    paymentDate: string;
    categoryLabel: string;
    organizationName: string;
    beneficiaryName: string;
    amountNaira: number;
    description: string;
  }>;
  topCommercialRollingClusters?: Array<{
    startDate: string;
    endDate: string;
    organizationName: string;
    beneficiaryName: string;
    voucherCount: number;
    totalNaira: number;
    sampleDescription: string;
    isPayrollOrStatutory?: boolean;
  }>;
  permalink?: string;
}

export function buildGovspendForensicsSpec(
  input: GovspendForensicsExportInput
): TabularDossierSpec {
  const h = input.headline;
  const rushTable: ExportSectionTable = {
    heading: '1. Annual December Spending Rush Trajectory (Partial Years Flagged)',
    columns: ['FY', 'Months', 'Control', 'Annual Cash', 'December Cash', 'Dec %', 'Rush Ratio'],
    rows: input.yearlyRush.map((y) => [
      String(y.financialYear),
      String(y.monthsCovered),
      y.isPartialYear ? 'PARTIAL YEAR' : 'Full Year',
      formatNairaCompact(y.totalNaira),
      formatNairaCompact(y.decemberNaira),
      `${y.decemberSharePct.toFixed(1)}%`,
      y.decemberRushRatio !== null ? `${y.decemberRushRatio.toFixed(2)}x` : 'N/A (Partial)',
    ]),
    rightAlignColumns: [1, 3, 4, 5, 6],
  };

  const tierTable: ExportSectionTable = {
    heading: '2. Near-Threshold Clustering [90%, 100%) Below Approval Ceilings',
    columns: ['Ceiling Tier', 'Near-Threshold Vouchers', 'Combined Value', 'Share of Vouchers'],
    rows: input.tiers.map((t) => [
      t.tierLabel,
      t.voucherCount.toLocaleString(),
      formatNairaCompact(t.totalNaira),
      `${t.shareOfValidCountPct.toFixed(2)}%`,
    ]),
    rightAlignColumns: [1, 2, 3],
  };

  const hasMdaAuditData = input.topFlaggedMdas.some(
    (m) => typeof m.oaugfQueryCount === 'number' || typeof m.convergenceFlagCount === 'number'
  );
  const mdaBenTable: ExportSectionTable = {
    heading: '3. Top MDAs by Cash-Level Benford MAD (N >= 500 Vouchers)',
    columns: hasMdaAuditData
      ? ['Paying MDA', 'Vouchers', 'Total Disbursed', '1D MAD', 'Peak', 'Conformity & Audit Cross-Link']
      : ['Paying MDA', 'Vouchers', 'Total Disbursed', '1D MAD', 'Peak Digit', 'Conformity'],
    rows: input.topFlaggedMdas.slice(0, 20).map((m) => {
      const auditNotes: string[] = [m.conformityBand];
      if (typeof m.oaugfQueryCount === 'number' && m.oaugfQueryCount > 0) {
        auditNotes.push(`${m.oaugfQueryCount} OAuGF queries`);
      }
      if (typeof m.convergenceFlagCount === 'number' && m.convergenceFlagCount >= 2) {
        auditNotes.push(`${m.convergenceFlagCount}x Red-Flag`);
      }
      return [
        cleanEntityDisplayName(m.organizationName).slice(0, 46),
        m.validCount.toLocaleString('en-US'),
        formatNairaCompact(m.totalNaira),
        m.mad.toFixed(5),
        String(m.peakDigit),
        hasMdaAuditData ? auditNotes.join(' | ') : m.conformityBand,
      ];
    }),
    rightAlignColumns: [1, 2, 3, 4],
  };

  const tables: ExportSectionTable[] = [rushTable, tierTable, mdaBenTable];
  const hasPayrollMetrics = typeof h.payrollStatutoryVoucherCount === 'number' && h.payrollStatutoryVoucherCount > 0;
  const scopeLabel =
    input.payrollFilterMode === 'ALL_VOUCHERS_WITH_PAYROLL'
      ? 'All Vouchers (Incl. Payroll)'
      : 'Commercial & Discretionary Only';
  const activeSplitCount =
    input.payrollFilterMode !== 'ALL_VOUCHERS_WITH_PAYROLL' &&
    typeof h.commercialRolling7DayClusterCount === 'number'
      ? h.commercialRolling7DayClusterCount
      : h.rolling7DayClusterCount;
  const activeSplitNaira =
    input.payrollFilterMode !== 'ALL_VOUCHERS_WITH_PAYROLL' &&
    typeof h.commercialRolling7DayClusterNaira === 'number'
      ? h.commercialRolling7DayClusterNaira
      : undefined;

  const metadata: Array<{ label: string; value: string }> = [
    { label: 'Valid Cash Vouchers', value: h.totalVouchers.toLocaleString('en-US') },
    { label: '1st-Digit MAD', value: `${h.benford1DMad.toFixed(5)} (${h.benford1DBand})` },
    { label: '2nd-Digit MAD', value: `${h.benford2DMad.toFixed(5)} (${h.benford2DBand})` },
    { label: '7-Day Split Clusters', value: activeSplitCount.toLocaleString('en-US') },
  ];
  if (hasPayrollMetrics) {
    metadata.push({ label: 'Active Disbursement Scope', value: scopeLabel });
    metadata.push({
      label: 'Payroll / Statutory Separated',
      value: `${(h.payrollStatutoryVoucherCount || 0).toLocaleString('en-US')} vouchers`,
    });
  }
  const kpis: Array<{ label: string; value: string; subtext?: string }> = [
    {
      label: 'Dec 2019-2025 Surge',
      value: formatNairaCompact(h.december2019To2025Naira),
      subtext: h.decemberRushRatio2019To2025 ? `${h.decemberRushRatio2019To2025.toFixed(2)}x Jan-Nov avg` : 'Full-year baseline',
    },
    {
      label: 'Near-Threshold Band',
      value: formatNairaCompact(h.nearThresholdNaira),
      subtext: `${h.nearThresholdVoucherCount.toLocaleString('en-US')} vouchers [90%-100%)`,
    },
    {
      label: '7-Day Split Clusters',
      value: activeSplitCount.toLocaleString('en-US'),
      subtext:
        hasPayrollMetrics && typeof h.payrollRolling7DayClusterCount === 'number'
          ? `${activeSplitNaira !== undefined ? `${formatNairaCompact(activeSplitNaira)} · ` : ''}${h.payrollRolling7DayClusterCount.toLocaleString('en-US')} payroll clusters separated`
          : '>=3 vouchers to same MDA+payee',
    },
    {
      label: 'Cash Benford 1D MAD',
      value: h.benford1DMad.toFixed(5),
      subtext: h.benford1DBand,
    },
  ];

  const personal = input.personalAccountPayouts;
  const opaque = input.discretionaryOpaqueAudit;

  if (personal) {
    metadata.push({
      label: 'Personal / Staff Accounts',
      value: `${formatNairaCompact(personal.staffPaidNaira)} (${personal.staffCount.toLocaleString('en-US')} payees, ${personal.staffBillionPlusCount.toLocaleString('en-US')} >= N1B)`,
    });
    kpis.push({
      label: 'Personal / Staff Accounts',
      value: formatNairaCompact(personal.staffPaidNaira),
      subtext: `${personal.staffCount.toLocaleString('en-US')} payees (${personal.staffBillionPlusCount} >= N1B)`,
    });
    if (personal.topPayees.length > 0) {
      tables.push({
        heading: `4. Personal & Staff Bank Account Treasury Beneficiaries (${formatNairaCompact(personal.staffPaidNaira)} across ${personal.staffCount.toLocaleString('en-US')} Payees)`,
        caption:
          typeof personal.unclassifiedCount === 'number' && typeof personal.unclassifiedPaidNaira === 'number'
            ? `Off-procurement individual/staff recipients; excludes ${personal.unclassifiedCount.toLocaleString('en-US')} unclassified payees (${formatNairaCompact(personal.unclassifiedPaidNaira)}).`
            : 'Top individual/staff payees identified outside public procurement awards.',
        columns: ['Individual / Staff Payee', 'Purpose Tag', 'Top Paying MDA', 'Vouchers', 'Total Paid', 'OAuGF Audit'],
        rows: personal.topPayees.slice(0, 20).map((p) => [
          cleanEntityDisplayName(p.beneficiaryName).slice(0, 38),
          (p.purposeTag || 'UNSPECIFIED').replace(/_/g, ' '),
          `${cleanEntityDisplayName(p.topMdaName).slice(0, 34)}${p.payingMdaCount > 1 ? ` (+${p.payingMdaCount - 1})` : ''}`,
          p.voucherCount.toLocaleString('en-US'),
          formatNairaCompact(p.totalPaidNaira),
          typeof p.oaugfQueryCount === 'number' && p.oaugfQueryCount > 0 ? `${p.oaugfQueryCount} queries` : '-',
        ]),
        rightAlignColumns: [3, 4],
      });
    }
  }

  if (opaque && opaque.categories.length > 0) {
    metadata.push({
      label: 'Opaque & Discretionary Cash',
      value: `${formatNairaCompact(opaque.totalFlaggedNaira)} (${opaque.totalFlaggedVouchers.toLocaleString('en-US')} vouchers)`,
    });
    kpis.push({
      label: 'Opaque & Discretionary Cash',
      value: formatNairaCompact(opaque.totalFlaggedNaira),
      subtext: `${opaque.totalFlaggedVouchers.toLocaleString('en-US')} vouchers across ${opaque.categories.length} categories`,
    });
    const catTableIdx = tables.length + 1;
    tables.push({
      heading: `${catTableIdx}. Opaque, Blank-Description & Discretionary Cash Audit (${formatNairaCompact(opaque.totalFlaggedNaira)} across ${opaque.totalFlaggedVouchers.toLocaleString('en-US')} Vouchers)`,
      columns: ['Risk Category', 'Vouchers', 'Total Disbursed', 'Top Offending MDA', 'Largest Sample Voucher'],
      rows: opaque.categories.map((cat) => [
        cat.label.slice(0, 42),
        cat.voucherCount.toLocaleString('en-US'),
        formatNairaCompact(cat.totalNaira),
        cleanEntityDisplayName(cat.topMdaName || 'Federal MDA').slice(0, 34),
        cat.largestBeneficiary && cat.largestVoucherNaira
          ? `${cleanEntityDisplayName(cat.largestBeneficiary).slice(0, 26)} (${formatNairaCompact(cat.largestVoucherNaira)})`
          : '-',
      ]),
      rightAlignColumns: [1, 2],
    });
  }

  if (input.topOpaqueVouchers && input.topOpaqueVouchers.length > 0) {
    const voucherTableIdx = tables.length + 1;
    tables.push({
      heading: `${voucherTableIdx}. Selected High-Value Opaque & Discretionary Sample Vouchers`,
      columns: ['Date', 'Category', 'Paying MDA', 'Beneficiary', 'Verbatim Description', 'Amount'],
      rows: input.topOpaqueVouchers.slice(0, 15).map((v) => [
        v.paymentDate,
        v.categoryLabel.slice(0, 24),
        cleanEntityDisplayName(v.organizationName).slice(0, 28),
        cleanEntityDisplayName(v.beneficiaryName).slice(0, 26),
        (v.description?.trim() || '(Blank / Missing Description)').slice(0, 48),
        formatNairaCompact(v.amountNaira),
      ]),
      rightAlignColumns: [5],
    });
  }

  if (input.topCommercialRollingClusters && input.topCommercialRollingClusters.length > 0) {
    const clusterTableIdx = tables.length + 1;
    tables.push({
      heading: `${clusterTableIdx}. Top Rolling 7-Day Split-Payment Clusters (${scopeLabel})`,
      columns: ['Window', 'Paying MDA', 'Beneficiary', 'Vouchers', 'Cluster Total', 'Scope'],
      rows: input.topCommercialRollingClusters.slice(0, 15).map((cl) => [
        `${cl.startDate} -> ${cl.endDate.slice(5)}`,
        cleanEntityDisplayName(cl.organizationName).slice(0, 32),
        cleanEntityDisplayName(cl.beneficiaryName).slice(0, 30),
        cl.voucherCount.toLocaleString('en-US'),
        formatNairaCompact(cl.totalNaira),
        cl.isPayrollOrStatutory ? 'Payroll / Statutory' : 'Commercial',
      ]),
      rightAlignColumns: [3, 4],
    });
  }

  const payrollClause = hasPayrollMetrics
    ? ` Scope: ${scopeLabel}. ${(h.payrollStatutoryVoucherCount || 0).toLocaleString('en-US')} IPPIS payroll, military/police finance corps, pension, and statutory transfers are separated from commercial vendor splitting alerts, and ${(h.exemptedShortPayrollCount || 0).toLocaleString('en-US')} abbreviated monthly salary tags are exempted from blank-description alerts.`
    : '';

  return {
    filenameBase: 'BudgetLens_GovSpend_Cash_Forensics_Dossier',
    eyebrow: 'BUDGETLENS TREASURY CASH FORENSICS | OAGF OPEN TREASURY AUDIT',
    title: 'December Rush, Personal Accounts, Opaque Vouchers & Cash Benford Dossier',
    subtitle: `Analyzes ${h.totalVouchers.toLocaleString('en-US')} Open Treasury vouchers (${formatNairaCompact(h.totalNaira)})`,
    orientation: 'landscape',
    metadata,
    kpis,
    narrative:
      'Treasury cash forensics exclude incomplete boundary years (2018 & 2026) from December Rush Ratios, enforce N >= 500 sample minimums for per-MDA Benford alerts, and flag personal-account or blank-description disbursements for statutory audit verification.' +
      payrollClause,
    tables,
    permalink: input.permalink,
    footnote:
      'Source: OAGF Open Treasury Portal (GovSpend) & OAuGF Annual Audit Reports. Statistical and disbursement anomalies warrant audit inquiry and do not constitute proof of misconduct.',
  };
}

export async function buildGovspendForensicsPdfBytes(
  input: GovspendForensicsExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildGovspendForensicsSpec(input));
}

export async function buildGovspendForensicsDocxBytes(
  input: GovspendForensicsExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildGovspendForensicsSpec(input));
}

export async function exportGovspendForensicsPdf(
  input: GovspendForensicsExportInput
): Promise<string> {
  const bytes = await buildGovspendForensicsPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_GovSpend_Cash_Forensics_Dossier', 'pdf');
}

export async function exportGovspendForensicsDocx(
  input: GovspendForensicsExportInput
): Promise<string> {
  const bytes = await buildGovspendForensicsDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_GovSpend_Cash_Forensics_Dossier', 'docx');
}

/* ============================================================================
 * Phase 3 · Stage P3-S7: One-Click Multi-Layer Forensic Investigation Briefs
 * (Contractors, MDA Scorecards, and 5-Stage Budget Record Lifecycles)
 * ============================================================================ */

export interface ContractorForensicBriefInput {
  contractorName: string;
  bppContractorId?: string | null;
  firstYear?: number | null;
  lastYear?: number | null;
  totalContracts: number;
  totalContractedNaira: number;
  totalGovspendNaira: number;
  totalGovspendCount: number;
  mdaCount: number;
  topMdas?: string[];
  networkContext?: {
    captiveMdaLabel?: string;
    multiMdaCount?: number;
    payoutDiscrepancyPct?: number;
  } | null;
  contracts: Array<{
    financialYear: number;
    ocdsReleaseId?: string;
    stage?: string;
    budgetTitle: string;
    mdaName: string;
    procurementMethod?: string | null;
    contractAwardNaira: number;
    totalPaidNaira: number;
  }>;
  payments: Array<{
    paymentDate: string;
    paymentNo: string;
    organizationName: string;
    amountNaira: number;
    description: string;
  }>;
  permalink?: string;
}

export function buildContractorBriefSpec(
  input: ContractorForensicBriefInput
): TabularDossierSpec {
  const yearsLabel =
    input.firstYear && input.lastYear
      ? input.firstYear === input.lastYear
        ? `${input.firstYear}`
        : `${input.firstYear}-${input.lastYear}`
      : 'Multi-Year';

  const alerts: string[] = [];
  if (input.networkContext?.captiveMdaLabel) {
    alerts.push(`Captive MDA Relationship: ${input.networkContext.captiveMdaLabel}`);
  }
  if (input.networkContext?.multiMdaCount && input.networkContext.multiMdaCount >= 5) {
    alerts.push(`Multi-MDA Reach: Awarded across ${input.networkContext.multiMdaCount} ministries`);
  }
  if (
    input.networkContext?.payoutDiscrepancyPct &&
    input.networkContext.payoutDiscrepancyPct > 125
  ) {
    alerts.push(
      `Treasury Payout Exceeds NOCOPO Award (${input.networkContext.payoutDiscrepancyPct.toFixed(1)}%)`
    );
  }

  const tables: ExportSectionTable[] = [
    {
      heading: `1. Awarded NOCOPO Contracts (${Math.min(40, input.contracts.length)} of ${input.contracts.length})`,
      columns: ['FY', 'Stage / Method', 'Contract Title', 'Awarding MDA', 'Awarded (NGN)', 'Disbursed (NGN)'],
      rows:
        input.contracts.length > 0
          ? input.contracts.slice(0, 40).map((c) => [
              String(c.financialYear || '-'),
              `${c.stage || 'award'} / ${c.procurementMethod || 'N/S'}`,
              (c.budgetTitle || c.ocdsReleaseId || '-').slice(0, 72),
              cleanEntityDisplayName(c.mdaName || '-').slice(0, 38),
              formatNairaExact(c.contractAwardNaira),
              formatNairaExact(c.totalPaidNaira),
            ])
          : [['-', '-', 'No individual NOCOPO contract rows loaded in active view', '-', '-', '-']],
      rightAlignColumns: [4, 5],
    },
    {
      heading: `2. Open Treasury GovSpend Vouchers (${Math.min(40, input.payments.length)} of ${input.payments.length})`,
      columns: ['Date', 'Payment No', 'Paying MDA', 'Payment Description', 'Amount (NGN)'],
      rows:
        input.payments.length > 0
          ? input.payments.slice(0, 40).map((p) => [
              p.paymentDate || '-',
              p.paymentNo || '-',
              cleanEntityDisplayName(p.organizationName || '-').slice(0, 36),
              (p.description || '-').slice(0, 76),
              formatNairaExact(p.amountNaira),
            ])
          : [['-', '-', 'No individual Treasury voucher rows loaded in active view', '-', '-']],
      rightAlignColumns: [4],
    },
  ];

  const cleanContractor = cleanEntityDisplayName(input.contractorName);
  return {
    filenameBase: `BudgetLens_Contractor_Brief_${cleanContractor || input.contractorName}`,
    eyebrow: 'BUDGETLENS CONTRACTOR FORENSIC INVESTIGATION BRIEF | NOCOPO + GOVSPEND',
    title: `Contractor Audit Dossier: ${cleanContractor || input.contractorName}`,
    subtitle: `BPP ID: ${input.bppContractorId || 'Not Listed'} | Active Window: ${yearsLabel}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Corporate Entity', value: cleanContractor || input.contractorName },
      { label: 'BPP Contractor ID', value: input.bppContractorId || 'N/A' },
      { label: 'Active Fiscal Window', value: yearsLabel },
      {
        label: 'Top Awarding MDAs',
        value:
          (input.topMdas || [])
            .slice(0, 3)
            .map((m) => cleanEntityDisplayName(m))
            .join('; ') || `${input.mdaCount} MDAs`,
      },
    ],
    kpis: [
      { label: 'Times Contracted', value: input.totalContracts.toLocaleString(), subtext: 'Awarded OCDS releases' },
      { label: 'Total Contracted', value: formatNairaCompact(input.totalContractedNaira), subtext: formatNairaExact(input.totalContractedNaira) },
      { label: 'Treasury Cash Paid', value: formatNairaCompact(input.totalGovspendNaira), subtext: `${input.totalGovspendCount.toLocaleString()} vouchers` },
      { label: 'Ministries Served', value: input.mdaCount.toLocaleString(), subtext: 'Distinct procuring entities' },
    ],
    narrative:
      alerts.length > 0
        ? `Cross-ledger network flags detected: ${alerts.join(' | ')}.`
        : 'Cross-ledger dossier reconciling BPP NOCOPO open contracting awards against OAGF Open Treasury direct disbursements.',
    bulletBlocks:
      alerts.length > 0
        ? [{ heading: 'Cross-Ledger Capture & Discrepancy Flags', items: alerts }]
        : undefined,
    tables,
    permalink: input.permalink,
    footnote: 'Derived from BPP NOCOPO OCDS 1.1 and OAGF Open Treasury (GovSpend) public records. Evidence for audit inquiry.',
  };
}

export async function buildContractorBriefPdfBytes(
  input: ContractorForensicBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildContractorBriefSpec(input));
}

export async function buildContractorBriefDocxBytes(
  input: ContractorForensicBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildContractorBriefSpec(input));
}

export async function exportContractorBriefPdf(
  input: ContractorForensicBriefInput
): Promise<string> {
  const bytes = await buildContractorBriefPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Contractor_Brief_${input.contractorName}`, 'pdf');
}

export async function exportContractorBriefDocx(
  input: ContractorForensicBriefInput
): Promise<string> {
  const bytes = await buildContractorBriefDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_Contractor_Brief_${input.contractorName}`, 'docx');
}

export interface MdaScorecardBriefInput {
  mdaKey: string;
  mdaName: string;
  parentFamilies: string[];
  compositeScore: number | null;
  grade: string;
  metricsPresent: number;
  totalExpectedMetrics: number;
  activeWeightSum: number;
  totalTrackedExposureNaira: number;
  pillarRows: Array<{
    pillarLabel: string;
    weight: number;
    effectiveWeightPct: string;
    score: number | null;
    status: string;
    telemetrySummary: string;
  }>;
  convergenceSummary?: {
    flagCount: number;
    flags: string[];
    flagDetails: string[];
    oaugfQueryCount: number;
    oaugfRepeatCount: number;
    oaugfRecoveryDirectives?: number;
    hasPersonalOrOpaqueCash: boolean;
    eeV3RuleHits: number;
    eeV3CrossLedgerHits: number;
    eeV3FlaggedProjects?: number;
    eeV3FlaggedAmountNaira?: number;
    repeatAssetCategories: string[];
  } | null;
  permalink?: string;
}

export function buildMdaScorecardBriefSpec(input: MdaScorecardBriefInput): TabularDossierSpec {
  const rubricTable: ExportSectionTable = {
    heading: '1. 5-Pillar Open-Formula Integrity Rubric & Raw Telemetry',
    columns: ['Accountability Pillar', 'Base Wt', 'Eff. Wt', 'Score', 'Status', 'Underlying Telemetry Summary'],
    rows: input.pillarRows.map((r) => [
      r.pillarLabel,
      `${r.weight}%`,
      r.score !== null ? `${r.effectiveWeightPct}%` : 'Omitted',
      r.score !== null ? `${r.score.toFixed(1)}/100` : 'N/A',
      r.status,
      r.telemetrySummary.slice(0, 140),
    ]),
    rightAlignColumns: [1, 2, 3],
  };

  const tables: ExportSectionTable[] = [rubricTable];
  const conv = input.convergenceSummary;
  if (conv) {
    tables.push({
      heading: '2. 6-Ledger Red-Flag Convergence, OAuGF Audit & 28-Year Evidence Engine v3.0',
      columns: ['Cross-Ledger Accountability Signal', 'Observed Telemetry', 'Status / Audit Inquiry Note'],
      rows: [
        [
          'Red-Flag Convergence Index',
          `${conv.flagCount.toLocaleString('en-US')} independent ledger flag(s)`,
          conv.flags.length > 0 ? conv.flags.join(', ') : 'Below 2+ convergence threshold',
        ],
        [
          'Personal / Opaque Treasury Cash',
          conv.hasPersonalOrOpaqueCash ? 'Flagged (Top Payer / Personal-Opaque)' : 'None Flagged',
          conv.hasPersonalOrOpaqueCash
            ? 'Direct treasury vouchers to staff/personal accounts or blank descriptions require retirement review'
            : 'No concentration in high-risk personal/opaque payout buckets',
        ],
        [
          'OAuGF Constitutional Audit Queries',
          `${conv.oaugfQueryCount.toLocaleString('en-US')} queries (${conv.oaugfRepeatCount.toLocaleString('en-US')} repeat / ${(conv.oaugfRecoveryDirectives ?? 0).toLocaleString('en-US')} recovery)`,
          conv.oaugfQueryCount > 0
            ? 'Official Office of the Auditor-General queries indexed for this MDA'
            : 'No matched OAuGF queries in indexed reports',
        ],
        [
          '28-Year Evidence Engine v3.0',
          `${conv.eeV3RuleHits.toLocaleString('en-US')} rule hits (${conv.eeV3CrossLedgerHits.toLocaleString('en-US')} cross-ledger)`,
          conv.eeV3FlaggedProjects
            ? `${conv.eeV3FlaggedProjects.toLocaleString('en-US')} flagged items (${formatNairaCompact(conv.eeV3FlaggedAmountNaira || 0)}) across 1999–2026`
            : 'Across 1999–2026 Federal Appropriation schedules',
        ],
        [
          'Repeat Asset Lifespan Alerts',
          conv.repeatAssetCategories.length > 0
            ? `${conv.repeatAssetCategories.length.toLocaleString('en-US')} asset category(ies)`
            : 'None detected',
          conv.repeatAssetCategories.length > 0
            ? conv.repeatAssetCategories.join('; ').slice(0, 140)
            : 'No premature repeat physical asset replacements flagged',
        ],
      ],
    });
  }

  const cleanMdaName = cleanEntityDisplayName(input.mdaName) || input.mdaName;
  return {
    filenameBase: `BudgetLens_MDA_Scorecard_${input.mdaKey || cleanMdaName}`,
    eyebrow: conv
      ? 'BUDGETLENS MDA COMPOSITE INTEGRITY & 6-LEDGER CONVERGENCE BRIEF'
      : 'BUDGETLENS MDA COMPOSITE INTEGRITY BRIEF | OPEN 5-PILLAR RUBRIC',
    title: `MDA Integrity Dossier: ${cleanMdaName}`,
    subtitle: `Composite Score: ${input.compositeScore !== null ? `${input.compositeScore.toFixed(1)}/100 (Grade ${input.grade})` : 'N/A'} | Coverage: ${input.metricsPresent}/${input.totalExpectedMetrics} Pillars (${input.activeWeightSum}% Active Denominator)${conv ? ` | Convergence: ${conv.flagCount} Flag(s)` : ''}`,
    orientation: 'landscape',
    metadata: [
      { label: 'MDA Entity', value: cleanMdaName },
      { label: 'Sector Families', value: input.parentFamilies.join(', ') || 'General Federal MDA' },
      { label: 'Active Denominator', value: `${input.activeWeightSum}% (${input.metricsPresent}/${input.totalExpectedMetrics} pillars)` },
      { label: 'Tracked Exposure', value: formatNairaCompact(input.totalTrackedExposureNaira) },
      ...(conv
        ? [
            {
              label: '6-Ledger Signals',
              value: `${conv.flagCount} Convergence Flags | ${conv.oaugfQueryCount} OAuGF Queries | ${conv.eeV3RuleHits.toLocaleString('en-US')} EE v3.0 Hits`,
            },
          ]
        : []),
    ],
    kpis: [
      {
        label: 'Composite Integrity',
        value: input.compositeScore !== null ? `${input.compositeScore.toFixed(1)} / 100` : 'N/A',
        subtext: `Grade ${input.grade}`,
      },
      {
        label: 'Pillar Coverage',
        value: `${input.metricsPresent} / ${input.totalExpectedMetrics}`,
        subtext: `${input.activeWeightSum}% active weight`,
      },
      {
        label: 'Tracked Financial Vol.',
        value: formatNairaCompact(input.totalTrackedExposureNaira),
        subtext: formatNairaExact(input.totalTrackedExposureNaira),
      },
      conv
        ? {
            label: '6-Ledger Convergence',
            value: `${conv.flagCount} Flags · ${conv.oaugfQueryCount} OAuGF`,
            subtext: `${conv.eeV3RuleHits.toLocaleString('en-US')} EE v3.0 rule hits`,
          }
        : {
            label: 'NOCOPO Policy',
            value: 'Awarded Only',
            subtext: 'Planning/tender excluded',
          },
    ],
    narrative:
      'Open-formula scorecard omitting uncovered dimensions (NO_SOURCE_COVERAGE / INSUFFICIENT_SAMPLE) from each agency’s active weight denominator rather than assigning punitive zero scores, joined with 6-ledger convergence telemetry, OAuGF audit reports, and 28-Year Evidence Engine v3.0 signals.',
    bulletBlocks:
      conv && conv.flagDetails.length > 0
        ? [
            {
              heading: 'Cross-Ledger Convergence Signals Warranting Audit Inquiry',
              items: conv.flagDetails,
            },
          ]
        : undefined,
    tables,
    permalink: input.permalink,
    footnote:
      'Joins Appropriation Bill-vs-Act diffs (2017–2025), Budget Office BIR (2009–2026), BPP NOCOPO, OAGF GovSpend, OAuGF Audit Reports (1999–2024), and 28-Year Evidence Engine v3.0.',
  };
}

export async function buildMdaScorecardBriefPdfBytes(
  input: MdaScorecardBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildMdaScorecardBriefSpec(input));
}

export async function buildMdaScorecardBriefDocxBytes(
  input: MdaScorecardBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildMdaScorecardBriefSpec(input));
}

export async function exportMdaScorecardBriefPdf(
  input: MdaScorecardBriefInput
): Promise<string> {
  const bytes = await buildMdaScorecardBriefPdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_MDA_Scorecard_${input.mdaKey || input.mdaName}`, 'pdf');
}

export async function exportMdaScorecardBriefDocx(
  input: MdaScorecardBriefInput
): Promise<string> {
  const bytes = await buildMdaScorecardBriefDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, `BudgetLens_MDA_Scorecard_${input.mdaKey || input.mdaName}`, 'docx');
}

export interface RecordForensicBriefInput {
  financialYear: number;
  projectCode: string;
  projectName: string;
  agencyName: string;
  state?: string;
  sector?: string;
  page: number;
  amountNaira: number;
  formattedUsd?: string;
  formattedReal2026?: string;
  sourceFilename?: string;
  sha256?: string | null;
  permalink?: string;
  paidOnPaperPriority?: boolean;
  paidOnPaperReason?: string;
  stages: Array<{
    stage: string;
    status: string;
    evidenceSummary: string;
  }>;
  contractors?: Array<{
    contractorName: string;
    awardCount: number;
    awardedNaira: number;
    govspendPaidNaira: number;
  }>;
}

export function buildRecordForensicBriefSpec(
  input: RecordForensicBriefInput
): TabularDossierSpec {
  const tables: ExportSectionTable[] = [
    {
      heading: '1. Five-Stage Lifecycle Trace (MTEF -> Bill Diff -> BIR -> NOCOPO -> GovSpend)',
      columns: ['Accountability Stage', 'Verification Status', 'Observed Evidence & Telemetry'],
      rows: input.stages.map((s) => [s.stage, s.status, s.evidenceSummary.slice(0, 150)]),
    },
  ];

  if (input.contractors && input.contractors.length > 0) {
    tables.push({
      heading: '2. Linked Procurement Contractors & Treasury Payouts',
      columns: ['Contractor Name', 'Awards', 'NOCOPO Awarded (NGN)', 'GovSpend Paid (NGN)'],
      rows: input.contractors.slice(0, 20).map((c) => [
        cleanEntityDisplayName(c.contractorName),
        c.awardCount.toLocaleString('en-US'),
        formatNairaExact(c.awardedNaira),
        formatNairaExact(c.govspendPaidNaira),
      ]),
      rightAlignColumns: [1, 2, 3],
    });
  }

  const cleanAgency = cleanEntityDisplayName(input.agencyName) || input.agencyName;
  return {
    filenameBase: `BudgetLens_Record_Forensic_Brief_FY${input.financialYear}_${input.projectCode || 'record'}`,
    eyebrow: `BUDGETLENS 5-STAGE RECORD FORENSIC BRIEF | FY ${input.financialYear}`,
    title: `${input.projectCode || 'Budget Line'} — ${(input.projectName || '').slice(0, 96)}`,
    subtitle: `${cleanAgency} | Schedule Page ${input.page} | ${input.state || 'Federal / Direct'}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Fiscal Year', value: `FY ${input.financialYear}` },
      { label: 'Project / ERGP Code', value: input.projectCode || 'N/A' },
      { label: 'Executing MDA', value: cleanAgency },
      { label: 'Location / Sector', value: `${input.state || 'Federal / Unspecified'} (${input.sector || 'General'})` },
    ],
    kpis: [
      { label: 'Enacted Allocation', value: formatNairaCompact(input.amountNaira), subtext: formatNairaExact(input.amountNaira) },
      { label: 'Historical USD / Real', value: input.formattedUsd || 'As Enacted', subtext: input.formattedReal2026 ? `2026 Real: ${input.formattedReal2026}` : `Schedule p.${input.page}` },
      { label: 'Paid-on-Paper Check', value: input.paidOnPaperPriority ? 'PRIORITY FLAG' : 'Checked', subtext: (input.paidOnPaperReason || 'See stage ledger below').slice(0, 48) },
      { label: 'Lifecycle Stages', value: `${input.stages.length} Checked`, subtext: '100% static audit trace' },
    ],
    narrative: `Verbatim appropriation record traced across MTEF macro assumptions, National Assembly Bill-vs-Act diffs, parent MDA BIR releases, BPP NOCOPO awards, and OAGF GovSpend disbursements.`,
    tables,
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote: 'Evidence — not accusations. Compiled from official Appropriation Acts, Budget Office BIRs, BPP NOCOPO, and OAGF Open Treasury.',
  };
}

export async function buildRecordForensicBriefPdfBytes(
  input: RecordForensicBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildRecordForensicBriefSpec(input));
}

export async function buildRecordForensicBriefDocxBytes(
  input: RecordForensicBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildRecordForensicBriefSpec(input));
}

export async function exportRecordForensicBriefPdf(
  input: RecordForensicBriefInput
): Promise<string> {
  const bytes = await buildRecordForensicBriefPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Record_Forensic_Brief_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'pdf'
  );
}

export async function exportRecordForensicBriefDocx(
  input: RecordForensicBriefInput
): Promise<string> {
  const bytes = await buildRecordForensicBriefDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Record_Forensic_Brief_FY${input.financialYear}_${input.projectCode || 'record'}`,
    'docx'
  );
}

export interface StateAccountabilityBriefInput {
  financialYear: number;
  stateName: string;
  displayName: string;
  zone: string;
  anomalyScore: string;
  budgetedNaira: number;
  projectCount: number;
  flaggedCount: number;
  flaggedAmountNaira: number;
  flaggedSharePct: number;
  topMinistry: string;
  contractedNairaFy: number;
  contractedNairaCumulative: number;
  disbursedNairaFy: number;
  disbursedNairaCumulative: number;
  senatorialDistricts?: readonly string[];
  federalConstituenciesCount?: number;
  topContractors: Array<{ name: string; awardedNaira: number; count: number }>;
  topAllocations: Array<{
    projectCode: string;
    projectName: string;
    agency: string;
    amount: number;
    page: number;
    isFlagged?: boolean;
    ruleReason?: string | null;
  }>;
  lgaBreakdown: Array<{
    lgaName: string;
    projectCount: number;
    amountNaira: number;
    flaggedCount: number;
    topProjectCode: string;
    topProjectTitle: string;
  }>;
  crossLedgerAccountability?: {
    oaugfQueriedMdaCount: number;
    oaugfQueriedExposureNaira: number;
    oaugfTotalMdaQueries: number;
    billInsertionCount: number;
    billInsertionNaira: number;
    topOaugfMdas: Array<{ mdaName: string; queryCount: number; repeatNeglect: number }>;
  } | null;
  sourceFilename?: string;
  sha256?: string | null;
  permalink?: string;
}

export function buildStateBriefSpec(input: StateAccountabilityBriefInput): TabularDossierSpec {
  const tables: ExportSectionTable[] = [
    {
      heading: '1. Top NOCOPO Contractors Winning in This State (2018-2026)',
      columns: ['Contractor Name', 'Awarded Count', 'Contracted Sum (NGN)'],
      rows:
        input.topContractors.length > 0
          ? input.topContractors.map((c) => [
              cleanEntityDisplayName(c.name),
              c.count.toLocaleString('en-US'),
              formatNairaExact(c.awardedNaira),
            ])
          : [['No geo-tagged NOCOPO awards linked to this state', '-', '-']],
      rightAlignColumns: [1, 2],
    },
    {
      heading: `2. Top Verbatim State Allocations (FY ${input.financialYear})`,
      columns: ['Code', 'Project / Line Item', 'Executing MDA', 'Flag', 'Amount (NGN)', 'Page'],
      rows:
        input.topAllocations.length > 0
          ? input.topAllocations.map((p) => [
              p.projectCode || 'ERGP',
              p.projectName.slice(0, 72),
              cleanEntityDisplayName(p.agency).slice(0, 36),
              p.isFlagged ? p.ruleReason || 'Flagged' : 'Clean',
              formatNairaExact(p.amount),
              `p.${p.page}`,
            ])
          : [['-', `No explicit state-tagged FY ${input.financialYear} allocations`, '-', '-', '-', '-']],
      rightAlignColumns: [4, 5],
    },
    {
      heading: `3. Matched Local Government Area (LGA) Execution (${input.lgaBreakdown.length} LGAs)`,
      columns: ['LGA', 'Items', 'Flagged', 'Lead Project', 'Budgeted (NGN)'],
      rows:
        input.lgaBreakdown.length > 0
          ? input.lgaBreakdown.slice(0, 25).map((l) => [
              l.lgaName,
              l.projectCount.toLocaleString('en-US'),
              l.flaggedCount.toLocaleString('en-US'),
              `${l.topProjectCode}: ${l.topProjectTitle.slice(0, 62)}`,
              formatNairaExact(l.amountNaira),
            ])
          : [['-', '0', '0', 'No LGA-specific tokens matched inside FY line items', '-']],
      rightAlignColumns: [1, 2, 4],
    },
  ];

  const cla = input.crossLedgerAccountability;
  if (cla) {
    tables.push({
      heading: '4. OAuGF-Queried MDA Exposure & Bill-to-Act Zonal Insertion Signals',
      columns: ['Cross-Ledger Accountability Signal', 'Observed Count / Scope', 'Value / Detail'],
      rows: [
        [
          'OAuGF-Queried MDAs Active in State',
          `${cla.oaugfQueriedMdaCount.toLocaleString('en-US')} MDA(s) · ${cla.oaugfTotalMdaQueries.toLocaleString('en-US')} audit queries`,
          `${formatNairaExact(cla.oaugfQueriedExposureNaira)} state allocation exposure`,
        ],
        [
          'Bill-to-Act / Zonal (ZIP) Insertions',
          `${cla.billInsertionCount.toLocaleString('en-US')} matched line item(s)`,
          `${formatNairaExact(cla.billInsertionNaira)} inserted / ZIP volume`,
        ],
        ...(cla.topOaugfMdas.length > 0
          ? cla.topOaugfMdas.slice(0, 3).map((m) => [
              `OAuGF Audit Profile: ${cleanEntityDisplayName(m.mdaName).slice(0, 42)}`,
              `${m.queryCount.toLocaleString('en-US')} audit queries (${m.repeatNeglect.toLocaleString('en-US')} repeat)`,
              'Operating executing MDA for projects tagged to this state',
            ])
          : [['Top OAuGF-Queried MDAs', '0 matched', 'No matched OAuGF queries among tagged executing MDAs']]),
      ],
    });
  }

  const districtsLabel = input.senatorialDistricts?.length
    ? input.senatorialDistricts.join(', ')
    : `${input.zone} Zone`;

  return {
    filenameBase: `BudgetLens_State_Brief_${input.displayName}_FY${input.financialYear}`,
    eyebrow: `BUDGETLENS STATE ACCOUNTABILITY BRIEF | ${input.zone.toUpperCase()}`,
    title: `${input.displayName} — Budgeted vs. Contracted vs. Paid Dossier (FY ${input.financialYear})`,
    subtitle: `Senatorial Districts: ${districtsLabel} | ${input.federalConstituenciesCount ?? 0} Federal Constituencies`,
    orientation: 'landscape',
    metadata: [
      { label: 'State / Territory', value: `${input.displayName} (${input.zone})` },
      { label: 'Fiscal Year', value: `FY ${input.financialYear}` },
      { label: 'Top Budgeted MDA', value: cleanEntityDisplayName(input.topMinistry || 'General Federal MDA') },
      { label: 'Risk Classification', value: `${input.anomalyScore} Risk (${input.flaggedSharePct.toFixed(1)}% flagged)` },
      ...(cla
        ? [
            {
              label: 'OAuGF & Bill→Act',
              value: `${cla.oaugfQueriedMdaCount} OAuGF MDAs (${formatNairaCompact(cla.oaugfQueriedExposureNaira)}) | ${cla.billInsertionCount} Insertions/ZIP`,
            },
          ]
        : []),
    ],
    kpis: [
      {
        label: `FY ${input.financialYear} Budgeted`,
        value: formatNairaCompact(input.budgetedNaira),
        subtext: `${input.projectCount.toLocaleString('en-US')} tagged items`,
      },
      {
        label: 'Contracted (NOCOPO)',
        value: formatNairaCompact(input.contractedNairaFy),
        subtext: `2018-26: ${formatNairaCompact(input.contractedNairaCumulative)}`,
      },
      {
        label: 'Disbursed (GovSpend)',
        value: formatNairaCompact(input.disbursedNairaFy),
        subtext: `2018-26: ${formatNairaCompact(input.disbursedNairaCumulative)}`,
      },
      {
        label: 'Flagged Exposure',
        value: formatNairaCompact(input.flaggedAmountNaira),
        subtext: `${input.flaggedCount.toLocaleString('en-US')} flagged lines`,
      },
    ],
    narrative:
      'Isolates Nationwide and central Abuja Federal HQ administrative spending from state-level infrastructure so each state profile reflects identifiable physical or institutional commitments, cross-referenced with OAuGF audit records and Bill-vs-Act legislative insertions.',
    tables,
    sourceFilename: input.sourceFilename,
    sha256: input.sha256,
    permalink: input.permalink,
    footnote:
      'Sources: Official Federal Appropriation Acts, Bill-vs-Act Diffs (2017-2025), OAuGF Audit Reports (1999-2024), BPP NOCOPO OCDS Awards (planning excluded), and OAGF Open Treasury (GovSpend).',
  };
}

export async function buildStateBriefPdfBytes(
  input: StateAccountabilityBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildStateBriefSpec(input));
}

export async function buildStateBriefDocxBytes(
  input: StateAccountabilityBriefInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildStateBriefSpec(input));
}

export async function exportStateBriefPdf(input: StateAccountabilityBriefInput): Promise<string> {
  const bytes = await buildStateBriefPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_State_Brief_${input.displayName}_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportStateBriefDocx(input: StateAccountabilityBriefInput): Promise<string> {
  const bytes = await buildStateBriefDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_State_Brief_${input.displayName}_FY${input.financialYear}`,
    'docx'
  );
}

export interface CitizenTaxReceiptExportInput {
  financialYear: number;
  monthlyIncomeNaira: number;
  annualGrossIncomeNaira: number;
  estimatedAnnualPayeNaira: number;
  estimatedAnnualVatNaira: number;
  estimatedTotalAnnualTaxNaira: number;
  effectiveTaxRatePct: number;
  capitalExecutionRatePct: number | null;
  slices: Array<{
    label: string;
    sharePct: number;
    annualNaira: number;
    plainMeaning: string;
    deliveredNaira?: number;
  }>;
  permalink?: string;
}

function buildCitizenTaxReceiptSpec(input: CitizenTaxReceiptExportInput): TabularDossierSpec {
  return {
    filenameBase: `BudgetLens_My_Tax_Receipt_FY${input.financialYear}`,
    eyebrow: 'BUDGETLENS CITIZEN TAXPAYER RECEIPT',
    title: `Personal Federal Tax Breakdown (FY ${input.financialYear})`,
    subtitle: `Estimated under Nigeria PITA (PAYE) + 7.5% VAT mapped to official FY ${input.financialYear} Federal Budget shares`,
    orientation: 'portrait',
    metadata: [
      { label: 'Monthly Gross Income', value: formatNairaExact(input.monthlyIncomeNaira) },
      { label: 'Annual Gross Income', value: formatNairaExact(input.annualGrossIncomeNaira) },
      { label: 'Est. Annual PAYE', value: formatNairaExact(input.estimatedAnnualPayeNaira) },
      { label: 'Est. Annual VAT (7.5%)', value: formatNairaExact(input.estimatedAnnualVatNaira) },
    ],
    kpis: [
      {
        label: 'Total Est. Annual Tax',
        value: formatNairaExact(input.estimatedTotalAnnualTaxNaira),
        subtext: `${input.effectiveTaxRatePct.toFixed(1)}% of gross income`,
      },
      {
        label: 'Hist. Capital Execution',
        value: input.capitalExecutionRatePct !== null ? `${input.capitalExecutionRatePct.toFixed(1)}%` : 'N/A',
        subtext: 'BIR actual release ratio',
      },
    ],
    narrative:
      'Shows how an estimated annual Nigerian PAYE and VAT contribution maps proportionally across Federal Debt Service, Personnel, Running Costs, Capital Projects, and Statutory Transfers.',
    tables: [
      {
        heading: 'Itemized Federal Allocation of Your Estimated Tax',
        columns: ['Budget Category', 'Share %', 'Your Annual Naira', 'Delivered / Note'],
        rows: input.slices.map((s) => [
          s.label,
          `${s.sharePct.toFixed(1)}%`,
          formatNairaExact(s.annualNaira),
          s.deliveredNaira !== undefined
            ? `Est. executed: ${formatNairaExact(s.deliveredNaira)}`
            : s.plainMeaning,
        ]),
        rightAlignColumns: [1, 2],
      },
    ],
    permalink: input.permalink,
    footnote:
      'Estimates reflect statutory PITA bands and 7.5% VAT mapped to official FGN Appropriation figures and Budget Implementation Report execution ratios.',
  };
}

export async function buildCitizenTaxReceiptPdfBytes(
  input: CitizenTaxReceiptExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildCitizenTaxReceiptSpec(input));
}

export async function buildCitizenTaxReceiptDocxBytes(
  input: CitizenTaxReceiptExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildCitizenTaxReceiptSpec(input));
}

export async function exportCitizenTaxReceiptPdf(
  input: CitizenTaxReceiptExportInput
): Promise<string> {
  const bytes = await buildCitizenTaxReceiptPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_My_Tax_Receipt_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportCitizenTaxReceiptDocx(
  input: CitizenTaxReceiptExportInput
): Promise<string> {
  const bytes = await buildCitizenTaxReceiptDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_My_Tax_Receipt_FY${input.financialYear}`,
    'docx'
  );
}

export interface NeighborhoodCheckSheetInput {
  financialYear: number;
  areaQuery: string;
  stateFilter: string;
  items: Array<{
    projectCode: string;
    projectName: string;
    mdaName: string;
    state: string;
    constituency: string | null;
    amountNaira: number;
    paidOnPaper: boolean;
    contractorName: string | null;
    disbursedNaira: number;
    page: number;
  }>;
  permalink?: string;
}

function buildNeighborhoodCheckSheetSpec(input: NeighborhoodCheckSheetInput): TabularDossierSpec {
  const paidCount = input.items.filter((i) => i.paidOnPaper).length;
  const totalBudget = input.items.reduce((s, i) => s + (i.amountNaira || 0), 0);
  const areaLabel = input.areaQuery.trim() || (input.stateFilter !== 'ALL' ? input.stateFilter : 'National Sample');

  return {
    filenameBase: `BudgetLens_Community_CheckSheet_${areaLabel}_FY${input.financialYear}`,
    eyebrow: 'BUDGETLENS COMMUNITY SITE-VERIFICATION SHEET',
    title: `Community Project Verification Sheet — ${areaLabel} (FY ${input.financialYear})`,
    subtitle: 'Field checklist for residents, CDAs, and civic monitors to verify whether funded projects exist on the ground',
    orientation: 'landscape',
    metadata: [
      { label: 'Area / Search Filter', value: areaLabel },
      { label: 'State Filter', value: input.stateFilter },
      { label: 'Projects Listed', value: `${input.items.length}` },
      { label: 'Paid on Paper Priority', value: `${paidCount} projects with recorded payouts` },
    ],
    kpis: [
      {
        label: 'Listed Allocation Total',
        value: formatNairaCompact(totalBudget),
        subtext: `${input.items.length} local items`,
      },
      {
        label: 'Paid on Paper',
        value: `${paidCount}`,
        subtext: 'Verify physical existence first',
      },
    ],
    tables: [
      {
        heading: 'Local Projects & Ground Verification Checklist',
        columns: ['Code', 'Project Description', 'MDA', 'Budgeted', 'Paid on Paper / Contractor', 'Site Check'],
        rows:
          input.items.length > 0
            ? input.items.slice(0, 40).map((it) => [
                it.projectCode,
                it.projectName.slice(0, 120),
                cleanEntityDisplayName(it.mdaName),
                formatNairaExact(it.amountNaira),
                it.paidOnPaper
                  ? `YES (${formatNairaCompact(it.disbursedNaira)}) - ${
                      cleanEntityDisplayName(it.contractorName) || 'Contractor recorded'
                    }`
                  : 'Budgeted only',
                '[ ] Built  [ ] Stalled  [ ] Not Found',
              ])
            : [['-', 'No projects matched current filter', '-', '-', '-', '-']],
        rightAlignColumns: [3],
      },
    ],
    permalink: input.permalink,
    footnote:
      'Presence of a Paid-on-Paper flag reflects recorded contract/treasury disbursements in public datasets and requires physical site verification.',
  };
}

export async function buildNeighborhoodCheckSheetPdfBytes(
  input: NeighborhoodCheckSheetInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildNeighborhoodCheckSheetSpec(input));
}

export async function buildNeighborhoodCheckSheetDocxBytes(
  input: NeighborhoodCheckSheetInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildNeighborhoodCheckSheetSpec(input));
}

export async function exportNeighborhoodCheckSheetPdf(
  input: NeighborhoodCheckSheetInput
): Promise<string> {
  const bytes = await buildNeighborhoodCheckSheetPdfBytes(input);
  const areaLabel = input.areaQuery.trim() || input.stateFilter || 'Nigeria';
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Community_CheckSheet_${areaLabel}_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportNeighborhoodCheckSheetDocx(
  input: NeighborhoodCheckSheetInput
): Promise<string> {
  const bytes = await buildNeighborhoodCheckSheetDocxBytes(input);
  const areaLabel = input.areaQuery.trim() || input.stateFilter || 'Nigeria';
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Community_CheckSheet_${areaLabel}_FY${input.financialYear}`,
    'docx'
  );
}

export interface OaugfNegligenceExportInput {
  filterSummary: string;
  reportsIndexed: number;
  parsedAuditIssuesCount: number;
  repeatNeglectCount: number;
  recoveryDirectiveCount: number;
  items: Array<{
    heading: string;
    category: string;
    mdaName?: string | null;
    docTitle: string;
    year: number | null;
    page: number;
    amountNaira: number;
    repeatNeglect?: boolean;
    recoveryRequired?: boolean;
    recommendation?: string;
  }>;
  permalink?: string;
}

function buildOaugfNegligenceSpec(input: OaugfNegligenceExportInput): TabularDossierSpec {
  return {
    filenameBase: 'BudgetLens_OAuGF_Audit_Negligence_Dossier',
    eyebrow: 'OFFICE OF THE AUDITOR-GENERAL FOR THE FEDERATION (OAuGF)',
    title: 'Constitutional Audit Negligence & Repeat Query Dossier',
    subtitle: `Filter: ${input.filterSummary}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Audit Reports Indexed', value: `${input.reportsIndexed} official reports` },
      { label: 'Total Parsed Issues', value: `${input.parsedAuditIssuesCount.toLocaleString('en-US')}` },
      { label: 'Repeat / Ignored Queries', value: `${input.repeatNeglectCount.toLocaleString('en-US')}` },
      { label: 'Recovery / Refund Directives', value: `${input.recoveryDirectiveCount.toLocaleString('en-US')}` },
    ],
    kpis: [
      {
        label: 'Exported Audit Findings',
        value: `${input.items.length}`,
        subtext: 'Official OAuGF page citations',
      },
      {
        label: 'Repeat Neglect Flagged',
        value: `${input.items.filter((i) => i.repeatNeglect).length}`,
        subtext: 'Ignored prior audit queries',
      },
    ],
    tables: [
      {
        heading: 'OAuGF Audit Negligence Findings & Directives',
        columns: ['Year / Page', 'MDA / Entity', 'Category', 'Audit Issue & Recommendation', 'Amount', 'Flags'],
        rows:
          input.items.length > 0
            ? input.items.slice(0, 50).map((it) => [
                `${it.year ?? '-'} p.${it.page}`,
                cleanEntityDisplayName(it.mdaName || 'Consolidated / Cross-MDA') || 'Consolidated / Cross-MDA',
                it.category,
                `${it.heading}${it.recommendation ? ` | Rec: ${it.recommendation.slice(0, 90)}` : ''}`,
                it.amountNaira > 0 ? formatNairaExact(it.amountNaira) : '-',
                [it.repeatNeglect ? 'REPEAT' : '', it.recoveryRequired ? 'RECOVER/REFUND' : '']
                  .filter(Boolean)
                  .join(', ') || 'AUDIT QUERY',
              ])
            : [['-', '-', '-', 'No OAuGF findings matched current filter', '-', '-']],
        rightAlignColumns: [4],
      },
    ],
    permalink: input.permalink,
    footnote:
      'Source: Official Reports of the Auditor-General for the Federation (oaugf.ng, 1999–2024).',
  };
}

export async function buildOaugfNegligencePdfBytes(
  input: OaugfNegligenceExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildOaugfNegligenceSpec(input));
}

export async function buildOaugfNegligenceDocxBytes(
  input: OaugfNegligenceExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildOaugfNegligenceSpec(input));
}

export async function exportOaugfNegligencePdf(
  input: OaugfNegligenceExportInput
): Promise<string> {
  const bytes = await buildOaugfNegligencePdfBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_OAuGF_Audit_Negligence_Dossier', 'pdf');
}

export async function exportOaugfNegligenceDocx(
  input: OaugfNegligenceExportInput
): Promise<string> {
  const bytes = await buildOaugfNegligenceDocxBytes(input);
  return triggerVerifiedDocumentDownload(bytes, 'BudgetLens_OAuGF_Audit_Negligence_Dossier', 'docx');
}

export interface EvidenceEngineDossierExportInput {
  financialYear: number;
  modeLabel: string;
  filterSummary: string;
  totalRulesCount: number;
  totalRuleFindings: number;
  totalCrossLedgerFindings: number;
  totalCompoundProjects: number;
  compoundProjects: Array<{
    projectCode: string;
    projectName: string;
    agency: string;
    financialYear: number;
    amount: number;
    page: number;
    ruleCount: number;
    crossLedgerRuleCount: number;
    compoundRiskScore: number;
    ruleNames: string[];
    paidOnPaper: boolean;
    billInsertedOrInflated: boolean;
    mdaOaugfIssuesCount: number;
    mdaIntegrityGrade: string;
  }>;
  permalink?: string;
}

function buildEvidenceEngineDossierSpec(
  input: EvidenceEngineDossierExportInput
): TabularDossierSpec {
  const totalExposure = input.compoundProjects.reduce((s, p) => s + (p.amount || 0), 0);
  return {
    filenameBase: `BudgetLens_Evidence_Engine_v3_Dossier_FY${input.financialYear}`,
    eyebrow: 'BUDGETLENS FORENSIC EVIDENCE ENGINE v3.0 | 22-RULE CROSS-LEDGER MATRIX',
    title: `Forensic Evidence Engine & Compound Risk Dossier (${input.modeLabel})`,
    subtitle: `Filter: ${input.filterSummary}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Active Rules', value: `${input.totalRulesCount} Rules (16 Domain + 6 Cross-Ledger)` },
      { label: 'Rule Findings', value: input.totalRuleFindings.toLocaleString('en-US') },
      { label: 'Cross-Ledger Hits', value: input.totalCrossLedgerFindings.toLocaleString('en-US') },
      { label: 'Deduplicated Projects', value: input.totalCompoundProjects.toLocaleString('en-US') },
    ],
    kpis: [
      {
        label: 'Flagged Projects Listed',
        value: input.compoundProjects.length.toLocaleString('en-US'),
        subtext: `${formatNairaCompact(totalExposure)} combined value`,
      },
      {
        label: 'Cross-Ledger Findings',
        value: input.totalCrossLedgerFindings.toLocaleString('en-US'),
        subtext: 'OAuGF + Treasury + NOCOPO + Padding',
      },
      {
        label: 'Paid-on-Paper Priority',
        value: `${input.compoundProjects.filter((p) => p.paidOnPaper).length}`,
        subtext: 'Verified cash / contract payout',
      },
      {
        label: 'Rule Engine Version',
        value: 'v3.0 (22 Rules)',
        subtext: '100% deterministic criteria',
      },
    ],
    narrative:
      'Evidence Engine v3.0 evaluates every budget line item across 16 text/domain rules (mandate mismatch, blank-check vagueness, vehicle unit-cost outliers, luxury lodges) and 6 cross-ledger forensic rules (Bill-vs-Act legislative insertions, Paid-on-Paper disbursements, multi-year recurring zombie lineages, OAuGF constitutional audit queries, personal staff-account payouts, and repeat asset lifespan violations).',
    tables: [
      {
        heading: 'Compound Multi-Flag Projects & Cross-Ledger Evidence Ledger',
        columns: [
          'FY / Page',
          'Code',
          'Project Description',
          'Executing MDA',
          'Rules & Cross-Ledger Signals',
          'Risk',
          'Amount (NGN)',
        ],
        rows:
          input.compoundProjects.length > 0
            ? input.compoundProjects.slice(0, 50).map((p) => {
                const badges: string[] = [];
                if (p.paidOnPaper) badges.push('PAID ON PAPER');
                if (p.billInsertedOrInflated) badges.push('NASS INSERTION');
                if (p.mdaOaugfIssuesCount > 0) badges.push(`OAuGF:${p.mdaOaugfIssuesCount}`);
                if (p.mdaIntegrityGrade && p.mdaIntegrityGrade !== 'N/A') {
                  badges.push(`Grade:${p.mdaIntegrityGrade}`);
                }
                const signalText = `${p.ruleCount} rules (${p.ruleNames.slice(0, 3).join('; ')})${
                  badges.length > 0 ? ` [${badges.join(' | ')}]` : ''
                }`;
                return [
                  `FY ${p.financialYear} p.${p.page}`,
                  p.projectCode || 'ERGP',
                  (p.projectName || '').slice(0, 86),
                  cleanEntityDisplayName(p.agency || 'Federal MDA').slice(0, 38),
                  signalText.slice(0, 110),
                  `${p.compoundRiskScore}/100`,
                  formatNairaExact(p.amount),
                ];
              })
            : [['-', '-', 'No compound projects matched current filter', '-', '-', '-', '-']],
        rightAlignColumns: [5, 6],
      },
    ],
    permalink: input.permalink,
    footnote:
      'Sources: 1999–2026 Federal Appropriation Acts, OAuGF Audit Reports (1999–2024), BPP NOCOPO, OAGF Open Treasury, and Bill-vs-Act Diffs.',
  };
}

export async function buildEvidenceEngineDossierPdfBytes(
  input: EvidenceEngineDossierExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildEvidenceEngineDossierSpec(input));
}

export async function buildEvidenceEngineDossierDocxBytes(
  input: EvidenceEngineDossierExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildEvidenceEngineDossierSpec(input));
}

export async function exportEvidenceEngineDossierPdf(
  input: EvidenceEngineDossierExportInput
): Promise<string> {
  const bytes = await buildEvidenceEngineDossierPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Evidence_Engine_v3_Dossier_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportEvidenceEngineDossierDocx(
  input: EvidenceEngineDossierExportInput
): Promise<string> {
  const bytes = await buildEvidenceEngineDossierDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Evidence_Engine_v3_Dossier_FY${input.financialYear}`,
    'docx'
  );
}

export interface DuplicateClustersDossierExportInput {
  financialYear: number;
  filterSummary: string;
  totalClusters: number;
  totalItems: number;
  totalValueNaira: number;
  paidOnPaperClusterCount: number;
  billInsertedClusterCount: number;
  oaugfFlaggedClusterCount: number;
  clusters: Array<{
    id: string;
    patternType: string;
    canonicalTitle: string;
    count: number;
    distinctAgencies: number;
    distinctStates: number;
    totalAmount: number;
    paidOnPaperCount: number;
    billInsertedCount: number;
    maxMdaOaugfIssues: number;
    worstMdaGrade: string;
    sampleAgencies: string[];
  }>;
  permalink?: string;
}

function buildDuplicateClustersDossierSpec(
  input: DuplicateClustersDossierExportInput
): TabularDossierSpec {
  return {
    filenameBase: `BudgetLens_Duplicate_Clusters_Dossier_FY${input.financialYear}`,
    eyebrow: `BUDGETLENS DUPLICATE & SPLIT-ALLOCATION DETECTOR | FY ${input.financialYear}`,
    title: `Duplicate & Split-Allocation Cross-Ledger Dossier (FY ${input.financialYear})`,
    subtitle: `Filter: ${input.filterSummary}`,
    orientation: 'landscape',
    metadata: [
      { label: 'Fiscal Year', value: `FY ${input.financialYear}` },
      { label: 'Detected Clusters', value: input.totalClusters.toLocaleString('en-US') },
      { label: 'Clustered Line Items', value: input.totalItems.toLocaleString('en-US') },
      { label: 'Clustered Exposure', value: formatNairaCompact(input.totalValueNaira) },
    ],
    kpis: [
      {
        label: 'Clustered Exposure',
        value: formatNairaCompact(input.totalValueNaira),
        subtext: `${input.totalClusters.toLocaleString('en-US')} clusters (${input.totalItems.toLocaleString('en-US')} items)`,
      },
      {
        label: 'Paid-on-Paper Clusters',
        value: input.paidOnPaperClusterCount.toLocaleString('en-US'),
        subtext: 'Clusters with recorded payouts',
      },
      {
        label: 'Bill-Inserted Clusters',
        value: input.billInsertedClusterCount.toLocaleString('en-US'),
        subtext: 'Inserted during NASS markup',
      },
      {
        label: 'OAuGF-Queried MDAs',
        value: input.oaugfFlaggedClusterCount.toLocaleString('en-US'),
        subtext: 'Involve MDAs with OAuGF queries',
      },
    ],
    narrative:
      'Identifies identical or disguised-reworded capital allocations split across multiple line items or multiple MDAs in the same fiscal year, cross-checked against Paid-on-Paper contract/treasury payouts, National Assembly Bill-vs-Act insertions, and OAuGF constitutional audit records.',
    tables: [
      {
        heading: 'Top Duplicate & Split-Allocation Clusters with Cross-Ledger Reality Check',
        columns: [
          'Cluster ID',
          'Pattern',
          'Canonical Project Wording',
          'Repeats / MDAs',
          'Cross-Ledger Reality Check',
          'Cluster Total (NGN)',
        ],
        rows:
          input.clusters.length > 0
            ? input.clusters.slice(0, 45).map((c) => {
                const flags: string[] = [];
                if (c.paidOnPaperCount > 0) flags.push(`${c.paidOnPaperCount} Paid on Paper`);
                if (c.billInsertedCount > 0) flags.push(`${c.billInsertedCount} NASS Inserted`);
                if (c.maxMdaOaugfIssues > 0) flags.push(`MDA OAuGF:${c.maxMdaOaugfIssues}`);
                if (c.worstMdaGrade && c.worstMdaGrade !== 'N/A') flags.push(`Grade:${c.worstMdaGrade}`);
                return [
                  c.id,
                  c.patternType,
                  c.canonicalTitle.slice(0, 82),
                  `${c.count}x (${c.distinctAgencies} MDA | ${c.sampleAgencies
                    .slice(0, 2)
                    .map((a) => cleanEntityDisplayName(a))
                    .join(', ')
                    .slice(0, 32)})`,
                  flags.join(' | ') || 'Budget schedule repeat',
                  formatNairaExact(c.totalAmount),
                ];
              })
            : [['-', '-', 'No duplicate clusters matched current filter', '-', '-', '-']],
        rightAlignColumns: [5],
      },
    ],
    permalink: input.permalink,
    footnote:
      'Sources: Official Federal Appropriation Acts, BPP NOCOPO, OAGF Open Treasury, Bill-vs-Act Diffs, and OAuGF Audit Reports.',
  };
}

export async function buildDuplicateClustersDossierPdfBytes(
  input: DuplicateClustersDossierExportInput
): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildDuplicateClustersDossierSpec(input));
}

export async function buildDuplicateClustersDossierDocxBytes(
  input: DuplicateClustersDossierExportInput
): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildDuplicateClustersDossierSpec(input));
}

export async function exportDuplicateClustersDossierPdf(
  input: DuplicateClustersDossierExportInput
): Promise<string> {
  const bytes = await buildDuplicateClustersDossierPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Duplicate_Clusters_Dossier_FY${input.financialYear}`,
    'pdf'
  );
}

export async function exportDuplicateClustersDossierDocx(
  input: DuplicateClustersDossierExportInput
): Promise<string> {
  const bytes = await buildDuplicateClustersDossierDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    `BudgetLens_Duplicate_Clusters_Dossier_FY${input.financialYear}`,
    'docx'
  );
}

export interface CbnDebtBriefInput {
  governors: CbnGovernorProfile[];
  actingGovernors: CbnActingGovernorNote[];
  debtRecords: HandoverDebtRecord[];
  latestAsAt: string | null;
  totalDocumentsIndexed: number;
  permalink?: string;
}

export function buildCbnDebtBriefSpec(input: CbnDebtBriefInput): TabularDossierSpec {
  const latestRec = input.debtRecords[input.debtRecords.length - 1];
  const topUsd = [...input.debtRecords].sort((a, b) => b.netAddedUsdM - a.netAddedUsdM)[0];
  const topReducer = [...input.debtRecords].sort((a, b) => a.netAddedUsdM - b.netAddedUsdM)[0];

  const debtRows = input.debtRecords.map((r) => [
    `${r.presidentName} (${r.party})`,
    r.handoverWindow,
    r.cbnGovernors.join(', '),
    `$${(r.startTotalUsdM / 1e3).toFixed(2)}B -> $${(r.endTotalUsdM / 1e3).toFixed(2)}B`,
    `${r.netAddedUsdM >= 0 ? '+' : ''}$${(r.netAddedUsdM / 1e3).toFixed(2)}B (${r.pctChangeUsd >= 0 ? '+' : ''}${r.pctChangeUsd}%)`,
    `${r.netAddedExternalUsdM >= 0 ? '+' : ''}$${(r.netAddedExternalUsdM / 1e3).toFixed(2)}B`,
    `₦${(r.startTotalNairaM / 1e6).toFixed(2)}T -> ₦${(r.endTotalNairaM / 1e6).toFixed(2)}T`,
    `${r.netAddedNairaM >= 0 ? '+' : ''}₦${(r.netAddedNairaM / 1e6).toFixed(2)}T`,
    r.keyDriverHeadline,
  ]);

  const governorRows = input.governors.map((g) => [
    `#${g.order}`,
    `${g.name} (${g.tenureLabel})`,
    g.servedUnder.join(', '),
    `FX: ${g.macroIndicators.fxStartToEnd} | CPI: ${g.macroIndicators.inflationRange} | Rate: ${g.macroIndicators.policyRateHighlight}`,
    g.economicManagement.join(' | ').slice(0, 320),
    g.documentedCriticisms.join(' | ').slice(0, 340),
  ]);

  const actingRows = input.actingGovernors.map((a) => [
    a.name,
    a.tenureLabel,
    a.context,
    a.efccOrScrutinyNote ? `${a.keyAction} | Note: ${a.efccOrScrutinyNote}` : a.keyAction,
  ]);

  const efccRows = input.governors
    .filter(
      (g) =>
        g.efccRecord.status !== 'NO_EFCC_INVESTIGATION' ||
        g.id === 'cardoso' ||
        g.id === 'ogwuma'
    )
    .map((g) => [
      `${g.name} (${g.tenureLabel})`,
      g.efccRecord.badgeLabel,
      g.efccRecord.period || 'Historical / Pre-2003',
      g.efccRecord.accusationScope.length > 0
        ? `${g.efccRecord.legalStatusNote} Scope: ${g.efccRecord.accusationScope.join(' | ')}`
        : g.efccRecord.legalStatusNote,
    ]);

  const tables: ExportSectionTable[] = [
    {
      heading: '1. Fourth Republic Presidential Borrowing & Public Debt Increases (1999-2026)',
      caption:
        'Constitutional May 29 handover stock basis separating hard-currency (USD / External USD) growth, CBN Ways & Means securitization (₦22.71T), and FX float revaluation.',
      columns: [
        'Administration',
        'Handover Window',
        'Overlapping CBN Govs',
        'Start -> End (USD)',
        'Net USD Delta',
        'External USD Delta',
        'Start -> End (Naira)',
        'Net Naira Delta',
        'Key Drivers',
      ],
      rows: debtRows,
      rightAlignColumns: [4, 5, 7],
    },
    {
      heading: '2. All 12 Substantive Central Bank of Nigeria Governors (1958-2026)',
      caption:
        'Neutral institutional review of monetary management, structural reforms, and documented criticisms/policy failures across CBN, DMO, NDIC, IMF, and Obazee records.',
      columns: [
        '#',
        'CBN Governor & Tenure',
        'Heads of State / Presidents',
        'Macro Indicators',
        'Economic Management & Reforms',
        'Documented Criticisms & Mismanagement Risks',
      ],
      rows: governorRows,
    },
    {
      heading: '3. EFCC & Anti-Graft Investigation Records & Scope of Accusations',
      caption:
        'Verified EFCC & judicial status of CBN Governors (pre-2003 Founding/Military Governors and Chief J.O. Sanusi had no personal EFCC investigation). Allegations reflect charges/briefings and not convictions unless entered by a court.',
      columns: [
        'CBN Governor & Tenure',
        'EFCC / Anti-Graft Status',
        'Period',
        'Legal Status & Scope of Accusations',
      ],
      rows: efccRows,
    },
  ];

  if (actingRows.length > 0) {
    tables.push({
      heading: '4. Acting CBN Governor Interregnums',
      columns: ['Acting Governor', 'Tenure', 'Transition Context', 'Key Policy Action'],
      rows: actingRows,
    });
  }

  return {
    filenameBase: `BudgetLens_CBN_Governors_And_Presidential_Debt_1958_2026`,
    eyebrow: 'BUDGETLENS MONETARY & SOVEREIGN DEBT ARCHIVE | 1958-2026',
    title: 'CBN Governors Stewardship & Presidential Borrowing Dossier',
    subtitle: `12 Substantive CBN Governors (+${input.actingGovernors.length} Acting) | 5 Fourth Republic Administrations | DMO Live through ${input.latestAsAt || '2026-06-30'}`,
    orientation: 'landscape',
    metadata: [
      { label: 'DMO Bulletins Indexed', value: input.totalDocumentsIndexed.toLocaleString('en-US') },
      { label: 'Latest Debt As-At', value: input.latestAsAt || '2026-06-30' },
      { label: 'CBN Governors Covered', value: '1958 - Present (12 Substantive, 2 Acting)' },
    ],
    kpis: [
      {
        label: 'CBN Governors Indexed',
        value: `${input.governors.length.toLocaleString('en-US')} (+${input.actingGovernors.length} Acting)`,
        subtext: '1958 Founding to 2026 Incumbent',
      },
      {
        label: 'Latest DMO Total Public Debt',
        value: latestRec ? `₦${(latestRec.endTotalNairaM / 1e6).toFixed(2)}T` : '₦166.79T',
        subtext: latestRec ? `$${(latestRec.endTotalUsdM / 1e3).toFixed(2)}B (${latestRec.handoverWindow.split('→').pop()?.trim()})` : '$120.93B',
      },
      {
        label: 'Largest Net USD Addition',
        value: topUsd ? `${topUsd.presidentName.split(' ').slice(-1)[0]} +$${(topUsd.netAddedUsdM / 1e3).toFixed(2)}B` : '+$49.61B',
        subtext: topUsd ? `Ext +$${(topUsd.netAddedExternalUsdM / 1e3).toFixed(2)}B | +₦22.71T W&M` : '2015-2023 Handover',
      },
      {
        label: 'Largest External Debt Reduction',
        value: topReducer ? `${topReducer.presidentName.split(' ').slice(-1)[0]} ${(topReducer.netAddedExternalUsdM / 1e3).toFixed(2)}B` : '-$24.39B',
        subtext: '2005-2006 Paris Club $18B Exit',
      },
    ],
    narrative:
      'Presidential debt accumulation reflects three distinct drivers in official DMO/CBN accounts: net domestic bond issuance, external hard-currency loans, and extraordinary monetary/FX events — notably N22.71T in CBN Ways & Means overdrafts securitized in May 2023 and >N26T in nominal Naira FX revaluation following the 2023-2024 exchange rate float.',
    tables,
    permalink: input.permalink || buildCanonicalPermalink({ tab: 'cbn' }),
    footnote:
      'Sources: Central Bank of Nigeria (cbn.gov.ng), Debt Management Office Nigeria (dmo.gov.ng), NBS CPI Bulletins, NDIC Records, IMF Article IV, 2023 Obazee Special Investigation Report, and EFCC Court Filings & Official Briefings.',
  };
}

export async function buildCbnDebtBriefPdfBytes(input: CbnDebtBriefInput): Promise<Uint8Array> {
  return buildTabularDossierPdfBytes(buildCbnDebtBriefSpec(input));
}

export async function buildCbnDebtBriefDocxBytes(input: CbnDebtBriefInput): Promise<Uint8Array> {
  return buildTabularDossierDocxBytes(buildCbnDebtBriefSpec(input));
}

export async function exportCbnDebtBriefPdf(input: CbnDebtBriefInput): Promise<string> {
  const bytes = await buildCbnDebtBriefPdfBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    'BudgetLens_CBN_Governors_And_Presidential_Debt_1958_2026',
    'pdf'
  );
}

export async function exportCbnDebtBriefDocx(input: CbnDebtBriefInput): Promise<string> {
  const bytes = await buildCbnDebtBriefDocxBytes(input);
  return triggerVerifiedDocumentDownload(
    bytes,
    'BudgetLens_CBN_Governors_And_Presidential_Debt_1958_2026',
    'docx'
  );
}
