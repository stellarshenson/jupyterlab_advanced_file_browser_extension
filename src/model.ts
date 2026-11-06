/*
 * Ported from jupyterlab-unfold 0.3.4 (https://github.com/jupyterlab-contrib/jupyterlab-unfold),
 * src/unfold.ts, and rewritten for JupyterLab 4.6.5.
 *
 * Copyright (c) 2023, Martin Renou
 * All rights reserved.
 * BSD 3-Clause License; the full text is in LICENSE.
 */

import { PathExt } from '@jupyterlab/coreutils';
import {
  FileBrowserModel,
  FilterFileBrowserModel
} from '@jupyterlab/filebrowser';
import type { Contents } from '@jupyterlab/services';
import type { IStateDB } from '@jupyterlab/statedb';
import type { Signal } from '@lumino/signaling';

export namespace TreeFileBrowserModel {
  export interface IOptions extends FilterFileBrowserModel.IOptions {
    /**
     * Whether folders unfold in place; default false.
     */
    unfolding?: boolean;
  }
}

/**
 * A file browser model that lists the unfolded folders below the folder last
 * entered (the top folder) and keeps a current folder apart from it.
 */
export class TreeFileBrowserModel extends FilterFileBrowserModel {
  constructor(options: TreeFileBrowserModel.IOptions) {
    super(options);
    this._unfolding = options.unfolding ?? false;
    this._stateDB = options.state ?? null;
  }

  get unfolding(): boolean {
    return this._unfolding;
  }

  set unfolding(value: boolean) {
    if (value === this._unfolding) {
      return;
    }
    this._unfolding = value;
    this._current = null;
    void this.refresh();
  }

  /**
   * The folder last entered; the listing's top level shows its contents.
   */
  get topPath(): string {
    return super.path;
  }

  /**
   * The current folder while unfolding is on, else the top folder.
   */
  get path(): string {
    if (this._pathOverride !== null) {
      return this._pathOverride;
    }
    return this._unfolding && this._current !== null
      ? this._current
      : super.path;
  }

  setCurrentFolder(path: string | null): void {
    if (!this._unfolding) {
      return;
    }
    const value =
      path === null || this._local(path) === this._local(this.topPath)
        ? null
        : path;
    if (value === this._current) {
      return;
    }
    this._current = value;
    // refreshed, not pathChanged: pathChanged listeners clear the selection, the filter and the focus
    this._emitRefreshed();
  }

  isUnfolded(path: string): boolean {
    return this._unfolded.has(path);
  }

  async toggle(path: string): Promise<void> {
    if (this._unfolded.delete(path)) {
      this._save();
      this._checkCurrent();
      this._emitRefreshed();
      return;
    }
    this._unfolded.add(path);
    this._save();
    await this.refresh();
  }

  /**
   * Unfold a folder below the top folder and every folder between them.
   */
  async unfold(path: string): Promise<void> {
    const top = this._local(this.topPath);
    let folder = this._local(path);
    if (!isBelow(folder, top)) {
      return;
    }
    let added = false;
    for (; folder.length > top.length; folder = PathExt.dirname(folder)) {
      const global = this.rootPath + folder;
      if (!this._unfolded.has(global)) {
        this._unfolded.add(global);
        added = true;
      }
    }
    if (!added) {
      return;
    }
    this._save();
    await this.refresh();
  }

  /**
   * Number of folders between the row and the top folder.
   */
  depth(path: string): number {
    const top = this._local(this.topPath);
    const local = this._local(path);
    return local.slice(top ? top.length + 1 : 0).split('/').length - 1;
  }

  /**
   * Run `fn` while `path` reads `folder`, without a signal.
   */
  async withPath<T>(folder: string, fn: () => Promise<T>): Promise<T> {
    const previous = this._pathOverride;
    this._pathOverride = folder;
    try {
      return await fn();
    } finally {
      this._pathOverride = previous;
    }
  }

