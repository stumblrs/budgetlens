import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  readAppUrlState,
  readScrutinyUrlState,
  buildCanonicalPermalink,
  syncUrlParams,
} from '../../src/utils/urlState';

describe('urlState deep permalink helpers', () => {
  it('parses valid tab, year, item, page, and search query from URL search string', () => {
    const state = readAppUrlState('?tab=scrutiny&year=2024&item=ERGP99123&page=412&q=Solar%20Light');
    expect(state).toEqual({
      tab: 'scrutiny',
      year: 2024,
      item: 'ERGP99123',
      page: 412,
      q: 'Solar Light',
    });
  });

  it('falls back safely on unknown tabs, out-of-range years, and invalid page numbers', () => {
    const state = readAppUrlState('?tab=unknown_view&year=1960&page=-5');
    expect(state).toEqual({
      tab: 'overview',
      year: null,
      item: null,
      page: null,
      q: '',
    });
  });

  it('parses scrutiny sub-filters cleanly with safe defaults', () => {
    const valid = readScrutinyUrlState('?president=JONATHAN&pillar=blankChecks&sy=2013&currency=nominal&sq=palace');
    expect(valid).toEqual({
      president: 'jonathan',
      pillar: 'blankChecks',
      sy: 2013,
      currency: 'nominal',
      sq: 'palace',
    });

    const invalid = readScrutinyUrlState('?president=bogus&pillar=none&sy=1800&currency=eur');
    expect(invalid).toEqual({
      president: 'ALL',
      pillar: 'vehicles',
      sy: 'ALL',
      currency: 'usd',
      sq: '',
    });
  });

  it('synchronizes query params and builds canonical permalinks cleanly', () => {
    window.history.replaceState(null, '', '/');
    syncUrlParams({ tab: 'compare', year: 2011, q: null }, 'replace');
    const url = buildCanonicalPermalink({ item: 'ERGP55', page: 9 });
    expect(url).toContain('tab=compare');
    expect(url).toContain('year=2011');
    expect(url).toContain('item=ERGP55');
    expect(url).toContain('page=9');
    expect(url).not.toContain('q=');
  });

  it('aliases retired Anomaly Heatmap tab (?tab=anomalies) to unified map tab and removes duplicate sidebar entry', () => {
    expect(readAppUrlState('?tab=anomalies&year=2025').tab).toBe('map');
    expect(readAppUrlState('?tab=cbn&year=2025').tab).toBe('cbn');
    expect(readAppUrlState('?tab=governors').tab).toBe('cbn');
    expect(readAppUrlState('?tab=debt').tab).toBe('cbn');
    const sidebarPath = path.resolve(__dirname, '../../src/components/Sidebar.tsx');
    const sidebarText = fs.readFileSync(sidebarPath, 'utf-8');
    expect(sidebarText).not.toMatch(/Anomaly Heatmap/);
    expect(sidebarText).toMatch(/Geo & Anomaly Map/);
    expect(sidebarText).toMatch(/CBN & Debt Ledger/);
  });

  it('gracefully falls back retired SQL Explorer routes (?tab=sql|explorer|export) to overview and enforces zero UI references', () => {
    expect(readAppUrlState('?tab=sql&year=2025').tab).toBe('overview');
    expect(readAppUrlState('?tab=explorer&year=2025').tab).toBe('overview');
    expect(readAppUrlState('?tab=export&year=2025').tab).toBe('overview');

    const srcRoot = path.resolve(__dirname, '../../src');
    expect(fs.existsSync(path.join(srcRoot, 'components/SqlDataExplorer.tsx'))).toBe(false);

    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });

    const targets = [...walk(srcRoot), path.resolve(__dirname, '../../index.html')];
    for (const file of targets) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/SqlDataExplorer|SQL Explorer|SQL Data Explorer/i);
    }
  });
});
