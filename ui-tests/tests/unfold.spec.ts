/**
 * Folder unfolding, category UNFOLD of docs/acc-crit.md; titles from docs/design.md section 11.
 * Galata gives every test fresh in-memory settings and state, kept across a page reload.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';

import {
  browserHandle,
  browserPaths,
  clickTriangle,
  dragRow,
  IRow,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

const TOGGLE = '.jp-AdvancedFileBrowser-toggle';
const INDENT = '.jp-AdvancedFileBrowser-indent';
const ICON = '.jp-DirListing-itemIcon svg[data-icon]';
const TEXT = '.jp-DirListing-itemText';
const OPEN_ICON = 'jupyterlab-advanced-file-browser-extension:folder-open';
const CLOSED_ICON = 'ui-components:folder';
const BROWSER_PLUGIN = '@jupyterlab/filebrowser-extension:browser';
/** The file browser polls the server every 10 s; a change made outside the page shows on the next poll. */
const POLL_TIMEOUT = 20000;

test.beforeEach(async ({ page }) => {
  await setUnfolding(page, true);
});

/** The visible rows, with paths relative to `root`. */
async function rows(
  page: IJupyterLabPageFixture,
  root: string
): Promise<IRow[]> {
  return (await visibleRows(page)).map(row => ({
    ...row,
    path: row.path.slice(root.length + 1)
  }));
}

/** The relative paths of the visible rows, in screen order. */
async function paths(
  page: IJupyterLabPageFixture,
  root: string
): Promise<string[]> {
  return (await rows(page, root)).map(row => row.path);
}

/** Set a setting of core's file browser through the settings registry. */
async function setBrowserSetting(
  page: IJupyterLabPageFixture,
  key: string,
  value: boolean
): Promise<void> {
  await page.evaluate(
    async ({ id, key, value }) => {
      const registry: any = await window.galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      await registry.set(id, key, value);
    },
    { id: BROWSER_PLUGIN, key, value }
  );
}

test('ACC-UNFOLD-1-TRIANGLE triangle on the folder row only', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'b.txt']);
  await expect
    .poll(async () =>
      (await rows(page, tmpPath)).map(r => [r.path, r.expanded])
    )
    .toEqual([
      ['a', false],
      ['b.txt', null]
    ]);

  const folder = await rowLocator(page, `${tmpPath}/a`);
  await expect(folder.locator(TOGGLE)).toBeVisible();
  const toggle = await folder.locator(TOGGLE).boundingBox();
  const icon = await folder.locator('.jp-DirListing-itemIcon').boundingBox();
  expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(icon!.x);

  const file = await rowLocator(page, `${tmpPath}/b.txt`);
  await expect(file.locator(TOGGLE)).toBeHidden();
});

test('ACC-UNFOLD-2-EXPAND triangle click shows the children below the folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await clickTriangle(page, `${tmpPath}/a`);
  await expect
    .poll(async () => (await rows(page, tmpPath)).map(r => [r.path, r.depth]))
    .toEqual([
      ['a', 0],
      ['a/x.txt', 1],
      ['b.txt', 0]
    ]);
});

test('ACC-UNFOLD-3-COLLAPSE triangle click removes the child rows at every depth', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'a/',
    'a/x.txt',
    'a/b/',
    'a/b/y.txt',
    'c.txt'
  ]);
  await unfold(page, `${tmpPath}/a/b`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/b', 'a/b/y.txt', 'a/x.txt', 'c.txt']);

  await clickTriangle(page, `${tmpPath}/a`);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a', 'c.txt']);
  const rowA = (await rows(page, tmpPath)).find(r => r.path === 'a');
  expect(rowA?.expanded).toBe(false);
});

test('ACC-UNFOLD-4-DEPTH folders unfold to depth 3', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/b/c/', 'a/b/c/f.txt']);
  await unfold(page, `${tmpPath}/a/b/c`);
  await expect
    .poll(async () => (await rows(page, tmpPath)).map(r => [r.path, r.depth]))
    .toEqual([
      ['a', 0],
      ['a/b', 1],
      ['a/b/c', 2],
      ['a/b/c/f.txt', 3]
    ]);
});

test('ACC-UNFOLD-5-ENTER double-click on a nested folder enters it', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/b/c/', 'a/b/x.txt', 'd.txt']);
  await unfold(page, `${tmpPath}/a`);
  await (await rowLocator(page, `${tmpPath}/a/b`)).locator(TEXT).dblclick();

  await expect
    .poll(async () => (await browserPaths(page)).topPath, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(`${tmpPath}/a/b`);
  await expect
    .poll(async () => (await visibleRows(page)).map(r => [r.path, r.depth]))
    .toEqual([
      [`${tmpPath}/a/b/c`, 0],
      [`${tmpPath}/a/b/x.txt`, 0]
    ]);
});

