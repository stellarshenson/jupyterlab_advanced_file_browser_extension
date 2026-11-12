/**
 * Drop targets for dragged file browser paths, and their activation.
 */

import { JupyterFrontEnd } from '@jupyterlab/application';
import { CodeEditor } from '@jupyterlab/codeeditor';
import { PageConfig } from '@jupyterlab/coreutils';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { Drag } from '@lumino/dragdrop';

import { attachCrumbDragSource } from './crumbDrag';
import {
  CONTENTS_MIME,
  DEFAULT_SETTINGS,
  dirname,
  draggedPaths,
  formatForPython,
  formatForTerminal,
  isPythonMimeType,
  ISettings,
  PATH_MIME,
  resolvePath,
  singleDraggedPath
} from './dragPaths';
import { requestAPI } from './request';

/**
 * The plugin whose schema holds the drag settings, the file browser plugin.
 */
const SETTINGS_ID =
  '@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin';

/** Widget types tracked by the JupyterLab trackers. */
type TerminalWidget = NonNullable<ITerminalTracker['currentWidget']>;
type EditorWidget = NonNullable<IEditorTracker['currentWidget']>;
type NotebookWidget = NonNullable<INotebookTracker['currentWidget']>;

/** Mutable extension state shared by all drop handlers. */
interface IExtensionState {
  app: JupyterFrontEnd;
  settings: ISettings;
  rootDir: string;
}

/**
 * Attach file-browser drop handling to a node.
 *
 * `extract` reads the drag's payload and returns what this target accepts,
 * or `null` to decline the drag - which is how a target that takes a single
 * path declines a multi-item drag, leaving the cursor on no-drop.
 */
