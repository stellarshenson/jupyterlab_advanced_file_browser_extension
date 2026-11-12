/**
 * Drag source for the file browser's breadcrumbs.
 *
 * JupyterLab makes the crumbs a drop target - dropping files on one moves
 * them into that directory - but never a drag source. This module makes each
 * crumb draggable, so the directory it names can be dropped onto a terminal,
 * an editor or a notebook exactly as a folder dragged out of the listing can.
 */

import { MimeData } from '@lumino/coreutils';
import { Drag } from '@lumino/dragdrop';

import { crumbContentsPath, PATH_MIME } from './dragPaths';

/** The file browser's breadcrumb bar. */
const BREADCRUMBS_SELECTOR = '.jp-BreadCrumbs';

/**
 * How far the pointer must travel before a press on a crumb becomes a drag,
 * in pixels. This is the file listing's own threshold, so a press that holds
 * still reaches the breadcrumb as a click and navigates as it always did.
 */
const DRAG_THRESHOLD = 5;

/**
 * The crumb an event landed on, or `null` when it landed on none.
 *
 * The home and preferred crumbs render an icon, so the event target is the
 * `svg` inside the crumb rather than the crumb itself; `closest` walks up to
 * the element that carries the path either way.
 */
function crumbAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const crumb = target.closest<HTMLElement>('[data-path]');
  return crumb && crumb.closest(BREADCRUMBS_SELECTOR) ? crumb : null;
}

/**
 * The element shown under the pointer for the duration of the drag.
 *
 * It carries the file listing's item class, and Lumino adds
 * `lm-mod-drag-image`, which together are the selector JupyterLab's own
 * stylesheet paints the listing's drag image with - so a crumb drag looks
 * like a file drag without this extension shipping any CSS of its own.
 */
function createDragImage(path: string): HTMLElement {
  const image = document.createElement('div');
  image.className = 'jp-DirListing-item';
  const text = document.createElement('span');
  text.className = 'jp-DirListing-itemText';
  // The last segment is what the crumb itself shows; the root shows a slash.
  text.textContent = path === '' ? '/' : path.slice(path.lastIndexOf('/') + 1);
  image.appendChild(text);
  return image;
}

/**
 * Make the file browser's breadcrumbs a drag source.
 *
 * The listener sits on the document rather than on a breadcrumb node: the
 * widget rebuilds its crumbs on every directory change, so a listener bound
 * to one crumb would not survive the first navigation, and a single
 * registration covers every file browser in the application.
 */
export function attachCrumbDragSource(isEnabled: () => boolean): void {
  document.addEventListener('mousedown', (event: MouseEvent) => {
    if (event.button !== 0 || !isEnabled()) {
      return;
    }
    const crumb = crumbAt(event.target);
    const path = crumb ? crumbContentsPath(crumb.dataset.path) : null;
    if (crumb === null || path === null) {
      return;
    }
    // The listing's rows carry `user-select: none`; the crumbs carry none, so
    // without this a press starts a text selection as well as a drag.
    // Suppressing the default here rather than in CSS leaves the crumbs
    // selectable by hand whenever this extension is switched off.
    event.preventDefault();
    const pressX = event.clientX;
    const pressY = event.clientY;

    const gesture = new AbortController();
    const stop = (): void => gesture.abort();

    const onMove = (move: MouseEvent): void => {
      if (
        Math.abs(move.clientX - pressX) < DRAG_THRESHOLD &&
        Math.abs(move.clientY - pressY) < DRAG_THRESHOLD
      ) {
        return;
      }
      stop();
      const mimeData = new MimeData();
      mimeData.setData(PATH_MIME, [path]);
      void new Drag({
        mimeData,
        dragImage: createDragImage(path),
        supportedActions: 'copy',
        proposedAction: 'copy',
        source: crumb
      }).start(move.clientX, move.clientY);
    };

    document.addEventListener('mousemove', onMove, {
      capture: true,
      signal: gesture.signal
    });
    document.addEventListener('mouseup', stop, {
      capture: true,
      signal: gesture.signal
    });
  });
}