test('ACC-UNFOLD-6-NOENTER triangle click keeps the top folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await unfold(page, `${tmpPath}/a`);

  const listed = await rows(page, tmpPath);
  expect(listed[0].path).toBe('a');
  expect(listed[0].depth).toBe(0);
  expect(await browserPaths(page)).toEqual({
    path: tmpPath,
    topPath: tmpPath
  });
});

test('ACC-UNFOLD-7-OPENFILE double-click opens a nested file', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt']);
  await unfold(page, `${tmpPath}/a`);
  await (await rowLocator(page, `${tmpPath}/a/x.txt`)).locator(TEXT).dblclick();

  await page.waitForFunction(
    path =>
      Array.from(window.jupyterapp.shell.widgets('main')).some(
        (widget: any) => widget.context?.path === path
      ),
    `${tmpPath}/a/x.txt`,
    { timeout: SERVER_TIMEOUT }
  );
  await expect(
    page.locator('#jp-main-dock-panel .lm-TabBar-tab', { hasText: 'x.txt' })
  ).toBeVisible();
});

test('ACC-UNFOLD-8-INDENT guide lines and indent follow the depth', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'a/b/', 'a/b/x.txt']);
  await unfold(page, `${tmpPath}/a/b`);

  const listed = await rows(page, tmpPath);
  const depth = (path: string) => listed.find(r => r.path === path)?.depth;
  expect(depth('a')).toBe(0);
  expect(depth('a/x.txt')).toBe(1);
  expect(depth('a/b/x.txt')).toBe(2);

  const measure = async (path: string) => {
    const row = await rowLocator(page, `${tmpPath}/${path}`);
    const indent = await row.locator(INDENT).boundingBox();
    const text = await row.locator(TEXT).boundingBox();
    return { indent: indent!.width, text: text!.x };
  };
  const top = await measure('a');
  const one = await measure('a/x.txt');
  const two = await measure('a/b/x.txt');
  expect(top.indent).toBe(0);
  expect(one.indent).toBeGreaterThan(0);
  expect(two.indent).toBeCloseTo(2 * one.indent, 0);
  // The indent moves the name: one level further in, the name starts one indent further right
  expect(two.text - one.text).toBeCloseTo(one.indent, 0);
});

test('ACC-UNFOLD-9-OPENICON open-folder icon on unfolded folders only', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/', 'b/y.txt']);
  await unfold(page, `${tmpPath}/a`);

  await expect(
    (await rowLocator(page, `${tmpPath}/a`)).locator(ICON)
  ).toHaveAttribute('data-icon', OPEN_ICON);
  await expect(
    (await rowLocator(page, `${tmpPath}/b`)).locator(ICON)
  ).toHaveAttribute('data-icon', CLOSED_ICON);
});

test('ACC-UNFOLD-10-POINTS triangle state follows the fold state', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/', 'b/y.txt']);
  await unfold(page, `${tmpPath}/a`);

  const toggleA = (await rowLocator(page, `${tmpPath}/a`)).locator(TOGGLE);
  await expect(toggleA).toHaveText('▾');
  await expect(toggleA).toHaveClass(/jp-mod-expanded/);
  const toggleB = (await rowLocator(page, `${tmpPath}/b`)).locator(TOGGLE);
  await expect(toggleB).toHaveText('▸');
  await expect(toggleB).not.toHaveClass(/jp-mod-expanded/);
});

test('ACC-UNFOLD-11-REFRESH a file created inside an unfolded folder appears on refresh', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await unfold(page, `${tmpPath}/a`);

  // Through the server, so only the browser's own poll can show it
  expect(
    await page.contents.uploadContent('new', 'text', `${tmpPath}/a/new.txt`)
  ).toBe(true);
  await expect
    .poll(async () => (await rows(page, tmpPath)).map(r => [r.path, r.depth]), {
      timeout: POLL_TIMEOUT
    })
    .toEqual([
      ['a', 0],
      ['a/new.txt', 1],
      ['a/x.txt', 1],
      ['b.txt', 0]
    ]);
});

