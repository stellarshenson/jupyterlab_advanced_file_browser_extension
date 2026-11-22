import {
  Dialog,
  showDialog,
  showErrorMessage,
  Spinner
} from '@jupyterlab/apputils';
import { PageConfig } from '@jupyterlab/coreutils';
import type { Contents } from '@jupyterlab/services';
import type { TranslationBundle } from '@jupyterlab/translation';
import { Panel, Widget } from '@lumino/widgets';

import { isBelow, type TreeFileBrowserModel } from './model';
import { requestAPI } from './request';

export const PROGRESS_DELAY_MS = 1000;
/** The shortest time the progress dialog stays once shown. */
export const PROGRESS_MIN_MS = 500;
export const POLL_MS = 250;
/** The paths a message names before it counts the rest: Delete Failed, and the question about the items not moved to the trash. */
const ERROR_CAP = 10;

/**
 * A removal as GET delete/<id> reports it. `total` and `removed` count entries
 * for a permanent removal, and whole items for the trash.
 */
interface IJob {
  total: number;
  removed: number;
  done: boolean;
  /** Only in the report that says done: each path relative to the server root and the server's short reason. */
  errors?: { path: string; message: string }[];
}

/**
 * The confirm buttons: with the trash on and monitored, Move to Trash is the
 * default; with it on but not monitored, Cancel, the default, and Delete
 * Permanently; with it off, the stock pair with Cancel the default.
 */
export function deleteButtons(
  trash: boolean,
  trans: TranslationBundle,
  monitored = true
): { buttons: Dialog.IButton[]; defaultButton: number } {
  const cancel = Dialog.cancelButton({ label: trans.__('Cancel') });
  return trash && monitored
    ? {
        // Both confirm buttons are red, so the destructive one stands far left, Cancel between it and the default.
        buttons: [
          Dialog.warnButton({ label: trans.__('Delete Permanently') }),
          cancel,
          Dialog.warnButton({ label: trans.__('Move to Trash') })
        ],
        defaultButton: 2
      }
    : {
        buttons: [
          cancel,
          Dialog.warnButton({
            label: trash ? trans.__('Delete Permanently') : trans.__('Delete')
          })
        ],
        defaultButton: 0
      };
}

/** The whole percentage of `done` out of `total`; 0 while the total is unknown. */
export function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0;
}

/** The progress dialog title: the action and the item count. */
export function progressTitle(
  trash: boolean,
  count: number,
  trans: TranslationBundle
): string {
  return trash
    ? trans._n(
        'Moving %1 item to the trash',
        'Moving %1 items to the trash',
        count
      )
    : trans._n('Deleting %1 item', 'Deleting %1 items', count);
}

/** The first ERROR_CAP of `lines`, then the count of the rest. */
export function capped(lines: string[], trans: TranslationBundle): string {
  const shown = lines.slice(0, ERROR_CAP).join('; ');
  const rest = lines.length - ERROR_CAP;
  return rest > 0 ? trans.__('%1; and %2 more', shown, rest) : shown;
}

/** The Delete Failed message: the first ERROR_CAP failures, then the count of the rest. */
export function notRemoved(failed: string[], trans: TranslationBundle): string {
  return trans.__('Not removed: %1', capped(failed, trans));
}

/**
 * The design system's spinner dialog with a progress bar, raised only when the
 * removal is still running 1 s after the confirm, and kept 500 ms once raised.
 */
class Progress {
  constructor(
    private _title: string,
    private _trans: TranslationBundle
  ) {
    this._timer = window.setTimeout(() => this._show(), PROGRESS_DELAY_MS);
  }

  set(value: number): void {
    this._value = value;
    this._paint();
  }

  /** Resolves once the dialog is gone. */
  async close(): Promise<void> {
    window.clearTimeout(this._timer);
    await this._shown;
    this._dialog?.reject();
  }

  private _show(): void {
    this._shown = new Promise(resolve =>
      window.setTimeout(resolve, PROGRESS_MIN_MS)
    );
    const body = new Panel();
    body.addClass('jp-AdvancedFileBrowser-deleteProgress');
    body.addWidget(new Spinner());
    const bar = document.createElement('div');
    bar.className = 'jp-AdvancedFileBrowser-deleteBar';
    this._track.className = 'jp-AdvancedFileBrowser-deleteTrack';
    this._track.setAttribute('role', 'progressbar');
    this._track.setAttribute('aria-label', this._title);
    this._track.setAttribute('aria-valuemin', '0');
    this._track.setAttribute('aria-valuemax', '100');
    this._fill.className = 'jp-AdvancedFileBrowser-deleteFill';
    this._label.className = 'jp-AdvancedFileBrowser-deletePercent';
    this._track.appendChild(this._fill);
    bar.append(this._track, this._label);
    body.node.appendChild(bar);
    const dialog = new Dialog({
      title: this._title,
      body,
      buttons: [Dialog.okButton({ label: this._trans.__('Hide') })],
      hasClose: false
    });
    dialog.addClass('jp-AdvancedFileBrowser-deleteDialog');
    // Hide acts on its press, so a press begun as the removal ends still hides.
    dialog.node.addEventListener(
      'mousedown',
      event => {
        if (
          event.button === 0 &&
          (event.target as Element).closest('.jp-Dialog-button')
        ) {
          event.preventDefault();
          dialog.resolve(0);
        }
      },
      true
    );
    this._dialog = dialog;
    this._paint();
    // close() rejects the dialog, so its launch answers Cancel; the catch covers a dispose elsewhere.
    dialog.launch().catch(() => undefined);
  }

