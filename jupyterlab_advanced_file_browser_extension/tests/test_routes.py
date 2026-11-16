"""Route tests for the terminal cwd endpoint, the delete routes and the server root page config."""
import asyncio
import errno
import functools
import json
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import tornado
from jupyter_server.services.contents import filemanager
from jupyter_server.services.contents.largefilemanager import AsyncLargeFileManager
from jupyter_server.services.contents.manager import ContentsManager
from send2trash import plat_other
from traitlets.config import Config

from jupyterlab_advanced_file_browser_extension import (
    _load_jupyter_server_extension,
    _warn_without_trash_fix,
    routes,
)

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


def _tree(root, files: dict[str, bytes]) -> None:
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


async def _size(jp_fetch, paths):
    response = await jp_fetch(
        URL, "delete", "size", method="POST", body=json.dumps({"paths": paths})
    )
    return json.loads(response.body)


async def _delete(jp_fetch, paths, trash=False):
    """Start a removal and poll it to the end; every report in order."""
    response = await jp_fetch(
        URL, "delete", method="POST", body=json.dumps({"paths": paths, "trash": trash})
    )
    assert response.code == 202
    job_id = json.loads(response.body)["id"]
    reports = []
    for _ in range(1000):
        reports.append(json.loads((await jp_fetch(URL, "delete", job_id)).body))
        if reports[-1]["done"]:
            return job_id, reports
        await asyncio.sleep(0.01)
    raise AssertionError("the removal did not end")


def test_the_threshold_is_10_gib_and_not_a_setting():
    assert routes.LARGE_REMOVAL_BYTES == 10737418240
    schema = Path(__file__).resolve().parents[2] / "schema" / "plugin.json"
    text = schema.read_text()
    assert "10737418240" not in text
    assert not re.search(r"threshold|large|bytes", text, re.IGNORECASE)


async def test_size_sums_the_files_of_a_tree(jp_fetch, jp_root_dir, monkeypatch):
    _tree(jp_root_dir, {"a/f1": b"x" * 10, "a/b/f2": b"x" * 20, "a/b/f3": b"x" * 30})

    # The route answers only whether the selection is over the threshold.
    assert await _size(jp_fetch, ["a"]) == {"over": False}
    assert routes._removal_size([str(jp_root_dir / "a")]) == 60
    monkeypatch.setattr(routes, "LARGE_REMOVAL_BYTES", 59)
    assert await _size(jp_fetch, ["a"]) == {"over": True}


async def test_size_counts_a_link_as_itself(jp_fetch, jp_root_dir):
    _tree(jp_root_dir, {"big": b"x" * 1024 * 1024, "a/f": b"x" * 10})
    target = str(jp_root_dir / "big")
    os.symlink(target, jp_root_dir / "a" / "link")

    assert routes._removal_size([str(jp_root_dir / "a")]) == 10 + len(target)


async def test_size_stops_past_the_threshold(jp_fetch, jp_root_dir, monkeypatch):
    monkeypatch.setattr(routes, "LARGE_REMOVAL_BYTES", 100)
    _tree(jp_root_dir, {f"a/f{i}": b"x" * 60 for i in range(10)})

    assert await _size(jp_fetch, ["a"]) == {"over": True}
    # Two files pass 100 bytes; the other eight are never counted.
    assert routes._removal_size([str(jp_root_dir / "a")]) == 120


async def test_delete_removes_a_file(jp_fetch, jp_root_dir):
    _tree(jp_root_dir, {"f.txt": b"x", "keep.txt": b"y"})

    _, reports = await _delete(jp_fetch, ["f.txt"])

    assert reports[-1]["errors"] == []
    assert not (jp_root_dir / "f.txt").exists()
    assert (jp_root_dir / "keep.txt").exists()


