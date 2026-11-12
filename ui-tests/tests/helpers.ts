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
  crumbOpenInTerminal: 'advanced-file-browser:crumb-open-in-terminal',
  crumbCopyPath: 'advanced-file-browser:crumb-copy-path',
  crumbOpen: 'advanced-file-browser:crumb-open',
  crumbAddToFavourite: 'advanced-file-browser:crumb-add-to-favourite',
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

/*
 * Drag-and-drop path fixtures (docs/acc-crit.md, category DRAG).
 *
 * The file browser drag itself is Lumino's, not this extension's, so the drop drivers
 * below dispatch the same `lm-dragenter`, `lm-dragover` and `lm-drop` events onto the
 * widget node, carrying the `application/x-jupyter-icontents` payload the file browser
 * sets. Everything below the event is the extension's own code running in a real
 * JupyterLab.
 */

/** Fixture the drags point at. */
export const PLAIN_FILE = 'dropme.csv';
/** Carries a space and parentheses, so shell escaping is exercised. */
export const SPACED_FILE = 'my data (1).csv';

/**
 * Payload type the file browser sets on a drag. Duplicated from src/dragPaths.ts by
 * necessity: JupyterLab declares it as a module-private const in
 * filebrowser/lib/listing.js and exports it from no type declaration.
 */
export const CONTENTS_MIME = 'application/x-jupyter-icontents';

/** The plugin wiring the drop targets; the settings live in PLUGIN_ID's schema. */
export const DRAG_PLUGIN_ID =
  '@stellarshenson/jupyterlab-advanced-file-browser-extension:drag-and-drop-path';

/**
 * The absolute server root the page config carries. Unlike the extension this was
 * ported from, no route reports it: the server extension writes it into the page.
 */
export async function serverRoot(
  page: IJupyterLabPageFixture
): Promise<string> {
  return page.evaluate(
    () =>
      JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
        .advancedFileBrowserServerRoot
  );
}

/**
 * Dispatch a sequence of Lumino drag events onto the active main-area widget
 * and return the `dropAction` the last one carried.
 *
 * `'move'` means the extension accepted the drag, `'none'` that it declined.
 */
async function dispatchDrag(
  page: IJupyterLabPageFixture,
  types: string[],
  paths: string[],
  coords?: { x: number; y: number }
): Promise<string> {
  return page.evaluate(
    ({ types, paths, coords, mime }) => {
      const node: HTMLElement = (window as any).jupyterapp.shell.currentWidget
        .node;
      let last: any = null;
      for (const type of types) {
        const event: any = new Event(type, {
          bubbles: true,
          cancelable: true
        });
        event.mimeData = {
          getData: (requested: string) =>
            requested === mime ? paths : undefined
        };
        event.proposedAction = 'move';
        event.dropAction = 'none';
        event.clientX = coords ? coords.x : 0;
        event.clientY = coords ? coords.y : 0;
        node.dispatchEvent(event);
        last = event;
      }
      return last ? last.dropAction : 'none';
    },
    { types, paths, coords, mime: CONTENTS_MIME }
  );
}

/** Dispatch the full drag sequence onto the active main-area widget. */
export async function dropOnCurrentWidget(
  page: IJupyterLabPageFixture,
  paths: string[],
  coords?: { x: number; y: number }
): Promise<void> {
  await dispatchDrag(
    page,
    ['lm-dragenter', 'lm-dragover', 'lm-drop'],
    paths,
    coords
  );
}

/** Dispatch only `lm-dragover` and report the resulting `dropAction`. */
export async function dragOverCurrentWidget(
  page: IJupyterLabPageFixture,
  paths: string[]
): Promise<string> {
  return dispatchDrag(page, ['lm-dragover'], paths);
}

/**
 * Drop onto a widget named by id, leaving focus wherever it currently is.
 *
 * The active-widget test needs this: it must drop on a background terminal
 * while the file browser holds focus, which `dropOnCurrentWidget` cannot do.
 */
export async function dropOnWidgetById(
  page: IJupyterLabPageFixture,
  widgetId: string,
  paths: string[]
): Promise<void> {
  await page.evaluate(
    ({ widgetId, paths, mime }) => {
      const node = document.getElementById(widgetId);
      if (!node) {
        throw new Error(`widget not found: ${widgetId}`);
      }
      const event: any = new Event('lm-drop', {
        bubbles: true,
        cancelable: true
      });
      event.mimeData = {
        getData: (requested: string) => (requested === mime ? paths : undefined)
      };
      event.proposedAction = 'move';
      event.dropAction = 'none';
      event.clientX = 0;
      event.clientY = 0;
      node.dispatchEvent(event);
    },
    { widgetId, paths, mime: CONTENTS_MIME }
  );
}

/** Source text of the active file editor. */
export async function editorSource(
  page: IJupyterLabPageFixture
): Promise<string> {
  return page.evaluate(() => {
    const widget = (window as any).jupyterapp.shell.currentWidget;
    return widget.content.editor.model.sharedModel.getSource();
  });
}