function attachDropTarget<T>(
  node: HTMLElement,
  isEnabled: () => boolean,
  extract: (data: unknown) => T | null,
  onDrop: (payload: T, event: Drag.Event) => void
): void {
  const payloadOf = (event: Drag.Event): T | null => {
    if (!isEnabled()) {
      return null;
    }
    // A drag out of the file listing carries `CONTENTS_MIME`; one this
    // extension started from a breadcrumb carries its own type, so that
    // JupyterLab's move targets leave it alone. Both hold the same payload.
    const data =
      event.mimeData.getData(CONTENTS_MIME) ??
      event.mimeData.getData(PATH_MIME);
    return extract(data);
  };

  node.addEventListener('lm-dragenter', (event: Event) => {
    if (payloadOf(event as Drag.Event) === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  node.addEventListener('lm-dragover', (event: Event) => {
    const dragEvent = event as Drag.Event;
    if (payloadOf(dragEvent) === null) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    dragEvent.dropAction = dragEvent.proposedAction;
  });

  node.addEventListener('lm-drop', (event: Event) => {
    const dragEvent = event as Drag.Event;
    const payload = payloadOf(dragEvent);
    if (payload === null) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    onDrop(payload, dragEvent);
  });
}

/** Insert text into an editor at the drop coordinates. */
function insertAtDrop(
  editor: CodeEditor.IEditor,
  text: string,
  event: Drag.Event
): void {
  const position = editor.getPositionForCoordinate({
    left: event.clientX,
    right: event.clientX,
    top: event.clientY,
    bottom: event.clientY
  });
  if (position) {
    editor.setCursorPosition(position);
  }
  editor.replaceSelection?.(text);
  editor.focus();
}

/**
 * Resolve a dragged path for a document, or return null when the result
 * would be wrong.
 *
 * An absolute path needs the server root. When the server extension is
 * unavailable the root is empty, and joining an empty root yields the bare
 * contents path - a relative path silently emitted where an absolute one was
 * asked for, which can address a different existing file. Refusing is the
 * same answer the terminal branch already gives for a missing cwd.
 */
export function resolveOrRefuse(
  state: IExtensionState,
  contentsPath: string,
  baseDir: string,
  baseIsAbsolute: boolean
): string | null {
  if (state.settings.pathType === 'absolute' && !state.rootDir) {
    console.warn(
      '[jupyterlab_advanced_file_browser_extension] server root unavailable; ' +
        'nothing inserted'
    );
    return null;
  }
  return resolvePath(contentsPath, state.settings.pathType, {
    rootDir: state.rootDir,
    baseDir,
    baseIsAbsolute
  });
}

/**
 * Fetch the current working directory of a terminal by name. Returns
 * `null` when the cwd cannot be determined.
 */
async function fetchTerminalCwd(
  app: JupyterFrontEnd,
  name: string
): Promise<string | null> {
  try {
    const data = await requestAPI<{ cwd?: unknown }>(
      'terminal-cwd/' + encodeURIComponent(name),
      app.serviceManager.serverSettings
    );
    return data && typeof data.cwd === 'string' ? data.cwd : null;
  } catch (error) {
    console.warn(
      '[jupyterlab_advanced_file_browser_extension] terminal cwd request failed:',
      error
    );
    return null;
  }
}

/**
 * Wire drop handling for a terminal.
 *
 * The terminal is the one target that takes a multi-item drag: every dragged
 * path is inserted in one send, separated as the settings say.
 */
function setupTerminalDrop(
  widget: TerminalWidget,
  state: IExtensionState
): void {
  attachDropTarget(
    widget.node,
    () => state.settings.dragDropPathEnabled,
    draggedPaths,
    async (contentsPaths, _event) => {
      const session = widget.content.session;
      // Both branches join the dragged path onto the server root, so an empty
      // root is a wrong path in either: the relative branch would measure a
      // root-relative path against an absolute cwd and emit a `..` walk to a
      // file that is not there. The root comes from the page config at
      // activation and never changes, so a missing root stays empty for the
      // session.
      if (!state.rootDir) {
        console.warn(
          '[jupyterlab_advanced_file_browser_extension] server root ' +
            'unavailable; nothing inserted'
        );
        return;
      }
      let resolved: string[];
      if (state.settings.pathType === 'relative') {
        const cwd = await fetchTerminalCwd(state.app, session.model.name);
        if (cwd === null) {
          console.warn(
            '[jupyterlab_advanced_file_browser_extension] terminal cwd unavailable; ' +
              'nothing inserted'
          );
          return;
        }
        resolved = contentsPaths.map(contentsPath =>
          resolvePath(contentsPath, 'relative', {
            rootDir: state.rootDir,
            baseDir: cwd,
            baseIsAbsolute: true
          })
        );
      } else {
        resolved = contentsPaths.map(contentsPath =>
          resolvePath(contentsPath, 'absolute', {
            rootDir: state.rootDir,
            baseDir: '',
            baseIsAbsolute: true
          })
        );
      }
      // Bring the terminal tab to the foreground and focus it - the drag
      // started in the file browser, which otherwise keeps focus here.
      state.app.shell.activateById(widget.id);
      session.send({
        type: 'stdin',
        content: [
          formatForTerminal(
            resolved,
            state.settings.terminalQuotePaths,
            state.settings.terminalSeparator
          )
        ]
      });
    }
  );
}

/** Whether a file editor holds Python source. */
function isPythonEditor(widget: EditorWidget): boolean {
  const path = widget.context.path.toLowerCase();
  if (path.endsWith('.py') || path.endsWith('.pyi')) {
    return true;
  }
  return isPythonMimeType(widget.content.editor.model.mimeType);
}

/** Wire drop handling for a file editor. */
function setupEditorDrop(widget: EditorWidget, state: IExtensionState): void {
  attachDropTarget(
    widget.node,
    () => state.settings.dragDropPathEnabled,
    singleDraggedPath,
    (contentsPath, event) => {
      const resolved = resolveOrRefuse(
        state,
        contentsPath,
        dirname(widget.context.path),
        false
      );
      if (resolved === null) {
        return;
      }
      const text = isPythonEditor(widget)
        ? formatForPython(
            resolved,
            state.settings.pythonPathStyle,
            state.settings.pathlibConstructor
          )
        : resolved;
      insertAtDrop(widget.content.editor, text, event);
    }
  );
}

/** A notebook cell, as the notebook itself types them. */
type NotebookCell = NotebookWidget['content']['widgets'][number];

/**
 * The cell the drop point sits over, or null when it sits over none of them.
 *
 * The drop listener is on the whole notebook panel, so a drop can land on the
 * toolbar or in the gap below the last cell as easily as on a cell.
 */
function cellAtPoint(
  notebook: NotebookWidget['content'],
  event: Drag.Event
): NotebookCell | null {
  for (const cell of notebook.widgets) {
    const rect = cell.node.getBoundingClientRect();
    if (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      return cell;
    }
  }
  return null;
}

/** Wire drop handling for a notebook: inserts into the dropped-on cell. */
function setupNotebookDrop(
  widget: NotebookWidget,
  state: IExtensionState
): void {
  attachDropTarget(
    widget.node,
    () => state.settings.dragDropPathEnabled,
    singleDraggedPath,
    (contentsPath, event) => {
      const notebook = widget.content;
      // The cell the pointer is over takes the drop, so a drop on cell 3 does
      // not land in cell 0 just because the caret was left there. Over no cell
      // at all, the active cell keeps it.
      const dropped = cellAtPoint(notebook, event);
      if (dropped) {
        notebook.activeCellIndex = notebook.widgets.indexOf(dropped);
      }
      // Within the cell, insert at its cursor rather than at the drop
      // coordinates - the user expects the path to land where their caret is.
      const cell = notebook.activeCell;
      if (!cell || !cell.editor) {
        return;
      }
      const resolved = resolveOrRefuse(
        state,
        contentsPath,
        dirname(widget.context.path),
        false
      );
      if (resolved === null) {
        return;
      }
      // `codeMimetype` is derived from the running kernel and stays
      // `text/plain` until its language info arrives, so a drop made before
      // the kernel connects would otherwise insert an unquoted path into a
      // Python cell. The notebook's own metadata already names the language.
      const declaredLanguage = (
        widget.context.model.defaultKernelLanguage || ''
      ).toLowerCase();
      const isPython =
        cell.model.type === 'code' &&
        (isPythonMimeType(notebook.codeMimetype) ||
          declaredLanguage === 'python');
      const text = isPython
        ? formatForPython(
            resolved,
            state.settings.pythonPathStyle,
            state.settings.pathlibConstructor
          )
        : resolved;
      cell.editor.replaceSelection?.(text);
      cell.editor.focus();
    }
  );
}

/** Read the typed settings out of a loaded settings object. */
export function readSettings(loaded: ISettingRegistry.ISettings): ISettings {
  const get = <T>(key: keyof ISettings, fallback: T): T =>
    (loaded.get(key).composite as T) ?? fallback;
  return {
    dragDropPathEnabled: get(
      'dragDropPathEnabled',
      DEFAULT_SETTINGS.dragDropPathEnabled
    ),
    pathType: get('pathType', DEFAULT_SETTINGS.pathType),
    pythonPathStyle: get('pythonPathStyle', DEFAULT_SETTINGS.pythonPathStyle),
    pathlibConstructor: get(
      'pathlibConstructor',
      DEFAULT_SETTINGS.pathlibConstructor
    ),
    terminalSeparator: get(
      'terminalSeparator',
      DEFAULT_SETTINGS.terminalSeparator
    ),
    terminalQuotePaths: get(
      'terminalQuotePaths',
      DEFAULT_SETTINGS.terminalQuotePaths
    )
  };
}

/**
 * Wire the drop targets and load the settings.
 */
export async function addDragDropPath(
  app: JupyterFrontEnd,
  settingRegistry: ISettingRegistry,
  terminals: ITerminalTracker,
  editors: IEditorTracker,
  notebooks: INotebookTracker
): Promise<void> {
  const state: IExtensionState = {
    app,
    settings: { ...DEFAULT_SETTINGS },
    rootDir: PageConfig.getOption('advancedFileBrowserServerRoot')
  };

  // Attach the drop targets first. Every handler reads `state` at drop
  // time, never at attach time, so nothing below has to be awaited before
  // the extension is live, and a settings load that never settles cannot
  // leave the targets unattached.
  terminals.forEach(widget => setupTerminalDrop(widget, state));
  terminals.widgetAdded.connect((_, widget) =>
    setupTerminalDrop(widget, state)
  );

  editors.forEach(widget => setupEditorDrop(widget, state));
  editors.widgetAdded.connect((_, widget) => setupEditorDrop(widget, state));

  notebooks.forEach(widget => setupNotebookDrop(widget, state));
  notebooks.widgetAdded.connect((_, widget) =>
    setupNotebookDrop(widget, state)
  );

  // The file browser's breadcrumbs are a drop target in JupyterLab but not
  // a drag source, so the directory the browser is showing cannot be
  // dragged anywhere. This makes each crumb draggable onto the targets
  // above.
  attachCrumbDragSource(() => state.settings.dragDropPathEnabled);

  try {
    const loaded = await settingRegistry.load(SETTINGS_ID);
    const apply = (): void => {
      state.settings = readSettings(loaded);
    };
    apply();
    loaded.changed.connect(apply);
  } catch (error) {
    console.warn(
      '[jupyterlab_advanced_file_browser_extension] could not load settings:',
      error
    );
  }
}
