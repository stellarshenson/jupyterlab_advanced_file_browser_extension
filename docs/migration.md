# Migration

This extension replaces two extensions of the workspace. The Star Colonel decided the list on
2026-11-06 (`INTENT.md`, section "Extensions to migrate"). The other thirteen extensions found by
the grep for `@jupyterlab/filebrowser` and `IFileBrowserFactory` stay separate. Nothing in this
project edits or retires any of them.

The facts below come from a read of each extension's `src/`, `schema/` and Python package on
2026-11-06. Paths are relative to the root of the extension named.

## Replaced

### jupyterlab_file_browser_sorting_extension

- **Feature** - Unix Style Sorting: names in `LC_COLLATE=C` byte order (dot files, `0-9`, `A-Z`,
  `_`, `a-z`); folders first; real `.ipynb` files second when the core setting
  `sortNotebooksFirst` is on; sort by `last_modified` and `file_size` unchanged
- **Menu** - "Unix Style Sorting", a toggle in the column-header context menu
  (`.jp-DirListing-headerItem`, rank 100), command `filebrowser:toggle-unix-sorting`
  (`src/index.ts:11`, `221-242`)
- **Setting** - `useCLocaleSorting`, default `true`
- **How it works today** - replaces `sort` on each listing instance and writes the private fields
  `_sortState` and `_sortedItems` (`src/index.ts:139-163`); it sorts the one folder the model
  holds
- **What changes here** - the sort must also order the children of every unfolded folder, and the
  command takes an id under this extension's prefix, so the two extensions do not collide while
  both are installed
- **Known bug not to port** - size sort compares `b.size - a.size`, so ascending puts the largest
  file first (`src/index.ts:83`)

### jupyterlab_open_in_terminal_extension

- **Feature** - "Open in Terminal" on a file and on the empty area of the file browser; core 4.6
  already has the item on folders (`terminal:open-folder-in-terminal`)
- **Menu** - file browser context menu, selector `.jp-DirListing-content`, rank 3, hidden on
  folder rows; command `filebrowser:open-in-terminal` (`src/index.ts:18`, `57-101`)
- **How it works today** - runs `terminal:create-new` with `cwd: fileBrowser.model.path`
  (`src/index.ts:79-84`), on the assumption that a listing shows only its own folder
- **What changes here** - a file inside an unfolded folder opens the terminal in that file's
  folder, not in `model.path`; the command takes an id under this extension's prefix

## Stay separate

| Extension                                            | Its contact with the file browser                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jupyterlab_zip_extension`                           | Extract and Create Archive in the item menu; double-click on a `.zip` enters it as a read-only drive by replacing `listing.handleOpen` (`src/browse.ts:92-120`)             |
| `jupyterlab_terminal_show_in_file_browser_extension` | a terminal menu item that moves the browser with `model.cd()` to the terminal's folder (`src/index.ts:235`)                                                                 |
| `jupyterlab_core_patches_extension`                  | patches UI font size alignment (row CSS), file browser column width (`DirListing.prototype`, `src/fixes/file-browser-column-width.ts:103-146`) and the other-file-type menu |
| `jupyterlab_vscode_icons_extension`                  | paints row icons and badges; matches rows by the text of `.jp-DirListing-itemText` and reads flags from `model.items()` (`src/index.ts:1488-1531`, `2521-2610`)             |
| `jupyterlab_share_files_extension`                   | "Share Files..." in the item menu, drops from its panel and paste into `model.path` (`src/index.ts:85-112`, `125-284`)                                                      |
| `jupyterlab_refresh_view_extension`                  | none; the `IFileBrowserFactory` import is unused                                                                                                                            |
| `jupyterlab_advanced_image_viewer_extension`         | steps through images in the browser's order through the protected `listing` (`src/navigate.ts:51-82`)                                                                       |
| `jupyterlab_advanced_paste_content_extension`        | `model.path` as the fallback folder of a terminal paste (`src/index.ts:124`)                                                                                                |
| `jupyterlab_ai_code_assistants_extension`            | `model.path` as the folder of a new session; `filebrowser:go-to-path` to follow a session (`src/core/panel.ts:1278`, `1332`, `2728`)                                        |
| `jupyterlab_basic_terminal_extension`                | `model.path` as the default working folder (`src/index.ts:74`)                                                                                                              |
| `jupyterlab_camunda_modeller_extension`              | none; a `.bpmn` file type and icon only                                                                                                                                     |
| `jupyterlab_doc_reader_extension`                    | none; document file types only                                                                                                                                              |
| `jupyterlab_nb_venv_kernels_ui_extension`            | requires `IDefaultFileBrowser` and moves it with `model.cd()` from a Launcher card (`src/index.ts:515`, `595`)                                                              |

## What folder unfolding must keep

The thirteen extensions above stay installed beside this one, so unfolding keeps every part of the
file browser they rely on.

- **`IDefaultFileBrowser` stays provided** - `jupyterlab_nb_venv_kernels_ui_extension` requires the
  token; without it none of its four commands activates
- **`model.path` stays the folder at the top of the listing** - unfolding a folder does not change
  it; six of the separate extensions read it as the current folder
- **`model.cd()` and `filebrowser:go-to-path` still enter a folder** - as in the standard browser
- **Rows keep the stock markup** - `.jp-DirListing-item` with `data-isdir` and `data-file-type`,
  `.jp-DirListing-itemIcon` and `.jp-DirListing-itemText`, which the icon, share and patch
  extensions select
- **A double-click still goes through `listing.handleOpen`** - the zip extension replaces that
  method to enter an archive
- **`selectedItems()`, `sortState` and `sortedItems()` keep working** - the zip, share and image
  viewer extensions call them
- **The column-width patch reaches the tree listing** - it patches `DirListing.prototype`, so the
  functional tests run with `jupyterlab_core_patches_extension` installed as well as without it
- **With the option off the browser is the standard one** - no other extension sees a change

Two of the separate extensions match a row by its displayed name relative to `model.path`. On a
row inside an unfolded folder they act on the wrong path: the symlink, executable and Python
package marks of `jupyterlab_vscode_icons_extension`, and a drop from the share panel onto a
nested folder row in `jupyterlab_share_files_extension`. These are limits of those extensions;
this project records them and changes nothing there.
