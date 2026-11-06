/**
 * Shared fixtures of the Galata specs. Names follow docs/design.md: the setting keys of
 * section 7, the command ids of sections 6 and 7, the classes of section 3.
 *
 * Every path a helper takes or returns is a full server path, as `item.path` holds it,
 * for example `${tmpPath}/a/x.txt`. Galata's autoGoto opens the default file browser in
 * `tmpPath`, so that folder is the listing's top folder until a test enters another.
 */
import { expect, IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { JSHandle, Locator } from '@playwright/test';

export const PLUGIN_ID =
  '@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin';

/** Setting keys of `schema/plugin.json`. */
export const SETTING = {
  unfolding: 'folderUnfolding',
  unixSorting: 'unixStyleSorting'
} as const;

/** Command ids; `coreOpenFolderInTerminal` is core's folder-row item. */
export const COMMAND = {
  toggleUnfolding: 'advanced-file-browser:toggle-folder-unfolding',
  toggleUnixSorting: 'advanced-file-browser:toggle-unix-sorting',
  openInTerminal: 'advanced-file-browser:open-in-terminal',
  coreOpenFolderInTerminal: 'terminal:open-folder-in-terminal'
} as const;

/** Timeout of a wait that follows a server round trip (contents fetch, terminal start). */
export const SERVER_TIMEOUT = 15000;

const ROWS = '#filebrowser .jp-DirListing-content > .jp-DirListing-item';
const TOGGLE = '.jp-AdvancedFileBrowser-toggle';

/** One listing row, in screen order. */
export interface IRow {
  path: string;
  name: string;
  /** Number of guide lines; 0 for a row in the top folder and for every row while unfolding is off */
  depth: number;
  isDir: boolean;
  /** Triangle state: true unfolded, false folded, null when the row has no triangle */
  expanded: boolean | null;
  selected: boolean;
}

/**
 * The default file browser (IDefaultFileBrowser, widget id `filebrowser`), read through
 * `window.jupyterapp`.
 */
export async function browserHandle(
  page: IJupyterLabPageFixture
): Promise<JSHandle<any>> {
  return page.evaluateHandle(() => {
    const browser = Array.from(window.jupyterapp.shell.widgets('left')).find(
      widget => widget.id === 'filebrowser'
    );
    if (!browser) {
      throw new Error('no default file browser in the left area');
    }
    return browser as any;
  });
}

/** `model.path` (the current folder) and `model.topPath` (the listing's top folder). */
export async function browserPaths(
  page: IJupyterLabPageFixture
): Promise<{ path: string; topPath: string }> {
  const browser = await browserHandle(page);
  return browser.evaluate(b => ({
    path: b.model.path,
    topPath: b.model.topPath ?? b.model.path
  }));
}

/**
 * Create files and folders under `root` through the contents API, then refresh the
 * browser. An entry ending in `/` is a folder; a file holds its own relative path as text.
 */
export async function seedTree(
  page: IJupyterLabPageFixture,
  root: string,
  entries: string[]
): Promise<void> {
  for (const entry of entries) {
    const path = `${root}/${entry.replace(/\/$/, '')}`;
    const ok = entry.endsWith('/')
      ? await page.contents.createDirectory(path)
      : await page.contents.uploadContent(entry, 'text', path);
    if (!ok) {
      throw new Error(`seedTree: could not create ${path}`);
    }
  }
  await page.filebrowser.refresh();
}

/**
 * Set a setting of this extension through the settings registry, then wait until the
 * default browser applies it (`model.unfolding`, `itemOrder`).
 */
export async function setSetting(
  page: IJupyterLabPageFixture,
  key: (typeof SETTING)[keyof typeof SETTING],
  value: boolean
): Promise<void> {
  await page.evaluate(
    async ({ id, key, value }) => {
      const registry: any = await window.galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      await registry.set(id, key, value);
    },
    { id: PLUGIN_ID, key, value }
  );
  const browser = await browserHandle(page);
  await expect
    .poll(() =>
      browser.evaluate(
        (b, key) =>
          key === 'folderUnfolding' ? b.model.unfolding : b.itemOrder !== null,
        key
      )
    )
    .toBe(value);
}

export const setUnfolding = (page: IJupyterLabPageFixture, on: boolean) =>
  setSetting(page, SETTING.unfolding, on);

export const setUnixSorting = (page: IJupyterLabPageFixture, on: boolean) =>
  setSetting(page, SETTING.unixSorting, on);

/**
 * The listing rows in screen order. Waits for the render that follows the last sort, so
 * each DOM row pairs with `listing.sortedItems()` by index.
 */
export async function visibleRows(
  page: IJupyterLabPageFixture
): Promise<IRow[]> {
  const browser = await browserHandle(page);
  return browser.evaluate(async (b, toggleSelector) => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    for (let attempt = 0; attempt < 60; attempt++) {
      await frame();
      const items: any[] = Array.from(b.listing.sortedItems());
      const nodes: HTMLElement[] = Array.from(
        b.listing.contentNode.querySelectorAll(':scope > .jp-DirListing-item')
      );
      if (nodes.length !== items.length) {
        continue;
      }
      return nodes.map((node, i) => {
        const toggle = node.querySelector(toggleSelector);
        return {
          path: items[i].path as string,
          name:
            node.querySelector('.jp-DirListing-itemText')?.textContent ?? '',
          depth: node.querySelectorAll('.jp-AdvancedFileBrowser-guide').length,
          isDir: node.dataset.isdir === 'true',
          expanded: toggle
            ? toggle.classList.contains('jp-mod-expanded')
            : null,
          selected: node.classList.contains('jp-mod-selected')
        };
      });
    }
    throw new Error('the listing rows did not match sortedItems()');
  }, TOGGLE);
}