  private _paint(): void {
    const value = `${this._value}`;
    this._fill.style.width = `${value}%`;
    this._label.textContent = `${value}%`;
    this._track.setAttribute('aria-valuenow', value);
  }

  private _dialog: Dialog<unknown> | null = null;
  private _fill = document.createElement('span');
  private _label = document.createElement('span');
  private _shown: Promise<unknown> = Promise.resolve();
  private _timer: number;
  private _track = document.createElement('span');
  private _value = 0;
}

/**
 * Remove the paths through the server job, to the trash or permanently; the failures as
 * lines, or null when a progress request fails after the start.
 */
async function remove(
  model: TreeFileBrowserModel,
  paths: string[],
  trash: boolean,
  progress: Progress
): Promise<string[] | null> {
  const { contents, serverSettings, sessions } = model.manager.services;
  const selected = paths.map(path => contents.localPath(path));
  const within = (path: string, tops: string[]) =>
    tops.some(top => path === top || isBelow(path, top));
  // As DocumentManager.deleteFile does before it deletes, also for the notebooks below a
  // selected folder; as its stopIfNeeded, a failed shutdown does not stop the removal.
  try {
    await sessions.refreshRunning();
    await Promise.all(
      Array.from(sessions.running())
        .filter(
          session =>
            selected.includes(session.path) ||
            (session.type !== 'console' && within(session.path, selected))
        )
        .map(session => sessions.shutdown(session.id))
    );
  } catch {
    // The removal goes on.
  }
  const { id } = await requestAPI<{ id: string }>('delete', serverSettings, {
    method: 'POST',
    body: JSON.stringify({ paths: selected, trash })
  });
  for (;;) {
    // The job goes on at the server after a failed progress request, so its failures are unknown.
    const job = await requestAPI<IJob>(`delete/${id}`, serverSettings).catch(
      error => (
        console.warn(
          '[jupyterlab_advanced_file_browser_extension] delete progress could not be read',
          error
        ),
        null
      )
    );
    if (!job) {
      return null;
    }
    progress.set(percent(job.removed, job.total));
    if (job.done) {
      // As DocumentManager.deleteFile does after it deletes: every view of the document's context closes,
      // clones, Open With views and context.addSibling views alike, also below a removed folder;
      // a path not removed, and every path below it, keeps its tabs.
      const errors = job.errors!;
      const kept = errors.map(e => e.path);
      for (const widget of Array.from(model.shell?.widgets('main') ?? [])) {
        const context = model.manager.contextForWidget(widget);
        const path = context && contents.localPath(context.path);
        if (path && within(path, selected) && !within(path, kept)) {
          widget.dispose();
        }
      }
      return errors.map(({ path, message }) => `${path}: ${message}`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

/** Run one removal job with its progress dialog; the failures as lines, or null as remove() gives. */
async function run(
  model: TreeFileBrowserModel,
  paths: string[],
  trash: boolean,
  trans: TranslationBundle
): Promise<string[] | null> {
  const progress = new Progress(
    progressTitle(trash, paths.length, trans),
    trans
  );
  try {
    const failed = await remove(model, paths, trash, progress);
    if (failed) {
      progress.set(100);
    }
    return failed;
  } catch {
    // The job did not start, so each path counts as not removed, in the server's line form.
    return paths.map(
      path =>
        `${model.manager.services.contents.localPath(path)}: ${trans.__('reason unknown')}`
    );
  } finally {
    await progress.close();
  }
}

/**
 * Confirm and run a Delete of `items` through this extension's server job:
 * Move to Trash, offered when the trash management extension monitors the
 * trash of a selected item, sends those items to the trash, then a second
 * dialog asks to delete the others permanently; Delete Permanently, and Delete
 * with the trash off, remove every item, a folder with content included.
 */
export async function deleteItems(
  model: TreeFileBrowserModel,
  items: Contents.IModel[],
  trans: TranslationBundle
): Promise<void> {
  const trashOn = PageConfig.getOption('delete_to_trash') === 'true';
  const paths = items.map(item => item.path);
  const { contents, serverSettings } = model.manager.services;
  // Whether the trash of each item is monitored; a failed check keeps Move to Trash, as stock.
  const monitored = trashOn
    ? await requestAPI<{ monitored: boolean[] }>(
        'delete/trash-check',
        serverSettings,
        {
          method: 'POST',
          body: JSON.stringify({
            paths: paths.map(path => contents.localPath(path))
          })
        }
      ).then(
        ({ monitored }) => monitored,
        () => paths.map(() => true)
      )
    : paths.map(() => true);
  const trashed = paths.filter((_, i) => monitored[i]);
  const others = paths.filter((_, i) => !monitored[i]);
  // No item monitored: the stock permanent-delete wording and the not-monitored line, no size count.
  const trash = trashOn && trashed.length > 0;
  const count = items.length;
  const name = items[0].name;
  const body = new Widget();
  // The stock wording.
  body.node.textContent = trash
    ? count === 1
      ? trans.__('Are you sure you want to move to trash: %1?', name)
      : trans._n(
          'Are you sure you want to move to trash the %1 selected item?',
          'Are you sure you want to move to trash the %1 selected items?',
          count
        )
    : count === 1
      ? trans.__('Are you sure you want to permanently delete: %1?', name)
      : trans._n(
          'Are you sure you want to permanently delete the %1 selected item?',
          'Are you sure you want to permanently delete the %1 selected items?',
          count
        );
  // One line when the trash of an item is not monitored: the count of such items when Move to Trash
  // is offered for the others, else that the trash is not monitored.
  if (trashOn && others.length) {
    const line = document.createElement('div');
    line.className = 'jp-AdvancedFileBrowser-deleteWarning';
    line.textContent = trash
      ? trans._n(
          '%1 selected item is on a location whose trash is not monitored; after Move to Trash you are asked to delete it permanently',
          '%1 of the selected items are on a location whose trash is not monitored; after Move to Trash you are asked to delete them permanently',
          others.length
        )
      : trans.__(
          'The trash of this location is not monitored, so Move to Trash is not offered'
        );
    body.node.appendChild(line);
  }
  if (trash) {
    // The dialog does not wait for the count of the items to trash; a failed count shows no warning.
    requestAPI<{ over: boolean }>('delete/size', serverSettings, {
      method: 'POST',
      body: JSON.stringify({
        paths: trashed.map(path => contents.localPath(path))
      })
    }).then(
      ({ over }) => {
        // A closed dialog has disposed its body.
        if (over && !body.isDisposed) {
          const warning = document.createElement('div');
          warning.className = 'jp-AdvancedFileBrowser-deleteWarning';
          warning.textContent = trans.__(
            'Moving large files to the trash is not advised'
          );
          warning.setAttribute('role', 'alert');
          body.node.appendChild(warning);
        }
      },
      () => undefined
    );
  }
  const dialog = deleteButtons(trashOn, trans, trash);
  const result = await showDialog({
    title: trans.__('Delete'),
    body,
    ...dialog
  });
  if (!result.button.accept) {
    return;
  }
  // The last button is Move to Trash only when the dialog offered it.
  const toTrash =
    trash && result.button === dialog.buttons[dialog.buttons.length - 1];
  const results = [await run(model, toTrash ? trashed : paths, toTrash, trans)];
  if (toTrash && others.length) {
    // The listing drops the trashed rows before the question about the others.
    await model.refresh();
    const second = await showDialog({
      title: trans.__('Delete'),
      body: trans._n(
        'This item was not moved to the trash, because the trash of its location is not monitored: %2. Delete it permanently?',
        'These %1 items were not moved to the trash, because the trash of their location is not monitored: %2. Delete them permanently?',
        others.length,
        capped(
          others.map(path => contents.localPath(path)),
          trans
        )
      ),
      ...deleteButtons(true, trans, false)
    });
    if (second.button.accept) {
      results.push(await run(model, others, false, trans));
    }
  }
  await model.refresh();
  const failed = ([] as string[]).concat(...results.map(lines => lines ?? []));
  // A job whose progress could not be read names no path: it may still run at the server.
  const message = [
    failed.length ? notRemoved(failed, trans) : '',
    results.includes(null)
      ? trans.__(
          'The progress of the removal could not be read; it may still be running. Refresh the listing to see what was removed'
        )
      : ''
  ]
    .filter(Boolean)
    .join('. ');
  if (message) {
    // With no path reported, the removal is not known to have failed.
    void showErrorMessage(
      failed.length
        ? trans._p('showErrorMessage', 'Delete Failed')
        : trans.__('Delete'),
      message
    );
  }
}
