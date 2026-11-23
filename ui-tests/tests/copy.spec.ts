/**
 * Copy and move with progress (docs/acc-crit.md, category COPY). The test server copies in 32 KiB
 * steps with a 10 ms pause (jupyter_server_test_config.py), about 3.2 MiB/s, so a 16 MiB file
 * outlasts the 1 s before the progress dialog. Another volume is a link to a /dev/shm folder: in
 * the sandbox runner /dev/shm is a tmpfs of its own, apart from the server root's mount.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs';
import { join } from 'path';
import {
  centreOf,
  dragRow,
  onDisk,
  openFolder,
  rowLocator,
  serverRoot,
  visibleRows,
  writeTree
} from './helpers';

const DIALOG = '.jp-AdvancedFileBrowser-copyDialog';
const STATUS = '#jp-main-statusbar .jp-AdvancedFileBrowser-copyStatus';
const MENU = '.jp-AdvancedFileBrowser-copyMenu';
const ROWS = `${MENU} .jp-AdvancedFileBrowser-copyMenuRow`;
const TOTAL = `${DIALOG} .jp-AdvancedFileBrowser-copyTotal .jp-AdvancedFileBrowser-copyPercent`;
const MIB = 1024 ** 2;
/** About 5 s at the test server's copy speed. */
const SLOW = 16 * MIB;
/** About 15 s: time to start, hide and pick among three operations before the first ends. */
const LONG = 48 * MIB;

test.describe.configure({ timeout: 180000 });

/** The /dev/shm folders linked as another volume by the running test. */
const volumes: string[] = [];

