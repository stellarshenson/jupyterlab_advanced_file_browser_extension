import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { ITranslator } from '@jupyterlab/translation';
import { terminalIcon } from '@jupyterlab/ui-components';

/**
 * Open in Terminal on a file row or the empty listing area; folder rows keep
 * core's `terminal:open-folder-in-terminal`.
 */
export const OPEN_IN_TERMINAL_COMMAND =
  'advanced-file-browser:open-in-terminal';

/**
 * Open a terminal at `cwd`, a folder relative to the server root ('' for the root).
 */
export async function openTerminalAt(
  app: JupyterFrontEnd,
  translator: ITranslator,
  cwd: string
): Promise<void> {
  try {
    if (cwd) {
      await app.commands.execute('terminal:create-new', { cwd });
    } else {
      // terminal:create-new sends no cwd for the root, and the server then
      // starts the shell in its process folder; the server extension gives
      // the root's absolute path
      const terminal = await app.serviceManager.terminals.startNew({
        cwd: PageConfig.getOption('advancedFileBrowserServerRoot')
      });
      // The widget opens its own connection; the terminal keeps running
      terminal.dispose();
      await app.commands.execute('terminal:open', { name: terminal.name });
    }
  } catch (error) {
    const trans = translator.load('jupyterlab');
    await showErrorMessage(
      trans.__('Failed to open new terminal'),
      error as Error
    );
  }
}

/**
 * Register the command and its file browser context-menu item.
 */
export function addOpenInTerminal(
  app: JupyterFrontEnd,
  browser: FileBrowser,
  translator: ITranslator
): void {
  // Core registers its own terminal items only when terminals are available
  if (!app.serviceManager.terminals.isAvailable()) {
    return;
  }

  // The jupyterlab catalogue, so this label matches core's folder item
  const trans = translator.load('jupyterlab');

  app.commands.addCommand(OPEN_IN_TERMINAL_COMMAND, {
    label: trans.__('Open in Terminal'),
    caption: trans.__('Open a terminal at this location'),
    icon: terminalIcon.bindprops({ stylesheet: 'menuItem' }),
    describedBy: { args: { type: 'object', properties: {} } },
    isVisible: () => {
      // The selection survives a right-click on the empty area, so only the
      // event target tells a row from the empty area
      const row = app.contextMenuHitTest(node =>
        node.classList.contains('jp-DirListing-item')
      );
      return row?.dataset.isdir !== 'true';
    },
    execute: async () => {
      // The right-click's mousedown has already made the clicked file's folder
      // current, or the top folder when the press is below the last row; a
      // press in a gap between rows keeps the current folder
      await openTerminalAt(app, translator, browser.model.path);
    }
  });

  // In code, not in the schema, so the item follows the terminals check
  app.contextMenu.addItem({
    command: OPEN_IN_TERMINAL_COMMAND,
    selector: '.jp-DirListing-content',
    rank: 3
  });
}
