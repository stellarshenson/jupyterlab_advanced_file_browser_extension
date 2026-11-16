// deleteItems asks the server through requestAPI, confirms through showDialog and reports
// through showErrorMessage, so these are replaced here; the progress dialog stays the real one.
jest.mock('../request', () => ({ requestAPI: jest.fn() }));
jest.mock('@jupyterlab/apputils', () => ({
  ...jest.requireActual('@jupyterlab/apputils'),
  showDialog: jest.fn(),
  showErrorMessage: jest.fn()
}));

import { Dialog, showDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import type { Contents } from '@jupyterlab/services';
import { nullTranslator } from '@jupyterlab/translation';
import type { Widget } from '@lumino/widgets';

import {
  deleteButtons,
  deleteItems,
  notRemoved,
  percent,
  progressTitle
} from '../deleteDialog';
import type { TreeFileBrowserModel } from '../model';
import { requestAPI } from '../request';

const trans = nullTranslator.load('jupyterlab');

/** A model with no running sessions and no open documents. */
const model = {
  manager: {
    services: {
      contents: { localPath: (path: string) => path },
      serverSettings: {},
      sessions: { refreshRunning: async () => undefined, running: () => [] }
    }
  },
  refresh: jest.fn(async () => undefined)
} as unknown as TreeFileBrowserModel;
const items = [{ name: 'a.txt', path: 'a.txt' }] as Contents.IModel[];
const NOT_MONITORED =
  'The trash of this location is not monitored, so Move to Trash is not offered';
const UNREAD =
  'The progress of the removal could not be read; it may still be running. Refresh the listing to see what was removed';

/** The texts of the warning lines in the Delete dialog's body. */
function warnings({ body }: Dialog.IOptions<unknown>): (string | null)[] {
  return Array.from(
    (body as Widget).node.querySelectorAll(
      '.jp-AdvancedFileBrowser-deleteWarning'
    ),
    line => line.textContent
  );
}

/**
 * The options of the Delete dialog of `items` with the trash on and the trash check
 * answering `monitored`; the dialog is cancelled.
 */
async function deleteDialog(
  monitored: boolean
): Promise<Dialog.IOptions<unknown>> {
  PageConfig.setOption('delete_to_trash', 'true');
  (requestAPI as jest.Mock).mockImplementation(async (endPoint: string) =>
    endPoint === 'delete/trash-check'
      ? { monitored: items.map(() => monitored) }
      : { over: false }
  );
  (showDialog as jest.Mock).mockResolvedValue({ button: { accept: false } });
  await deleteItems(model, items, trans);
  return (showDialog as jest.Mock).mock.calls[0][0];
}

describe('deleteButtons', () => {
  it('offers Cancel, Delete Permanently and Move to Trash with the trash on, Move to Trash the default', () => {
    const { buttons, defaultButton } = deleteButtons(true, trans);

    expect(
      buttons.map(({ label, accept, displayType }) => ({
        label,
        accept,
        displayType
      }))
    ).toEqual([
      { label: 'Cancel', accept: false, displayType: 'default' },
      { label: 'Delete Permanently', accept: true, displayType: 'warn' },
      { label: 'Move to Trash', accept: true, displayType: 'default' }
    ]);
    expect(buttons[defaultButton].label).toBe('Move to Trash');
  });

  it('offers Cancel and Delete Permanently with the trash on but not monitored, Cancel the default', () => {
    const { buttons, defaultButton } = deleteButtons(true, trans, false);

    expect(
      buttons.map(({ label, accept, displayType }) => ({
        label,
        accept,
        displayType
      }))
    ).toEqual([
      { label: 'Cancel', accept: false, displayType: 'default' },
      { label: 'Delete Permanently', accept: true, displayType: 'warn' }
    ]);
    expect(buttons[defaultButton].label).toBe('Cancel');
  });

  it('offers the stock Cancel and Delete with the trash off, Cancel the default', () => {
    const { buttons, defaultButton } = deleteButtons(false, trans);

    expect(
      buttons.map(({ label, accept, displayType }) => ({
        label,
        accept,
        displayType
      }))
    ).toEqual([
      { label: 'Cancel', accept: false, displayType: 'default' },
      { label: 'Delete', accept: true, displayType: 'warn' }
    ]);
    expect(buttons[defaultButton].label).toBe('Cancel');
  });
});

describe('deleteItems', () => {
  beforeEach(() => jest.clearAllMocks());

  it('titles the Delete dialog Delete with the trash on', async () => {
    expect((await deleteDialog(true)).title).toBe('Delete');
  });

  it('says in one warning line that the trash is not monitored when no selected item is', async () => {
    expect(warnings(await deleteDialog(false))).toEqual([NOT_MONITORED]);
  });

  it('shows no such line when the selection is monitored', async () => {
    expect(warnings(await deleteDialog(true))).toEqual([]);
  });
});

/**
 * Run Delete on `selected` with the trash check answering `monitored`, pressing `first` in
 * the Delete dialog and `second` in a second dialog; every job runs at once and ends at its
 * first poll. Returns the POST bodies of the jobs started.
 */
async function deleteMixed(
  selected: Contents.IModel[],
  monitored: boolean[],
  first: string,
  second: string
): Promise<{ paths: string[]; trash: boolean }[]> {
  PageConfig.setOption('delete_to_trash', 'true');
  (requestAPI as jest.Mock).mockImplementation(async (endPoint: string) => {
    switch (endPoint) {
      case 'delete/trash-check':
        return { monitored };
      case 'delete/size':
        return { over: false };
      case 'delete':
        return { id: 'job' };
      default:
        return { total: 1, removed: 1, done: true, errors: [] };
    }
  });
  // mockReset, not clearAllMocks, drops an answer an earlier case left unused.
  (showDialog as jest.Mock)
    .mockReset()
    .mockResolvedValueOnce({
      button: deleteButtons(true, trans).buttons.find(
        ({ label }) => label === first
      )
    })
    .mockResolvedValueOnce({
      button: deleteButtons(true, trans, false).buttons.find(
        ({ label }) => label === second
      )
    });
  await deleteItems(model, selected, trans);
  return (requestAPI as jest.Mock).mock.calls
    .filter(([endPoint]) => endPoint === 'delete')
    .map(([, , init]) => JSON.parse(init.body));
}

describe('a selection with monitored and unmonitored items', () => {
  const mixed = [
    { name: 'a.txt', path: 'a.txt' },
    { name: 'b.txt', path: 'nfs/b.txt' }
  ] as Contents.IModel[];
  const labels = ({ buttons }: Dialog.IOptions<unknown>) =>
    buttons!.map(({ label }) => label);

  beforeEach(() => jest.clearAllMocks());

  it('offers Cancel, Delete Permanently and Move to Trash, and one line with the count of the unmonitored items', async () => {
    expect(await deleteMixed(mixed, [true, false], 'Cancel', 'Cancel')).toEqual(
      []
    );

    const options = (showDialog as jest.Mock).mock.calls[0][0];
    expect(labels(options)).toEqual([
      'Cancel',
      'Delete Permanently',
      'Move to Trash'
    ]);
    expect(warnings(options)).toEqual([
      '1 selected item is on a location whose trash is not monitored; after Move to Trash you are asked to delete it permanently'
    ]);
    expect(showDialog).toHaveBeenCalledTimes(1);
  });

  it('Move to Trash moves the monitored item, then a second dialog asks to delete the other permanently, Cancel the default', async () => {
    expect(
      await deleteMixed(mixed, [true, false], 'Move to Trash', 'Cancel')
    ).toEqual([{ paths: ['a.txt'], trash: true }]);

    const options = (showDialog as jest.Mock).mock.calls[1][0];
    expect(options.body).toBe(
      'This item was not moved to the trash, because the trash of its location is not monitored: nfs/b.txt. Delete it permanently?'
    );
    expect(labels(options)).toEqual(['Cancel', 'Delete Permanently']);
    expect(labels(options)[options.defaultButton]).toBe('Cancel');
  });

  it('Delete Permanently in the second dialog removes the other item permanently', async () => {
    expect(
      await deleteMixed(
        mixed,
        [true, false],
        'Move to Trash',
        'Delete Permanently'
      )
    ).toEqual([
      { paths: ['a.txt'], trash: true },
      { paths: ['nfs/b.txt'], trash: false }
    ]);
  });

  it('Delete Permanently in the Delete dialog removes every item in one job, with no second dialog', async () => {
    expect(
      await deleteMixed(mixed, [true, false], 'Delete Permanently', 'Cancel')
    ).toEqual([{ paths: ['a.txt', 'nfs/b.txt'], trash: false }]);
    expect(showDialog).toHaveBeenCalledTimes(1);
  });

  it('counts the other items in the first dialog, and names at most 10 of them in the second, then the count of the rest', async () => {
    const selected = Array.from({ length: 13 }, (_, i) => ({
      name: `f${i}`,
      path: `nfs/f${i}`
    })) as Contents.IModel[];

    await deleteMixed(
      selected,
      selected.map((_, i) => i === 0),
      'Move to Trash',
      'Cancel'
    );

    expect(warnings((showDialog as jest.Mock).mock.calls[0][0])).toEqual([
      '12 of the selected items are on a location whose trash is not monitored; after Move to Trash you are asked to delete them permanently'
    ]);
    expect((showDialog as jest.Mock).mock.calls[1][0].body).toBe(
      `These 12 items were not moved to the trash, because the trash of their location is not monitored: ${selected
        .slice(1, 11)
        .map(({ path }) => path)
        .join('; ')}; and 2 more. Delete them permanently?`
    );
  });
});

/**
 * Answer a removal confirmed now with `label` on a monitored selection: the job starts
 * `startMs` after the confirm and is done from `endMs` after the confirm, reporting `errors`.
 * Returns the times of the job polls, counted from the start.
 */
function serveRemoval(
  label: 'Move to Trash' | 'Delete Permanently',
  startMs: number,
  endMs: number,
  errors: { path: string; message: string }[] = []
): number[] {
  const confirmed = Date.now();
  const polls: number[] = [];
  PageConfig.setOption('delete_to_trash', 'true');
  (requestAPI as jest.Mock).mockImplementation(async (endPoint: string) => {
    switch (endPoint) {
      case 'delete/trash-check':
        return { monitored: [true] };
      case 'delete/size':
        return { over: false };
      case 'delete':
        await new Promise(resolve => setTimeout(resolve, startMs));
        return { id: 'job' };
      default: {
        const now = Date.now() - confirmed;
        polls.push(now - startMs);
        return { total: 1, removed: 0, done: now >= endMs, errors };
      }
    }
  });
  (showDialog as jest.Mock).mockResolvedValue({
    button: deleteButtons(true, trans).buttons.find(
      button => button.label === label
    )
  });
  return polls;
}

describe('the removal', () => {
  const progress = () =>
    document.querySelector('.jp-AdvancedFileBrowser-deleteDialog');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  it('keeps the progress dialog 500 ms once shown: a removal ending 1.1 s after the confirm keeps it until 1.5 s', async () => {
    serveRemoval('Delete Permanently', 850, 1100);
    const run = deleteItems(model, items, trans);

    await jest.advanceTimersByTimeAsync(999);
    expect(progress()).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(progress()).not.toBeNull();
    await jest.advanceTimersByTimeAsync(499);
    expect(progress()).not.toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(progress()).toBeNull();
    await run;
  });

  it.each(['Move to Trash', 'Delete Permanently'] as const)(
    '%s asks for the job state at once, then every 250 ms',
    async label => {
      const polls = serveRemoval(label, 0, 500);
      const run = deleteItems(model, items, trans);

      await jest.advanceTimersByTimeAsync(500);
      await run;

      const start = (requestAPI as jest.Mock).mock.calls.find(
        ([endPoint]) => endPoint === 'delete'
      );
      expect(JSON.parse(start[2].body).trash).toBe(label === 'Move to Trash');
      expect(polls).toEqual([0, 250, 500]);
    }
  );

  it('closes the progress dialog on Hide, also on the second press of a double-click at its raise, and the removal goes on', async () => {
    const polls = serveRemoval('Delete Permanently', 0, 2000);
    const run = deleteItems(model, items, trans);
    await jest.advanceTimersByTimeAsync(1000);
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      detail: 2
    });
    // As in a browser, the event time is on the clock of performance.now()
    Object.defineProperty(press, 'timeStamp', { value: performance.now() });

    progress()!.querySelector('.jp-Dialog-button')!.dispatchEvent(press);

    expect(progress()).toBeNull();
    await jest.advanceTimersByTimeAsync(1000);
    await run;
    expect(polls[polls.length - 1]).toBe(2000);
    expect(model.refresh).toHaveBeenCalled();
    expect(progress()).toBeNull();
  });
});

