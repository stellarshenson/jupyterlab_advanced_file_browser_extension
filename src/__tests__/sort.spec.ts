import { DocumentManager } from '@jupyterlab/docmanager';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DocumentWidgetOpenerMock } from '@jupyterlab/docregistry/lib/testutils';
import { DirListing } from '@jupyterlab/filebrowser';
import { Contents } from '@jupyterlab/services';
import { ServiceManagerMock } from '@jupyterlab/services/lib/testutils';
import { nullTranslator } from '@jupyterlab/translation';
import { ItemOrder, TreeDirListing } from '../listing';
import { TreeFileBrowserModel } from '../model';
import { sortItems } from '../sort';

const ascending: DirListing.ISortState = {
  key: 'name',
  direction: 'ascending'
};
const descending: DirListing.ISortState = {
  key: 'name',
  direction: 'descending'
};

function item(
  name: string,
  type: Contents.ContentType = 'file',
  size = 0,
  lastModified = ''
): Contents.IModel {
  return {
    name,
    path: name,
    type,
    size,
    writable: true,
    created: '',
    last_modified: lastModified,
    mimetype: '',
    content: null,
    format: null
  };
}

function files(): Contents.IModel[] {
  return ['b', '_c', 'A', '.d', '1'].map(name => item(name));
}

// JupyterLab's own order, through DirListing.prototype.sort without a widget.
function jupyterlabSort(
  items: Contents.IModel[],
  state: DirListing.ISortState,
  notebooksFirst = false
): Contents.IModel[] {
  const listing = {
    model: { items: () => items },
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

// The pipeline of the listing with Unix Style Sorting on.
function unixSort(
  items: Contents.IModel[],
  state: DirListing.ISortState,
  notebooksFirst = false
): string[] {
  return sortItems(jupyterlabSort(items, state, notebooksFirst), state, {
    unix: true,
    notebooksFirst
  }).map(model => model.name);
}

describe('Unix Style Sorting', () => {
  it('ACC-SORT-43-ORDER names in byte order', () => {
    expect(unixSort(files(), ascending)).toEqual(['.d', '1', 'A', '_c', 'b']);
  });

  it('ACC-SORT-44-DIRSFIRST folders first in both directions', () => {
    const items = [item('a'), item('z', 'directory')];
    expect(unixSort(items, ascending)).toEqual(['z', 'a']);
    expect(unixSort(items, descending)).toEqual(['z', 'a']);
  });

  it('ACC-SORT-45-NBSECOND notebooks after folders', () => {
    const items = [
      item('a.txt'),
      item('b.ipynb', 'notebook'),
      item('d', 'directory')
    ];
    expect(unixSort(items, ascending, true)).toEqual(['d', 'b.ipynb', 'a.txt']);
    expect(unixSort(items, ascending, false)).toEqual([
      'd',
      'a.txt',
      'b.ipynb'
    ]);
  });

  it('ACC-SORT-46-DESC descending reverses the byte order', () => {
    const items = [...files(), item('e', 'directory')];
    expect(unixSort(items, descending)).toEqual([
      'e',
      'b',
      '_c',
      'A',
      '1',
      '.d'
    ]);
  });

  it("ACC-SORT-48-OFF off keeps JupyterLab's name order", async () => {
    const services = new ServiceManagerMock();
    for (const name of ['b', '_c', 'A', '1']) {
      await services.contents.save(name, { type: 'file' });
    }
    const manager = new DocumentManager({
      registry: new DocumentRegistry(),
      opener: new DocumentWidgetOpenerMock(),
      // The mock comes from @jupyterlab/services 7.6.5, docmanager types against its own 7.6.6 copy.
      manager: services as unknown as DocumentManager.IOptions['manager']
    });
    const model = new TreeFileBrowserModel({
      manager,
      auto: false,
      refreshStandby: 'never'
    });
    const listing = new TreeDirListing({ model, translator: nullTranslator });
    await model.cd('/');
    const names = () => Array.from(listing.sortedItems(), item => item.name);
    const stock = jupyterlabSort(Array.from(model.items()), ascending).map(
      item => item.name
    );
    // The order index.ts sets while the setting is on.
    const unixOrder: ItemOrder = (items, state, notebooksFirst) =>
      sortItems(items, state, { unix: true, notebooksFirst });

    listing.itemOrder = unixOrder;
    expect(names()).toEqual(['1', 'A', '_c', 'b']);
    expect(names()).not.toEqual(stock);

    listing.itemOrder = null;
    expect(names()).toEqual(stock);

    listing.dispose();
    model.dispose();
  });

  it('ACC-SORT-45-NBSECOND ACC-UNFOLD-18-NBFIRST the listing passes Sort Notebooks Above Files to the Unix order at every depth', async () => {
    const services = new ServiceManagerMock();
    await services.contents.save('d', { type: 'directory' });
    await services.contents.save('d/m.txt', { type: 'file' });
    await services.contents.save('d/n.ipynb', { type: 'notebook' });
    await services.contents.save('a.txt', { type: 'file' });
    await services.contents.save('b.ipynb', { type: 'notebook' });
    const manager = new DocumentManager({
      registry: new DocumentRegistry(),
      opener: new DocumentWidgetOpenerMock(),
      // The mock comes from @jupyterlab/services 7.6.5, docmanager types against its own 7.6.6 copy.
      manager: services as unknown as DocumentManager.IOptions['manager']
    });
    const model = new TreeFileBrowserModel({
      manager,
      unfolding: true,
      auto: false,
      refreshStandby: 'never'
    });
    const listing = new TreeDirListing({ model, translator: nullTranslator });
    await model.cd('/');
    await model.toggle('d');
    const order = () => Array.from(listing.sortedItems(), item => item.path);

    // The order index.ts sets while the setting is on.
    listing.itemOrder = (items, state, notebooksFirst) =>
      sortItems(items, state, { unix: true, notebooksFirst });
    expect(order()).toEqual(['d', 'd/m.txt', 'd/n.ipynb', 'a.txt', 'b.ipynb']);

    listing.setNotebooksFirstSorting(true);
    expect(order()).toEqual(['d', 'd/n.ipynb', 'd/m.txt', 'b.ipynb', 'a.txt']);

    listing.dispose();
    model.dispose();
  });

  it('ACC-SORT-49-SIZEDATE ascending File Size puts the smallest first', () => {
    const bySize = [
      item('a.txt', 'file', 3),
      item('b.txt', 'file', 1),
      item('c.txt', 'file', 2)
    ];
    const sizeState: DirListing.ISortState = {
      key: 'file_size',
      direction: 'ascending'
    };
    expect(
      sortItems(jupyterlabSort(bySize, sizeState), sizeState, {
        unix: true,
        notebooksFirst: false
      }).map(model => model.size)
    ).toEqual([1, 2, 3]);

    const byDate = [
      item('a.txt', 'file', 0, '2026-01-03T00:00:00Z'),
      item('b.txt', 'file', 0, '2026-01-01T00:00:00Z'),
      item('c.txt', 'file', 0, '2026-01-02T00:00:00Z')
    ];
    const dateState: DirListing.ISortState = {
      key: 'last_modified',
      direction: 'descending'
    };
    // JupyterLab's descending Last Modified lists the oldest first.
    expect(unixSort(byDate, dateState)).toEqual(['b.txt', 'c.txt', 'a.txt']);
  });
});