  items(): IterableIterator<Contents.IModel> {
    if (!this._unfolding) {
      return super.items();
    }
    const passing = new Set(super.items());
    const top = this._local(this.topPath);
    // A folder holding a match stays listed, so the match keeps its place in the tree.
    const holding = new Set<string>();
    for (const item of passing) {
      let dir = PathExt.dirname(this._local(item.path));
      while (dir.length > top.length && !holding.has(dir)) {
        holding.add(dir);
        dir = PathExt.dirname(dir);
      }
    }
    const unfolded = new Set(Array.from(this._unfolded, p => this._local(p)));
    const listed = new Set<string>();
    const result: Contents.IModel[] = [];
    for (const item of FileBrowserModel.prototype.items.call(this)) {
      const path = this._local(item.path);
      const parent = PathExt.dirname(path);
      if (parent !== top && !(listed.has(parent) && unfolded.has(parent))) {
        continue;
      }
      const isFolder = item.type === 'directory';
      const shown =
        passing.has(item) ||
        (isFolder &&
          holding.has(path) &&
          (this.includeHiddenFiles || !item.name.startsWith('.')));
      if (!shown) {
        continue;
      }
      if (isFolder) {
        listed.add(path);
      }
      result.push(item);
    }
    return result[Symbol.iterator]();
  }

  async cd(path = '.'): Promise<void> {
    if (!this._unfolding) {
      return super.cd(path);
    }
    if (path === '.') {
      return this._refreshTree();
    }
    const navigation = this._navigate(path);
    this._navigation = navigation;
    try {
      await navigation;
    } finally {
      if (this._navigation === navigation) {
        this._navigation = null;
      }
    }
  }

  async restore(id: string, populate = true): Promise<void> {
    const state = this._stateDB;
    if (state && this._stateKey === null) {
      const key = `advanced-file-browser:${id}:unfolded`;
      this._stateKey = key;
      try {
        const value = (await state.fetch(key)) as
          { paths?: string[] } | undefined;
        for (const path of value?.paths ?? []) {
          this._unfolded.add(path);
        }
      } catch {
        void state.remove(key);
      }
    }
    await super.restore(id, populate);
    // The first poll may have listed the top folder before the saved set arrived.
    if (this._unfolding && this._unfolded.size > 0) {
      await this.refresh();
    }
  }

  async upload(file: File, path?: string): Promise<Contents.IModel> {
    if (!this._unfolding) {
      return super.upload(file, path);
    }
    const target = path ?? this.path;
    // Loads the target's rows for the overwrite prompt and shows the new row under its folder.
    if (target === this.path && target !== this.topPath) {
      await this.unfold(target);
    }
    // The stock prompt matches the name against `_items`, every loaded row; the stock
    // upload runs on a view of this model whose `_items` holds the target's rows only.
    const folder = this._local(target);
    const view = Object.create(this, {
      _items: {
        get: () =>
          Array.from(FileBrowserModel.prototype.items.call(this)).filter(
            item => PathExt.dirname(this._local(item.path)) === folder
          )
      }
    });
    return FileBrowserModel.prototype.upload.call(view, file, target);
  }

  protected handleContents(contents: Contents.IModel): void {
    if (!this._unfolding) {
      super.handleContents(contents);
      return;
    }
    // Parents precede children, so items() decides each row after its folder.
    let content: Contents.IModel[] = contents.content;
    const loaded = new Map<string, Contents.IModel[]>();
    for (const folder of this._visibleUnfolded(contents.path)) {
      const children = this._loaded.get(folder);
      if (children) {
        loaded.set(folder, children);
        content = content.concat(children);
      }
    }
    this._loaded = loaded;
    super.handleContents({ ...contents, content });
    this._checkCurrent();
  }

  protected onFileChanged(
    sender: Contents.IManager,
    change: Contents.IChangedArgs
  ): void {
    super.onFileChanged(sender, change);
    if (!this._unfolding) {
      return;
    }
    const folders = new Set(
      this._visibleUnfolded(this.topPath).map(p => this._local(p))
    );
    const nested = [change.oldValue, change.newValue].some(
      value =>
        !!value?.path && folders.has(PathExt.dirname(this._local(value.path)))
    );
    if (nested) {
      void this.refresh();
    }
  }

