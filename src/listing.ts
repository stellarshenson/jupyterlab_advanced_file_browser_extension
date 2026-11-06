/*
 * Ported from jupyterlab-unfold 0.3.4 (https://github.com/jupyterlab-contrib/jupyterlab-unfold),
 * src/unfold.ts, and rewritten for JupyterLab 4.6.5.
 *
 * Copyright (c) 2023, Martin Renou
 * All rights reserved.
 * BSD 3-Clause License; the full text is in LICENSE.
 */

import { showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { renameFile } from '@jupyterlab/docmanager';
import { DirListing, FileBrowser } from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';
import { classes, LabIcon } from '@jupyterlab/ui-components';
import { ElementExt } from '@lumino/domutils';
import type { Drag } from '@lumino/dragdrop';
import { MessageLoop } from '@lumino/messaging';
import type { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import folderOpenSvgstr from '../style/icons/folder-open.svg';
import { isBelow, type TreeFileBrowserModel } from './model';

const INDENT_CLASS = 'jp-AdvancedFileBrowser-indent';
const GUIDE_CLASS = 'jp-AdvancedFileBrowser-guide';
const TOGGLE_CLASS = 'jp-AdvancedFileBrowser-toggle';
const SPACER_CLASS = 'jp-AdvancedFileBrowser-toggleSpacer';
const EXPANDED_CLASS = 'jp-mod-expanded';
const ITEM_NAME_CLASS = 'jp-DirListing-itemName';
const ITEM_ICON_CLASS = 'jp-DirListing-itemIcon';
const ITEM_TEXT_CLASS = 'jp-DirListing-itemText';
const DROP_TARGET_CLASS = 'jp-mod-dropTarget';
const CONTENTS_MIME = 'application/x-jupyter-icontents';
// An overlay scrollbar takes no width, so a press this close to the right edge of a scrolling listing counts as one.
const OVERLAY_SCROLLBAR_WIDTH = 16;

export const folderOpenIcon = new LabIcon({
  name: 'jupyterlab-advanced-file-browser-extension:folder-open',
  svgstr: folderOpenSvgstr
});

/**
 * Reorders JupyterLab's sorted rows; `notebooksFirst` is the core setting.
 */
export type ItemOrder = (
  stock: Contents.IModel[],
  state: DirListing.ISortState,
  notebooksFirst: boolean
) => Contents.IModel[];

/**
 * Put each folder's rows directly under the folder, keeping the order of each
 * folder's rows; a row whose folder is not in the list is dropped.
 */
export function treeOrder(
  sorted: readonly Contents.IModel[],
  top: string,
  localPath: (path: string) => string = path => path
): Contents.IModel[] {
  const groups = new Map<string, Contents.IModel[]>();
  for (const item of sorted) {
    const parent = PathExt.dirname(localPath(item.path));
    const group = groups.get(parent);
    if (group) {
      group.push(item);
    } else {
      groups.set(parent, [item]);
    }
  }
  const result: Contents.IModel[] = [];
  const walk = (folder: string): void => {
    for (const item of groups.get(folder) ?? []) {
      result.push(item);
      if (item.type === 'directory') {
        walk(localPath(item.path));
      }
    }
  };
  walk(localPath(top));
  return result;
}

/**
 * The paths that lie below no other path of the list, so an action on a folder
 * does not act on its own rows a second time.
 */
export function outermost(paths: string[]): string[] {
  return paths.filter(p => !paths.some(q => isBelow(p, q)));
}

/**
 * Stock private members of DirListing the tree listing reads or replaces.
 */
interface IListingInternals {
  _sortedItems: Contents.IModel[];
  _items: HTMLElement[];
  _clipboard: string[];
  _isCut: boolean;
  _focusIndex: number;
  _selectTimer: number;
  _sortNotebooksFirst: boolean;
  _selectItem(index: number, keepExisting: boolean, focus?: boolean): void;
  _selectItemByName(
    name: string,
    focus?: boolean,
    force?: boolean
  ): Promise<void>;
}

/**
 * A directory listing that shows unfolded folders in place as a tree while
 * the model's unfolding is on, and the stock listing while it is off.
 */
export class TreeDirListing extends DirListing {
  constructor(options: DirListing.IOptions) {
    super(options);
    const internals = this._internals;
    const stock = internals._selectItemByName.bind(this);
    // The stock selectItemByName and the post-rename selection both call this member.
    internals._selectItemByName = (name, focus = false, force = false) =>
      this.model.unfolding
        ? this._selectItemByPath(
            PathExt.join(this.model.path, name),
            focus,
            force
          )
        : stock(name, focus, force);
  }

  get model(): TreeFileBrowserModel {
    return this._model as TreeFileBrowserModel;
  }

  get itemOrder(): ItemOrder | null {
    return this._itemOrder;
  }

  set itemOrder(value: ItemOrder | null) {
    this._itemOrder = value;
    this.sort(this.sortState);
  }

  sort(state: DirListing.ISortState): void {
    if (this._keepOrder) {
      this.update();
      return;
    }
    super.sort(state);
    this._reorder();
  }

  async restore(id: string): Promise<void> {
    await super.restore(id);
    // The stock restore sorts a saved sort state without calling sort().
    this._reorder();
  }

  rename(): Promise<string> {
    if (!this.model.unfolding) {
      return super.rename();
    }
    const { _sortedItems, _focusIndex } = this._internals;
    const selected = Object.keys(this.selection);
    let path = _sortedItems[_focusIndex]?.path;
    if (!path || !this.selection[path]) {
      path = selected[selected.length - 1];
    }
    if (!path) {
      return super.rename();
    }
    // The stock rename joins model.path with the old name.
    return this.model.withPath(PathExt.dirname(path), () => super.rename());
  }

  copy(): void {
    this._selectOutermost();
    super.copy();
  }

  cut(): void {
    this._selectOutermost();
    super.cut();
  }

  delete(): Promise<void> {
    this._selectOutermost();
    return super.delete();
  }

  paste(): Promise<void> {
    if (!this.model.unfolding) {
      return super.paste();
    }
    // A folder copied into itself or below makes copytree recurse; a move there fails.
    const base = this.model.path;
    const internals = this._internals;
    const beside = !internals._isCut && internals._clipboard.includes(base);
    internals._clipboard = internals._clipboard.filter(
      path => path !== base && !isBelow(base, path)
    );
    // The stock paste of an emptied clipboard clears the cut state without a render.
    this.update();
    const pasted = super.paste();
    if (!beside) {
      return pasted;
    }
    // A copied folder that is the current folder lands beside it, as the stock a-Copy1.
    internals._clipboard = [base];
    return Promise.all([
      pasted,
      this.model.withPath(PathExt.dirname(base), () => super.paste())
    ]).then(() => undefined);
  }

  duplicate(): Promise<void> {
    if (!this.model.unfolding) {
      return super.duplicate();
    }
    // The stock duplicate copies every selected file into model.path, one folder only.
    const manager = this.model.manager;
    const promises: Promise<Contents.IModel>[] = [];
    for (const item of this.selectedItems()) {
      if (item.type !== 'directory') {
        promises.push(manager.copy(item.path, PathExt.dirname(item.path)));
      }
    }
    const trans = this.translator.load('jupyterlab');
    return Promise.all(promises)
      .then(() => undefined)
      .catch(error => {
        void showErrorMessage(
          trans._p('showErrorMessage', 'Duplicate file'),
          error
        );
      });
  }

  handleEvent(event: Event): void {
    if (this.model.unfolding) {
      const onToggle =
        event.target instanceof Element &&
        event.target.closest(`.${TOGGLE_CLASS}`) !== null;
      switch (event.type) {
        case 'mousedown': {
          const mouse = event as MouseEvent;
          if (onToggle && mouse.button === 0) {
            const item = this.modelForClick(mouse);
            if (item) {
              void this.model.toggle(item.path);
            }
            return;
          }
          super.handleEvent(event);
          this._setCurrentFolder(mouse);
          return;
        }
        case 'click':
        case 'dblclick':
          // A click on the triangle neither enters the folder nor runs single-click navigation.
          if (onToggle) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          break;
      }
    }
    super.handleEvent(event);
  }

  protected evtKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (
      this.model.unfolding &&
      (key === 'ArrowRight' || key === 'ArrowLeft') &&
      !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    ) {
      const target = event.target as HTMLElement;
      const internals = this._internals;
      const { _items, _sortedItems } = internals;
      const item = _sortedItems[_items.findIndex(row => row.contains(target))];
      if (
        item &&
        target.classList.contains(ITEM_TEXT_CLASS) &&
        this.selection[item.path] &&
        Object.keys(this.selection).length === 1
      ) {
        const isFolder = item.type === 'directory';
        const unfolded = isFolder && this.model.isUnfolded(item.path);
        // Left that does not fold the row goes to the row's folder, when that folder is a row.
        const parent =
          key === 'ArrowLeft' && !unfolded
            ? _sortedItems.findIndex(
                row => row.path === PathExt.dirname(item.path)
              )
            : -1;
        if (isFolder || parent !== -1) {
          event.preventDefault();
          event.stopPropagation();
          if (parent !== -1) {
            internals._selectItem(parent, false);
            ElementExt.scrollIntoViewIfNeeded(this.contentNode, _items[parent]);
            this._makeCurrent(_sortedItems[parent]);
          } else if ((key === 'ArrowRight') !== unfolded) {
            void this.model.toggle(item.path);
          }
          return;
        }
      }
    }
    super.evtKeydown(event);
    // The stock Up or Down that selects a row calls preventDefault; Ctrl moves the focus only.
    if (
      this.model.unfolding &&
      (key === 'ArrowUp' || key === 'ArrowDown') &&
      !event.ctrlKey &&
      event.defaultPrevented
    ) {
      const { _sortedItems, _focusIndex } = this._internals;
      this._makeCurrent(_sortedItems[_focusIndex]);
    }
  }

  protected evtDrop(event: Drag.Event): void {
    if (!this.model.unfolding) {
      super.evtDrop(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { _items, _sortedItems, _selectTimer } = this._internals;
    clearTimeout(_selectTimer);
    if (event.proposedAction === 'none') {
      event.dropAction = 'none';
      return;
    }
    if (!event.mimeData.hasData(CONTENTS_MIME)) {
      return;
    }

    let target = event.target as HTMLElement;
    while (target && target.parentElement) {
      if (target.classList.contains(DROP_TARGET_CLASS)) {
        target.classList.remove(DROP_TARGET_CLASS);
        break;
      }
      target = target.parentElement;
    }

    // A folder row takes the drop itself, a file row passes it to its folder.
    const item = _sortedItems[_items.indexOf(target)];
    const basePath = !item
      ? this.model.topPath
      : item.type === 'directory'
        ? item.path
        : PathExt.dirname(item.path);
    const manager = this.model.manager;

    if (event.ctrlKey && event.proposedAction === 'move') {
      event.dropAction = 'copy';
    } else {
      event.dropAction = event.proposedAction;
    }
    const promises: Promise<Contents.IModel | null>[] = [];
    for (const path of outermost(
      event.mimeData.getData(CONTENTS_MIME) as string[]
    )) {
      const name = PathExt.basename(manager.services.contents.localPath(path));
      const newPath = PathExt.join(basePath, name);
      // The server's copytree recurses for a folder dropped into itself or below itself.
      if (newPath === path || basePath === path || isBelow(basePath, path)) {
        continue;
      }
      promises.push(
        event.dropAction === 'copy'
          ? manager.copy(path, basePath)
          : renameFile(manager, path, newPath)
      );
    }
    const trans = this.translator.load('jupyterlab');
    Promise.all(promises).catch(error => {
      void showErrorMessage(
        trans._p('showErrorMessage', 'Error while copying/moving files'),
        error
      );
    });
  }

  protected updateNodes(
    items: Contents.IModel[],
    nodes: HTMLElement[],
    sizeOnly = false
  ): void {
    super.updateNodes(items, nodes, sizeOnly);
    if (sizeOnly) {
      return;
    }
    const unfolding = this.model.unfolding;
    const repaint: HTMLElement[] = [];
    items.forEach((item, i) => {
      const node = nodes[i];
      if (!node) {
        return;
      }
      this._decorate(node, item, unfolding);
      const open =
        unfolding &&
        item.type === 'directory' &&
        this.model.isUnfolded(item.path);
      const previous = this._icons.get(node);
      this._icons.set(node, { item, open });
      if (open || previous?.open) {
        repaint.push(node);
      }
    });
    if (repaint.length) {
      // Queued after the renderer's own icon frame, so the open icon is painted last.
      requestAnimationFrame(() => this._paintIcons(repaint));
    }
  }

  private get _internals(): IListingInternals {
    return this as unknown as IListingInternals;
  }

  private _reorder(): void {
    const internals = this._internals;
    let items = internals._sortedItems;
    if (this._itemOrder) {
      items = this._itemOrder(
        items,
        this.sortState,
        internals._sortNotebooksFirst
      );
    }
    if (this.model.unfolding) {
      const contents = this.model.manager.services.contents;
      items = treeOrder(items, this.model.topPath, path =>
        contents.localPath(path)
      );
    }
    internals._sortedItems = items;
  }

  /**
   * The stock name lookup with a path, so a same-named row at another depth
   * is never selected.
   */
  private async _selectItemByPath(
    path: string,
    focus: boolean,
    force: boolean
  ): Promise<void> {
    if (!force && this.selection[path]) {
      return;
    }
    await this.model.refresh();
    if (this.isDisposed) {
      throw new Error('File browser is disposed.');
    }
    const internals = this._internals;
    const index = internals._sortedItems.findIndex(item => item.path === path);
    if (index === -1) {
      throw new Error('Item does not exist.');
    }
    internals._selectItem(index, false, focus);
    // A rename that follows needs the row node now.
    MessageLoop.sendMessage(this, Widget.Msg.UpdateRequest);
    ElementExt.scrollIntoViewIfNeeded(
      this.contentNode,
      internals._items[index]
    );
  }

  /** With unfolding on, deselect each row that a selected folder holds. */
  private _selectOutermost(): void {
    if (!this.model.unfolding) {
      return;
    }
    const selected = Object.keys(this.selection);
    const keep = new Set(outermost(selected));
    for (const path of selected) {
      if (!keep.has(path)) {
        delete this.selection[path];
      }
    }
    this.update();
    if (keep.size < selected.length) {
      (this.selectionChanged as Signal<DirListing, void>).emit(undefined);
    }
  }

  private _setCurrentFolder(event: MouseEvent): void {
    const content = this.contentNode;
    const item = this.modelForClick(event);
    if (item) {
      this._makeCurrent(item);
    } else if (
      // A scrollbar is not the empty area: a classic one lies past clientWidth, an overlay one inside it.
      event.target === content &&
      event.offsetX <
        content.clientWidth -
          (content.scrollHeight > content.clientHeight
            ? OVERLAY_SCROLLBAR_WIDTH
            : 0)
    ) {
      this.clearSelectedItems();
      this.update();
      this._makeCurrent(null);
    }
  }

  /**
   * Make the row's folder current: a folder row itself, a file row its parent;
   * null makes the top folder current.
   */
  private _makeCurrent(item: Contents.IModel | null): void {
    // The rows stay the same, so the `refreshed` this emits needs no re-sort.
    this._keepOrder = true;
    this.model.setCurrentFolder(
      !item
        ? null
        : item.type === 'directory'
          ? item.path
          : PathExt.dirname(item.path)
    );
    this._keepOrder = false;
  }

  private _decorate(
    node: HTMLElement,
    item: Contents.IModel,
    unfolding: boolean
  ): void {
    const name = node.querySelector<HTMLElement>(`.${ITEM_NAME_CLASS}`);
    if (!name) {
      return;
    }
    if (!unfolding) {
      name
        .querySelectorAll(
          `.${INDENT_CLASS}, .${TOGGLE_CLASS}, .${SPACER_CLASS}`
        )
        .forEach(element => element.remove());
      return;
    }

    let indent = name.firstElementChild as HTMLElement | null;
    if (!indent?.classList.contains(INDENT_CLASS)) {
      indent = document.createElement('span');
      indent.className = INDENT_CLASS;
      name.prepend(indent);
    }
    const depth = this.model.depth(item.path);
    while (indent.childElementCount > depth) {
      indent.lastElementChild?.remove();
    }
    while (indent.childElementCount < depth) {
      const guide = document.createElement('span');
      guide.className = GUIDE_CLASS;
      indent.appendChild(guide);
    }

    let marker = indent.nextElementSibling as HTMLElement | null;
    if (
      !marker?.classList.contains(TOGGLE_CLASS) &&
      !marker?.classList.contains(SPACER_CLASS)
    ) {
      marker = document.createElement('span');
      marker.setAttribute('aria-hidden', 'true');
      indent.after(marker);
    }
    const isFolder = item.type === 'directory';
    const expanded = isFolder && this.model.isUnfolded(item.path);
    marker.className = isFolder ? TOGGLE_CLASS : SPACER_CLASS;
    marker.classList.toggle(EXPANDED_CLASS, expanded);
    const glyph = isFolder ? (expanded ? '▾' : '▸') : '';
    if (marker.textContent !== glyph) {
      marker.textContent = glyph;
    }
  }

  /**
   * Paint the open icon on unfolded folder rows and the file-type icon back on
   * rows that showed it; reads the row's latest state, not the queued one.
   */
  private _paintIcons(nodes: HTMLElement[]): void {
    for (const node of nodes) {
      const state = this._icons.get(node);
      const container = node.querySelector<HTMLElement>(`.${ITEM_ICON_CLASS}`);
      if (!state || !container) {
        continue;
      }
      const showsOpen =
        (container.firstElementChild as HTMLElement | null)?.dataset.icon ===
        folderOpenIcon.name;
      if (state.open && !showsOpen) {
        folderOpenIcon.element({
          container,
          className: ITEM_ICON_CLASS,
          stylesheet: 'listing'
        });
      } else if (!state.open && showsOpen) {
        const { icon, iconClass } =
          this.model.manager.registry.getFileTypeForModel(state.item);
        LabIcon.resolveElement({
          icon,
          iconClass: classes(iconClass, 'jp-Icon'),
          container,
          className: ITEM_ICON_CLASS,
          stylesheet: 'listing'
        });
      }
    }
  }

  private _itemOrder: ItemOrder | null = null;
  private _keepOrder = false;
  private _icons = new WeakMap<
    HTMLElement,
    { item: Contents.IModel; open: boolean }
  >();
}

export namespace TreeFileBrowser {
  export interface IOptions extends FileBrowser.IOptions {
    model: TreeFileBrowserModel;
  }
}

/**
 * The stock file browser with a tree listing; new items land in the current
 * folder, which is unfolded first so the new row shows under it.
 */
export class TreeFileBrowser extends FileBrowser {
  constructor(options: TreeFileBrowser.IOptions) {
    super(options);
  }

  declare readonly model: TreeFileBrowserModel;

  get itemOrder(): ItemOrder | null {
    return (this.listing as TreeDirListing).itemOrder;
  }

  set itemOrder(value: ItemOrder | null) {
    (this.listing as TreeDirListing).itemOrder = value;
  }

  async createNewDirectory(): Promise<Contents.IModel> {
    await this._unfoldCurrent();
    return super.createNewDirectory();
  }

  async createNewFile(
    options: FileBrowser.IFileOptions
  ): Promise<Contents.IModel> {
    await this._unfoldCurrent();
    return super.createNewFile(options);
  }

  protected createDirListing(options: DirListing.IOptions): DirListing {
    return new TreeDirListing(options);
  }

  private async _unfoldCurrent(): Promise<void> {
    const model = this.model;
    if (
      model.unfolding &&
      model.path !== model.topPath &&
      !model.isUnfolded(model.path)
    ) {
      await model.unfold(model.path);
    }
  }
}
