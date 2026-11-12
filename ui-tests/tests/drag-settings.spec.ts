import { expect, test } from '@jupyterlab/galata';

import {
  dragOverCurrentWidget,
  dropOnCurrentWidget,
  editorSource,
  openEditor,
  openTerminalAndCaptureSends,
  markPage,
  pageStillMarked,
  PLAIN_FILE,
  sentStdin,
  serverRoot,
  setPluginSettings,
  setPluginSettingsLive,
  SPACED_FILE
} from './helpers';

/**
 * Functional tests for the settings gate and the remaining edge cases.
 * Settings are written through the server API and the page reloaded, so the
 * plugin reads them during activation exactly as a user's change would be read.
 */

test.beforeEach(async ({ page }) => {
  await page.contents.uploadContent('a,b\n', 'text', PLAIN_FILE);
  await page.contents.uploadContent('a,b\n', 'text', SPACED_FILE);
});

test.describe('settings', () => {
  test('enabled off makes the extension inert', async ({ page }) => {
    await setPluginSettings(page, { dragDropPathEnabled: false });
    await page.contents.uploadContent('', 'text', 'off.py');
    await openEditor(page, 'off.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(600);

    expect(await editorSource(page)).toBe('');
  });

  test('enabled on by default inserts', async ({ page }) => {
    // No settings written: the schema default must be on.
    await page.contents.uploadContent('', 'text', 'default.py');
    await openEditor(page, 'default.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);
  });

  test('a disabled drag is not accepted by the drop target', async ({
    page
  }) => {
    await setPluginSettings(page, { dragDropPathEnabled: false });
    await page.contents.uploadContent('', 'text', 'accept.py');
    await openEditor(page, 'accept.py');

    // dropAction stays at its initial value when the handler declines the drag.
    const action = await dragOverCurrentWidget(page, [PLAIN_FILE]);

    expect(action).toBe('none');
  });

  test('an enabled single-item drag is accepted', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'accept2.py');
    await openEditor(page, 'accept2.py');

    const action = await dragOverCurrentWidget(page, [PLAIN_FILE]);

    expect(action).toBe('move');
  });

  test('a multi-item drag is not accepted by an editor', async ({ page }) => {
    // Only the terminal takes several paths at once; see drag-path.spec.ts.
    await page.contents.uploadContent('', 'text', 'accept3.py');
    await openEditor(page, 'accept3.py');

    const action = await dragOverCurrentWidget(page, ['a.csv', 'b.csv']);

    expect(action).toBe('none');
  });

  test('pathlib style inserts a constructor expression', async ({ page }) => {
    await setPluginSettings(page, { pythonPathStyle: 'pathlib' });
    await page.contents.uploadContent('', 'text', 'plib.py');
    await openEditor(page, 'plib.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`pathlib.Path('${PLAIN_FILE}')`);
  });

  test('the pathlib constructor follows the setting', async ({ page }) => {
    await setPluginSettings(page, {
      pythonPathStyle: 'pathlib',
      pathlibConstructor: 'Path'
    });
    await page.contents.uploadContent('', 'text', 'plib2.py');
    await openEditor(page, 'plib2.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`Path('${PLAIN_FILE}')`);
  });

  test('absolute path type inserts a path under the server root', async ({
    page
  }) => {
    await setPluginSettings(page, { pathType: 'absolute' });
    await page.contents.uploadContent('', 'text', 'abs.py');
    await openEditor(page, 'abs.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    const source = await editorSource(page);
    expect(source).toMatch(/^'\/.*dropme\.csv'$/);
  });

  test('relative is the default path type', async ({ page }) => {
    await page.contents.createDirectory('deep');
    await page.contents.uploadContent('', 'text', 'deep/rel.py');
    await openEditor(page, 'deep/rel.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`'../${PLAIN_FILE}'`);
  });

  test('posix is the default python style', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'posix.py');
    await openEditor(page, 'posix.py');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    const source = await editorSource(page);
    expect(source).toBe(`'${PLAIN_FILE}'`);
    expect(source).not.toContain('Path(');
  });
});

test.describe('live settings', () => {
  test('a setting change applies to the next drop without a reload', async ({
    page
  }) => {
    await page.contents.uploadContent('', 'text', 'live.py');
    await openEditor(page, 'live.py');
    await markPage(page);

    // Relative is the default, so the first drop inserts the bare name.
    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);

    await setPluginSettingsLive(page, { pathType: 'absolute' });

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    // The second insertion carries the server root, which only the new
    // setting produces. Its position in the text is not asserted: these drops
    // carry no coordinates, and CodeMirror resolves (0, 0) to the start of the
    // document rather than declining it, so the second text lands ahead of the
    // first rather than after it.
    await expect
      .poll(async () => editorSource(page), { timeout: 10000 })
      .toMatch(/'\/[^']*dropme\.csv'/);
    // The relative insertion the old setting produced is still there, so the
    // two drops really did read different settings.
    expect(await editorSource(page)).toContain(`'${PLAIN_FILE}'`);
    // The mark survives only if the page was never reloaded, which is the
    // half of this criterion an assertion on the text alone cannot reach.
    expect(await pageStillMarked(page)).toBe(true);
  });

  test('turning the master switch back on restores insertion live', async ({
    page
  }) => {
    await page.contents.uploadContent('', 'text', 'live-switch.py');
    await openEditor(page, 'live-switch.py');
    await markPage(page);

    // Pin the path type: the test above leaves it absolute in the server copy.
    await setPluginSettingsLive(page, {
      dragDropPathEnabled: false,
      pathType: 'relative'
    });
    expect(await dragOverCurrentWidget(page, [PLAIN_FILE])).toBe('none');
    expect(await editorSource(page)).toBe('');

    await setPluginSettingsLive(page, { dragDropPathEnabled: true });
    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);
    // The mark survives only if neither switch was read after a reload.
    expect(await pageStillMarked(page)).toBe(true);
  });
});