async def test_delete_removes_a_folder_with_content_whatever_the_trash(
    jp_fetch, jp_root_dir, jp_serverapp, monkeypatch
):
    contents_manager = jp_serverapp.contents_manager
    monkeypatch.setattr(contents_manager, "always_delete_dir", False)
    monkeypatch.setattr(contents_manager, "delete_to_trash", True)
    trashed = []
    monkeypatch.setattr(filemanager, "send2trash", trashed.append)
    _tree(jp_root_dir, {"a/f": b"x", "a/b/g": b"y", "a/b/c/h": b"z"})
    os.symlink(jp_root_dir / "outside", jp_root_dir / "a" / "dangling")

    _, reports = await _delete(jp_fetch, ["a"])

    assert reports[-1]["errors"] == []
    assert not os.path.lexists(jp_root_dir / "a")
    assert trashed == []


async def test_delete_unlinks_a_link_to_a_folder_and_keeps_the_target(
    jp_fetch, jp_root_dir
):
    _tree(jp_root_dir, {"target/f": b"x"})
    os.symlink(jp_root_dir / "target", jp_root_dir / "link")

    await _delete(jp_fetch, ["link"])

    assert not os.path.lexists(jp_root_dir / "link")
    assert (jp_root_dir / "target" / "f").exists()


async def test_delete_reports_rising_progress_and_drops_the_ended_job(
    jp_fetch, jp_root_dir
):
    _tree(jp_root_dir, {f"a/b{i % 10}/f{i}": b"x" for i in range(2000)})

    job_id, reports = await _delete(jp_fetch, ["a"])

    removed = [report["removed"] for report in reports]
    assert removed == sorted(removed)
    # The errors come once, with done.
    assert len(reports) > 1
    assert all("errors" not in report for report in reports[:-1])
    # 2000 files, 10 folders and the selected folder.
    assert reports[-1] == {"total": 2011, "removed": 2011, "done": True, "errors": []}
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(URL, "delete", job_id)
    assert refused.value.code == 404


async def test_delete_removes_a_file_checkpoint(jp_fetch, jp_root_dir):
    _tree(jp_root_dir, {"f.txt": b"x", ".ipynb_checkpoints/f-checkpoint.txt": b"x"})

    await _delete(jp_fetch, ["f.txt"])

    assert not (jp_root_dir / ".ipynb_checkpoints" / "f-checkpoint.txt").exists()


async def test_delete_reports_what_it_cannot_remove_and_removes_the_rest(
    jp_fetch, jp_root_dir
):
    if os.geteuid() == 0:
        pytest.skip("root ignores folder permissions")
    _tree(jp_root_dir, {"a/ro/f": b"x", "a/ok/g": b"y", "a/h": b"z"})
    read_only = jp_root_dir / "a" / "ro"
    read_only.chmod(0o555)
    try:
        _, reports = await _delete(jp_fetch, ["a"])
    finally:
        read_only.chmod(0o755)

    errors = reports[-1]["errors"]
    # The folders kept only because a/ro/f stayed are not listed again.
    assert [error["path"] for error in errors] == ["a/ro/f"]
    assert errors[0]["message"] == "permission denied"
    assert (jp_root_dir / "a" / "ro" / "f").exists()
    assert not (jp_root_dir / "a" / "ok").exists()
    assert not (jp_root_dir / "a" / "h").exists()


async def test_delete_removes_a_read_only_file_and_reports_a_missing_path(
    jp_fetch, jp_root_dir
):
    _tree(jp_root_dir, {"a.txt": b"x", "ro.txt": b"y"})
    (jp_root_dir / "ro.txt").chmod(0o444)

    _, reports = await _delete(jp_fetch, ["a.txt", "ro.txt", "missing"])

    assert not (jp_root_dir / "a.txt").exists()
    assert not (jp_root_dir / "ro.txt").exists()
    assert reports[-1]["errors"] == [{"path": "missing", "message": "not found"}]


