import os

try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab_advanced_file_browser_extension' outside a proper installation.")
    __version__ = "dev"
from .routes import AdvancedFileBrowser, setup_route_handlers


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@stellarshenson/jupyterlab-advanced-file-browser-extension"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_advanced_file_browser_extension"
    }]


def _warn_without_trash_fix(server_app):
    """Log one line when the server trash is on and the delete_file fix of
    jupyterlab_core_patches_extension is not installed: its delete_file wrapper wraps the method
    it keeps in _jp_file_delete_trash_original."""
    cls = type(server_app.contents_manager)
    original = getattr(cls, "_jp_file_delete_trash_original", None)
    if getattr(server_app.contents_manager, "delete_to_trash", False) and (
        original is None or getattr(cls.delete_file, "__wrapped__", None) is not original
    ):
        server_app.log.warning(
            "jupyterlab_advanced_file_browser_extension: the delete_file fix of"
            " jupyterlab_core_patches_extension is not installed, so Move to Trash follows the"
            " stock JupyterLab trash behaviour"
        )


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    setup_route_handlers(server_app.web_app, AdvancedFileBrowser(config=server_app.config))
    # Open in Terminal at the server root and drag-and-drop absolute paths need its
    # absolute path: JupyterHub may set the root to "~/...", and a path join would
    # keep the tilde as a literal directory name.
    page_config = server_app.web_app.settings.setdefault("page_config_data", {})
    page_config["advancedFileBrowserServerRoot"] = os.path.realpath(
        os.path.expanduser(str(server_app.root_dir))
    )
    # Core patches may load after this extension: its wrapper is looked for once every server
    # extension has loaded and the IOLoop runs.
    server_app.io_loop.add_callback(_warn_without_trash_fix, server_app)
    name = "jupyterlab_advanced_file_browser_extension"
    server_app.log.info(f"Registered {name} server extension")
