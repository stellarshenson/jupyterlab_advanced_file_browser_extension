/**
 * Delete with trash (docs/acc-crit.md, category DELETE). The test server runs with the trash on
 * and a large-removal threshold of 1 MiB (jupyter_server_test_config.py); a trash-off case
 * rewrites delete_to_trash in the served page config, the one place the frontend reads it. The
 * server root and the home trash share a mount, so the trash is monitored there.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs';
import { join } from 'path';
import {
  codeCell,
  menuItem,
  notebookFixture,
  onDisk,
  openDocument,
  openEditor,
  openFolder,
  openItemMenu,
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  serverRoot,
  setUnfolding,
  unfold,
  visibleRows,
  writeTree
} from './helpers';

const TRASH_ON = ['Cancel', 'Delete', 'Move to Trash'];
const TRASH_OFF = ['Cancel', 'Delete'];
/** The buttons where the trash management extension does not monitor the trash. */
const UNMONITORED = ['Cancel', 'Delete'];
const WARNING = 'Moving large files to the trash is not advised';
const NOT_MONITORED =
  'The trash of this location is not monitored, so Move to Trash is not offered';
const WARNING_LINE = '.jp-Dialog .jp-AdvancedFileBrowser-deleteWarning';
/** The line of a selection with one item whose trash is not monitored, beside monitored ones. */
const NOT_MONITORED_ONE =
  '1 selected item is on a location whose trash is not monitored; after Move to Trash you are asked to delete it permanently';
const PROGRESS = '.jp-AdvancedFileBrowser-deleteDialog';
/** The size count request; ServerConnection appends a cache-busting query. */
const SIZE_URL = /\/delete\/size(\?|$)/;
/** The check whether the trash of a selection is monitored. */
const CHECK_URL = /\/delete\/trash-check(\?|$)/;
/** The request that starts a removal job. */
const JOB_URL = /\/delete(\?|$)/;
/** The progress request of a removal job. */
const PROGRESS_URL = /\/delete\/[0-9a-f]{32}(\?|$)/;
/** Files of a large tree: about 2 s to remove on the workstation, past the 1 s before the progress dialog. */
const LARGE = 100000;
/** The test server's home trash (GALATA_HOME, playwright.config.js); the server root sits on its mount. */
const TRASH = join(process.env.GALATA_HOME!, '.local', 'share', 'Trash');

// A large tree left by a failed attempt would cost the retry one contents API call per file
test.afterEach(async ({ page, tmpPath }) => {
  rmSync(join(await serverRoot(page), tmpPath), {
    recursive: true,
    force: true
  });
});

/** The info file names of the trash, a mark for `trashedSince`. */
function trashMark(): Set<string> {
  try {
    return new Set(readdirSync(join(TRASH, 'info')));
  } catch {
    return new Set();
  }
}

/** The absolute original paths of the items moved to the trash since `mark` and still in it. */
function trashedSince(mark: Set<string>): string[] {
  return [...trashMark()]
    .filter(
      name =>
        !mark.has(name) &&
        existsSync(join(TRASH, 'files', name.replace(/\.trashinfo$/, '')))
    )
    .flatMap(name => {
      const match = /^Path=(.*)$/m.exec(
        readFileSync(join(TRASH, 'info', name), 'utf8')
      );
      return match ? [decodeURIComponent(match[1])] : [];
    });
}

/** Navigate again with delete_to_trash false in the served page config. */
async function trashOff(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<void> {
  await page.route(/\/lab\/tree\//, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '"delete_to_trash": true',
      '"delete_to_trash": false'
    );
    await route.fulfill({ response, body });
  });
  await page.goto(`tree/${tmpPath}`);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
          .delete_to_trash
    )
  ).toBe(false);
}

/** The button labelled `label` of the open dialog. */
function button(page: IJupyterLabPageFixture, label: string) {
  return page
    .locator('.jp-Dialog')
    .getByRole('button', { name: label, exact: true });
}

/** The buttons of the open dialog, in order. */
function buttons(page: IJupyterLabPageFixture) {
  return page.locator('.jp-Dialog .jp-Dialog-button');
}

/** Select the rows `paths`: a click on the first, a Ctrl click on each other. */
async function select(
  page: IJupyterLabPageFixture,
  paths: string[]
): Promise<void> {
  for (const [i, path] of paths.entries()) {
    await (
      await rowLocator(page, path)
    ).click(i ? { modifiers: ['ControlOrMeta'] } : undefined);
  }
}

/** Select `paths` and press the Delete key: the dialog opens. */
async function pressDelete(
  page: IJupyterLabPageFixture,
  paths: string[]
): Promise<void> {
  await select(page, paths);
  await page.keyboard.press('Delete');
  await expect(buttons(page).first()).toBeVisible();
}

/**
 * Run the file browser's Delete on `paths` and press `label` in its dialog. `done` resolves
 * when the removal ends.
 */
async function confirmDelete(
  page: IJupyterLabPageFixture,
  paths: string[],
  label: string
): Promise<{ done: Promise<unknown> }> {
  await select(page, paths);
  const done = page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:delete')
  );
  await button(page, label).click();
  return { done };
}

