import { expect, test } from '@jupyterlab/galata';

import {
  activateFileBrowser,
  centreOf,
  crumb,
  dragCrumbTo,
  openFolder,
  openTerminalAndCaptureSends,
  sentStdin,
  serverRoot,
  setPluginSettings
} from './helpers';

/**
 * Functional tests for the file browser breadcrumb as a drag source.
 *
 * JupyterLab ships the crumbs as a drop target only, so every assertion here
 * covers code this extension adds. The drags are driven with the real mouse -
 * see `dragCrumbTo` in ./helpers for why.
 */

/** Directory the drags point at, and a child to stand inside of. */
const DIR = 'crumbdir';
// Named apart from drag-path.spec.ts's root-level `sub`, which runs in a
// parallel worker against the same server root.
const CHILD = `${DIR}/crumbchild`;

test.beforeEach(async ({ page }) => {
  await page.contents.createDirectory(DIR);
  await page.contents.createDirectory(CHILD);
});

test.describe('breadcrumb drag source', () => {
  test('a crumb dropped on a terminal inserts its directory path', async ({
    page
  }) => {
    await openFolder(page, DIR);
    await openTerminalAndCaptureSends(page);

    const started = await dragCrumbTo(
      page,
      DIR,
      await centreOf(page.locator('.jp-Terminal'))
    );

    expect(started).toBe(true);
    // The terminal's working directory is wherever the test server started,
    // which is not the galata content root, so only the tail of a relative
    // path is stable across environments.
    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/crumbdir$/);
  });

  test('the home crumb inserts the server root', async ({ page }) => {
    await setPluginSettings(page, { pathType: 'absolute' });
    await activateFileBrowser(page);
    await openTerminalAndCaptureSends(page);

    await dragCrumbTo(page, '/', await centreOf(page.locator('.jp-Terminal')));

    // The home crumb carries `/`, which is the server root itself - the empty
    // contents path, not a path below the root.
    const root = await serverRoot(page);
    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toBe(root);
  });

  test('a crumb drag never moves the directory', async ({ page }) => {
    await openFolder(page, CHILD);

    // Dropped on the home crumb, a drag carrying JupyterLab's own contents
    // type would move the directory to the server root. This extension's
    // drags carry their own type for exactly that reason.
    await dragCrumbTo(page, CHILD, await centreOf(crumb(page, '/')));
    await page.waitForTimeout(1000);

    expect(await page.contents.directoryExists(CHILD)).toBe(true);
    expect(await page.contents.directoryExists('crumbchild')).toBe(false);
  });

  test('the master switch stops the drag from starting at all', async ({
    page
  }) => {
    await setPluginSettings(page, { dragDropPathEnabled: false });
    await activateFileBrowser(page);
    await openFolder(page, DIR);
    await openTerminalAndCaptureSends(page);

    // The drop target refuses a disabled drag on its own, so "nothing was
    // inserted" would pass even with the breadcrumbs left draggable. Whether
    // the drag started is the part this asserts: a disabled extension must
    // leave the crumbs exactly as JupyterLab ships them.
    const started = await dragCrumbTo(
      page,
      DIR,
      await centreOf(page.locator('.jp-Terminal'))
    );

    expect(started).toBe(false);
    expect(await sentStdin(page)).toEqual([]);
  });

  test('a crumb drag does not turn on the text selection', async ({ page }) => {
    await openFolder(page, DIR);

    await dragCrumbTo(
      page,
      DIR,
      await centreOf(page.locator('#jp-main-dock-panel'))
    );

    const selected = await page.evaluate(
      () => window.getSelection()?.toString() ?? ''
    );
    expect(selected).toBe('');
  });

  test('a plain click on a crumb still navigates', async ({ page }) => {
    await openFolder(page, CHILD);

    await crumb(page, DIR).click();

    await expect(crumb(page, CHILD)).toHaveCount(0);
    await expect(crumb(page, DIR)).toHaveCount(1);
  });
});
