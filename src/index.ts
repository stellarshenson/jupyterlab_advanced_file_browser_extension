import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  JupyterLab
} from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import {
  FileBrowser,
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStateDB } from '@jupyterlab/statedb';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { ITranslator } from '@jupyterlab/translation';

import type { ItemOrder, TreeFileBrowser } from './listing';
// Activation registers the four commands at once, so it needs the module now
// eslint-disable-next-line jupyter/prefer-lazy-imports
import { addCrumbsMenu } from './crumbsMenu';
// Activation hands the trackers to the drop handlers, so it needs the module now
// eslint-disable-next-line jupyter/prefer-lazy-imports
import { addDragDropPath } from './dragDrop';
import { addOpenInTerminal } from './openInTerminal';
import { requestAPI } from './request';
import { sortItems } from './sort';

const PLUGIN_ID =
  '@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin';

/**
 * The schema defaults, used as they are when the settings fail to load.
 */
const DEFAULTS = { folderUnfolding: false, unixStyleSorting: true };

type SettingKey = keyof typeof DEFAULTS;

const unixOrder: ItemOrder = (stock, state, notebooksFirst) =>
  sortItems(stock, state, { unix: true, notebooksFirst });

/**
 * The file browser factory, in place of core's, building tree browsers.
 */
const plugin: JupyterFrontEndPlugin<IFileBrowserFactory> = {
  id: PLUGIN_ID,
  description:
    'Provides the file browser factory with folder unfolding and Unix Style Sorting',
  autoStart: true,
  provides: IFileBrowserFactory,
  requires: [IDocumentManager, ITranslator, ISettingRegistry],
  optional: [IStateDB, JupyterLab.IInfo],
  activate: async (
    app: JupyterFrontEnd,
    docManager: IDocumentManager,
    translator: ITranslator,
    settingRegistry: ISettingRegistry,
    state: IStateDB | null,
    info: JupyterLab.IInfo | null
  ): Promise<IFileBrowserFactory> => {
    console.log(
      'JupyterLab extension @stellarshenson/jupyterlab-advanced-file-browser-extension is activated!'
    );

    requestAPI<any>('hello', app.serviceManager.serverSettings)
      .then(data => {
        console.log(data);
      })
      .catch(reason => {
        console.error(
          `The jupyterlab_advanced_file_browser_extension server extension appears to be missing.\n${reason}`
        );
      });

    // A failed load must not keep the file browser from activating.
    let settings: ISettingRegistry.ISettings | null = null;
    try {
      settings = await settingRegistry.load(PLUGIN_ID);
    } catch (reason) {
      console.error(`Failed to load settings for ${PLUGIN_ID}.`, reason);
    }
    const value = (key: SettingKey): boolean =>
      (settings?.get(key).composite as boolean | undefined) ?? DEFAULTS[key];

    const { TreeFileBrowser } = await import('./listing');
    const { TreeFileBrowserModel } = await import('./model');

    const apply = (browser: TreeFileBrowser): void => {
      browser.model.unfolding = value('folderUnfolding');
      browser.itemOrder = value('unixStyleSorting') ? unixOrder : null;
    };

    const tracker = new WidgetTracker<TreeFileBrowser>({
      namespace: 'filebrowser'
    });
    const createFileBrowser = (
      id: string,
      options: IFileBrowserFactory.IOptions = {}
    ): TreeFileBrowser => {
      const browserState =
        options.state === null
          ? undefined
          : options.state || state || undefined;
      const model = new TreeFileBrowserModel({
        translator,
        auto: options.auto ?? true,
        manager: docManager,
        driveName: options.driveName || '',
        refreshInterval: options.refreshInterval,
        refreshStandby: () => (info && !info.isConnected) || 'when-hidden',
        state: browserState,
        allowFileUploads: options.allowFileUploads ?? true,
        // The first fetch already lists in the saved mode.
        unfolding: value('folderUnfolding')
      });
      const browser = new TreeFileBrowser({
        id,
        model,
        restore: options.restore,
        translator,
        state: browserState,
        renderer: options.renderer
      });
      apply(browser);
      void tracker.add(browser);
      return browser;
    };

    settings?.changed.connect(() => tracker.forEach(apply));

    const trans = translator.load('jupyterlab');
    const addToggle = (id: string, key: SettingKey, label: string): void => {
      app.commands.addCommand(id, {
        label,
        isToggled: () => value(key),
        describedBy: { args: { type: 'object', properties: {} } },
        execute: () => settings?.set(key, !value(key))
      });
    };
    addToggle(
      'advanced-file-browser:toggle-folder-unfolding',
      'folderUnfolding',
      trans.__('Folder Unfolding')
    );
    addToggle(
      'advanced-file-browser:toggle-unix-sorting',
      'unixStyleSorting',
      trans.__('Unix Style Sorting')
    );

    return { createFileBrowser, tracker };
  }
};

/**
 * Open in Terminal on file rows and the empty listing area.
 */
const openInTerminal: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-advanced-file-browser-extension:open-in-terminal',
  description:
    'Adds Open in Terminal to file rows and the empty area of the file browser',
  autoStart: true,
  requires: [IDefaultFileBrowser, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    browser: FileBrowser,
    translator: ITranslator
  ) => addOpenInTerminal(app, browser, translator)
};

/**
 * The context menu of the folder names in the file browser breadcrumbs.
 */
const crumbsMenu: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-advanced-file-browser-extension:crumbs-menu',
  description:
    'Adds Open in Terminal, Copy Path, Open and Add to Favourite to the breadcrumb folder names',
  autoStart: true,
  requires: [IDefaultFileBrowser, ITranslator, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    browser: FileBrowser,
    translator: ITranslator,
    settingRegistry: ISettingRegistry
  ) => addCrumbsMenu(app, translator, settingRegistry)
};

/**
 * Drag a file or folder, or a breadcrumb, onto a terminal, an editor or a
 * notebook to insert its path.
 */
const dragDropPath: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-advanced-file-browser-extension:drag-and-drop-path',
  description:
    'Drag a file or folder from the file browser and drop it onto a terminal, Python file, or notebook to insert its path.',
  autoStart: true,
  requires: [
    ISettingRegistry,
    ITerminalTracker,
    IEditorTracker,
    INotebookTracker
  ],
  activate: (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry,
    terminals: ITerminalTracker,
    editors: IEditorTracker,
    notebooks: INotebookTracker
  ) => addDragDropPath(app, settingRegistry, terminals, editors, notebooks)
};

export default [plugin, openInTerminal, crumbsMenu, dragDropPath];