// Large files left by a failed attempt would cost the retry its disk and its trash
test.afterEach(async ({ page, tmpPath }) => {
  rmSync(join(await serverRoot(page), tmpPath), {
    recursive: true,
    force: true
  });
  for (const dir of volumes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Link a new /dev/shm folder as `${tmpPath}/vol`, a folder on another device than the server root. */
async function otherVolume(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<string> {
  const root = await serverRoot(page);
  test.skip(
    statSync(root).dev === statSync('/dev/shm').dev,
    '/dev/shm is on the device of the server root'
  );
  const dir = mkdtempSync('/dev/shm/copy-');
  volumes.push(dir);
  symlinkSync(dir, join(root, tmpPath, 'vol'));
  return `${tmpPath}/vol`;
}

/** Write `size` zero bytes to the server path `path`, straight to disk. */
async function bigFile(
  page: IJupyterLabPageFixture,
  path: string,
  size = SLOW
): Promise<void> {
  writeFileSync(await onDisk(page, path), Buffer.alloc(size));
}

async function folder(page: IJupyterLabPageFixture, path: string) {
  mkdirSync(await onDisk(page, path), { recursive: true });
}

async function sizeOf(page: IJupyterLabPageFixture, path: string) {
  return statSync(await onDisk(page, path)).size;
}

/**
 * Copy, or Cut when `cut`, the items `names` of the folder `from`, then Paste them into the folder
 * `to`, through the commands the keys run. A progress dialog covers the page, so the items are
 * selected through the listing. `done` resolves when the Paste ends.
 */
async function paste(
  page: IJupyterLabPageFixture,
  from: string,
  names: string[],
  to: string,
  cut = false
): Promise<{ done: Promise<unknown> }> {
  await page.evaluate(
    async ({ from, names, to, cut }) => {
      const app = window.jupyterapp;
      const browser: any = Array.from(app.shell.widgets('left')).find(
        widget => widget.id === 'filebrowser'
      );
      await app.commands.execute('filebrowser:go-to-path', { path: from });
      browser.listing.clearSelectedItems();
      for (const name of names) {
        browser.listing.selection[`${from}/${name}`] = true;
      }
      await app.commands.execute(cut ? 'filebrowser:cut' : 'filebrowser:copy');
      await app.commands.execute('filebrowser:go-to-path', { path: to });
    },
    { from, names, to, cut }
  );
  return {
    done: page.evaluate(() =>
      window.jupyterapp.commands.execute('filebrowser:paste')
    )
  };
}

function header(page: IJupyterLabPageFixture) {
  return page.locator(`${DIALOG} .jp-Dialog-header`);
}

function button(page: IJupyterLabPageFixture, label: string) {
  return page.locator(DIALOG).getByRole('button', { name: label, exact: true });
}

async function hide(page: IJupyterLabPageFixture): Promise<void> {
  await button(page, 'Hide').click();
  await expect(page.locator(DIALOG)).toHaveCount(0);
}

const title = (count: number) =>
  count === 1 ? 'Copying 1 item' : `Copying ${count} items`;

/**
 * Paste `names` of `tmpPath` into `${tmpPath}/dst`, wait for its dialog and Hide it. `done` is
 * wrapped, as in paste(): an async function returning the promise itself would wait for it.
 */
async function startHidden(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  names: string[]
): Promise<{ done: Promise<unknown> }> {
  const { done } = await paste(page, tmpPath, names, `${tmpPath}/dst`);
  await expect(header(page)).toHaveText(title(names.length));
  await hide(page);
  return { done };
}

/** The items of three operations of 1, 2 and 3 items, each with one long file. */
const THREE = [
  ['l1.bin'],
  ['l2.bin', 's2.txt'],
  ['l3.bin', 's3a.txt', 's3b.txt']
];

async function seedThree(page: IJupyterLabPageFixture, tmpPath: string) {
  await folder(page, `${tmpPath}/dst`);
  for (const [long, ...small] of THREE) {
    await bigFile(page, `${tmpPath}/${long}`, LONG);
    for (const name of small) {
      writeFileSync(await onDisk(page, `${tmpPath}/${name}`), name);
    }
  }
}

/** Start the three operations of THREE and hide each; resolves with their ends. */
async function threeHidden(
  page: IJupyterLabPageFixture,
  tmpPath: string
): Promise<Promise<unknown>[]> {
  await seedThree(page, tmpPath);
  const done: Promise<unknown>[] = [];
  for (const names of THREE) {
    done.push((await startHidden(page, tmpPath, names)).done);
  }
  await expect(page.locator(STATUS)).toContainText('3 operations');
  return done;
}

interface IDialogLog {
  title: string;
  /** Every Total percentage painted, repeats in a row dropped */
  total: number[];
  file: number[];
  /** The last From path shown */
  from: string;
  /** The Files and Bytes counters as painted */
  files: string[];
  bytes: string[];
  /** The last Total percentage painted when the dialog closed */
  closedAt: number | null;
}

/**
 * Record each progress dialog from now on. A MutationObserver sees every paint, also the 100
 * painted just before the dialog closes, which polling would miss.
 */
async function recordDialogs(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(selector => {
    const log = { dialogs: [] as IDialogLog[], most: 0 };
    (window as any).__copyLog = log;
    const open = new Map<Node, IDialogLog>();
    const text = (root: Element, css: string) =>
      root.querySelector(css)?.textContent ?? '';
    const percent = (root: Element, line: string) =>
      parseInt(
        text(
          root,
          `.jp-AdvancedFileBrowser-${line} .jp-AdvancedFileBrowser-copyPercent`
        ),
        10
      );
    const add = <T>(list: T[], value: T) => {
      if (list[list.length - 1] !== value) {
        list.push(value);
      }
    };
    new MutationObserver(records => {
      for (const record of records) {
        record.removedNodes.forEach(node => {
          const entry = open.get(node);
          if (entry) {
            entry.closedAt = entry.total[entry.total.length - 1] ?? null;
            open.delete(node);
          }
        });
      }
      const dialogs = Array.from(document.querySelectorAll(selector));
      log.most = Math.max(log.most, dialogs.length);
      for (const dialog of dialogs) {
        let entry = open.get(dialog);
        if (!entry) {
          entry = {
            title: '',
            total: [],
            file: [],
            from: '',
            files: [],
            bytes: [],
            closedAt: null
          };
          open.set(dialog, entry);
          log.dialogs.push(entry);
        }
        // The header is a React widget and renders after the dialog is attached
        entry.title ||= text(dialog, '.jp-Dialog-header');
        entry.from =
          text(dialog, '.jp-AdvancedFileBrowser-copyPath') || entry.from;
        add(entry.total, percent(dialog, 'copyTotal'));
        add(entry.file, percent(dialog, 'copyFile'));
        const stat = (name: string) =>
          text(
            dialog,
            `.jp-AdvancedFileBrowser-${name} .jp-AdvancedFileBrowser-copyStatValue`
          );
        add(entry.files, stat('copyFiles'));
        add(entry.bytes, stat('copyBytes'));
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, DIALOG);
}

async function copyLog(
  page: IJupyterLabPageFixture
): Promise<{ dialogs: IDialogLog[]; most: number }> {
  return page.evaluate(() => (window as any).__copyLog);
}

/** The paths of the listed rows. */
async function listed(page: IJupyterLabPageFixture): Promise<string[]> {
  return (await visibleRows(page)).map(row => row.path);
}

function rising(values: number[]): void {
  expect(values.length).toBeGreaterThan(2);
  expect(values[0]).toBeLessThan(100);
  expect(values).toEqual([...values].sort((a, b) => a - b));
  expect(values[values.length - 1]).toBe(100);
}

test('ACC-COPY-162-PROGRESS-SHOW a slow Copy-Paste, a Cut-Paste across volumes and a breadcrumb drop back show the dialog; a small Paste shows none', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  const root = await serverRoot(page);
  // The drop on the home breadcrumb lands in the server root, which every test shares
  const name = `acc162-${Date.now()}.bin`;
  await bigFile(page, `${tmpPath}/${name}`);
  await writeTree(page, `${tmpPath}/many`, 300);
  writeFileSync(await onDisk(page, `${tmpPath}/small.txt`), 'x');
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const shown = async () => (await copyLog(page)).dialogs.length;
  try {
    await (
      await paste(page, tmpPath, ['small.txt'], `${tmpPath}/dst`)
    ).done;
    expect(await page.contents.fileExists(`${tmpPath}/dst/small.txt`)).toBe(
      true
    );
    expect(await shown()).toBe(0);

    await (
      await paste(page, tmpPath, [name], `${tmpPath}/dst`)
    ).done;
    expect(await shown()).toBe(1);
    await (
      await paste(page, tmpPath, ['many'], `${tmpPath}/dst`)
    ).done;
    expect(await shown()).toBe(2);
    await (
      await paste(page, tmpPath, [name], vol, true)
    ).done;
    expect(await shown()).toBe(3);
    expect(await sizeOf(page, `${vol}/${name}`)).toBe(SLOW);

    // The listing shows vol; drag the moved file back onto the home breadcrumb
    const start = await centreOf(
      (await rowLocator(page, `${vol}/${name}`)).locator(
        '.jp-DirListing-itemText'
      )
    );
    const home = await centreOf(
      page.locator('#filebrowser .jp-BreadCrumbs-home')
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
    await page.mouse.move(home.x, home.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(shown).toBe(4);
    await expect(page.locator(DIALOG)).toHaveCount(0, { timeout: 60000 });
    expect(statSync(join(root, name)).size).toBe(SLOW);
    expect(existsSync(await onDisk(page, `${vol}/${name}`))).toBe(false);
    expect((await copyLog(page)).dialogs.map(d => d.title)).toEqual([
      'Copying 1 item',
      'Copying 1 item',
      'Moving 1 item',
      'Moving 1 item'
    ]);
  } finally {
    rmSync(join(root, name), { force: true });
  }
});

test('ACC-COPY-162-PROGRESS-SHOW a slow Ctrl-drag of a row onto a folder row shows the dialog and the copy lands in that folder', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await openFolder(page, tmpPath);
  await recordDialogs(page);

  // Control makes the drop a copy: a move on one volume is a rename, done at once
  await dragRow(page, `${tmpPath}/big.bin`, `${tmpPath}/dst`, true);

  await expect
    .poll(async () => (await copyLog(page)).dialogs.map(d => d.title))
    .toEqual(['Copying 1 item']);
  await expect(page.locator(DIALOG)).toHaveCount(0, { timeout: 60000 });
  expect(await sizeOf(page, `${tmpPath}/dst/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-163-PROGRESS-BAR the Total percentage only rises and ends at 100', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  await bigFile(page, `${tmpPath}/copy.bin`);
  await bigFile(page, `${tmpPath}/move.bin`);
  await recordDialogs(page);

  await (
    await paste(page, tmpPath, ['copy.bin'], vol)
  ).done;
  await (
    await paste(page, tmpPath, ['move.bin'], vol, true)
  ).done;

  const { dialogs } = await copyLog(page);
  expect(dialogs.map(d => d.title)).toEqual([
    'Copying 1 item',
    'Moving 1 item'
  ]);
  for (const { total, closedAt } of dialogs) {
    rising(total);
    expect(closedAt).toBe(100);
  }
});

test('ACC-COPY-164-BACKGROUND a folder lists within 2 s during a copy', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await folder(page, `${tmpPath}/other`);
  for (const name of ['x.txt', 'y.txt']) {
    writeFileSync(await onDisk(page, `${tmpPath}/other/${name}`), name);
  }
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(page.locator(DIALOG)).toBeVisible();

  const opened = await page.evaluate(async path => {
    const app = window.jupyterapp;
    const browser: any = Array.from(app.shell.widgets('left')).find(
      widget => widget.id === 'filebrowser'
    );
    const started = performance.now();
    await app.commands.execute('filebrowser:go-to-path', { path });
    return {
      ms: performance.now() - started,
      names: Array.from(browser.model.items(), (item: any) => item.name).sort()
    };
  }, `${tmpPath}/other`);
  // The copy still ran after the listing
  const during = parseInt((await page.locator(TOTAL).textContent())!, 10);

  expect(opened.names).toEqual(['x.txt', 'y.txt']);
  expect(opened.ms).toBeLessThan(2000);
  expect(during).toBeLessThan(100);
  await expect
    .poll(() => listed(page))
    .toEqual([`${tmpPath}/other/x.txt`, `${tmpPath}/other/y.txt`]);
  await done;
  expect(await sizeOf(page, `${tmpPath}/dst/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-165-PROGRESS-TITLE Copying 3 items and Moving 3 items', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  await bigFile(page, `${tmpPath}/big.bin`);
  writeFileSync(await onDisk(page, `${tmpPath}/a.txt`), 'a');
  await folder(page, `${tmpPath}/b`);
  writeFileSync(await onDisk(page, `${tmpPath}/b/c.txt`), 'c');
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const items = ['big.bin', 'a.txt', 'b'];

  await (
    await paste(page, tmpPath, items, `${tmpPath}/dst`)
  ).done;
  await (
    await paste(page, tmpPath, items, vol, true)
  ).done;

  expect((await copyLog(page)).dialogs.map(d => d.title)).toEqual([
    'Copying 3 items',
    'Moving 3 items'
  ]);
  expect(await page.contents.fileExists(`${tmpPath}/dst/b/c.txt`)).toBe(true);
  expect(existsSync(await onDisk(page, `${vol}/b/c.txt`))).toBe(true);
});

test('ACC-COPY-192-SLOW-WARNING the warning line across volumes says it may be slower, none on one', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  await bigFile(page, `${tmpPath}/copy.bin`);
  await bigFile(page, `${tmpPath}/move.bin`);
  await folder(page, `${tmpPath}/dst`);
  const warning = page.locator(`${DIALOG} .jp-AdvancedFileBrowser-copyWarning`);

  for (const [name, to, cut, expected] of [
    ['copy.bin', vol, false, 'Cross-volume copy, may be slower'],
    ['move.bin', vol, true, 'Cross-volume move, may be slower'],
    ['copy.bin', `${tmpPath}/dst`, false, '']
  ] as const) {
    const { done } = await paste(page, tmpPath, [name], to, cut);
    await expect(page.locator(TOTAL)).toBeVisible();
    if (expected) {
      await expect(warning).toBeVisible();
      await expect(warning).toHaveText(expected);
    } else {
      await expect(warning).toBeHidden();
    }
    await done;
  }
});

test('ACC-COPY-167-FROM-TO From and To name one file under the source and the destination', async ({
  page,
  tmpPath
}) => {
  await folder(page, `${tmpPath}/src`);
  await bigFile(page, `${tmpPath}/src/big.bin`);
  await folder(page, `${tmpPath}/dst`);

  const { done } = await paste(page, tmpPath, ['src'], `${tmpPath}/dst`);

  // Relative to the server root: tmpPath has no leading slash
  const paths = page.locator(`${DIALOG} .jp-AdvancedFileBrowser-copyPath`);
  await expect(paths).toHaveText([
    `${tmpPath}/src/big.bin`,
    `${tmpPath}/dst/src/big.bin`
  ]);
  await expect(paths.first()).toHaveAttribute(
    'title',
    `${tmpPath}/src/big.bin`
  );
  await done;
});

test('ACC-COPY-168-FILE-BAR the File percentage rises to 100', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);

  await (
    await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`)
  ).done;

  const { dialogs } = await copyLog(page);
  expect(dialogs).toHaveLength(1);
  rising(dialogs[0].file);
});

test('ACC-COPY-168-FILE-BAR the File percentage goes back to 0 when the next file starts', async ({
  page,
  tmpPath
}) => {
  await folder(page, `${tmpPath}/src`);
  await bigFile(page, `${tmpPath}/src/a.bin`);
  await bigFile(page, `${tmpPath}/src/b.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);

  await (
    await paste(page, tmpPath, ['src'], `${tmpPath}/dst`)
  ).done;

  const { dialogs } = await copyLog(page);
  expect(dialogs).toHaveLength(1);
  const { file } = dialogs[0];
  // One fall, where the second file starts; the first poll in it lands a few percent past 0
  const falls = file.filter((value, i) => i > 0 && value < file[i - 1]);
  expect(falls).toHaveLength(1);
  expect(falls[0]).toBeLessThan(50);
  expect(file[file.length - 1]).toBe(100);
});

test('ACC-COPY-169-COUNTERS five counters, Files and Bytes only rise', async ({
  page,
  tmpPath
}) => {
  await writeTree(page, `${tmpPath}/many`, 300);
  await bigFile(page, `${tmpPath}/many/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const value = (name: string) =>
    page.locator(
      `${DIALOG} .jp-AdvancedFileBrowser-${name} .jp-AdvancedFileBrowser-copyStatValue`
    );

  const { done } = await paste(page, tmpPath, ['many'], `${tmpPath}/dst`);

  await expect(
    page.locator(`${DIALOG} .jp-AdvancedFileBrowser-copyStatKey`)
  ).toHaveText(['Files', 'Bytes', 'Speed', 'Elapsed', 'Left']);
  await expect(value('copyFiles')).toHaveText(/^\d+ \/ 301$/);
  await expect(value('copyBytes')).toHaveText(/^\d\.\d\d \/ 0\.02 GiB$/);
  await expect(value('copySpeed')).toHaveText(/^\d+ MiB\/s$/);
  await expect(value('copyElapsed')).toHaveText(/^\d+:\d\d$/);
  await expect(value('copyLeft')).toHaveText(/^\d+:\d\d$/);
  await done;

  const [{ files, bytes }] = (await copyLog(page)).dialogs;
  expect(files[files.length - 1]).toBe('301 / 301');
  expect(bytes[bytes.length - 1]).toBe('0.02 / 0.02 GiB');
  // The count done, before the slash
  for (const counts of [files, bytes].map(texts => texts.map(parseFloat))) {
    expect(counts.length).toBeGreaterThan(1);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  }
});

test('ACC-COPY-171-CANCEL Cancel closes the dialog and leaves no partial file', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(page.locator(TOTAL)).toBeVisible();

  await button(page, 'Cancel').click();

  await expect(page.locator(DIALOG)).toHaveCount(0);
  await done;
  expect((await copyLog(page)).dialogs[0].closedAt).toBeLessThan(100);
  expect(existsSync(await onDisk(page, `${tmpPath}/dst/big.bin`))).toBe(false);
  await expect.poll(() => listed(page)).toEqual([]);
  expect(await sizeOf(page, `${tmpPath}/big.bin`)).toBe(SLOW);
  // A cancelled copy reports no error
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});

test('ACC-COPY-172-PROGRESS-END the dialog closes and the copy is listed', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);

  await (
    await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`)
  ).done;

  expect((await copyLog(page)).dialogs.map(d => d.closedAt)).toEqual([100]);
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect.poll(() => listed(page)).toEqual([`${tmpPath}/dst/big.bin`]);
  expect(await sizeOf(page, `${tmpPath}/dst/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-173-FAIL the error names each path not done and the done files are listed', async ({
  page,
  tmpPath
}) => {
  test.skip(
    process.getuid?.() === 0,
    'root reads a file without read permission'
  );
  await folder(page, `${tmpPath}/src`);
  await bigFile(page, `${tmpPath}/src/big.bin`);
  writeFileSync(await onDisk(page, `${tmpPath}/src/ok.txt`), 'ok');
  const locked = await onDisk(page, `${tmpPath}/src/locked.txt`);
  writeFileSync(locked, 'locked');
  chmodSync(locked, 0o000);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);

  await (
    await paste(page, tmpPath, ['src'], `${tmpPath}/dst`)
  ).done;

  expect((await copyLog(page)).dialogs.map(d => d.closedAt)).toEqual([100]);
  const error = page.locator('.jp-Dialog', { hasText: 'Paste Error' });
  await expect(error.locator('.jp-Dialog-body')).toHaveText(
    `Not copied: ${tmpPath}/src/locked.txt: permission denied`
  );
  await error.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await openFolder(page, `${tmpPath}/dst/src`);
  await expect
    .poll(async () => (await listed(page)).sort())
    .toEqual([`${tmpPath}/dst/src/big.bin`, `${tmpPath}/dst/src/ok.txt`]);
  expect(await sizeOf(page, `${tmpPath}/dst/src/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-200-PARTIAL-LEFT a cancelled job names the partial copy it left in the end dialog', async ({
  page,
  tmpPath
}) => {
  writeFileSync(await onDisk(page, `${tmpPath}/a.txt`), 'a');
  await folder(page, `${tmpPath}/dst`);
  // The whole job is routed: its start, its reports and the cancel, after which the share kept
  // the partial file
  const id = 'e'.repeat(32);
  let ended = false;
  await page.route(
    /\/jupyterlab-advanced-file-browser-extension\/copy(\/[0-9a-f]{32})?(\?|$)/,
    async route => {
      const request = route.request();
      if (!new URL(request.url()).pathname.endsWith(id)) {
        return route.fulfill({ status: 202, json: { id, rename: [] } });
      }
      if (request.method() === 'DELETE') {
        ended = true;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({
        json: {
          files_total: 2,
          bytes_total: 200 * MIB,
          files: 0,
          bytes: MIB,
          file_size: 200 * MIB,
          file_bytes: MIB,
          from: `${tmpPath}/a.txt`,
          to: `${tmpPath}/dst/a.txt`,
          cross: false,
          done: ended,
          elapsed: 1,
          paused: null,
          // The failure before the cancel stays unreported, as in any cancelled job
          errors: [
            { path: `${tmpPath}/b.txt`, message: 'permission denied' },
            { path: `${tmpPath}/dst/a.txt`, message: 'partial copy left' }
          ],
          not_done: [`${tmpPath}/a.txt`]
        }
      });
    }
  );

  const { done } = await paste(page, tmpPath, ['a.txt'], `${tmpPath}/dst`);
  await button(page, 'Cancel').click();
  await done;

  const error = page.locator('.jp-Dialog', { hasText: 'Paste Error' });
  await expect(error.locator('.jp-Dialog-body')).toHaveText(
    `Not copied: ${tmpPath}/dst/a.txt: partial copy left`
  );
});

test('DEF-COPY-50-RELOAD-REATTACH-REPORT a reattached job that ends with errors names them and refreshes the listing', async ({
  page,
  tmpPath
}) => {
  writeFileSync(await onDisk(page, `${tmpPath}/a.txt`), 'a');
  await folder(page, `${tmpPath}/dst`);
  // The whole job is routed: its start and its reports; the done report is held back until the
  // reload has reattached the job
  const id = 'd'.repeat(32);
  let ended = false;
  await page.route(
    /\/jupyterlab-advanced-file-browser-extension\/copy(\/[0-9a-f]{32})?(\?|$)/,
    async route => {
      const request = route.request();
      if (!new URL(request.url()).pathname.endsWith(id)) {
        return route.fulfill({ status: 202, json: { id, rename: [] } });
      }
      return route.fulfill({
        json: {
          files_total: 1,
          bytes_total: 1,
          files: 0,
          bytes: 0,
          file_size: 1,
          file_bytes: 0,
          from: `${tmpPath}/a.txt`,
          to: `${tmpPath}/dst/a.txt`,
          cross: false,
          done: ended,
          elapsed: 1,
          paused: null,
          ...(ended
            ? {
                errors: [
                  {
                    path: `${tmpPath}/a.txt`,
                    message: 'no space left on device'
                  }
                ],
                not_done: [`${tmpPath}/a.txt`]
              }
            : {})
        }
      });
    }
  );

  const { done } = await paste(page, tmpPath, ['a.txt'], `${tmpPath}/dst`);
  // The reload destroys the page context the Paste waits in
  void done.catch(() => undefined);
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.reload();

  // The server job went on; its stored id brings the status item back
  const status = page.locator(STATUS);
  await expect(status).toBeVisible({ timeout: 30000 });

  // Count the contents reads from here: the done report must refresh the listing
  let reads = 0;
  page.on('request', request => {
    if (request.url().includes('/api/contents')) {
      reads++;
    }
  });
  const before = reads;
  ended = true;

  const error = page.locator('.jp-Dialog', {
    hasText: `Not copied: ${tmpPath}/a.txt: no space left on device`
  });
  await expect(error.locator('.jp-Dialog-body')).toHaveText(
    `Not copied: ${tmpPath}/a.txt: no space left on device`
  );
  await expect(status).toBeHidden();
  await expect.poll(() => reads).toBeGreaterThan(before);
});

test('ACC-COPY-174-BUTTONS Cancel and Hide only and no close control', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);

  await expect(page.locator(`${DIALOG} .jp-Dialog-button`)).toHaveText([
    'Cancel',
    'Hide'
  ]);
  await expect(header(page)).toHaveText('Copying 1 item');
  await expect(header(page).locator('button')).toHaveCount(0);
  await expect(page.locator(`${DIALOG} .jp-Dialog-close-button`)).toHaveCount(
    0
  );
  await done;
});

test('ACC-COPY-175-HIDE Hide closes the dialog and the copy completes', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(page.locator(TOTAL)).toBeVisible();

  await hide(page);

  expect((await copyLog(page)).dialogs[0].closedAt).toBeLessThan(100);
  await done;
  await expect.poll(() => listed(page)).toEqual([`${tmpPath}/dst/big.bin`]);
  expect(await sizeOf(page, `${tmpPath}/dst/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-178-PARALLEL a second Paste during a copy runs at once and both reach 100', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/first.bin`, LONG);
  await bigFile(page, `${tmpPath}/second.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const from = page
    .locator(`${DIALOG} .jp-AdvancedFileBrowser-copyPath`)
    .first();

  const first = await paste(page, tmpPath, ['first.bin'], `${tmpPath}/dst`);
  await expect(from).toHaveText(`${tmpPath}/first.bin`);
  const second = await paste(page, tmpPath, ['second.bin'], `${tmpPath}/dst`);
  await expect(from).toHaveText(`${tmpPath}/second.bin`);
  await second.done;

  // Started later and shorter, the second ended while the first still ran: not queued behind it
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(page.locator(STATUS)).toBeVisible();
  await page.locator(STATUS).click();
  await expect(from).toHaveText(`${tmpPath}/first.bin`);
  await first.done;

  const { dialogs } = await copyLog(page);
  for (const name of ['first.bin', 'second.bin']) {
    const own = dialogs.filter(d => d.from === `${tmpPath}/${name}`);
    expect(own.length).toBeGreaterThan(0);
    expect(own[own.length - 1].closedAt).toBe(100);
  }
  expect(await sizeOf(page, `${tmpPath}/dst/first.bin`)).toBe(LONG);
  expect(await sizeOf(page, `${tmpPath}/dst/second.bin`)).toBe(SLOW);
});

test('ACC-COPY-179-ONE-DIALOG a second dialog hides the first to the status bar and the menu swaps them back', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/first.bin`, LONG);
  await bigFile(page, `${tmpPath}/second.bin`, LONG);
  writeFileSync(await onDisk(page, `${tmpPath}/a.txt`), 'a');
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const status = page.locator(STATUS);

  const first = await paste(page, tmpPath, ['first.bin'], `${tmpPath}/dst`);
  await expect(header(page)).toHaveText('Copying 1 item');
  const second = await paste(
    page,
    tmpPath,
    ['second.bin', 'a.txt'],
    `${tmpPath}/dst`
  );
  await expect(header(page)).toHaveText('Copying 2 items');
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await expect(status).toBeVisible();
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyStatusTitle')
  ).toHaveText('Copying 1 item');

  await hide(page);
  await status.click();
  await page.locator(ROWS, { hasText: 'Copying 1 item' }).click();

  await expect(header(page)).toHaveText('Copying 1 item');
  await expect(page.locator(DIALOG)).toHaveCount(1);
  await expect(page.locator(MENU)).toHaveCount(0);
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyStatusTitle')
  ).toHaveText('Copying 2 items');
  await Promise.all([first.done, second.done]);
  expect((await copyLog(page)).most).toBe(1);
});

test('ACC-COPY-180-STATUS-ONE one item for one and for three hidden operations, gone after the last', async ({
  page,
  tmpPath
}) => {
  await seedThree(page, tmpPath);
  const status = page.locator(STATUS);
  const statusTitle = status.locator('.jp-AdvancedFileBrowser-copyStatusTitle');
  await expect(status).toBeHidden();

  const done = [(await startHidden(page, tmpPath, THREE[0])).done];
  await expect(status).toBeVisible();
  await expect(statusTitle).toHaveText('Copying 1 item');
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyTrack')
  ).toBeVisible();
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyPercent')
  ).toHaveText(/^\d+%$/);

  done.push((await startHidden(page, tmpPath, THREE[1])).done);
  done.push((await startHidden(page, tmpPath, THREE[2])).done);
  await expect(statusTitle).toHaveText('3 operations');
  await expect(page.locator('.jp-AdvancedFileBrowser-copyStatus')).toHaveCount(
    1
  );
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyTrack')
  ).toBeVisible();
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyPercent')
  ).toHaveText(/^\d+%$/);

  await Promise.all(done);
  await expect(status).toBeHidden();
});

