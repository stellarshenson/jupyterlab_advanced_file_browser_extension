/**
 * The row tooltips of the file browser, category TIPS of docs/acc-crit.md.
 * JupyterLab's stock DirListing renderer writes each row's details into its native
 * `title` attribute; the tree rendering of this extension uses that same renderer.
 */
import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

import {
  rowLocator,
  seedTree,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

test.beforeEach(async ({ page, tmpPath }) => {
  await setUnfolding(page, true);
  await seedTree(page, tmpPath, ['a/', 'a/x.txt', 'b.txt']);
  await rowLocator(page, `${tmpPath}/a`);
});

/** The value of the first title line starting with `prefix`, or undefined. */
function lineValue(lines: string[], prefix: string): string | undefined {
  const line = lines.find(entry => entry.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length);
}

/**
 * The directory the stock renderer shows in the `Path: ` line: it truncates the
 * directory at 50 characters and appends `...` when it is longer.
 */
function stockPath(dir: string): string {
  return dir.length > 50 ? `${dir.slice(0, 50)}...` : dir;
}

/**
 * Hover the row `path` and return the lines of its title attribute, waiting until the
 * render has written a title of more than one line.
 */
async function expectHoveredTitleLines(
  page: IJupyterLabPageFixture,
  path: string
): Promise<string[]> {
  const row = await rowLocator(page, path);
  await row.hover();
  const title = async () => (await row.getAttribute('title')) ?? '';
  await expect
    .poll(async () => (await title()).split('\n').length, {
      message: `the title of ${path}`,
      timeout: SERVER_TIMEOUT
    })
    .toBeGreaterThan(1);
  return (await title()).split('\n');
}

test('ACC-TIPS-159-DETAILS every row tooltip shows name, path, modified time and file size', async ({
  page,
  tmpPath
}) => {
  /** Hover the row `path` and assert the lines of its tooltip. */
  const check = async (path: string, dir: string, file: boolean) => {
    const name = (await visibleRows(page)).find(row => row.path === path)?.name;
    expect(name, `the name of ${path}`).toBeTruthy();
    const lines = await expectHoveredTitleLines(page, path);
    expect(lineValue(lines, 'Name: '), `the name line of ${path}`).toBe(name);
    expect(lineValue(lines, 'Path: '), `the path line of ${path}`).toBe(
      stockPath(dir)
    );
    expect(
      lineValue(lines, 'Modified: '),
      `the modified line of ${path}`
    ).toBeTruthy();
    if (file) {
      expect(
        lineValue(lines, 'Size: '),
        `the size line of ${path}`
      ).toBeTruthy();
    }
  };

  await check(`${tmpPath}/b.txt`, tmpPath, true);
  await check(`${tmpPath}/a`, tmpPath, false);
  await unfold(page, `${tmpPath}/a`);
  await check(`${tmpPath}/a/x.txt`, `${tmpPath}/a`, true);
});