  private async _navigate(path: string): Promise<void> {
    this._navigationCount++;
    // The stock cd compares the old and new path; the top folder makes pathChanged fire as in stock.
    this._current = null;
    const target = this.manager.services.contents.resolvePath(
      this.topPath,
      path
    );
    this._merge(await this._fetchUnfolded(target));
    await super.cd(path);
  }

  private async _refreshTree(): Promise<void> {
    if (this._navigation) {
      await this._navigation.catch(() => undefined);
    }
    const count = this._navigationCount;
    const { contents, sessions } = this.manager.services;
    let top: Contents.IModel;
    let fetched: Map<string, Contents.IModel[]>;
    try {
      [top, fetched] = await Promise.all([
        contents.get(this.topPath, { content: true }),
        this._fetchUnfolded(this.topPath)
      ]);
    } catch {
      if (count === this._navigationCount && !this.isDisposed) {
        // The stock refresh handles a vanished top folder and a lost connection.
        this._current = null;
        await super.cd('.');
      }
      return;
    }
    if (count !== this._navigationCount || this.isDisposed) {
      return;
    }
    this._merge(fetched);
    this.handleContents(top);
    this.onRunningChanged(sessions, sessions.running());
  }

  private async _fetchUnfolded(
    top: string
  ): Promise<Map<string, Contents.IModel[]>> {
    const contents = this.manager.services.contents;
    const fetched = new Map<string, Contents.IModel[]>();
    let removed = false;
    await Promise.all(
      this._visibleUnfolded(top).map(async folder => {
        try {
          const model = await contents.get(folder, { content: true });
          fetched.set(folder, model.content);
        } catch (error) {
          if ((error as { response?: Response }).response?.status === 404) {
            this._unfolded.delete(folder);
            removed = true;
          } else {
            fetched.set(folder, []);
          }
        }
      })
    );
    if (removed) {
      this._save();
    }
    return fetched;
  }

  /**
   * Unfolded folders whose rows can show under `top`, shallow first.
   */
  private _visibleUnfolded(top: string): string[] {
    const local = this._local(top);
    const unfolded = new Set(Array.from(this._unfolded, p => this._local(p)));
    const visible: { path: string; depth: number }[] = [];
    for (const path of this._unfolded) {
      const folder = this._local(path);
      if (!isBelow(folder, local)) {
        continue;
      }
      const segments = folder.slice(local ? local.length + 1 : 0).split('/');
      if (
        !this.includeHiddenFiles &&
        segments.some(segment => segment.startsWith('.'))
      ) {
        continue;
      }
      let parent = PathExt.dirname(folder);
      while (parent.length > local.length && unfolded.has(parent)) {
        parent = PathExt.dirname(parent);
      }
      if (parent.length > local.length) {
        continue;
      }
      visible.push({ path, depth: segments.length });
    }
    return visible.sort((a, b) => a.depth - b.depth).map(v => v.path);
  }

  private _merge(fetched: Map<string, Contents.IModel[]>): void {
    fetched.forEach((children, folder) => this._loaded.set(folder, children));
  }

  /**
   * Return to the top folder when the current folder is no longer a listed row.
   */
  private _checkCurrent(): void {
    const current = this._current;
    if (current === null) {
      return;
    }
    for (const item of this.items()) {
      if (item.path === current && item.type === 'directory') {
        return;
      }
    }
    this._current = null;
  }

  private _emitRefreshed(): void {
    (this.refreshed as Signal<this, void>).emit(undefined);
  }

  private _save(): void {
    if (this._stateDB && this._stateKey) {
      void this._stateDB.save(this._stateKey, {
        paths: Array.from(this._unfolded)
      });
    }
  }

  private _local(path: string): string {
    return this.manager.services.contents.localPath(path);
  }

  private _unfolding = false;
  private _unfolded = new Set<string>();
  private _loaded = new Map<string, Contents.IModel[]>();
  private _current: string | null = null;
  private _pathOverride: string | null = null;
  private _navigation: Promise<void> | null = null;
  private _navigationCount = 0;
  private _stateDB: IStateDB | null = null;
  private _stateKey: string | null = null;
}

export function isBelow(path: string, top: string): boolean {
  return top === '' ? path !== '' : path.startsWith(top + '/');
}
