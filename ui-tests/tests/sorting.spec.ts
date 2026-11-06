/**
 * Unix Style Sorting (docs/acc-crit.md, category SORT): the column-header item, the byte
 * order in the browser at the top level and inside an unfolded folder, the default, the
 * saved choice and the live re-sort.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

import {
  COMMAND,
  menuItem,
  openHeaderMenu,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

// The server hides dot files (ContentsManager.allow_hidden is off), so the browser tests
// leave out the `.d` of the unit test.
const NAMES = ['b', '_c', 'A', '1'];
const BYTE_ORDER = ['1', 'A', '_c', 'b'];
// JupyterLab's own order: localeCompare, numeric, base sensitivity
const STOCK_ORDER = ['_c', '1', 'A', 'b'];

const rowNames = async (page: IJupyterLabPageFixture) =>
  (await visibleRows(page)).map(row => row.name);

/** Click Unix Style Sorting in the column-header menu. */
async function toggleUnixSorting(page: IJupyterLabPageFixture): Promise<void> {
  const menu = await openHeaderMenu(page);
  await menuItem(menu, COMMAND.toggleUnixSorting).click();
  await expect(menu).toBeHidden();
}

test('ACC-SORT-42-ITEM Unix Style Sorting in the column-header menu', async ({
  page
}) => {
  const item = menuItem(await openHeaderMenu(page), COMMAND.toggleUnixSorting);

  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('role', 'menuitemcheckbox');
  await expect(item.locator('.lm-Menu-itemLabel')).toHaveText(
    'Unix Style Sorting'
  );
});

test('ACC-SORT-43-ORDER names in byte order', async ({ page, tmpPath }) => {
  await seedTree(page, tmpPath, NAMES);

  await expect.poll(() => rowNames(page)).toEqual(BYTE_ORDER);
});

test('ACC-SORT-47-NESTED byte order inside an unfolded folder', async ({
  page,
  tmpPath
}) => {
  await setUnfolding(page, true);
  await seedTree(page, tmpPath, ['a/', 'a/b', 'a/_c', 'a/A']);
  await unfold(page, `${tmpPath}/a`);

  await expect
    .poll(async () =>
      (await visibleRows(page)).map(row => `${row.depth} ${row.path}`)
    )
    .toEqual([
      `0 ${tmpPath}/a`,
      `1 ${tmpPath}/a/A`,
      `1 ${tmpPath}/a/_c`,
      `1 ${tmpPath}/a/b`
    ]);
});

test('ACC-SORT-50-DEFAULT on with fresh settings', async ({ page }) => {
  const item = menuItem(await openHeaderMenu(page), COMMAND.toggleUnixSorting);

  await expect(item).toHaveAttribute('aria-checked', 'true');
  await expect(item).toHaveClass(/lm-mod-toggled/);
});

test('ACC-SORT-51-SAVED the choice survives a reload', async ({ page }) => {
  await toggleUnixSorting(page);
  await page.reload();

  const item = menuItem(await openHeaderMenu(page), COMMAND.toggleUnixSorting);
  await expect(item).toBeVisible();
  // The lab's Lumino 2.8 sets aria-checked on a checked item only
  await expect(item).not.toHaveAttribute('aria-checked', 'true');
  await expect(item).not.toHaveClass(/lm-mod-toggled/);
});

test('ACC-SORT-52-LIVE toggling re-sorts without a reload', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, NAMES);
  await expect.poll(() => rowNames(page)).toEqual(BYTE_ORDER);
  // A reload would drop this marker
  await page.evaluate(() => ((window as any).sortingNoReload = true));

  await toggleUnixSorting(page);
  await expect
    .poll(() => rowNames(page), { timeout: SERVER_TIMEOUT })
    .toEqual(STOCK_ORDER);

  await toggleUnixSorting(page);
  await expect
    .poll(() => rowNames(page), { timeout: SERVER_TIMEOUT })
    .toEqual(BYTE_ORDER);

  expect(await page.evaluate(() => (window as any).sortingNoReload)).toBe(true);
});
