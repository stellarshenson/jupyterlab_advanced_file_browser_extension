/**
 * New items and renames shown from the server answer (docs/acc-crit.md, ACC-FOLDER-158). A route
 * holds the create (POST) or rename (PATCH) answer of the contents API for HOLD_MS after the
 * server answered, so the time from the answer to the row is measured apart from the round trip
 * and a loaded machine cannot fail it.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  browserHandle,
  menuItem,
  openEmptyAreaMenu,
  openItemMenu,
  rowLocator,
  serverRoot,
  setUnfolding,
  visibleRows
} from './helpers';

const HOLD_MS = 1500;
/** The longest time from the answer to the row; stock showed it in 13-90 ms, 1.0.6 with 8 unfolded folders in 167-256 ms. */
const SHOW_MS = 150;
/**
 * The longest time from the answer to the rename editor, without the server's time for the one
 * listing read of the new item's folder; stock opened it 21-28 ms after the answer.
 */
const EDITOR_MS = 250;
/** How long the row order is watched after the row shows, at least; the watch also lasts until the confirming read is applied. */
const WATCH_MS = 2000;
/** How long the confirming listing read and the rename editor may take on a loaded machine. */
const CONFIRM_MS = 30000;
/** How long a row shown while a listing read is in flight is watched for a removal. */
const KEEP_MS = 4000;
/** How long a held listing read waits after the server answered it. */
const SLOW_MS = 600;
/** The unfolded folders of '8 unfolded folders'. */
const FOLDERS = Array.from({ length: 8 }, (_, f) => `f${f}`);

const VARIANTS = [
  'no unfolded folder',
  '8 unfolded folders',
  'unfolding off'
] as const;
type Variant = (typeof VARIANTS)[number];

/**
 * Hold the first POST or PATCH answer of the contents API; returns when it was let through
 * and when each listing read of `folder` ended.
 */
async function holdAnswer(
  page: IJupyterLabPageFixture,
  folder: string
): Promise<{ answeredAt: () => number; reads: number[] }> {
  let held = false;
  let answeredAt = 0;
  const reads: number[] = [];
  page.on('requestfinished', request => {
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (
      request.method() === 'GET' &&
      path.endsWith(`/api/contents/${folder}`)
    ) {
      reads.push(Date.now());
    }
  });
  await page.route(
    url => url.pathname.includes('/api/contents'),
    async route => {
      const method = route.request().method();
      if (held || (method !== 'POST' && method !== 'PATCH')) {
        return route.fallback();
      }
      held = true;
      const start = Date.now();
      const response = await route.fetch();
      await new Promise(resolve =>
        setTimeout(resolve, start + HOLD_MS - Date.now())
      );
      answeredAt = Date.now();
      await route.fulfill({ response });
    }
  );
  return { answeredAt: () => answeredAt, reads };
}

/**
 * Record in the page when a row named `name` first shows (as text or in the rename editor),
 * then the row names in screen order at every frame for WATCH_MS and until `stop` is set.
 */
