# jupyterlab_advanced_file_browser_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_file_browser_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_file_browser_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@stellarshenson/jupyterlab-advanced-file-browser-extension.svg)](https://www.npmjs.com/package/@stellarshenson/jupyterlab-advanced-file-browser-extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-file-browser-extension.svg)](https://pypi.org/project/jupyterlab-advanced-file-browser-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-file-browser-extension)](https://pepy.tech/project/jupyterlab-advanced-file-browser-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Adds features to the JupyterLab file browser: folders that unfold in place as a tree, Unix Style Sorting, Open in Terminal on files and drag-and-drop path insertion into terminals, editors and notebooks. It replaces `jupyterlab_file_browser_sorting_extension`, `jupyterlab_open_in_terminal_extension` and `jupyterlab_drag_and_drop_path_extension`.

## Features

- **Folder unfolding** - A triangle on each folder row folds or unfolds the folder in place, as a tree; folding and unfolding animate over a short interval; a double-click on a folder still enters it. Based on [jupyterlab-unfold](https://github.com/jupyterlab-contrib/jupyterlab-unfold)
- **Unfolding switch** - Right-click the column header of the file browser to turn unfolding on or off, beside Show Last Modified Column and the other column items
- **Unix Style Sorting** - Names sorted in `LC_COLLATE=C` byte order (dot files, digits, capitals, underscore, lower case), folders first, also inside unfolded folders; switched in the column-header menu
- **Open in Terminal** - On a file or on the empty area of the file browser, opens a terminal in that file's folder, also for a file inside an unfolded folder
- **Drop a path into a terminal** - Drag a file or folder from the file browser onto a terminal to insert its path escaped for the shell, or single-quoted with quoting turned on; the dropped-on terminal comes to the foreground
- **Drop several files onto a terminal** - Every dragged path arrives in one send, in the order selected, separated by a space or by a newline
- **Drop a path into an editor or a notebook** - A Python file or a Python notebook code cell receives a quoted string literal or a `pathlib` expression; any other open file or code cell receives the bare path. A notebook drop lands in the cell under the pointer at that cell's cursor, and a drag holding several items is declined by an editor and by a notebook
- **Drag from the breadcrumbs** - The folder trail above the listing is a drag source, so the folder the browser shows can be dropped onto a target without first finding its row; a click on a breadcrumb still navigates

## Settings

Open **Settings → Settings Editor → Advanced File Browser**. These six keys replace the former Drag and Drop Path settings page; saved values from that extension are not carried over. Each entry below leads with the label the editor shows, with the JSON key in brackets:

- **Enable drag-and-drop path insertion** (`dragDropPathEnabled`) - master on/off switch; default `true`
- **Path type** (`pathType`) - `relative` (default) or `absolute`; a relative path is measured from the terminal's working directory or from the open document's folder
- **Relative terminal path caveat** - the terminal working directory comes from the deepest shell the terminal is running, so a background job that changed directory can be the one used; absolute paths and editor or notebook drops are unaffected
- **Python path style** (`pythonPathStyle`) - `posix` inserts a quoted string literal (default), `pathlib` inserts a `Path(...)` expression
- **Pathlib constructor** (`pathlibConstructor`) - `pathlib.Path` (default) or `Path`; choose `Path` only in files that already do `from pathlib import Path`, because the extension inserts no import
- **Terminal separator for several paths** (`terminalSeparator`) - `space` (default) keeps the paths on one line as arguments; `newline` gives each path a line of its own, ending every line but the last with a backslash so the shell reads it as a continuation
- **Quote paths in the terminal** (`terminalQuotePaths`) - `false` (default) backslash-escapes the characters that need it; `true` wraps each path in single quotes instead

## Requirements

- JupyterLab 4.6 or later
- Python 3.12 or later

## Install

```bash
pip install jupyterlab_advanced_file_browser_extension
```

## Uninstall

```bash
pip uninstall jupyterlab_advanced_file_browser_extension
```
