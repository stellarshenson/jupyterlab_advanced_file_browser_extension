"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""
import os
from tempfile import mkdtemp

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)

# configure_jupyter_server moves the workspaces and the server root, not the user settings;
# without this a settings write to the test server lands in ~/.jupyter/lab/user-settings.
c.LabApp.user_settings_dir = mkdtemp(prefix="galata-settings-")

# `or`, not a get() default: JavaScript's `||` reads "" as absent and falls back, so an
# exported-but-empty JUPYTER_TEST_PORT must fall back here too (playwright.config.js)
c.ServerApp.port = int(os.environ.get("JUPYTER_TEST_PORT") or "8888")

# Show Hidden Files needs it (ACC-UNFOLD-19); without it the server neither creates nor lists dot files
c.ContentsManager.allow_hidden = True

# The GalaxaHub message-of-the-day tab keeps the Launcher inactive and hangs every test in
# page.goto(); traitlets ignores the line where that extension is not installed, as on CI
c.GalaxaHubMotd.open_on_start = False

# A workstation config roots /files/ at ~/workspace instead of the server root, so every
# download answers 404 (ACC-NESTED-40); this is FileContentsManager's own default, as on CI
c.ContentsManager.files_handler_params = {"path": c.ServerApp.root_dir}

# The test root is under /tmp; where $HOME is another filesystem send2trash targets the
# root-owned /.Trash-<uid>, every DELETE answers 400 and the delete tests fail. The three
# sections are the ones a workstation jupyter_lab_config.py sets to True
c.FileContentsManager.delete_to_trash = False
c.AsyncFileContentsManager.delete_to_trash = False
c.AsyncLargeFileManager.delete_to_trash = False
# A permanent delete refuses a folder with content ("Directory ... not empty") unless this is
# set; the trash takes one, and ACC-NESTED-77-OUTERMOST deletes one
c.FileContentsManager.always_delete_dir = True

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"