async function watchRow(
  page: IJupyterLabPageFixture,
  name: string
): Promise<void> {
  const browser = await browserHandle(page);
  await browser.evaluate(
    (b, { name, watchMs }) => {
      const content: HTMLElement = b.listing.contentNode;
      // The wall clock, as the route's answer time in Node.
      const now = () => Date.now();
      const names = () =>
        Array.from(
          content.querySelectorAll(':scope > .jp-DirListing-item'),
          node =>
            node.querySelector<HTMLInputElement>('input.jp-DirListing-editor')
              ?.value ??
            node.querySelector('.jp-DirListing-itemText')?.textContent ??
            ''
        );
      const rec = {
        shownAt: 0,
        orders: [] as string[][],
        stop: false,
        done: false
      };
      (window as any).__newRow = rec;
      const check = () => {
        if (!rec.shownAt && names().includes(name)) {
          rec.shownAt = now();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(content, {
        childList: true,
        subtree: true,
        characterData: true
      });
      const frame = () => {
        check();
        if (rec.shownAt) {
          rec.orders.push(names());
          if (rec.stop && now() - rec.shownAt >= watchMs) {
            observer.disconnect();
            rec.done = true;
            return;
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { name, watchMs: WATCH_MS }
  );
}

async function watched(page: IJupyterLabPageFixture): Promise<{
  shownAt: number;
  orders: string[][];
}> {
  await page.waitForFunction(() => (window as any).__newRow.done, undefined, {
    timeout: HOLD_MS + WATCH_MS + 15000
  });
  return page.evaluate(() => (window as any).__newRow);
}

/** Three files in the top folder; for '8 unfolded folders' also f0-f7 of 25 files, unfolded. */
async function prepare(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  variant: Variant
): Promise<void> {
  const root = join(await serverRoot(page), tmpPath);
  for (const name of ['a.txt', 'b.txt', 'c.txt']) {
    writeFileSync(join(root, name), name);
  }
  const folders = variant === '8 unfolded folders' ? FOLDERS : [];
  for (const folder of folders) {
    mkdirSync(join(root, folder));
    for (let i = 0; i < 25; i++) {
      writeFileSync(
        join(root, folder, `file${String(i).padStart(2, '0')}.txt`),
        'x'
      );
    }
  }
  await setUnfolding(page, variant !== 'unfolding off');
  await page.filebrowser.refresh();
  const browser = await browserHandle(page);
  for (const folder of folders) {
    await browser.evaluate(
      (b, path) => b.model.toggle(path),
      `${tmpPath}/${folder}`
    );
  }
  await rowLocator(page, `${tmpPath}/c.txt`);
}

/** Assert the row of `path` showed within SHOW_MS of the answer, in place, and never moved. */
async function expectShownInPlace(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  path: string,
  hold: { answeredAt: () => number; reads: number[] }
): Promise<void> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  // A listing read that confirms the change ends after the answer; on a loaded machine after WATCH_MS.
  await expect
    .poll(
      () =>
        hold.answeredAt() > 0 && hold.reads.some(t => t > hold.answeredAt()),
      { timeout: CONFIRM_MS }
    )
    .toBe(true);
  // The model's refresh settles after the read in flight is applied, and the listing renders it at
  // the next frame, so the watch covers the confirmed listing.
  await (
    await browserHandle(page)
  ).evaluate(async b => {
    await b.model.refresh();
    await new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    (window as any).__newRow.stop = true;
  });
  const { shownAt, orders } = await watched(page);
  const answeredAt = hold.answeredAt();
  console.log(
    `NEWITEM ${JSON.stringify({ path: path.slice(tmpPath.length + 1), afterAnswerMs: Math.round(shownAt - answeredAt), frames: orders.length })}`
  );
  expect(answeredAt).toBeGreaterThan(0);
  expect(shownAt - answeredAt).toBeLessThanOrEqual(SHOW_MS);
  expect(orders.length).toBeGreaterThan(10);
  expect(new Set(orders.map(order => order.join('\n'))).size).toBe(1);
  // Its first place on screen is its place in the confirmed listing.
  const rows = await visibleRows(page);
  expect(rows.findIndex(row => row.path === path)).toBe(
    orders[0].indexOf(name)
  );
}

/** Record in the page when each listing read of `folder` is answered and when the rename editor first shows. */
async function watchEditor(
  page: IJupyterLabPageFixture,
  folder: string
): Promise<void> {
  const browser = await browserHandle(page);
  await browser.evaluate((b, folder) => {
    const rec = { reads: [] as number[], editorAt: 0 };
    (window as any).__editor = rec;
    const contents = b.model.manager.services.contents;
    const get = contents.get;
    contents.get = (path: string, options: unknown) =>
      get.call(contents, path, options).then((model: unknown) => {
        if (path === folder) {
          rec.reads.push(Date.now());
        }
        return model;
      });
    const content: HTMLElement = b.listing.contentNode;
    const observer = new MutationObserver(() => {
      if (content.querySelector('input.jp-DirListing-editor')) {
        rec.editorAt = Date.now();
        observer.disconnect();
      }
    });
    observer.observe(content, { childList: true, subtree: true });
  }, folder);
}

/**
 * Assert the rename editor opened on `path` within EDITOR_MS of the last read of its own folder
 * before it, so the server's time for that read, which stock waits for too, is not counted.
 */
async function expectEditorInTime(
  page: IJupyterLabPageFixture,
  path: string,
  answeredAt = 0
): Promise<number> {
  await expect.poll(() => editorRow(page), { timeout: CONFIRM_MS }).toBe(path);
  const { reads, editorAt } = await page.evaluate(
    () => (window as any).__editor
  );
  const read = Math.max(...reads.filter((t: number) => t <= editorAt));
  console.log(
    `EDITOR ${JSON.stringify({ afterOwnReadMs: editorAt - read, afterAnswerMs: answeredAt ? editorAt - answeredAt : null })}`
  );
  expect(editorAt - read).toBeLessThanOrEqual(EDITOR_MS);
  return editorAt;
}

/** The path of the row that holds the rename editor. */
async function editorRow(page: IJupyterLabPageFixture): Promise<string> {
  const browser = await browserHandle(page);
  return browser.evaluate(b => {
    const nodes = Array.from(
      b.listing.contentNode.querySelectorAll(':scope > .jp-DirListing-item')
    ) as HTMLElement[];
    const index = nodes.findIndex(node =>
      node.querySelector('input.jp-DirListing-editor')
    );
    return index === -1
      ? ''
      : Array.from(b.listing.sortedItems() as any[])[index].path;
  });
}

for (const variant of VARIANTS) {
  test.describe(variant, () => {
    test(`ACC-FOLDER-158-NEW-INSTANT New Folder shows at the answer with the rename editor, ${variant}`, async ({
      page,
      tmpPath
    }) => {
      await prepare(page, tmpPath, variant);
      const path = `${tmpPath}/Untitled Folder`;
      const hold = await holdAnswer(page, tmpPath);
      await watchRow(page, 'Untitled Folder');
      await watchEditor(page, tmpPath);

      await page
        .locator(
          '#filebrowser [data-command="filebrowser:create-new-directory"]'
        )
        .first()
        .click();

      await expectShownInPlace(page, tmpPath, path, hold);
      await expectEditorInTime(page, path, hold.answeredAt());
      await page.keyboard.press('Escape');
    });

    test(`ACC-FOLDER-158-NEW-INSTANT New File shows at the answer with the rename editor, ${variant}`, async ({
      page,
      tmpPath
    }) => {
      await prepare(page, tmpPath, variant);
      // With unfolded folders the file lands in the unfolded folder f0, the current folder.
      const nested = variant === '8 unfolded folders';
      const path = `${tmpPath}/${nested ? 'f0/' : ''}untitled.txt`;
      const menu = nested
        ? await openItemMenu(page, `${tmpPath}/f0`)
        : await openEmptyAreaMenu(page);
      // The read that confirms a create is the one read of the new item's folder.
      const hold = await holdAnswer(page, nested ? `${tmpPath}/f0` : tmpPath);
      await watchRow(page, 'untitled.txt');
      await watchEditor(page, nested ? `${tmpPath}/f0` : tmpPath);

      // New Python File runs the same command.
      await menu
        .getByRole('menuitem', { name: 'New File', exact: true })
        .click();

      await expectShownInPlace(page, tmpPath, path, hold);
      await expectEditorInTime(page, path, hold.answeredAt());
      await page.keyboard.press('Escape');
    });

    test(`ACC-FOLDER-158-NEW-INSTANT New Notebook from the launcher shows at the answer, ${variant}`, async ({
      page,
      tmpPath
    }) => {
      await prepare(page, tmpPath, variant);
      await page.evaluate(() =>
        window.jupyterapp.commands.execute('launcher:create')
      );
      const card = page
        .locator('.jp-LauncherCard[data-category="Notebook"]:visible')
        .first();
      await card.waitFor();
      const hold = await holdAnswer(page, tmpPath);
      await watchRow(page, 'Untitled.ipynb');

      await card.click();

      await expectShownInPlace(
        page,
        tmpPath,
        `${tmpPath}/Untitled.ipynb`,
        hold
      );
      await page.kernel.shutdownAll();
    });

    test(`ACC-FOLDER-158-NEW-INSTANT a rename shows the new name at the answer, ${variant}`, async ({
      page,
      tmpPath
    }) => {
      await prepare(page, tmpPath, variant);
      // With unfolded folders a file of the unfolded folder f0; it moves to the end of f0.
      const nested = variant === '8 unfolded folders';
      const from = `${tmpPath}/${nested ? 'f0/file00.txt' : 'a.txt'}`;
      const name = nested ? 'zz.txt' : 'd.txt';
      const path = `${from.slice(0, from.lastIndexOf('/'))}/${name}`;
      const menu = await openItemMenu(page, from);
      await menuItem(menu, 'filebrowser:rename').click();
      const editor = page.locator('#filebrowser input.jp-DirListing-editor');
      await editor.fill(name);
      const hold = await holdAnswer(page, tmpPath);

      await editor.press('Enter');
      // Armed after Enter, so the typed name in the editor does not count as the row.
      await watchRow(page, name);

      await expectShownInPlace(page, tmpPath, path, hold);
      const rows = await visibleRows(page);
      expect(rows.some(row => row.path === from)).toBe(false);
      // As in stock, the renamed row stays selected.
      expect(rows.find(row => row.path === path)?.selected).toBe(true);
    });
  });
}

/** Hold the GET answers of the listing reads whose path `match` names for SLOW_MS. */
async function slowReads(
  page: IJupyterLabPageFixture,
  match: (path: string) => boolean
): Promise<void> {
  await page.route(
    url => match(decodeURIComponent(url.pathname)),
    async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, SLOW_MS));
      await route.fulfill({ response });
    }
  );
}

/** Record in the page the listing's row paths at every frame for KEEP_MS from the first frame that holds `path`. */
async function watchKept(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  const browser = await browserHandle(page);
  await browser.evaluate(
    (b, { path, keepMs }) => {
      const rec = { frames: [] as string[][], done: false };
      (window as any).__kept = rec;
      let shownAt = 0;
      const frame = () => {
        const paths = Array.from(
          b.listing.sortedItems(),
          (item: any) => item.path as string
        );
        if (!shownAt && paths.includes(path)) {
          shownAt = Date.now();
        }
        if (shownAt) {
          rec.frames.push(paths);
          if (Date.now() - shownAt >= keepMs) {
            rec.done = true;
            return;
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    { path, keepMs: KEEP_MS }
  );
}

/**
 * Assert the row of `path` stayed in the listing at every frame of the watch, no row moved, and
 * the listing ended equal to the server contents of the top folder and the `unfolded` folders.
 */
async function expectKept(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  path: string,
  unfolded: string[]
): Promise<void> {
  await page.waitForFunction(() => (window as any).__kept.done, undefined, {
    timeout: KEEP_MS + 15000
  });
  const frames: string[][] = await page.evaluate(
    () => (window as any).__kept.frames
  );
  const missing = frames.filter(paths => !paths.includes(path)).length;
  const orders = new Set(frames.map(paths => paths.join('\n'))).size;
  console.log(
    `KEPT ${JSON.stringify({ path: path.slice(tmpPath.length + 1), frames: frames.length, missing, orders })}`
  );
  expect(frames.length).toBeGreaterThan(10);
  expect(missing).toBe(0);
  expect(orders).toBe(1);
  const root = join(await serverRoot(page), tmpPath);
  const server = ['', ...unfolded].flatMap(folder =>
    readdirSync(join(root, folder))
      .filter(name => !name.startsWith('.'))
      .map(name => [tmpPath, folder, name].filter(Boolean).join('/'))
  );
  expect([...frames[frames.length - 1]].sort()).toEqual(server.sort());
}

const NEW_FOLDER =
  '#filebrowser [data-command="filebrowser:create-new-directory"]';
const EDITOR = '#filebrowser input.jp-DirListing-editor';

test.describe('a listing read in flight at the answer', () => {
  test('ACC-FOLDER-158-NEW-INSTANT two New Folder in a row keep the second row, 8 unfolded folders', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const path = `${tmpPath}/Untitled Folder 1`;
    await watchKept(page, path);

    // The second answer comes while the re-read that confirms the first is in flight.
    await page.locator(NEW_FOLDER).first().click();
    await page.locator(EDITOR).waitFor();
    await page.keyboard.press('Escape');
    await page.locator(NEW_FOLDER).first().click();
    await page.locator(EDITOR).waitFor();

    await expectKept(page, tmpPath, path, FOLDERS);
    await page.keyboard.press('Escape');
  });

  test('ACC-FOLDER-158-NEW-INSTANT two New File in a row in the unfolded current folder keep the second row', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    await (
      await browserHandle(page)
    ).evaluate(
      (b, folder) => b.model.setCurrentFolder(folder),
      `${tmpPath}/f0`
    );
    const path = `${tmpPath}/f0/untitled1.txt`;
    await watchKept(page, path);
    const newFile = () =>
      page.evaluate(() => {
        void window.jupyterapp.commands.execute('filebrowser:create-new-file');
      });

    await newFile();
    await page.locator(EDITOR).waitFor();
    await page.keyboard.press('Escape');
    await newFile();
    await page.locator(EDITOR).waitFor();

    await expectKept(page, tmpPath, path, FOLDERS);
    await page.keyboard.press('Escape');
  });

  test('ACC-FOLDER-158-NEW-INSTANT New Folder during a re-read keeps its row, 8 unfolded folders', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    // The re-read waits for the unfolded folders, so the create answer comes before it ends.
    await slowReads(page, path => /\/api\/contents\/.*\/f\d$/.test(path));
    const path = `${tmpPath}/Untitled Folder`;
    await watchKept(page, path);

    await (
      await browserHandle(page)
    ).evaluate(b => {
      void b.model.refresh();
    });
    await page.waitForTimeout(100);
    await page.locator(NEW_FOLDER).first().click();

    await expectKept(page, tmpPath, path, FOLDERS);
    await page.keyboard.press('Escape');
  });

  test('ACC-FOLDER-158-NEW-INSTANT New Folder during a re-read keeps its row, unfolding off', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, 'unfolding off');
    await slowReads(page, path => path.endsWith(`/api/contents/${tmpPath}`));
    const path = `${tmpPath}/Untitled Folder`;
    await watchKept(page, path);

    await (
      await browserHandle(page)
    ).evaluate(b => {
      void b.model.refresh();
    });
    await page.waitForTimeout(100);
    await page.locator(NEW_FOLDER).first().click();

    await expectKept(page, tmpPath, path, []);
    await page.keyboard.press('Escape');
  });
});

for (const variant of ['no unfolded folder', 'unfolding off'] as const) {
  test(`ACC-FOLDER-158-NEW-INSTANT the rename editor stays on the new row when the confirming read adds a row above it, ${variant}`, async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, variant);
    // Not listed yet: the read that confirms the new folder brings it, above 'Untitled Folder'.
    mkdirSync(join(await serverRoot(page), tmpPath, '0x'));
    const path = `${tmpPath}/Untitled Folder`;

    await page.locator(NEW_FOLDER).first().click();
    await page.locator(EDITOR).waitFor();
    await expect
      .poll(async () =>
        (await visibleRows(page)).some(row => row.path === `${tmpPath}/0x`)
      )
      .toBe(true);

    await expect
      .poll(() => editorRow(page), { timeout: CONFIRM_MS })
      .toBe(path);
    await page.keyboard.press('Escape');
    const rows = await visibleRows(page);
    expect(rows.map(row => row.name)).toEqual(
      rows.map(row => row.path.slice(row.path.lastIndexOf('/') + 1))
    );
  });
}