test('ACC-COPY-181-STATUS-CLICK one hidden operation opens its dialog, three open the menu', async ({
  page,
  tmpPath
}) => {
  await seedThree(page, tmpPath);
  const status = page.locator(STATUS);
  const done = [(await startHidden(page, tmpPath, THREE[0])).done];

  await status.click();
  await expect(header(page)).toHaveText('Copying 1 item');
  await expect(page.locator(MENU)).toHaveCount(0);

  // The next dialog hides this one again
  done.push((await startHidden(page, tmpPath, THREE[1])).done);
  done.push((await startHidden(page, tmpPath, THREE[2])).done);
  await status.click();
  await expect(page.locator(ROWS)).toHaveCount(3);
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await Promise.all(done);
  await expect(page.locator(MENU)).toHaveCount(0);
});

test('ACC-COPY-182-OPS-MENU the menu above the item lists three rows with title, bar and percentage', async ({
  page,
  tmpPath
}) => {
  const done = await threeHidden(page, tmpPath);

  await page.locator(STATUS).click();

  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const item = (await page.locator(STATUS).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(item.y + 1);
  const rows = page.locator(ROWS);
  await expect(
    rows.locator('.jp-AdvancedFileBrowser-copyMenuTitle')
  ).toHaveText(THREE.map(names => title(names.length)));
  for (let i = 0; i < 3; i++) {
    const row = rows.nth(i);
    await expect(
      row.locator('.jp-AdvancedFileBrowser-copyTrack')
    ).toBeVisible();
    await expect(
      row.locator('.jp-AdvancedFileBrowser-copyTrack')
    ).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(row.locator('.jp-AdvancedFileBrowser-copyPercent')).toHaveText(
      /^\d+%$/
    );
  }
  await Promise.all(done);
});

test('ACC-COPY-183-MENU-PICK a chosen row opens its dialog and closes the menu', async ({
  page,
  tmpPath
}) => {
  const done = await threeHidden(page, tmpPath);
  await page.locator(STATUS).click();

  await page.locator(ROWS).nth(1).click();

  await expect(header(page)).toHaveText('Copying 2 items');
  await expect(page.locator(MENU)).toHaveCount(0);
  await expect(
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyStatusTitle`)
  ).toHaveText('2 operations');
  await Promise.all(done);
});

test('ACC-COPY-184-ESCAPE Escape hides the dialog and the copy completes', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  await recordDialogs(page);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(page.locator(TOTAL)).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(page.locator(STATUS)).toBeVisible();
  await expect(
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyStatusTitle`)
  ).toHaveText('Copying 1 item');
  expect((await copyLog(page)).dialogs[0].closedAt).toBeLessThan(100);
  await done;
  await expect(page.locator(STATUS)).toBeHidden();
  await expect.poll(() => listed(page)).toEqual([`${tmpPath}/dst/big.bin`]);
  expect(await sizeOf(page, `${tmpPath}/dst/big.bin`)).toBe(SLOW);
});