async def test_delete_logs_each_failure_with_the_library_message(
    jp_fetch, jp_root_dir, caplog, monkeypatch
):
    # ACC-DELETE-140: the dialog gets the short reason, the server log the library's message.
    unlink = os.unlink
    failing = {str(jp_root_dir / "d" / "a.txt"), str(jp_root_dir / "d" / "b.txt")}

    def read_only(path, *args, **kwargs):
        if path in failing:
            raise OSError(errno.EROFS, "Read-only file system", path)
        unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", read_only)
    _tree(jp_root_dir, {"d/a.txt": b"x", "d/b.txt": b"y", "c.txt": b"z"})

    _, reports = await _delete(jp_fetch, ["d", "c.txt"])

    errors = reports[-1]["errors"]
    assert sorted(error["path"] for error in errors) == ["d/a.txt", "d/b.txt"]
    assert "Read-only" not in json.dumps(errors)
    assert not (jp_root_dir / "c.txt").exists()
    # One line per failed path; the folder kept because of them logs nothing of its own.
    assert sorted(
        record.getMessage()
        for record in caplog.records
        if record.levelname == "WARNING" and record.getMessage().startswith("Delete of ")
    ) == sorted(
        f"Delete of {path} failed: {OSError(errno.EROFS, 'Read-only file system', path)}"
        for path in failing
    )


async def test_trash_logs_a_failure_with_the_library_message(
    jp_fetch, jp_root_dir, caplog, monkeypatch
):
    # ACC-DELETE-140: Move to Trash too gives the dialog the short reason, the server log the
    # library's message.
    failing = str(jp_root_dir / "d" / "a.txt")
    library_error = OSError(errno.EBUSY, "Device or resource busy", failing)
    trashed = []

    def send2trash(path):
        if path == failing:
            raise library_error
        trashed.append(path)

    monkeypatch.setattr(filemanager, "send2trash", send2trash)
    _tree(jp_root_dir, {"d/a.txt": b"x", "b.txt": b"y"})

    _, reports = await _delete(jp_fetch, ["d/a.txt", "b.txt"], trash=True)

    assert reports[-1]["errors"] == [{"path": "d/a.txt", "message": "in use"}]
    assert trashed == [str(jp_root_dir / "b.txt")]
    # One line, for the failed path only.
    (line,) = [
        record.getMessage()
        for record in caplog.records
        if record.levelname == "WARNING" and record.getMessage().startswith("Move to trash of ")
    ]
    assert line.startswith(f"Move to trash of {failing} failed: ")
    assert str(library_error) in line


