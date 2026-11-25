import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'ios-390', width: 390, height: 844 },
  { name: 'android-360', width: 360, height: 800 },
];

const CORE_TABS = ['overview', 'cbn', 'projects', 'citizen', 'agencies', 'forensics', 'ai'];

test.describe('BudgetLens Civic Fiscal Observatory E2E Smoke Suite', () => {
  test('renders cleanly with zero console/page errors and zero horizontal overflow across 4 viewports (1440px, 1024px, 390px, 360px)', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        // Ignore optional backend /api/tips or /api/ai connection refused when static preview runs standalone
        if (!txt.includes('127.0.0.1:8000') && !txt.includes('Failed to fetch') && !txt.includes('ERR_CONNECTION_REFUSED')) {
          errors.push(`console.error: ${txt}`);
        }
      }
    });

    for (const tab of CORE_TABS) {
      await page.goto(`/?tab=${tab}&year=2025`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#root')).not.toBeEmpty();
      await page.waitForTimeout(350);

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(200);

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
          };
        });
        expect(
          overflow.scrollWidth,
          `Horizontal overflow detected at ${vp.name} (tab=${tab}): ${overflow.scrollWidth} > ${overflow.clientWidth}`
        ).toBeLessThanOrEqual(overflow.clientWidth + 2);
      }
    }

    expect(errors).toEqual([]);
  });

  test('verifies mobile bottom navigation, search modal, and fiscal year bottom-sheet on 390px iOS & 360px Android viewports', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Confirm mobile bottom nav stays hidden on desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?tab=overview&year=2025', { waitUntil: 'domcontentloaded' });
    const mobileNav = page.getByRole('navigation', { name: 'Mobile Primary Navigation' });
    await expect(mobileNav).toBeHidden();

    for (const mobileVp of [
      { name: 'ios-390', width: 390, height: 844 },
      { name: 'android-360', width: 360, height: 800 },
    ]) {
      await page.setViewportSize({ width: mobileVp.width, height: mobileVp.height });
      await page.goto('/?tab=overview&year=2025', { waitUntil: 'domcontentloaded' });
      await expect(mobileNav).toBeVisible();

      const navButtons = [
        { roleName: 'Projects', exact: true },
        { roleName: 'Citizen', exact: true },
        { roleName: 'Forensics', exact: true },
        { roleName: 'Overview', exact: true },
      ];
      await expect(page.getByRole('button', { name: 'Open full navigation menu' })).toBeVisible();

      for (const btnSpec of navButtons) {
        const btn = mobileNav.getByRole('button', { name: btnSpec.roleName, exact: btnSpec.exact });
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(btn).toHaveAttribute('aria-current', 'page');
        await page.waitForTimeout(250);

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          overflow.scrollWidth,
          `Mobile overflow at ${mobileVp.name} after clicking ${btnSpec.roleName}`
        ).toBeLessThanOrEqual(overflow.clientWidth + 2);
      }

      // Open & close Universal Search Modal
      const searchBtn = page.getByRole('button', { name: 'Search MDAs, codes, and projects' });
      await expect(searchBtn).toBeVisible();
      await searchBtn.click();
      const searchDialog = page.getByRole('dialog', { name: 'Universal Budget Search' });
      await expect(searchDialog).toBeVisible();
      await page.getByRole('button', { name: 'Close search' }).click();
      await expect(searchDialog).toBeHidden();

      // Open & close Fiscal Year / Coverage Bottom-Sheet
      const yearSheetTrigger = page.locator('header.app-topbar button[title*="Presidential Compare"]');
      await expect(yearSheetTrigger).toBeVisible();
      await yearSheetTrigger.click();
      const scopeMenu = page.getByRole('menu', { name: 'Fiscal Scope Selector' });
      await expect(scopeMenu).toBeVisible();
      await expect(scopeMenu.getByText('Summary Act')).toBeVisible();
      await page.getByRole('button', { name: 'Close fiscal year selector' }).click();
      await expect(scopeMenu).toBeHidden();
    }

    expect(pageErrors).toEqual([]);
  });

  test('navigates deep permalinks (?tab=scrutiny, forensics, padding, record, casebook) cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const tabRoutes = ['scrutiny', 'forensics', 'padding', 'casebook', 'execution', 'ai'];
    for (const tab of tabRoutes) {
      await page.goto(`/?tab=${tab}&year=2025`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#root')).not.toBeEmpty();
      await page.waitForTimeout(300);
    }

    // Direct Record Dossier route
    await page.goto('/?tab=record&year=2025&id=2025-sample-1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toBeEmpty();

    // Direct CBN Governors & Presidential Debt route (verify portraits load cleanly)
    await page.goto('/?tab=cbn&year=2025', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Presidential Borrowing & Sovereign Debt Increases/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /All 12 Central Bank of Nigeria Governors/i })).toBeVisible({ timeout: 15_000 });
    const loadedGovPortraits = await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img[src^="/governors/"]')) as HTMLImageElement[];
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.addEventListener('load', () => res(), { once: true });
                img.addEventListener('error', () => res(), { once: true });
                setTimeout(res, 5000);
              })
        )
      );
      return imgs.map((img) => ({ src: img.getAttribute('src'), naturalWidth: img.naturalWidth }));
    });
    expect(loadedGovPortraits.length).toBeGreaterThanOrEqual(12);
    expect(loadedGovPortraits.every((p) => p.naturalWidth > 0)).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('verifies Casebook pinning, Casebook Studio PDF/DOCX exports, and AI Assistant Duplicate Hunter', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    // 1. Open Bill vs Act Padding Diff (2025) and pin an item to the Investigator Casebook
    await page.goto('/?tab=padding&year=2025', { waitUntil: 'domcontentloaded' });
    const pinBtn = page.getByTitle('Pin diff to Investigator Casebook').first();
    await expect(pinBtn).toBeVisible({ timeout: 25_000 });
    await pinBtn.click();

    // 2. Open Casebook Studio and verify both PDF & DOCX exports succeed unconditionally
    await page.goto('/?tab=casebook', { waitUntil: 'domcontentloaded' });
    const pdfButton = page.getByRole('button', { name: /Export Casebook Dossier \(PDF\)/i });
    const docxButton = page.getByRole('button', { name: /Export Casebook Dossier \(DOCX\)/i });
    await expect(pdfButton).toBeEnabled({ timeout: 15_000 });
    await expect(docxButton).toBeEnabled({ timeout: 15_000 });

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      pdfButton.click(),
    ]);
    expect(pdfDownload.suggestedFilename().toLowerCase()).toMatch(/\.pdf$/);

    const [docxDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      docxButton.click(),
    ]);
    expect(docxDownload.suggestedFilename().toLowerCase()).toMatch(/\.docx$/);

    // 3. Test AI Assistant Duplicate Hunter in browser (wait for 2025/2024 JSON partitions to hydrate)
    await page.goto('/?tab=ai&year=2025', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/28 Yrs Live/i)).toBeVisible({ timeout: 60_000 });

    const aiInput = page.getByPlaceholder('Ask me anything...');
    await expect(aiInput).toBeVisible({ timeout: 10_000 });
    await aiInput.fill('Find duplicate projects in 2025');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(
      page.getByText(/Found [\d,]+ (?:repeated allocation|duplicate) cluster(?:\(s\)|s)|No multi-line duplicate clusters matched/i)
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^PDF$/ }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^DOCX$/ }).first()).toBeVisible({ timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });
});