describe('the Delete Failed message', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names each path the server reports with its reason, the path once', async () => {
    serveRemoval('Delete Permanently', 0, 0, [
      { path: 'a/ro/f', message: 'permission denied' }
    ]);

    await deleteItems(model, items, trans);

    expect(showErrorMessage).toHaveBeenCalledWith(
      'Delete Failed',
      'Not removed: a/ro/f: permission denied'
    );
  });

  it('names each selected path with reason unknown when the start fails, never its message', async () => {
    serveRemoval('Move to Trash', 0, 0);
    const answer = (requestAPI as jest.Mock).getMockImplementation()!;
    (requestAPI as jest.Mock).mockImplementation(
      async (endPoint: string, ...rest: unknown[]) => {
        if (endPoint === 'delete') {
          throw new Error(
            "send2trash failed: Couldn't find mount point for /srv/a.txt"
          );
        }
        return answer(endPoint, ...rest);
      }
    );

    await deleteItems(model, items, trans);

    expect(showErrorMessage).toHaveBeenCalledWith(
      'Delete Failed',
      'Not removed: a.txt: reason unknown'
    );
  });

  it('names no path when a progress request fails after the start, and the polling stops', async () => {
    serveRemoval('Delete Permanently', 0, 0);
    const answer = (requestAPI as jest.Mock).getMockImplementation()!;
    const error = new Error('502 Bad Gateway');
    (requestAPI as jest.Mock).mockImplementation(
      async (endPoint: string, ...rest: unknown[]) => {
        if (endPoint === 'delete/job') {
          throw error;
        }
        return answer(endPoint, ...rest);
      }
    );
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await deleteItems(model, items, trans);

    expect(warn).toHaveBeenCalledWith(
      '[jupyterlab_advanced_file_browser_extension] delete progress could not be read',
      error
    );
    warn.mockRestore();
    expect(showErrorMessage).toHaveBeenCalledWith('Delete', UNREAD);
    expect(
      (requestAPI as jest.Mock).mock.calls.filter(
        ([endPoint]) => endPoint === 'delete/job'
      )
    ).toHaveLength(1);
    expect(model.refresh).toHaveBeenCalled();
  });

  it('collects both jobs of a mixed selection', async () => {
    const mixed = [
      { name: 'a.txt', path: 'a.txt' },
      { name: 'b.txt', path: 'nfs/b.txt' }
    ] as Contents.IModel[];
    PageConfig.setOption('delete_to_trash', 'true');
    (requestAPI as jest.Mock).mockImplementation(
      async (endPoint: string, _settings: unknown, init?: RequestInit) => {
        switch (endPoint) {
          case 'delete/trash-check':
            return { monitored: [true, false] };
          case 'delete/size':
            return { over: false };
          case 'delete':
            return {
              id: JSON.parse(init!.body as string).trash ? 'trash' : 'rm'
            };
          case 'delete/trash':
            throw new Error('502 Bad Gateway');
          default:
            return {
              total: 1,
              removed: 0,
              done: true,
              errors: [{ path: 'nfs/b.txt', message: 'permission denied' }]
            };
        }
      }
    );
    (showDialog as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ button: deleteButtons(true, trans).buttons[2] })
      .mockResolvedValueOnce({
        button: deleteButtons(true, trans, false).buttons[1]
      });

    await deleteItems(model, mixed, trans);

    expect(showErrorMessage).toHaveBeenCalledWith(
      'Delete Failed',
      `Not removed: nfs/b.txt: permission denied. ${UNREAD}`
    );
  });
});