test('ACC-UNFOLD-12-PERSIST unfolded folders survive a reload', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/b/x.txt', 'c/']);
  await unfold(page, `${tmpPath}/a`);
  // The workspace is saved after a debounce; reload only once it holds both folders
  const saved = page.waitForRequest(
    request => {
      if (
        request.method() !== 'PUT' ||
        !/\/api\/workspaces/.test(request.url())
      ) {
        return false;
      }
      const stored =
        request.postDataJSON()?.data?.[
          'advanced-file-browser:filebrowser:unfolded'
        ]?.paths ?? [];
      return (
        stored.includes(`${tmpPath}/a`) && stored.includes(`${tmpPath}/a/b`)
      );
    },
    { timeout: SERVER_TIMEOUT }
  );
  await unfold(page, `${tmpPath}/a/b`);
  await saved;

  await page.reload();
  await expect
    .poll(
      async () => (await rows(page, tmpPath)).map(r => [r.path, r.expanded]),
      { timeout: SERVER_TIMEOUT }
    )
    .toEqual([
      ['a', true],
      ['a/b', true],
      ['a/b/x.txt', null],
      ['c', false]
    ]);
});

test('ACC-UNFOLD-13-RETURN unfolded folders survive entering another folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b/', 'b/z.txt']);
  await unfold(page, `${tmpPath}/a`);

  await (await rowLocator(page, `${tmpPath}/b`)).locator(TEXT).dblclick();
  await expect
    .poll(async () => (await browserPaths(page)).topPath, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(`${tmpPath}/b`);

  await page
    .locator(`#filebrowser .jp-BreadCrumbs-item[data-path="${tmpPath}"]`)
    .click();
  await expect
    .poll(async () => (await browserPaths(page)).topPath, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(tmpPath);
  await expect
    .poll(
      async () => (await rows(page, tmpPath)).map(r => [r.path, r.expanded]),
      { timeout: SERVER_TIMEOUT }
    )
    .toEqual([
      ['a', true],
      ['a/x.txt', null],
      ['b', false]
    ]);
});

test('ACC-UNFOLD-14-GONE a deleted unfolded folder leaves without a dialog', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await unfold(page, `${tmpPath}/a`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/x.txt', 'b.txt']);

  expect(await page.contents.deleteDirectory(`${tmpPath}/a`)).toBe(true);
  await page.filebrowser.refresh();
  await expect
    .poll(() => paths(page, tmpPath), { timeout: SERVER_TIMEOUT })
    .toEqual(['b.txt']);
  await expect(page.locator('.jp-Dialog')).toBeHidden();
});

test('ACC-UNFOLD-15-EMPTYDIR an empty folder unfolds to no rows', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['e/', 'f.txt']);
  await clickTriangle(page, `${tmpPath}/e`);

  await expect
    .poll(
      async () => (await rows(page, tmpPath)).map(r => [r.path, r.expanded]),
      { timeout: SERVER_TIMEOUT }
    )
    .toEqual([
      ['e', true],
      ['f.txt', null]
    ]);
  await expect(
    (await rowLocator(page, `${tmpPath}/e`)).locator(TOGGLE)
  ).toHaveText('▾');
});

test('ACC-UNFOLD-16-DROP drop on a nested folder row moves the file into it', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a', 'a/b', 'x.txt']);

  const from = (await (
    await rowLocator(page, `${tmpPath}/x.txt`)
  )
    .locator(TEXT)
    .boundingBox())!;
  const to = (await (
    await rowLocator(page, `${tmpPath}/a/b`)
  )
    .locator(TEXT)
    .boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Past the listing's 5 px drag threshold, then onto the a/b row
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 10
  });
  await page.mouse.up();

  await expect
    .poll(() => page.contents.fileExists(`${tmpPath}/a/b/x.txt`), {
      timeout: SERVER_TIMEOUT
    })
    .toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/x.txt`)).toBe(false);
});

test('ACC-UNFOLD-78-SELFDROP a folder Ctrl-dropped on its own row stays', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'a/x.txt']);
  await unfold(page, `${tmpPath}/a`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/b', 'a/x.txt']);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && request.url().includes('/api/contents')) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  // Stock lm-dragenter takes a drop only on a folder row that is not selected. Each Ctrl
  // press toggles a: selected for the drop on a/b, unselected for the drop on its own row.
  // A file row never takes the drop, so the drop on a/x.txt reaches no listing.
  for (const target of ['a/b', 'a', 'a/x.txt']) {
    await dragRow(page, `${tmpPath}/a`, `${tmpPath}/${target}`, true);
    // A refresh sent after the drop answers after any request the drop sent
    await (await browserHandle(page)).evaluate(b => b.model.refresh());
    expect(writes, `drop on ${target}`).toEqual([]);
  }
  expect(await page.contents.directoryExists(`${tmpPath}/a/b/a`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a/a`)).toBe(false);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});