/** The row of `path`, once it is listed. */
export async function rowLocator(
  page: IJupyterLabPageFixture,
  path: string
): Promise<Locator> {
  let index = -1;
  await expect
    .poll(
      async () => {
        index = (await visibleRows(page)).findIndex(row => row.path === path);
        return index;
      },
      { message: `row ${path}`, timeout: SERVER_TIMEOUT }
    )
    .toBeGreaterThanOrEqual(0);
  return page.locator(ROWS).nth(index);
}

/** Click the triangle of the folder row `path`. */
export async function clickTriangle(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await (await rowLocator(page, path)).locator(TOGGLE).click();
}

/**
 * Unfold `path` and every folder between it and the top folder by their triangles,
 * waiting for each to show unfolded. Needs unfolding on.
 */
export async function unfold(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  const { topPath } = await browserPaths(page);
  const rel = topPath ? path.slice(topPath.length + 1) : path;
  let current = topPath;
  for (const segment of rel.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    const row = (await visibleRows(page)).find(r => r.path === current);
    if (row?.expanded) {
      continue;
    }
    await clickTriangle(page, current);
    const target = current;
    await expect
      .poll(
        async () =>
          (await visibleRows(page)).find(r => r.path === target)?.expanded,
        { message: `unfold ${target}`, timeout: SERVER_TIMEOUT }
      )
      .toBe(true);
  }
}

/**
 * Drag the row `from` by its name with the mouse and drop it on the row `to`. `ctrl`
 * holds Control from the press to the drop: the press toggles the selection of `from`,
 * and the drop copies instead of moving.
 */
