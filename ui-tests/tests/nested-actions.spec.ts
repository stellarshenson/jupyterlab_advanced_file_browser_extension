/**
 * Actions on nested rows (docs/acc-crit.md, category NESTED): stock file browser actions
 * on rows inside unfolded folders act on the item's own path.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import { readFileSync } from 'fs';
import {
  browserHandle,
  clickEmptyArea,
  dragRow,
  menuItem,
  openItemMenu,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

// Copy Path writes the system clipboard; ACC-NESTED-39 reads it back
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await setUnfolding(page, true);
});

/** The paths of `selectedItems()` of the default browser, sorted. */
async function selectedPaths(page: IJupyterLabPageFixture): Promise<string[]> {
  const browser = await browserHandle(page);
  return browser.evaluate(b =>
    Array.from(b.selectedItems(), (item: any) => item.path as string).sort()
  );
}

/** Run a command of the application and wait for its result. */
async function run(page: IJupyterLabPageFixture, command: string) {
  await page.evaluate(id => window.jupyterapp.commands.execute(id), command);
}

/** Select folder a with a plain click and its row a/x.txt with a Ctrl click. */
async function selectFolderAndRow(page: IJupyterLabPageFixture, root: string) {
  await (await rowLocator(page, `${root}/a`)).click();
  await (
    await rowLocator(page, `${root}/a/x.txt`)
  ).click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() => selectedPaths(page))
    .toEqual([`${root}/a`, `${root}/a/x.txt`]);
}

/** Record the server path of every rename and move (PATCH on the contents API). */
function recordMoves(page: IJupyterLabPageFixture): string[] {
  const moves: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (request.method() === 'PATCH' && pathname.includes('/api/contents/')) {
      moves.push(decodeURIComponent(pathname.split('/api/contents/')[1]));
    }
  });
  return moves;
}

/** The paths of the selected rows, in screen order. */
async function selectedRows(page: IJupyterLabPageFixture): Promise<string[]> {
  return (await visibleRows(page)).filter(r => r.selected).map(r => r.path);
}

test('ACC-NESTED-36-RENAME rename inside an unfolded folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);

  const menu = await openItemMenu(page, `${tmpPath}/a/x.txt`);
  await menuItem(menu, 'filebrowser:rename').click();
  const editor = page.locator('#filebrowser .jp-DirListing-editor');
  await expect(editor).toBeVisible();
  await editor.fill('z.txt');
  await editor.press('Enter');

  await expect
    .poll(() => page.contents.fileExists(`${tmpPath}/a/z.txt`), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/a/x.txt`)).toBe(false);
  expect(await page.contents.fileExists(`${tmpPath}/x.txt`)).toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/z.txt`)).toBe(false);

  // The renamed row sits under a: one level deeper, after a, only a's rows between
  await rowLocator(page, `${tmpPath}/a/z.txt`);
  const rows = await visibleRows(page);
  const parent = rows.findIndex(r => r.path === `${tmpPath}/a`);
  const renamed = rows.findIndex(r => r.path === `${tmpPath}/a/z.txt`);
  expect(rows[renamed].depth).toBe(rows[parent].depth + 1);
  expect(renamed).toBeGreaterThan(parent);
  for (const row of rows.slice(parent + 1, renamed)) {
    expect(row.path.startsWith(`${tmpPath}/a/`)).toBe(true);
  }
});

test('ACC-NESTED-37-DELETE delete removes only the nested item', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);

  const menu = await openItemMenu(page, `${tmpPath}/a/x.txt`);
  await menuItem(menu, 'filebrowser:delete').click();
  await page.locator('.jp-Dialog .jp-mod-accept').click();

  await expect
    .poll(() => page.contents.fileExists(`${tmpPath}/a/x.txt`), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(false);
  expect(await page.contents.fileExists(`${tmpPath}/x.txt`)).toBe(true);
  await expect
    .poll(async () => (await visibleRows(page)).map(r => r.path), {
      timeout: SERVER_TIMEOUT
    })
    .toEqual([`${tmpPath}/a`, `${tmpPath}/x.txt`]);
});

test('ACC-NESTED-38-MULTI selection across levels keeps full paths', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/y.txt', 'a/z.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);
  const x = await rowLocator(page, `${tmpPath}/x.txt`);
  const y = await rowLocator(page, `${tmpPath}/a/y.txt`);

  // Ctrl: exactly the two clicked rows
  await x.click({ modifiers: ['ControlOrMeta'] });
  await y.click({ modifiers: ['ControlOrMeta'] });
  await expect
    .poll(() => selectedPaths(page))
    .toEqual([`${tmpPath}/a/y.txt`, `${tmpPath}/x.txt`]);

  // Shift: the screen-order range between the two rows, a/z.txt included. The empty-area
  // click clears the selection, so the plain click selects and focuses x.txt (a click on
  // a row of a multiple selection keeps the focus where it was)
  await clickEmptyArea(page);
  await expect.poll(() => selectedPaths(page)).toEqual([]);
  await x.click();
  await y.click({ modifiers: ['Shift'] });
  await expect
    .poll(() => selectedPaths(page))
    .toEqual([`${tmpPath}/a/y.txt`, `${tmpPath}/a/z.txt`, `${tmpPath}/x.txt`]);
});

