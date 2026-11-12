import { JupyterFrontEnd } from '@jupyterlab/application';
import { Clipboard, showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig, PathExt } from '@jupyterlab/coreutils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator } from '@jupyterlab/translation';
import {
  fileIcon,
  folderFavoriteIcon,
  folderIcon,
  terminalIcon
} from '@jupyterlab/ui-components';
import { PartialJSONValue } from '@lumino/coreutils';

import { openTerminalAt } from './openInTerminal';

/** Command ids of the breadcrumb menu. */
export const CRUMB_COMMAND = {
  openInTerminal: 'advanced-file-browser:crumb-open-in-terminal',
  copyPath: 'advanced-file-browser:crumb-copy-path',
  open: 'advanced-file-browser:crumb-open',
  addToFavourite: 'advanced-file-browser:crumb-add-to-favourite'
} as const;

/** The settings plugin of `@jlab-enhanced/favorites`. */
export const FAVOURITES_PLUGIN = '@jlab-enhanced/favorites:favorites';

/** One entry of the favourites setting; `path` is its only required property. */
export interface IFavourite {
  path: string;
  [key: string]: PartialJSONValue | undefined;
}

/**
 * The folder of a breadcrumb node: its server-relative path for a named segment,
 * null for the home and preferred icons, the ellipsis and the separators.
 */
export function crumbPath(node: HTMLElement | null | undefined): string | null {
  if (
    !node ||
    !node.classList.contains('jp-BreadCrumbs-item') ||
    node.classList.contains('jp-BreadCrumbs-ellipsis')
  ) {
    return null;
  }
  return node.dataset.path ?? null;
}

/** `favourites` with `{ path }` appended unless an entry already holds that path. */
export function appendFavourite(
  favourites: IFavourite[],
  path: string
): IFavourite[] {
  return favourites.some(favourite => favourite.path === path)
    ? favourites
    : [...favourites, { path }];
}

/**
 * Register the breadcrumb commands and their context menu items.
 */
export function addCrumbsMenu(
  app: JupyterFrontEnd,
  translator: ITranslator,
  settingRegistry: ISettingRegistry
): void {
  // The editor and menu labels, from the jupyterlab catalogue as core's are
  const trans = translator.load('jupyterlab');

  // The registry holds one entry per schema whose plugin the app has, so this
  // needs no request; fetching an absent plugin's settings would 404 (ACC-FOLDER-97)
  const hasFavourites = (): boolean =>
    FAVOURITES_PLUGIN in settingRegistry.plugins;

  // The crumb under the right click, when it is a named folder segment
  const crumb = (): string | null =>
    crumbPath(app.contextMenuHitTest(node => crumbPath(node) !== null));

  app.commands.addCommand(CRUMB_COMMAND.openInTerminal, {
    label: trans.__('Open in Terminal'),
    icon: terminalIcon.bindprops({ stylesheet: 'menuItem' }),
    describedBy: { args: { type: 'object', properties: {} } },
    isVisible: () =>
      app.serviceManager.terminals.isAvailable() && crumb() !== null,
    execute: async () => {
      const path = crumb();
      if (path !== null) {
        await openTerminalAt(app, translator, path);
      }
    }
  });

  app.commands.addCommand(CRUMB_COMMAND.copyPath, {
    label: trans.__('Copy Path'),
    icon: fileIcon.bindprops({ stylesheet: 'menuItem' }),
    describedBy: { args: { type: 'object', properties: {} } },
    isVisible: () => crumb() !== null,
    execute: async () => {
      const path = crumb();
      if (path === null) {
        return;
      }
      try {
        // Core's filebrowser:copy-path, so the absolute-path setting applies
        if (PageConfig.getOption('copyAbsolutePath') === 'true') {
          Clipboard.copyToSystem(
            PathExt.joinWithLeadingSlash(
              PageConfig.getOption('serverRoot') ?? '',
              path
            )
          );
        } else {
          Clipboard.copyToSystem(path);
        }
      } catch (error) {
        await showErrorMessage(trans.__('Failed to copy path'), error as Error);
      }
    }
  });

  app.commands.addCommand(CRUMB_COMMAND.open, {
    label: trans.__('Open'),
    icon: folderIcon.bindprops({ stylesheet: 'menuItem' }),
    describedBy: { args: { type: 'object', properties: {} } },
    isVisible: () => crumb() !== null,
    execute: async () => {
      const path = crumb();
      if (path !== null) {
        await app.commands.execute('filebrowser:open-path', { path });
      }
    }
  });

  app.commands.addCommand(CRUMB_COMMAND.addToFavourite, {
    // The jupyterlab catalogue leaves the msgid as written (ACC-FOLDER-92)
    label: trans.__('Add to Favourite'),
    icon: folderFavoriteIcon.bindprops({ stylesheet: 'menuItem' }),
    describedBy: { args: { type: 'object', properties: {} } },
    isVisible: () => hasFavourites() && crumb() !== null,
    execute: async () => {
      const path = crumb();
      if (path === null) {
        return;
      }
      const { composite } = await settingRegistry.get(
        FAVOURITES_PLUGIN,
        'favorites'
      );
      const current = (composite as IFavourite[] | undefined) ?? [];
      const next = appendFavourite(current, path);
      if (next !== current) {
        await settingRegistry.set(FAVOURITES_PLUGIN, 'favorites', next);
      }
    }
  });

  // In code, so the four ids stay together with the commands that use them
  app.contextMenu.addItem({
    command: CRUMB_COMMAND.openInTerminal,
    selector: '.jp-BreadCrumbs',
    rank: 0
  });
  app.contextMenu.addItem({
    command: CRUMB_COMMAND.copyPath,
    selector: '.jp-BreadCrumbs',
    rank: 1
  });
  app.contextMenu.addItem({
    command: CRUMB_COMMAND.open,
    selector: '.jp-BreadCrumbs',
    rank: 2
  });
  app.contextMenu.addItem({
    command: CRUMB_COMMAND.addToFavourite,
    selector: '.jp-BreadCrumbs',
    rank: 3
  });
}
