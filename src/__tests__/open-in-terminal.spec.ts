// The real apputils and ui-components load @jupyter/web-components, an ES
// module this Jest configuration does not transform; the module under test
// imports one value from each, so both are replaced here.
jest.mock('@jupyterlab/apputils', () => ({ showErrorMessage: jest.fn() }));
jest.mock('@jupyterlab/ui-components', () => {
  // bindprops returns a view whose prototype is the icon, as LabIcon does
  const terminalIcon = {
    name: 'ui-components:terminal',
    bindprops: (props: unknown) =>
      Object.assign(Object.create(terminalIcon), { props })
  };
  return { terminalIcon };
});

import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage } from '@jupyterlab/apputils';
import { FileBrowser } from '@jupyterlab/filebrowser';
import { ITranslator } from '@jupyterlab/translation';
import { LabIcon, terminalIcon } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';

import { addOpenInTerminal, OPEN_IN_TERMINAL_COMMAND } from '../openInTerminal';

const identity = {
  load: () => ({ __: (msgid: string) => msgid })
} as unknown as ITranslator;

function setup(
  options: { terminals?: boolean; translator?: ITranslator } = {}
) {
  const commands = new CommandRegistry();
  const addItem = jest.fn();
  const app = {
    commands,
    contextMenu: { addItem },
    serviceManager: {
      terminals: { isAvailable: () => options.terminals ?? true }
    },
    contextMenuHitTest: () => undefined
  } as unknown as JupyterFrontEnd;
  const browser = { model: { path: 'a/b' } } as unknown as FileBrowser;
  addOpenInTerminal(app, browser, options.translator ?? identity);
  return { commands, addItem };
}

describe('Open in Terminal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ACC-TERM-63-NOTERM registers nothing without terminals', () => {
    const { commands, addItem } = setup({ terminals: false });
    expect(commands.hasCommand(OPEN_IN_TERMINAL_COMMAND)).toBe(false);
    expect(addItem).not.toHaveBeenCalled();
  });

  it('ACC-TERM-64-FAIL reports a failed terminal:create-new', async () => {
    const { commands } = setup();
    const error = new Error('no terminal');
    commands.addCommand('terminal:create-new', {
      execute: () => Promise.reject(error)
    });
    await commands.execute(OPEN_IN_TERMINAL_COMMAND);
    expect(showErrorMessage).toHaveBeenCalledWith(
      'Failed to open new terminal',
      error
    );
  });

  it('ACC-TERM-65-LABEL label from the jupyterlab catalogue', () => {
    const domains: string[] = [];
    const translator = {
      load: (domain: string) => {
        domains.push(domain);
        return { __: (msgid: string) => `${domain}:${msgid}` };
      }
    } as unknown as ITranslator;
    const { commands } = setup({ translator });
    expect(domains).toEqual(['jupyterlab']);
    expect(commands.label(OPEN_IN_TERMINAL_COMMAND)).toBe(
      'jupyterlab:Open in Terminal'
    );
  });

  it('ACC-TERM-66-ICON icon is terminalIcon', () => {
    const { commands } = setup();
    const icon = commands.icon(OPEN_IN_TERMINAL_COMMAND) as LabIcon;
    expect(icon.name).toBe(terminalIcon.name);
  });

  it('ACC-TERM-67-CAPTION caption reads Open a terminal at this location', () => {
    const { commands } = setup();
    expect(commands.caption(OPEN_IN_TERMINAL_COMMAND)).toBe(
      'Open a terminal at this location'
    );
  });

  it('ACC-TERM-68-RANK selector .jp-DirListing-content and rank 3', () => {
    const { addItem } = setup();
    expect(addItem).toHaveBeenCalledWith({
      command: OPEN_IN_TERMINAL_COMMAND,
      selector: '.jp-DirListing-content',
      rank: 3
    });
  });
});