test('ACC-NESTED-39-COPYPATH Copy Path copies the full path', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/b/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a/b`);
  await page.evaluate(() => navigator.clipboard.writeText('unset'));

  const menu = await openItemMenu(page, `${tmpPath}/a/b/x.txt`);
  await menuItem(menu, 'filebrowser:copy-path').click();

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${tmpPath}/a/b/x.txt`);
});

test('ACC-NESTED-40-DOWNLOAD Download saves the nested file', async ({
  page,
  tmpPath
}) => {
  // seedTree writes each file's relative path as its content
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);

  const menu = await openItemMenu(page, `${tmpPath}/a/x.txt`);
  const download = page.waitForEvent('download', { timeout: SERVER_TIMEOUT });
  await menuItem(menu, 'filebrowser:download').click();
  const file = await download;

  expect(file.suggestedFilename()).toBe('x.txt');
  expect(readFileSync(await file.path(), 'utf8')).toBe('a/x.txt');
});

test('ACC-NESTED-41-KEYS arrow keys and Enter work through nested rows', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);
  await (await rowLocator(page, `${tmpPath}/a`)).click();
  await expect.poll(() => selectedRows(page)).toEqual([`${tmpPath}/a`]);

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedRows(page)).toEqual([`${tmpPath}/a/x.txt`]);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selectedRows(page)).toEqual([`${tmpPath}/x.txt`]);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => selectedRows(page)).toEqual([`${tmpPath}/a/x.txt`]);

  await page.keyboard.press('Enter');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window.jupyterapp.shell.currentWidget as any)?.context?.path
        ),
      { timeout: SERVER_TIMEOUT }
    )
    .toBe(`${tmpPath}/a/x.txt`);
  await expect(
    page.locator('#jp-main-dock-panel .lm-TabBar-tab.jp-mod-current')
  ).toContainText('x.txt');
});

test('ACC-NESTED-77-OUTERMOST a folder selected with its own rows acts once', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/']);
  await unfold(page, `${tmpPath}/a`);

  // Paste into b copies the folder with its row, and not the row a second time beside it
  await selectFolderAndRow(page, tmpPath);
  await run(page, 'filebrowser:copy');
  await (await rowLocator(page, `${tmpPath}/b`)).click();
  await run(page, 'filebrowser:paste');
  expect(await page.contents.fileExists(`${tmpPath}/b/a/x.txt`)).toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/b/x.txt`)).toBe(false);

  // Delete asks for the folder alone and deletes it without an error dialog
  await selectFolderAndRow(page, tmpPath);
  const deleted = run(page, 'filebrowser:delete');
  const dialog = page.locator('.jp-Dialog');
  await expect(dialog.locator('.jp-Dialog-body')).toContainText(': a?');
  await dialog.locator('.jp-mod-accept').click();
  await deleted;
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(false);
  await expect(dialog).toHaveCount(0);
});

test('ACC-NESTED-77-OUTERMOST Cut and Paste move a folder selected with its own rows once', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/']);
  await unfold(page, `${tmpPath}/a`);
  await selectFolderAndRow(page, tmpPath);
  const moves = recordMoves(page);

  await run(page, 'filebrowser:cut');
  await (await rowLocator(page, `${tmpPath}/b`)).click();
  await run(page, 'filebrowser:paste');

  expect(await page.contents.fileExists(`${tmpPath}/b/a/x.txt`)).toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/b/x.txt`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(false);
  // One move, of the folder; a second one of a/x.txt would race the folder's move
  expect(moves).toEqual([`${tmpPath}/a`]);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});

test('ACC-NESTED-77-OUTERMOST a drop moves a folder selected with its own rows once', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/']);
  await unfold(page, `${tmpPath}/a`);
  await selectFolderAndRow(page, tmpPath);
  const moves = recordMoves(page);

  // A press on a row of a multiple selection keeps the selection, so the drag carries both rows
  await dragRow(page, `${tmpPath}/a`, `${tmpPath}/b`);

  await expect
    .poll(() => page.contents.fileExists(`${tmpPath}/b/a/x.txt`), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/b/x.txt`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(false);
  expect(moves).toEqual([`${tmpPath}/a`]);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});