/** Source text of the notebook's active cell. */
export async function activeCellSource(
  page: IJupyterLabPageFixture
): Promise<string> {
  return page.evaluate(() => {
    const widget = (window as any).jupyterapp.shell.currentWidget;
    return widget.content.activeCell.model.sharedModel.getSource();
  });
}

/** Every cell's source, in order. */
export async function allCellSources(
  page: IJupyterLabPageFixture
): Promise<string[]> {
  return page.evaluate(() => {
    const model = (window as any).jupyterapp.shell.currentWidget.content.model;
    const out: string[] = [];
    for (let i = 0; i < model.cells.length; i++) {
      out.push(model.cells.get(i).sharedModel.getSource());
    }
    return out;
  });
}

/** Open a path through the document manager, bypassing the menus. */
export async function openDocument(
  page: IJupyterLabPageFixture,
  path: string,
  factory: string
): Promise<void> {
  await page.evaluate(
    async ({ path, factory }) => {
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path,
        factory
      });
    },
    { path, factory }
  );
  // Wait on the document context actually being ready, not on a fixed delay.
  // A notebook dropped into before its context loads has neither a kernel
  // mimetype nor language metadata, so the drop would legitimately insert an
  // unquoted path and the test would be measuring its own race.
  await page.waitForFunction(
    path => {
      const widget = (window as any).jupyterapp.shell.currentWidget;
      return (
        !!widget &&
        widget.context &&
        widget.context.path === path &&
        widget.context.isReady === true
      );
    },
    path,
    { timeout: 30000 }
  );
}

/** Open a path in the plain file editor. */
export async function openEditor(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await openDocument(page, path, 'Editor');
}

/**
 * A notebook carrying a python kernelspec, so opening it never raises the
 * kernel-selection dialog.
 */
export function notebookFixture(cells: any[]): string {
  return JSON.stringify({
    cells,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      },
      language_info: { name: 'python' }
    },
    nbformat: 4,
    nbformat_minor: 5
  });
}

export function codeCell(source: string): any {
  return {
    cell_type: 'code',
    execution_count: null,
    metadata: {},
    outputs: [],
    source
  };
}

export function markdownCell(source: string): any {
  return { cell_type: 'markdown', metadata: {}, source };
}

/**
 * Open a terminal and record everything the extension sends to its session.
 *
 * xterm renders to a canvas, so the rendered screen carries no readable text.
 * The session payload is the real boundary between this extension and the
 * terminal, and the spy forwards to the original, so the send still happens.
 */
export async function openTerminalAndCaptureSends(
  page: IJupyterLabPageFixture
): Promise<void> {
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('terminal:create-new');
  });
  await page.waitForSelector('.jp-Terminal');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const session = (window as any).jupyterapp.shell.currentWidget.content
      .session;
    (window as any).__sent = [];
    const original = session.send.bind(session);
    session.send = (message: any) => {
      (window as any).__sent.push(message);
      return original(message);
    };
  });
}

/** The stdin strings the extension sent, in order. */
export async function sentStdin(
  page: IJupyterLabPageFixture
): Promise<string[]> {
  return page.evaluate(() =>
    ((window as any).__sent ?? [])
      .filter((message: any) => message.type === 'stdin')
      .flatMap((message: any) => message.content)
  );
}

/** GET a path under the extension's API namespace from page context. */
export async function apiGet(
  page: IJupyterLabPageFixture,
  path: string
): Promise<{ status: number; body: any }> {
  return page.evaluate(async (path: string) => {
    const base =
      (window as any).jupyterapp.serviceManager.serverSettings.baseUrl ?? '/';
    const response = await fetch(
      `${base}jupyterlab-advanced-file-browser-extension/${path}`
    );
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }, path);
}

/** Names of the terminals the server currently holds. */
export async function runningTerminalNames(
  page: IJupyterLabPageFixture
): Promise<string[]> {
  return page.evaluate(async () => {
    const base =
      (window as any).jupyterapp.serviceManager.serverSettings.baseUrl ?? '/';
    const response = await fetch(`${base}api/terminals`);
    const list = await response.json();
    return list.map((entry: any) => entry.name).sort();
  });
}

/**
 * Write the plugin's settings and reload, so activation reads them exactly as
 * it would for a user who changed them in the settings editor.
 */