test('DEF-UNFOLD-18-DROP-HIGHLIGHT a dragged folder does not highlight its own subfolder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/b/', 'c/']);
  await unfold(page, `${tmpPath}/a`);
  const rowB = await rowLocator(page, `${tmpPath}/a/b`);
  const rowC = await rowLocator(page, `${tmpPath}/c`);
  const centre = async (row: Locator) => {
    const box = (await row.locator(TEXT).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const start = await centre(await rowLocator(page, `${tmpPath}/a`));
  const sub = await centre(rowB);
  const other = await centre(rowC);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Past the listing's 5 px drag threshold, then onto c, a folder that takes the drop
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
  await page.mouse.move(other.x, other.y, { steps: 10 });
  await expect(rowC).toHaveClass(/jp-mod-dropTarget/);
  await page.mouse.move(sub.x, sub.y, { steps: 10 });
  await expect(rowB).not.toHaveClass(/jp-mod-dropTarget/);
  await page.mouse.up();
});

test('ACC-UNFOLD-80-LEFTKEY Left goes to the parent folder, then folds it', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await unfold(page, `${tmpPath}/a`);
  await (await rowLocator(page, `${tmpPath}/a/x.txt`)).click();
  const selected = async () =>
    (await rows(page, tmpPath)).filter(r => r.selected).map(r => r.path);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(selected).toEqual(['a']);
  expect((await rows(page, tmpPath)).find(r => r.path === 'a')?.expanded).toBe(
    true
  );
  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a`);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a', 'b.txt']);
  expect(await selected()).toEqual(['a']);

  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/x.txt', 'b.txt']);

  // A held Left folds once: the auto-repeat keydown must not cancel the fold.
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(300);
  expect(await paths(page, tmpPath)).toEqual(['a', 'b.txt']);
  expect((await rows(page, tmpPath)).find(r => r.path === 'a')?.expanded).toBe(
    false
  );
});

test('ACC-UNFOLD-85-RIGHTKEY Right goes to the first child of an unfolded folder', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'e/', 'b.txt']);
  await unfold(page, `${tmpPath}/a`);
  await unfold(page, `${tmpPath}/e`);
  await (await rowLocator(page, `${tmpPath}/a`)).click();
  const selected = async () =>
    (await rows(page, tmpPath)).filter(r => r.selected).map(r => r.path);

  await page.keyboard.press('ArrowRight');
  await expect.poll(selected).toEqual(['a/x.txt']);
  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a`);

  // The focus moved with the selection, so Left on the child goes back to a.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(selected).toEqual(['a']);

  // An unfolded empty folder has no first child.
  await (await rowLocator(page, `${tmpPath}/e`)).click();
  await page.keyboard.press('ArrowRight');
  expect(await selected()).toEqual(['e']);
  expect(await paths(page, tmpPath)).toEqual(['a', 'a/x.txt', 'e', 'b.txt']);
  expect((await browserPaths(page)).path).toBe(`${tmpPath}/e`);
});

test('ACC-UNFOLD-84-HITAREA triangle reacts on the full row height', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  const row = await rowLocator(page, `${tmpPath}/a`);
  const box = (await row.boundingBox())!;
  const toggle = (await row.locator(TOGGLE).boundingBox())!;
  const x = toggle.x + toggle.width / 2;
  const top = box.y + 2;
  const listed = async () =>
    (await rows(page, tmpPath)).map(r => [r.path, r.expanded, r.selected]);

  await page.mouse.click(x, top);
  await expect.poll(listed).toEqual([
    ['a', true, false],
    ['a/x.txt', null, false],
    ['b.txt', null, false]
  ]);

  await page.mouse.click(x, box.y + box.height - 2);
  await expect.poll(listed).toEqual([
    ['a', false, false],
    ['b.txt', null, false]
  ]);

  // The two presses unfold and fold a; the refresh waits for a navigation the double-click started.
  await page.mouse.dblclick(x, top);
  await (await browserHandle(page)).evaluate(b => b.model.refresh());
  expect(await browserPaths(page)).toEqual({ path: tmpPath, topPath: tmpPath });
});

