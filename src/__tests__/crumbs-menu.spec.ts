// The real apputils and ui-components load @jupyter/web-components, an ES
// module this Jest configuration does not transform; the module under test
// imports one value from each, so both are replaced here.
jest.mock('@jupyterlab/apputils', () => ({
  Clipboard: { copyToSystem: jest.fn() },
  showErrorMessage: jest.fn()
}));
jest.mock('@jupyterlab/ui-components', () => {
  // bindprops returns a view whose prototype is the icon, as LabIcon does
  const icon = (name: string) => {
    const labIcon = {
      name,
      bindprops: (props: unknown) =>
        Object.assign(Object.create(labIcon), { props })
    };
    return labIcon;
  };
  return {
    fileIcon: icon('ui-components:file'),
    folderFavoriteIcon: icon('ui-components:folder-favorite'),
    folderIcon: icon('ui-components:folder'),
    terminalIcon: icon('ui-components:terminal')
  };
});

import { JupyterFrontEnd } from '@jupyterlab/application';
import { Clipboard, showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import { CommandRegistry } from '@lumino/commands';

import {
  addCrumbsMenu,
  appendFavourite,
  crumbPath,
  CRUMB_COMMAND,
  FAVOURITES_PLUGIN
} from '../crumbsMenu';

const identity = {
  load: () => ({ __: (msgid: string) => msgid })
} as unknown as ITranslator;

/** A span with the classes and the path of a breadcrumb node. */
function crumb(className: string, path?: string): HTMLElement {
  const node = document.createElement('span');
  node.className = className;
  if (path !== undefined) {
    node.dataset.path = path;
  }
  return node;
}

/** A setting registry whose plugin map holds the favourites schema, or not. */
function registry(present = true) {
  const store: Record<string, any> = { favorites: [{ path: 'top' }] };
  const load = jest.fn();
  const get = jest.fn(async (_: string, key: string) => ({
    composite: store[key]
  }));
  const set = jest.fn(async (_: string, key: string, value: any) => {
    store[key] = value;
  });
  const plugins = present ? { [FAVOURITES_PLUGIN]: {} } : {};
  return {
    registry: { plugins, load, get, set } as unknown as ISettingRegistry,
    load,
    get,
    set,
    store
  };
}

function setup(present = true, options: { terminals?: boolean } = {}) {
  const commands = new CommandRegistry();
  const addItem = jest.fn();
  let hit: HTMLElement | null = null;
  const app = {
    commands,
    contextMenu: { addItem },
    serviceManager: {
      terminals: { isAvailable: () => options.terminals ?? true }
    },
    contextMenuHitTest: () => hit ?? undefined
  } as unknown as JupyterFrontEnd;
  const fake = registry(present);
  addCrumbsMenu(app, identity, fake.registry);
  return {
    commands,
    addItem,
    hit: (node: HTMLElement | null) => {
      hit = node;
    },
    ...fake
  };
}

describe('crumbPath', () => {
  it('marks a named segment with its server-relative path', () => {
    expect(crumbPath(crumb('jp-BreadCrumbs-item', 'tmp/a/b'))).toBe('tmp/a/b');
  });

  it('is null for the home icon, the preferred icon, the ellipsis and separators', () => {
    expect(crumbPath(crumb('jp-BreadCrumbs-home', '/'))).toBeNull();
    expect(crumbPath(crumb('jp-BreadCrumbs-preferred', 'a'))).toBeNull();
    expect(
      crumbPath(crumb('jp-BreadCrumbs-item jp-BreadCrumbs-ellipsis', 'a/b'))
    ).toBeNull();
    expect(crumbPath(crumb('jp-BreadCrumbs-separator'))).toBeNull();
    expect(crumbPath(null)).toBeNull();
  });
});

describe('appendFavourite', () => {
  it('appends the path to an empty or other list', () => {
    expect(appendFavourite([], 'a/b')).toEqual([{ path: 'a/b' }]);
    expect(appendFavourite([{ path: 'x', name: 'X' }], 'a/b')).toEqual([
      { path: 'x', name: 'X' },
      { path: 'a/b' }
    ]);
  });

  it('keeps the list when an entry already holds the path', () => {
    const favourites = [{ path: 'a/b' }];
    expect(appendFavourite(favourites, 'a/b')).toBe(favourites);
  });
});

describe('breadcrumb menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ACC-FOLDER-92-CRUMB-MENU registers the four commands and menu items', () => {
    const { commands, addItem } = setup();
    expect(
      Object.values(CRUMB_COMMAND).every(id => commands.hasCommand(id))
    ).toBe(true);
    expect(addItem.mock.calls.map(call => call[0])).toEqual(
      Object.values(CRUMB_COMMAND).map((command, rank) => ({
        command,
        selector: '.jp-BreadCrumbs',
        rank
      }))
    );
  });

  it('shows the three always items only on a named segment', () => {
    const { commands, hit } = setup();
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    expect(commands.isVisible(CRUMB_COMMAND.openInTerminal)).toBe(true);
    expect(commands.isVisible(CRUMB_COMMAND.copyPath)).toBe(true);
    expect(commands.isVisible(CRUMB_COMMAND.open)).toBe(true);

    hit(crumb('jp-BreadCrumbs-item jp-BreadCrumbs-ellipsis', 'a'));
    expect(commands.isVisible(CRUMB_COMMAND.open)).toBe(false);
    hit(null);
    expect(commands.isVisible(CRUMB_COMMAND.open)).toBe(false);
  });

  it('hides Open in Terminal when terminals are unavailable', () => {
    const { commands, hit } = setup(true, { terminals: false });
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    expect(commands.isVisible(CRUMB_COMMAND.openInTerminal)).toBe(false);
    expect(commands.isVisible(CRUMB_COMMAND.copyPath)).toBe(true);
    expect(commands.isVisible(CRUMB_COMMAND.open)).toBe(true);
  });

  it('ACC-FOLDER-97-FAV-ABSENT hides Add to Favourite without loading its settings', () => {
    const { commands, hit, load } = setup(false);
    hit(crumb('jp-BreadCrumbs-item', 'a'));
    expect(commands.isVisible(CRUMB_COMMAND.addToFavourite)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('shows Add to Favourite when the favourites plugin is present', () => {
    const { commands, hit } = setup(true);
    hit(crumb('jp-BreadCrumbs-item', 'a'));
    expect(commands.isVisible(CRUMB_COMMAND.addToFavourite)).toBe(true);
  });

  it('ACC-FOLDER-93-CRUMB-TERM opens the terminal at the crumb path', async () => {
    const { commands, hit } = setup();
    const run = jest.fn();
    commands.addCommand('terminal:create-new', { execute: run });
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.openInTerminal);
    expect(run).toHaveBeenCalledWith({ cwd: 'a/b' });
  });

  it('ACC-FOLDER-95-CRUMB-OPEN opens the crumb path', async () => {
    const { commands, hit } = setup();
    const run = jest.fn();
    commands.addCommand('filebrowser:open-path', { execute: run });
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.open);
    expect(run).toHaveBeenCalledWith({ path: 'a/b' });
  });

  it('ACC-FOLDER-94-CRUMB-COPY copies the crumb path to the system clipboard', async () => {
    const { commands, hit } = setup();
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.copyPath);
    expect(Clipboard.copyToSystem).toHaveBeenCalledWith('a/b');
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it('ACC-FOLDER-94-CRUMB-COPY reports a clipboard failure', async () => {
    const error = new Error('denied');
    (Clipboard.copyToSystem as jest.Mock).mockImplementationOnce(() => {
      throw error;
    });
    const { commands, hit } = setup();
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.copyPath);
    expect(showErrorMessage).toHaveBeenCalledWith('Failed to copy path', error);
  });

  it('ACC-FOLDER-94-CRUMB-COPY copies the absolute path when core is set to it', async () => {
    const getOption = jest
      .spyOn(PageConfig, 'getOption')
      .mockImplementation((key: string) =>
        key === 'copyAbsolutePath' ? 'true' : key === 'serverRoot' ? '/srv' : ''
      );
    const { commands, hit } = setup();
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.copyPath);
    expect(Clipboard.copyToSystem).toHaveBeenCalledWith('/srv/a/b');
    getOption.mockRestore();
  });

  it('ACC-FOLDER-96-CRUMB-FAV appends the crumb path once', async () => {
    const { commands, hit, set, store } = setup();
    hit(crumb('jp-BreadCrumbs-item', 'a/b'));
    await commands.execute(CRUMB_COMMAND.addToFavourite);
    expect(store.favorites).toEqual([{ path: 'top' }, { path: 'a/b' }]);
    expect(set).toHaveBeenCalledTimes(1);
    await commands.execute(CRUMB_COMMAND.addToFavourite);
    expect(set).toHaveBeenCalledTimes(1);
  });
});