test('ACC-COPY-185-MENU-DETAIL each row shows its file count and a time-ago text', async ({
  page,
  tmpPath
}) => {
  const done = await threeHidden(page, tmpPath);

  await page.locator(STATUS).click();

  const details = page.locator(
    `${ROWS} .jp-AdvancedFileBrowser-copyMenuDetail`
  );
  await expect(details).toHaveText([
    /^1 file · \d+ s ago$/,
    /^2 files · \d+ s ago$/,
    /^3 files · \d+ s ago$/
  ]);
  // Started in that order, so the first is the oldest
  const ago = (await details.allTextContents()).map(t =>
    parseInt(/(\d+) s ago/.exec(t)![1], 10)
  );
  expect(ago).toEqual([...ago].sort((a, b) => b - a));
  await Promise.all(done);
});

/** Problems of the open progress dialog's layout: overflow of the window, a scroll, a part outside its row. */
async function layoutProblems(
  page: IJupyterLabPageFixture,
  width: number
): Promise<string[]> {
  return page.evaluate(
    ({ selector, width }) => {
      const problems: string[] = [];
      const dialog = document.querySelector(selector)!;
      const content = dialog.querySelector('.jp-Dialog-content')!;
      const box = content.getBoundingClientRect();
      const wanted = Math.min(460, width - 32);
      if (
        Math.abs(box.width - wanted) > 1 ||
        box.left < 0 ||
        box.right > width
      ) {
        problems.push(
          `dialog ${Math.round(box.left)}-${Math.round(box.right)}, wanted ${wanted} px wide`
        );
      }
      for (const node of [
        dialog,
        content,
        ...content.querySelectorAll('.jp-Dialog-body')
      ]) {
        if (node.scrollWidth > node.clientWidth + 1) {
          problems.push(`horizontal scroll in ${node.getAttribute('class')}`);
        }
      }
      for (const node of content.querySelectorAll('*')) {
        const own = node.getBoundingClientRect();
        if (!own.width || !node.parentElement) {
          continue;
        }
        const row = node.parentElement.getBoundingClientRect();
        if (own.left < row.left - 1 || own.right > row.right + 1) {
          problems.push(
            `${node.getAttribute('class') ?? node.tagName} ${Math.round(own.left)}-${Math.round(own.right)} outside ${Math.round(row.left)}-${Math.round(row.right)}`
          );
        }
      }
      return problems;
    },
    { selector: DIALOG, width }
  );
}

