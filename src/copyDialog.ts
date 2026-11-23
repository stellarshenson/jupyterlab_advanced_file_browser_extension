import { Dialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { renameFile } from '@jupyterlab/docmanager';
import type { Contents, ServerConnection } from '@jupyterlab/services';
import { type IStatusBar, type Popup, showPopup } from '@jupyterlab/statusbar';
import type { TranslationBundle } from '@jupyterlab/translation';
import { caretUpIcon } from '@jupyterlab/ui-components';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import {
  capped,
  percent,
  POLL_MS,
  PROGRESS_DELAY_MS,
  PROGRESS_MIN_MS
} from './deleteDialog';
import type { TreeFileBrowserModel } from './model';
import { requestAPI } from './request';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** A copy or move job as GET copy/<id> reports it. */
interface IJob {
  files_total: number;
  bytes_total: number;
  files: number;
  bytes: number;
  file_size: number;
  file_bytes: number;
  /** The current file, relative to the server root. */
  from: string;
  to: string;
  cross: boolean;
  done: boolean;
  /** Seconds since the job started, less the time paused; a report during a pause counts at most the last 1 s of it. */
  elapsed: number;
  /** The file whose read or write failed and why, while the job waits for Retry, Skip file or Cancel. */
  paused: { path: string; reason: string } | null;
  /** Only in the report that says done. */
  errors?: { path: string; message: string }[];
  /** Only in the report that says done: the request paths not copied or moved in full. */
  not_done?: string[];
}

interface IBar {
  track: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
}

/** The parts of an open progress dialog that each poll repaints. */
interface IView {
  warning: HTMLElement;
  reason: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  file: IBar;
  total: IBar;
  files: HTMLElement;
  bytes: HTMLElement;
  speed: HTMLElement;
  elapsed: HTMLElement;
  left: HTMLElement;
}

interface IOperation {
  id: string;
  title: string;
  move: boolean;
  /** Date.now() at the start, for the time ago of the operations menu. */
  started: number;
  state: 'pending' | 'shown' | 'hidden' | 'cancelled';
  job: IJob | null;
  settings: ServerConnection.ISettings;
  trans: TranslationBundle;
  dialog: Dialog<unknown> | null;
  view: IView | null;
  /** Date.now() when the dialog last opened. */
  opened: number;
  /** Hidden when its current pause opened the dialog, so Retry and Skip file hide it again. */
  hideAfterPause: boolean;
}

/** The operations running now, in start order. */
const operations: IOperation[] = [];
/** Emitted on every poll and every state change of an operation. */
const changed = new Signal<IOperation[], void>(operations);

/** The progress dialog title: the action and the item count. */
export function copyTitle(
  move: boolean,
  count: number,
  trans: TranslationBundle
): string {
  return move
    ? trans._n('Moving %1 item', 'Moving %1 items', count)
    : trans._n('Copying %1 item', 'Copying %1 items', count);
}

/** Seconds as m:ss, the minutes unbounded. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Bytes in GiB with two decimals. */
export function gib(bytes: number): string {
  return (bytes / GIB).toFixed(2);
}

/** A count with its thousands apart by a no-break space, so it never wraps: 20 000. */
export function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/** How long ago: seconds under a minute, minutes under an hour, then hours. */
export function timeAgo(seconds: number, trans: TranslationBundle): string {
  const s = Math.floor(seconds);
  return s < 60
    ? trans.__('%1 s ago', s)
    : s < 3600
      ? trans.__('%1 min ago', Math.floor(s / 60))
      : trans.__('%1 h ago', Math.floor(s / 3600));
}

function add(parent: HTMLElement, tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  parent.appendChild(node);
  return node;
}

/** The delete dialog's determinate bar: a track with its fill, and the percentage. */
function bar(parent: HTMLElement, label: string): IBar {
  const track = add(parent, 'span', 'jp-AdvancedFileBrowser-copyTrack');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  const fill = add(track, 'span', 'jp-AdvancedFileBrowser-copyFill');
  const text = add(parent, 'span', 'jp-AdvancedFileBrowser-copyPercent');
  const result = { track, fill, label: text };
  setBar(result, 0);
  return result;
}

function setBar({ track, fill, label }: IBar, value: number): void {
  fill.style.width = `${value}%`;
  label.textContent = `${value}%`;
  track.setAttribute('aria-valuenow', `${value}`);
}

/** The summed bytes percentage of `ops`. */
function totalPercent(ops: IOperation[]): number {
  const sum = (key: 'bytes' | 'bytes_total') =>
    ops.reduce((n, op) => n + (op.job?.[key] ?? 0), 0);
  return percent(sum('bytes'), sum('bytes_total'));
}

/** The body of the progress dialog, after the mockup: warning, From and To, File and Total bars, counters. */
function createView(trans: TranslationBundle): { body: Widget; view: IView } {
  const body = new Widget();
  body.addClass('jp-AdvancedFileBrowser-copyBody');
  const node = body.node;
  const warning = add(node, 'div', 'jp-AdvancedFileBrowser-copyWarning');
  warning.hidden = true;
  const reason = add(node, 'div', 'jp-AdvancedFileBrowser-copyReason');
  reason.hidden = true;
  reason.setAttribute('role', 'alert');
  const paths = add(
    node,
    'div',
    'jp-AdvancedFileBrowser-copyGrid jp-AdvancedFileBrowser-copyPaths'
  );
  const path = (key: string) => {
    add(paths, 'span', 'jp-AdvancedFileBrowser-copyKey').textContent = key;
    return add(paths, 'span', 'jp-AdvancedFileBrowser-copyPath');
  };
  const from = path(trans.__('From'));
  const to = path(trans.__('To'));
  const bars = add(node, 'div', 'jp-AdvancedFileBrowser-copyGrid');
  const line = (key: string, className: string) => {
    add(
      bars,
      'span',
      `jp-AdvancedFileBrowser-copyKey ${className}`
    ).textContent = key;
    const row = add(bars, 'div', `jp-AdvancedFileBrowser-copyBar ${className}`);
    return bar(row, key);
  };
  const file = line(trans.__('File'), 'jp-AdvancedFileBrowser-copyFile');
  const total = line(trans.__('Total'), 'jp-AdvancedFileBrowser-copyTotal');
  const stats = add(node, 'div', 'jp-AdvancedFileBrowser-copyStats');
  const stat = (key: string, className: string) => {
    const cell = add(stats, 'span', className);
    add(cell, 'span', 'jp-AdvancedFileBrowser-copyStatKey').textContent = key;
    return add(cell, 'span', 'jp-AdvancedFileBrowser-copyStatValue');
  };
  return {
    body,
    view: {
      warning,
      reason,
      from,
      to,
      file,
      total,
      files: stat(trans.__('Files'), 'jp-AdvancedFileBrowser-copyFiles'),
      bytes: stat(trans.__('Bytes'), 'jp-AdvancedFileBrowser-copyBytes'),
      speed: stat(trans.__('Speed'), 'jp-AdvancedFileBrowser-copySpeed'),
      elapsed: stat(trans.__('Elapsed'), 'jp-AdvancedFileBrowser-copyElapsed'),
      left: stat(trans.__('Left'), 'jp-AdvancedFileBrowser-copyLeft')
    }
  };
}

function paint(op: IOperation): void {
  const { job, view, trans } = op;
  if (!job || !view) {
    return;
  }
  const speed = job.elapsed > 0 ? job.bytes / job.elapsed : 0;
  view.warning.hidden = !job.cross;
  view.warning.textContent = op.move
    ? trans.__('Cross-volume move, may be slower')
    : trans.__('Cross-volume copy, may be slower');
  view.reason.hidden = !job.paused;
  view.reason.textContent = job.paused
    ? trans.__('Paused: %1', job.paused.reason)
    : '';
  view.from.textContent = view.from.title = job.from;
  view.to.textContent = view.to.title = job.to;
  // The last report paints 100 before the dialog closes.
  setBar(view.file, job.done ? 100 : percent(job.file_bytes, job.file_size));
  setBar(view.total, job.done ? 100 : percent(job.bytes, job.bytes_total));
  view.files.textContent = `${group(job.files)} / ${group(job.files_total)}`;
  view.bytes.textContent = trans.__(
    '%1 / %2 GiB',
    gib(job.bytes),
    gib(job.bytes_total)
  );
  view.speed.textContent = trans.__('%1 MiB/s', (speed / MIB).toFixed(0));
  view.elapsed.textContent = clock(job.elapsed);
  view.left.textContent = clock(
    speed > 0 ? (job.bytes_total - job.bytes) / speed : 0
  );
}

/** Close the dialog of `op`, if any; its launch promise then answers Cancel, which the launch handler ignores. */
function closeDialog(op: IOperation): void {
  const dialog = op.dialog;
  op.dialog = null;
  op.view = null;
  dialog?.reject();
}

function hide(op: IOperation): void {
  closeDialog(op);
  op.state = 'hidden';
  changed.emit(undefined);
}

function cancel(op: IOperation): void {
  closeDialog(op);
  // A job that has ended, its dialog held for its last 500 ms, has nothing to cancel.
  if (op.job?.done) {
    return;
  }
  op.state = 'cancelled';
  changed.emit(undefined);
  // The polling goes on until the job reports done.
  requestAPI(`copy/${op.id}`, op.settings, { method: 'DELETE' }).catch(error =>
    console.warn(
      '[jupyterlab_advanced_file_browser_extension] copy could not be cancelled',
      error
    )
  );
}

/**
 * Send Retry or Skip file for the paused job of `op`; its dialog then shows Cancel and Hide
 * again, or goes back to the status bar when the job was hidden as it paused.
 */
function act(op: IOperation, action: string): void {
  requestAPI(`copy/${op.id}`, op.settings, {
    method: 'POST',
    body: JSON.stringify({ action })
  })
    .then(
      () => {
        // This pause has ended, so the next report of one opens the dialog again.
        op.job = { ...op.job!, paused: null };
      },
      error =>
        console.warn(
          '[jupyterlab_advanced_file_browser_extension] copy could not go on',
          error
        )
    )
    .then(() => {
      if (operations.includes(op)) {
        // Still paused after a failed request, it offers the three buttons again.
        if (op.hideAfterPause && !op.job?.paused) {
          hide(op);
        } else {
          open(op);
        }
      }
    });
}

/** Show the dialog of `op`, or show it again for a pause; the dialog shown before hides to the status bar. */
function open(op: IOperation): void {
  closeDialog(op);
  for (const other of operations) {
    if (other !== op && other.state === 'shown') {
      hide(other);
    }
  }
  const trans = op.trans;
  const paused = !!op.job?.paused;
  // Hide, or Retry while paused
  const defaultButton = paused ? 2 : 1;
  const { body, view } = createView(trans);
  const dialog = new Dialog({
    title: op.title,
    body,
    buttons: paused
      ? [
          Dialog.cancelButton({ label: trans.__('Cancel') }),
          Dialog.cancelButton({
            label: trans.__('Skip file'),
            actions: ['skip']
          }),
          Dialog.okButton({ label: trans.__('Retry'), actions: ['retry'] })
        ]
      : [
          Dialog.cancelButton({ label: trans.__('Cancel') }),
          Dialog.okButton({ label: trans.__('Hide') })
        ],
    defaultButton,
    hasClose: false
  });
  dialog.node.setAttribute('aria-label', op.title);
  dialog.addClass('jp-AdvancedFileBrowser-copyDialog');
  dialog.toggleClass('jp-mod-paused', paused);
  // The buttons act on their press, so a press begun as the operation ends still counts.
  dialog.node.addEventListener(
    'mousedown',
    event => {
      const button =
        event.button === 0 &&
        (event.target as Element).closest('.jp-Dialog-button');
      if (button) {
        event.preventDefault();
        dialog.resolve(
          Array.from(dialog.node.querySelectorAll('.jp-Dialog-button')).indexOf(
            button
          )
        );
      }
    },
    true
  );
  // hasClose false leaves the stock Escape inert; here it hides, as Hide does, also while paused.
  dialog.node.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide(op);
      } else if (
        event.key === 'Tab' &&
        document.activeElement === dialog.node
      ) {
        // The first Tab goes to the default button (Hide, or Retry while paused) though Cancel
        // comes first; the stock Tab handler would move on from it at once.
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.node
          .querySelectorAll<HTMLElement>('.jp-Dialog-button')
          [defaultButton].focus();
      }
    },
    true
  );
  // The stock dialog focuses the default button (Hide, or Retry while paused), which shows the ring
  // at once; the focus moves to the dialog itself, so Escape and Enter still reach it and Tab goes
  // to that button.
  dialog.node.tabIndex = -1;
  void dialog.ready.then(() => dialog.node.focus());
  op.dialog = dialog;
  op.view = view;
  op.state = 'shown';
  op.opened = Date.now();
  paint(op);
  changed.emit(undefined);
  dialog.launch().then(
    result => {
      // A dialog closed from here also answers, with Cancel when it never reached the screen.
      if (op.dialog !== dialog) {
        return;
      }
      const [action] = result.button.actions;
      if (action) {
        act(op, action);
      } else if (result.button.accept) {
        hide(op);
      } else {
        cancel(op);
      }
    },
    () => undefined
  );
}

