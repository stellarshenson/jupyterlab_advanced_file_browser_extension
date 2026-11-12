/**
 * Current folder (docs/acc-crit.md, category FOLDER): with unfolding on, model.path
 * follows the clicked row, and new items land there.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  browserHandle,
  browserPaths,
  clickEmptyArea,
  clickTriangle,
  rowLocator,
  SERVER_TIMEOUT,
  seedTree,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

const TREE = ['a/', 'a/b/', 'a/x.txt', 'a/b/y.txt', 'x.txt'];

/** Seed the tree in `tmpPath` and set the unfolding switch. */
async function setup(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  unfolding: boolean
): Promise<void> {
  await seedTree(page, tmpPath, TREE);
  await setUnfolding(page, unfolding);
}

/** Left-click the row of `path`. */
async function clickRow(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await (await rowLocator(page, path)).click();
}

/** Wait until `model.path` is `path`. */
async function expectCurrent(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await expect
    .poll(async () => (await browserPaths(page)).path, {
      timeout: SERVER_TIMEOUT
    })
    .toBe(path);
}

/** Expect one Paste Error dialog naming the skipped folder `name`, then dismiss it. */
async function dismissSkipDialog(
  page: IJupyterLabPageFixture,
  name: string
): Promise<void> {
  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText('Paste Error');
  await expect(dialog).toContainText(
    `Cannot paste "${name}" into itself or a folder inside it`
  );
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Wait until the server holds the file `path`. */
async function expectFile(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await expect
    .poll(() => page.contents.fileExists(path), {
      message: `file ${path}`,
      timeout: SERVER_TIMEOUT
    })
    .toBe(true);
}

test('ACC-FOLDER-29-CLICKDIR click on a nested folder makes it current', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  expect((await browserPaths(page)).topPath).toBe(tmpPath);
});

