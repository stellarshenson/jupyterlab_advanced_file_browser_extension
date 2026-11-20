/**
 * The context menu on the folder names in the file browser breadcrumbs
 * (docs/acc-crit.md, category FOLDER, ACC-FOLDER-92 to 97). Every test is inside
 * `a/b` and acts on the crumb of `a`, so the menu must use the crumb's path, not
 * the current folder.
 *
 * ACC-FOLDER-96 needs @jlab-enhanced/favorites loaded by the lab; ACC-FOLDER-97 and
 * ACC-FOLDER-92's fourth label need its absence. Which one holds is probed in the running
 * lab, as `src/crumbsMenu.ts` decides it, because the default runner loads the image's
 * /opt/conda labextensions as well as a venv's.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';

import {
  browserPaths,
  COMMAND,
  menuItem,
  openMenu,
  seedTree,
  SERVER_TIMEOUT,
  terminalCwd,
  visibleRows
} from './helpers';

/** The settings plugin of @jlab-enhanced/favorites, the id `src/crumbsMenu.ts` reads. */
const FAVORITES = '@jlab-enhanced/favorites:favorites';

/** Whether the running lab has the favourites plugin, as the crumb menu asks it. */
async function labHasFavourites(
  page: IJupyterLabPageFixture
): Promise<boolean> {
  return page.evaluate(async (plugin: string) => {
    const registry: any = await (window as any).galata.getPlugin(
      '@jupyterlab/apputils-extension:settings'
    );
    return plugin in registry.plugins;
  }, FAVORITES);
}

/** Enter `path` through the file browser's go-to-path command. */
async function goTo(page: IJupyterLabPageFixture, path: string): Promise<void> {
  await page.evaluate(
    target =>
      window.jupyterapp.commands.execute('filebrowser:go-to-path', {
        path: target
      }),
    path
  );
  await expect
    .poll(async () => (await browserPaths(page)).path, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(path);
}

/** The named crumb whose server-relative path is `path`. */
function crumb(page: IJupyterLabPageFixture, path: string): Locator {
  return page.locator(
    `#filebrowser .jp-BreadCrumbs-item:not(.jp-BreadCrumbs-ellipsis)[data-path="${path}"]`
  );
}

/** Right-click the crumb of `path` and return its context menu. */
async function openCrumbMenu(
  page: IJupyterLabPageFixture,
  path: string
): Promise<Locator> {
  return openMenu(page, crumb(page, path));
}

/**
 * The labels of the shown items of this extension's crumb commands, in menu
 * order; the menu also carries the application's disabled Shift+Right Click hint.
 */
function shownLabels(menu: Locator): Promise<string[]> {
  return menu
    .locator(
      'li.lm-Menu-item[data-command^="advanced-file-browser:crumb-"]:not(.lm-mod-hidden) .lm-Menu-itemLabel'
    )
    .allTextContents();
}

/** Seed `a/b` and make it the current folder, so the crumb of `a` is shown. */
async function insideAB(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<void> {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/x.txt']);
  await goTo(page, `${tmpPath}/a/b`);
}

test('ACC-FOLDER-92-CRUMB-MENU right-click on a folder crumb shows the four items', async ({
  page,
  tmpPath
}) => {
  await insideAB(page, tmpPath);
  const menu = await openCrumbMenu(page, `${tmpPath}/a`);
  // Add to Favourite needs the favourites extension in the lab
  const hasFavourites = await labHasFavourites(page);
  const expected = hasFavourites
    ? ['Open in Terminal', 'Copy Path', 'Open', 'Add to Favourite']
    : ['Open in Terminal', 'Copy Path', 'Open'];
  await expect.poll(() => shownLabels(menu)).toEqual(expected);
  for (const command of [
    COMMAND.crumbOpenInTerminal,
    COMMAND.crumbCopyPath,
    COMMAND.crumbOpen
  ]) {
    await expect(menuItem(menu, command)).toBeVisible();
  }
  if (hasFavourites) {
    await expect(menuItem(menu, COMMAND.crumbAddToFavourite)).toBeVisible();
  } else {
    await expect(menuItem(menu, COMMAND.crumbAddToFavourite)).toBeHidden();
  }
});

test('ACC-FOLDER-93-CRUMB-TERM Open in Terminal uses the crumb folder', async ({
  page,
  tmpPath
}) => {
  await insideAB(page, tmpPath);
  const menu = await openCrumbMenu(page, `${tmpPath}/a`);
  await menuItem(menu, COMMAND.crumbOpenInTerminal).click();
  expect(await terminalCwd(page)).toBe(`${tmpPath}/a`);
});

test('ACC-FOLDER-94-CRUMB-COPY Copy Path puts the crumb path on the clipboard', async ({
  page,
  tmpPath
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await insideAB(page, tmpPath);
  const menu = await openCrumbMenu(page, `${tmpPath}/a`);
  await menuItem(menu, COMMAND.crumbCopyPath).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(`${tmpPath}/a`);
});

test('ACC-FOLDER-95-CRUMB-OPEN Open enters the crumb folder', async ({
  page,
  tmpPath
}) => {
  await insideAB(page, tmpPath);
  const menu = await openCrumbMenu(page, `${tmpPath}/a`);
  await menuItem(menu, COMMAND.crumbOpen).click();
  await expect
    .poll(async () => (await browserPaths(page)).topPath, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(`${tmpPath}/a`);
  await expect
    .poll(async () => (await visibleRows(page)).map(row => row.path).sort(), {
      timeout: SERVER_TIMEOUT
    })
    .toEqual([`${tmpPath}/a/b`, `${tmpPath}/a/x.txt`]);
});

test.describe('beside @jlab-enhanced/favorites', () => {
  test('ACC-FOLDER-96-CRUMB-FAV Add to Favourite lists the crumb folder, staying in a/b', async ({
    page,
    tmpPath
  }) => {
    test.skip(
      !(await labHasFavourites(page)),
      `needs ${FAVORITES} loaded by the lab`
    );
    await insideAB(page, tmpPath);
    const before = await browserPaths(page);
    const menu = await openCrumbMenu(page, `${tmpPath}/a`);
    await menuItem(menu, COMMAND.crumbAddToFavourite).click();

    const item = page.locator(`.jp-Favorites-item[data-path="${tmpPath}/a"]`);
    await expect(item).toBeVisible({ timeout: SERVER_TIMEOUT });
    expect(await browserPaths(page)).toEqual(before);
  });
});

test.describe('without @jlab-enhanced/favorites', () => {
  test('ACC-FOLDER-97-FAV-ABSENT the crumb menu omits Add to Favourite', async ({
    page,
    tmpPath
  }) => {
    test.skip(
      await labHasFavourites(page),
      `runs where the lab does not load ${FAVORITES}`
    );
    await insideAB(page, tmpPath);
    const menu = await openCrumbMenu(page, `${tmpPath}/a`);
    await expect(menuItem(menu, COMMAND.crumbAddToFavourite)).toBeHidden();
    // The other three are the menu's visible items
    await expect
      .poll(() => shownLabels(menu))
      .toEqual(['Open in Terminal', 'Copy Path', 'Open']);
  });
});
