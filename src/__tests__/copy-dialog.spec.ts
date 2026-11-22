// transfer starts and polls the job through requestAPI, moves on one volume through renameFile
// and reports through showErrorMessage, so these are replaced; the progress dialog stays real.
jest.mock('../request', () => ({ requestAPI: jest.fn() }));
jest.mock('@jupyterlab/apputils', () => ({
  ...jest.requireActual('@jupyterlab/apputils'),
  showErrorMessage: jest.fn()
}));
jest.mock('@jupyterlab/docmanager', () => ({
  ...jest.requireActual('@jupyterlab/docmanager'),
  renameFile: jest.fn()
}));

import { showErrorMessage } from '@jupyterlab/apputils';
import { renameFile } from '@jupyterlab/docmanager';
import type { Contents } from '@jupyterlab/services';
import { nullTranslator } from '@jupyterlab/translation';
import { Signal } from '@lumino/signaling';

import { clock, copyTitle, gib, group, timeAgo, transfer } from '../copyDialog';
import type { TreeFileBrowserModel } from '../model';
import { requestAPI } from '../request';

const trans = nullTranslator.load('jupyterlab');
const fileChanged = new Signal<unknown, Contents.IChangedArgs>({});
const model = {
  manager: {
    services: {
      contents: {
        localPath: (path: string) => path,
        driveName: (path: string) =>
          path.includes(':') ? path.split(':')[0] : '',
        fileChanged
      },
      serverSettings: {}
    },
    copy: jest.fn(async () => ({}))
  },
  refresh: jest.fn(async () => undefined),
  isDisposed: false
} as unknown as TreeFileBrowserModel;

const progress = () =>
  document.querySelector<HTMLElement>('.jp-AdvancedFileBrowser-copyDialog');

/**
 * Answer the start with `start` and each progress request with a running job,
 * overridden by `report` of the milliseconds since the start.
 */
function serve(
  start: { id: string | null; rename: string[] },
  report: (ms: number) => object
): void {
  const begun = Date.now();
  (requestAPI as jest.Mock).mockImplementation(async (endPoint: string) =>
    endPoint === 'copy'
      ? start
      : {
          files_total: 1,
          bytes_total: 100,
          files: 0,
          bytes: 0,
          file_size: 100,
          file_bytes: 0,
          from: 'a',
          to: 'd/a',
          cross: false,
          done: false,
          elapsed: 0,
          ...report(Date.now() - begun)
        }
  );
}

beforeEach(() => jest.clearAllMocks());

describe('the counters', () => {
  it('ACC-COPY-165-PROGRESS-TITLE copyTitle names the action and the count', () => {
    expect(copyTitle(false, 3, trans)).toBe('Copying 3 items');
    expect(copyTitle(false, 1, trans)).toBe('Copying 1 item');
    expect(copyTitle(true, 3, trans)).toBe('Moving 3 items');
    expect(copyTitle(true, 1, trans)).toBe('Moving 1 item');
  });

  it('ACC-COPY-169-COUNTERS clock, GiB and group formats', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(59.2)).toBe('1:00');
    expect(clock(61)).toBe('1:01');
    expect(clock(3725)).toBe('62:05');
    expect(gib(0)).toBe('0.00');
    expect(gib(1.5 * 1024 ** 3)).toBe('1.50');
    expect(group(999)).toBe('999');
    expect(group(20000)).toBe('20\u00a0000');
    expect(group(1234567)).toBe('1\u00a0234\u00a0567');
  });

  it('ACC-COPY-185-MENU-DETAIL timeAgo gives 45 s ago, 3 min ago and 2 h ago', () => {
    expect(timeAgo(45, trans)).toBe('45 s ago');
    expect(timeAgo(59.9, trans)).toBe('59 s ago');
    expect(timeAgo(180, trans)).toBe('3 min ago');
    expect(timeAgo(3599, trans)).toBe('59 min ago');
    expect(timeAgo(7200, trans)).toBe('2 h ago');
  });
});