/**
 * Hold for HOLD_MS the listing reads of `folders`; returns, per held read, when it was asked for
 * and when it was let through (0 while held).
 */
async function holdOtherReads(
  page: IJupyterLabPageFixture,
  folders: string[]
): Promise<{ askedAt: number; releasedAt: number }[]> {
  const held: { askedAt: number; releasedAt: number }[] = [];
  await page.route(
    url =>
      folders.some(folder =>
        decodeURIComponent(url.pathname).endsWith(`/api/contents/${folder}`)
      ),
    async route => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const read = { askedAt: Date.now(), releasedAt: 0 };
      held.push(read);
      const response = await route.fetch();
      await new Promise(resolve =>
        setTimeout(resolve, read.askedAt + HOLD_MS - Date.now())
      );
      read.releasedAt = Date.now();
      await route.fulfill({ response });
    }
  );
  return held;
}

/**
 * Let every held read through, then assert no read was asked for from `since` to `at` (one read
 * per create: only the new item's folder is read) and each read asked for since `since` was let
 * through after `at`.
 */
async function expectHeldPast(
  page: IJupyterLabPageFixture,
  held: { askedAt: number; releasedAt: number }[],
  since: number,
  at: number
): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  expect(
    held.filter(read => read.askedAt >= since && read.askedAt <= at)
  ).toEqual([]);
  expect(
    held
      .filter(read => read.askedAt >= since)
      .every(read => read.releasedAt > at)
  ).toBe(true);
}