def _percent(report: dict) -> float:
    """The percentage the progress bar shows, as percent() in src/deleteDialog.ts."""
    return min(100, 100 * report["removed"] // report["total"]) if report["total"] else 0


async def test_trash_progress_of_two_items_rises_by_whole_items(
    jp_fetch, jp_root_dir, jp_serverapp, tmp_path, monkeypatch
):
    # A home trash of its own on the root's device: the stock delete_file moves by rename.
    data = tmp_path / "data"
    monkeypatch.setattr(plat_other, "XDG_DATA_HOME", os.fsencode(data))
    monkeypatch.setattr(plat_other, "HOMETRASH_B", os.fsencode(data / "Trash"))
    monkeypatch.setattr(plat_other, "HOMETRASH", str(data / "Trash"))
    monkeypatch.setattr(plat_other, "get_dev", lambda path: 0)
    monkeypatch.setattr(routes, "_jobs", {})
    contents_manager = jp_serverapp.contents_manager
    delete_file = contents_manager.delete_file
    starts = []

    async def slow_delete_file(path):
        # The job as a poll finds it when an item's move starts; the polls go on while it runs.
        (job,) = routes._jobs.values()
        starts.append(_percent(job))
        await asyncio.sleep(0.1)
        await delete_file(path)

    monkeypatch.setattr(contents_manager, "delete_file", slow_delete_file)
    _tree(jp_root_dir, {"a/f": b"x", "c/g": b"y"})

    _, reports = await _delete(jp_fetch, ["a", "c"], trash=True)

    percents = [_percent(report) for report in reports]
    # Each item adds its whole share when it ends: 0 while the first moves, 50 while the second.
    assert starts == [0, 50]
    assert percents == sorted(percents)
    assert set(percents) == {0, 50, 100}
    # 100 only in the report that says done.
    assert [report["done"] for report in reports if _percent(report) == 100] == [True]
    assert reports[-1] == {"total": 2, "removed": 2, "done": True, "errors": []}
    assert (data / "Trash" / "files" / "a" / "f").exists()
    assert (data / "Trash" / "files" / "c" / "g").exists()


async def test_trash_reports_a_failure_and_keeps_the_file(jp_fetch, jp_root_dir, monkeypatch):
    if os.geteuid() == 0:
        pytest.skip("root ignores file permissions")
    tried = []

    def fail(path):
        tried.append(path)
        raise OSError("Couldn't find mount point")

    monkeypatch.setattr(filemanager, "send2trash", fail)
    _tree(jp_root_dir, {"f.txt": b"x", "ro.txt": b"y"})
    (jp_root_dir / "ro.txt").chmod(0o444)

    _, reports = await _delete(jp_fetch, ["f.txt", "ro.txt"], trash=True)

    # The reasons for the HTTP errors the contents manager's delete_file raises, not their messages.
    assert reports[-1]["errors"] == [
        {"path": "f.txt", "message": "reason unknown"},
        {"path": "ro.txt", "message": "permission denied"},
    ]
    # The read-only file fails delete_file's writable check before send2trash.
    assert tried == [os.path.join(jp_root_dir, "f.txt")]
    assert (jp_root_dir / "f.txt").exists()
    assert (jp_root_dir / "ro.txt").exists()


async def test_trash_reports_a_missing_path_by_its_path_and_reason_only(jp_fetch, jp_root_dir):
    # delete_file's 404 message holds the absolute server path.
    _, reports = await _delete(jp_fetch, ["missing"], trash=True)

    assert reports[-1]["errors"] == [{"path": "missing", "message": "not found"}]


def _caused(error: Exception, cause: Exception) -> Exception:
    error.__cause__ = cause
    return error


@pytest.mark.parametrize(
    "error, reason",
    [
        (PermissionError(errno.EACCES, "Permission denied"), "permission denied"),
        (OSError(errno.EPERM, "Operation not permitted"), "permission denied"),
        (FileNotFoundError(errno.ENOENT, "No such file or directory"), "not found"),
        (OSError(errno.EBUSY, "Device or resource busy"), "in use"),
        (OSError(errno.EIO, "Input/output error"), "reason unknown"),
        (OSError("Couldn't find mount point for /srv/x"), "reason unknown"),
        (RuntimeError("unexpected"), "reason unknown"),
        (tornado.web.HTTPError(403, "Permission denied: x"), "permission denied"),
        (tornado.web.HTTPError(404, "File or directory does not exist: /srv/x"), "not found"),
        (tornado.web.HTTPError(400, "Cannot delete file or directory '/srv/.x'"), "reason unknown"),
        (
            _caused(tornado.web.HTTPError(400, "send2trash failed: busy"), OSError(errno.EBUSY, "busy")),
            "in use",
        ),
    ],
)
def test_a_failure_reason_is_in_the_extension_s_own_words(error, reason):
    # ACC-DELETE-140: one short reason per Delete Failed line, never the library's message.
    assert routes._reason(error) == reason


async def test_trash_moves_a_tree_on_one_device_without_walking_it(
    jp_fetch, jp_root_dir, tmp_path, monkeypatch
):
    # A home trash of its own on the root's device: send2trash moves the tree with one rename.
    data = tmp_path / "data"
    monkeypatch.setattr(plat_other, "XDG_DATA_HOME", os.fsencode(data))
    monkeypatch.setattr(plat_other, "HOMETRASH_B", os.fsencode(data / "Trash"))
    monkeypatch.setattr(plat_other, "HOMETRASH", str(data / "Trash"))
    monkeypatch.setattr(plat_other, "get_dev", lambda path: 0)
    walks = []
    monkeypatch.setattr(routes, "_removal_size", lambda *args: walks.append(args) or 0)
    _tree(jp_root_dir, {"a/b/f": b"x", "a/g": b"y"})

    _, reports = await _delete(jp_fetch, ["a"], trash=True)

    assert walks == []
    assert reports[-1] == {"total": 1, "removed": 1, "done": True, "errors": []}
    assert not (jp_root_dir / "a").exists()
    assert (data / "Trash" / "files" / "a" / "b" / "f").exists()


async def test_trash_reports_an_unexpected_exception_and_tries_the_next_items(
    jp_fetch, jp_root_dir, caplog, monkeypatch
):
    tried = []

    def fail(path):
        tried.append(path)
        raise RuntimeError("unexpected")

    monkeypatch.setattr(filemanager, "send2trash", fail)
    _tree(jp_root_dir, {"f.txt": b"x", "g.txt": b"y"})

    _, reports = await _delete(jp_fetch, ["f.txt", "g.txt"], trash=True)

    assert reports[-1]["done"] is True
    assert tried == [os.path.join(jp_root_dir, "f.txt"), os.path.join(jp_root_dir, "g.txt")]
    assert reports[-1]["errors"] == [
        {"path": "f.txt", "message": "reason unknown"},
        {"path": "g.txt", "message": "reason unknown"},
    ]
    # Each fault's traceback reaches the server log.
    assert caplog.text.count("Traceback (most recent call last)") == 2
    assert caplog.text.count("RuntimeError: unexpected") == 2
    assert (jp_root_dir / "f.txt").exists()
    assert (jp_root_dir / "g.txt").exists()


async def test_trash_goes_through_the_contents_manager_delete_file(
    jp_fetch, jp_root_dir, jp_serverapp, tmp_path, monkeypatch
):
    # A home trash of its own on the root's device: the stock delete_file moves by rename.
    data = tmp_path / "data"
    monkeypatch.setattr(plat_other, "XDG_DATA_HOME", os.fsencode(data))
    monkeypatch.setattr(plat_other, "HOMETRASH_B", os.fsencode(data / "Trash"))
    monkeypatch.setattr(plat_other, "HOMETRASH", str(data / "Trash"))
    monkeypatch.setattr(plat_other, "get_dev", lambda path: 0)
    contents_manager = jp_serverapp.contents_manager
    delete_file = contents_manager.delete_file
    deleted, trashed = [], []

    async def recording_delete_file(path):
        deleted.append(path)
        await delete_file(path)

    def recording_send2trash(path):
        trashed.append(path)
        plat_other.send2trash(path)

    monkeypatch.setattr(contents_manager, "delete_file", recording_delete_file)
    monkeypatch.setattr(filemanager, "send2trash", recording_send2trash)
    _tree(jp_root_dir, {"f.txt": b"x", "a/g.txt": b"y"})

    _, reports = await _delete(jp_fetch, ["f.txt", "a"], trash=True)

    assert reports[-1] == {"total": 2, "removed": 2, "done": True, "errors": []}
    assert deleted == ["f.txt", "a"]
    # Each move came from the stock delete_file; routes.py holds no send2trash of its own.
    assert trashed == [os.path.join(jp_root_dir, "f.txt"), os.path.join(jp_root_dir, "a")]
    assert not hasattr(routes, "send2trash")
    assert (data / "Trash" / "files" / "f.txt").exists()
    assert (data / "Trash" / "files" / "a" / "g.txt").exists()


async def test_trash_is_refused_with_the_server_trash_off(
    jp_fetch, jp_root_dir, jp_serverapp, monkeypatch
):
    # The contents manager's delete would remove permanently.
    monkeypatch.setattr(jp_serverapp.contents_manager, "delete_to_trash", False)
    _tree(jp_root_dir, {"f.txt": b"x"})

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(
            URL, "delete", method="POST", body=json.dumps({"paths": ["f.txt"], "trash": True})
        )

    assert refused.value.code == 400
    assert (jp_root_dir / "f.txt").exists()


async def _trash_check(jp_fetch, paths):
    response = await jp_fetch(
        URL, "delete", "trash-check", method="POST", body=json.dumps({"paths": paths})
    )
    return json.loads(response.body)["monitored"]


async def test_trash_check_offers_the_trash_only_where_it_is_monitored(
    jp_fetch, jp_root_dir, jp_serverapp, tmp_path, monkeypatch
):
    # A fake mount table: the home trash's mount, the server root, a listed location, whose name
    # holds a space (\040), another mount below the root and another mount outside it.
    home, listed, other = tmp_path / "home", tmp_path / "listed mount", tmp_path / "other"
    inner = jp_root_dir / "inner"
    for folder in (home / "docs", listed / "data", other / "nfs", inner):
        folder.mkdir(parents=True)
    mountinfo = tmp_path / "mountinfo"
    mountinfo.write_text(
        "".join(
            f"{i} 1 0:{i} / {str(mount).replace(' ', chr(92) + '040')} rw - ext4 /dev/x{i} rw\n"
            for i, mount in enumerate(["/", home, jp_root_dir, listed, inner, other], 2)
        )
    )
    monkeypatch.setattr(routes, "_MOUNTINFO", str(mountinfo))
    # The home trash folder does not exist: its nearest existing parent gives its mount.
    monkeypatch.setattr(plat_other, "HOMETRASH", str(home / ".local" / "share" / "Trash"))
    # A relative location is taken from the server root.
    monkeypatch.setitem(jp_serverapp.config, "TrashManagement", Config(locations=["../listed mount"]))
    for link, target in [("home", home / "docs"), ("listed", listed / "data"), ("nfs", other / "nfs")]:
        os.symlink(target, jp_root_dir / link)
    _tree(
        jp_root_dir,
        {f"{folder}/f.txt": b"x" for folder in ("home", "listed", "nfs", "inner")} | {"f.txt": b"x"},
    )

    assert await _trash_check(jp_fetch, ["f.txt"]) == [True]
    assert await _trash_check(jp_fetch, ["home/f.txt"]) == [True]
    assert await _trash_check(jp_fetch, ["listed/f.txt"]) == [True]
    assert await _trash_check(jp_fetch, ["inner/f.txt"]) == [False]
    # ACC-DELETE-152: a file reached through a link to another mount is judged by its real path,
    # the link itself where it lies.
    assert await _trash_check(jp_fetch, ["nfs/f.txt"]) == [False]
    assert await _trash_check(jp_fetch, ["nfs"]) == [True]
    # ACC-DELETE-156: each item answers for itself, in the order of the request.
    assert await _trash_check(jp_fetch, ["f.txt", "nfs/f.txt", "listed/f.txt"]) == [
        True,
        False,
        True,
    ]
    # The option's default is [].
    monkeypatch.delitem(jp_serverapp.config, "TrashManagement")
    assert await _trash_check(jp_fetch, ["listed/f.txt"]) == [False]
    # Without a mount table (another platform) the trash is offered, as stock.
    monkeypatch.setattr(routes, "_MOUNTINFO", str(tmp_path / "missing"))
    assert await _trash_check(jp_fetch, ["nfs/f.txt", "f.txt"]) == [True, True]


@pytest.mark.parametrize(
    "jp_argv, monitored",
    [
        ([], False),
        (["--AdvancedFileBrowser.trash_on_all_volumes=True"], True),
        (["--AdvancedFileBrowser.trash_on_all_volumes=False"], False),
    ],
)
async def test_trash_on_all_volumes_offers_the_trash_on_another_mount(
    jp_fetch, jp_root_dir, tmp_path, monkeypatch, jp_argv, monitored
):
    # ACC-DELETE-153: a file reached through a link to another mount, beside a file on the root's
    # mount. The default False keeps ACC-DELETE-151; True answers every path monitored, and a
    # command-line string parses as a Bool.
    other = tmp_path / "other"
    other.mkdir()
    mountinfo = tmp_path / "mountinfo"
    mountinfo.write_text(
        "".join(
            f"{i} 1 0:{i} / {mount} rw - ext4 /dev/x{i} rw\n"
            for i, mount in enumerate(["/", jp_root_dir, other], 2)
        )
    )
    monkeypatch.setattr(routes, "_MOUNTINFO", str(mountinfo))
    os.symlink(other, jp_root_dir / "nfs")
    _tree(jp_root_dir, {"nfs/f.txt": b"x", "f.txt": b"x"})

    assert await _trash_check(jp_fetch, ["nfs/f.txt", "f.txt"]) == [monitored, True]


@pytest.mark.parametrize(
    "path, code",
    [("../outside", 404), (".hidden", 400), ("", 400), ("a/..", 400)],
)
async def test_delete_refuses_a_path(jp_fetch, jp_root_dir, path, code):
    _tree(jp_root_dir, {".hidden": b"x", "a/f": b"y"})

    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(URL, "delete", method="POST", body=json.dumps({"paths": [path]}))

    assert refused.value.code == code
    assert (jp_root_dir / ".hidden").exists()
    assert (jp_root_dir / "a" / "f").exists()


@pytest.mark.parametrize(
    "parts, method",
    [
        (("delete", "size"), "POST"),
        (("delete", "trash-check"), "POST"),
        (("delete",), "POST"),
        (("delete", "0" * 32), "GET"),
    ],
)
async def test_delete_routes_refuse_an_unauthenticated_request(jp_fetch, parts, method):
    body = json.dumps({"paths": ["f"]}) if method == "POST" else None
    with pytest.raises(tornado.httpclient.HTTPClientError) as refused:
        await jp_fetch(URL, *parts, method=method, body=body, headers={"Authorization": ""})
    assert refused.value.code == 403


def test_page_config_root_is_the_expanded_realpath():
    server_app = MagicMock()
    server_app.config = Config()
    server_app.root_dir = "~/workspace"
    server_app.web_app.settings = {"base_url": "/"}

    _load_jupyter_server_extension(server_app)

    page_config = server_app.web_app.settings["page_config_data"]
    assert page_config["advancedFileBrowserServerRoot"] == os.path.realpath(
        os.path.expanduser("~/workspace")
    )


def test_core_patches_is_not_a_dependency():
    # ACC-DELETE-154: Move to Trash works without it, with the stock trash behaviour.
    pyproject = Path(__file__).resolve().parents[2] / "pyproject.toml"
    project = tomllib.loads(pyproject.read_text())["project"]
    declared = project["dependencies"] + sum(project["optional-dependencies"].values(), [])
    names = [re.split(r"[^A-Za-z0-9._-]", d, maxsplit=1)[0] for d in declared]

    assert "jupyterlab_core_patches_extension" not in [
        re.sub(r"[-_.]+", "_", name).lower() for name in names
    ]


@pytest.mark.parametrize(
    "trash, fix_installed, lines", [(True, False, 1), (True, True, 0), (False, False, 0)]
)
def test_start_names_a_core_patches_delete_fix_that_is_not_installed(
    trash, fix_installed, lines, monkeypatch
):
    cls = filemanager.AsyncFileContentsManager
    if fix_installed:
        # As jupyterlab_core_patches_extension's file_delete_trash.py installs its wrapper.
        original = cls.delete_file

        @functools.wraps(original)
        async def delete_file(self, path):
            return await original(self, path)

        monkeypatch.setattr(cls, "_jp_file_delete_trash_original", original, raising=False)
        monkeypatch.setattr(cls, "delete_file", delete_file)
    server_app = MagicMock()
    server_app.config = Config()
    server_app.root_dir = "~/workspace"
    server_app.web_app.settings = {"base_url": "/"}
    # The server's default contents manager, which inherits the wrapper.
    server_app.contents_manager = AsyncLargeFileManager(delete_to_trash=trash)

    _load_jupyter_server_extension(server_app)
    # The check waits for the IOLoop, which runs once every server extension has loaded.
    server_app.log.warning.assert_not_called()
    (callback, *args), _ = server_app.io_loop.add_callback.call_args
    callback(*args)

    warnings = [call.args[0] for call in server_app.log.warning.call_args_list]
    assert len(warnings) == lines
    for line in warnings:
        assert "jupyterlab_core_patches_extension" in line
        assert "not installed" in line


def test_start_check_passes_a_contents_manager_without_delete_to_trash():
    # ACC-DELETE-154: a manager that is not file-based (s3contents, jupyter-fs) has no such trait.
    server_app = MagicMock()
    server_app.contents_manager = ContentsManager()

    _warn_without_trash_fix(server_app)

    server_app.log.warning.assert_not_called()
