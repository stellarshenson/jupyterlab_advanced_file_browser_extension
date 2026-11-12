import { expect, test } from '@jupyterlab/galata';

import {
  activeCellSource,
  allCellSources,
  codeCell,
  dragOverCurrentWidget,
  dropOnCurrentWidget,
  editorSource,
  markdownCell,
  notebookFixture,
  openDocument,
  dropOnWidgetById,
  openTerminalAndCaptureSends,
  PLAIN_FILE,
  SPACED_FILE,
  sentStdin
} from './helpers';

/**
 * Functional tests for path insertion into editors, notebooks and terminals.
 * The drag drivers live in ./helpers.
 */

test.beforeEach(async ({ page }) => {
  // Fixtures the drags point at. Content is irrelevant - only the path is read.
  await page.contents.uploadContent('a,b\n1,2\n', 'text', PLAIN_FILE);
  await page.contents.uploadContent('a,b\n1,2\n', 'text', SPACED_FILE);
});

test.describe('file editor', () => {
  test('python file receives a quoted path', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'script.py');
    await openDocument(page, 'script.py', 'Editor');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await editorSource(page)).toBe(`'${PLAIN_FILE}'`);
  });

  test('markdown file receives the bare path', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'notes.md');
    await openDocument(page, 'notes.md', 'Editor');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    const source = await editorSource(page);
    expect(source).toBe(PLAIN_FILE);
    expect(source).not.toContain("'");
  });

  test('multi-item drag inserts nothing', async ({ page }) => {
    await page.contents.uploadContent('', 'text', 'multi.py');
    await openDocument(page, 'multi.py', 'Editor');

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    expect(await editorSource(page)).toBe('');
  });

  test('path is relative to the document directory', async ({ page }) => {
    await page.contents.createDirectory('sub');
    await page.contents.uploadContent('', 'text', 'sub/nested.py');
    await openDocument(page, 'sub/nested.py', 'Editor');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    // The document sits one level down, so the sibling file is one level up.
    expect(await editorSource(page)).toBe(`'../${PLAIN_FILE}'`);
  });
});

test.describe('notebook', () => {
  test('python code cell receives a quoted path', async ({ page }) => {
    await page.contents.uploadContent(
      notebookFixture([codeCell('')]),
      'text',
      'code.ipynb'
    );
    await openDocument(page, 'code.ipynb', 'Notebook');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await activeCellSource(page)).toBe(`'${PLAIN_FILE}'`);
  });

  test('markdown cell receives the bare path', async ({ page }) => {
    await page.contents.uploadContent(
      notebookFixture([markdownCell('')]),
      'text',
      'md.ipynb'
    );
    await openDocument(page, 'md.ipynb', 'Notebook');

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    const source = await activeCellSource(page);
    expect(source).toBe(PLAIN_FILE);
    expect(source).not.toContain("'");
  });

  test('insertion lands at the cell cursor, not the drop point', async ({
    page
  }) => {
    await page.contents.uploadContent(
      notebookFixture([codeCell('AB')]),
      'text',
      'cursor.ipynb'
    );
    await openDocument(page, 'cursor.ipynb', 'Notebook');

    // Put the caret between A and B.
    await page.evaluate(() => {
      const widget = (window as any).jupyterapp.shell.currentWidget;
      const editor = widget.content.activeCell.editor;
      editor.focus();
      editor.setCursorPosition({ line: 0, column: 1 });
    });

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    expect(await activeCellSource(page)).toBe(`A'${PLAIN_FILE}'B`);
  });

  test('multi-item drag inserts nothing', async ({ page }) => {
    await page.contents.uploadContent(
      notebookFixture([codeCell('')]),
      'text',
      'multi.ipynb'
    );
    await openDocument(page, 'multi.ipynb', 'Notebook');

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);
    await page.waitForTimeout(2000);

    expect(await activeCellSource(page)).toBe('');
  });

  test('the cell under the pointer takes the drop, not the active cell', async ({
    page
  }) => {
    await page.contents.uploadContent(
      notebookFixture([
        codeCell('FIRST'),
        codeCell('SECOND'),
        codeCell('THIRD')
      ]),
      'text',
      'cells.ipynb'
    );
    await openDocument(page, 'cells.ipynb', 'Notebook');

    // Leave the caret in the first cell, then drop onto the third.
    await page.evaluate(() => {
      (window as any).jupyterapp.shell.currentWidget.content.activeCellIndex =
        0;
    });
    const target = await page.evaluate(() => {
      const notebook = (window as any).jupyterapp.shell.currentWidget.content;
      const rect = notebook.widgets[2].node.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    });

    await dropOnCurrentWidget(page, [PLAIN_FILE], target);

    await expect
      .poll(async () => (await allCellSources(page))[2], { timeout: 10000 })
      .toContain(PLAIN_FILE);
    const sources = await allCellSources(page);
    expect(sources[0]).toBe('FIRST');
    expect(sources[1]).toBe('SECOND');
  });
});