/** Poll the job of `op` to its end; the last report, or null when a progress request fails. */
async function follow(op: IOperation): Promise<IJob | null> {
  const timer = window.setTimeout(() => {
    if (op.state === 'pending') {
      open(op);
    }
  }, PROGRESS_DELAY_MS);
  try {
    for (;;) {
      // The job goes on at the server after a failed progress request, so its outcome is unknown.
      const job = await requestAPI<IJob>(`copy/${op.id}`, op.settings).catch(
        error => (
          console.warn(
            '[jupyterlab_advanced_file_browser_extension] copy progress could not be read',
            error
          ),
          null
        )
      );
      if (!job) {
        return null;
      }
      const pausedBefore = !!op.job?.paused;
      op.job = job;
      if (!job.paused) {
        paint(op);
      } else if (!pausedBefore && op.state !== 'cancelled') {
        // A new pause opens the dialog once, also when hidden; until the pause ends no report
        // repaints it, so its bars stop.
        op.hideAfterPause = op.state === 'hidden';
        open(op);
      }
      changed.emit(undefined);
      if (job.done) {
        return job;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
  } finally {
    window.clearTimeout(timer);
    if (op.state === 'shown') {
      await new Promise(resolve =>
        setTimeout(resolve, op.opened + PROGRESS_MIN_MS - Date.now())
      );
    }
    closeDialog(op);
    operations.splice(operations.indexOf(op), 1);
    changed.emit(undefined);
  }
}

/**
 * Copy or move `paths` into the folder `to` through the server job, with its
 * progress dialog; a move on the destination's volume goes through the stock
 * renameFile. Reports the failures under `title` and resolves with the paths
 * not done.
 */
export async function transfer(
  model: TreeFileBrowserModel,
  paths: string[],
  to: string,
  move: boolean,
  title: string,
  trans: TranslationBundle
): Promise<string[]> {
  const { contents, serverSettings } = model.manager.services;
  // A path on another drive (a zip archive) takes the stock calls, which route by drive.
  if ([to, ...paths].some(path => contents.driveName(path))) {
    const errors: unknown[] = [];
    const failed = await Promise.all(
      paths.map(path =>
        Promise.resolve()
          .then(() =>
            move
              ? renameFile(
                  model.manager,
                  path,
                  PathExt.join(to, PathExt.basename(contents.localPath(path)))
                )
              : model.manager.copy(path, to)
          )
          .then(
            (): string[] => [],
            (error): string[] => {
              if (error !== 'File not renamed') {
                errors.push(error);
              }
              return [path];
            }
          )
      )
    );
    if (errors.length) {
      const [error] = errors;
      void showErrorMessage(
        title,
        error instanceof Error ? error : String(error)
      );
    }
    return ([] as string[]).concat(...failed);
  }
  const target = contents.localPath(to);
  // The request paths, to the paths given.
  const local = new Map<string, string>();
  for (const path of paths) {
    const name = contents.localPath(path);
    // As stock, an item moved onto itself is skipped.
    if (!move || PathExt.join(target, PathExt.basename(name)) !== name) {
      local.set(name, path);
    }
  }
  if (!local.size) {
    return [];
  }
  let start: { id: string | null; rename: string[] };
  try {
    start = await requestAPI<typeof start>('copy', serverSettings, {
      method: 'POST',
      body: JSON.stringify({ paths: [...local.keys()], to: target, move })
    });
  } catch (error) {
    void showErrorMessage(title, error as Error);
    return paths;
  }
  const global = (path: string) => local.get(path) ?? path;
  const renameErrors: unknown[] = [];
  const renamed = Promise.all(
    start.rename.map(path =>
      renameFile(
        model.manager,
        global(path),
        PathExt.join(to, PathExt.basename(path))
      ).then(
        (): string[] => [],
        (error): string[] => {
          if (error !== 'File not renamed') {
            renameErrors.push(error);
          }
          return [global(path)];
        }
      )
    )
  );
  const jobPaths = [...local.keys()].filter(
    path => !start.rename.includes(path)
  );
  let ran: Promise<string[]> = Promise.resolve([]);
  if (start.id) {
    const op: IOperation = {
      id: start.id,
      title: copyTitle(move, jobPaths.length, trans),
      move,
      started: Date.now(),
      state: 'pending',
      job: null,
      settings: serverSettings,
      trans,
      dialog: null,
      view: null,
      opened: 0,
      hideAfterPause: false
    };
    operations.push(op);
    ran = follow(op).then(job => {
      const cancelled = op.state === 'cancelled';
      if (!model.isDisposed) {
        void model.refresh();
      }
      if (!job) {
        void showErrorMessage(
          title,
          move
            ? trans.__(
                'The progress of the move could not be read; it may still be running. Refresh the listing to see what was moved'
              )
            : trans.__(
                'The progress of the copy could not be read; it may still be running. Refresh the listing to see what was copied'
              )
        );
        // Its state is unknown; putting the paths back could copy them twice.
        return [];
      }
      const notDone = job.not_done ?? [];
      if (move) {
        // Open documents follow, as after the stock rename across volumes.
        for (const path of jobPaths.filter(p => !notDone.includes(p))) {
          const name = PathExt.basename(path);
          (
            contents.fileChanged as Signal<
              Contents.IManager,
              Contents.IChangedArgs
            >
          ).emit({
            type: 'rename',
            oldValue: { path },
            newValue: { path: PathExt.join(target, name), name }
          });
        }
      }
      // A cancelled job reports only the partial copies it left, which the user must delete.
      const lines = (job.errors ?? [])
        .filter(({ message }) => !cancelled || message === 'partial copy left')
        .map(({ path, message }) => `${path}: ${message}`);
      if (lines.length) {
        void showErrorMessage(
          title,
          move
            ? trans.__('Not moved: %1', capped(lines, trans))
            : trans.__('Not copied: %1', capped(lines, trans))
        );
      }
      return notDone.map(global);
    });
  }
  const [notRenamed, notRun] = await Promise.all([renamed, ran]);
  if (renameErrors.length) {
    const [error] = renameErrors;
    void showErrorMessage(
      title,
      error instanceof Error ? error : String(error)
    );
  }
  return ([] as string[]).concat(...notRenamed, notRun);
}

/**
 * One status bar item for the hidden operations: the title of one or the count
 * of several, a bar and the percentage of their bytes; a click opens the dialog
 * of the one, or the operations menu of several.
 */
export function addCopyStatus(
  statusBar: IStatusBar,
  trans: TranslationBundle
): void {
  const item = new Widget();
  item.addClass('jp-AdvancedFileBrowser-copyStatus');
  item.addClass('jp-StatusBar-GroupItem');
  item.addClass('jp-mod-highlighted');
  const node = item.node;
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  // Kept at every width, as the percentage is.
  const pausedLabel = add(
    node,
    'span',
    'jp-AdvancedFileBrowser-copyStatusPaused jp-StatusBar-TextItem'
  );
  pausedLabel.textContent = trans.__('Paused');
  const title = add(
    node,
    'span',
    'jp-AdvancedFileBrowser-copyStatusTitle jp-StatusBar-TextItem'
  );
  const total = bar(node, trans.__('Total'));
  total.label.classList.add('jp-StatusBar-TextItem');
  const caret = caretUpIcon.element({ tag: 'span' });
  node.appendChild(caret);

  const rows = new Map<
    IOperation,
    { title: HTMLElement; bar: IBar; detail: HTMLElement }
  >();
  // The popup disposes its body when it closes, so each popup gets a new menu.
  let menu: Widget | null = null;
  let popup: Popup | null = null;

  const hidden = () => operations.filter(op => op.state === 'hidden');
  const paintMenu = (menu: Widget, ops: IOperation[]) => {
    if (ops.length !== rows.size || ops.some(op => !rows.has(op))) {
      menu.node.replaceChildren();
      rows.clear();
      for (const op of ops) {
        const row = add(
          menu.node,
          'button',
          'jp-AdvancedFileBrowser-copyMenuRow'
        );
        row.setAttribute('type', 'button');
        row.setAttribute('role', 'menuitem');
        const rowTitle = add(
          row,
          'span',
          'jp-AdvancedFileBrowser-copyMenuTitle'
        );
        const rowBar = bar(row, op.title);
        const detail = add(
          row,
          'span',
          'jp-AdvancedFileBrowser-copyMenuDetail'
        );
        row.addEventListener('click', () => {
          popup?.dispose();
          open(op);
        });
        rows.set(op, { title: rowTitle, bar: rowBar, detail });
      }
    }
    for (const op of ops) {
      const row = rows.get(op)!;
      const files = op.job?.files_total ?? 0;
      row.title.textContent = op.title;
      setBar(row.bar, totalPercent([op]));
      row.detail.textContent = `${trans._n(
        '%2 file',
        '%2 files',
        files,
        group(files)
      )} · ${timeAgo((Date.now() - op.started) / 1000, trans)}${
        op.job?.paused ? ` · ${trans.__('paused')}` : ''
      }`;
    }
  };

  changed.connect(() => {
    const ops = hidden();
    if (!ops.length) {
      popup?.dispose();
      return;
    }
    title.textContent =
      ops.length === 1 ? ops[0].title : trans.__('%1 operations', ops.length);
    const value = totalPercent(ops);
    setBar(total, value);
    // A hidden paused operation shows until its dialog is opened.
    pausedLabel.hidden = !ops.some(op => op.job?.paused);
    // Below 600 px the title is hidden; the tooltip and the accessible name still name the item.
    node.title = `${pausedLabel.hidden ? '' : `${pausedLabel.textContent}: `}${title.textContent}, ${value}%`;
    node.setAttribute('aria-label', node.title);
    caret.hidden = ops.length < 2;
    if (menu && popup && !popup.isDisposed) {
      paintMenu(menu, ops);
    }
  });
  node.addEventListener('click', () => {
    const ops = hidden();
    if (ops.length === 1) {
      open(ops[0]);
    } else if (popup && !popup.isDisposed) {
      popup.dispose();
    } else if (ops.length) {
      const body = (menu = new Widget());
      body.addClass('jp-AdvancedFileBrowser-copyMenu');
      body.node.setAttribute('role', 'menu');
      body.node.addEventListener('keydown', event => {
        const step =
          event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        const items = Array.from(body.node.children) as HTMLElement[];
        if (step && items.length) {
          event.preventDefault();
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + step + items.length) % items.length].focus();
        }
      });
      rows.clear();
      paintMenu(body, ops);
      popup = showPopup({
        body,
        anchor: item,
        // The hover box moves a menu past the window's right edge back inside, but hides one past
        // its left edge, where a right-aligned menu goes in a narrow window.
        align: 'left',
        hasDynamicSize: true
      });
      // The popup closes on Escape only while the focus is inside it.
      (body.node.firstElementChild as HTMLElement | null)?.focus();
    }
  });
  node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      node.click();
    }
  });
  statusBar.registerStatusItem(
    '@stellarshenson/jupyterlab-advanced-file-browser-extension:copy-status',
    {
      item,
      align: 'right',
      // The right-hand group shows its items from the highest rank on the left to the lowest on
      // the right (the stock items rank -1 to 4), so the highest rank puts this item first.
      rank: 1000,
      // The stock status bar hides priority 0 items at 630px and below; this one shrinks itself.
      priority: 1,
      isActive: () => hidden().length > 0,
      activeStateChanged: changed
    }
  );
}