/** Re-read the listing, so the poll's next refresh tick is 10 s away and cannot read during the case. */
async function resetPoll(page: IJupyterLabPageFixture): Promise<void> {
  await (await browserHandle(page)).evaluate(b => b.model.refresh());
}

test.describe('8 unfolded folders, the reads of the other folders held', () => {
  test('ACC-FOLDER-158-NEW-INSTANT New Folder opens the rename editor after the read of its own folder only', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const path = `${tmpPath}/Untitled Folder`;
    await resetPoll(page);
    const held = await holdOtherReads(
      page,
      FOLDERS.map(folder => `${tmpPath}/${folder}`)
    );
    await watchEditor(page, tmpPath);
    const clickedAt = Date.now();

    await page.locator(NEW_FOLDER).first().click();

    const editorAt = await expectEditorInTime(page, path);
    await page.keyboard.press('Escape');
    await expectHeldPast(page, held, clickedAt, editorAt);
  });

  test('ACC-FOLDER-158-NEW-INSTANT New File in the unfolded folder f0 opens the rename editor after the read of f0 only', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const path = `${tmpPath}/f0/untitled.txt`;
    await resetPoll(page);
    const menu = await openItemMenu(page, `${tmpPath}/f0`);
    // The top folder and f1-f7.
    const held = await holdOtherReads(page, [
      tmpPath,
      ...FOLDERS.slice(1).map(folder => `${tmpPath}/${folder}`)
    ]);
    await watchEditor(page, `${tmpPath}/f0`);
    const clickedAt = Date.now();

    await menu.getByRole('menuitem', { name: 'New File', exact: true }).click();

    const editorAt = await expectEditorInTime(page, path);
    await page.keyboard.press('Escape');
    await expectHeldPast(page, held, clickedAt, editorAt);
  });

  test('ACC-FOLDER-158-NEW-INSTANT New Notebook from the launcher is shown and selected while the reads are held', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const path = `${tmpPath}/Untitled.ipynb`;
    await page.evaluate(() =>
      window.jupyterapp.commands.execute('launcher:create')
    );
    const card = page
      .locator('.jp-LauncherCard[data-category="Notebook"]:visible')
      .first();
    await card.waitFor();
    await resetPoll(page);
    const held = await holdOtherReads(
      page,
      FOLDERS.map(folder => `${tmpPath}/${folder}`)
    );
    const clickedAt = Date.now();

    await card.click();

    // A notebook from the launcher opens no rename editor, as in stock; the stock listing selects its row.
    const selectedAt = await (
      await page.waitForFunction(
        path => {
          const browser = Array.from(
            window.jupyterapp.shell.widgets('left')
          ).find(widget => widget.id === 'filebrowser') as any;
          const selected = Array.from(
            browser.listing.selectedItems(),
            (item: any) => item.path
          );
          return selected.includes(path) && Date.now();
        },
        path,
        { timeout: CONFIRM_MS }
      )
    ).jsonValue();
    // No rename editor follows, so the watch runs 1 s past the selection.
    await page.waitForTimeout(1000);
    await expectHeldPast(page, held, clickedAt, (selectedAt as number) + 1000);
    await page.kernel.shutdownAll();
  });
});