test.describe('terminal', () => {
  test('path with spaces is shell-escaped', async ({ page }) => {
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [SPACED_FILE]);

    // The terminal's own working directory is wherever the test server was
    // started, which is not the galata content root, so the leading part of a
    // relative path is environment-dependent. The escaping is not: assert the
    // property the criterion states, on the part that is stable.
    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/my\\ data\\ \\\(1\\\)\.csv$/);

    const sent = (await sentStdin(page))[0];
    // No bare space survives escaping, and nothing is quoted.
    expect(sent).not.toMatch(/(^|[^\\]) /);
    expect(sent).not.toContain("'");
    expect(sent).not.toContain('"');
  });

  test('plain path needs no escaping and is sent unquoted', async ({
    page
  }) => {
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE]);

    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/dropme\.csv$/);

    const sent = (await sentStdin(page))[0];
    expect(sent).not.toContain("'");
    expect(sent).not.toContain('\\');
  });

  test('dropping on a terminal makes it the active widget', async ({
    page
  }) => {
    await openTerminalAndCaptureSends(page);
    const terminalId = await page.evaluate(
      () => (window as any).jupyterapp.shell.currentWidget.id
    );

    // Move focus away, the way a drag starting in the file browser does.
    await page.evaluate(() => {
      (window as any).jupyterapp.shell.activateById('filebrowser');
    });
    await page.waitForTimeout(300);

    await dropOnWidgetById(page, terminalId, [PLAIN_FILE]);

    // The widget node is the MainAreaWidget; the terminal itself is its content,
    // so identity is the id, not a class on the outer node.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as any).jupyterapp.shell.currentWidget.id
          ),
        { timeout: 15000 }
      )
      .toBe(terminalId);
  });

  test('a multi-item drag is accepted', async ({ page }) => {
    await openTerminalAndCaptureSends(page);

    // The editor and the notebook decline the same drag; the terminal is the
    // one target that takes it.
    const action = await dragOverCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    expect(action).toBe('move');
  });

  test('a multi-item drag sends every path in one line', async ({ page }) => {
    await openTerminalAndCaptureSends(page);

    await dropOnCurrentWidget(page, [PLAIN_FILE, SPACED_FILE]);

    await expect
      .poll(async () => (await sentStdin(page))[0], { timeout: 15000 })
      .toMatch(/dropme\.csv \S*my\\ data\\ \\\(1\\\)\.csv$/);

    // One send, not one per file: the paths arrive as a single insertion in
    // the order the drag carried them.
    expect(await sentStdin(page)).toHaveLength(1);
    const sent = (await sentStdin(page))[0];
    // Exactly one unescaped space - the separator. Every space inside a name
    // is still escaped, so the shell reads two arguments, not four.
    expect(sent.match(/(^|[^\\]) /g) ?? []).toHaveLength(1);
    expect(sent).not.toContain('\r');
  });
});