test('ACC-FOLDER-30-CLICKFILE click on a nested file makes its folder current', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a/b`);

  await clickRow(page, `${tmpPath}/a/b/y.txt`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  await clickRow(page, `${tmpPath}/a/x.txt`);
  await expectCurrent(page, `${tmpPath}/a`);
  expect((await browserPaths(page)).topPath).toBe(tmpPath);
});

test('ACC-FOLDER-79-ARROWKEYS Up and Down move the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a/b`);
  await clickRow(page, `${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);

  // Rows: a, a/b, a/b/y.txt, a/x.txt, x.txt
  const press = async (key: string, selected: string, current: string) => {
    await page.keyboard.press(key);
    await expect
      .poll(async () =>
        (await visibleRows(page))
          .filter(row => row.selected)
          .map(row => row.path)
      )
      .toEqual([`${tmpPath}/${selected}`]);
    await expectCurrent(page, current ? `${tmpPath}/${current}` : tmpPath);
  };
  await press('ArrowDown', 'a/b', 'a/b');
  await expect(
    page.locator('#filebrowser .jp-BreadCrumbs-item').last()
  ).toHaveText('b');
  await press('ArrowDown', 'a/b/y.txt', 'a/b');
  await press('ArrowDown', 'a/x.txt', 'a');
  await press('ArrowDown', 'x.txt', '');
  await press('ArrowUp', 'a/x.txt', 'a');
  await press('ArrowUp', 'a/b/y.txt', 'a/b');
  await press('ArrowUp', 'a/b', 'a/b');
  await press('ArrowUp', 'a', 'a');
});

test('DEF-FOLDER-7-RESORT a Down press into another folder keeps the row order', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(300000);
  // About 3000 rows, written straight into the server root: one contents API call per file takes minutes
  // d10 to d20: the byte order of the names is the numeric order
  const folders = Array.from({ length: 11 }, (_, k) => `d${10 + k}`);
  const root: string = await page.evaluate(
    () =>
      JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
        .serverRoot
  );
  for (const folder of folders) {
    mkdirSync(join(root, tmpPath, folder));
    for (let i = 0; i < 270; i++) {
      writeFileSync(join(root, tmpPath, folder, `f${1000 + i}.txt`), folder);
    }
  }
  await setUnfolding(page, true);
  const browser = await browserHandle(page);
  const paths = folders.map(folder => `${tmpPath}/${folder}`);
  await browser.evaluate(async (b, paths) => {
    await b.model.refresh();
    for (const path of paths) {
      await b.model.unfold(path);
    }
  }, paths);
  await expect
    .poll(async () => (await visibleRows(page)).length, { timeout: 60000 })
    .toBe(11 * 271);

  // Ten times: select the last file of folder k, then Down onto the row of folder k + 1 and
  // Down again onto its first file; time each press to the frame after the row shows selected
  const result = await browser.evaluate(async (b, paths) => {
    const listing = b.listing;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const pause = () => new Promise(resolve => setTimeout(resolve, 300));
    const indexOf = (path: string) =>
      Array.from(listing.sortedItems(), (item: any) => item.path).indexOf(path);
    const down = async (path: string) => {
      const node: HTMLElement = listing.contentNode.querySelectorAll(
        ':scope > .jp-DirListing-item'
      )[indexOf(path)];
      const order = listing._sortedItems;
      const start = performance.now();
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true
        })
      );
      // The handler re-sorts, if at all, before it returns
      const kept = listing._sortedItems === order;
      for (
        let i = 0;
        i < 600 && !node.classList.contains('jp-mod-selected');
        i++
      ) {
        await frame();
      }
      // A timeout queued in a frame callback runs after that frame is painted
      await new Promise(resolve => setTimeout(resolve, 0));
      return { ms: performance.now() - start, kept, current: b.model.path };
    };
    const crossing = [];
    const inside = [];
    for (let k = 0; k < 10; k++) {
      listing._selectItem(indexOf(`${paths[k]}/f1269.txt`), false, true);
      b.model.setCurrentFolder(paths[k]);
      await frame();
      await pause();
      crossing.push(await down(paths[k + 1]));
      await pause();
      inside.push(await down(`${paths[k + 1]}/f1000.txt`));
      await pause();
    }
    return { crossing, inside };
  }, paths);

  const median = (values: number[]) =>
    Math.round([...values].sort((x, y) => x - y)[values.length / 2]);
  console.log(
    `DEF-FOLDER-7-RESORT rows ${11 * 271}, median ms per Down press: into another folder ${median(
      result.crossing.map(r => r.ms)
    )}, inside one folder ${median(result.inside.map(r => r.ms))}`
  );
  expect(result.crossing.map(r => r.current)).toEqual(paths.slice(1));
  expect(result.crossing.map(r => r.kept)).toEqual(Array(10).fill(true));
});

test('ACC-FOLDER-31-CLICKEMPTY click on the empty area returns to the top folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  expect(
    (await visibleRows(page)).filter(row => row.selected).map(row => row.path)
  ).toEqual([`${tmpPath}/a/b`]);

  await clickEmptyArea(page);

  await expectCurrent(page, tmpPath);
  await expect
    .poll(async () => (await visibleRows(page)).filter(row => row.selected))
    .toEqual([]);
});

test('DEF-FOLDER-3-SCROLLBAR a press on the scrollbar keeps the folder and the selection', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  // Headless Chromium hides scrollbars, so dispatch the mousedown a scrollbar press gives:
  // on the content node, beside a row, past its client width
  const browser = await browserHandle(page);
  await browser.evaluate(b => {
    const content: HTMLElement = b.listing.contentNode;
    const box = content.getBoundingClientRect();
    content.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: box.left + content.clientLeft + content.clientWidth + 1,
        clientY: box.top + 5
      })
    );
  });

  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a/b`);
  expect(
    await browser.evaluate(b =>
      Array.from(b.selectedItems(), (item: any) => item.path)
    )
  ).toEqual([`${tmpPath}/a/b`]);
});

