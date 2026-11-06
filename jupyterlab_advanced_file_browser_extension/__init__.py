try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab_advanced_file_browser_extension' outside a proper installation.")
    __version__ = "dev"
from .routes import setup_route_handlers


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@stellarshenson/jupyterlab-advanced-file-browser-extension"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_advanced_file_browser_extension"
    }]


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    setup_route_handlers(server_app.web_app)
    # Open in Terminal at the server root needs its absolute path: the terminal API
    # resolves a missing or relative cwd against the server's process folder
    page_config = server_app.web_app.settings.setdefault("page_config_data", {})
    page_config["advancedFileBrowserServerRoot"] = server_app.root_dir
    name = "jupyterlab_advanced_file_browser_extension"
    server_app.log.info(f"Registered {name} server extension")