test('ACC-UNFOLD-17-SORTHEAD header sort orders every level', async ({
  page,
  tmpPath
}) => {
  // Creation order differs from name order in both directions, so a sort by name cannot pass
  await seedTree(page, tmpPath, [
    'y.txt',
    'z.txt',
    'x.txt',
    'a/',
    'a/q.txt',
    'a/r.txt',
    'a/p.txt'
  ]);
  await unfold(page, `${tmpPath}/a`);

  const header = page.locator(
    '#filebrowser .jp-DirListing-header .jp-id-modified'
  );
  const browser = await browserHandle(page);
  for (const direction of ['ascending', 'descending']) {
    await header.click();
    await expect
      .poll(() => browser.evaluate(b => b.listing.sortState))
      .toEqual({ direction, key: 'last_modified' });
  }

  const listed = await rows(page, tmpPath);
  const items: { path: string; name: string; dir: boolean; time: number }[] =
    await browser.evaluate((b, root) => {
      return Array.from(b.listing.sortedItems()).map((item: any) => ({
        path: item.path.slice(root.length + 1),
        name: item.name,
        dir: item.type === 'directory',
        time: new Date(item.last_modified).getTime()
      }));
    }, tmpPath);
  // The screen shows the rows in the listing's order
  expect(listed.map(r => r.name)).toEqual(items.map(i => i.name));

  // JupyterLab 4.6's own comparator (DirListing Private.sort): folders first, then
  // (a - b) * (descending ? 1 : -1) on the time, so descending lists the oldest first
  const stockDescending = (level: typeof items) =>
    [...level]
      .sort((x, y) =>
        x.dir !== y.dir ? Number(y.dir) - Number(x.dir) : x.time - y.time
      )
      .map(i => i.path);
  const level = (parent: string) =>
    items.filter(i => i.path.split('/').slice(0, -1).join('/') === parent);
  for (const parent of ['', 'a']) {
    const files = level(parent).filter(i => !i.dir);
    expect(new Set(files.map(i => i.time)).size).toBe(files.length);
  }
  const top = level('');
  const inA = level('a');
  expect(top.map(i => i.path)).toEqual(stockDescending(top));
  expect(inA.map(i => i.path)).toEqual(stockDescending(inA));
  expect(top.map(i => i.path)).toEqual(['a', 'y.txt', 'z.txt', 'x.txt']);
  expect(inA.map(i => i.path)).toEqual(['a/q.txt', 'a/r.txt', 'a/p.txt']);
  // Children directly under their folder
  expect(items.map(i => i.path)).toEqual([
    'a',
    'a/q.txt',
    'a/r.txt',
    'a/p.txt',
    'y.txt',
    'z.txt',
    'x.txt'
  ]);
});

test('ACC-UNFOLD-19-HIDDEN hidden files follow the setting at every depth', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/.h', 'a/v.txt']);
  await unfold(page, `${tmpPath}/a`);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a', 'a/v.txt']);

  await setBrowserSetting(page, 'showHiddenFiles', true);
  await expect
    .poll(async () => (await rows(page, tmpPath)).map(r => [r.path, r.depth]), {
      timeout: SERVER_TIMEOUT
    })
    .toEqual([
      ['a', 0],
      ['a/.h', 1],
      ['a/v.txt', 1]
    ]);
});

test('ACC-UNFOLD-20-COLUMNS nested rows show the columns of top rows', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'x.txt']);
  await unfold(page, `${tmpPath}/a`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/x.txt', 'x.txt']);

  const columns: [string, string][] = [
    ['showLastModifiedColumn', '.jp-DirListing-itemModified'],
    ['showFileSizeColumn', '.jp-DirListing-itemFileSize'],
    ['showDateCreatedColumn', '.jp-DirListing-itemCreated'],
    ['showFileCheckboxes', '.jp-DirListing-checkboxWrapper']
  ];
  const nested = await rowLocator(page, `${tmpPath}/a/x.txt`);
  const top = await rowLocator(page, `${tmpPath}/x.txt`);
  for (const [key, cell] of columns) {
    for (const shown of [true, false]) {
      await setBrowserSetting(page, key, shown);
      for (const row of [top, nested]) {
        // Core shows a row's checkbox only while the pointer is over the row
        await row.hover();
        if (shown) {
          await expect(row.locator(cell), `${key} on`).toBeVisible();
        } else {
          await expect(row.locator(cell), `${key} off`).toHaveCount(0);
        }
      }
    }
  }
});