test('DEF-FOLDER-14-OVERLAY-SCROLLBAR a press on an overlay scrollbar keeps the folder and the selection', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  // 40 more rows in a make the listing scroll; written straight into the server root
  const root: string = await page.evaluate(
    () =>
      JSON.parse(document.getElementById('jupyter-config-data')!.textContent!)
        .serverRoot
  );
  for (let i = 0; i < 40; i++) {
    writeFileSync(join(root, tmpPath, 'a', `f${10 + i}.txt`), 'f');
  }
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  // The venv lab's core patch sets the rows to display: flex, which removes the line gap
  // between them; pin core's inline-grid so the gap below the first row exists
  await page.addStyleTag({
    content: '.jp-DirListing-item { display: inline-grid !important; }'
  });
  // Headless Chromium hides scrollbars, so they take no width, as an overlay scrollbar does.
  // The press goes 8 px left of the right edge, in the 3 px line gap below the first row,
  // where a press on the scrollbar reaches the content node and hits no row
  const browser = await browserHandle(page);
  const point = await browser.evaluate(b => {
    const content: HTMLElement = b.listing.contentNode;
    const box = content.getBoundingClientRect();
    const [first, second] = Array.from(
      content.querySelectorAll(':scope > .jp-DirListing-item'),
      row => row.getBoundingClientRect()
    );
    const x = box.left + content.clientLeft + content.clientWidth - 8;
    const y = (first.bottom + second.top) / 2;
    return {
      x,
      y,
      scrolls: content.scrollHeight > content.clientHeight,
      onContent: document.elementFromPoint(x, y) === content
    };
  });
  expect(point).toMatchObject({ scrolls: true, onContent: true });

  await page.mouse.click(point.x, point.y);

  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a/b`);
  expect(
    await browser.evaluate(b =>
      Array.from(b.selectedItems(), (item: any) => item.path)
    )
  ).toEqual([`${tmpPath}/a/b`]);
});

test('DEF-FOLDER-16-ROW-GAP a press between two rows keeps the folder and the selection', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  // The venv lab's core patch sets the rows to display: flex, which removes the line gap
  // between them; pin core's inline-grid so the gap between the first two rows exists
  await page.addStyleTag({
    content: '.jp-DirListing-item { display: inline-grid !important; }'
  });
  // Rows are inline-grid, so a 3 px line gap below each row hits no row and targets the content node
  const browser = await browserHandle(page);
  const point = await browser.evaluate(b => {
    const content: HTMLElement = b.listing.contentNode;
    const box = content.getBoundingClientRect();
    const [first, second] = Array.from(
      content.querySelectorAll(':scope > .jp-DirListing-item'),
      row => row.getBoundingClientRect()
    );
    const x = box.left + content.clientLeft + content.clientWidth / 2;
    const y = (first.bottom + second.top) / 2;
    return {
      x,
      y,
      scrolls: content.scrollHeight > content.clientHeight,
      onContent: document.elementFromPoint(x, y) === content
    };
  });
  expect(point).toMatchObject({ scrolls: false, onContent: true });

  await page.mouse.click(point.x, point.y);

  expect((await browserPaths(page)).path).toBe(`${tmpPath}/a/b`);
  expect(
    await browser.evaluate(b =>
      Array.from(b.selectedItems(), (item: any) => item.path)
    )
  ).toEqual([`${tmpPath}/a/b`]);
});

test('ACC-FOLDER-32-NEWITEM New File and New Folder land in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  const firstUnderB = async () => {
    const rows = await visibleRows(page);
    const parent = rows.findIndex(row => row.path === `${tmpPath}/a/b`);
    const row = rows[parent + 1];
    return parent >= 0 && row ? [row.path, row.depth] : null;
  };
  // The stock New File and New Folder select the new row and open its name editor.
  const editor = page.locator('#filebrowser .jp-DirListing-editor');

  // Not awaited: the command resolves only when the name editor closes.
  await page.evaluate(() => {
    void window.jupyterapp.commands.execute('filebrowser:create-new-file');
  });
  await expect(editor).toBeVisible({ timeout: SERVER_TIMEOUT });
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();

  const file = `${tmpPath}/a/b/untitled.txt`;
  expect(await page.contents.fileExists(file)).toBe(true);
  expect(await page.contents.fileExists(`${tmpPath}/untitled.txt`)).toBe(false);
  // untitled.txt sorts before y.txt, so the new file is the first row under a/b.
  await expect.poll(firstUnderB).toEqual([file, 2]);

  // Fold a/b again, so New Folder also starts from a folded current folder.
  await clickTriangle(page, `${tmpPath}/a/b`);
  await expect.poll(firstUnderB).toEqual([`${tmpPath}/a/x.txt`, 1]);
  await expectCurrent(page, `${tmpPath}/a/b`);

  await page
    .locator(
      '#filebrowser .jp-Toolbar [data-command="filebrowser:create-new-directory"]'
    )
    .click();
  await expect(editor).toBeVisible({ timeout: SERVER_TIMEOUT });
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();

  const created = `${tmpPath}/a/b/Untitled Folder`;
  expect(await page.contents.directoryExists(created)).toBe(true);
  expect(
    await page.contents.directoryExists(`${tmpPath}/Untitled Folder`)
  ).toBe(false);
  // Folders sort first, so the new folder is the first row under a/b.
  await expect.poll(firstUnderB).toEqual([created, 2]);
});

test('ACC-FOLDER-33-UPLOAD upload lands in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#filebrowser .jp-id-upload').click();
  await (
    await chooser
  ).setFiles({
    name: 'u.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('uploaded\n')
  });

  await expectFile(page, `${tmpPath}/a/b/u.txt`);
  expect(await page.contents.fileExists(`${tmpPath}/u.txt`)).toBe(false);
});

test('ACC-FOLDER-83-OVERWRITE upload asks to overwrite only for a file in the target folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  const dialog = page.locator('.jp-Dialog');
  const upload = async (name: string) => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#filebrowser .jp-id-upload').click();
    await (
      await chooser
    ).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('new\n') });
  };
  // seedTree writes each file's relative path as its text
  const text = (path: string) =>
    page.evaluate(
      async p =>
        (
          await window.jupyterapp.serviceManager.contents.get(p, {
            content: true
          })
        ).content,
      path
    );

  // x.txt is in a and in the top folder, not in a/b
  await upload('x.txt');
  await expect
    .poll(
      async () =>
        (await dialog.count())
          ? 'prompt'
          : (await page.contents.fileExists(`${tmpPath}/a/b/x.txt`))
            ? 'saved'
            : 'pending',
      { timeout: SERVER_TIMEOUT }
    )
    .toBe('saved');
  expect(await text(`${tmpPath}/a/x.txt`)).toBe('a/x.txt');
  expect(await text(`${tmpPath}/x.txt`)).toBe('x.txt');

  // y.txt is in a/b
  await upload('y.txt');
  await expect(dialog).toContainText('Overwrite file?');
  await dialog.locator('.jp-mod-reject').click();
  // The stock uploader reports the cancelled upload in an Upload Error dialog
  await expect(
    page.locator('.jp-Dialog', { hasText: 'File not uploaded' })
  ).toBeVisible();
  expect(await text(`${tmpPath}/a/b/y.txt`)).toBe('a/b/y.txt');
});

test('ACC-FOLDER-34-PASTE paste lands in the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);

  await clickRow(page, `${tmpPath}/x.txt`);
  await page.keyboard.press('Control+c');
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await page.keyboard.press('Control+v');

  await expectFile(page, `${tmpPath}/a/b/x.txt`);
  expect(await page.contents.fileExists(`${tmpPath}/x.txt`)).toBe(true);
});

test('ACC-FOLDER-81-SELFPASTE a folder pasted inside itself stays', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  // Each copy request names its source in `copy_from`; a move is a PATCH on the old path
  const writes: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (request.method() === 'POST' && pathname.includes('/api/contents/')) {
      writes.push(`copy ${request.postDataJSON()?.copy_from}`);
    } else if (request.method() === 'PATCH') {
      writes.push(`move ${decodeURIComponent(pathname)}`);
    }
  });
  const paste = () =>
    page.evaluate(() =>
      window.jupyterapp.commands.execute('filebrowser:paste')
    );

  await clickRow(page, `${tmpPath}/a`);
  await (
    await rowLocator(page, `${tmpPath}/x.txt`)
  ).click({ modifiers: ['ControlOrMeta'] });
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:copy')
  );
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await paste();
  expect(writes).toEqual([`copy ${tmpPath}/x.txt`]);
  expect(await page.contents.fileExists(`${tmpPath}/a/b/x.txt`)).toBe(true);
  expect(await page.contents.directoryExists(`${tmpPath}/a/b/a`)).toBe(false);
  await dismissSkipDialog(page, 'a');

  await clickRow(page, `${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:cut')
  );
  await paste();
  expect(writes).toEqual([`copy ${tmpPath}/x.txt`]);
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(true);
  expect(await page.contents.directoryExists(`${tmpPath}/a/a`)).toBe(false);

  // A copied folder that is the current folder lands beside it, as the stock a-Copy1
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:copy')
  );
  await paste();
  expect(writes).toEqual([`copy ${tmpPath}/x.txt`, `copy ${tmpPath}/a`]);
  expect(await page.contents.directoryExists(`${tmpPath}/a-Copy1`)).toBe(true);
  expect(await page.contents.directoryExists(`${tmpPath}/a/a`)).toBe(false);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
});