describe('the progress dialog', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => jest.useRealTimers());

  it('ACC-COPY-162-PROGRESS-SHOW the dialog opens 1 s after the start and stays 500 ms; a job done sooner opens none', async () => {
    serve({ id: 'job', rename: [] }, ms => ({ done: ms >= 1100 }));
    let run = transfer(model, ['a'], 'd', false, 'Paste Error', trans);

    await jest.advanceTimersByTimeAsync(999);
    expect(progress()).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(progress()?.querySelector('.jp-Dialog-header')?.textContent).toBe(
      'Copying 1 item'
    );
    // Done at the poll of 1250 ms, kept until 500 ms after the open.
    await jest.advanceTimersByTimeAsync(499);
    expect(progress()).not.toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(progress()).toBeNull();
    expect(await run).toEqual([]);

    serve({ id: 'job', rename: [] }, ms => ({ done: ms >= 500 }));
    run = transfer(model, ['a'], 'd', false, 'Paste Error', trans);
    await jest.advanceTimersByTimeAsync(1000);
    expect(progress()).toBeNull();
    await jest.advanceTimersByTimeAsync(1000);
    expect(progress()).toBeNull();
    expect(await run).toEqual([]);
  });

  it('ACC-COPY-184-ESCAPE Escape hides the dialog and only the Cancel press cancels', async () => {
    const ids = ['first', 'second'];
    const cancelled = new Set<string>();
    (requestAPI as jest.Mock).mockImplementation(
      async (endPoint: string, _settings: unknown, init?: RequestInit) => {
        if (endPoint === 'copy') {
          return { id: ids.shift(), rename: [] };
        }
        const id = endPoint.split('/')[1];
        if (init?.method === 'DELETE') {
          cancelled.add(id);
          return '';
        }
        return { done: cancelled.has(id), not_done: [] };
      }
    );
    const first = transfer(model, ['a'], 'd', false, 'Paste Error', trans);
    await jest.advanceTimersByTimeAsync(1000);

    progress()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await jest.advanceTimersByTimeAsync(0);

    expect(progress()).toBeNull();
    expect(cancelled.size).toBe(0);

    const second = transfer(model, ['b'], 'd', true, 'Paste Error', trans);
    await jest.advanceTimersByTimeAsync(1000);
    expect(progress()?.querySelector('.jp-Dialog-header')?.textContent).toBe(
      'Moving 1 item'
    );
    progress()!
      .querySelector('.jp-Dialog-button')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await jest.advanceTimersByTimeAsync(0);

    expect(progress()).toBeNull();
    expect([...cancelled]).toEqual(['second']);
    await jest.advanceTimersByTimeAsync(250);
    expect(await second).toEqual([]);
    // A cancelled operation reports no error.
    expect(showErrorMessage).not.toHaveBeenCalled();

    cancelled.add('first');
    await jest.advanceTimersByTimeAsync(250);
    expect(await first).toEqual([]);
  });

  it('ACC-COPY-173-FAIL a Cancel press after the job ended, while its dialog is held, still reports the failures', async () => {
    // Open at 1000 ms, done at the poll of 1250 ms, held until 1500 ms.
    serve({ id: 'job', rename: [] }, ms => ({
      done: ms >= 1100,
      errors: [{ path: 'a/ro/f', message: 'permission denied' }],
      not_done: ['a']
    }));
    const run = transfer(model, ['a'], 'd', false, 'Paste Error', trans);
    await jest.advanceTimersByTimeAsync(1250);

    progress()!
      .querySelector('.jp-Dialog-button')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await jest.advanceTimersByTimeAsync(250);

    expect(await run).toEqual(['a']);
    expect(
      (requestAPI as jest.Mock).mock.calls.filter(
        ([, , init]) => init?.method === 'DELETE'
      )
    ).toEqual([]);
    expect(showErrorMessage).toHaveBeenCalledWith(
      'Paste Error',
      'Not copied: a/ro/f: permission denied'
    );
  });

  it('ACC-COPY-172-PROGRESS-END a dialog launched while the progress dialog shows opens when the operation ends', async () => {
    serve({ id: 'job', rename: [] }, ms => ({ done: ms >= 1100 }));
    const run = transfer(model, ['a'], 'd', false, 'Paste Error', trans);
    await jest.advanceTimersByTimeAsync(1000);
    expect(progress()).not.toBeNull();

    const actual = jest.requireActual('@jupyterlab/apputils');
    const shown = actual.showErrorMessage('Other Error', 'queued');
    await jest.advanceTimersByTimeAsync(500);
    expect(await run).toEqual([]);

    expect(progress()).toBeNull();
    const error = document.querySelector<HTMLElement>('.jp-Dialog');
    expect(error?.querySelector('.jp-Dialog-body')?.textContent).toBe('queued');
    error!.querySelector<HTMLElement>('.jp-Dialog-button')!.click();
    await shown;
  });
});

