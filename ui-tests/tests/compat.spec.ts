/**
 * Coexistence with the extensions that rely on the stock file browser, category COMPAT of
 * docs/acc-crit.md. ACC-COMPAT-74 and 75 need other extensions installed beside this one:
 * they run only through `run-galata.sh --venv <venv>`, which exports GALATA_VENV, and only
 * when that venv holds the extensions they need.
 */
import { expect, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';
import * as fs from 'fs';

import {
  browserHandle,
  browserPaths,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

const OWN = '@stellarshenson/jupyterlab-advanced-file-browser-extension';
const PATCHES = '@stellarshenson/jupyterlab-core-patches-extension';
const SORTING = '@stellarshenson/jupyterlab-file-browser-sorting-extension';
const TERMINAL = '@stellarshenson/jupyterlab-open-in-terminal-extension';

const VENV = process.env.GALATA_VENV ?? '';

/** Whether the venv of `run-galata.sh --venv` holds the labextension `name`. */
function venvHolds(name: string): boolean {
  return (
    VENV !== '' &&
    fs.existsSync(`${VENV}/share/jupyter/labextensions/${name}/package.json`)
  );
}

test('ACC-COMPAT-69-TOKEN IDefaultFileBrowser resolves in both switch states', async ({
  page
}) => {
  for (const on of [false, true]) {
    if (on) {
      // The browser is built at start-up, so build it again with unfolding on
      await setUnfolding(page, true);
      await page.reload();
    }
    const resolved = await page.evaluate(async () => {
      const app = window.jupyterapp as any;
      const plugins: any[] = Array.from(app.pluginRegistry._plugins.values());
      const token = plugins
        .map(plugin => plugin.provides)
        .find(t => t?.name === '@jupyterlab/filebrowser:IDefaultFileBrowser');
      const browser = await app.resolveRequiredService(token);
      return {
        id: browser.id,
        unfolding: browser.model.unfolding,
        dependents: plugins
          .filter(p => p.autoStart === true && p.requires.includes(token))
          .map(p => ({ id: p.id, activated: p.activated }))
      };
    });
    expect(resolved.id).toBe('filebrowser');
    expect(resolved.unfolding).toBe(on);
    expect(resolved.dependents.map(p => p.id)).toContain(
      `${OWN}:open-in-terminal`
    );
    expect(resolved.dependents.filter(p => !p.activated)).toEqual([]);
  }
});

test('ACC-COMPAT-70-MARKUP nested rows keep the stock markup', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/x.txt', 'top.txt']);
  await setUnfolding(page, true);
  await unfold(page, `${tmpPath}/a`);
  const markup = async (path: string) =>
    (await rowLocator(page, path)).evaluate(node => ({
      item: node.classList.contains('jp-DirListing-item'),
      isdir: node.getAttribute('data-isdir'),
      fileType: node.getAttribute('data-file-type'),
      icons: node.querySelectorAll('.jp-DirListing-itemIcon').length,
      text: node.querySelector('.jp-DirListing-itemText')?.textContent
    }));

  const topFile = await markup(`${tmpPath}/top.txt`);
  expect(topFile).toEqual({
    item: true,
    isdir: 'false',
    fileType: 'text',
    icons: 1,
    text: 'top.txt'
  });
  expect(await markup(`${tmpPath}/a/x.txt`)).toEqual({
    ...topFile,
    text: 'x.txt'
  });
  expect(await markup(`${tmpPath}/a/b`)).toEqual({
    item: true,
    isdir: 'true',
    fileType: 'directory',
    icons: 1,
    text: 'b'
  });
  const nested = (await visibleRows(page)).filter(row => row.depth === 1);
  expect(nested.map(row => row.path).sort()).toEqual([
    `${tmpPath}/a/b`,
    `${tmpPath}/a/x.txt`
  ]);
});

test('ACC-COMPAT-71-HANDLEOPEN double-click goes through listing.handleOpen', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt']);
  await setUnfolding(page, true);
  await unfold(page, `${tmpPath}/a`);
  const browser = await browserHandle(page);
  await browser.evaluate(b => {
    const opened: string[] = [];
    (window as any).__opened = opened;
    b.listing.handleOpen = (item: any) => opened.push(item.path);
  });

  await (await rowLocator(page, `${tmpPath}/a/x.txt`)).dblclick();

  await expect
    .poll(() => page.evaluate(() => (window as any).__opened))
    .toEqual([`${tmpPath}/a/x.txt`]);
});

