/**
 * The unfolding switch of the column-header menu, category SWITCH of docs/acc-crit.md.
 * Galata gives every test fresh in-memory settings, kept across a page reload.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';

import {
  browserHandle,
  COMMAND,
  menuItem,
  openHeaderMenu,
  PLUGIN_ID,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  SETTING,
  unfold,
  visibleRows
} from './helpers';

/** Core's items at ranks 14-18 of the column-header menu. */
const CORE_HEADER_ITEMS = [
  'filebrowser:toggle-last-modified',
  'filebrowser:toggle-date-created',
  'filebrowser:toggle-file-size',
  'filebrowser:toggle-file-checkboxes',
  'filebrowser:toggle-sort-notebooks-first'
];

test.beforeEach(async ({ page, tmpPath }) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await rowLocator(page, `${tmpPath}/a`);
});

/**
 * Assert the unfolding item's checked state in the open menu `menu`. Lumino's menu
 * renders `aria-checked="true"` on a checked item and no `aria-checked` on an unchecked one.
 */
async function expectChecked(menu: Locator, checked: boolean): Promise<void> {
  const item = menuItem(menu, COMMAND.toggleUnfolding);
  if (checked) {
    await expect(item).toHaveClass(/lm-mod-toggled/);
    await expect(item).toHaveAttribute('aria-checked', 'true');
  } else {
    await expect(item).toBeVisible();
    await expect(item).not.toHaveClass(/lm-mod-toggled/);
    await expect(item).not.toHaveAttribute('aria-checked', 'true');
  }
}

/** Click the unfolding item of the column-header menu, then wait until the browser applies it. */
async function clickSwitch(
  page: IJupyterLabPageFixture,
  expected: boolean
): Promise<void> {
  const menu = await openHeaderMenu(page);
  await menuItem(menu, COMMAND.toggleUnfolding).click();
  await expect(menu).toBeHidden();
  const browser = await browserHandle(page);
  await expect
    .poll(() => browser.evaluate(b => b.model.unfolding), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(expected);
}

/** The triangle state of each listed row, by its name. */
async function triangles(
  page: IJupyterLabPageFixture
): Promise<Record<string, boolean | null>> {
  const rows = await visibleRows(page);
  return Object.fromEntries(rows.map(row => [row.name, row.expanded]));
}

test('ACC-SWITCH-23-ITEM unfolding item in the column-header menu', async ({
  page
}) => {
  const menu = await openHeaderMenu(page);
  for (const command of [
    ...CORE_HEADER_ITEMS,
    COMMAND.toggleUnixSorting,
    COMMAND.toggleUnfolding
  ]) {
    await expect(menuItem(menu, command), command).toBeVisible();
  }
  await expect(
    menuItem(menu, COMMAND.toggleUnfolding).locator('.lm-Menu-itemLabel')
  ).toHaveText('Folder Unfolding');
  // Checkable: the command carries a checked state (Lumino's isToggleable).
  expect(
    await page.evaluate(
      id => window.jupyterapp.commands.isToggleable(id),
      COMMAND.toggleUnfolding
    )
  ).toBe(true);
});

test('ACC-SWITCH-24-DEFAULT unfolding is off with fresh settings', async ({
  page
}) => {
  expect(await triangles(page)).toEqual({ a: null, 'b.txt': null });
  const menu = await openHeaderMenu(page);
  await expectChecked(menu, false);
});

test('ACC-SWITCH-25-CHECK item checked exactly while unfolding is on', async ({
  page
}) => {
  for (const on of [true, false]) {
    await clickSwitch(page, on);
    const menu = await openHeaderMenu(page);
    await expectChecked(menu, on);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('ACC-SWITCH-26-ON switching on shows triangles without a reload', async ({
  page
}) => {
  // A page reload drops this mark.
  await page.evaluate(() => ((window as any).switchNoReload = true));
  await clickSwitch(page, true);
  await expect
    .poll(() => triangles(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ a: false, 'b.txt': null });
  expect(await page.evaluate(() => (window as any).switchNoReload)).toBe(true);
});

test('ACC-SWITCH-27-OFF switching off restores the stock listing', async ({
  page,
  tmpPath
}) => {
  await clickSwitch(page, true);
  await unfold(page, `${tmpPath}/a`);
  await rowLocator(page, `${tmpPath}/a/x.txt`);

  await clickSwitch(page, false);
  await expect
    .poll(
      async () =>
        (await visibleRows(page)).map(row => [
          row.path,
          row.depth,
          row.expanded
        ]),
      { timeout: SERVER_TIMEOUT }
    )
    .toEqual([
      [`${tmpPath}/a`, 0, null],
      [`${tmpPath}/b.txt`, 0, null]
    ]);
  await expect(
    page.locator('#filebrowser .jp-AdvancedFileBrowser-toggle')
  ).toHaveCount(0);
});

test('ACC-SWITCH-28-SAVED the choice survives a reload', async ({
  page,
  tmpPath
}) => {
  await clickSwitch(page, true);
  await page.reload();
  // The browser restores the folder it showed before the reload.
  await rowLocator(page, `${tmpPath}/a`);
  await expect
    .poll(() => triangles(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ a: false, 'b.txt': null });
  const saved = await page.evaluate(
    async ({ id, key }) => {
      const registry: any = await window.galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      return (await registry.get(id, key)).user;
    },
    { id: PLUGIN_ID, key: SETTING.unfolding }
  );
  expect(saved).toBe(true);
});
