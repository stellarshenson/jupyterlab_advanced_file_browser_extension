/**
 * Open in Terminal on file rows and the empty listing area (docs/acc-crit.md, category
 * TERM; docs/design.md section 6). Unfolding is on in every test, so nested rows exist
 * and the right-click's mousedown sets the current folder the command reads.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';
import {
  browserPaths,
  COMMAND,
  menuItem,
  openEmptyAreaMenu,
  openItemMenu,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  terminalCwd,
  unfold,
  visibleRows
} from './helpers';

/** Command ids of the shown menu items labelled Open in Terminal, in menu order. */
function shownTerminalItems(menu: Locator): Promise<string[]> {
  return menu
    .locator('li.lm-Menu-item:not(.lm-mod-hidden)')
    .evaluateAll(items =>
      items
        .filter(
          li =>
            li.querySelector('.lm-Menu-itemLabel')?.textContent ===
            'Open in Terminal'
        )
        .map(li => li.getAttribute('data-command') ?? '')
    );
}

/** Click this extension's Open in Terminal in `menu` and return the terminal's folder. */
async function openTerminalFrom(
  page: IJupyterLabPageFixture,
  menu: Locator
): Promise<string> {
  await menuItem(menu, COMMAND.openInTerminal).click();
  return terminalCwd(page);
}

/** Double-click the folder row `path` and wait until the listing shows its contents. */
async function enterFolder(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await (await rowLocator(page, path)).dblclick();
  await expect
    .poll(async () => (await browserPaths(page)).topPath, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(path);
}

test.beforeEach(async ({ page }) => {
  await setUnfolding(page, true);
});

test('ACC-TERM-53-FILE item on top and nested file rows', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['x.txt', 'a/', 'a/y.txt']);
  await unfold(page, `${tmpPath}/a`);

  for (const path of [`${tmpPath}/x.txt`, `${tmpPath}/a/y.txt`]) {
    const menu = await openItemMenu(page, path);
    await expect
      .poll(() => shownTerminalItems(menu), { message: path })
      .toEqual([COMMAND.openInTerminal]);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('ACC-TERM-54-EMPTY item on the empty area', async ({ page, tmpPath }) => {
  await seedTree(page, tmpPath, ['x.txt']);
  await rowLocator(page, `${tmpPath}/x.txt`);

  const menu = await openEmptyAreaMenu(page);
  await expect
    .poll(() => shownTerminalItems(menu))
    .toEqual([COMMAND.openInTerminal]);
});

test('ACC-TERM-55-FOLDER folder rows show only the core item', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/']);
  await unfold(page, `${tmpPath}/a`);

  for (const path of [`${tmpPath}/a`, `${tmpPath}/a/b`]) {
    const menu = await openItemMenu(page, path);
    await expect
      .poll(() => shownTerminalItems(menu), { message: path })
      .toEqual([COMMAND.coreOpenFolderInTerminal]);
    await expect(menuItem(menu, COMMAND.openInTerminal)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test("ACC-TERM-56-FILECWD terminal opens in the nested file's folder", async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/b/x.txt']);
  await unfold(page, `${tmpPath}/a/b`);

  const menu = await openItemMenu(page, `${tmpPath}/a/b/x.txt`);
  expect(await openTerminalFrom(page, menu)).toBe(`${tmpPath}/a/b`);
});

test('ACC-TERM-57-EMPTYCWD empty area opens in the top folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['x.txt']);
  await rowLocator(page, `${tmpPath}/x.txt`);

  const menu = await openEmptyAreaMenu(page);
  expect(await openTerminalFrom(page, menu)).toBe(tmpPath);
});

test('ACC-TERM-58-NOSELECT empty area ignores the selection', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/']);
  await unfold(page, `${tmpPath}/a`);
  await (await rowLocator(page, `${tmpPath}/a/b`)).click();
  // The selected folder is the current folder before the right-click
  await expect
    .poll(async () => (await browserPaths(page)).path)
    .toBe(`${tmpPath}/a/b`);
  expect(
    (await visibleRows(page)).filter(row => row.selected).map(row => row.path)
  ).toEqual([`${tmpPath}/a/b`]);

  const menu = await openEmptyAreaMenu(page);
  expect(await openTerminalFrom(page, menu)).toBe(tmpPath);
});

test('ACC-TERM-59-SUBNAV empty area after entering a folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt']);
  await enterFolder(page, `${tmpPath}/a`);
  await rowLocator(page, `${tmpPath}/a/x.txt`);

  const menu = await openEmptyAreaMenu(page);
  expect(await openTerminalFrom(page, menu)).toBe(`${tmpPath}/a`);
});

test('ACC-TERM-60-ROOT file at the server root opens at the root', async ({
  page,
  tmpPath
}) => {
  // A file at the server root, named after the test folder so no other test shares it
  const name = `${tmpPath}-x.txt`;
  expect(await page.contents.uploadContent('x', 'text', name)).toBe(true);
  try {
    expect(await page.filebrowser.openHomeDirectory()).toBe(true);
    await expect
      .poll(async () => (await browserPaths(page)).topPath, {
        timeout: SERVER_TIMEOUT
      })
      .toBe('');
    await page.filebrowser.refresh();

    const menu = await openItemMenu(page, name);
    expect(await openTerminalFrom(page, menu)).toBe('');
  } finally {
    await page.contents.deleteFile(name);
  }
});

test('ACC-TERM-61-EMPTYDIR item inside an entered empty folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['e/']);
  await enterFolder(page, `${tmpPath}/e`);
  expect(await visibleRows(page)).toEqual([]);

  const menu = await openEmptyAreaMenu(page);
  await expect
    .poll(() => shownTerminalItems(menu))
    .toEqual([COMMAND.openInTerminal]);
});

test("ACC-TERM-62-MULTI several items selected, the file's own folder", async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['x.txt', 'a/', 'a/y.txt']);
  await unfold(page, `${tmpPath}/a`);
  // Select a/y.txt, then add x.txt: the last click makes the top folder current
  await (await rowLocator(page, `${tmpPath}/a/y.txt`)).click();
  await (
    await rowLocator(page, `${tmpPath}/x.txt`)
  ).click({
    modifiers: ['ControlOrMeta']
  });
  await expect.poll(async () => (await browserPaths(page)).path).toBe(tmpPath);

  const menu = await openItemMenu(page, `${tmpPath}/a/y.txt`);
  // The right-click on a selected row keeps the selection of both
  expect(
    (await visibleRows(page))
      .filter(row => row.selected)
      .map(row => row.path)
      .sort()
  ).toEqual([`${tmpPath}/a/y.txt`, `${tmpPath}/x.txt`]);
  expect(await openTerminalFrom(page, menu)).toBe(`${tmpPath}/a`);
});
