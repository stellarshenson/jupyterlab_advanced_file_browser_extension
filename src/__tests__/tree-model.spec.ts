import { PathExt } from '@jupyterlab/coreutils';
import { DocumentManager } from '@jupyterlab/docmanager';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DocumentWidgetOpenerMock } from '@jupyterlab/docregistry/lib/testutils';
import { DirListing } from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';
import { ServiceManagerMock } from '@jupyterlab/services/lib/testutils';
import { nullTranslator } from '@jupyterlab/translation';

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
});