interface IProgressLog {
  /** The number of progress dialogs that opened */
  shown: number;
  titles: string[];
  /** Every percentage a progress dialog painted while open, in order */
  percents: number[];
  /** Whether the spinner was visible, at each change of an open progress dialog */
  spinner: boolean[];
  /** The last percentage painted when each progress dialog closed */
  closedAt: number[];
}

/**
 * Record the progress dialog from now on. A MutationObserver sees every paint, also the 100
 * painted just before the dialog closes, which polling would miss.
 */
async function recordProgress(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(selector => {
    const log: IProgressLog = {
      shown: 0,
      titles: [],
      percents: [],
      spinner: [],
      closedAt: []
    };
    (window as any).__deleteProgress = log;
    const percent = (node: Node | null) =>
      parseInt(node?.textContent ?? '', 10);
    let current: Element | null = null;
    new MutationObserver(records => {
      for (const record of records) {
        if (
          (record.target as Element).classList?.contains(
            'jp-AdvancedFileBrowser-deletePercent'
          )
        ) {
          record.addedNodes.forEach(node => log.percents.push(percent(node)));
        }
        record.removedNodes.forEach(node => {
          if ((node as Element).matches?.(selector)) {
            log.closedAt.push(log.percents[log.percents.length - 1]);
          }
        });
      }
      const dialog = document.querySelector(selector);
      if (!dialog) {
        return;
      }
      if (dialog !== current) {
        current = dialog;
        log.shown++;
        log.percents.push(
          percent(dialog.querySelector('.jp-AdvancedFileBrowser-deletePercent'))
        );
      }
      // The header is a React widget and renders after the dialog is attached
      const title = dialog.querySelector('.jp-Dialog-header')?.textContent;
      if (title && !log.titles.includes(title)) {
        log.titles.push(title);
      }
      const spinner = dialog.querySelector('.jp-Spinner');
      log.spinner.push(!!spinner && spinner.getBoundingClientRect().height > 0);
    }).observe(document.body, { childList: true, subtree: true });
  }, PROGRESS);
}

async function progressLog(
  page: IJupyterLabPageFixture
): Promise<IProgressLog> {
  return page.evaluate(() => (window as any).__deleteProgress);
}

/** Write a large tree `big` in `tmpPath`, list it and start recording the progress dialog. */
async function largeTree(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<string> {
  test.setTimeout(180000);
  await writeTree(page, `${tmpPath}/big`, LARGE);
  await page.filebrowser.refresh();
  await recordProgress(page);
  return `${tmpPath}/big`;
}

test('ACC-DELETE-197-BUTTON-ORDER the Delete dialog shows Cancel, Delete and Move to Trash left to right', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc122.txt']);
  await pressDelete(page, [`${tmpPath}/acc122.txt`]);
  await expect(buttons(page)).toHaveText(TRASH_ON);
  // The labels in the DOM order, and the DOM order is the order on screen
  const lefts = await buttons(page).evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect().left)
  );
  expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  await expect(page.locator('.jp-Dialog .jp-Dialog-header')).toHaveText(
    'Delete'
  );
  await expect(page.locator('.jp-Dialog .jp-Dialog-body')).not.toContainText(
    NOT_MONITORED
  );

  await button(page, 'Cancel').click();
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  expect(await page.contents.fileExists(`${tmpPath}/acc122.txt`)).toBe(true);
});

test('DEF-COPY-48-BUTTON-LABEL the Delete dialog button labels sit on the centre of their buttons', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc48.txt']);
  await pressDelete(page, [`${tmpPath}/acc48.txt`]);

  // The copy dialog's assertion on the Delete dialog: a line box that overflows the button
  // height would sit the label low
  const metrics = await buttons(page).evaluateAll(nodes =>
    nodes.map(node => {
      const box = node.getBoundingClientRect();
      const label = node
        .querySelector('.jp-Dialog-buttonLabel')!
        .getBoundingClientRect();
      return {
        lineHeight: parseFloat(getComputedStyle(node).lineHeight),
        height: box.height,
        labelCentre: label.top + label.height / 2,
        buttonCentre: box.top + box.height / 2
      };
    })
  );
  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.lineHeight).toBeCloseTo(metric.height, 0);
    expect(
      Math.abs(metric.labelCentre - metric.buttonCentre)
    ).toBeLessThanOrEqual(1);
  }

  await button(page, 'Cancel').click();
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  expect(await page.contents.fileExists(`${tmpPath}/acc48.txt`)).toBe(true);
});