test('ACC-COPY-186-NARROW-DIALOG the dialog fits the window down to 320 px', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  await bigFile(page, `${tmpPath}/big.bin`, LONG);
  const { done } = await paste(page, tmpPath, ['big.bin'], vol);
  await expect(page.locator(TOTAL)).toBeVisible();

  for (const width of [1280, 470, 390, 350, 320]) {
    await page.setViewportSize({ width, height: 768 });
    await expect
      .poll(() => layoutProblems(page, width), { message: `${width} px` })
      .toEqual([]);
  }
  await button(page, 'Cancel').click();
  await done;
});

test('ACC-COPY-187-NARROW-STEPS the dialog drops Speed and Elapsed, then File, then From and To', async ({
  page,
  tmpPath
}) => {
  const vol = await otherVolume(page, tmpPath);
  await bigFile(page, `${tmpPath}/big.bin`, LONG);
  const { done } = await paste(page, tmpPath, ['big.bin'], vol);
  await expect(page.locator(TOTAL)).toBeVisible();
  const part = (css: string) =>
    page.locator(`${DIALOG} .jp-AdvancedFileBrowser-${css}`);
  const parts = {
    title: header(page),
    warning: part('copyWarning'),
    paths: part('copyPaths'),
    fileKey: part('copyKey.jp-AdvancedFileBrowser-copyFile'),
    fileBar: part('copyBar.jp-AdvancedFileBrowser-copyFile'),
    total: page.locator(TOTAL),
    files: part('copyFiles'),
    bytes: part('copyBytes'),
    speed: part('copySpeed'),
    elapsed: part('copyElapsed'),
    left: part('copyLeft'),
    cancel: button(page, 'Cancel'),
    hide: button(page, 'Hide')
  };
  const hidden: Record<number, string[]> = {
    1280: [],
    470: ['speed', 'elapsed'],
    390: ['speed', 'elapsed', 'fileKey', 'fileBar'],
    350: ['speed', 'elapsed', 'fileKey', 'fileBar', 'paths']
  };

  for (const [width, gone] of Object.entries(hidden)) {
    await page.setViewportSize({ width: Number(width), height: 768 });
    for (const [name, locator] of Object.entries(parts)) {
      if (gone.includes(name)) {
        await expect(locator, `${name} at ${width} px`).toBeHidden();
      } else {
        await expect(locator, `${name} at ${width} px`).toBeVisible();
      }
    }
    // The warning stays one line at every width (ACC-COPY-192)
    const lines = await parts.warning.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(Array.from(range.getClientRects(), r => Math.round(r.top)))
        .size;
    });
    expect(lines, `warning lines at ${width} px`).toBe(1);
  }
  await button(page, 'Cancel').click();
  await done;
});

