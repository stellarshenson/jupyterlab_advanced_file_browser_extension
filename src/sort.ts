import type { DirListing } from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';

/**
 * Compare two names in LC_COLLATE=C order.
 *
 * Char codes rather than a locale, as the replaced
 * jupyterlab_file_browser_sorting_extension compares them.
 */
export function compareBytes(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const difference = a.charCodeAt(i) - b.charCodeAt(i);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}

export interface ISortOptions {
  unix: boolean;
  notebooksFirst: boolean;
}

/**
 * Reorder JupyterLab's sorted items for Unix Style Sorting.
 *
 * Only the name key is reordered: size and date sorts keep JupyterLab's
 * order and direction.
 */
export function sortItems(
  stock: readonly Contents.IModel[],
  state: DirListing.ISortState,
  options: ISortOptions
): Contents.IModel[] {
  if (!options.unix || state.key !== 'name') {
    return [...stock];
  }
  // The name suffix, not the type, as the replaced extension: Jupytext
  // types .md and .py files as notebooks too.
  const group = (item: Contents.IModel): number => {
    if (item.type === 'directory') {
      return 0;
    }
    return options.notebooksFirst && item.name.endsWith('.ipynb') ? 1 : 2;
  };
  const direction = state.direction === 'descending' ? -1 : 1;
  return [...stock].sort(
    (a, b) => group(a) - group(b) || direction * compareBytes(a.name, b.name)
  );
}