test('ACC-DELETE-198-TRASH-ICON Move to Trash shows the trash can icon left of its label, in the label colour', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc198.txt']);
  await pressDelete(page, [`${tmpPath}/acc198.txt`]);
  // The accessible name is the label alone: the icon is hidden from assistive technology
  const trash = button(page, 'Move to Trash');
  await expect(trash).toHaveCount(1);
  await expect(trash.locator('svg')).toHaveCount(1);
  await expect(button(page, 'Cancel').locator('svg')).toHaveCount(0);
  await expect(button(page, 'Delete').locator('svg')).toHaveCount(0);

  for (const theme of ['JupyterLab Light', 'JupyterLab Dark']) {
    await page.theme.setTheme(theme);
    const icon = await trash.evaluate(node => {
      const svg = node.querySelector('svg')!;
      const label = node.querySelector('.jp-Dialog-buttonLabel')!;
      return {
        right: svg.getBoundingClientRect().right,
        labelLeft: label.getBoundingClientRect().left,
        // The painted glyph is the path; the svg element itself has no fill of its own
        fills: Array.from(
          svg.querySelectorAll('path'),
          path => getComputedStyle(path).fill
        ),
        color: getComputedStyle(label).color
      };
    });
    expect(icon.right, theme).toBeLessThanOrEqual(icon.labelLeft);
    expect(icon.fills.length, theme).toBeGreaterThan(0);
    for (const fill of icon.fills) {
      expect(fill, theme).toBe(icon.color);
    }
  }

  await button(page, 'Cancel').click();
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});

test('ACC-DELETE-123-TRASH-DEFAULT Enter moves the selection to the trash', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc123.txt']);
  const mark = trashMark();
  await pressDelete(page, [`${tmpPath}/acc123.txt`]);
  await expect(button(page, 'Move to Trash')).toBeFocused();

  await page.keyboard.press('Enter');

  await expect
    .poll(async () => (await visibleRows(page)).map(row => row.path), {
      timeout: SERVER_TIMEOUT
    })
    .toEqual([]);
  expect(await page.contents.fileExists(`${tmpPath}/acc123.txt`)).toBe(false);
  expect(trashedSince(mark)).toContain(
    await onDisk(page, `${tmpPath}/acc123.txt`)
  );
});

test('ACC-DELETE-124-PERMANENT Delete removes a file without the trash', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc124.txt']);
  const file = await onDisk(page, `${tmpPath}/acc124.txt`);
  const mark = trashMark();

  await (
    await confirmDelete(page, [`${tmpPath}/acc124.txt`], 'Delete')
  ).done;

  expect(existsSync(file)).toBe(false);
  expect(trashedSince(mark)).not.toContain(file);
});

test('ACC-DELETE-142-TAB-CLOSE Delete closes the tab of the removed file', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['tabclose.txt']);
  await openEditor(page, `${tmpPath}/tabclose.txt`);
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('docmanager:clone')
  );
  const tab = page.activity.getTabLocator('tabclose.txt');
  await expect(tab).toHaveCount(2);

  await (
    await confirmDelete(page, [`${tmpPath}/tabclose.txt`], 'Delete')
  ).done;

  expect(existsSync(await onDisk(page, `${tmpPath}/tabclose.txt`))).toBe(false);
  await expect(tab).toHaveCount(0);
});

test('ACC-DELETE-146-SIBLING-VIEWS Delete closes the sibling views of a notebook', async ({
  page,
  tmpPath
}) => {
  const path = `${tmpPath}/acc146.ipynb`;
  writeFileSync(
    await onDisk(page, path),
    notebookFixture([
      {
        ...codeCell('print("acc146")'),
        execution_count: 1,
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'acc146\n' }]
      }
    ])
  );
  await page.filebrowser.refresh();
  await openDocument(page, path, 'Notebook');
  // The cell output view closes with the notebook's content; a plain sibling only through its context
  await page.evaluate(async () => {
    const app = window.jupyterapp;
    const notebook = app.shell.currentWidget as any;
    await app.commands.execute('notebook:create-output-view');
    // Lumino's Widget is the root of the notebook panel's class chain
    let base = Object.getPrototypeOf(notebook);
    while (Object.getPrototypeOf(base) !== Object.prototype) {
      base = Object.getPrototypeOf(base);
    }
    const sibling = new base.constructor();
    sibling.id = 'acc146-sibling';
    sibling.title.label = 'acc146 sibling';
    notebook.context.addSibling(sibling, {
      ref: notebook.id,
      mode: 'split-right'
    });
  });
  const tabs = ['acc146.ipynb', 'Output View', 'acc146 sibling'].map(name =>
    page.activity.getTabLocator(name)
  );
  for (const tab of tabs) {
    await expect(tab).toHaveCount(1);
  }

  await (
    await confirmDelete(page, [path], 'Delete')
  ).done;

  expect(existsSync(await onDisk(page, path))).toBe(false);
  for (const tab of tabs) {
    await expect(tab).toHaveCount(0);
  }
});

test('ACC-DELETE-147-FOLDER-TABS removing a folder closes the tab of a file inside it', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'perm/',
    'perm/b.txt',
    'trash/',
    'trash/c.txt'
  ]);
  for (const [folder, file, label] of [
    ['perm', 'b.txt', 'Delete'],
    ['trash', 'c.txt', 'Move to Trash']
  ]) {
    await openEditor(page, `${tmpPath}/${folder}/${file}`);
    const tab = page.activity.getTabLocator(file);
    await expect(tab).toHaveCount(1);

    await (
      await confirmDelete(page, [`${tmpPath}/${folder}`], label)
    ).done;

    expect(existsSync(await onDisk(page, `${tmpPath}/${folder}`))).toBe(false);
    await expect(tab).toHaveCount(0);
  }
});