test('DEF-FOLDER-13-CUT-DIMMED a cut folder pasted onto itself loses the cut style', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await clickRow(page, `${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:cut')
  );
  const row = await rowLocator(page, `${tmpPath}/a`);
  await expect(row).toHaveClass(/jp-mod-cut/);

  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:paste')
  );
  // A render requested by the paste runs within two frames; the 10 s poll renders much later
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  expect(await row.getAttribute('class')).not.toContain('jp-mod-cut');
});

test('ACC-FOLDER-86-STOCKPASTE unfolding off: a folder pasted inside itself stays', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, false);
  // Each copy request names its source in `copy_from`; the copy of a is aborted, so a
  // failing run leaves no a/b/a/b/... chain on the server
  const copies: string[] = [];
  await page.route('**/api/contents/**', route => {
    const request = route.request();
    const from =
      request.method() === 'POST'
        ? request.postDataJSON()?.copy_from
        : undefined;
    if (from) {
      copies.push(from);
    }
    return from === `${tmpPath}/a` ? route.abort() : route.continue();
  });

  await clickRow(page, `${tmpPath}/a`);
  await (
    await rowLocator(page, `${tmpPath}/x.txt`)
  ).click({ modifiers: ['ControlOrMeta'] });
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:copy')
  );
  const browser = await browserHandle(page);
  await browser.evaluate((b, path) => b.model.cd(`/${path}`), `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await page.evaluate(() =>
    window.jupyterapp.commands.execute('filebrowser:paste')
  );

  expect(copies).toEqual([`${tmpPath}/x.txt`]);
  expect(await page.contents.fileExists(`${tmpPath}/a/b/x.txt`)).toBe(true);
  expect(await page.contents.directoryExists(`${tmpPath}/a/b/a`)).toBe(false);
  await dismissSkipDialog(page, 'a');
});