test.describe('8 unfolded folders, one read per create', () => {
  test('ACC-FOLDER-158-NEW-INSTANT New Folder 50 ms after a typed name and Enter in the rename editor opens the second rename editor', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const path = `${tmpPath}/Untitled Folder`;

    await page.locator(NEW_FOLDER).first().click();
    await expect
      .poll(() => editorRow(page), { timeout: CONFIRM_MS })
      .toBe(path);
    await page.locator(EDITOR).fill('0new');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    await page.locator(NEW_FOLDER).first().click();

    // The typed name freed 'Untitled Folder', which the second create takes again.
    await expect
      .poll(() => editorRow(page), { timeout: CONFIRM_MS })
      .toBe(path);
    await page.keyboard.press('Escape');
    const names = readdirSync(join(await serverRoot(page), tmpPath));
    expect(names).toContain('0new');
    expect(names).toContain('Untitled Folder');
    const listed = (await visibleRows(page)).map(row => row.path);
    expect(listed).toContain(`${tmpPath}/0new`);
    expect(listed).toContain(path);
  });

  test('ACC-FOLDER-158-NEW-INSTANT the rename editor stays on the new row when another process wrote a file into an unfolded folder above it', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const root = join(await serverRoot(page), tmpPath);
    // 0d sorts above 'Untitled Folder' under every name sort.
    mkdirSync(join(root, '0d'));
    writeFileSync(join(root, '0d', 'file.txt'), 'x');
    const browser = await browserHandle(page);
    // The unfold re-reads the listing, so the poll's next refresh tick is 10 s away.
    await browser.evaluate(
      (b, folder) => b.model.toggle(folder),
      `${tmpPath}/0d`
    );
    await rowLocator(page, `${tmpPath}/0d/file.txt`);
    const path = `${tmpPath}/Untitled Folder`;
    // Not listed: another process wrote it; the next poll refresh shows it.
    writeFileSync(join(root, '0d', '0a.txt'), 'x');

    await page.locator(NEW_FOLDER).first().click();

    await expect
      .poll(() => editorRow(page), { timeout: CONFIRM_MS })
      .toBe(path);
    // The row of the rename editor at every frame for 2 s.
    const editorRows: string[] = await browser.evaluate(async b => {
      const rows: string[] = [];
      const end = Date.now() + 2000;
      while (Date.now() < end) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const nodes = Array.from(
          b.listing.contentNode.querySelectorAll(':scope > .jp-DirListing-item')
        ) as HTMLElement[];
        const index = nodes.findIndex(node =>
          node.querySelector('input.jp-DirListing-editor')
        );
        rows.push(
          index === -1
            ? ''
            : (Array.from(b.listing.sortedItems()) as any[])[index].path
        );
      }
      return rows;
    });
    expect(editorRows.length).toBeGreaterThan(10);
    expect([...new Set(editorRows)]).toEqual([path]);
    await page.keyboard.press('Escape');
    const rows = await visibleRows(page);
    expect(rows.map(row => row.name)).toEqual(
      rows.map(row => row.path.slice(row.path.lastIndexOf('/') + 1))
    );
  });

  test('ACC-FOLDER-158-NEW-INSTANT New Folder in f0 during the held first read after a Paste of 20 files into f0 opens the rename editor before that read is released', async ({
    page,
    tmpPath
  }) => {
    await prepare(page, tmpPath, '8 unfolded folders');
    const folder = `${tmpPath}/f0`;
    const path = `${folder}/Untitled Folder`;
    // f0 holds file00.txt-file24.txt too, so the server names each copy -Copy1.
    const names = Array.from(
      { length: 20 },
      (_, i) => `file${String(i).padStart(2, '0')}`
    );
    const pasted = names.map(name => `${folder}/${name}-Copy1.txt`);
    await (await rowLocator(page, `${tmpPath}/f1/${names[0]}.txt`)).click();
    await (
      await rowLocator(page, `${tmpPath}/f1/${names[19]}.txt`)
    ).click({ modifiers: ['Shift'] });
    await page.evaluate(() =>
      window.jupyterapp.commands.execute('filebrowser:copy')
    );
    // The click makes f0 the current folder: the Paste target and the new folder's place.
    await (await rowLocator(page, folder)).click();
    await resetPoll(page);
    // The first listing read of f0 after the Paste stays held until the test releases it, so no
    // load can outlast the hold.
    let asked = false;
    let releasedAt = 0;
    let release!: () => void;
    const released = new Promise<void>(resolve => {
      release = () => resolve();
    });
    await page.route(
      url =>
        decodeURIComponent(url.pathname).endsWith(`/api/contents/${folder}`),
      async route => {
        if (route.request().method() !== 'GET' || asked) {
          return route.fallback();
        }
        asked = true;
        const response = await route.fetch();
        await released;
        releasedAt = Date.now();
        await route.fulfill({ response });
      }
    );

    await page.evaluate(() =>
      window.jupyterapp.commands.execute('filebrowser:paste')
    );
    await expect.poll(() => asked, { timeout: CONFIRM_MS }).toBe(true);
    expect(releasedAt).toBe(0);
    await watchEditor(page, folder);
    await page.locator(NEW_FOLDER).first().click();

    await expect
      .poll(() => editorRow(page), { timeout: CONFIRM_MS })
      .toBe(path);
    await page.keyboard.press('Escape');
    // Hold the read at least 100 ms past the editor, so the order cannot hinge on the clocks.
    await page.waitForTimeout(100);
    release();
    await expect
      .poll(() => releasedAt, { timeout: CONFIRM_MS })
      .toBeGreaterThan(0);
    const { editorAt } = await page.evaluate(() => (window as any).__editor);
    expect(editorAt).toBeGreaterThan(0);
    expect(editorAt).toBeLessThan(releasedAt);
    await page.waitForTimeout(500);
    const listed = (await visibleRows(page)).map(row => row.path);
    expect([...pasted, path].filter(p => !listed.includes(p))).toEqual([]);
    await page.unrouteAll({ behavior: 'wait' });
  });
});