test('ACC-DELETE-150-FOLDER-KERNELS removing a folder shuts down the kernel of a notebook inside it', async ({
  page,
  tmpPath
}) => {
  const folder = `${tmpPath}/acc150`;
  const path = `${folder}/n.ipynb`;
  mkdirSync(await onDisk(page, folder), { recursive: true });
  writeFileSync(await onDisk(page, path), notebookFixture([codeCell('')]));
  await page.filebrowser.refresh();
  await openDocument(page, path, 'Notebook');
  const sessionPaths = async (): Promise<string[]> =>
    (await (await page.request.get('api/sessions')).json()).map(
      (session: { path: string }) => session.path
    );
  await expect.poll(sessionPaths, { timeout: SERVER_TIMEOUT }).toContain(path);
  // A console launched from the folder: a session of type console at a path below it
  const consolePath = `${folder}/console-acc150`;
  const created = await page.request.post('api/sessions', {
    data: {
      path: consolePath,
      type: 'console',
      name: '',
      kernel: { name: 'python3' }
    }
  });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  try {
    await (
      await confirmDelete(page, [folder], 'Delete')
    ).done;

    expect(existsSync(await onDisk(page, folder))).toBe(false);
    const after = await sessionPaths();
    expect(after).not.toContain(path);
    expect(after).toContain(consolePath);
  } finally {
    // No kernel outlives the case
    await page.request.delete(`api/sessions/${id}`);
  }
});

test('ACC-DELETE-125-PERM-FOLDER Delete removes a folder with content', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, [
    'acc125/',
    'acc125/a.txt',
    'acc125/sub/',
    'acc125/sub/b.txt'
  ]);
  const folder = await onDisk(page, `${tmpPath}/acc125`);
  const mark = trashMark();
  const requests: string[] = [];
  page.on('request', request =>
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  );

  await (
    await confirmDelete(page, [`${tmpPath}/acc125`], 'Delete')
  ).done;

  expect(existsSync(folder)).toBe(false);
  expect(trashedSince(mark)).not.toContain(folder);
  // The extension's job removed it; always_delete_dir guards only the contents API, which saw no DELETE
  expect(requests).toContain(
    'POST /jupyterlab-advanced-file-browser-extension/delete'
  );
  expect(requests.filter(r => r.startsWith('DELETE '))).toEqual([]);
});

test('ACC-DELETE-126-TRASH-OFF trash off keeps Cancel and Delete, and Delete removes permanently', async ({
  page,
  tmpPath
}) => {
  await trashOff(page, tmpPath);
  await seedTree(page, tmpPath, ['acc126.txt']);
  const file = await onDisk(page, `${tmpPath}/acc126.txt`);
  const mark = trashMark();
  await pressDelete(page, [`${tmpPath}/acc126.txt`]);
  await expect(buttons(page)).toHaveText(TRASH_OFF);

  await button(page, 'Delete').click();

  await expect
    .poll(() => existsSync(file), { timeout: SERVER_TIMEOUT })
    .toBe(false);
  expect(trashedSince(mark)).not.toContain(file);
});

test('ACC-DELETE-127-BUTTON-STYLE both confirm buttons, Delete and Move to Trash, are warn buttons', async ({
  page,
  tmpPath
}) => {
  await seedTree(page, tmpPath, ['acc127.txt']);
  await pressDelete(page, [`${tmpPath}/acc127.txt`]);
  const permanent = button(page, 'Delete');
  const trash = button(page, 'Move to Trash');

  await expect(permanent).toHaveClass(/\bjp-mod-warn\b/);
  await expect(trash).toHaveClass(/\bjp-mod-warn\b/);
  // JupyterLab renders an accepting warn button with jp-mod-accept too; the
  // warn rule comes later and wins, so the fill, not the class, proves the colour.
  const fill = (locator: typeof trash) =>
    locator.evaluate(node => getComputedStyle(node).backgroundColor);
  const error = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--jp-error-color1)';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(error).not.toBe('rgba(0, 0, 0, 0)');
  expect(await fill(permanent)).toBe(error);
  expect(await fill(trash)).toBe(error);
});