/**
 * Set the window width, then wait for a repaint of the status item: the stock status bar applies
 * its narrow-window rule to an item only when the item's state signal fires, on each poll.
 */
async function resize(page: IJupyterLabPageFixture, width: number) {
  const percent = page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyPercent`);
  const before = await percent.textContent();
  await page.setViewportSize({ width, height: 768 });
  await expect.poll(() => percent.textContent()).not.toBe(before);
}

/**
 * Register a 480 px wide left-hand status item, as the Terminals, Git, Mem and CPU items of a lab
 * with other extensions make, so the narrow steps are measured beside it. Priority 1 keeps it
 * shown at 630 px and below.
 */
async function wideLeftItem(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(async () => {
    const statusBar: any = await window.galata.getPlugin(
      '@jupyterlab/statusbar-extension:plugin' as any
    );
    // The status bar extends Lumino's Widget, the class a status item must have
    const Widget = Object.getPrototypeOf(statusBar.constructor);
    const item = new Widget();
    item.node.textContent = 'Wide left-hand item';
    item.node.style.minWidth = '480px';
    statusBar.registerStatusItem('test:wide-left', {
      item,
      align: 'left',
      priority: 1
    });
  });
}

test('ACC-COPY-188-NARROW-STATUS the status item drops its title, then its bar', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`, LONG);
  await folder(page, `${tmpPath}/dst`);
  const { done } = await startHidden(page, tmpPath, ['big.bin']);
  await wideLeftItem(page);
  const part = (css: string) =>
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-${css}`);
  const parts = {
    title: part('copyStatusTitle'),
    bar: part('copyTrack'),
    percent: part('copyPercent')
  };
  const hidden: Record<number, string[]> = {
    1280: [],
    590: ['title'],
    390: ['title', 'bar']
  };

  for (const [width, gone] of Object.entries(hidden)) {
    await resize(page, Number(width));
    for (const [name, locator] of Object.entries(parts)) {
      if (gone.includes(name)) {
        await expect(locator, `${name} at ${width} px`).toBeHidden();
      } else {
        await expect(locator, `${name} at ${width} px`).toBeVisible();
      }
    }
    // Visible is not enough: other status items can push it past the window's edge
    const box = (await parts.percent.boundingBox())!;
    expect(
      box.x + box.width,
      `percent right at ${width} px`
    ).toBeLessThanOrEqual(Number(width));
  }
  await done;
});

test('ACC-COPY-189-NARROW-MENU the menu fits the window and drops the row bars below 360 px', async ({
  page,
  tmpPath
}) => {
  const done = await threeHidden(page, tmpPath);
  await wideLeftItem(page);
  const menu = page.locator(MENU);

  for (const width of [1280, 350]) {
    await resize(page, width);
    await page.locator(STATUS).click();
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x, `menu left at ${width} px`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `menu right at ${width} px`).toBeLessThanOrEqual(
      width
    );
    expect(Math.abs(box.width - Math.min(320, width - 32))).toBeLessThanOrEqual(
      1
    );
    const rows = page.locator(ROWS);
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i);
      const bar = row.locator('.jp-AdvancedFileBrowser-copyTrack');
      if (width < 360) {
        await expect(bar).toBeHidden();
      } else {
        await expect(bar).toBeVisible();
      }
      for (const css of ['copyMenuTitle', 'copyPercent', 'copyMenuDetail']) {
        await expect(
          row.locator(`.jp-AdvancedFileBrowser-${css}`)
        ).toBeVisible();
      }
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  await Promise.all(done);
});

test('ACC-COPY-202-STATUS-PLACE the status item sits at the end of the left-hand group, and its menu opens inside the window', async ({
  page,
  tmpPath
}) => {
  await seedThree(page, tmpPath);
  const done = [(await startHidden(page, tmpPath, THREE[0])).done];
  await expect(page.locator(STATUS)).toBeVisible();

  const place = await page.evaluate(selector => {
    const item = document.querySelector(selector)!;
    const bar = document.querySelector('#jp-main-statusbar')!;
    const left = bar.querySelector('.jp-StatusBar-Left')!;
    const itemBox = item.getBoundingClientRect();
    const group = left.contains(item) ? 'left' : null;
    return {
      group,
      // The left edge of every other shown left-hand item, from the item's left edge
      others: Array.from(left.children)
        .filter(node => node !== item && node.getBoundingClientRect().width)
        .map(node => itemBox.left - node.getBoundingClientRect().left)
    };
  }, STATUS);
  expect(place.group).toBe('left');
  expect(place.others.length).toBeGreaterThan(0);
  for (const gap of place.others) {
    expect(gap).toBeGreaterThan(0);
  }

  done.push((await startHidden(page, tmpPath, THREE[1])).done);
  done.push((await startHidden(page, tmpPath, THREE[2])).done);
  await page.locator(STATUS).click();
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await Promise.all(done);
});

test('DEF-COPY-48-BUTTON-LABEL the Cancel and Hide labels sit on the centre of the 28 px buttons', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(header(page)).toHaveText('Copying 1 item');

  for (const label of ['Cancel', 'Hide']) {
    const metrics = await button(page, label).evaluate(node => {
      const box = node.getBoundingClientRect();
      const labelBox = node
        .querySelector('.jp-Dialog-buttonLabel')!
        .getBoundingClientRect();
      return {
        lineHeight: parseFloat(getComputedStyle(node).lineHeight),
        height: box.height,
        labelCentre: labelBox.top + labelBox.height / 2,
        buttonCentre: box.top + box.height / 2
      };
    });
    // The stock button.jp-mod-styled line box would overflow the 28 px height
    expect(metrics.lineHeight, label).toBeCloseTo(metrics.height, 0);
    expect(
      Math.abs(metrics.labelCentre - metrics.buttonCentre),
      label
    ).toBeLessThanOrEqual(1);
  }

  await button(page, 'Cancel').click();
  await done;
});

test('DEF-COPY-50-RELOAD-REATTACH a reload brings the status item back and its job can be cancelled', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`, LONG);
  await folder(page, `${tmpPath}/dst`);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  // The reload destroys the page context the Paste waits in
  void done.catch(() => undefined);
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.reload();

  // The server job went on; its stored id brings the status item back
  const status = page.locator(STATUS);
  await expect(status).toBeVisible({ timeout: 30000 });
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyStatusTitle')
  ).toHaveText('Copying 1 item');
  await expect(
    status.locator('.jp-AdvancedFileBrowser-copyPercent')
  ).toHaveText(/^\d+%$/);

  await status.click();
  await expect(header(page)).toHaveText('Copying 1 item');
  await expect(
    page.locator(`${DIALOG} .jp-AdvancedFileBrowser-copyPath`).first()
  ).toHaveText(`${tmpPath}/big.bin`);

  await button(page, 'Cancel').click();
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(status).toBeHidden();
});