test('ACC-COMPAT-72-CD go-to-path enters a nested folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'a/',
    'a/b/',
    'a/b/c/',
    'a/x.txt',
    'a/b/y.txt'
  ]);
  await setUnfolding(page, true);
  await unfold(page, `${tmpPath}/a/b`);
  const rows = async (depth: number) =>
    (await visibleRows(page))
      .filter(row => row.depth === depth)
      .map(row => row.path)
      .sort();

  await page.evaluate(
    path =>
      window.jupyterapp.commands.execute('filebrowser:go-to-path', { path }),
    `${tmpPath}/a/b`
  );
  await expect
    .poll(() => browserPaths(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ path: `${tmpPath}/a/b`, topPath: `${tmpPath}/a/b` });
  await expect
    .poll(async () => (await visibleRows(page)).map(row => row.path).sort(), {
      timeout: SERVER_TIMEOUT
    })
    .toEqual([`${tmpPath}/a/b/c`, `${tmpPath}/a/b/y.txt`]);

  // model.cd, the call other extensions make
  const browser = await browserHandle(page);
  await browser.evaluate((b, path) => b.model.cd(`/${path}`), `${tmpPath}/a`);
  await expect
    .poll(() => browserPaths(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ path: `${tmpPath}/a`, topPath: `${tmpPath}/a` });
  await expect
    .poll(() => rows(0), { timeout: SERVER_TIMEOUT })
    .toEqual([`${tmpPath}/a/b`, `${tmpPath}/a/x.txt`]);
});

test.describe('beside jupyterlab_core_patches_extension', () => {
  test.skip(
    !venvHolds(PATCHES),
    `needs ${PATCHES} in the venv of run-galata.sh --venv (GALATA_VENV)`
  );

  test('ACC-COMPAT-74-PATCHES columns resize beside the core patches extension', async ({
    page,
    tmpPath
  }) => {
    await seedTree(page, tmpPath, ['a/', 'a/x.txt']);
    await setUnfolding(page, true);
    await unfold(page, `${tmpPath}/a`);
    const browser = await browserHandle(page);
    // The patch marks DirListing.prototype, which the tree listing inherits
    expect(
      await browser.evaluate(b => b.listing.__fileBrowserColumnWidthFixPatched)
    ).toBe(true);

    const width = async (locator: Locator) =>
      (await locator.boundingBox())?.width ?? NaN;
    const header = page.locator(
      '#filebrowser .jp-DirListing-header .jp-id-name'
    );
    const nested = (await rowLocator(page, `${tmpPath}/a/x.txt`)).locator(
      '.jp-DirListing-itemName'
    );
    const before = { header: await width(header), nested: await width(nested) };

    const handle = page.locator(
      '#filebrowser .jp-DirListing-resizeHandle[data-column="name"]'
    );
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error('no resize handle on the Name column');
    }
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, y, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => width(header)).toBeLessThan(before.header - 30);
    await expect.poll(() => width(nested)).toBeLessThan(before.nested - 30);
  });
});

test.describe('beside the replaced extensions', () => {
  test.skip(
    !venvHolds(SORTING) || !venvHolds(TERMINAL),
    `needs ${SORTING} and ${TERMINAL} in the venv of run-galata.sh --venv (GALATA_VENV)`
  );
  // Listen from the first script, so every activation message is caught
  test.use({ autoGoto: false });

  test('ACC-COMPAT-75-REPLACED no activation error beside the replaced extensions', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', error => errors.push(error.message));

    await page.goto();

    const packages = [OWN, SORTING, TERMINAL];
    const plugins = await page.evaluate(
      packages =>
        Array.from((window.jupyterapp as any).pluginRegistry._plugins.values())
          .filter((p: any) =>
            packages.some(name => p.id.startsWith(`${name}:`))
          )
          .map((p: any) => ({
            id: p.id as string,
            autoStart: p.autoStart,
            activated: p.activated as boolean
          })),
      packages
    );
    for (const name of packages) {
      expect(plugins.map(p => p.id.split(':')[0])).toContain(name);
    }
    expect(plugins.filter(p => p.autoStart === true && !p.activated)).toEqual(
      []
    );
    expect(
      errors.filter(text => /failed to activate|already registered/.test(text))
    ).toEqual([]);
  });
});