test('ACC-DELETE-128-LARGE-WARN a selection above the threshold shows one warning line', async ({
  page,
  tmpPath
}) => {
  // Two 600 KiB files on two levels: only their sum passes the test server's 1 MiB
  const folder = await onDisk(page, `${tmpPath}/acc128`);
  mkdirSync(join(folder, 'sub'), { recursive: true });
  writeFileSync(join(folder, 'a.bin'), Buffer.alloc(600 * 1024));
  writeFileSync(join(folder, 'sub', 'b.bin'), Buffer.alloc(600 * 1024));
  writeFileSync(await onDisk(page, `${tmpPath}/small.txt`), 'x');
  await page.filebrowser.refresh();
  const counted = () => page.waitForResponse(SIZE_URL);

  // Below the threshold: the count answers and no warning shows
  let count = counted();
  await pressDelete(page, [`${tmpPath}/small.txt`]);
  expect((await (await count).json()).over).toBe(false);
  await expect(buttons(page)).toHaveText(TRASH_ON);
  await expect(page.locator(WARNING_LINE)).toHaveCount(0);
  await button(page, 'Cancel').click();

  count = counted();
  await pressDelete(page, [`${tmpPath}/acc128`]);
  expect((await (await count).json()).over).toBe(true);
  await expect(page.locator(WARNING_LINE)).toHaveText([WARNING]);
});

test('ACC-DELETE-129-WARN-NOTRASH trash off shows no warning for a large selection', async ({
  page,
  tmpPath
}) => {
  await trashOff(page, tmpPath);
  const file = `${tmpPath}/acc129.bin`;
  writeFileSync(await onDisk(page, file), Buffer.alloc(2 * 1024 * 1024));
  await page.filebrowser.refresh();
  const counts: string[] = [];
  page.on('request', request => {
    if (SIZE_URL.test(request.url())) {
      counts.push(request.url());
    }
  });

  await pressDelete(page, [file]);

  await expect(buttons(page)).toHaveText(TRASH_OFF);
  await expect(page.locator(WARNING_LINE)).toHaveCount(0);
  // The dialog asks for no count, so no warning can follow; the selection is above the threshold
  expect(counts).toEqual([]);
  const size = await page.request.post(
    'jupyterlab-advanced-file-browser-extension/delete/size',
    { data: { paths: [file] } }
  );
  expect((await size.json()).over).toBe(true);
});

test('ACC-DELETE-133-SIZE-NOWAIT the dialog opens before the size count answers', async ({
  page,
  tmpPath
}) => {
  const file = `${tmpPath}/acc133.bin`;
  writeFileSync(await onDisk(page, file), Buffer.alloc(2 * 1024 * 1024));
  await page.filebrowser.refresh();
  let answer!: () => void;
  const held = new Promise<void>(resolve => (answer = resolve));
  await page.route(SIZE_URL, async route => {
    await held;
    await route.continue();
  });
  const asked = page.waitForRequest(SIZE_URL);

  await pressDelete(page, [file]);
  await asked;

  await expect(buttons(page)).toHaveText(TRASH_ON);
  await expect(page.locator(WARNING_LINE)).toHaveCount(0);
  answer();
  await expect(page.locator(WARNING_LINE)).toHaveText([WARNING]);
});

test('ACC-DELETE-134-PROGRESS-SHOW a slow removal shows the progress dialog, a quick one none', async ({
  page,
  tmpPath
}) => {
  const big = await largeTree(page, tmpPath);
  await seedTree(page, tmpPath, ['acc134.txt']);

  await (
    await confirmDelete(page, [`${tmpPath}/acc134.txt`], 'Move to Trash')
  ).done;
  expect((await progressLog(page)).shown).toBe(0);

  await (
    await confirmDelete(page, [big], 'Delete')
  ).done;
  expect((await progressLog(page)).shown).toBe(1);
});

test('ACC-DELETE-135-PROGRESS-SPINNER the progress dialog shows the spinner until it closes', async ({
  page,
  tmpPath
}) => {
  const big = await largeTree(page, tmpPath);

  await (
    await confirmDelete(page, [big], 'Delete')
  ).done;

  const log = await progressLog(page);
  expect(log.shown).toBe(1);
  expect(log.closedAt).toHaveLength(1);
  expect(log.spinner.length).toBeGreaterThan(0);
  expect(log.spinner.every(Boolean)).toBe(true);
});

test('ACC-DELETE-136-PROGRESS-BAR the percentage only rises and ends at 100', async ({
  page,
  tmpPath
}) => {
  const big = await largeTree(page, tmpPath);

  await (
    await confirmDelete(page, [big], 'Delete')
  ).done;

  const { percents } = await progressLog(page);
  expect(percents.length).toBeGreaterThan(1);
  expect(percents[0]).toBeLessThan(100);
  expect(percents).toEqual([...percents].sort((a, b) => a - b));
  expect(percents[percents.length - 1]).toBe(100);
});

test('ACC-DELETE-137-PROGRESS-TITLE the progress title names the action and the count', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(180000);
  await seedTree(page, tmpPath, ['t1/', 't2/', 't3/']);
  for (const name of ['p1', 'p2', 'p3']) {
    await writeTree(page, `${tmpPath}/${name}`, Math.ceil(LARGE / 3));
  }
  await page.filebrowser.refresh();
  await recordProgress(page);
  // A move to the trash is a rename and ends at once; the job starts 1.5 s late instead
  await page.route(JOB_URL, async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });

  const toTrash = ['t1', 't2', 't3'].map(name => `${tmpPath}/${name}`);
  await (
    await confirmDelete(page, toTrash, 'Move to Trash')
  ).done;
  await page.unroute(JOB_URL);
  const permanent = ['p1', 'p2', 'p3'].map(name => `${tmpPath}/${name}`);
  await (
    await confirmDelete(page, permanent, 'Delete')
  ).done;

  expect((await progressLog(page)).titles).toEqual([
    'Moving 3 items to the trash',
    'Deleting 3 items'
  ]);
});

