import gc

import pytest

pytest_plugins = ("pytest_jupyter.jupyter_server", )


@pytest.fixture
def frozen_gc():
    """A server-loop lag measurement free of a full collection of the garbage earlier tests left:
    collected once, then the objects that exist are left out of every collection until the test
    ends. Such a collection pauses every thread for a quarter second on a loaded host."""
    gc.collect()
    gc.freeze()
    yield
    gc.unfreeze()


@pytest.fixture
def jp_server_config(jp_server_config):
    return {
        "ServerApp": {
            "jpserver_extensions": {"jupyterlab_advanced_file_browser_extension": True},
            # Test against a server which requires authentication on all endpoints
            "allow_unauthenticated_access": False,
        }
    }