test('DEF-UNFOLD-26-TOGGLE one press toggles the pressed folder and keeps its row in place', async ({
  page,
  tmpPath
}) => {
  // A live lab also holds the replaced sorting extension; run it with --venv /opt/conda
  await seedTree(page, tmpPath, [
    'alpha/',
    'beta/',
    'zeta/',
    'zeta/aaa/',
    'x.txt'
  ]);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['alpha', 'beta', 'zeta', 'x.txt']);

  const row = await rowLocator(page, `${tmpPath}/zeta`);
  const point = await row.evaluate((element, selector) => {
    const toggle = element.querySelector(selector)!;
    const box = toggle.getBoundingClientRect();
    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      top: element.getBoundingClientRect().top
    };
  }, TOGGLE);

  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () => (await rows(page, tmpPath)).map(r => [r.path, r.depth]))
    .toEqual([
      ['alpha', 0],
      ['beta', 0],
      ['zeta', 0],
      ['zeta/aaa', 1],
      ['x.txt', 0]
    ]);
  expect(
    (await rows(page, tmpPath)).find(r => r.path === 'zeta')?.expanded
  ).toBe(true);
  const top = await (
    await rowLocator(page, `${tmpPath}/zeta`)
  ).evaluate(element => element.getBoundingClientRect().top);
  expect(top).toBeCloseTo(point.top, 0);

  // The point still hits zeta's triangle: the second press folds zeta, beta stays folded
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(async () =>
      (await rows(page, tmpPath)).map(r => [r.path, r.expanded])
    )
    .toEqual([
      ['alpha', false],
      ['beta', false],
      ['zeta', false],
      ['x.txt', null]
    ]);
});

test('DEF-UNFOLD-27-KEEPPOS unfolding near the bottom keeps the row and the scroll offset', async ({
  page,
  tmpPath
}) => {
  // A live lab also holds the replaced sorting extension; run it with --venv /opt/conda
  const folders = Array.from(
    { length: 40 },
    (_, index) => `m${String(index).padStart(2, '0')}/`
  );
  await seedTree(page, tmpPath, [...folders, 'zeta/', 'zeta/aaa/']);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual([...folders.map(folder => folder.slice(0, -1)), 'zeta']);

  const content = page.locator('#filebrowser .jp-DirListing-content');
  await content.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });

  const row = await rowLocator(page, `${tmpPath}/zeta`);
  const before = await row.evaluate((element, selector) => {
    const toggle = element.querySelector(selector)!;
    const box = toggle.getBoundingClientRect();
    return {
      top: element.getBoundingClientRect().top,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    };
  }, TOGGLE);
  const scrollTop = await content.evaluate(element => element.scrollTop);

  await page.mouse.click(before.x, before.y);
  await expect
    .poll(
      async () =>
        (await rows(page, tmpPath)).find(r => r.path === 'zeta')?.expanded
    )
    .toBe(true);

  const top = await (
    await rowLocator(page, `${tmpPath}/zeta`)
  ).evaluate(element => element.getBoundingClientRect().top);
  expect(top).toBeCloseTo(before.top, 0);
  expect(await content.evaluate(element => element.scrollTop)).toBe(scrollTop);
});

test('ACC-UNFOLD-21-FILTER filter keeps matches and their folders at every depth', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/y.txt', 'a/b/', 'a/b/x.txt']);
  await unfold(page, `${tmpPath}/a/b`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/b', 'a/b/x.txt', 'a/y.txt']);

  await page
    .locator(
      '#filebrowser .jp-ToolbarButtonComponent[data-command="filebrowser:toggle-file-filter"]'
    )
    .click();
  // `x.`, not `x`: a bare x also matches y.txt through its extension
  await page.locator('#filebrowser .jp-FileBrowser-filterBox input').fill('x.');
  await expect
    .poll(() => paths(page, tmpPath), { timeout: SERVER_TIMEOUT })
    .toEqual(['a', 'a/b', 'a/b/x.txt']);
});

test('DEF-UNFOLD-28-NOEXTRA unfolding a folded folder leaves the folders below it folded', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'a/',
    'a/b/',
    'a/b/c/',
    'a/b/c/x.txt',
    'a/b/y.txt',
    'a/z.txt',
    'd.txt'
  ]);
  await unfold(page, `${tmpPath}/a/b`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['a', 'a/b', 'a/b/c', 'a/b/y.txt', 'a/z.txt', 'd.txt']);

  // Folding a drops its rows; nothing below it stays unfolded
  await clickTriangle(page, `${tmpPath}/a`);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a', 'd.txt']);

  await clickTriangle(page, `${tmpPath}/a`);
  await expect
    .poll(async () =>
      (await rows(page, tmpPath)).map(r => [r.path, r.expanded])
    )
    .toEqual([
      ['a', true],
      ['a/b', false],
      ['a/z.txt', null],
      ['d.txt', null]
    ]);
});