test('ACC-DELETE-138-PROGRESS-HIDE Hide closes the dialog and the removal goes on', async ({
  page,
  tmpPath
}) => {
  const big = await largeTree(page, tmpPath);
  // A fast disk ends the removal before the press on Hide, so the progress answers wait for the press
  let pressed = () => {};
  const afterHide = new Promise<void>(resolve => (pressed = resolve));
  await page.route(PROGRESS_URL, async route => {
    await afterHide;
    await route.continue();
  });
  const { done } = await confirmDelete(page, [big], 'Delete');

  await page
    .locator(PROGRESS)
    .getByRole('button', { name: 'Hide', exact: true })
    .click();

  await expect(page.locator(PROGRESS)).toHaveCount(0);
  // Closed by Hide before the end, then the removal ended
  expect((await progressLog(page)).closedAt[0]).toBeLessThan(100);
  pressed();
  await done;
  expect(existsSync(await onDisk(page, big))).toBe(false);
});

test('ACC-DELETE-139-PROGRESS-END the progress dialog closes at the end and the rows are gone', async ({
  page,
  tmpPath
}) => {
  const big = await largeTree(page, tmpPath);

  await (
    await confirmDelete(page, [big], 'Delete')
  ).done;

  expect((await progressLog(page)).closedAt).toEqual([100]);
  await expect(page.locator(PROGRESS)).toHaveCount(0);
  await expect
    .poll(async () => (await visibleRows(page)).map(row => row.path))
    .toEqual([]);
});

