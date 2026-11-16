/**
 * ACC-DELETE-153-ALL-VOLUMES with c.AdvancedFileBrowser.trash_on_all_volumes = True. Run by
 * playwright-all-volumes.config.js; the default playwright.config.js ignores this file.
 */
import { expect, test } from '@jupyterlab/galata';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs';
import { basename, join } from 'path';
import { openFolder, rowLocator, SERVER_TIMEOUT, serverRoot } from './helpers';

test.afterEach(async ({ page, tmpPath }) => {
  rmSync(join(await serverRoot(page), tmpPath), {
    recursive: true,
    force: true
  });
});

test('ACC-DELETE-153-ALL-VOLUMES with True a file on another mount gets Move to Trash and is moved to a trash', async ({
  page,
  tmpPath
}) => {
  // The sandbox binds /tmp as a mount of its own, apart from the server root's
  test.skip(
    !readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some(line => line.split(' ')[4] === '/tmp'),
    '/tmp is not a mount of its own'
  );
  const target = mkdtempSync(join('/tmp', 'acc153-'));
  const name = `${basename(target)}.txt`;
  const file = join(target, name);
  // The trash of the /tmp mount, or the test server's home trash (playwright.config.js)
  const trashes = [
    `/tmp/.Trash-${process.getuid!()}`,
    join(process.env.GALATA_HOME!, '.local', 'share', 'Trash')
  ];
  try {
    writeFileSync(file, 'x');
    symlinkSync(target, join(await serverRoot(page), tmpPath, 'nfs'));
    await openFolder(page, `${tmpPath}/nfs`);
    const checked = page.waitForResponse(/\/delete\/trash-check(\?|$)/);

    await (await rowLocator(page, `${tmpPath}/nfs/${name}`)).click();
    await page.keyboard.press('Delete');

    expect((await (await checked).json()).monitored).toEqual([true]);
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog.locator('.jp-Dialog-button')).toHaveText([
      'Cancel',
      'Delete Permanently',
      'Move to Trash'
    ]);
    await dialog
      .getByRole('button', { name: 'Move to Trash', exact: true })
      .click();
    await expect
      .poll(() => existsSync(file), { timeout: SERVER_TIMEOUT })
      .toBe(false);
    expect(
      trashes.filter(trash => existsSync(join(trash, 'files', name)))
    ).toHaveLength(1);
  } finally {
    rmSync(target, { recursive: true, force: true });
    for (const trash of trashes) {
      rmSync(join(trash, 'files', name), { force: true });
      rmSync(join(trash, 'info', `${name}.trashinfo`), { force: true });
    }
  }
});
