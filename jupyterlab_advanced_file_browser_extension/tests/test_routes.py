"""Route tests for the terminal cwd endpoint and the server root page config."""
import json
import os
import subprocess
import sys
from unittest.mock import MagicMock

import pytest
import tornado

from jupyterlab_advanced_file_browser_extension import _load_jupyter_server_extension

URL = "jupyterlab-advanced-file-browser-extension"


async def test_hello(jp_fetch):
    # When
    response = await jp_fetch("jupyterlab-advanced-file-browser-extension", "hello")

    # Then
    assert response.code == 200
    payload = json.loads(response.body)
    assert payload == {
            "data": (
                "Hello, world!"
                " This is the '/jupyterlab-advanced-file-browser-extension/hello' endpoint."
                " Try visiting me in your browser!"
            ),
        }


class _FakePty:
    """A registered terminal as terminado holds one: an object carrying the
    ``ptyproc`` whose pid identifies this incarnation."""

    def __init__(self, pid: int) -> None:
        self.ptyproc = self
        self.pid = pid


class _FakeTerminalManager:
    """A terminal manager whose ``get_terminal`` is a landmine.

    ``get_terminal`` is get-OR-CREATE in terminado, so calling it here would
    spawn a live shell for any name a request happens to carry. Raising turns
    that regression into a red test instead of a stray terminal.
    """

    def __init__(self, terminals: dict | None = None) -> None:
        self.terminals = dict(terminals or {})

    def get_terminal(self, name):
        raise AssertionError("get_terminal is get-or-create and must never be called")


async def test_terminal_cwd_of_a_live_terminal(
    jp_fetch, jp_serverapp, monkeypatch, tmp_path
):
    """The route reports the cwd read from a live process tree."""
    if sys.platform != "linux":
        pytest.skip("procfs cwd detection is Linux-only")
    # A real process stands in for the terminal's pty, in a directory of its
    # own, so the reported cwd is read from /proc rather than arranged.
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        cwd=tmp_path,
    )
    try:
        manager = _FakeTerminalManager({"1": _FakePty(process.pid)})
        monkeypatch.setitem(
            jp_serverapp.web_app.settings, "terminal_manager", manager
        )
        response = await jp_fetch(URL, "terminal-cwd", "1")
        payload = json.loads(response.body)
        assert response.code == 200
        assert payload == {
            "terminal_name": "1",
            "cwd": os.path.realpath(tmp_path),
        }
    finally:
        process.terminate()
        process.wait(timeout=5)


async def test_an_unknown_terminal_is_404(jp_fetch, jp_serverapp, monkeypatch):
    manager = _FakeTerminalManager()
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", manager)

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(URL, "terminal-cwd", "ghost")

    assert refused.value.code == 404
    assert manager.terminals == {}


async def test_repeated_unknown_names_create_no_terminals(
    jp_fetch, jp_serverapp, monkeypatch
):
    manager = _FakeTerminalManager()
    monkeypatch.setitem(jp_serverapp.web_app.settings, "terminal_manager", manager)

    for name in ("ghost", "ghost", "phantom"):
        with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
            await jp_fetch(URL, "terminal-cwd", name)
        assert refused.value.code == 404

    # The manager raises if get_terminal is called at all, and the registry is
    # still empty, so no lookup created a shell.
    assert manager.terminals == {}


async def test_terminal_cwd_refuses_an_unauthenticated_request(jp_fetch):
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(URL, "terminal-cwd", "1", headers={"Authorization": ""})
    assert refused.value.code == 403


def test_page_config_root_is_the_expanded_realpath():
    server_app = MagicMock()
    server_app.root_dir = "~/workspace"
    server_app.web_app.settings = {"base_url": "/"}

    _load_jupyter_server_extension(server_app)

    page_config = server_app.web_app.settings["page_config_data"]
    assert page_config["advancedFileBrowserServerRoot"] == os.path.realpath(
        os.path.expanduser("~/workspace")
    )
