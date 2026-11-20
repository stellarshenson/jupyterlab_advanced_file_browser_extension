/**
 * Regression for DEF-UNFOLD-40-REFRESH-EXTERNAL: a file written on disk by a process outside
 * JupyterLab, inside a folder unfolded two levels below the top folder, appeared only after
 * about 30 s. The stock model polls every 10 s and the poll reads the whole tree; while the
 * page is hidden, Lumino's 'when-hidden' standby drops the poll and nothing wakes it when the
 * page returns, so the row waits for the next standby timer.
 *
 * Runs 1 and 2 measure the visible poll: the write starts right after the setup, so the first
 * read after it is at most one 10 s tick away, and each row must appear within one tick plus
 * headroom. Run 3 writes after a poll tick and then makes the page visible: it proves the
 * visibilitychange listener refreshes at once, and its 2 s bound cannot be met by the next
 * 10 s tick.
 */
import { expect, test } from '@jupyterlab/galata';
import { writeFileSync } from 'fs';
import { join } from 'path';

import {
  browserHandle,
  openFolder,
  seedTree,
  serverRoot,
  SERVER_TIMEOUT,
  setUnfolding,
  unfold,
  visibleRows
} from './helpers';

/** One poll tick (10 s) plus headroom for a write that follows a tick at any phase. */
const RUN_BOUND = 13000;
/**
 * Run 3 writes about 1 s after a tick, leaving about 9 s to the next natural tick. A refresh
 * tick reads every folder in 12-45 ms and the row reaches the DOM 6-9 ms later (measure.json
 * of the cause run), so 2 s is about 40 times the observed cost and still far below 9 s.
 */
const VISIBILITY_BOUND = 2000;
/** Guard for a row that never appears; the bounds above are the regression assertions. */
const MEASURE_TIMEOUT = 60000;

test('DEF-UNFOLD-40-REFRESH-EXTERNAL external file latency in an unfolded folder', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(180000);

  await setUnfolding(page, true);
  await seedTree(page, tmpPath, [
    'top/',
    'top/deep/',
    'top/deep/early.txt',
    'top/other.txt'
  ]);
  await openFolder(page, tmpPath);
  await unfold(page, `${tmpPath}/top/deep`);
  const early = `${tmpPath}/top/deep/early.txt`;
  await expect
    .poll(
      async () => (await visibleRows(page)).some(row => row.path === early),
      {
        message: `the seeded row ${early}`,
        timeout: SERVER_TIMEOUT
      }
    )
    .toBe(true);

  const browser = await browserHandle(page);
  const pollInterval = await browser.evaluate(
    b => b.model._poll.frequency.interval
  );
  console.log(`DEF40 POLL ${pollInterval}`);

  const requests: number[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/contents')) {
      requests.push(Date.now());
    }
  });

  const modelPaths = (): Promise<string[]> =>
    browser.evaluate(b =>
      Array.from(b.model.items(), (item: any) => item.path as string)
    );

  const root = await serverRoot(page);
  const runs: { file: string; model_ms: number; dom_ms: number }[] = [];
  const measure = async (
    file: string,
    path: string,
    written: number,
    bound: number,
    label: string
  ): Promise<void> => {
    await expect
      .poll(async () => (await modelPaths()).includes(path), {
        message: `the model lists ${path}`,
        timeout: MEASURE_TIMEOUT,
        intervals: [100]
      })
      .toBe(true);
    const model_ms = Date.now() - written;

    await expect
      .poll(
        async () => (await visibleRows(page)).some(row => row.path === path),
        {
          message: `the listing shows ${path}`,
          timeout: MEASURE_TIMEOUT,
          intervals: [100]
        }
      )
      .toBe(true);
    const dom_ms = Date.now() - written;

    const message = `${label} model_ms=${model_ms} dom_ms=${dom_ms} exceeds the ${bound} ms bound`;
    expect(model_ms, message).toBeLessThanOrEqual(bound);
    expect(dom_ms, message).toBeLessThanOrEqual(bound);
    console.log(`DEF40 ${label} model_ms=${model_ms} dom_ms=${dom_ms}`);
    runs.push({ file, model_ms, dom_ms });
  };

  let firstWrite = 0;
  for (const n of [1, 2]) {
    const file = `late-${n}.txt`;
    const path = `${tmpPath}/top/deep/${file}`;
    // Written on disk by this process, not through the contents API: only the browser's
    // own poll can show it, so no change signal reaches the page.
    writeFileSync(join(root, tmpPath, 'top', 'deep', file), 'late');
    const written = Date.now();
    firstWrite ||= written;
    await measure(file, path, written, RUN_BOUND, `RUN ${n}`);
  }

  // The page returns from hidden: wait for a poll tick, let its own reads finish, then write
  // and make the page visible. Without the listener the row cannot appear before the next
  // tick, about 9 s away.
  await page.waitForRequest(request => request.url().includes('/api/contents'));
  await new Promise(resolve => setTimeout(resolve, 1000));
  const file = 'late-3.txt';
  const path = `${tmpPath}/top/deep/${file}`;
  writeFileSync(join(root, tmpPath, 'top', 'deep', file), 'late');
  const written = Date.now();
  // Headless Chromium keeps document.visibilityState 'visible', so the listener refreshes on
  // the event just as it does when the page returns to visible.
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await measure(file, path, written, VISIBILITY_BOUND, 'VISIBILITY');

  const offsets = requests.map(time => time - firstWrite).sort((a, b) => a - b);
  console.log(`DEF40 REQUESTS ${offsets.join(',')}`);
});
