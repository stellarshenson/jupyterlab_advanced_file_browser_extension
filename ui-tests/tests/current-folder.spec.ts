/**
 * Current folder (docs/acc-crit.md, category FOLDER): with unfolding on, model.path
 * follows the clicked row, and new items land there.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import {
  browserHandle,
  browserPaths,
  clickEmptyArea,
  rowLocator,
  SERVER_TIMEOUT,
  seedTree,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

const TREE = ['a/', 'a/b/', 'a/x.txt', 'a/b/y.txt', 'x.txt'];

/** Seed the tree in `tmpPath` and set the unfolding switch. */
async function setup(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  unfolding: boolean
): Promise<void> {
  await seedTree(page, tmpPath, TREE);
  await setUnfolding(page, unfolding);
}

/** Left-click the row of `path`. */
async function clickRow(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await (await rowLocator(page, path)).click();
}

/** Wait until `model.path` is `path`. */
async function expectCurrent(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await expect
    .poll(async () => (await browserPaths(page)).path, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(path);
}

/** Wait until the server holds the file `path`. */
async function expectFile(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await expect
    .poll(() => page.contents.fileExists(path), {
      message: `file ${path}`,
      timeout: SERVER_TIMEOUT
    })
    .toBe(true);
}

test('ACC-FOLDER-29-CLICKDIR click on a nested folder makes it current', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  expect((await browserPaths(page)).topPath).toBe(tmpPath);
});

test('ACC-FOLDER-30-CLICKFILE click on a nested file makes its folder current', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a/b`);

  await clickRow(page, `${tmpPath}/a/b/y.txt`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  await clickRow(page, `${tmpPath}/a/x.txt`);
  await expectCurrent(page, `${tmpPath}/a`);
  expect((await browserPaths(page)).topPath).toBe(tmpPath);
});

test('ACC-FOLDER-31-CLICKEMPTY click on the empty area returns to the top folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  expect(
    (await visibleRows(page)).filter(row => row.selected).map(row => row.path)
  ).toEqual([`${tmpPath}/a/b`]);

  await clickEmptyArea(page);

  await expectCurrent(page, tmpPath);
  await expect
    .poll(async () => (await visibleRows(page)).filter(row => row.selected))
    .toEqual([]);
});

test('DEF-FOLDER-3-SCROLLBAR a press on the scrollbar keeps the folder and the selection', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  // Headless Chromium hides scrollbars, so dispatch the mousedown a scrollbar press gives:
  // on the content node, beside a row, past its client width
  const browser = await browserHandle(page);
  await browser.evaluate(b => {
    const content: HTMLElement = b.listing.contentNode;
    const box = content.getBoundingClientRect();
    content.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: box.left + content.clientLeft + content.clientWidth + 1,
        clientY: box.top + 5
      })
    );
  });

  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a/b`);
  expect(
    await browser.evaluate(b =>
      Array.from(b.selectedItems(), (item: any) => item.path)
    )
  ).toEqual([`${tmpPath}/a/b`]);
});

test('ACC-FOLDER-32-NEWITEM New Folder lands in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  await page
    .locator(
      '#filebrowser .jp-Toolbar [data-command="filebrowser:create-new-directory"]'
    )
    .click();
  // The stock New Folder selects the new row and opens its name editor.
  const editor = page.locator('#filebrowser .jp-DirListing-editor');
  await expect(editor).toBeVisible({ timeout: SERVER_TIMEOUT });
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();

  const created = `${tmpPath}/a/b/Untitled Folder`;
  expect(await page.contents.directoryExists(created)).toBe(true);
  expect(
    await page.contents.directoryExists(`${tmpPath}/Untitled Folder`)
  ).toBe(false);
  // Folders sort first, so the new folder is the first row under a/b.
  await expect
    .poll(async () => {
      const rows = await visibleRows(page);
      const parent = rows.findIndex(row => row.path === `${tmpPath}/a/b`);
      const row = rows[parent + 1];
      return parent >= 0 && row ? [row.path, row.depth] : null;
    })
    .toEqual([created, 2]);
});

test('ACC-FOLDER-33-UPLOAD upload lands in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#filebrowser .jp-id-upload').click();
  await (
    await chooser
  ).setFiles({
    name: 'u.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded\n')
  });

  await expectFile(page, `${tmpPath}/a/b/u.txt`);
  expect(await page.contents.fileExists(`${tmpPath}/u.txt`)).toBe(false);
});

test('ACC-FOLDER-34-PASTE paste lands in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/x.txt`);
  await page.keyboard.press('Control+c');
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await page.keyboard.press('Control+v');

  await expectFile(page, `${tmpPath}/a/b/x.txt`);
  expect(await page.contents.fileExists(`${tmpPath}/x.txt`)).toBe(true);
});

test('ACC-FOLDER-35-STOCK unfolding off keeps the folder on click', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, false);

  await clickRow(page, `${tmpPath}/a`);
  await expect
    .poll(async () =>
      (await visibleRows(page)).filter(row => row.selected).map(row => row.path)
    )
    .toEqual([`${tmpPath}/a`]);

  expect(await browserPaths(page)).toEqual({ path: tmpPath, topPath: tmpPath });
});

test('ACC-FOLDER-76-BREADCRUMBS breadcrumbs follow the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  const crumbs = page.locator('#filebrowser .jp-BreadCrumbs');
  await expect(crumbs.locator('.jp-BreadCrumbs-item').last()).toHaveText('b');

  await crumbs.locator('.jp-BreadCrumbs-home').click();

  await expect
    .poll(async () => await browserPaths(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ path: '', topPath: '' });
  await expect
    .poll(
      async () => {
        const paths = (await visibleRows(page)).map(row => row.path);
        return paths.includes(tmpPath) && paths.every(p => !p.includes('/'));
      },
      { timeout: SERVER_TIMEOUT }
    )
    .toBe(true);
});
