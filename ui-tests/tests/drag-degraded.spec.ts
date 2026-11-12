import { expect, test } from '@jupyterlab/galata';

import {
  dropOnCurrentWidget,
  editorSource,
  openEditor,
  PLAIN_FILE,
  PLUGIN_ID,
  openTerminalAndCaptureSends,
  sentStdin
} from './helpers';

/**
 * The extension must stay usable when its server extension or its settings are
 * unavailable. The routes are installed before the page loads, so they are in
 * force while the plugin activates - which is when it reads both of them.
 *
 * The server root comes from the page config, not from a route, so the empty
 * root case has no route to stub here; src/__tests__/drag-paths.spec.ts covers
 * the refusal an empty root produces.
 */

test.describe('degraded server', () => {
  test.use({ autoGoto: false });

  test('editor drops still work when the server extension is unavailable', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    // The extension's own namespace, matched by route path so the page's load
    // of the labextension bundle under /lab/extensions/ is not caught too.
    await page.route(
      /\/jupyterlab-advanced-file-browser-extension\/(?:hello|terminal-cwd)(?:\/|$)/u,
      route => route.fulfill({ status: 500, body: 'unavailable' })
    );
    await page.goto();

    await page.contents.uploadContent('a,b\n', 'text', PLAIN_FILE);
    await page.contents.uploadContent('', 'text', 'degraded.py');
    await openEditor(page, 'degraded.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(600);

    // A document-relative path needs no server root, so the drop still lands.
    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);
    expect(errors).toEqual([]);
  });

  test('defaults are used when the plugin settings fail to load', async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route(`**/api/settings/${PLUGIN_ID}*`, route =>
      route.fulfill({ status: 500, body: 'unavailable' })
    );
    await page.goto();

    await page.contents.uploadContent('a,b\n', 'text', PLAIN_FILE);
    await page.contents.uploadContent('', 'text', 'nosettings.py');
    await openEditor(page, 'nosettings.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(600);

    // The built-in defaults are enabled, relative and posix.
    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);
    expect(errors).toEqual([]);
  });

  test('a terminal drop inserts nothing when the cwd cannot be read', async ({
    page
  }) => {
    await page.route(
      '**/jupyterlab-advanced-file-browser-extension/terminal-cwd/**',
      route => route.fulfill({ status: 500, body: 'unavailable' })
    );
    await page.goto();

    await page.contents.uploadContent('a,b\n', 'text', PLAIN_FILE);

    const warnings: string[] = [];
    page.on('console', message => {
      if (message.type() === 'warning') {
        warnings.push(message.text());
      }
    });

    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(2000);

    // Path type defaults to relative, which needs the cwd. Without it the
    // extension inserts nothing rather than a wrong path.
    expect(await sentStdin(page)).toEqual([]);
    expect(
      warnings.some(text => text.includes('terminal cwd unavailable'))
    ).toBe(true);
  });
});
