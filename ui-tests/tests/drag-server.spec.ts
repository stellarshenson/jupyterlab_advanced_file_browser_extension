import { expect, test } from '@jupyterlab/galata';

import {
  apiGet,
  CONTENTS_MIME,
  openTerminalAndCaptureSends,
  PLAIN_FILE,
  runningTerminalNames,
  sentStdin,
  serverRoot
} from './helpers';

/**
 * Tests for the server extension's terminal-cwd endpoint and the terminal
 * round trip that depends on it. The server root has no route: the page
 * config carries it, and drag-settings.spec.ts asserts it there.
 */

test.beforeEach(async ({ page }) => {
  await page.contents.uploadContent('a,b\n', 'text', PLAIN_FILE);
});

test.describe('server endpoints', () => {
  test('terminal-cwd reports the working directory of a live terminal', async ({
    page
  }) => {
    await openTerminalAndCaptureSends(page);
    const name = await page.evaluate(
      () =>
        (window as any).jupyterapp.shell.currentWidget.content.session.model
          .name
    );

    const info = await apiGet(page, `terminal-cwd/${name}`);

    expect(info.status).toBe(200);
    expect(info.body.terminal_name).toBe(name);
    expect(info.body.cwd).toMatch(/^\//);
  });

  test('an unknown terminal name is a 404 and creates no terminal', async ({
    page
  }) => {
    // Regression for DEF-SERVER-10: terminado's get_terminal is a
    // get-*or-create* API, so this endpoint used to spawn a live shell for
    // whatever name a request carried - unbounded, unculled, and reachable by
    // a plain GET, which tornado does not XSRF-check.
    const before = await runningTerminalNames(page);

    const info = await apiGet(page, 'terminal-cwd/definitely-not-a-terminal');
    expect(info.status).toBe(404);

    const after = await runningTerminalNames(page);
    expect(after).toEqual(before);
  });

  test('repeated unknown-name requests never accumulate terminals', async ({
    page
  }) => {
    const before = await runningTerminalNames(page);

    for (let i = 0; i < 3; i++) {
      await apiGet(page, `terminal-cwd/phantom-${i}`);
    }

    expect(await runningTerminalNames(page)).toEqual(before);
  });
});

test.describe('terminal round trip', () => {
  test('a relative terminal path resolves against the reported cwd', async ({
    page
  }) => {
    await openTerminalAndCaptureSends(page);
    const name = await page.evaluate(
      () =>
        (window as any).jupyterapp.shell.currentWidget.content.session.model
          .name
    );

    const root = await serverRoot(page);
    const cwd = (await apiGet(page, `terminal-cwd/${name}`)).body.cwd as string;

    await page.evaluate(
      ({ mime, paths }) => {
        const node: HTMLElement = (window as any).jupyterapp.shell.currentWidget
          .node;
        const event: any = new Event('lm-drop', {
          bubbles: true,
          cancelable: true
        });
        event.mimeData = {
          getData: (requested: string) =>
            requested === mime ? paths : undefined
        };
        event.proposedAction = 'move';
        event.dropAction = 'none';
        event.clientX = 0;
        event.clientY = 0;
        node.dispatchEvent(event);
      },
      { mime: CONTENTS_MIME, paths: [PLAIN_FILE] }
    );

    const sent = await (async () => {
      await expect
        .poll(async () => (await sentStdin(page)).length, { timeout: 15000 })
        .toBeGreaterThan(0);
      return (await sentStdin(page))[0];
    })();

    // Unescape, then resolve the inserted relative path against the cwd the
    // server reported. It must name the file's real location under the root.
    const unescaped = sent.replace(/\\(.)/gu, '$1');
    const resolve = (base: string, rel: string): string => {
      const parts = base.split('/').filter(Boolean);
      for (const segment of rel.split('/')) {
        if (segment === '' || segment === '.') {
          continue;
        }
        if (segment === '..') {
          parts.pop();
        } else {
          parts.push(segment);
        }
      }
      return '/' + parts.join('/');
    };

    expect(resolve(cwd, unescaped)).toBe(`${root}/${PLAIN_FILE}`);
  });
});

test.describe('real file browser drag', () => {
  test('dragging an item from the file browser inserts its path', async ({
    page,
    tmpPath
  }) => {
    // Every other test synthesises the Lumino events. This one performs the
    // actual mouse drag, so it is the only test that would fail if JupyterLab
    // changed the MIME key the file browser puts on the drag - the one
    // contract this extension cannot import and must hard-code, because
    // upstream declares it as a module-private const with no type export.
    //
    // Galata opens the file browser at the test's own directory, so the
    // fixture has to live there to be draggable.
    await page.contents.uploadContent(
      'a,b\n',
      'text',
      `${tmpPath}/${PLAIN_FILE}`
    );
    await page.contents.uploadContent('', 'text', `${tmpPath}/target.md`);
    await page.evaluate(async path => {
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path,
        factory: 'Editor'
      });
    }, `${tmpPath}/target.md`);
    await page.waitForTimeout(1000);
    await page.filebrowser.refresh();

    const item = page.locator(`.jp-DirListing-item:has-text("${PLAIN_FILE}")`);
    await item.first().waitFor({ state: 'visible', timeout: 15000 });

    const source = await item.first().boundingBox();
    const editor = await page
      .locator('.jp-FileEditor .cm-content')
      .boundingBox();
    if (!source || !editor) {
      throw new Error('drag source or drop target not laid out');
    }

    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2
    );
    await page.mouse.down();
    // Lumino starts a drag only once the pointer passes its threshold, and
    // needs intermediate moves to emit lm-dragover on the target.
    const targetX = editor.x + editor.width / 2;
    const targetY = editor.y + 20;
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(
        source.x + (targetX - source.x) * (step / 12),
        source.y + (targetY - source.y) * (step / 12)
      );
      await page.waitForTimeout(50);
    }
    await page.mouse.up();

    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              (
                window as any
              ).jupyterapp.shell.currentWidget.content.editor.model.sharedModel.getSource() as string
          ),
        { timeout: 15000 }
      )
      .toContain(PLAIN_FILE);
  });
});