interface IRowState {
  height: number;
  top: number;
  animations: { duration: number; playState: string }[];
}

interface IFrame {
  time: number;
  rows: { path: string | null; animations: IRowState['animations'] }[];
}

/** Read one listing row's layout and animations, paired by index to sortedItems(). */
async function installRowState(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(() => {
    const state = window as any;
    state.__rowState = (path: string): IRowState | null => {
      const browser = Array.from(state.jupyterapp.shell.widgets('left')).find(
        (widget: any) => widget.id === 'filebrowser'
      ) as any;
      const items: any[] = browser
        ? Array.from(browser.listing.sortedItems())
        : [];
      const nodes: HTMLElement[] = browser
        ? Array.from(
            browser.listing.contentNode.querySelectorAll(
              ':scope > .jp-DirListing-item'
            )
          )
        : [];
      if (nodes.length !== items.length) {
        return null;
      }
      const index = items.findIndex((item: any) => item.path === path);
      const node = nodes[index];
      if (index === -1 || !node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        height: rect.height,
        top: rect.top,
        animations: node.getAnimations().map((animation: any) => ({
          duration: animation.effect.getTiming().duration as number,
          playState: animation.playState as string
        }))
      };
    };
  });
}

const rowState = (page: IJupyterLabPageFixture, path: string) =>
  page.evaluate(
    target => (window as any).__rowState(target) as IRowState | null,
    path
  );

