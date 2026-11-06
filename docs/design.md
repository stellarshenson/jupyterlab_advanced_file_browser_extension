# Design

The extension replaces the core file browser factory with one that builds subclasses of the stock model, listing and browser: they behave as the stock ones while folder unfolding is off, and show unfolded folders in place as a tree while it is on. Unix Style Sorting reorders the stock sort of every level, and Open in Terminal adds one context-menu command; the interfaces in section 10 let the core, sort and terminal stages build in parallel.

Sources: JupyterLab 4.6.5 (`@jupyterlab/filebrowser` `listing.ts`, `model.ts`, `browser.ts`, `crumbs.ts`, `upload.ts`; the core factory, default-file-browser and terminal plugins in the lab bundle; the core schemas), upstream jupyterlab-unfold 0.3.4, `docs/acc-crit.md`, `docs/migration.md`. `node_modules` holds `@jupyterlab/filebrowser` 4.6.6 for the typecheck since the dependency update; the lab runs 4.6.5 as a shared singleton, and every stock member named here exists in both.

## 1. Plug-in point

- `package.json` `jupyterlab.disabledExtensions` lists `@jupyterlab/filebrowser-extension:factory`; the plugin `@stellarshenson/jupyterlab-advanced-file-browser-extension:plugin` provides `IFileBrowserFactory` in its place (`jupyterlab_advanced_image_viewer_extension` disables core plugins the same way)
- The factory copies the 4.6.5 core factory: `WidgetTracker` namespace `filebrowser`; model options `translator`, `auto` (default true), `manager`, `driveName`, `refreshInterval`, `refreshStandby` (`(info && !info.isConnected) || 'when-hidden'` from `JupyterLab.IInfo`), `state` (`options.state === null ? undefined : options.state || defaultState`), `allowFileUploads` (default true); browser options `id`, `model`, `restore`, `translator`, `state`, `renderer`. It constructs `TreeFileBrowserModel` and `TreeFileBrowser` instead of the stock classes
- Core `@jupyterlab/filebrowser-extension:default-file-browser` still provides `IDefaultFileBrowser` and builds it through this factory, so every extension that requires the token activates (ACC-COMPAT-69)
- Core settings plugins (columns, hidden files, checkboxes, notebooks first, single-click navigation, filter) set the same `FileBrowser` properties on the subclass as on the stock browser
- Every override checks `model.unfolding` first and calls the stock method when it is off; with unfolding off the browser is the stock one, apart from Unix Style Sorting, which is a separate setting
- The factory reads both settings before it builds a browser and passes `unfolding` as a model option, so the first fetch already has the right mode; a failed settings load logs the error and uses the schema defaults, so the file browser never fails to activate
- Runtime switch: a change of `folderUnfolding` sets `model.unfolding` on every tracked browser → the model refreshes → the listing re-sorts and re-renders; no reload (ACC-SWITCH-26, ACC-SWITCH-27)
- Removing or disabling this extension brings the core factory back, because the disable is metadata of this package

## 2. Model - `TreeFileBrowserModel` (`src/model.ts`)

| Term           | Meaning                                                             | API                                       |
| -------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| top folder     | the folder last entered; the listing's top level shows its contents | `model.topPath` (the stock `_model.path`) |
| current folder | where New File, New Folder, Upload, Paste and Open in Terminal land | `model.path`                              |
| unfolded       | a folder whose children show as rows under its own row              | `model.isUnfolded(path)`                  |