describe('transfer', () => {
  it.each([
    [false, 'Not copied: a/ro/f: permission denied'],
    [true, 'Not moved: a/ro/f: permission denied']
  ])(
    'ACC-COPY-173-FAIL transfer reports the job lines and resolves with the paths not done (move %s)',
    async (move, message) => {
      serve({ id: 'job', rename: [] }, () => ({
        done: true,
        errors: [{ path: 'a/ro/f', message: 'permission denied' }],
        not_done: ['a']
      }));

      expect(
        await transfer(model, ['a', 'b.txt'], 'd', move, 'Paste Error', trans)
      ).toEqual(['a']);
      expect(showErrorMessage).toHaveBeenCalledWith('Paste Error', message);
      expect(model.refresh).toHaveBeenCalled();
    }
  );

  it('transfer moves the rename paths through renameFile and the others through the job', async () => {
    (renameFile as jest.Mock).mockResolvedValue({});
    serve({ id: 'job', rename: ['b.txt'] }, () => ({
      done: true,
      errors: [],
      not_done: []
    }));
    const changes: Contents.IChangedArgs[] = [];
    const record = (_: unknown, change: Contents.IChangedArgs) =>
      changes.push(change);
    fileChanged.connect(record);

    expect(
      await transfer(
        model,
        ['a', 'b.txt', 'd/c.txt'],
        'd',
        true,
        'Move Error',
        trans
      )
    ).toEqual([]);
    fileChanged.disconnect(record);

    // d/c.txt is not moving, so it is skipped before the start.
    const [, , init] = (requestAPI as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      paths: ['a', 'b.txt'],
      to: 'd',
      move: true
    });
    expect((renameFile as jest.Mock).mock.calls).toEqual([
      [model.manager, 'b.txt', 'd/b.txt']
    ]);
    // Open documents follow the item the job moved.
    expect(changes).toEqual([
      {
        type: 'rename',
        oldValue: { path: 'a' },
        newValue: { path: 'd/a', name: 'a' }
      }
    ]);
  });

  it('transfer resolves with a path whose overwrite was declined, without a message', async () => {
    (renameFile as jest.Mock).mockRejectedValue('File not renamed');
    serve({ id: null, rename: ['b.txt'] }, () => ({}));

    expect(
      await transfer(model, ['b.txt'], 'd', true, 'Move Error', trans)
    ).toEqual(['b.txt']);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('transfer resolves with every path when the start fails', async () => {
    const error = new Error('No such directory: d');
    (requestAPI as jest.Mock).mockRejectedValue(error);

    expect(
      await transfer(model, ['a', 'b.txt'], 'd', false, 'Paste Error', trans)
    ).toEqual(['a', 'b.txt']);
    expect(showErrorMessage).toHaveBeenCalledWith('Paste Error', error);
  });

  it('transfer copies a path on another drive through manager.copy, without the job', async () => {
    expect(
      await transfer(
        model,
        ['zip:a.zip/b.txt'],
        '',
        false,
        'Paste Error',
        trans
      )
    ).toEqual([]);
    expect(model.manager.copy).toHaveBeenCalledWith('zip:a.zip/b.txt', '');
    expect(requestAPI).not.toHaveBeenCalled();
  });

  it('transfer reports a refusal the stock call throws and resolves with its path', async () => {
    const error = new Error(
      'Copying files between drives is not currently implemented'
    );
    (model.manager.copy as jest.Mock).mockImplementationOnce(() => {
      throw error;
    });

    expect(
      await transfer(model, ['a.txt'], 'zip:a.zip', false, 'Paste Error', trans)
    ).toEqual(['a.txt']);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage).toHaveBeenCalledWith('Paste Error', error);
    expect(requestAPI).not.toHaveBeenCalled();
  });
});