/** Record every listing row once per animation frame until stopFrames. */
async function startFrames(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(() => {
    const state = window as any;
    state.__frames = [];
    state.__framesStopped = false;
    const tick = (): void => {
      if (state.__framesStopped || state.__frames.length > 1200) {
        return;
      }
      const browser = Array.from(state.jupyterapp.shell.widgets('left')).find(
        (widget: any) => widget.id === 'filebrowser'
      ) as any;
      const items: any[] = browser
        ? Array.from(browser.listing.sortedItems())
        : [];
      const nodes: HTMLElement[] = browser
        ? Array.from(
            browser.listing.contentNode.querySelectorAll(
              ':scope > .jp-DirListing-item'
            )
          )
        : [];
      // A render between two rows: the pairings would be wrong, so skip that frame.
      if (nodes.length === items.length) {
        state.__frames.push({
          time: performance.now(),
          rows: nodes.map((node, index) => ({
            path: items[index]?.path ?? null,
            animations: node.getAnimations().map((animation: any) => ({
              duration: animation.effect.getTiming().duration,
              playState: animation.playState
            }))
          }))
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrames(page: IJupyterLabPageFixture): Promise<IFrame[]> {
  return page.evaluate(() => {
    const state = window as any;
    state.__framesStopped = true;
    return state.__frames as IFrame[];
  });
}

test('ACC-UNFOLD-89-ANIMATE folding and unfolding animate the rows', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['a/', 'a/x.txt']);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['a']);
  const folder = `${tmpPath}/a`;
  const child = `${tmpPath}/a/x.txt`;
  await installRowState(page);
  const before = (await rowState(page, folder))!;

  // Unfold: the child row runs one 160 ms animation, sampled on its own frames.
  await startFrames(page);
  await clickTriangle(page, folder);
  const expand = (await (
    await page.waitForFunction(
      ({ folder, child }) => {
        const state = window as any;
        const folderRow = state.__rowState(folder) as IRowState | null;
        const childRow = state.__rowState(child) as IRowState | null;
        if (!folderRow || !childRow) {
          return null;
        }
        const running = childRow.animations.some(
          animation =>
            animation.playState === 'running' && animation.duration === 160
        );
        if (
          !running ||
          childRow.height <= 0.5 ||
          childRow.height >= folderRow.height - 0.5
        ) {
          return null;
        }
        return {
          top: folderRow.top,
          height: childRow.height,
          settled: folderRow.height
        };
      },
      { folder, child },
      { polling: 'raf', timeout: SERVER_TIMEOUT }
    )
  ).jsonValue()) as { top: number; height: number; settled: number };
  // The folder's own row does not move while its children open below it.
  expect(expand.top).toBeCloseTo(before.top, 0);
  const frames = await stopFrames(page);
  expect(
    frames.some(frame =>
      frame.rows.some(row => row.path === child && row.animations.length > 0)
    )
  ).toBe(true);

  // Settled after 250 ms: the natural height, no animation still running.
  await page.waitForTimeout(250);
  const settled = (await rowState(page, child))!;
  expect(settled.height).toBeGreaterThan(expand.height);
  expect(settled.height).toBeCloseTo(expand.settled, 1);
  expect(
    settled.animations.filter(animation => animation.playState === 'running')
  ).toEqual([]);

  // Fold: one 120 ms animation on the rows below, then they are gone.
  await clickTriangle(page, folder);
  const folding = (await (
    await page.waitForFunction(
      child => {
        const state = window as any;
        const row = state.__rowState(child) as IRowState | null;
        return (
          row?.animations.some(
            animation =>
              animation.playState === 'running' && animation.duration === 120
          ) ?? false
        );
      },
      child,
      { polling: 'raf', timeout: SERVER_TIMEOUT }
    )
  ).jsonValue()) as boolean;
  expect(folding).toBe(true);
  await page.waitForTimeout(250);
  expect(await paths(page, tmpPath)).toEqual(['a']);

  // The motion runs under the operating system's reduced-motion setting.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  ).toBe(true);
  await clickTriangle(page, folder);
  const reduced = (await (
    await page.waitForFunction(
      child => {
        const state = window as any;
        const row = state.__rowState(child) as IRowState | null;
        return (
          row?.animations.some(
            animation =>
              animation.playState === 'running' && animation.duration === 160
          ) ?? false
        );
      },
      child,
      { polling: 'raf', timeout: SERVER_TIMEOUT }
    )
  ).jsonValue()) as boolean;
  expect(reduced).toBe(true);
  await page.waitForTimeout(250);

  // A fold cancelled mid-flight reverses from the collapse's live values, not from rest.
  const cancelOpacity = await page.evaluate(
    async ({ folder, child }) => {
      const state = window as any;
      const browser = Array.from(state.jupyterapp.shell.widgets('left')).find(
        (widget: any) => widget.id === 'filebrowser'
      ) as any;
      const nodes = (): HTMLElement[] =>
        Array.from(
          browser.listing.contentNode.querySelectorAll(
            ':scope > .jp-DirListing-item'
          )
        );
      const index = (path: string): number =>
        Array.from(
          browser.listing.sortedItems(),
          (item: any) => item.path
        ).indexOf(path);
      const toggle = nodes()[index(folder)].querySelector(
        '.jp-AdvancedFileBrowser-toggle'
      ) as HTMLElement;
      const box = toggle.getBoundingClientRect();
      // Two presses 60 ms apart: the second cancels the 120 ms fold.
      const press = (): void => {
        toggle.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: box.x + box.width / 2,
            clientY: box.y + box.height / 2
          })
        );
      };
      press();
      await new Promise(resolve => setTimeout(resolve, 60));
      press();
      const back = nodes()
        [index(child)].getAnimations()
        .find(
          (animation: any) =>
            animation.playState === 'running' &&
            animation.effect.getTiming().duration === 120
        );
      const frames = back?.effect.getKeyframes() ?? [];
      return frames.length ? Number(frames[0].opacity) : -1;
    },
    { folder, child }
  );
  expect(cancelOpacity).toBeLessThan(0.9);
  // Let the reversal finish before the refresh's no-animation window.
  await page.waitForTimeout(250);

  // A refresh repaints the rows without any animation.
  await startFrames(page);
  await page.filebrowser.refresh();
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await page.waitForTimeout(150);
  const refreshed = await stopFrames(page);
  expect(
    refreshed.flatMap(frame =>
      frame.rows.flatMap(row =>
        row.animations.filter(animation => animation.playState === 'running')
      )
    )
  ).toEqual([]);
});

test('DEF-UNFOLD-29-NOTOPCASCADE unfolding a folded top folder leaves the folders below it folded', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'top/',
    'top/one/',
    'top/one/file.txt',
    'top/two/',
    'top/two/file.txt',
    'x.txt'
  ]);
  await unfold(page, `${tmpPath}/top/one`);
  await expect
    .poll(() => paths(page, tmpPath))
    .toEqual(['top', 'top/one', 'top/one/file.txt', 'top/two', 'x.txt']);

  await clickTriangle(page, `${tmpPath}/top`);
  await expect.poll(() => paths(page, tmpPath)).toEqual(['top', 'x.txt']);

  await clickTriangle(page, `${tmpPath}/top`);
  await expect
    .poll(async () =>
      (await rows(page, tmpPath)).map(r => [r.path, r.expanded])
    )
    .toEqual([
      ['top', true],
      ['top/one', false],
      ['top/two', false],
      ['x.txt', null]
    ]);
});