describe('percent', () => {
  it('is 0 while the total is unknown', () => {
    expect(percent(0, 0)).toBe(0);
  });

  it('rounds down, so 100 shows only when everything is done', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(1999, 2000)).toBe(99);
    expect(percent(2000, 2000)).toBe(100);
  });

  it('stays at 100 when the tree grew after the count', () => {
    expect(percent(2011, 2000)).toBe(100);
  });
});

describe('progressTitle', () => {
  it('names the action and the item count', () => {
    expect(progressTitle(true, 3, trans)).toBe('Moving 3 items to the trash');
    expect(progressTitle(true, 1, trans)).toBe('Moving 1 item to the trash');
    expect(progressTitle(false, 3, trans)).toBe('Deleting 3 items');
    expect(progressTitle(false, 1, trans)).toBe('Deleting 1 item');
  });
});

describe('notRemoved', () => {
  const failed = (count: number) =>
    Array.from({ length: count }, (_, i) => `a/f${i}: Permission denied`);

  it('names at most 10 paths, then the count of the rest', () => {
    const message = notRemoved(failed(25), trans);

    expect(message.match(/a\/f\d+:/g)).toEqual(
      failed(10).map(line => line.split(' ')[0])
    );
    expect(message).toMatch(/; and 15 more$/);
  });

  it('names every path up to 10 and counts one more past them', () => {
    expect(notRemoved(failed(10), trans)).toBe(
      `Not removed: ${failed(10).join('; ')}`
    );
    expect(notRemoved(failed(11), trans)).toBe(
      `Not removed: ${failed(10).join('; ')}; and 1 more`
    );
  });
});