test.describe('edge cases', () => {
  test('editor holds focus after insertion', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'focus.py');
    await openEditor(page, 'focus.py');

    // Move focus out of the editor first.
    await page.evaluate(() => {
      (window as any).jupyterapp.shell.activateById('filebrowser');
      (document.activeElement as HTMLElement)?.blur();
    });

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(500);

    const focused = await page.evaluate(() => {
      const widget = (window as any).jupyterapp.shell.currentWidget;
      return widget.content.editor.hasFocus();
    });
    expect(focused).toBe(true);
  });

  test('insertion lands at the drop coordinates in an editor', async ({
    page
  }) => {
    await page.contents.uploadContent(
      'line0\nline1\nline2\n',
      'text',
      'coords.py'
    );
    await openEditor(page, 'coords.py');

    // Put the caret at the very start, then drop over the third line.
    await page.evaluate(() => {
      const editor = (window as any).jupyterapp.shell.currentWidget.content
        .editor;
      editor.focus();
      editor.setCursorPosition({ line: 0, column: 0 });
    });

    const target = await page.evaluate(() => {
      const lines = document.querySelectorAll('.cm-content .cm-line');
      const rect = lines[2].getBoundingClientRect();
      return { x: Math.round(rect.left + 2), y: Math.round(rect.top + 2) };
    });

    await dropOnCurrentWidget(page, [PLAIN_FILE], target);
    await page.waitForTimeout(500);

    const source = await editorSource(page);
    // Landed on line2, not at the caret on line0.
    expect(source.split('\n')[0]).toBe('line0');
    expect(source.split('\n')[2]).toContain(PLAIN_FILE);
  });

  test('a notebook with no active cell inserts nothing', async ({ page }) => {
    const notebook = JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: 'KEEP'
        }
      ],
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
    await page.contents.uploadContent(notebook, 'text', 'nocell.ipynb');
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path: 'nocell.ipynb',
        factory: 'Notebook'
      });
    });
    await page.waitForTimeout(1500);

    // `activeCellIndex = -1` is clamped back to 0 by JupyterLab, so the state
    // this guard defends against is not reachable through the UI. Force it
    // directly to prove the guard returns instead of throwing.
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => {
      const notebook = (window as any).jupyterapp.shell.currentWidget.content;
      Object.defineProperty(notebook, 'activeCell', {
        get: () => null,
        configurable: true
      });
    });

    await dropOnCurrentWidget(page, [PLAIN_FILE]);
    await page.waitForTimeout(500);

    const sources = await page.evaluate(() => {
      const notebook = (window as any).jupyterapp.shell.currentWidget.content;
      const model = notebook.model;
      const out: string[] = [];
      for (let i = 0; i < model.cells.length; i++) {
        out.push(model.cells.get(i).sharedModel.getSource());
      }
      return out;
    });
    expect(sources).toEqual(['KEEP']);
    expect(errors).toEqual([]);
  });

  test('server root is reported as an absolute path', async ({ page }) => {
    // The root lives in the page config, written by the server extension at
    // load time, and the drop targets read it from there.
    const root = await serverRoot(page);
    expect(root).toMatch(/^\//);
    expect(root).not.toContain('~');
  });
});

test.describe('terminal multi-drop settings', () => {
  test('the newline separator continues the line instead of submitting it', async ({
    page
  }) => {
    await setPluginSettings(page, { terminalSeparator: 'newline' });
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/dropme\.csv \\\r\S*my\\ data/);

    const sent = (await sentStdin(page))[0];
    // Two lines, one carriage return between them, and the backslash in front
    // of it is what stops the shell running the first line.
    expect(sent.split('\r')).toHaveLength(2);
    expect(sent).toContain(' \\\r');
    // No continuation after the last path: a trailing one would leave the
    // shell waiting for a line the user never typed.
    expect(sent.endsWith('.csv')).toBe(true);
  });

  test('quoting wraps each path instead of escaping it', async ({ page }) => {
    await setPluginSettings(page, { terminalQuotePaths: true });
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/'[^']*dropme\.csv' '[^']*my data \(1\)\.csv'$/);

    // Quoting replaces escaping rather than adding to it: inside the quotes
    // the space and the parentheses stand as themselves.
    expect((await sentStdin(page))[0]).not.toContain('\\');
  });

  test('space and no quoting are the defaults', async ({ page }) => {
    // No settings written, so the schema defaults are what the plugin reads.
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/dropme\.csv \S*my\\ data\\ \\\(1\\\)\.csv$/);

    expect((await sentStdin(page))[0]).not.toContain("'");
  });
});