test.describe('8 unfolded folders, the refresh after a Delete in flight at a create', () => {
  for (const [label, create] of [
    ['Delete Permanently', true],
    ['Move to Trash', true],
    ['Delete Permanently', false]
  ] as const) {
    test(`ACC-FOLDER-158-NEW-INSTANT the rows removed by ${label} leave when its refresh returns, ${create ? 'New Folder during the refresh' : 'no create'}`, async ({
      page,
      tmpPath
    }) => {
      await prepare(page, tmpPath, '8 unfolded folders');
      const root = join(await serverRoot(page), tmpPath);
      // A row in the unfolded f3 and a top-level row; the current folder stays the top folder.
      const removed = [`${tmpPath}/f3/file05.txt`, `${tmpPath}/a.txt`];
      await resetPoll(page);
      for (const [i, path] of removed.entries()) {
        await (
          await rowLocator(page, path)
        ).click(i ? { modifiers: ['ControlOrMeta'] } : undefined);
      }
      await page.keyboard.press('Delete');
      // Only the refresh after the removal reads f3 in the case.
      const held = await holdOtherReads(page, [`${tmpPath}/f3`]);
      await page
        .locator('.jp-Dialog')
        .getByRole('button', { name: label, exact: true })
        .click();
      await expect
        .poll(() => held.length, { timeout: CONFIRM_MS })
        .toBeGreaterThan(0);
      if (create) {
        await page.locator(NEW_FOLDER).first().click();
        await page.locator(EDITOR).waitFor();
        // The create's read of the top folder was applied while the refresh's read of f3 was held.
        expect(held[0].releasedAt).toBe(0);
      }

      await expect
        .poll(() => held[0].releasedAt, { timeout: CONFIRM_MS })
        .toBeGreaterThan(0);
      await page.waitForTimeout(500);

      const listed = (await visibleRows(page)).map(row => row.path);
      expect(existsSync(join(root, 'f3', 'file05.txt'))).toBe(false);
      expect(existsSync(join(root, 'a.txt'))).toBe(false);
      expect(listed.filter(path => removed.includes(path))).toEqual([]);
      if (create) {
        expect(listed).toContain(`${tmpPath}/Untitled Folder`);
        await page.keyboard.press('Escape');
      }
      await page.unrouteAll({ behavior: 'wait' });
    });
  }
});