test('ACC-FOLDER-87-SKIPMSG a folder skipped from Paste is reported', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, false);
  // A move is a PATCH on the old path; a copy request names its source in `copy_from`
  const moves: string[] = [];
  const copies: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (request.method() === 'PATCH') {
      moves.push(decodeURIComponent(pathname));
    } else if (
      request.method() === 'POST' &&
      pathname.includes('/api/contents/')
    ) {
      copies.push(request.postDataJSON()?.copy_from);
    }
  });
  const run = (command: string) =>
    page.evaluate(id => window.jupyterapp.commands.execute(id), command);
  const browser = await browserHandle(page);
  const cd = (path: string) =>
    browser.evaluate((b, path) => b.model.cd(`/${path}`), path);

  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:cut');
  await cd(`${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');

  // With unfolding off a copied current folder is skipped, not copied beside it
  await cd(tmpPath);
  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:copy');
  await cd(`${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');
  expect(copies).toEqual([]);
  expect(await page.contents.directoryExists(`${tmpPath}/a/a`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a-Copy1`)).toBe(false);

  // With unfolding off a cut current folder is reported too; stock showed Paste Error
  await cd(tmpPath);
  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:cut');
  await cd(`${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');
  expect(moves).toEqual([]);
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(true);

  await cd(tmpPath);
  await setUnfolding(page, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:cut');
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');

  // With unfolding on an entered folder is the top folder, not a selected one, so stock applies
  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:cut');
  await cd(`${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');

  // With unfolding on an entered copied folder is reported too, not copied beside it
  await cd(tmpPath);
  await clickRow(page, `${tmpPath}/a`);
  await run('filebrowser:copy');
  await cd(`${tmpPath}/a`);
  await expectCurrent(page, `${tmpPath}/a`);
  await run('filebrowser:paste');
  await dismissSkipDialog(page, 'a');

  expect(moves).toEqual([]);
  expect(copies).toEqual([]);
  expect(await page.contents.directoryExists(`${tmpPath}/a`)).toBe(true);
  expect(await page.contents.directoryExists(`${tmpPath}/a/b/a`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a/a`)).toBe(false);
  expect(await page.contents.directoryExists(`${tmpPath}/a-Copy1`)).toBe(false);
});

test('ACC-FOLDER-35-STOCK unfolding off keeps the folder on click', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, false);

  await clickRow(page, `${tmpPath}/a`);
  await expect
    .poll(async () =>
      (await visibleRows(page)).filter(row => row.selected).map(row => row.path)
    )
    .toEqual([`${tmpPath}/a`]);

  expect(await browserPaths(page)).toEqual({ path: tmpPath, topPath: tmpPath });
});

test('ACC-FOLDER-76-BREADCRUMBS breadcrumbs follow the current folder', async ({
  page,
  tmpPath
}) => {
  await setup(page, tmpPath, true);
  await unfold(page, `${tmpPath}/a`);
  await clickRow(page, `${tmpPath}/a/b`);
  await expectCurrent(page, `${tmpPath}/a/b`);

  const crumbs = page.locator('#filebrowser .jp-BreadCrumbs');
  await expect(crumbs.locator('.jp-BreadCrumbs-item').last()).toHaveText('b');

  await crumbs.locator('.jp-BreadCrumbs-home').click();

  await expect
    .poll(async () => await browserPaths(page), { timeout: SERVER_TIMEOUT })
    .toEqual({ path: '', topPath: '' });
  await expect
    .poll(
      async () => {
        const paths = (await visibleRows(page)).map(row => row.path);
        return paths.includes(tmpPath) && paths.every(p => !p.includes('/'));
      },
      { timeout: SERVER_TIMEOUT }
    )
    .toBe(true);
});