export async function dragRow(
  page: IJupyterLabPageFixture,
  from: string,
  to: string,
  ctrl = false
): Promise<void> {
  const centre = async (path: string) => {
    const box = (await (
      await rowLocator(page, path)
    )
      .locator('.jp-DirListing-itemText')
      .boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const start = await centre(from);
  const end = await centre(to);
  await page.mouse.move(start.x, start.y);
  if (ctrl) {
    await page.keyboard.down('Control');
  }
  await page.mouse.down();
  // Past the listing's 5 px drag threshold, then onto the target row
  await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  if (ctrl) {
    await page.keyboard.up('Control');
  }
}

/** Right-click `target` and return the context menu it opens. */
export async function openMenu(
  page: IJupyterLabPageFixture,
  target: Locator,
  position?: { x: number; y: number }
): Promise<Locator> {
  await target.click({ button: 'right', position });
  const menu = page.locator('.lm-Menu').first();
  await expect(menu).toBeVisible();
  return menu;
}

/** The context menu of the column header (`.jp-DirListing-header`). */
export async function openHeaderMenu(
  page: IJupyterLabPageFixture
): Promise<Locator> {
  return openMenu(page, page.locator('#filebrowser .jp-DirListing-header'));
}

/** The context menu of the row `path`. */
export async function openItemMenu(
  page: IJupyterLabPageFixture,
  path: string
): Promise<Locator> {
  return openMenu(page, await rowLocator(page, path));
}

/** A point of the listing below the last row; the listing must not be full. */
async function emptyArea(
  page: IJupyterLabPageFixture
): Promise<{ content: Locator; position: { x: number; y: number } }> {
  const content = page.locator('#filebrowser .jp-DirListing-content');
  const box = await content.boundingBox();
  if (!box) {
    throw new Error('the listing is not visible');
  }
  return { content, position: { x: box.width / 2, y: box.height - 8 } };
}

/** Left-click the empty area below the rows. */
export async function clickEmptyArea(
  page: IJupyterLabPageFixture
): Promise<void> {
  const { content, position } = await emptyArea(page);
  await content.click({ position });
}

/** The context menu of the empty area below the rows. */
export async function openEmptyAreaMenu(
  page: IJupyterLabPageFixture
): Promise<Locator> {
  const { content, position } = await emptyArea(page);
  return openMenu(page, content, position);
}

/**
 * The item of `command` in an open menu. Lumino keeps a hidden item in the DOM with
 * `lm-mod-hidden`, so assert absence with toBeHidden(), never a count; a checked item
 * carries `lm-mod-toggled` and `aria-checked="true"`.
 */
export function menuItem(menu: Locator, command: string): Locator {
  return menu.locator(`li.lm-Menu-item[data-command="${command}"]`);
}

/**
 * The working folder of the terminal in the current main-area tab, relative to the
 * server root ('' at the root; an absolute path when it lies outside the root). It
 * prints `$PWD` through the terminal's own session.
 */
export async function terminalCwd(
  page: IJupyterLabPageFixture
): Promise<string> {
  await page.waitForFunction(
    () => (window.jupyterapp.shell.currentWidget as any)?.content?.session,
    undefined,
    { timeout: SERVER_TIMEOUT }
  );
  const cwd = await page.evaluate(
    timeout =>
      new Promise<string>((resolve, reject) => {
        const session = (window.jupyterapp.shell.currentWidget as any).content
          .session;
        let out = '';
        const onMessage = (_: unknown, msg: any) => {
          if (msg.type !== 'stdout') {
            return;
          }
          out += msg.content[0];
          // The echoed command shows `CWD<%s>`; only the printed line has a path
          const match = /CWD<(\/[^>]*)>/.exec(out);
          if (match) {
            session.messageReceived.disconnect(onMessage);
            clearTimeout(timer);
            resolve(match[1]);
          }
        };
        const timer = setTimeout(() => {
          session.messageReceived.disconnect(onMessage);
          reject(new Error(`no working folder in the terminal output: ${out}`));
        }, timeout);
        session.messageReceived.connect(onMessage);
        session.send({
          type: 'stdin',
          content: ['printf "CWD<%s>\\n" "$PWD"\r']
        });
      }),
    SERVER_TIMEOUT
  );
  const root: string = await page.evaluate(
    () =>
      JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
        .serverRoot
  );
  if (cwd === root) {
    return '';
  }
  return cwd.startsWith(`${root}/`) ? cwd.slice(root.length + 1) : cwd;
}
