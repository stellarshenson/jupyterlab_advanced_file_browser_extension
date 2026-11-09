# jupyterlab_advanced_file_browser_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_file_browser_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_file_browser_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@stellarshenson/jupyterlab-advanced-file-browser-extension.svg)](https://www.npmjs.com/package/@stellarshenson/jupyterlab-advanced-file-browser-extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-file-browser-extension.svg)](https://pypi.org/project/jupyterlab-advanced-file-browser-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-file-browser-extension)](https://pepy.tech/project/jupyterlab-advanced-file-browser-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Adds features to the JupyterLab file browser: folders that unfold in place as a tree, Unix Style Sorting and Open in Terminal on files. It replaces `jupyterlab_file_browser_sorting_extension` and `jupyterlab_open_in_terminal_extension`.

## Features

- **Folder unfolding** - A triangle on each folder row folds or unfolds the folder in place, as a tree; folding and unfolding animate over a short interval; a double-click on a folder still enters it. Based on [jupyterlab-unfold](https://github.com/jupyterlab-contrib/jupyterlab-unfold)
- **Unfolding switch** - Right-click the column header of the file browser to turn unfolding on or off, beside Show Last Modified Column and the other column items
- **Unix Style Sorting** - Names sorted in `LC_COLLATE=C` byte order (dot files, digits, capitals, underscore, lower case), folders first, also inside unfolded folders; switched in the column-header menu
- **Open in Terminal** - On a file or on the empty area of the file browser, opens a terminal in that file's folder, also for a file inside an unfolded folder

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