- `path`: unfolding on → the current folder, held internally as `null` while it equals the top folder; unfolding off → the top folder, as in stock
- `setCurrentFolder(path | null)`: no-op while unfolding is off or the value is unchanged; stores `null` when the path equals the top; emits `refreshed`, not `pathChanged`. In the stock browser `pathChanged` means the listing entered another folder, and its listeners clear the selection, the filter and the focus; `refreshed` makes the breadcrumbs re-read `model.path`
- Entering a folder, `cd(path)` with any path other than `'.'`: resets the current folder to the top, fetches the visible unfolded folders under the target (`contents.resolvePath(topPath, path)`), then runs the stock `cd`. The reset lets the stock comparison of the old and the new `path` see the top folder, so `pathChanged`, the saved `file-browser-<id>:cwd` key, the filter reset and the selection reset behave as in stock; without it a double-click on the current folder emits no `pathChanged`, because its first mousedown already made the folder current
- Refresh, `cd('.')` (the stock 10 s poll, `refresh()`, hidden files and filter changes): in tree mode the model fetches the top folder and every visible unfolded folder in parallel, then applies them in one `handleContents` and calls the stock `onRunningChanged`, which fills `sessions()` and emits `refreshed`; the listing never renders a level without its children
- Ordering: a refresh first awaits a running navigation; each navigation increments a counter, and a refresh discards its result when the counter moved while it fetched. A refresh whose top-folder fetch fails falls back to the stock `cd('.')`, which handles a vanished top folder (404 → server root, connection-failure dialog)
- Visible unfolded folder: in the unfolded set, below the top folder, every folder between it and the top unfolded, and, while hidden files are off, no path segment below the top starting with `.`
- A child fetch answered 404 removes that folder from the set, saved, without a dialog (ACC-UNFOLD-14); any other error keeps the folder and skips its children for that round
- `handleContents` (tree mode): appends the fetched children of the visible unfolded folders to the top folder's `content`, then calls the stock `handleContents`; the stock `_items` and `_paths` hold every loaded row, so running notebooks show their mark at every depth
- `items()` (tree mode): a row is listed when (a) it passes the stock filter (`super.items()`, which also sets `indices` for the highlight), or it is a folder holding a row that passes at any loaded depth, and (b) every folder between it and the top is listed and unfolded. The stock hidden-file rule removes dot rows; a child of a hidden folder fails (b) (ACC-UNFOLD-19, ACC-UNFOLD-21)
- `toggle(path)`: folding deletes the path from the set and emits `refreshed` without a fetch, since `items()` drops the rows; unfolding adds it and awaits `refresh()`. Folding keeps the state of the folders below, so unfolding the parent again shows them as they were
- `unfold(path)`: adds the path and every folder between it and the top, saves, refreshes; no-op when all are unfolded. It records the set before it fetches, so a second New Folder click during the fetch reaches the stock pending-request guard of `FileBrowser`
- Current-folder check: after each tree `handleContents` and each fold, a current folder that is not a listed folder row returns to the top (a fold, the filter or a deletion hid it)
- `unfolding` setter: no-op when unchanged; current folder → top; `void this.refresh()`. Switched off, the stock `cd('.')` replaces `_items` with the top folder's content
- Persistence: `IStateDB` (the model's `state` option) key `advanced-file-browser:<browser id>:unfolded`, value `{ "paths": string[] }`, saved on every change of the set. `restore(id, populate)` loads it before the stock restore runs its `cd`, also when `populate` is false (a start from a `/tree/` URL) and also while unfolding is off, so switching on later shows the saved tree (ACC-UNFOLD-12); a failed load removes the key
- `upload(file, path?)` (tree mode): target `path ?? this.path`; when the target is the current folder and not the top, `unfold(target)` first, then the stock upload with the target (ACC-FOLDER-33). The stock overwrite prompt looks for the name in `_items`, which holds every loaded row; the stock upload runs on `Object.create(model)` with an own `_items` getter that returns the loaded rows whose folder is the target, so only a file of that name in the target folder prompts (ACC-FOLDER-83, DEF-FOLDER-10-UPLOAD-PROMPT). Every other member, the large-file prompt and the chunked upload among them, reads through to the model; the unfold puts the target's rows in `_items`
- `onFileChanged` (tree mode): after the stock handler, which covers the top folder, refreshes when the old or new item's folder is a visible unfolded folder, so in-app changes show at once (ACC-UNFOLD-11)
- `withPath(path, fn)`: `path` returns the given folder while `fn` runs, without a signal; only the listing's rename uses it
- `depth(path)`: segments below the top folder, 0 for a row in the top folder (ACC-UNFOLD-8)
- Paths: the set and the current folder hold global item paths (`item.path`); ancestry and depth compare `contents.localPath()` values, so a drive prefix (the zip extension's drive) shifts nothing
- Breadcrumbs: the stock `BreadCrumbs` re-reads `model.path` on `refreshed`, so it shows the current folder; a segment click runs `model.cd('/<segment path>')`, a navigation (ACC-FOLDER-76); no breadcrumb code here. While the rows carry the indent, `style/base.css` keeps the breadcrumbs on one line and shortens a long segment with an ellipsis: a wrap change on the row `mousedown` would move the rows under the pointer within one double-click or right-click (DEF-FOLDER-1-CRUMB-SHIFT)
- Filter: the stock `FilenameSearcher` calls `setFilter`, which refreshes; `clearFilterOnNavigation` still acts on `pathChanged`, which only navigation emits

## 3. Listing - `TreeDirListing` and `TreeFileBrowser` (`src/listing.ts`)

No renderer subclass: the stock renderer, or the one another extension supplies through `IDefaultFileBrowserRenderer`, draws every row, and the listing decorates the rows after it.

| Element  | Class                                                            | Place                                    | Content                                                          |
| -------- | ---------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| indent   | `jp-AdvancedFileBrowser-indent`                                  | first child of `.jp-DirListing-itemName` | `depth` guides                                                   |
| guide    | `jp-AdvancedFileBrowser-guide`                                   | inside the indent                        | none                                                             |
| triangle | `jp-AdvancedFileBrowser-toggle`, `jp-mod-expanded` when unfolded | after the indent, folder rows only       | `▸` (U+25B8) folded, `▾` (U+25BE) unfolded; `aria-hidden="true"` |
| spacer   | `jp-AdvancedFileBrowser-toggleSpacer`                            | after the indent, file rows              | empty, the triangle's width                                      |
| icon     | stock `.jp-DirListing-itemIcon`                                  | unfolded folder rows                     | `folderOpenIcon`                                                 |

- `updateNodes` override: stock call first; then, unless `sizeOnly`, the decoration of each row, idempotent. Unfolding off removes the elements and restores the file-type icon, so the rows return to stock markup
- Rows keep `.jp-DirListing-item`, `data-isdir`, `data-file-type`, `.jp-DirListing-itemIcon` and `.jp-DirListing-itemText`, which the stock code sets (ACC-COMPAT-70)
- Open icon: set in a `requestAnimationFrame` callback queued after the stock call. The stock renderer paints a row's icon in its own frame callback whenever a reused row shows a different item; callbacks run in queue order, so the stock one cannot overwrite the open icon. A row that showed the open icon and now shows a folded folder gets the file-type icon back (`manager.registry.getFileTypeForModel(item)`, painted with `LabIcon.resolveElement` as the renderer does); a `WeakMap<HTMLElement, string>` of path and state limits the repaint to rows that changed
- `folderOpenIcon = new LabIcon({ name: 'jupyterlab-advanced-file-browser-extension:folder-open', svgstr })`, `svgstr` imported from `style/icons/folder-open.svg`; `src/svg.d.ts` declares `*.svg` as a string module

| Event (unfolding on)               | Target                              | Action                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mousedown`, button 0              | triangle                            | `model.toggle(item.path)`; no selection, no drag, current folder and top folder unchanged (ACC-UNFOLD-6); the triangle spans the row's height (ACC-UNFOLD-84)                                                                                                                                                                                                                                                    |
| `click`, `dblclick`                | triangle                            | swallowed, so single-click navigation and a fast double-click on the triangle enter nothing                                                                                                                                                                                                                                                                                                                      |
| `mousedown`, any button            | row                                 | stock selection and drag start, then `setCurrentFolder`: the folder row's path, or the file row's folder (ACC-FOLDER-29, 30)                                                                                                                                                                                                                                                                                     |
| `mousedown`, any button            | empty area of `contentNode`         | stock handling, then `clearSelectedItems()`, `update()`, `setCurrentFolder(null)` (ACC-FOLDER-31); only a press inside its client width and below the last row of `_items`, so neither a classic scrollbar, which lies past the client width, nor an overlay one beside the rows, nor the 3 px line gap between two rows (rows are `inline-grid`) is the empty area (DEF-FOLDER-3, DEF-FOLDER-14, DEF-FOLDER-16) |
| `mousedown`                        | header, resize handle               | stock only                                                                                                                                                                                                                                                                                                                                                                                                       |
| `dblclick`                         | row                                 | stock `handleOpen(item)`: a folder → `model.cd('/<path>')` enters it (ACC-UNFOLD-5); a file → `_handleOpenFile` (ACC-UNFOLD-7); a replacement of `listing.handleOpen` still runs (ACC-COMPAT-71)                                                                                                                                                                                                                 |
| `lm-drop`                          | folder row, file row, outside rows  | move (copy with Ctrl) into the folder row's path, the file row's folder, or the top folder; stock error dialog `Error while copying/moving files` (ACC-UNFOLD-16)                                                                                                                                                                                                                                                |
| `keydown` ArrowRight / ArrowLeft   | one selected row, focus on its name | Right on a folded folder unfolds it, Left on an unfolded folder folds it, the keyboard equal of the triangle; any other Left on a row inside an unfolded folder selects that folder, focuses it and makes it current (ACC-UNFOLD-80); Right on a file row and Left on a file row of the top folder stay stock                                                                                                    |
| `keydown` Up, Down, Enter, letters | rows                                | stock; screen order, because `_sortedItems` is in tree order (ACC-NESTED-41)                                                                                                                                                                                                                                                                                                                                     |
| `keydown` Up, Down without Ctrl    | rows                                | stock selection, then `setCurrentFolder` for the focused row, the rule of the row `mousedown`; the stock handler calls `preventDefault` only when it moved, and Ctrl+Up/Down moves only the focus (ACC-FOLDER-79)                                                                                                                                                                                                |

- A right-click runs `mousedown` first, so the row's folder is current before the context menu opens; New Folder, Paste and Open in Terminal from that menu act there
- `lm-dragenter` and `lm-dragover` stay stock: they mark the row under the pointer as the drop target
- `sort(state)`: stock `sort` (sets `_sortState`, saves the sort state, schedules the update); then `itemOrder` when set; then `treeOrder` when unfolding is on; the result is written back to `_sortedItems` before the scheduled render
- A change of the current folder that the listing makes (row `mousedown`, Up, Down, empty area) changes no row, so the `sort` that the stock `refreshed` handler calls during it keeps `_sortedItems` and only schedules the render: at 2981 rows a Down press into another folder took 291 ms median with the re-sort and 122 ms inside one folder (DEF-FOLDER-7-RESORT)
- `rename()` (tree mode): the target is the stock one (the focused row if selected, else the last selected); runs the stock rename inside `model.withPath(PathExt.dirname(target.path), ...)`, because the stock rename joins `model.path` with the old name, and the current folder of a clicked folder row is that folder itself
- `_selectItemByName` (private; replaced on the instance in the constructor, so the stock public `selectItemByName` and the stock post-rename selection both reach it): tree mode resolves `PathExt.join(model.path, name)`, refreshes, selects that path, and the stock "already selected" check becomes a path check; off → the stock method. A match by name would select a same-named row at another depth, and a following Delete would act on it
- `itemOrder` accessor: the setter stores the function and calls `this.sort(this.sortState)`
- `TreeFileBrowser`: `createDirListing` → `TreeDirListing`; `createNewDirectory()` and `createNewFile(options)` first `await model.unfold(model.path)` when unfolding is on and the current folder is neither the top nor unfolded, so the stock select-and-rename finds the new row under it (ACC-FOLDER-32); `itemOrder` accessor forwarding to the listing, which `FileBrowser` keeps protected
- Stock private members, read through one `IListingInternals` cast in `listing.ts`: `_sortedItems`, `_items`, `_clipboard`, `_isCut`, `_focusIndex`, `_selectTimer`, `_sortNotebooksFirst`, `_selectItem`, `_selectItemByName`. Not touched: `_updateColumnSizes`, `_setColumnSize`, `_saveState`, which `jupyterlab_core_patches_extension` patches on `DirListing.prototype`; every override calls `super`, so the patch reaches the tree listing (ACC-COMPAT-74)
- `paste()` (tree mode): drops from the stock `_clipboard` each path that `model.path` equals or lies below, then runs the stock paste into `model.path` (ACC-FOLDER-34, ACC-FOLDER-81); a folder copied into itself makes the server's copytree recurse, and a move into itself fails (DEF-FOLDER-6-PASTE-INTOSELF). A dropped path leaves the clipboard, as the stock paste drops a cut item whose new path equals its old one. The override requests one render, since the stock paste of an emptied clipboard sets `_isCut` to false before it removes `jp-mod-cut` and renders nothing, so a folder cut and pasted onto itself would stay dimmed (DEF-FOLDER-13-CUT-DIMMED). A copied (not cut) path equal to `model.path` is then copied by a direct `manager.copy(base, PathExt.dirname(base))`, with the stock `Paste Error` dialog on a failure, so a click on folder `a`, Copy and Paste create `a-Copy1` beside it, as the stock paste does with unfolding off (DEF-FOLDER-11-SELFPASTE-SILENT); `model.path` stays on the current folder during the copy (DEF-FOLDER-15-PATH-HELD)
- `duplicate()` (tree mode): copies each selected file into its own folder, `PathExt.dirname(item.path)`, where the stock duplicate copies every file into `model.path`; folders are skipped and a failure shows the stock `Duplicate file` dialog, as in stock (ACC-NESTED-82, DEF-NESTED-8-DUPLICATE)
- `copy()`, `cut()` and `delete()` (tree mode): first drop from the selection each path below another selected path (`outermost`), then run the stock method, so a folder selected with its own rows is copied, moved or deleted once (ACC-NESTED-77); a drop emits the listing's `selectionChanged`, as every stock change of the selection does (DEF-NESTED-12-SELECTION-SIGNAL)
- Stock download, Copy Path, select all and the shift and ctrl selections need no override: they use `item.path` or `model.path` (ACC-NESTED-38 to 40)

## 4. Styles (`style/base.css`)

Design-system values: children indent 16px per level; the caret is a text glyph at `--jp-ui-font-size0`, weight 600, `--jp-ui-font-color2`. Colours are `--jp-*` tokens only.

| Selector                                                                 | Rules                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.jp-AdvancedFileBrowser-indent`                                         | `display: flex; align-self: stretch; margin-block: -4px` - covers the stock row's 4px vertical padding, so the guides join from row to row                                                                                                                                                                                                                         |
| `.jp-AdvancedFileBrowser-guide`                                          | `flex: 0 0 16px`; a 1px `--jp-border-color2` vertical line at its horizontal centre, full height                                                                                                                                                                                                                                                                   |
| `.jp-AdvancedFileBrowser-toggle`, `.jp-AdvancedFileBrowser-toggleSpacer` | `flex: 0 0 16px; text-align: center`; the guide centre then lies under the parent's triangle                                                                                                                                                                                                                                                                       |
| `.jp-AdvancedFileBrowser-toggle`                                         | `display: flex`, glyph centred; `align-self: stretch; margin-block: -4px`, the indent's rule, so a press above or below the glyph reaches the triangle (ACC-UNFOLD-84); with file checkboxes shown the row is 27px and 1.5px at each edge stay the row's; `color: var(--jp-ui-font-color2); font-size: var(--jp-ui-font-size0); font-weight: 600; cursor: pointer` |
| `.jp-DirListing-item.jp-mod-selected .jp-AdvancedFileBrowser-toggle`     | `color: inherit`, the selected row's inverse font colour                                                                                                                                                                                                                                                                                                           |

## 5. Sorting

- JupyterLab's own sort (`DirListing.prototype.sort`) runs first for every state in both switch states; its comparator reads only the two rows and the state, so on the flat list of every loaded row it gives each folder's children the order a sort of that folder alone gives
- Unix Style Sorting on: `itemOrder` reorders the stock result with `sortItems(stock, state, { unix: true, notebooksFirst })`, where `notebooksFirst` is the listing's `_sortNotebooksFirst` (the core setting `sortNotebooksFirst`)
- `sortItems`, name key: folders first; then files whose name ends in `.ipynb` when `notebooksFirst` is on; then other files; inside each group names compare by `charCodeAt`, as the replaced extension does (byte order for ASCII names: `.`, `0-9`, `A-Z`, `_`, `a-z`), a shorter common prefix first; descending reverses the names inside each group, folders still first (ACC-SORT-43 to 46)
- `sortItems`, keys `last_modified`, `file_size`, `date_created`: the stock order unchanged, JupyterLab's direction; the replaced extension's reversed size sort is not ported (ACC-SORT-49)
- `sortItems` with `unix: false`: a copy of the stock order (ACC-SORT-48)
- `treeOrder(sorted, top, localPath)`, unfolding on: groups the rows by parent folder keeping each group's order, then walks from the top folder, each folder followed by its own group; a row whose parent is not in the list is dropped (ACC-UNFOLD-17, 18, ACC-SORT-47, ACC-COMPAT-73)
- Every level in both switch states: off → the one level the listing shows; on → every level, because both reorders act on the flat list before the tree walk
- Header click: stock `handleHeaderClick` → `sort(state)` → the same pipeline; the stock key `file-browser-<id>:columns` keeps the sort state
- Live switch: a change of `unixStyleSorting` sets `itemOrder` on every tracked browser, and the setter re-sorts (ACC-SORT-52)

## 6. Open in Terminal (`src/openInTerminal.ts`)

- Command `advanced-file-browser:open-in-terminal`; `trans = translator.load('jupyterlab')`; label `trans.__('Open in Terminal')`, caption `trans.__('Open a terminal at this location')`, icon `terminalIcon.bindprops({ stylesheet: 'menuItem' })`, as core's folder item
- Menu: `app.contextMenu.addItem({ command, selector: '.jp-DirListing-content', rank: 3 })`, registered in code so it follows the terminals check
- Visible: `app.contextMenuHitTest(node => node.classList.contains('jp-DirListing-item'))`; no row (the empty area) → visible; a row with `data-isdir="true"` → hidden, since core's `terminal:open-folder-in-terminal` (rank 2, selector `.jp-DirListing-item[data-isdir="true"]`) covers folders; a file row → visible
- Target folder: `browser.model.path` when the command runs. Unfolding on: the right-click's `mousedown` has made it the file's folder at any depth, also inside a multi-selection, or the top folder on the empty area. Unfolding off: the listing's folder, which holds every file row. A file at the server root gives `''`, the server root
- Execute: `commands.execute('terminal:create-new', { cwd })`; for `''` it sends no cwd and the server starts the shell in its process folder, so the root goes through `serviceManager.terminals.startNew({ cwd })` with the absolute `PageConfig` option `advancedFileBrowserServerRoot`, which the server extension sets to `root_dir`, then `terminal:open` with the new name (DEF-TERM-2-ROOT-CWD); a rejection → `showErrorMessage(trans.__('Failed to open new terminal'), error)`
- `app.serviceManager.terminals.isAvailable()` false → neither the command nor the menu item is registered
- `browser`: the `IDefaultFileBrowser`, as in the replaced extension

## 7. `schema/plugin.json`

| Setting            | Type    | Default | Title              |
| ------------------ | ------- | ------- | ------------------ |
| `folderUnfolding`  | boolean | `false` | Folder unfolding   |
| `unixStyleSorting` | boolean | `true`  | Unix style sorting |

- `additionalProperties: false`; `jupyter.lab.setting-icon` `jupyterlab-advanced-file-browser-extension:folder-open` (the extension's own named icon); `jupyter.lab.setting-icon-label` `Advanced File Browser`

| Context-menu entry (`jupyter.lab.menus.context`) | Selector                | Rank |
| ------------------------------------------------ | ----------------------- | ---- |
| `advanced-file-browser:toggle-unix-sorting`      | `.jp-DirListing-header` | 19   |
| `advanced-file-browser:toggle-folder-unfolding`  | `.jp-DirListing-header` | 20   |

- Ranks 19 and 20 follow the core items 14-18 in the same menu (ACC-SWITCH-23, ACC-SORT-42); Open in Terminal is registered in code (section 6)

| Command id                                      | Label              | `isToggled`                | Execute                                    |
| ----------------------------------------------- | ------------------ | -------------------------- | ------------------------------------------ |
| `advanced-file-browser:toggle-folder-unfolding` | Folder Unfolding   | setting `folderUnfolding`  | `settings.set('folderUnfolding', !value)`  |
| `advanced-file-browser:toggle-unix-sorting`     | Unix Style Sorting | setting `unixStyleSorting` | `settings.set('unixStyleSorting', !value)` |
| `advanced-file-browser:open-in-terminal`        | Open in Terminal   | -                          | section 6                                  |

- No id collides with `filebrowser:toggle-unix-sorting` or `filebrowser:open-in-terminal` of the replaced extensions (ACC-COMPAT-75)

## 8. Plugins (`src/index.ts`)

| Plugin id suffix    | Provides              | Requires                                              | Optional                       | Does                                                                                                       |
| ------------------- | --------------------- | ----------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `:plugin`           | `IFileBrowserFactory` | `IDocumentManager`, `ITranslator`, `ISettingRegistry` | `IStateDB`, `JupyterLab.IInfo` | loads the settings, the factory, the two toggle commands; applies setting changes to every tracked browser |
| `:open-in-terminal` | -                     | `IDefaultFileBrowser`, `ITranslator`                  | -                              | `addOpenInTerminal(app, browser, translator)`                                                              |

- `:plugin` is `autoStart: true` and keeps the console message `JupyterLab extension @stellarshenson/jupyterlab-advanced-file-browser-extension is activated!`, which the template's ui-test expects once; the template's settings log goes, since the plugin loads the settings itself; the template's `hello` request stays as it is
- Applying settings: `browser.model.unfolding = folderUnfolding` (creation: the model option) and `browser.itemOrder = unixStyleSorting ? (stock, state, notebooksFirst) => sortItems(stock, state, { unix: true, notebooksFirst }) : null`, for every `TreeFileBrowser` in the tracker on each `settings.changed`
- `package.json`: `jupyterlab.disabledExtensions: ["@jupyterlab/filebrowser-extension:factory"]`

## 9. Ported and rewritten

| Upstream jupyterlab-unfold 0.3.4                                                                                                 | Here                                                                                 | Why                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `FilterFileTreeBrowserModel`: open state, `toggle`, `isOpen`, state-database restore, `path` that differs from the listed folder | ported into `TreeFileBrowserModel`, rewritten for 4.6.5                              | the concepts carry over; the code changes to a set of unfolded paths, a separate top and current folder, and stock navigation |
| `fetchContent`: serial recursive fetch from the drive root                                                                       | rewritten: one parallel round over the visible unfolded folders under the top folder | one round trip per refresh instead of one per level; the listing now has a top folder other than the root                     |
| `sortContents`: `localeCompare`, folders first                                                                                   | dropped                                                                              | the stock sort and Unix Style Sorting order every level (ACC-UNFOLD-17)                                                       |
| `DirTreeListing._eventMouseDown`: current folder from the pressed row, empty area resets                                         | ported into the `mousedown` handling of `TreeDirListing`                             | the Star Colonel's current-folder decision is the upstream behaviour                                                          |
| `DirTreeListing._eventDrop`: target folder from the row                                                                          | ported into `TreeDirListing.evtDrop`                                                 | same rule: a folder row or the file row's folder                                                                              |
| `DirTreeListing._eventDblClick`: double-click folds                                                                              | dropped                                                                              | a double-click enters the folder; the triangle folds                                                                          |
| `singleClickToUnfold` setting, `_eventDragEnter`, `_eventDragOver`, `_onPathChanged` no-op                                       | dropped                                                                              | the triangle unfolds; the stock drag handlers suffice; clicks emit `refreshed`, not `pathChanged`                             |
| `FileTreeRenderer`: no header, vertical bars, open icon                                                                          | rewritten: decoration in `TreeDirListing.updateNodes` after the stock renderer       | the header stays for column sorting; a renderer subclass would displace one supplied through `IDefaultFileBrowserRenderer`    |
| `FileTreeBrowser`: removes breadcrumbs, hides columns and checkboxes                                                             | rewritten: every stock part stays                                                    | ACC-UNFOLD-20, ACC-FOLDER-76                                                                                                  |
| `index.ts` factory                                                                                                               | rewritten from the 4.6.5 core factory                                                | the core factory has gained options since 4.0 (`refreshStandby`, `allowFileUploads`, `renderer`)                              |
| `base.css`                                                                                                                       | rewritten with the design-system classes and values                                  | class naming `jp-AdvancedFileBrowser-*`, 16px indent                                                                          |
| `style/icons/folder-open.svg`                                                                                                    | ported unchanged apart from the comment below                                        | the open-folder glyph                                                                                                         |

Ported files: `src/model.ts`, `src/listing.ts`, `style/icons/folder-open.svg`. Each `.ts` file opens with this header:

```
/*
 * Ported from jupyterlab-unfold 0.3.4 (https://github.com/jupyterlab-contrib/jupyterlab-unfold),
 * src/unfold.ts, and rewritten for JupyterLab 4.6.5.
 *
 * Copyright (c) 2023, Martin Renou
 * All rights reserved.
 * BSD 3-Clause License; the full text is in LICENSE.
 */
```

- The svg carries the same three facts as an XML comment, plus the source of its glyph: Font Awesome Free 5 `folder-open`, CC BY 4.0, https://fontawesome.com/license/free
- `LICENSE` keeps its text and appends a separator, a sentence naming the three ported files and the upstream repository, and the upstream BSD 3-Clause text with `Copyright (c) 2023, Martin Renou`, word for word from `tmp/workflows/build-v1/upstream/LICENSE` (ACC-UNFOLD-22)

## 10. Modules and interfaces

| Stage       | Files                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core        | `src/model.ts`, `src/listing.ts`, `src/svg.d.ts`, `style/base.css`, `style/icons/folder-open.svg`, `LICENSE`, `src/__tests__/tree-model.spec.ts`, `jupyterlab_advanced_file_browser_extension/tests/test_licence.py`                                                                                                       |
| sort        | `src/sort.ts`, `src/__tests__/sort.spec.ts`                                                                                                                                                                                                                                                                                |
| terminal    | `src/openInTerminal.ts`, `src/__tests__/open-in-terminal.spec.ts`                                                                                                                                                                                                                                                          |
| integration | `src/index.ts`, `schema/plugin.json`, `style/index.css`, `style/index.js`, `package.json`, `README.md`, `src/request.ts`, `src/__tests__/jupyterlab_advanced_file_browser_extension.spec.ts`, every other existing file, and the Galata files of section 11 under `ui-tests/tests/` (written by the later Galata workflow) |

- Core imports nothing from sort or terminal; sort imports types only from `@jupyterlab/filebrowser` and `@jupyterlab/services`; terminal imports nothing from core or sort; integration imports all three
- `style/index.css` already imports `base.css`, so the core styles load without an integration change

```ts
// src/model.ts (core)
export namespace TreeFileBrowserModel {
  export interface IOptions extends FilterFileBrowserModel.IOptions {
    unfolding?: boolean; // initial state, default false
  }
}
export class TreeFileBrowserModel extends FilterFileBrowserModel {
  constructor(options: TreeFileBrowserModel.IOptions);
  get unfolding(): boolean;
  set unfolding(value: boolean);
  get topPath(): string;
  get path(): string;
  setCurrentFolder(path: string | null): void;
  isUnfolded(path: string): boolean;
  toggle(path: string): Promise<void>;
  unfold(path: string): Promise<void>;
  depth(path: string): number;
  withPath<T>(path: string, fn: () => Promise<T>): Promise<T>;
}

// src/listing.ts (core)
export type ItemOrder = (
  stock: Contents.IModel[],
  state: DirListing.ISortState,
  notebooksFirst: boolean
) => Contents.IModel[];
export const folderOpenIcon: LabIcon;
export function treeOrder(
  sorted: readonly Contents.IModel[],
  top: string,
  localPath?: (path: string) => string // default: identity
): Contents.IModel[];
export class TreeDirListing extends DirListing {
  constructor(options: DirListing.IOptions); // options.model is a TreeFileBrowserModel
  get model(): TreeFileBrowserModel;
  get itemOrder(): ItemOrder | null;
  set itemOrder(value: ItemOrder | null);
}
export namespace TreeFileBrowser {
  export interface IOptions extends FileBrowser.IOptions {
    model: TreeFileBrowserModel;
  }
}
export class TreeFileBrowser extends FileBrowser {
  constructor(options: TreeFileBrowser.IOptions);
  declare readonly model: TreeFileBrowserModel;
  get itemOrder(): ItemOrder | null;
  set itemOrder(value: ItemOrder | null);
}

// src/sort.ts (sort)
export function compareBytes(a: string, b: string): number;
export interface ISortOptions {
  unix: boolean;
  notebooksFirst: boolean;
}
export function sortItems(
  stock: readonly Contents.IModel[],
  state: DirListing.ISortState,
  options: ISortOptions
): Contents.IModel[]; // always a new array

// src/openInTerminal.ts (terminal)
export const OPEN_IN_TERMINAL_COMMAND =
  'advanced-file-browser:open-in-terminal';
export function addOpenInTerminal(
  app: JupyterFrontEnd,
  browser: FileBrowser,
  translator: ITranslator
): void;
```

## 11. Test map

Test names start with the criterion id. Galata titles go in `test(...)`, Jest titles in `it(...)`.

| ACC id                    | Test file                                                          | Test name                                                                                   |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| ACC-UNFOLD-1-TRIANGLE     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-1-TRIANGLE triangle on the folder row only                                       |
| ACC-UNFOLD-2-EXPAND       | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-2-EXPAND triangle click shows the children below the folder                      |
| ACC-UNFOLD-3-COLLAPSE     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-3-COLLAPSE triangle click removes the child rows at every depth                  |
| ACC-UNFOLD-4-DEPTH        | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-4-DEPTH folders unfold to depth 3                                                |
| ACC-UNFOLD-5-ENTER        | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-5-ENTER double-click on a nested folder enters it                                |
| ACC-UNFOLD-6-NOENTER      | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-6-NOENTER triangle click keeps the top folder                                    |
| ACC-UNFOLD-7-OPENFILE     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-7-OPENFILE double-click opens a nested file                                      |
| ACC-UNFOLD-8-INDENT       | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-8-INDENT guide lines and indent follow the depth                                 |
| ACC-UNFOLD-9-OPENICON     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-9-OPENICON open-folder icon on unfolded folders only                             |
| ACC-UNFOLD-10-POINTS      | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-10-POINTS triangle state follows the fold state                                  |
| ACC-UNFOLD-11-REFRESH     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-11-REFRESH a file created inside an unfolded folder appears on refresh           |
| ACC-UNFOLD-12-PERSIST     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-12-PERSIST unfolded folders survive a reload                                     |
| ACC-UNFOLD-13-RETURN      | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-13-RETURN unfolded folders survive entering another folder                       |
| ACC-UNFOLD-14-GONE        | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-14-GONE a deleted unfolded folder leaves without a dialog                        |
| ACC-UNFOLD-15-EMPTYDIR    | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-15-EMPTYDIR an empty folder unfolds to no rows                                   |
| ACC-UNFOLD-16-DROP        | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-16-DROP drop on a nested folder row moves the file into it                       |
| ACC-UNFOLD-17-SORTHEAD    | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-17-SORTHEAD header sort orders every level                                       |
| ACC-UNFOLD-17-SORTHEAD    | `src/__tests__/tree-model.spec.ts`                                 | ACC-UNFOLD-17-SORTHEAD treeOrder keeps the Last Modified descending order inside each level |
| ACC-UNFOLD-18-NBFIRST     | `src/__tests__/tree-model.spec.ts`                                 | ACC-UNFOLD-18-NBFIRST notebooks precede files inside an unfolded folder                     |
| ACC-UNFOLD-19-HIDDEN      | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-19-HIDDEN hidden files follow the setting at every depth                         |
| ACC-UNFOLD-20-COLUMNS     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-20-COLUMNS nested rows show the columns of top rows                              |
| ACC-UNFOLD-21-FILTER      | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-21-FILTER filter keeps matches and their folders at every depth                  |
| ACC-UNFOLD-80-LEFTKEY     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-80-LEFTKEY Left goes to the parent folder, then folds it                         |
| ACC-UNFOLD-84-HITAREA     | `ui-tests/tests/unfold.spec.ts`                                    | ACC-UNFOLD-84-HITAREA triangle reacts on the full row height                                |
| ACC-UNFOLD-22-NOTICE      | `jupyterlab_advanced_file_browser_extension/tests/test_licence.py` | `test_acc_unfold_22_notice`                                                                 |
| ACC-SWITCH-23-ITEM        | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-23-ITEM unfolding item in the column-header menu                                 |
| ACC-SWITCH-24-DEFAULT     | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-24-DEFAULT unfolding is off with fresh settings                                  |
| ACC-SWITCH-25-CHECK       | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-25-CHECK item checked exactly while unfolding is on                              |
| ACC-SWITCH-26-ON          | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-26-ON switching on shows triangles without a reload                              |
| ACC-SWITCH-27-OFF         | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-27-OFF switching off restores the stock listing                                  |
| ACC-SWITCH-28-SAVED       | `ui-tests/tests/switch.spec.ts`                                    | ACC-SWITCH-28-SAVED the choice survives a reload                                            |
| ACC-FOLDER-29-CLICKDIR    | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-29-CLICKDIR click on a nested folder makes it current                            |
| ACC-FOLDER-30-CLICKFILE   | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-30-CLICKFILE click on a nested file makes its folder current                     |
| ACC-FOLDER-31-CLICKEMPTY  | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-31-CLICKEMPTY click on the empty area returns to the top folder                  |
| ACC-FOLDER-32-NEWITEM     | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-32-NEWITEM New File and New Folder land in the current folder                    |
| ACC-FOLDER-33-UPLOAD      | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-33-UPLOAD upload lands in the current folder                                     |
| ACC-FOLDER-34-PASTE       | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-34-PASTE paste lands in the current folder                                       |
| ACC-FOLDER-35-STOCK       | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-35-STOCK unfolding off keeps the folder on click                                 |
| ACC-FOLDER-76-BREADCRUMBS | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-76-BREADCRUMBS breadcrumbs follow the current folder                             |
| ACC-FOLDER-79-ARROWKEYS   | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-79-ARROWKEYS Up and Down move the current folder                                 |
| ACC-FOLDER-81-SELFPASTE   | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-81-SELFPASTE a folder pasted inside itself stays                                 |
| ACC-FOLDER-83-OVERWRITE   | `ui-tests/tests/current-folder.spec.ts`                            | ACC-FOLDER-83-OVERWRITE upload asks to overwrite only for a file in the target folder       |
| ACC-NESTED-36-RENAME      | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-36-RENAME rename inside an unfolded folder                                       |
| ACC-NESTED-37-DELETE      | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-37-DELETE delete removes only the nested item                                    |
| ACC-NESTED-38-MULTI       | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-38-MULTI selection across levels keeps full paths                                |
| ACC-NESTED-39-COPYPATH    | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-39-COPYPATH Copy Path copies the full path                                       |
| ACC-NESTED-40-DOWNLOAD    | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-40-DOWNLOAD Download saves the nested file                                       |
| ACC-NESTED-41-KEYS        | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-41-KEYS arrow keys and Enter work through nested rows                            |
| ACC-NESTED-82-DUPLICATE   | `ui-tests/tests/nested-actions.spec.ts`                            | ACC-NESTED-82-DUPLICATE Duplicate puts each copy beside its original                        |
| ACC-SORT-42-ITEM          | `ui-tests/tests/sorting.spec.ts`                                   | ACC-SORT-42-ITEM Unix Style Sorting in the column-header menu                               |
| ACC-SORT-43-ORDER         | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-43-ORDER names in byte order                                                       |
| ACC-SORT-44-DIRSFIRST     | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-44-DIRSFIRST folders first in both directions                                      |
| ACC-SORT-45-NBSECOND      | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-45-NBSECOND notebooks after folders                                                |
| ACC-SORT-46-DESC          | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-46-DESC descending reverses the byte order                                         |
| ACC-SORT-47-NESTED        | `ui-tests/tests/sorting.spec.ts`                                   | ACC-SORT-47-NESTED byte order inside an unfolded folder                                     |
| ACC-SORT-48-OFF           | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-48-OFF off keeps JupyterLab's name order                                           |
| ACC-SORT-49-SIZEDATE      | `src/__tests__/sort.spec.ts`                                       | ACC-SORT-49-SIZEDATE ascending File Size puts the smallest first                            |
| ACC-SORT-50-DEFAULT       | `ui-tests/tests/sorting.spec.ts`                                   | ACC-SORT-50-DEFAULT on with fresh settings                                                  |
| ACC-SORT-51-SAVED         | `ui-tests/tests/sorting.spec.ts`                                   | ACC-SORT-51-SAVED the choice survives a reload                                              |
| ACC-SORT-52-LIVE          | `ui-tests/tests/sorting.spec.ts`                                   | ACC-SORT-52-LIVE toggling re-sorts without a reload                                         |
| ACC-TERM-53-FILE          | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-53-FILE item on top and nested file rows                                           |
| ACC-TERM-54-EMPTY         | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-54-EMPTY item on the empty area                                                    |
| ACC-TERM-55-FOLDER        | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-55-FOLDER folder rows show only the core item                                      |
| ACC-TERM-56-FILECWD       | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-56-FILECWD terminal opens in the nested file's folder                              |
| ACC-TERM-57-EMPTYCWD      | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-57-EMPTYCWD empty area opens in the top folder                                     |
| ACC-TERM-58-NOSELECT      | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-58-NOSELECT empty area ignores the selection                                       |
| ACC-TERM-59-SUBNAV        | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-59-SUBNAV empty area after entering a folder                                       |
| ACC-TERM-60-ROOT          | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-60-ROOT file at the server root opens at the root                                  |
| ACC-TERM-61-EMPTYDIR      | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-61-EMPTYDIR item inside an entered empty folder                                    |
| ACC-TERM-62-MULTI         | `ui-tests/tests/open-in-terminal.spec.ts`                          | ACC-TERM-62-MULTI several items selected, the file's own folder                             |
| ACC-TERM-63-NOTERM        | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-63-NOTERM registers nothing without terminals                                      |
| ACC-TERM-64-FAIL          | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-64-FAIL reports a failed terminal:create-new                                       |
| ACC-TERM-65-LABEL         | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-65-LABEL label from the jupyterlab catalogue                                       |
| ACC-TERM-66-ICON          | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-66-ICON icon is terminalIcon                                                       |
| ACC-TERM-67-CAPTION       | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-67-CAPTION caption reads Open a terminal at this location                          |
| ACC-TERM-68-RANK          | `src/__tests__/open-in-terminal.spec.ts`                           | ACC-TERM-68-RANK selector .jp-DirListing-content and rank 3                                 |
| ACC-COMPAT-69-TOKEN       | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-69-TOKEN IDefaultFileBrowser resolves in both switch states                      |
| ACC-COMPAT-70-MARKUP      | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-70-MARKUP nested rows keep the stock markup                                      |
| ACC-COMPAT-71-HANDLEOPEN  | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-71-HANDLEOPEN double-click goes through listing.handleOpen                       |
| ACC-COMPAT-72-CD          | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-72-CD go-to-path enters a nested folder                                          |
| ACC-COMPAT-73-ITEMS       | `src/__tests__/tree-model.spec.ts`                                 | ACC-COMPAT-73-ITEMS sortedItems holds nested rows in screen order                           |
| ACC-COMPAT-74-PATCHES     | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-74-PATCHES columns resize beside the core patches extension                      |
| ACC-COMPAT-75-REPLACED    | `ui-tests/tests/compat.spec.ts`                                    | ACC-COMPAT-75-REPLACED no activation error beside the replaced extensions                   |

Test recipes:

- JupyterLab's own order without a widget (sort.spec.ts and tree-model.spec.ts): call `DirListing.prototype.sort` on a minimal object - `model.items()`, `translator: nullTranslator`, `_sortNotebooksFirst`, `_sortFileNamesNaturally: true`, no-op `update()` and `_saveState()` - and read its `_sortedItems`
- ACC-UNFOLD-17 and 18 (unit): items of the top folder and of `a`, stock-sorted as above, then `treeOrder`; assert each level's order and that `a`'s rows follow `a`
- ACC-COMPAT-73: a real `TreeFileBrowserModel` with `unfolding: true` over a `DocumentManager` on `ServiceManagerMock` (`@jupyterlab/services/lib/testutils`) and a `DocumentRegistry`, and a `TreeDirListing` on it; the jest shim of `@jupyterlab/testing` supplies `ResizeObserver` and its raw loader resolves the svg import
- ACC-TERM-63 to 68: a fake app `{ commands: new CommandRegistry(), contextMenu: { addItem: jest.fn() }, serviceManager: { terminals: { isAvailable } }, contextMenuHitTest }` and a browser stub `{ model: { path } }`; ACC-TERM-65 passes a translator whose `load` records the domain; ACC-TERM-66 compares `name` with `terminalIcon.name`, since `bindprops` returns a view whose prototype is `terminalIcon`
- ACC-UNFOLD-21 types `x.`: a bare `x` also matches `y.txt` through its extension
- DEF-FOLDER-7-RESORT writes 11 folders of 270 files straight into the server root (`serverRoot` of the page config), since a contents API call per file takes minutes; it dispatches each Down on the focused name, reads `_sortedItems` before and after the handler, and prints the median time to the frame after the row shows selected
- DEF-FOLDER-14-OVERLAY-SCROLLBAR uses the scrollbars that headless Chromium hides, which take no width as an overlay one does: 40 files written into `a` make the listing scroll, and the mouse presses 8 px left of the right edge in the 3 px line gap below the first row (rows are `inline-grid`), where the press hits no row and targets `contentNode`; DEF-FOLDER-16-ROW-GAP presses in the same gap below the first row at the middle of the width of a listing that does not scroll
- ACC-UNFOLD-11 waits up to the 10 s poll interval, since a contents API call from the test does not reach the page's contents manager
- `ui-tests/playwright.config.js` retries a failed Galata test once: under load, a parallel worker that deletes its tmpPath folder from the shared server root during the page's start-up listing of that root makes the listing answer 404, and the stock browser opens a `Directory not found` dialog; a test that fails twice still fails the suite
- ACC-COMPAT-74 and 75 run against a server whose environment also holds `jupyterlab_core_patches_extension` (74) or both replaced extensions (75)

## 12. Known limits

- While `jupyterlab_file_browser_sorting_extension` stays installed, it replaces `sort` on each listing instance, which bypasses the tree order of this extension; while `jupyterlab_open_in_terminal_extension` stays installed, file rows show two Open in Terminal items. Both end when the two extensions are retired
- Each filter keystroke refreshes the top folder and every visible unfolded folder, one request per folder
- The marks of `jupyterlab_vscode_icons_extension` and a drop from the `jupyterlab_share_files_extension` panel onto a nested row act on the wrong path (`docs/migration.md`); nothing here changes them
