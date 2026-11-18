import * as dialog from '@jupyterlab/apputils/lib/dialog';
import { PathExt } from '@jupyterlab/coreutils';
import { DocumentManager } from '@jupyterlab/docmanager';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DocumentWidgetOpenerMock } from '@jupyterlab/docregistry/lib/testutils';
import { DirListing } from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';
import { ServiceManagerMock } from '@jupyterlab/services/lib/testutils';
import { nullTranslator } from '@jupyterlab/translation';
import type { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import { outermost, TreeDirListing, treeOrder } from '../listing';
import { TreeFileBrowserModel } from '../model';

function row(
  path: string,
  type: string,
  lastModified = '2026-01-01T00:00:00.000Z'
): Contents.IModel {
  return {
    path,
    name: PathExt.basename(path),
    type,
    writable: true,
    created: lastModified,
    last_modified: lastModified,
    mimetype: '',
    content: null,
    format: null
  };
}

/**
 * JupyterLab's own sort of a flat list of rows, without a widget.
 */
function stockSort(
  items: Contents.IModel[],
  state: DirListing.ISortState,
  notebooksFirst = false
): Contents.IModel[] {
  const listing = {
    model: { items: () => items[Symbol.iterator]() },
    translator: nullTranslator,
    _sortNotebooksFirst: notebooksFirst,
    _sortFileNamesNaturally: true,
    _sortedItems: [] as Contents.IModel[],
    update: () => undefined,
    _saveState: () => undefined
  };
  DirListing.prototype.sort.call(listing as unknown as DirListing, state);
  return listing._sortedItems;
}

const paths = (items: Iterable<Contents.IModel>) =>
  Array.from(items, item => item.path);

const selection = (listing: TreeDirListing) =>
  (listing as unknown as { selection: Record<string, boolean> }).selection;

describe('treeOrder', () => {
  it('ACC-UNFOLD-17-SORTHEAD treeOrder keeps the Last Modified descending order inside each level', () => {
    // Dates run against the names in both directions, so a name order cannot pass for the date order.
    const top = [
      row('a', 'directory', '2026-01-03T00:00:00.000Z'),
      row('b', 'directory', '2026-01-05T00:00:00.000Z'),
      row('c', 'directory', '2026-01-01T00:00:00.000Z'),
      row('w.txt', 'file', '2026-01-06T00:00:00.000Z'),
      row('x.txt', 'file', '2026-01-02T00:00:00.000Z'),
      row('y.txt', 'file', '2026-01-04T00:00:00.000Z')
    ];
    const inA = [
      row('a/c', 'directory', '2026-01-01T00:00:00.000Z'),
      row('a/d', 'directory', '2026-01-06T00:00:00.000Z'),
      row('a/e', 'directory', '2026-01-03T00:00:00.000Z'),
      row('a/p.txt', 'file', '2026-01-07T00:00:00.000Z'),
      row('a/q.txt', 'file', '2026-01-01T00:00:00.000Z'),
      row('a/r.txt', 'file', '2026-01-04T00:00:00.000Z')
    ];
    const state: DirListing.ISortState = {
      direction: 'descending',
      key: 'last_modified'
    };

    const topOrder = paths(stockSort(top, state));
    const aOrder = paths(stockSort(inA, state));
    expect(topOrder).not.toEqual(
      paths(stockSort(top, { ...state, key: 'name' }))
    );
    expect(aOrder).not.toEqual(
      paths(stockSort(inA, { ...state, key: 'name' }))
    );

    const result = paths(treeOrder(stockSort([...inA, ...top], state), ''));

    const expected: string[] = [];
    for (const path of topOrder) {
      expected.push(path);
      if (path === 'a') {
        expected.push(...aOrder);
      }
    }
    expect(result).toEqual(expected);
  });

  it('ACC-UNFOLD-18-NBFIRST notebooks precede files inside an unfolded folder', () => {
    const items = [
      row('z.txt', 'file'),
      row('a', 'directory'),
      row('a/m.txt', 'file'),
      row('a/n.ipynb', 'notebook')
    ];
    const state: DirListing.ISortState = {
      direction: 'ascending',
      key: 'name'
    };

    expect(
      paths(treeOrder(stockSort(items, state, true), '')).slice(0, 3)
    ).toEqual(['a', 'a/n.ipynb', 'a/m.txt']);
    expect(
      paths(treeOrder(stockSort(items, state, false), '')).slice(0, 3)
    ).toEqual(['a', 'a/m.txt', 'a/n.ipynb']);
  });

  it('drops a row whose folder is not listed', () => {
    expect(
      paths(treeOrder([row('a/x.txt', 'file'), row('b.txt', 'file')], ''))
    ).toEqual(['b.txt']);
  });
});

describe('outermost', () => {
  it('ACC-NESTED-77-OUTERMOST drops each path below another selected path', () => {
    expect(outermost(['a', 'a/x.txt', 'b', 'ab'])).toEqual(['a', 'b', 'ab']);
  });
});

describe('TreeFileBrowserModel', () => {
  let model: TreeFileBrowserModel;
  let listing: TreeDirListing;

  beforeEach(async () => {
    const services = new ServiceManagerMock();
    await services.contents.save('a', { type: 'directory' });
    await services.contents.save('a/x.txt', { type: 'file' });
    await services.contents.save('a/y.txt', { type: 'file' });
    await services.contents.save('b.txt', { type: 'file' });
    const manager = new DocumentManager({
      registry: new DocumentRegistry(),
      opener: new DocumentWidgetOpenerMock(),
      // The mock comes from @jupyterlab/services 7.6.5, docmanager types against its own 7.6.6 copy.
      manager: services as unknown as DocumentManager.IOptions['manager']
    });
    model = new TreeFileBrowserModel({
      manager,
      unfolding: true,
      auto: false,
      refreshStandby: 'never'
    });
    listing = new TreeDirListing({ model, translator: nullTranslator });
    await model.cd('/');
  });

  afterEach(() => {
    listing.dispose();
    model.dispose();
  });

  it('ACC-COMPAT-73-ITEMS sortedItems holds nested rows in screen order', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);

    expect(paths(listing.sortedItems())).toEqual([
      'a',
      'a/x.txt',
      'a/y.txt',
      'b.txt'
    ]);

    await model.toggle('a');
    listing.sort(listing.sortState);

    expect(paths(listing.sortedItems())).toEqual(['a', 'b.txt']);
  });

  it('DEF-NESTED-12-SELECTION-SIGNAL copy emits selectionChanged when it drops nested rows', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    const selection = (
      listing as unknown as { selection: Record<string, boolean> }
    ).selection;
    selection['a'] = true;
    selection['a/x.txt'] = true;
    let emitted = 0;
    listing.selectionChanged.connect(() => emitted++);

    listing.copy();

    expect(Object.keys(selection)).toEqual(['a']);
    expect(emitted).toBe(1);

    listing.copy();

    expect(emitted).toBe(1);
  });

  it('DEF-FOLDER-15-PATH-HELD Paste beside leaves the current folder free during the copy', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    (listing as unknown as { selection: Record<string, boolean> }).selection[
      'a'
    ] = true;
    listing.copy();
    model.setCurrentFolder('a');
    let finish: (value: Contents.IModel) => void = () => undefined;
    const copy = jest
      .spyOn(model.manager, 'copy')
      .mockImplementation(() => new Promise(resolve => (finish = resolve)));

    const pasted = listing.paste();
    model.setCurrentFolder('b');

    expect(model.path).toBe('b');
    expect(copy.mock.calls).toEqual([['a', '']]);

    finish(row('a-Copy1', 'directory'));
    await pasted;
  });

  it('DEF-FOLDER-23-FILEROW Paste of the current folder from a file row inside it reports Paste Error', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    const internals = listing as unknown as {
      selection: Record<string, boolean>;
    };
    const copy = jest
      .spyOn(model.manager, 'copy')
      .mockResolvedValue(row('a-Copy1', 'directory'));
    const rename = jest.spyOn(model.manager, 'rename');
    const showError = jest
      .spyOn(dialog, 'showErrorMessage')
      .mockResolvedValue(undefined);
    const message = [
      'Paste Error',
      'Cannot paste "a" into itself or a folder inside it'
    ];

    for (const take of [() => listing.copy(), () => listing.cut()]) {
      showError.mockClear();
      listing.clearSelectedItems();
      internals.selection['a'] = true;
      take();
      listing.clearSelectedItems();
      internals.selection['a/x.txt'] = true;
      model.setCurrentFolder('a');

      await listing.paste();

      expect(copy).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(showError.mock.calls).toEqual([message]);
    }
    showError.mockRestore();
  });

  it('DEF-FOLDER-19-CLIPBOARD-RETRY a failed Paste beside puts the folder back on the clipboard', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    const internals = listing as unknown as {
      selection: Record<string, boolean>;
      _clipboard: string[];
    };
    internals.selection['a'] = true;
    listing.copy();
    model.setCurrentFolder('a');
    let fail: (error: Error) => void = () => undefined;
    jest
      .spyOn(model.manager, 'copy')
      .mockImplementation(() => new Promise((_, reject) => (fail = reject)));

    let pasted = listing.paste();
    fail(new Error('Permission denied'));
    await pasted;

    expect(internals._clipboard).toEqual(['a']);

    // A Copy between the paste and the failure keeps the newer clipboard.
    pasted = listing.paste();
    listing.clearSelectedItems();
    internals.selection['b.txt'] = true;
    listing.copy();
    fail(new Error('Permission denied'));
    await pasted;

    expect(internals._clipboard).toEqual(['b.txt']);
  });

  it('ACC-FOLDER-88-CLIPRETAIN a folder skipped from Paste stays on the clipboard', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    await model.manager.services.contents.save('c', { type: 'directory' });
    await model.refresh();
    const internals = listing as unknown as {
      selection: Record<string, boolean>;
      _clipboard: string[];
      _isCut: boolean;
    };
    const copy = jest
      .spyOn(model.manager, 'copy')
      .mockResolvedValue(row('c/a', 'directory'));
    const rename = jest
      .spyOn(model.manager, 'rename')
      .mockResolvedValue(row('c/a', 'directory'));
    const showError = jest
      .spyOn(dialog, 'showErrorMessage')
      .mockResolvedValue(undefined);
    const message = [
      'Paste Error',
      'Cannot paste "a" into itself or a folder inside it'
    ];

    for (const isCut of [false, true]) {
      showError.mockClear();
      copy.mockClear();
      rename.mockClear();
      listing.clearSelectedItems();
      internals.selection['a'] = true;
      if (isCut) {
        listing.cut();
      } else {
        listing.copy();
      }
      listing.clearSelectedItems();
      model.setCurrentFolder('a');

      await listing.paste();

      expect(copy).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(showError.mock.calls).toEqual([message]);
      expect(internals._clipboard).toEqual(['a']);
      expect(internals._isCut).toBe(isCut);

      model.setCurrentFolder('c');
      await listing.paste();

      expect(copy.mock.calls).toEqual(isCut ? [] : [['a', 'c']]);
      expect(rename.mock.calls).toEqual(isCut ? [['a', 'c/a']] : []);
    }
    showError.mockRestore();
  });

  it('DEF-FOLDER-25-CLIPBOARD-EPOCH a Copy during a pending Paste keeps the newer clipboard', async () => {
    await model.toggle('a');
    listing.sort(listing.sortState);
    const internals = listing as unknown as {
      selection: Record<string, boolean>;
      _clipboard: string[];
      _isCut: boolean;
      _clipboardRevision?: number;
    };
    const showError = jest
      .spyOn(dialog, 'showErrorMessage')
      .mockResolvedValue(undefined);
    internals.selection['a'] = true;
    listing.copy();
    listing.clearSelectedItems();
    model.setCurrentFolder('a');
    // Shipped JupyterLab 4.6.5 has no stock _clipboardRevision.
    internals._clipboardRevision = undefined;

    const pasted = listing.paste();
    internals.selection['b.txt'] = true;
    listing.copy();
    // 4.6.6's _copy() increments the absent field to NaN; 4.6.5 leaves it absent.
    internals._clipboardRevision = undefined;
    await pasted;

    expect(internals._clipboard).toEqual(['b.txt']);
    expect(internals._isCut).toBe(false);
    showError.mockRestore();
  });

  it('ACC-UNFOLD-21-FILTER items keeps each folder on the path to a match', async () => {
    await model.toggle('a');
    model.setFilter(item => (item.name.startsWith('x') ? {} : null));
    await model.refresh();

    expect(paths(model.items())).toEqual(['a', 'a/x.txt']);
  });

  it('ACC-FOLDER-29-CLICKDIR current folder is separate from the top folder', async () => {
    await model.toggle('a');
    model.setCurrentFolder('a');

    expect(model.path).toBe('a');
    expect(model.topPath).toBe('');
    expect(model.depth('a/x.txt')).toBe(1);

    model.unfolding = false;

    expect(model.path).toBe('');
    await model.refresh();
  });

  describe('ACC-FOLDER-158-NEW-INSTANT a change shows from the server answer', () => {
    /** The contents manager's change signal, as a create or a rename answer emits it. */
    const answer = (change: Contents.IChangedArgs): void =>
      (
        model.manager.services.contents.fileChanged as Signal<
          Contents.IManager,
          Contents.IChangedArgs
        >
      ).emit(change);

    /**
     * Listing reads held until released or the case ends, so a row can come from the answer
     * only; each answers with the contents the server had when it was sent.
     */
    const held: (() => void)[] = [];
    /** The folder of each held read, by index. */
    const heldPaths: string[] = [];
    let get: Contents.IManager['get'] | null = null;
    const holdReads = () => {
      const contents = model.manager.services.contents;
      const original = contents.get;
      get = original;
      contents.get = (path, options) => {
        const answered = original.call(contents, path, options);
        heldPaths.push(path);
        return new Promise(resolve => held.push(() => resolve(answered)));
      };
    };

    /** Wait until `count` listing reads are held. */
    const reads = async (count: number) => {
      while (held.length < count) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };

    /** Release the held reads `start` to `end` and let the model apply them. */
    const release = async (start: number, end: number) => {
      held.slice(start, end).forEach(read => read());
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    /** Release the held reads of `folder` only and let the model apply them. */
    const releaseOf = async (folder: string) => {
      held.filter((_, i) => heldPaths[i] === folder).forEach(read => read());
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    /** Whether `promise` settles within 100 ms. */
    const settles = (promise: Promise<void>) =>
      Promise.race([
        promise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))
      ]);

    beforeEach(() => {
      // A visible listing re-sorts on the model's refreshed signal, as in the lab.
      Widget.attach(listing, document.body);
    });

    afterEach(async () => {
      // The re-reads end before the model is disposed.
      if (get) {
        model.manager.services.contents.get = get;
        get = null;
      }
      held.splice(0).forEach(release => release());
      heldPaths.splice(0);
      await model.refresh();
    });

    it('a new item shows in its sorted place in the top folder and in an unfolded folder', async () => {
      await model.toggle('a');
      holdReads();

      answer({ type: 'new', oldValue: null, newValue: row('a/b.txt', 'file') });
      answer({ type: 'new', oldValue: null, newValue: row('aa', 'directory') });

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/b.txt',
        'a/x.txt',
        'a/y.txt',
        'aa',
        'b.txt'
      ]);
    });

    it('a rename shows the new name in its sorted place in the top folder and in an unfolded folder', async () => {
      await model.toggle('a');
      holdReads();

      answer({
        type: 'rename',
        oldValue: { path: 'b.txt' },
        newValue: row('0.txt', 'file')
      });
      answer({
        type: 'rename',
        oldValue: { path: 'a/y.txt' },
        newValue: row('a/w.txt', 'file')
      });

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/w.txt',
        'a/x.txt',
        '0.txt'
      ]);
    });

    it('an item of a folder that is not listed adds no row', async () => {
      await model.toggle('a');
      holdReads();

      answer({ type: 'new', oldValue: null, newValue: row('c/n.txt', 'file') });

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/x.txt',
        'a/y.txt',
        'b.txt'
      ]);
    });

    it('a listed new row in the current folder is selected at the answer, and a focused select waits for the read of its own folder only', async () => {
      await model.toggle('a');
      model.setCurrentFolder('a');
      holdReads();

      const created = await model.manager.services.contents.newUntitled({
        path: 'a',
        type: 'file'
      });

      expect(await settles(listing.selectItemByName(created.name))).toBe(true);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
      // A create's select before its rename editor opens.
      const focused = listing.selectItemByName(created.name, true);
      expect(await settles(focused)).toBe(false);
      // The reads of the top folder stay held.
      await releaseOf('a');
      expect(await settles(focused)).toBe(true);
      expect(heldPaths).toEqual(['a']);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
    });

    it('a create in the top folder is selected after the read of the top folder, with the reads of the unfolded folder held', async () => {
      await model.toggle('a');
      holdReads();

      const created = await model.manager.services.contents.newUntitled({
        path: '',
        type: 'directory'
      });
      const focused = listing.selectItemByName(created.name, true);
      expect(await settles(focused)).toBe(false);
      await releaseOf('');

      expect(await settles(focused)).toBe(true);
      expect(heldPaths).toEqual(['']);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/x.txt',
        'a/y.txt',
        created.path,
        'b.txt'
      ]);
    });

    it("a create's change signal with loaded unfolded folders reads only the new item's folder", async () => {
      await model.toggle('a');
      holdReads();
      // The refresh each answer asks for runs on a later tick of the poll.
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));

      const top = await model.manager.services.contents.newUntitled({
        path: '',
        type: 'directory'
      });
      await settle();
      expect(heldPaths).toEqual(['']);
      await release(0, 1);
      const nested = await model.manager.services.contents.newUntitled({
        path: 'a',
        type: 'file'
      });
      await settle();
      expect(heldPaths).toEqual(['', 'a']);
      await release(1, 2);

      expect(heldPaths).toEqual(['', 'a']);
      expect(paths(listing.sortedItems())).toEqual([
        'a',
        nested.path,
        'a/x.txt',
        'a/y.txt',
        top.path,
        'b.txt'
      ]);
    });

    it("a refresh asked for just before or just after a create's answer still reads the whole tree", async () => {
      await model.toggle('a');
      holdReads();
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));

      // Asked for before the answer: its tick runs during the create's read.
      void model.refresh();
      answer({ type: 'new', oldValue: null, newValue: row('a/n.txt', 'file') });
      await settle();
      expect(heldPaths).toEqual(['a', '', 'a']);
      await release(0, 3);
      await settle();

      // Asked for after the answer, while the tick the create asked for is pending.
      answer({ type: 'new', oldValue: null, newValue: row('a/m.txt', 'file') });
      void model.refresh();
      await settle();
      expect(heldPaths).toEqual(['a', '', 'a', 'a', '', 'a']);
    });

    it("a refresh asked for while a create's tick runs its joined read reads the whole tree after that read", async () => {
      await model.toggle('a');
      holdReads();
      const contents = model.manager.services.contents;
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));
      // Removed at the server without a change signal, as the extension's Delete job does.
      const signal = contents.fileChanged as unknown as {
        emit: (change: unknown) => void;
      };
      const emit = signal.emit;
      signal.emit = () => undefined;
      await contents.delete('a/x.txt');
      signal.emit = emit;
      await contents.newUntitled({ path: '', type: 'directory' });
      // The tick the create asked for runs and joins the create's read of the top folder.
      await settle();
      expect(heldPaths).toEqual(['']);

      const refreshing = model.refresh();
      await release(0, 1);
      expect(await settles(refreshing)).toBe(false);
      await reads(3);
      expect(heldPaths).toEqual(['', '', 'a']);
      await release(1, 3);

      expect(await settles(refreshing)).toBe(true);
      expect(paths(listing.sortedItems())).not.toContain('a/x.txt');
    });

    it('five new items answered into an unfolded folder during its create read give one queued read of it, which the last select waits for', async () => {
      await model.toggle('a');
      model.setCurrentFolder('a');
      holdReads();
      const contents = model.manager.services.contents;
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));
      // The 'new' answers of a Paste of five copies, while the first create read of a is held.
      const pasted: string[] = [];
      for (let i = 0; i < 5; i++) {
        pasted.push(
          (await contents.newUntitled({ path: 'a', type: 'file' })).path
        );
      }
      const focused = listing.selectItemByName(
        PathExt.basename(pasted[4]),
        true
      );
      await settle();
      // The focused select starts the queued read at once.
      expect(heldPaths).toEqual(['a', 'a']);

      await release(0, 1);
      await reads(2);
      expect(heldPaths).toEqual(['a', 'a']);
      expect(await settles(focused)).toBe(false);
      await release(1, 2);

      expect(await settles(focused)).toBe(true);
      await settle();
      expect(heldPaths).toEqual(['a', 'a']);
      expect(paths(listing.sortedItems())).toEqual(
        expect.arrayContaining(pasted)
      );
      expect(Object.keys(selection(listing))).toEqual([pasted[4]]);
    });

    it('a New Folder answered during a Paste read of its unfolded folder is selected after one read that started after its answer, with the Paste read still held', async () => {
      await model.toggle('a');
      model.setCurrentFolder('a');
      holdReads();
      const contents = model.manager.services.contents;
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));
      // The first Paste copy starts the read of a; the two answered while it is held queue one read.
      const pasted: string[] = [];
      for (let i = 0; i < 3; i++) {
        pasted.push(
          (await contents.newUntitled({ path: 'a', type: 'file' })).path
        );
      }
      await settle();
      expect(heldPaths).toEqual(['a']);

      // New Folder: its answer while the Paste read is held, then its select before the rename editor.
      const created = await contents.newUntitled({
        path: 'a',
        type: 'directory'
      });
      const focused = listing.selectItemByName(created.name, true);
      await settle();
      expect(heldPaths).toEqual(['a', 'a']);
      await release(1, 2);

      expect(await settles(focused)).toBe(true);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
      await release(0, 1);
      await settle();
      expect(heldPaths).toEqual(['a', 'a']);
      expect(paths(listing.sortedItems())).toEqual(
        expect.arrayContaining([...pasted, created.path])
      );
    });

    it('DEF-FOLDER-39-PASTE-READ Paste answers into a during its create read join it after a create in the top folder was answered, and the top create is selected after its own read', async () => {
      await model.toggle('a');
      holdReads();
      const contents = model.manager.services.contents;
      const settle = () => new Promise(resolve => setTimeout(resolve, 20));
      // The Paste answers into a: the first starts a read of a, the next two queue one read.
      const pasted: string[] = [];
      for (let i = 0; i < 3; i++) {
        pasted.push(
          (await contents.newUntitled({ path: 'a', type: 'file' })).path
        );
      }
      await settle();
      expect(heldPaths).toEqual(['a']);

      // A New Folder in the top folder: its own read, and its select before the rename editor.
      const created = await contents.newUntitled({
        path: '',
        type: 'directory'
      });
      await settle();
      expect(heldPaths).toEqual(['a', '']);
      const focused = listing.selectItemByName(created.name, true);

      // Paste answers into a after the top create join the queued read of a.
      for (let i = 0; i < 2; i++) {
        pasted.push(
          (await contents.newUntitled({ path: 'a', type: 'file' })).path
        );
      }
      await settle();
      expect(heldPaths).toEqual(['a', '']);

      // The select waits for the top folder's read only.
      expect(await settles(focused)).toBe(false);

      // Releasing the first read of a starts one queued read of a, not one per answer.
      await release(0, 1);
      await reads(3);
      expect(heldPaths).toEqual(['a', '', 'a']);
      expect(await settles(focused)).toBe(false);

      await release(1, 2);
      expect(await settles(focused)).toBe(true);
      expect(Object.keys(selection(listing))).toEqual([created.path]);

      await release(2, 3);
      await settle();
      expect(heldPaths).toEqual(['a', '', 'a']);
      expect(paths(listing.sortedItems())).toEqual(
        expect.arrayContaining([...pasted, created.path])
      );
    });

    it('with unfolding off a new item and a rename show, the new row is selected at the answer, and a focused select waits for the re-read', async () => {
      model.unfolding = false;
      await model.refresh();
      holdReads();

      const created = await model.manager.services.contents.newUntitled({
        path: '',
        type: 'file'
      });
      answer({
        type: 'rename',
        oldValue: { path: 'b.txt' },
        newValue: row('0.txt', 'file')
      });

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        '0.txt',
        created.path
      ]);
      expect(await settles(listing.selectItemByName(created.name))).toBe(true);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
      const focused = listing.selectItemByName(created.name, true);
      expect(await settles(focused)).toBe(false);
      await reads(1);
      await release(0, 1);
      expect(await settles(focused)).toBe(true);
      expect(Object.keys(selection(listing))).toEqual([created.path]);
    });

    it("a create's select also reads an unfolded folder whose rows are not loaded yet, and the re-read in flight before it does not remove the row", async () => {
      holdReads();
      // The unfold's re-read of the top folder and a is in flight at the create.
      const unfolding = model.toggle('a');
      await reads(2);
      const created = await model.manager.services.contents.newUntitled({
        path: '',
        type: 'directory'
      });
      const focused = listing.selectItemByName(created.name, true);
      await reads(4);
      expect(heldPaths.slice(2, 4)).toEqual(['', 'a']);

      await release(2, 4);

      const listed = ['a', 'a/x.txt', 'a/y.txt', created.path, 'b.txt'];
      expect(await settles(focused)).toBe(true);
      expect(paths(listing.sortedItems())).toEqual(listed);
      // The unfold's re-read lacks the new folder and ends after the create's read.
      await release(0, 2);
      await unfolding;
      expect(paths(listing.sortedItems())).toEqual(listed);
    });

    it('the post-rename select of a listed renamed row runs at the answer', async () => {
      await model.toggle('a');
      model.setCurrentFolder('a');
      holdReads();

      await model.manager.services.contents.rename('a/y.txt', 'a/0.txt');

      // The stock _doRename's select after the rename editor closes.
      const select = (
        listing as unknown as {
          _selectItemByName(
            name: string,
            focus: boolean,
            force: boolean
          ): Promise<void>;
        }
      )._selectItemByName('0.txt', true, true);
      expect(await settles(select)).toBe(true);
      expect(Object.keys(selection(listing))).toEqual(['a/0.txt']);
    });

    it('a re-read that started before the answer keeps the row, and a re-read after it confirms the listing', async () => {
      await model.toggle('a');
      holdReads();
      const reading = model.refresh();
      // The top folder and a, read before the create.
      await reads(2);
      const created = await model.manager.services.contents.newUntitled({
        path: 'a',
        type: 'file'
      });
      expect(paths(listing.sortedItems())).toContain(created.path);

      await release(0, 2);

      expect(paths(listing.sortedItems())).toContain(created.path);
      // The create's one read of its folder a.
      await reads(3);
      await release(2, 3);
      await reading;
      expect(paths(listing.sortedItems())).toEqual([
        'a',
        created.path,
        'a/x.txt',
        'a/y.txt',
        'b.txt'
      ]);
    });

    it('a re-read that started after the answer drops a row the server does not have, also when an older read ends after it', async () => {
      await model.toggle('a');
      holdReads();
      // A re-read outside the poll; the answer's one read of its folder a is a second one.
      const before = model.cd('.');
      await reads(2);
      // The server does not have the item: it was removed there before the second re-read.
      answer({ type: 'new', oldValue: null, newValue: row('a/n.txt', 'file') });
      await reads(3);
      expect(paths(listing.sortedItems())).toContain('a/n.txt');

      await release(2, 3);
      expect(paths(listing.sortedItems())).not.toContain('a/n.txt');
      await release(0, 2);
      await before;

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/x.txt',
        'a/y.txt',
        'b.txt'
      ]);
    });

    it('a re-read that started before a rename answer shows the new name and not the old one', async () => {
      await model.toggle('a');
      holdReads();
      const reading = model.refresh();
      await reads(2);
      await model.manager.services.contents.rename('a/y.txt', 'a/0.txt');

      await release(0, 2);

      const renamed = ['a', 'a/0.txt', 'a/x.txt', 'b.txt'];
      expect(paths(listing.sortedItems())).toEqual(renamed);
      await reads(4);
      await release(2, 4);
      await reading;
      expect(paths(listing.sortedItems())).toEqual(renamed);
    });

    it('an older re-read that ends after a newer one does not remove the row', async () => {
      await model.toggle('a');
      holdReads();
      const before = model.cd('.');
      await reads(2);
      const created = await model.manager.services.contents.newUntitled({
        path: 'a',
        type: 'file'
      });
      await reads(3);

      await release(2, 3);
      expect(paths(listing.sortedItems())).toContain(created.path);
      await release(0, 2);
      await before;

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        created.path,
        'a/x.txt',
        'a/y.txt',
        'b.txt'
      ]);
    });

    it('with unfolding off a read that started before the answer keeps the row, and a read after it confirms the listing', async () => {
      model.unfolding = false;
      await model.refresh();
      holdReads();
      const reading = model.refresh();
      await reads(1);
      const created = await model.manager.services.contents.newUntitled({
        path: '',
        type: 'file'
      });
      expect(paths(listing.sortedItems())).toContain(created.path);

      await release(0, 1);

      expect(paths(listing.sortedItems())).toContain(created.path);
      await reads(2);
      await release(1, 2);
      await reading;
      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'b.txt',
        created.path
      ]);
    });

    it("a whole-tree read that started before a create's read of its folder and ends after it is applied for the other folders and not for the create's folder", async () => {
      await model.toggle('a');
      holdReads();
      const contents = model.manager.services.contents;
      // A Delete's refresh: it reads the top folder and a after a/x.txt left the server.
      await contents.delete('a/x.txt');
      const reading = model.refresh();
      await reads(2);
      // Removed after that read was sent: only the create's read of the top folder lacks it.
      await contents.delete('b.txt');
      const created = await contents.newUntitled({
        path: '',
        type: 'directory'
      });
      await reads(3);
      expect(heldPaths).toEqual(['', 'a', '']);

      await release(2, 3);
      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/x.txt',
        'a/y.txt',
        created.path
      ]);
      await release(0, 2);
      await reading;

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        'a/y.txt',
        created.path
      ]);
    });

    it("an older whole-tree read applied after a create's read of another folder keeps the row of a create whose read is still held", async () => {
      await model.toggle('a');
      holdReads();
      const contents = model.manager.services.contents;
      const reading = model.refresh();
      await reads(2);
      const nested = await contents.newUntitled({ path: 'a', type: 'file' });
      const top = await contents.newUntitled({ path: '', type: 'directory' });
      await reads(4);
      expect(heldPaths).toEqual(['', 'a', 'a', '']);

      // The top folder's create read, then the whole-tree read, which lacks the new row in a.
      await release(3, 4);
      await release(0, 2);
      expect(paths(listing.sortedItems())).toContain(nested.path);
      await release(2, 3);
      await reading;

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        nested.path,
        'a/x.txt',
        'a/y.txt',
        top.path,
        'b.txt'
      ]);
    });

    it("a create's read of an unfolded folder that ends after a whole-tree read keeps the top folder that read applied", async () => {
      await model.toggle('a');
      holdReads();
      const contents = model.manager.services.contents;
      // A Delete's refresh: it reads the top folder and a after b.txt left the server.
      await contents.delete('b.txt');
      const reading = model.refresh();
      await reads(2);
      const created = await contents.newUntitled({ path: 'a', type: 'file' });
      await reads(3);
      expect(heldPaths).toEqual(['', 'a', 'a']);

      await release(0, 2);
      await reading;
      expect(paths(listing.sortedItems())).not.toContain('b.txt');
      await release(2, 3);

      expect(paths(listing.sortedItems())).toEqual([
        'a',
        created.path,
        'a/x.txt',
        'a/y.txt'
      ]);
    });
  });
});