test('ACC-DELETE-140-REMOVE-FAIL a failed removal names the path and keeps the rest removed', async ({
  page,
  tmpPath
}) => {
  const parent = await onDisk(page, `${tmpPath}/acc140`);
  const locked = join(parent, 'locked');
  mkdirSync(locked, { recursive: true });
  writeFileSync(join(parent, 'ok.txt'), 'x');
  writeFileSync(join(locked, 'inner.txt'), 'x');
  chmodSync(locked, 0o555);
  const failed = page
    .locator('.jp-Dialog', { hasText: 'Delete Failed' })
    .locator('.jp-Dialog-body');
  try {
    await page.filebrowser.refresh();

    await (
      await confirmDelete(page, [`${tmpPath}/acc140`], 'Delete')
    ).done;

    // One line form in both modes: the path relative to the server root, then the reason
    await expect(failed).toHaveText(
      `Not removed: ${tmpPath}/acc140/locked/inner.txt: permission denied`
    );
    expect(existsSync(join(parent, 'ok.txt'))).toBe(false);
    expect(existsSync(join(locked, 'inner.txt'))).toBe(true);
    await button(page, 'Close').click();
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);

    // The read-only folder itself fails the server's writable check before the trash
    await openFolder(page, `${tmpPath}/acc140`);
    await (
      await confirmDelete(page, [`${tmpPath}/acc140/locked`], 'Move to Trash')
    ).done;

    await expect(failed).toHaveText(
      `Not removed: ${tmpPath}/acc140/locked: permission denied`
    );
    expect(existsSync(join(locked, 'inner.txt'))).toBe(true);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('ACC-DELETE-144-ERROR-CAP the Delete Failed message names 10 paths, then the count of the rest', async ({
  page,
  tmpPath
}) => {
  const locked = await onDisk(page, `${tmpPath}/acc144/locked`);
  mkdirSync(locked, { recursive: true });
  for (let i = 0; i < 25; i++) {
    writeFileSync(join(locked, `f${i}`), 'x');
  }
  chmodSync(locked, 0o555);
  try {
    await page.filebrowser.refresh();

    await (
      await confirmDelete(page, [`${tmpPath}/acc144`], 'Delete')
    ).done;

    const message = page
      .locator('.jp-Dialog', { hasText: 'Delete Failed' })
      .locator('.jp-Dialog-body');
    await expect(message).toContainText('; and 15 more');
    expect(
      (await message.textContent())!.match(/\/acc144\/locked\/f\d+:/g)
    ).toHaveLength(10);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('ACC-DELETE-141-SAME-DIALOG key, menu and nested rows open the same dialog', async ({
  page,
  tmpPath
}) => {
  await setUnfolding(page, true);
  await seedTree(page, tmpPath, ['a/', 'a/acc141.txt', 'acc141.txt']);
  await unfold(page, `${tmpPath}/a`);
  const cancel = async () => {
    await button(page, 'Cancel').click();
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  };

  for (const path of [`${tmpPath}/acc141.txt`, `${tmpPath}/a/acc141.txt`]) {
    await pressDelete(page, [path]);
    await expect(buttons(page)).toHaveText(TRASH_ON);
    await expect(page.locator('.jp-Dialog .jp-Dialog-body')).toContainText(
      ': acc141.txt?'
    );
    await cancel();

    await menuItem(
      await openItemMenu(page, path),
      'filebrowser:delete'
    ).click();
    await expect(buttons(page)).toHaveText(TRASH_ON);
    await cancel();
  }
  expect(await page.contents.fileExists(`${tmpPath}/acc141.txt`)).toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/a/acc141.txt`)).toBe(true);
});

/** Answer the trash check as for a mount whose trash nobody monitors: false for each path. */
async function unmonitored(page: IJupyterLabPageFixture): Promise<void> {
  await page.route(CHECK_URL, route =>
    route.fulfill({
      json: {
        monitored: route
          .request()
          .postDataJSON()
          .paths.map(() => false)
      }
    })
  );
}

test('ACC-DELETE-151-UNMONITORED an unmonitored trash offers Cancel and Delete only', async ({
  page,
  tmpPath
}) => {
  await unmonitored(page);
  await seedTree(page, tmpPath, ['acc151.txt']);
  const file = await onDisk(page, `${tmpPath}/acc151.txt`);
  const mark = trashMark();
  const counts: string[] = [];
  page.on('request', request => {
    if (SIZE_URL.test(request.url())) {
      counts.push(request.url());
    }
  });

  await pressDelete(page, [`${tmpPath}/acc151.txt`]);
  await expect(buttons(page)).toHaveText(UNMONITORED);
  await expect(button(page, 'Cancel')).toBeFocused();
  await expect(page.locator('.jp-Dialog .jp-Dialog-body')).toHaveText(
    `Are you sure you want to permanently delete: acc151.txt?${NOT_MONITORED}`
  );
  await expect(page.locator(WARNING_LINE)).toHaveText([NOT_MONITORED]);
  await button(page, 'Delete').click();

  await expect
    .poll(() => existsSync(file), { timeout: SERVER_TIMEOUT })
    .toBe(false);
  expect(trashedSince(mark)).not.toContain(file);
  // No size count, so no large-removal warning
  expect(counts).toEqual([]);
});

test('ACC-DELETE-152-SYMLINK-MOUNT a file on another mount reached through a link is deleted permanently', async ({
  page,
  tmpPath
}) => {
  // The sandbox binds /tmp as a mount of its own, apart from the server root's; elsewhere the
  // check is stubbed as for such a mount
  const mounted = readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .some(line => line.split(' ')[4] === '/tmp');
  if (!mounted) {
    await unmonitored(page);
  }
  console.log(
    `ACC-DELETE-152-SYMLINK-MOUNT: ${mounted ? 'real link to the /tmp mount, check not stubbed' : '/tmp is not a mount, check stubbed'}`
  );
  const target = mkdtempSync(join('/tmp', 'acc152-'));
  const file = join(target, 'acc152.txt');
  try {
    writeFileSync(file, 'x');
    symlinkSync(target, await onDisk(page, `${tmpPath}/nfs`));
    await openFolder(page, `${tmpPath}/nfs`);
    const mark = trashMark();
    const checked = page.waitForResponse(CHECK_URL);

    await pressDelete(page, [`${tmpPath}/nfs/acc152.txt`]);
    expect((await (await checked).json()).monitored).toEqual([false]);
    await expect(buttons(page)).toHaveText(UNMONITORED);
    await button(page, 'Delete').click();

    await expect
      .poll(() => existsSync(file), { timeout: SERVER_TIMEOUT })
      .toBe(false);
    // Neither the home trash nor the trash of the /tmp mount holds it
    expect(
      trashedSince(mark).filter(path => path.endsWith('/acc152.txt'))
    ).toEqual([]);
    const uid = process.getuid!();
    for (const trash of [`/tmp/.Trash-${uid}`, `/tmp/.Trash/${uid}`]) {
      expect(existsSync(join(trash, 'files', 'acc152.txt'))).toBe(false);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('ACC-DELETE-153-ALL-VOLUMES with the default False a file on another mount gets Cancel and Delete only', async ({
  page,
  tmpPath
}) => {
  // A real link to the sandbox's /tmp mount, the check not stubbed; True runs in all-volumes.spec.ts
  test.skip(
    !readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some(line => line.split(' ')[4] === '/tmp'),
    '/tmp is not a mount of its own'
  );
  const target = mkdtempSync(join('/tmp', 'acc153-'));
  const file = join(target, 'acc153.txt');
  try {
    writeFileSync(file, 'x');
    symlinkSync(target, await onDisk(page, `${tmpPath}/nfs`));
    await openFolder(page, `${tmpPath}/nfs`);
    const checked = page.waitForResponse(CHECK_URL);

    await pressDelete(page, [`${tmpPath}/nfs/acc153.txt`]);

    expect((await (await checked).json()).monitored).toEqual([false]);
    await expect(buttons(page)).toHaveText(UNMONITORED);
    await button(page, 'Cancel').click();
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    expect(existsSync(file)).toBe(true);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('ACC-DELETE-156-MIXED-SELECTION Move to Trash moves the monitored file, then a second dialog asks for the other', async ({
  page,
  tmpPath
}) => {
  // A real link to the sandbox's /tmp mount, the check not stubbed
  test.skip(
    !readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some(line => line.split(' ')[4] === '/tmp'),
    '/tmp is not a mount of its own'
  );
  const target = mkdtempSync(join('/tmp', 'acc156-'));
  const other = join(target, 'acc156.txt');
  try {
    writeFileSync(other, 'x');
    await seedTree(page, tmpPath, ['acc156a.txt', 'acc156b.txt']);
    symlinkSync(target, await onDisk(page, `${tmpPath}/nfs`));
    await setUnfolding(page, true);
    await page.filebrowser.refresh();

    // Cancel in the second dialog keeps the other file; a repeat with Delete removes it
    for (const [name, label] of [
      ['acc156a.txt', 'Cancel'],
      ['acc156b.txt', 'Delete']
    ]) {
      await unfold(page, `${tmpPath}/nfs`);
      const mark = trashMark();
      const checked = page.waitForResponse(CHECK_URL);
      await select(page, [`${tmpPath}/${name}`, `${tmpPath}/nfs/acc156.txt`]);
      const done = page.evaluate(() =>
        window.jupyterapp.commands.execute('filebrowser:delete')
      );
      // The first dialog counts the item Move to Trash does not move
      await expect(buttons(page)).toHaveText(TRASH_ON);
      await expect(page.locator(WARNING_LINE)).toHaveText([NOT_MONITORED_ONE]);
      await button(page, 'Move to Trash').click();
      // The check answers per path, in the order of the request
      const response = await checked;
      const { paths } = response.request().postDataJSON();
      const { monitored } = await response.json();
      expect(
        Object.fromEntries(
          paths.map((path: string, i: number) => [path, monitored[i]])
        )
      ).toEqual({
        [`${tmpPath}/${name}`]: true,
        [`${tmpPath}/nfs/acc156.txt`]: false
      });

      await expect(buttons(page)).toHaveText(UNMONITORED);
      await expect(button(page, 'Cancel')).toBeFocused();
      await expect(page.locator('.jp-Dialog .jp-Dialog-body')).toHaveText(
        `This item was not moved to the trash, because the trash of its location is not monitored: ${tmpPath}/nfs/acc156.txt. Delete it permanently?`
      );
      expect(trashedSince(mark)).toContain(
        await onDisk(page, `${tmpPath}/${name}`)
      );
      await button(page, label).click();
      await done;

      expect(existsSync(other)).toBe(label === 'Cancel');
    }
    // Neither the home trash nor the trash of the /tmp mount holds the other file
    const uid = process.getuid!();
    for (const trash of [`/tmp/.Trash-${uid}`, `/tmp/.Trash/${uid}`]) {
      expect(existsSync(join(trash, 'files', 'acc156.txt'))).toBe(false);
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

for (const label of ['Delete', 'Move to Trash']) {
  test(`ACC-DELETE-157-CHECKPOINTS with hidden files shown ${label} removes .ipynb_checkpoints and a folder and makes no new .ipynb_checkpoints`, async ({
    page,
    tmpPath
  }) => {
    const root = await onDisk(page, tmpPath);
    mkdirSync(join(root, '.ipynb_checkpoints'));
    mkdirSync(join(root, 'acc157'));
    writeFileSync(join(root, 'nb.ipynb'), notebookFixture([]));
    writeFileSync(
      join(root, '.ipynb_checkpoints', 'nb-checkpoint.ipynb'),
      notebookFixture([])
    );
    writeFileSync(join(root, 'acc157', 'a.txt'), 'a');
    await page.evaluate(async () => {
      const registry: any = await window.galata.getPlugin(
        '@jupyterlab/apputils-extension:settings'
      );
      await registry.set(
        '@jupyterlab/filebrowser-extension:browser',
        'showHiddenFiles',
        true
      );
    });
    await page.filebrowser.refresh();
    const paths = [`${tmpPath}/.ipynb_checkpoints`, `${tmpPath}/acc157`];
    const mark = trashMark();

    await (
      await confirmDelete(page, paths, label)
    ).done;

    const rows = async () => (await visibleRows(page)).map(row => row.path);
    await expect.poll(rows).toEqual([`${tmpPath}/nb.ipynb`]);
    expect(existsSync(join(root, '.ipynb_checkpoints'))).toBe(false);
    expect(existsSync(join(root, 'acc157'))).toBe(false);
    // Only this root: parallel workers' tmpPath teardown moves their folders to the shared trash
    const trashed = trashedSince(mark).filter(path =>
      path.startsWith(`${root}/`)
    );
    if (label === 'Move to Trash') {
      expect(trashed.sort()).toEqual([
        join(root, '.ipynb_checkpoints'),
        join(root, 'acc157')
      ]);
    } else {
      expect(trashed).toEqual([]);
    }
    // A later re-read finds no folder made after the removal either
    await page.filebrowser.refresh();
    expect(await rows()).toEqual([`${tmpPath}/nb.ipynb`]);
  });
}
