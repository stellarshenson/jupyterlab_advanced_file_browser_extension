/*
 * Ported from jupyterlab-unfold 0.3.4 (https://github.com/jupyterlab-contrib/jupyterlab-unfold),
 * src/unfold.ts, and rewritten for JupyterLab 4.6.5.
 *
 * Copyright (c) 2023, Martin Renou
 * All rights reserved.
 * BSD 3-Clause License; the full text is in LICENSE.
 */

import type { JupyterFrontEnd } from '@jupyterlab/application';
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

    /**
     * The application shell; a Delete closes the views of the removed documents in its main area.
     */
    shell?: JupyterFrontEnd.IShell;
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
    this.shell = options.shell ?? null;
  }

  readonly shell: JupyterFrontEnd.IShell | null;

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
      for (const other of Array.from(this._unfolded)) {
        if (isBelow(this._local(other), this._local(path))) {
          this._unfolded.delete(other);
        }
      }
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
    await this._cd(path);
    // The read kept changes shown from answers that came while it was in flight, so a read
    // started now confirms them; Poll drops a refresh asked during a refresh tick.
    if (this._unconfirmed && !this.isDisposed) {
      this._unconfirmed = false;
      await this.cd('.');
    }
  }

  private async _cd(path: string): Promise<void> {
    if (!this._unfolding) {
      return super.cd(path);
    }
    if (path === '.') {
      // A refresh tick that only creates asked for joins every create read in flight; a
      // refresh() or another change during them makes the tick read the whole tree after them.
      const tick = this._pollTick;
      if (this._created.size > 0 && this._createTick === tick) {
        await Promise.all(
          Array.from(this._created.values(), created => created.read)
        );
        if (this._createTick === tick) {
          return;
        }
      }
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

  /**
   * Join a create's read of `folder` in flight (`_readCreated`), starting it now when it is
   * queued, so a create waits for one read of its folder as in stock; else refresh.
   */
  async refreshFolder(folder: string): Promise<void> {
    const created = this._created.get(folder);
    if (created) {
      return created.start();
    }
    return this.refresh();
  }

  async refresh(): Promise<void> {
    // A refresh asked for while a create's tick is pending reads the whole tree.
    this._createTick = null;
    return super.refresh();
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
    // A stock cd read; it started before an answer when it was the stock read in flight then.
    // Without the stock private it keeps nothing, so a kept change cannot re-read without end.
    const pending = this._stockPending;
    this._handle(
      this._keep(contents, shown => !!pending && shown.pending === pending)
    );
  }

  private _handle(contents: Contents.IModel): void {
    this._top = contents;
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
    this._showChange(change);
    const create = this._readCreated(change);
    const tick = this._pollTick;
    const joined = this._createTick === tick;
    // The stock refresh, and the one below for a nested folder, re-read to confirm the change.
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
    // A tick that only creates asked for joins the create's read (_cd); any other reads the tree.
    this._createTick =
      create && (this._pollTick !== tick || joined) ? this._pollTick : null;
  }

  /**
   * Show a new or renamed item from the server answer, in its folder when that folder is listed.
   */
  private _showChange(change: Contents.IChangedArgs): void {
    const item = change.newValue as Contents.IModel | null;
    const top = this._top;
    if (
      !top ||
      (change.type !== 'new' && change.type !== 'rename') ||
      !item?.path ||
      !item.name ||
      !item.type ||
      // A path of another drive can have the same local folder.
      this.manager.services.contents.driveName(item.path) !== this.driveName
    ) {
      return;
    }
    const contents = this._withChange(top, change);
    if (contents) {
      this._shown.push({
        change,
        read: this._reads,
        pending: this._stockPending
      });
      this._handle(contents);
      this._emitRefreshed();
    }
  }

  /**
   * `contents` of a read with the shown changes that `inFlight` keeps applied again: those from
   * answers that came while it was in flight, or in a folder it did not read; the other shown
   * changes are dropped, since the read started after them.
   */
  private _keep(
    contents: Contents.IModel,
    inFlight: (shown: IShownChange) => boolean
  ): Contents.IModel {
    this._shown = this._shown.filter(inFlight);
    // A read started after an answer, such as a create's read of its folder, confirms it.
    this._unconfirmed = this._shown.some(shown => shown.read === this._reads);
    return this._shown.reduce(
      (top, { change }) => this._withChange(top, change) ?? top,
      contents
    );
  }

  /**
   * `top` with `change` applied, and the loaded unfolded folders changed in place; null when no
   * listed row changes.
   */
  private _withChange(
    top: Contents.IModel,
    change: Contents.IChangedArgs
  ): Contents.IModel | null {
    const item = change.newValue as Contents.IModel;
    const gone = [item.path, change.oldValue?.path];
    const folder = PathExt.dirname(this._local(item.path));
    let changed = false;
    const update = (path: string, rows: Contents.IModel[]) => {
      const kept = rows.filter(row => !gone.includes(row.path));
      const own = this._local(path) === folder;
      if (own) {
        kept.push(item);
      }
      changed ||= own || kept.length < rows.length;
      return kept;
    };
    const content = update(top.path, top.content);
    if (this._unfolding) {
      this._loaded.forEach((rows, path) =>
        this._loaded.set(path, update(path, rows))
      );
    }
    return changed ? { ...top, content } : null;
  }

  /**
   * One read per create and per folder: start the read of a new item's listed folder, as stock
   * reads its one folder; the refresh and the select the create starts join it. While a create
   * read of that folder is in flight, one read is queued after it and the later creates there
   * join it, also when a create in another folder was answered since, so a Paste of n items
   * reads its folder twice, not n times; a create's select starts the queued read at once
   * (refreshFolder). False for any other change.
   */
  private _readCreated(change: Contents.IChangedArgs): boolean {
    const item = change.newValue;
    if (!this._unfolding || change.type !== 'new' || !item?.path) {
      return false;
    }
    const local = PathExt.dirname(this._local(item.path));
    const folder = [this.topPath, ...this._visibleUnfolded(this.topPath)].find(
      path => this._local(path) === local
    );
    if (folder === undefined) {
      return false;
    }
    const previous = this._created.get(folder);
    if (previous?.queued) {
      return true;
    }
    let started: Promise<void> | null = null;
    const created = {
      queued: !!previous,
      read: Promise.resolve(),
      start: (): Promise<void> => {
        created.queued = false;
        return (started ??= this._refreshTree(folder));
      }
    };
    created.read = previous
      ? previous.read.then(created.start, created.start)
      : created.start();
    this._created.set(folder, created);
    const clear = () => {
      if (this._created.get(folder) === created) {
        this._created.delete(folder);
      }
    };
    void created.read.then(clear, clear);
    return true;
  }

  private async _navigate(path: string): Promise<void> {
    this._navigationCount++;
    // The stock cd compares the old and new path; the top folder makes pathChanged fire as in stock.
    this._current = null;
    const target = this.manager.services.contents.resolvePath(
      this.topPath,
      path
    );
    this._merge(await this._fetchUnfolded(this._visibleUnfolded(target)));
    await super.cd(path);
  }

  /**
   * Re-read the top folder and every visible unfolded folder; with `folder`, only that folder
   * and the visible unfolded folders not loaded yet, while the other folders keep their rows.
   */
  private async _refreshTree(folder?: string): Promise<void> {
    if (this._navigation) {
      await this._navigation.catch(() => undefined);
    }
    const count = this._navigationCount;
    const read = ++this._reads;
    const { contents, sessions } = this.manager.services;
    const visible = this._visibleUnfolded(this.topPath);
    const shownTop =
      folder !== undefined && folder !== this.topPath ? this._top : null;
    let top: Contents.IModel;
    let fetched: Map<string, Contents.IModel[]>;
    try {
      [top, fetched] = await Promise.all([
        shownTop ?? contents.get(this.topPath, { content: true }),
        this._fetchUnfolded(
          folder === undefined
            ? visible
            : visible.filter(path => path === folder || !this._loaded.has(path))
        )
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
    // Per folder, a read older than one already applied there would undo the newer rows.
    const stale = (path: string) => (this._applied.get(path) ?? 0) > read;
    for (const path of fetched.keys()) {
      if (stale(path)) {
        fetched.delete(path);
      }
    }
    const ownTop = shownTop === null && !stale(this.topPath);
    if (!ownTop && fetched.size === 0) {
      return;
    }
    const applied = [...fetched.keys(), ...(ownTop ? [this.topPath] : [])];
    applied.forEach(path => this._applied.set(path, read));
    const local = new Set(applied.map(path => this._local(path)));
    // A read of some folders confirms only the changes in the folders it applied.
    const confirms = ({ change, read: before }: IShownChange) =>
      before < read &&
      (folder === undefined ||
        [change.newValue?.path, change.oldValue?.path].every(
          path => !path || local.has(PathExt.dirname(this._local(path)))
        ));
    this._merge(fetched);
    this._handle(
      this._keep(ownTop ? top : (this._top ?? top), shown => !confirms(shown))
    );
    this.onRunningChanged(sessions, sessions.running());
  }

  private async _fetchUnfolded(
    folders: string[]
  ): Promise<Map<string, Contents.IModel[]>> {
    const contents = this.manager.services.contents;
    const fetched = new Map<string, Contents.IModel[]>();
    let removed = false;
    await Promise.all(
      folders.map(async folder => {
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

  /** The stock model's poll tick, of the stock private `_poll`; each scheduled refresh replaces it. */
  private get _pollTick(): Promise<unknown> {
    return (this as unknown as { _poll: { tick: Promise<unknown> } })._poll
      .tick;
  }

  /** The stock cd's listing read in flight, the stock model's private `_pending`. */
  private get _stockPending(): Promise<void> | null {
    return (this as unknown as { _pending: Promise<void> | null })._pending;
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
  /** The top folder as last read, without the unfolded folders' rows. */
  private _top: Contents.IModel | null = null;
  /** Changes shown from answers that no read started after the answer has replaced yet. */
  private _shown: IShownChange[] = [];
  /** Tree reads started. */
  private _reads = 0;
  /** The newest tree read applied to each folder read, the top folder or an unfolded folder. */
  private _applied = new Map<string, number>();
  private _unconfirmed = false;
  /** Each folder's read of a new item in flight, or queued after one in flight until it starts. */
  private _created = new Map<
    string,
    {
      queued: boolean;
      read: Promise<void>;
      /** Starts the read at most once; on a queued read, before the read it is queued after ends. */
      start: () => Promise<void>;
    }
  >();
  /** The poll tick that only creates asked for. */
  private _createTick: Promise<unknown> | null = null;
  private _current: string | null = null;
  private _pathOverride: string | null = null;
  private _navigation: Promise<void> | null = null;
  private _navigationCount = 0;
  private _stateDB: IStateDB | null = null;
  private _stateKey: string | null = null;
}

/** A change shown from a server answer, with the reads in flight at the answer. */
interface IShownChange {
  change: Contents.IChangedArgs;
  /** Tree reads started before the answer */
  read: number;
  /** The stock cd's read in flight at the answer */
  pending: Promise<void> | null;
}

export function isBelow(path: string, top: string): boolean {
  return top === '' ? path !== '' : path.startsWith(top + '/');
}