test('ACC-COPY-191-HIDE-FOCUS the dialog opens with no button focused; the first Tab focuses Hide with its ring', async ({
  page,
  tmpPath
}) => {
  await bigFile(page, `${tmpPath}/big.bin`);
  await folder(page, `${tmpPath}/dst`);
  const { done } = await paste(page, tmpPath, ['big.bin'], `${tmpPath}/dst`);
  await expect(header(page)).toHaveText('Copying 1 item');

  // The focus is inside the dialog, so its keys reach it, but on no button and with no ring
  expect(
    await page.evaluate(selector => {
      const active = document.activeElement!;
      return {
        inDialog: !!document.querySelector(selector)?.contains(active),
        onButton: !!active.closest('.jp-Dialog-button'),
        outline: getComputedStyle(active).outlineStyle
      };
    }, DIALOG)
  ).toEqual({ inDialog: true, onButton: false, outline: 'none' });

  const hideButton = button(page, 'Hide');
  await page.keyboard.press('Tab');
  await expect(hideButton).toBeFocused();
  expect(
    await hideButton.evaluate(node => {
      const style = getComputedStyle(node);
      return (
        style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
      );
    })
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(button(page, 'Cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(hideButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await done;
});

test('ACC-COPY-194-CHUNK-RETRY a pause opens the hidden dialog once with Retry, Skip file and Cancel; each button sends its action', async ({
  page,
  tmpPath
}) => {
  writeFileSync(await onDisk(page, `${tmpPath}/a.txt`), 'a');
  await folder(page, `${tmpPath}/dst`);
  // The whole job is routed: its start, its reports, the actions and the cancel
  const id = 'f'.repeat(32);
  const sent: string[] = [];
  let paused: { path: string; reason: string } | null = null;
  let ended = false;
  let reads = 0;
  await page.route(
    /\/jupyterlab-advanced-file-browser-extension\/copy(\/[0-9a-f]{32})?(\?|$)/,
    async route => {
      const request = route.request();
      const method = request.method();
      if (!new URL(request.url()).pathname.endsWith(id)) {
        return route.fulfill({ status: 202, json: { id, rename: [] } });
      }
      if (method === 'GET') {
        // The bytes rise at every report, also while paused, so a bar that moves shows
        reads += 1;
        const bytes = reads * MIB;
        return route.fulfill({
          json: {
            files_total: 1,
            bytes_total: 200 * MIB,
            files: 0,
            bytes,
            file_size: 200 * MIB,
            file_bytes: bytes,
            from: `${tmpPath}/a.txt`,
            to: `${tmpPath}/dst/a.txt`,
            cross: false,
            done: ended,
            elapsed: 1,
            paused,
            errors: [],
            not_done: [`${tmpPath}/a.txt`]
          }
        });
      }
      if (method === 'POST') {
        sent.push(request.postDataJSON().action);
        paused = null;
      } else {
        sent.push(method);
        ended = true;
      }
      return route.fulfill({ status: 204 });
    }
  );
  const pause = () => {
    paused = { path: `${tmpPath}/a.txt`, reason: 'read or write error' };
  };
  const footer = page.locator(`${DIALOG} .jp-Dialog-button`);
  const reason = page.locator(`${DIALOG} .jp-AdvancedFileBrowser-copyReason`);
  const pausedButtons = ['Cancel', 'Skip file', 'Retry'];
  const morePolls = async (count: number) => {
    const seen = reads;
    await expect.poll(() => reads).toBeGreaterThanOrEqual(seen + count);
  };

  const { done } = await paste(page, tmpPath, ['a.txt'], `${tmpPath}/dst`);
  await expect(header(page)).toHaveText('Copying 1 item');
  await hide(page);

  // A pause opens the hidden dialog by itself, with the reason in one line that a screen reader
  // announces
  pause();
  await expect(footer).toHaveText(pausedButtons);
  await expect(reason).toHaveText('Paused: read or write error');
  await expect(reason).toHaveAttribute('role', 'alert');
  // The dialog, which takes the focus, is named by its visible title
  await expect(page.locator(DIALOG)).toHaveAttribute(
    'aria-label',
    (await header(page).textContent())!
  );
  expect(
    await reason.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(Array.from(range.getClientRects(), r => Math.round(r.top)))
        .size;
    })
  ).toBe(1);

  // The bars stop while the reports go on
  const total = await page.locator(TOTAL).textContent();
  await morePolls(3);
  await expect(page.locator(TOTAL)).toHaveText(total!);

  // The three buttons fit a 320 px window in one row
  await page.setViewportSize({ width: 320, height: 768 });
  await expect.poll(() => layoutProblems(page, 320)).toEqual([]);
  const boxes = await footer.evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect())
  );
  expect(new Set(boxes.map(box => Math.round(box.top))).size).toBe(1);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(320);
  }
  await page.setViewportSize({ width: 1280, height: 768 });

  // Escape hides it; the status bar item shows the pause, and the dialog opens once per pause
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyStatusPaused`)
  ).toHaveText('Paused');
  await morePolls(3);
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await page.locator(STATUS).click();
  await expect(footer).toHaveText(pausedButtons);

  // Hidden when it paused, the job goes back to the status bar after Retry
  await button(page, 'Retry').click();
  await expect.poll(() => sent).toEqual(['retry']);
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await expect(
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyStatusTitle`)
  ).toHaveText('Copying 1 item');
  await expect(
    page.locator(`${STATUS} .jp-AdvancedFileBrowser-copyStatusPaused`)
  ).toBeHidden();
  await page.locator(STATUS).click();
  await expect(footer).toHaveText(['Cancel', 'Hide']);
  await expect(reason).toBeHidden();

  // A second pause while the dialog shows; the dialog stays open after Retry
  pause();
  await expect(footer).toHaveText(pausedButtons);
  await button(page, 'Retry').click();
  await expect.poll(() => sent).toEqual(['retry', 'retry']);
  await expect(footer).toHaveText(['Cancel', 'Hide']);

  // A third pause; Skip file
  pause();
  await expect(footer).toHaveText(pausedButtons);
  await button(page, 'Skip file').click();
  await expect.poll(() => sent).toEqual(['retry', 'retry', 'skip']);
  await expect(footer).toHaveText(['Cancel', 'Hide']);

  // A fourth pause; Cancel cancels as it does while the job runs
  pause();
  await expect(footer).toHaveText(pausedButtons);
  await button(page, 'Cancel').click();
  await expect.poll(() => sent).toEqual(['retry', 'retry', 'skip', 'DELETE']);
  await expect(page.locator(DIALOG)).toHaveCount(0);
  await done;
  await expect(page.locator(STATUS)).toBeHidden();
});