export async function setPluginSettings(
  page: IJupyterLabPageFixture,
  values: Record<string, unknown>
): Promise<void> {
  const status = await page.evaluate(
    async ({ id, raw }) => {
      const xsrf = document.cookie.match(/_xsrf=([^;]+)/);
      const base =
        (window as any).jupyterapp.serviceManager.serverSettings.baseUrl ?? '/';
      const response = await fetch(`${base}api/settings/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(xsrf ? { 'X-XSRFToken': decodeURIComponent(xsrf[1]) } : {})
        },
        body: JSON.stringify({ raw })
      });
      return response.status;
    },
    { id: PLUGIN_ID, raw: JSON.stringify(values) }
  );
  // A silent failure here would make every settings test pass by accident.
  expect([200, 204]).toContain(status);
  await page.reload();
  // Wait on the extension actually being back, not on a fixed delay: an
  // absence assertion after a reload would otherwise pass just as well if the
  // plugin never activated at all.
  await waitForExtension(page);
}

/**
 * Change the plugin's settings through the live registry, without reloading.
 *
 * A raw REST write updates the server's copy only - the registry inside the
 * page never hears of it, so the plugin's `changed` handler never runs and a
 * test built on it would be measuring the reload, not the change. Galata
 * hands out the registry singleton, and `set` on any Settings object for a
 * plugin emits `pluginChanged`, which every Settings object for that plugin
 * re-emits as `changed` - the extension's own included.
 */
export async function setPluginSettingsLive(
  page: IJupyterLabPageFixture,
  values: Record<string, unknown>
): Promise<void> {
  await page.evaluate(
    async ({ id, values }) => {
      const registry = await (window as any).galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      if (!registry) {
        throw new Error('settings registry not reachable from the page');
      }
      const settings = await registry.load(id);
      for (const [key, value] of Object.entries(values)) {
        await settings.set(key, value);
      }
    },
    { id: PLUGIN_ID, values }
  );
}

/**
 * Mark the current page, so a later check can prove it was never reloaded.
 */
export async function markPage(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(() => {
    (window as any).__pageMark = true;
  });
}

/** Whether the mark set by `markPage` is still on the page. */
export async function pageStillMarked(
  page: IJupyterLabPageFixture
): Promise<boolean> {
  return page.evaluate(() => (window as any).__pageMark === true);
}

/**
 * Resolve once the drag-and-drop plugin has activated on the current page.
 *
 * `isPluginActivated` is the only probe that distinguishes "the extension ran
 * and chose to do nothing" from "the extension never loaded". Without it, a
 * test that asserts an absence after a reload would pass just as happily if
 * activation had broken outright.
 */
export async function waitForExtension(
  page: IJupyterLabPageFixture
): Promise<void> {
  await page.waitForFunction(
    id => {
      const app = (window as any).jupyterapp;
      return !!app && app.isPluginActivated && app.isPluginActivated(id);
    },
    DRAG_PLUGIN_ID,
    { timeout: 30000 }
  );
}

/** The centre point of an element, for the real-mouse drags below. */
export async function centreOf(
  locator: Locator
): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('element has no box on screen');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A file browser breadcrumb, addressed by the path it carries. */
export function crumb(page: IJupyterLabPageFixture, dataPath: string): Locator {
  return page.locator(`.jp-BreadCrumbs [data-path="${dataPath}"]`);
}

/**
 * Drag a breadcrumb with the real mouse and release it over a point.
 *
 * Nothing here is synthetic, unlike the drop drivers above: the extension's
 * own mousedown handler runs, Lumino builds and moves the drag, and the
 * element under the release point receives the drop. That whole chain is what
 * makes the breadcrumb a drag source, so only a real mouse exercises it.
 */
export async function dragCrumbTo(
  page: IJupyterLabPageFixture,
  dataPath: string,
  target: { x: number; y: number }
): Promise<boolean> {
  const start = await centreOf(crumb(page, dataPath));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Several steps, not one jump: the first crosses the drag threshold and
  // starts the drag, and the ones after it are what Lumino tracks the drop
  // target with.
  await page.mouse.move(target.x, target.y, { steps: 12 });
  // Whether a drag really started. Lumino puts the drag image in the body for
  // the duration of the drag and takes it away on release, so this is the one
  // moment the question can be answered - and it is what tells a refused drop
  // apart from a gesture that never became a drag.
  const started = (await page.locator('.lm-mod-drag-image').count()) > 0;
  await page.mouse.up();
  return started;
}

/**
 * Point the file browser at a directory and wait for its crumb to appear.
 *
 * Galata's own `filebrowser.openDirectory` double-clicks a listing row found
 * by its accessible name, which the extensions installed on this workstation
 * rearrange. The command is the file browser's public entry point and does
 * not depend on the panel's markup.
 */
export async function openFolder(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await activateFileBrowser(page);
  await page.evaluate(async (path: string) => {
    await (window as any).jupyterapp.commands.execute(
      'filebrowser:go-to-path',
      { path }
    );
  }, path);
  await crumb(page, path).waitFor();
}

/** Bring the file browser to the front, so its breadcrumbs are on screen. */
export async function activateFileBrowser(
  page: IJupyterLabPageFixture
): Promise<void> {
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('filebrowser:activate')
  );
  await page.locator('.jp-BreadCrumbs').first().waitFor();
}
