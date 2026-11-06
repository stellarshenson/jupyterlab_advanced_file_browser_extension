# jupyterlab_advanced_file_browser_extension

This extension adds features to the JupyterLab file browser. It takes over two extensions this workspace already has, so that each of them can be retired. It also adds folder unfolding, modelled on jupyterlab-unfold.

## Requirements

- Folder unfolding, ported from https://github.com/jupyterlab-contrib/jupyterlab-unfold and modernised for the installed JupyterLab 4.6.5
  - every folder row shows a small triangle; a click on the triangle folds or unfolds that folder in place, as a tree
  - a double-click on a folder still enters the folder, as in the standard browser
  - it is an option: the user switches it on or off from the context menu of the file browser column header (right-click on the header). The option sits beside the items already in that menu: Show Last Modified Column, Show Date Created Column, Show File Size Column, Show File Checkboxes, Sort Notebooks Above Files, Unix Style Sorting
  - code ported from jupyterlab-unfold keeps its upstream licence notice
- It contains the features of the two extensions under "Extensions to migrate", so that those extensions can be retired

## Extensions to migrate

The Star Colonel decided this list on 2026-11-06. Do not edit or retire the other extensions from this project; record in `docs/migration.md` which ones this extension replaces.

- jupyterlab_file_browser_sorting_extension - Unix Style Sorting in the column-header context menu
- jupyterlab_open_in_terminal_extension - Open in Terminal for files and for the empty area of the file browser

These stay separate extensions and are not migrated:

- jupyterlab_zip_extension
- jupyterlab_terminal_show_in_file_browser_extension
- jupyterlab_core_patches_extension - its file browser patches (UI font size alignment, file browser column width, other file type menu) stay there
- jupyterlab_vscode_icons_extension
- jupyterlab_share_files_extension
- jupyterlab_refresh_view_extension
- jupyterlab_advanced_image_viewer_extension
- jupyterlab_advanced_paste_content_extension
- jupyterlab_ai_code_assistants_extension
- jupyterlab_basic_terminal_extension
- jupyterlab_camunda_modeller_extension
- jupyterlab_doc_reader_extension
- jupyterlab_nb_venv_kernels_ui_extension
