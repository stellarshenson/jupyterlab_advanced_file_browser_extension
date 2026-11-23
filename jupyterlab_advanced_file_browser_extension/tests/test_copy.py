"""Route tests for the copy and move jobs, copy and copy/<id>."""
import asyncio
import errno
import json
import os
import shutil
import stat
import tempfile
import threading
import time

import pytest
from tornado.httpclient import HTTPClientError

from jupyterlab_advanced_file_browser_extension import routes

from .test_routes import URL, _tree

MiB = 1024 ** 2
NOTEBOOK = json.dumps({"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}).encode()


@pytest.fixture
def other_volume(jp_root_dir):
    """A folder on another device than the server root, linked into the root as vol."""
    device = os.stat(jp_root_dir).st_dev
    for base in ("/dev/shm", "/var/tmp", os.path.expanduser("~")):
        if os.access(base, os.W_OK) and os.stat(base).st_dev != device:
            break
    else:
        pytest.skip("no writable folder on another device than the server root")
    folder = tempfile.mkdtemp(prefix="copy-", dir=base)
    os.symlink(folder, jp_root_dir / "vol")
    yield jp_root_dir / "vol"
    shutil.rmtree(folder, ignore_errors=True)


@pytest.fixture
def slow(monkeypatch):
    """About 3.2 MiB/s: a 1 MiB file takes 0.3 s, a 4 MiB file 1.3 s."""
    monkeypatch.setattr(routes, "COPY_CHUNK_BYTES", 32 * 1024)
    monkeypatch.setattr(routes, "COPY_PAUSE_SECONDS", 0.01)


async def _start(jp_fetch, paths, to, move=False):
    response = await jp_fetch(
        URL, "copy", method="POST", body=json.dumps({"paths": paths, "to": to, "move": move})
    )
    return response.code, json.loads(response.body)


async def _report(jp_fetch, job_id):
    return json.loads((await jp_fetch(URL, "copy", job_id)).body)


async def _reports(jp_fetch, job_id):
    """Poll a copy job to the end; every report in order."""
    reports = []
    for _ in range(3000):
        reports.append(await _report(jp_fetch, job_id))
        if reports[-1]["done"]:
            return reports
        await asyncio.sleep(0.01)
    raise AssertionError("the copy did not end")


async def _run(jp_fetch, paths, to, move=False):
    code, answer = await _start(jp_fetch, paths, to, move)
    assert code == 202
    return await _reports(jp_fetch, answer["id"])


@pytest.mark.usefixtures("frozen_gc")
async def test_acc_copy_164_background_copy_and_cross_volume_move_leave_the_server_loop_answering(
    jp_fetch, jp_root_dir, other_volume, slow
):
    data = os.urandom(4 * MiB)
    _tree(jp_root_dir, {"big.bin": data, "a/big.bin": data, "dst/keep.txt": b"x"})
    # How late a 10 ms sleep on the server loop wakes, and how long a contents GET takes, while a
    # job is part way.
    lags, answers = [], []
    # A file copy, a cross-volume move and a folder copy.
    steps = [("big.bin", "dst", False), ("big.bin", "vol", True), ("a", "dst", False)]

    async def probe():
        while True:
            start = time.monotonic()
            await asyncio.sleep(0.01)
            lags.append(time.monotonic() - start - 0.01)

    probing = asyncio.ensure_future(probe())
    try:
        for step, (path, to, move) in enumerate(steps):
            _, started = await _start(jp_fetch, [path], to, move)
            for _ in range(3000):
                report = await _report(jp_fetch, started["id"])
                if report["done"]:
                    break
                if 0 < report["bytes"] < report["bytes_total"]:
                    start = time.monotonic()
                    await jp_fetch("api", "contents", "dst")
                    answers.append((step, time.monotonic() - start))
                await asyncio.sleep(0.01)
    finally:
        probing.cancel()

    assert {step for step, _ in answers} == {0, 1, 2}
    assert max(seconds for _, seconds in answers) < 0.5
    assert max(lags) < 0.1
    assert (jp_root_dir / "dst" / "big.bin").read_bytes() == data
    assert (other_volume / "big.bin").read_bytes() == data
    assert not (jp_root_dir / "big.bin").exists()
    assert (jp_root_dir / "dst" / "a" / "big.bin").read_bytes() == data


@pytest.mark.usefixtures("frozen_gc")
async def test_acc_copy_196_the_copy_route_checks_its_paths_off_the_server_loop(
    jp_fetch, jp_root_dir, monkeypatch
):
    _tree(jp_root_dir, {"f.txt": b"f", "dst/keep": b""})
    src = str(jp_root_dir / "f.txt")
    real_stat = os.stat
    stalled = threading.Event()

    def stalled_stat(path, *args, **kwargs):
        # The source on a network mount that stops answering, at its first stat: the route's check.
        if str(path) == src and not stalled.is_set():
            stalled.set()
            time.sleep(2)
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(os, "stat", stalled_stat)
    # How late a 10 ms sleep on the server loop wakes while the POST runs.
    lags = []

    async def probe():
        while True:
            start = time.monotonic()
            await asyncio.sleep(0.01)
            lags.append(time.monotonic() - start - 0.01)

    probing = asyncio.ensure_future(probe())
    try:
        posting = asyncio.ensure_future(_start(jp_fetch, ["f.txt"], "dst"))
        while not stalled.is_set():
            await asyncio.sleep(0.01)
        start = time.monotonic()
        await jp_fetch("api", "contents", "dst")
        answered = time.monotonic() - start
        pending = not posting.done()
        code, started = await posting
    finally:
        probing.cancel()
    reports = await _reports(jp_fetch, started["id"])

    # A probe request answers while the stat of the source still stalls the POST.
    assert pending and answered < 0.5
    assert max(lags) < 0.5
    assert (code, reports[-1]["errors"]) == (202, [])
    assert (jp_root_dir / "dst" / "f.txt").read_bytes() == b"f"


async def test_acc_copy_166_cross_is_set_by_device_or_mount(
    jp_fetch, jp_root_dir, other_volume, tmp_path, monkeypatch
):
    _tree(jp_root_dir, {"f.txt": b"f", "dst/keep": b""})
    # A link to a folder on the root's own device is not another volume.
    (tmp_path / "same-device").mkdir()
    os.symlink(tmp_path / "same-device", jp_root_dir / "same")
    (other_volume / "v.txt").write_bytes(b"v")

    for path, to, cross in [
        ("f.txt", "dst", False),
        ("f.txt", "same", False),
        ("f.txt", "vol", True),
        ("vol/v.txt", "dst", True),
    ]:
        reports = await _run(jp_fetch, [path], to)
        assert [report["cross"] for report in reports] == [cross] * len(reports), (path, to)
        assert reports[-1]["errors"] == []
    # A move through that link stays the stock rename.
    assert await _start(jp_fetch, ["f.txt"], "same", move=True) == (
        200,
        {"id": None, "rename": ["f.txt"]},
    )
    # Two mount points of one device: a move between them runs as a job.
    _tree(jp_root_dir, {"m1/g.txt": b"g", "m2/keep": b""})
    monkeypatch.setattr(
        routes, "_mounts", lambda: [os.path.realpath(jp_root_dir / name) for name in ("m1", "m2")]
    )
    code, answer = await _start(jp_fetch, ["m1/g.txt"], "m2", move=True)
    reports = await _reports(jp_fetch, answer["id"])
    assert (code, bool(answer["id"]), answer["rename"]) == (202, True, [])
    assert [report["cross"] for report in reports] == [True] * len(reports)


async def test_acc_copy_167_from_and_to_are_relative_to_the_root(jp_fetch, jp_root_dir, slow):
    _tree(jp_root_dir, {"src/a/big.bin": os.urandom(MiB), "dst/keep": b""})

    reports = await _run(jp_fetch, ["src/a"], "dst")

    assert {
        (report["from"], report["to"])
        for report in reports
        if 0 < report["bytes"] < report["bytes_total"]
    } == {("src/a/big.bin", "dst/a/big.bin")}


@pytest.mark.parametrize("move", [False, True], ids=["copy", "cross-volume-move"])
async def test_acc_copy_171_cancel_keeps_done_files_and_unmoved_sources(
    jp_fetch, jp_root_dir, other_volume, slow, move
):
    files = {f"f{i}": bytes([i]) * MiB for i in range(3)}
    _tree(jp_root_dir, {f"a/{name}": data for name, data in files.items()} | {"dst/keep": b""})
    to = "vol" if move else "dst"
    _, started = await _start(jp_fetch, ["a"], to, move)
    for _ in range(3000):
        if (await _report(jp_fetch, started["id"]))["bytes"] > MiB:
            break
        await asyncio.sleep(0.01)

    cancelled = await jp_fetch(URL, "copy", started["id"], method="DELETE")
    reports = await _reports(jp_fetch, started["id"])

    assert cancelled.code == 204
    assert reports[-1]["not_done"] == ["a"]
    assert reports[-1]["errors"] == []
    copied = sorted(os.listdir(jp_root_dir / to / "a"))
    # No partial file: every file at the destination is whole.
    assert all((jp_root_dir / to / "a" / name).read_bytes() == files[name] for name in copied)
    assert 1 <= len(copied) < 3
    assert reports[-1]["files"] == len(copied)
    left = sorted(os.listdir(jp_root_dir / "a"))
    if move:
        # Each file not yet moved keeps its source; a moved one is gone from it.
        assert sorted(copied + left) == sorted(files)
        assert all((jp_root_dir / "a" / name).read_bytes() == files[name] for name in left)
    else:
        assert left == sorted(files)


async def test_counting_pass_raises_the_totals_and_stops_on_cancel(
    jp_fetch, jp_root_dir, monkeypatch
):
    _tree(
        jp_root_dir, {f"big/f{i}": b"x" for i in range(1000)} | {"c.txt": b"c", "dst/keep": b""}
    )
    walk = routes._bottom_up

    def slow_walk(top, onerror=None):
        # About 2 s for the 1000 files of big.
        for entry in walk(top, onerror):
            time.sleep(0.002)
            yield entry

    monkeypatch.setattr(routes, "_bottom_up", slow_walk)
    _, started = await _start(jp_fetch, ["big", "c.txt"], "dst")
    for _ in range(3000):
        counting = await _report(jp_fetch, started["id"])
        if counting["files_total"]:
            break
        await asyncio.sleep(0.01)

    await jp_fetch(URL, "copy", started["id"], method="DELETE")
    reports = await _reports(jp_fetch, started["id"])

    # A report during the walk already shows totals, before any file is copied.
    assert counting["bytes_total"] > 0 and counting["files"] == 0
    # The walk stopped at Cancel, and no item was started.
    assert reports[-1]["files_total"] < 1000
    assert reports[-1]["not_done"] == ["big", "c.txt"]
    assert reports[-1]["errors"] == []
    assert reports[-1]["files"] == 0
    assert os.listdir(jp_root_dir / "dst") == ["keep"]


async def test_acc_copy_173_fail_reports_each_path_not_done_with_a_reason(
    jp_fetch, jp_root_dir, caplog
):
    if os.geteuid() == 0:
        pytest.skip("root ignores permissions")
    _tree(
        jp_root_dir,
        {
            "a/ok.txt": b"x",
            "a/sub/g.txt": b"y",
            "a/locked.txt": b"z",
            "b/h.txt": b"h",
            "dst/keep": b"",
            "ro/keep": b"",
        },
    )
    (jp_root_dir / "a" / "locked.txt").chmod(0)
    (jp_root_dir / "ro").chmod(0o555)
    try:
        copied = await _run(jp_fetch, ["a"], "dst")
        # A read-only destination folder.
        refused = await _run(jp_fetch, ["b"], "ro")
    finally:
        (jp_root_dir / "a" / "locked.txt").chmod(0o644)
        (jp_root_dir / "ro").chmod(0o755)

    assert copied[-1]["errors"] == [{"path": "a/locked.txt", "message": "permission denied"}]
    assert copied[-1]["not_done"] == ["a"]
    assert (jp_root_dir / "dst" / "a" / "ok.txt").read_bytes() == b"x"
    assert (jp_root_dir / "dst" / "a" / "sub" / "g.txt").read_bytes() == b"y"
    assert not (jp_root_dir / "dst" / "a" / "locked.txt").exists()
    assert refused[-1]["errors"] == [{"path": "b", "message": "permission denied"}]
    assert refused[-1]["not_done"] == ["b"]
    assert os.listdir(jp_root_dir / "ro") == ["keep"]
    # One line per failure, with the library's message.
    warnings = [
        record.getMessage()
        for record in caplog.records
        if record.levelname == "WARNING" and record.getMessage().startswith("Copy of ")
    ]
    assert sorted(warnings) == sorted(
        [
            f"Copy of {jp_root_dir / 'a' / 'locked.txt'} failed: [Errno 13] Permission denied:"
            f" '{jp_root_dir / 'a' / 'locked.txt'}'",
            f"Copy of {jp_root_dir / 'b'} failed: [Errno 13] Permission denied:"
            f" '{jp_root_dir / 'ro' / 'b'}'",
        ]
    )


async def test_acc_copy_178_parallel_two_copies_rise_together_and_take_two_names(
    jp_fetch, jp_root_dir, slow
):
    data = os.urandom(4 * MiB)
    _tree(jp_root_dir, {"d/x.bin": data})
    ids = [(await _start(jp_fetch, ["d/x.bin"], "d"))[1]["id"] for _ in range(2)]
    reports = {job_id: [] for job_id in ids}
    together = False
    for _ in range(3000):
        polled = {
            job_id: await _report(jp_fetch, job_id)
            for job_id in ids
            if not reports[job_id] or not reports[job_id][-1]["done"]
        }
        if not polled:
            break
        for job_id, report in polled.items():
            reports[job_id].append(report)
        together = together or (
            len(polled) == 2
            and all(0 < report["bytes"] < report["bytes_total"] for report in polled.values())
        )
        await asyncio.sleep(0.01)

    assert together
    for job_reports in reports.values():
        assert [report["bytes"] for report in job_reports] == sorted(
            report["bytes"] for report in job_reports
        )
        assert job_reports[-1]["errors"] == []
    assert sorted(os.listdir(jp_root_dir / "d")) == ["x-Copy1.bin", "x-Copy2.bin", "x.bin"]
    assert (jp_root_dir / "d" / "x-Copy1.bin").read_bytes() == data
    assert (jp_root_dir / "d" / "x-Copy2.bin").read_bytes() == data


async def test_copy_names_as_the_contents_manager(jp_fetch, jp_root_dir, jp_serverapp):
    tree = {
        "X/f.txt": b"f",
        "X/sub/s.txt": b"s",
        "X/a.tar.gz": b"t",
        "X/nb.v2.ipynb": NOTEBOOK,
        "X/a-Copy1.txt": b"c",
        "X/into/f.txt": b"g",
        "X/into/sub/keep": b"",
    }
    _tree(jp_root_dir / "ours", tree)
    _tree(jp_root_dir / "stock", tree)

    for path, to in [
        ("X/f.txt", "X"),
        ("X/f.txt", "X"),
        ("X/sub", "X"),
        ("X/f.txt", "X/into"),
        ("X/sub", "X/into"),
        ("X/f.txt", "X/into/sub"),
        ("X/a.tar.gz", "X"),
        ("X/nb.v2.ipynb", "X"),
        ("X/a-Copy1.txt", "X"),
    ]:
        reports = await _run(jp_fetch, [f"ours/{path}"], f"ours/{to}")
        assert reports[-1]["errors"] == []
        await jp_serverapp.contents_manager.copy(f"stock/{path}", f"stock/{to}")

    def listing(top):
        # The stock save of a copied notebook also makes its first checkpoint; the job copies the
        # bytes only, so the checkpoint folder is no part of the naming.
        return sorted(
            str(path.relative_to(top))
            for path in top.rglob("*")
            if ".ipynb_checkpoints" not in path.parts
        )

    ours = listing(jp_root_dir / "ours")
    assert ours == listing(jp_root_dir / "stock")
    assert {
        "X/f-Copy1.txt",
        "X/f-Copy2.txt",
        "X/sub-Copy1/s.txt",
        "X/into/f-Copy1.txt",
        "X/into/sub-Copy1/s.txt",
        "X/into/sub/f.txt",
        "X/a-Copy1.tar.gz",
        "X/nb.v2-Copy1.ipynb",
        "X/a.txt",
    } <= set(ours)


async def test_copy_keeps_mode_mtime_and_links(jp_fetch, jp_root_dir, tmp_path):
    _tree(jp_root_dir, {"a/run.sh": b"#!/bin/sh\n", "a/sub/f.txt": b"f", "dst/keep": b""})
    (tmp_path / "outside").mkdir()
    a = jp_root_dir / "a"
    (a / "run.sh").chmod(0o750)
    os.symlink("run.sh", a / "ln")
    # A link to a folder outside the root and a link loop: copied as links, never followed.
    os.symlink(tmp_path / "outside", a / "out")
    os.symlink("..", a / "sub" / "up")
    for path, seconds in [(a / "run.sh", 1e9), (a / "sub", 1.1e9), (a, 1.2e9)]:
        os.utime(path, (seconds, seconds))

    reports = await _run(jp_fetch, ["a"], "dst")
    await _run(jp_fetch, ["a/ln"], "dst")

    copy = jp_root_dir / "dst" / "a"
    assert reports[-1]["errors"] == []
    assert (reports[-1]["files_total"], reports[-1]["files"]) == (5, 5)
    assert reports[-1]["bytes_total"] == len(b"#!/bin/sh\n") + 1
    assert stat.S_IMODE(os.stat(copy / "run.sh").st_mode) == 0o750
    for name in ("run.sh", "sub", "."):
        assert os.stat(copy / name).st_mtime_ns == os.stat(a / name).st_mtime_ns, name
    assert os.readlink(copy / "ln") == "run.sh"
    assert os.readlink(copy / "out") == str(tmp_path / "outside")
    assert os.readlink(copy / "sub" / "up") == ".."
    assert os.readlink(jp_root_dir / "dst" / "ln") == "run.sh"


async def test_move_on_one_volume_starts_no_job_and_returns_the_path_in_rename(
    jp_fetch, jp_root_dir, other_volume, monkeypatch
):
    monkeypatch.setattr(routes, "_copy_jobs", {})
    _tree(jp_root_dir, {"f.txt": b"f", "a/g.txt": b"g", "dst/keep": b""})
    (other_volume / "v.txt").write_bytes(b"v")

    assert await _start(jp_fetch, ["f.txt", "a"], "dst", move=True) == (
        200,
        {"id": None, "rename": ["f.txt", "a"]},
    )
    assert routes._copy_jobs == {}
    assert (jp_root_dir / "f.txt").exists()
    assert (jp_root_dir / "a" / "g.txt").exists()
    # An item from another volume runs as a job beside it.
    code, answer = await _start(jp_fetch, ["f.txt", "vol/v.txt"], "dst", move=True)
    reports = await _reports(jp_fetch, answer["id"])

    assert (code, answer["rename"]) == (202, ["f.txt"])
    assert (reports[-1]["errors"], reports[-1]["not_done"], reports[-1]["cross"]) == ([], [], True)
    assert (jp_root_dir / "dst" / "v.txt").read_bytes() == b"v"
    assert not (other_volume / "v.txt").exists()
    assert (jp_root_dir / "f.txt").exists()


async def test_cross_volume_move_onto_an_existing_name_reports_already_exists_and_keeps_the_source(
    jp_fetch, jp_root_dir, other_volume
):
    _tree(jp_root_dir, {"f.txt": b"new"})
    (other_volume / "f.txt").write_bytes(b"old")

    reports = await _run(jp_fetch, ["f.txt"], "vol", move=True)

    assert reports[-1]["errors"] == [{"path": "f.txt", "message": "already exists"}]
    assert reports[-1]["not_done"] == ["f.txt"]
    assert (jp_root_dir / "f.txt").read_bytes() == b"new"
    assert (other_volume / "f.txt").read_bytes() == b"old"


async def test_def_copy_42_a_failed_move_logs_the_library_message_through_the_root_logger(
    jp_fetch, jp_root_dir, jp_serverapp, monkeypatch, caplog
):
    name = "LønholmAgro_DailyDelPro10.11_20260629T015034_V_HN_BCS_DR_BA.bak.zip"
    _tree(jp_root_dir, {f"archive/{name}": b"zip", "delpro_data/keep": b""})
    # Two mounts, so the move runs as a job; the destination file fails as a soft NFS mount does.
    monkeypatch.setattr(
        routes,
        "_mounts",
        lambda: [os.path.realpath(jp_root_dir / folder) for folder in ("archive", "delpro_data")],
    )
    real_reserve = routes._reserve

    def eio_reserve(src, info, target):
        if os.path.basename(target) == name:
            raise OSError(errno.EIO, "Input/output error")
        real_reserve(src, info, target)

    monkeypatch.setattr(routes, "_reserve", eio_reserve)
    # As ServerApp.init_logging leaves it in a server; pytest-jupyter turns it on for caplog.
    monkeypatch.setattr(jp_serverapp.log, "propagate", False)

    reports = await _run(jp_fetch, [f"archive/{name}"], "delpro_data", move=True)

    assert reports[-1]["errors"] == [{"path": f"archive/{name}", "message": "read or write error"}]
    assert (jp_root_dir / "archive" / name).read_bytes() == b"zip"
    # caplog sits on the root logger, where a deployment's logging_config puts its file handler.
    assert [r.getMessage() for r in caplog.records if r.levelname == "WARNING"] == [
        f"Move of {jp_root_dir / 'archive' / name} failed: [Errno 5] Input/output error"
    ]


def _fd_path(fd: int) -> str:
    return os.readlink(f"/proc/self/fd/{fd}")


async def test_acc_copy_193_a_copy_fsyncs_after_each_chunk_and_once_at_the_end(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    data = os.urandom(3 * MiB + 1000)
    _tree(jp_root_dir, {"f.bin": data, "dst/keep": b""})
    real_fsync = os.fsync
    synced = []

    def fsync(fd):
        synced.append(_fd_path(fd))
        real_fsync(fd)

    monkeypatch.setattr(os, "fsync", fsync)

    reports = await _run(jp_fetch, ["f.bin"], "dst")

    assert reports[-1]["errors"] == []
    # After each of the three full chunks, then once for the last part.
    assert synced == [os.path.realpath(jp_root_dir / "dst" / "f.bin")] * 4
    assert (jp_root_dir / "dst" / "f.bin").read_bytes() == data


async def test_acc_copy_193_a_cross_volume_move_removes_its_source_after_the_final_fsync(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    data = os.urandom(2 * MiB + 1000)
    _tree(jp_root_dir, {"a/f.bin": data, "b/keep": b""})
    # Two mounts, so the move runs as a job.
    monkeypatch.setattr(
        routes, "_mounts", lambda: [os.path.realpath(jp_root_dir / name) for name in ("a", "b")]
    )
    src, target = str(jp_root_dir / "a" / "f.bin"), jp_root_dir / "b" / "f.bin"
    real_fsync, real_unlink = os.fsync, os.unlink
    steps = []

    def fsync(fd):
        steps.append(("fsync", _fd_path(fd)))
        real_fsync(fd)

    def unlink(path, *args, **kwargs):
        # With the bytes the destination holds when the source goes.
        steps.append(("unlink", os.fspath(path), os.path.getsize(target)))
        real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "fsync", fsync)
    monkeypatch.setattr(os, "unlink", unlink)

    reports = await _run(jp_fetch, ["a/f.bin"], "b", move=True)

    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], [])
    assert steps == [("fsync", os.path.realpath(target))] * 3 + [("unlink", src, len(data))]
    assert target.read_bytes() == data


async def test_acc_copy_193_an_fsync_error_removes_the_partial_file_and_keeps_the_source(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    data = os.urandom(2 * MiB + 1000)
    _tree(jp_root_dir, {"a/f.bin": data, "b/keep": b""})
    monkeypatch.setattr(
        routes, "_mounts", lambda: [os.path.realpath(jp_root_dir / name) for name in ("a", "b")]
    )
    target = os.path.realpath(jp_root_dir / "b" / "f.bin")
    real_fsync = os.fsync

    def fsync(fd):
        # A soft NFS mount whose server did not answer a WRITE in time.
        if _fd_path(fd) == target:
            raise OSError(errno.EIO, "Input/output error")
        real_fsync(fd)

    monkeypatch.setattr(os, "fsync", fsync)

    _, started = await _start(jp_fetch, ["a/f.bin"], "b", move=True)
    # The error pauses the move (ACC-COPY-194); Skip file ends the item as a failure.
    paused = await _paused(jp_fetch, started["id"])
    await _act(jp_fetch, started["id"], "skip")
    reports = await _reports(jp_fetch, started["id"])

    assert paused["paused"] == {"path": "a/f.bin", "reason": "read or write error"}
    assert reports[-1]["errors"] == [{"path": "a/f.bin", "message": "read or write error"}]
    assert reports[-1]["not_done"] == ["a/f.bin"]
    assert os.listdir(jp_root_dir / "b") == ["keep"]
    assert (jp_root_dir / "a" / "f.bin").read_bytes() == data


def _fail_one_write(monkeypatch, target, offset):
    """Make the first write at `offset` into the file `target` raise EIO, as a soft NFS mount does
    when its server does not answer a WRITE in time; the offsets written, in order."""
    offsets, real_open = [], open

    class Writer:
        def __init__(self, file):
            self.file = file

        def __getattr__(self, name):
            return getattr(self.file, name)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.file.close()

        def write(self, data):
            offsets.append(self.file.tell())
            if offsets[-1] == offset and offsets.count(offset) == 1:
                raise OSError(errno.EIO, "Input/output error")
            return self.file.write(data)

    def fake_open(path, mode="r", *args, **kwargs):
        file = real_open(path, mode, *args, **kwargs)
        mine = mode != "rb" and os.path.realpath(path) == os.path.realpath(target)
        return Writer(file) if mine else file

    monkeypatch.setattr(routes, "open", fake_open, raising=False)
    return offsets


async def _paused(jp_fetch, job_id):
    """Poll a copy job until it reports a pause or its end; that report."""
    for _ in range(3000):
        report = await _report(jp_fetch, job_id)
        if report.get("paused") or report["done"]:
            return report
        await asyncio.sleep(0.01)
    raise AssertionError("the copy did not pause")


async def _act(jp_fetch, job_id, action):
    return await jp_fetch(URL, "copy", job_id, method="POST", body=json.dumps({"action": action}))


async def test_acc_copy_194_a_failed_write_pauses_and_retry_goes_on_from_the_last_fsynced_chunk(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", 2 * MiB)
    data = os.urandom(5 * MiB + 1000)
    _tree(jp_root_dir, {"f.bin": data, "dst/keep": b""})
    offsets = _fail_one_write(monkeypatch, jp_root_dir / "dst" / "f.bin", 3 * MiB)

    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    paused = await _paused(jp_fetch, started["id"])
    retried = await _act(jp_fetch, started["id"], "retry")
    # A second press finds the job going again.
    with pytest.raises(HTTPClientError) as again:
        await _act(jp_fetch, started["id"], "retry")
    reports = await _reports(jp_fetch, started["id"])

    assert paused["paused"] == {"path": "f.bin", "reason": "read or write error"}
    assert (paused["bytes"], paused["file_bytes"]) == (3 * MiB, 3 * MiB)
    assert retried.code == 204
    assert again.value.code == 409
    # Truncated to the fsync at 2 MiB, the file is written again from there.
    assert offsets == [0, MiB, 2 * MiB, 3 * MiB, 2 * MiB, 3 * MiB, 4 * MiB, 5 * MiB]
    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], [])
    # The counters went back to 2 MiB with the file, so they end at its size.
    assert reports[-1]["bytes"] == reports[-1]["file_bytes"] == len(data)
    assert (jp_root_dir / "dst" / "f.bin").read_bytes() == data


async def test_acc_copy_194_retry_while_the_destination_still_fails_to_open_pauses_again(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    data = os.urandom(3 * MiB + 1000)
    _tree(jp_root_dir, {"f.bin": data, "dst/keep": b""})
    target = os.path.realpath(jp_root_dir / "dst" / "f.bin")
    _fail_one_write(monkeypatch, target, 2 * MiB)
    write_open, pauses, reopens = routes.open, [], []
    real_pause = routes._pause

    def pause(*args):
        pauses.append(args)
        real_pause(*args)

    def eio_reopen(path, mode="r", *args, **kwargs):
        # The share still does not answer when Retry opens the destination again.
        if pauses and mode == "r+b" and os.path.realpath(path) == target:
            reopens.append(path)
            if len(reopens) == 1:
                raise OSError(errno.EIO, "Input/output error")
        return write_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(routes, "_pause", pause)
    monkeypatch.setattr(routes, "open", eio_reopen, raising=False)

    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    first = await _paused(jp_fetch, started["id"])
    await _act(jp_fetch, started["id"], "retry")
    second = await _paused(jp_fetch, started["id"])
    await _act(jp_fetch, started["id"], "retry")
    reports = await _reports(jp_fetch, started["id"])

    assert first["paused"] == {"path": "f.bin", "reason": "read or write error"}
    assert second["paused"] == {"path": "f.bin", "reason": "read or write error"}
    assert len(pauses) == 2
    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], [])
    assert (jp_root_dir / "dst" / "f.bin").read_bytes() == data


async def test_acc_copy_194_skip_removes_the_partial_file_keeps_the_source_and_moves_the_next_item(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    first, second = os.urandom(3 * MiB), os.urandom(MiB + 1000)
    _tree(jp_root_dir, {"a/f1.bin": first, "a/f2.bin": second, "b/keep": b""})
    # Two mounts, so the move runs as a job.
    monkeypatch.setattr(
        routes, "_mounts", lambda: [os.path.realpath(jp_root_dir / name) for name in ("a", "b")]
    )
    _fail_one_write(monkeypatch, jp_root_dir / "b" / "f1.bin", 2 * MiB)

    _, started = await _start(jp_fetch, ["a/f1.bin", "a/f2.bin"], "b", move=True)
    paused = await _paused(jp_fetch, started["id"])
    partial = os.path.getsize(jp_root_dir / "b" / "f1.bin")
    skipped = await _act(jp_fetch, started["id"], "skip")
    reports = await _reports(jp_fetch, started["id"])

    assert paused["paused"] == {"path": "a/f1.bin", "reason": "read or write error"}
    assert partial == 2 * MiB
    assert skipped.code == 204
    assert reports[-1]["errors"] == [{"path": "a/f1.bin", "message": "read or write error"}]
    assert reports[-1]["not_done"] == ["a/f1.bin"]
    assert sorted(os.listdir(jp_root_dir / "b")) == ["f2.bin", "keep"]
    assert (jp_root_dir / "b" / "f2.bin").read_bytes() == second
    assert os.listdir(jp_root_dir / "a") == ["f1.bin"]
    assert (jp_root_dir / "a" / "f1.bin").read_bytes() == first


async def test_acc_copy_194_cancel_while_paused_ends_the_job_and_leaves_no_partial_file(
    jp_fetch, jp_root_dir, monkeypatch
):
    _tree(jp_root_dir, {"f.bin": os.urandom(3 * MiB), "dst/keep": b""})
    _fail_one_write(monkeypatch, jp_root_dir / "dst" / "f.bin", MiB)

    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    paused = await _paused(jp_fetch, started["id"])
    cancelled = await jp_fetch(URL, "copy", started["id"], method="DELETE")
    reports = await _reports(jp_fetch, started["id"])

    assert paused["paused"] == {"path": "f.bin", "reason": "read or write error"}
    assert cancelled.code == 204
    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], ["f.bin"])
    assert os.listdir(jp_root_dir / "dst") == ["keep"]


PARTIAL = {"path": "dst/f.bin", "message": "partial copy left"}


@pytest.mark.parametrize(
    "action, errors",
    [
        ("skip", [PARTIAL, {"path": "f.bin", "message": "read or write error"}]),
        ("cancel", [PARTIAL]),
    ],
)
async def test_acc_copy_200_a_partial_file_the_share_keeps_is_listed_with_its_destination(
    jp_fetch, jp_root_dir, monkeypatch, action, errors
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    _tree(jp_root_dir, {"f.bin": os.urandom(3 * MiB), "dst/keep": b""})
    target = os.path.realpath(jp_root_dir / "dst" / "f.bin")
    _fail_one_write(monkeypatch, target, 2 * MiB)
    real_unlink = os.unlink

    def unlink(path, *args, **kwargs):
        # The share still does not answer when the partial file is removed.
        if os.path.realpath(path) == target:
            raise OSError(errno.EIO, "Input/output error")
        real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(os, "unlink", unlink)

    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    await _paused(jp_fetch, started["id"])
    if action == "skip":
        await _act(jp_fetch, started["id"], "skip")
    else:
        await jp_fetch(URL, "copy", started["id"], method="DELETE")
    reports = await _reports(jp_fetch, started["id"])

    assert (reports[-1]["errors"], reports[-1]["not_done"]) == (errors, ["f.bin"])
    assert os.path.getsize(target) == 2 * MiB


async def test_def_copy_45_the_time_paused_stays_out_of_elapsed(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    _tree(jp_root_dir, {"f.bin": os.urandom(3 * MiB), "dst/keep": b""})
    _fail_one_write(monkeypatch, jp_root_dir / "dst" / "f.bin", 2 * MiB)

    begun = time.monotonic()
    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    await _paused(jp_fetch, started["id"])
    paused_at = time.monotonic()
    await asyncio.sleep(1)
    # At most the time the job waited paused: it paused before and goes on after.
    paused_for = time.monotonic() - paused_at
    await _act(jp_fetch, started["id"], "retry")
    reports = await _reports(jp_fetch, started["id"])
    wall = time.monotonic() - begun

    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], [])
    # The job ran within the wall time, so its elapsed without the pause is at most this.
    assert reports[-1]["elapsed"] <= wall - paused_for


async def test_def_copy_47_elapsed_holds_during_the_pause_and_after_retry(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    _tree(jp_root_dir, {"f.bin": os.urandom(3 * MiB), "dst/keep": b""})
    _fail_one_write(monkeypatch, jp_root_dir / "dst" / "f.bin", 2 * MiB)

    _, started = await _start(jp_fetch, ["f.bin"], "dst")
    first = await _paused(jp_fetch, started["id"])
    await asyncio.sleep(2)
    last = await _report(jp_fetch, started["id"])
    await _act(jp_fetch, started["id"], "retry")
    reports = await _reports(jp_fetch, started["id"])

    assert first["paused"] and last["paused"]
    assert (reports[-1]["errors"], reports[-1]["not_done"]) == ([], [])
    # _pause takes the time paused out of elapsed once a second, so a report counts under 1 s of it.
    assert last["elapsed"] - first["elapsed"] < 1.5
    assert reports[0]["elapsed"] > last["elapsed"] - 1.5


async def test_acc_copy_194_a_pause_no_page_reads_ends_as_skip_file(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "COPY_FSYNC_BYTES", MiB)
    monkeypatch.setattr(routes, "_UNREAD_PAUSE_SECONDS", 0.5)
    data = os.urandom(3 * MiB)
    _tree(jp_root_dir, {"a/f.bin": data, "b/keep": b""})
    # Two mounts, so the move runs as a job.
    monkeypatch.setattr(
        routes, "_mounts", lambda: [os.path.realpath(jp_root_dir / name) for name in ("a", "b")]
    )
    _fail_one_write(monkeypatch, jp_root_dir / "b" / "f.bin", 2 * MiB)

    _, started = await _start(jp_fetch, ["a/f.bin"], "b", move=True)
    # No GET until the end, as after a closed or reloaded page: the test reads the table itself.
    job, partial = routes._copy_jobs[started["id"]], None
    for _ in range(1000):
        if job["paused"] and partial is None:
            partial = os.path.getsize(jp_root_dir / "b" / "f.bin")
        if job["done"]:
            break
        await asyncio.sleep(0.01)
    report = await _report(jp_fetch, started["id"])

    assert partial == 2 * MiB
    assert report["done"]
    assert report["errors"] == [{"path": "a/f.bin", "message": "read or write error"}]
    assert report["not_done"] == ["a/f.bin"]
    assert os.listdir(jp_root_dir / "b") == ["keep"]
    assert (jp_root_dir / "a" / "f.bin").read_bytes() == data


async def test_cross_volume_move_renames_a_checkpoint_and_makes_no_checkpoint_folder(
    jp_fetch, jp_root_dir, other_volume
):
    _tree(
        jp_root_dir,
        {
            "nb.ipynb": NOTEBOOK,
            ".ipynb_checkpoints/nb-checkpoint.ipynb": NOTEBOOK,
            "sub/f.txt": b"f",
        },
    )
    (other_volume / "other").mkdir()

    moved = await _run(jp_fetch, ["nb.ipynb"], "vol", move=True)
    plain = await _run(jp_fetch, ["sub/f.txt"], "vol/other", move=True)

    assert moved[-1]["not_done"] == plain[-1]["not_done"] == []
    assert (other_volume / ".ipynb_checkpoints" / "nb-checkpoint.ipynb").read_bytes() == NOTEBOOK
    assert os.listdir(jp_root_dir / ".ipynb_checkpoints") == []
    assert os.listdir(jp_root_dir / "sub") == []
    assert os.listdir(other_volume / "other") == ["f.txt"]


async def test_copy_and_move_emit_their_events_on_the_server_loop(
    jp_fetch, jp_root_dir, jp_serverapp, other_volume
):
    contents_manager = jp_serverapp.contents_manager
    events = []

    async def listener(logger, schema_id, data):
        events.append((data["action"], data["path"], data["source_path"], threading.get_ident()))

    contents_manager.event_logger.add_listener(
        schema_id=contents_manager.event_schema_id, listener=listener
    )
    _tree(jp_root_dir, {"f.txt": b"f", "a/g.txt": b"g", "m.txt": b"m", "dst/keep": b""})

    await _run(jp_fetch, ["f.txt", "a"], "dst")
    await _run(jp_fetch, ["m.txt"], "vol", move=True)
    await asyncio.sleep(0.05)

    # A folder copy emits none, as the contents manager's own.
    server = threading.get_ident()
    assert events == [
        ("copy", "dst/f.txt", "f.txt", server),
        ("rename", "vol/m.txt", "m.txt", server),
    ]


async def test_copy_reports_a_fifo_and_copies_the_rest(jp_fetch, jp_root_dir):
    _tree(jp_root_dir, {"a/f.txt": b"f", "dst/keep": b""})
    os.mkfifo(jp_root_dir / "a" / "pipe")

    reports = await _run(jp_fetch, ["a", "a/pipe"], "dst")

    assert reports[-1]["errors"] == [{"path": "a/pipe", "message": "not a regular file"}] * 2
    assert reports[-1]["not_done"] == ["a", "a/pipe"]
    assert os.listdir(jp_root_dir / "dst" / "a") == ["f.txt"]
    assert sorted(os.listdir(jp_root_dir / "dst")) == ["a", "keep"]


async def test_ended_unread_jobs_leave_the_table_at_a_later_start(
    jp_fetch, jp_root_dir, monkeypatch
):
    monkeypatch.setattr(routes, "_copy_jobs", {})
    monkeypatch.setattr(routes, "_ENDED_JOB_SECONDS", 0)
    _tree(jp_root_dir, {"f.txt": b"f", "dst/keep": b""})
    _, first = await _start(jp_fetch, ["f.txt"], "dst")
    while not routes._copy_jobs[first["id"]]["done"]:
        await asyncio.sleep(0.01)

    _, second = await _start(jp_fetch, ["f.txt"], "dst")

    assert list(routes._copy_jobs) == [second["id"]]
    for method in ("GET", "DELETE"):
        with pytest.raises(HTTPClientError) as refused:
            await jp_fetch(URL, "copy", first["id"], method=method)
        assert refused.value.code == 404
    await _reports(jp_fetch, second["id"])


@pytest.mark.parametrize(
    "body, code",
    [
        ({"paths": ["../outside"], "to": "dst"}, 404),
        ({"paths": ["f.txt"], "to": ".."}, 404),
        ({"paths": ["f.txt"], "to": "g.txt"}, 404),
        ({"paths": ["f.txt"], "to": "missing"}, 404),
        ({"paths": [".hidden"], "to": "dst"}, 400),
        ({"paths": ["f.txt"], "to": ".hdir"}, 400),
        ({"paths": ["a"], "to": "a"}, 400),
        ({"paths": ["f.txt", "a"], "to": "a/b"}, 400),
        ({"paths": ["a"], "to": "ln/b"}, 400),
        ({"paths": ["f.txt"]}, 400),
        ({"paths": [], "to": "dst"}, 400),
    ],
    ids=[
        "source-outside",
        "destination-outside",
        "destination-a-file",
        "destination-missing",
        "hidden-source",
        "hidden-destination",
        "into-itself",
        "below-itself",
        "below-itself-through-a-link",
        "no-destination",
        "no-paths",
    ],
)
async def test_copy_refuses_a_path(jp_fetch, jp_root_dir, monkeypatch, body, code):
    monkeypatch.setattr(routes, "_copy_jobs", {})
    _tree(
        jp_root_dir,
        {
            "f.txt": b"f",
            "g.txt": b"g",
            ".hidden": b"h",
            ".hdir/keep": b"",
            "a/b/keep": b"",
            "dst/keep": b"",
        },
    )
    os.symlink(jp_root_dir / "a", jp_root_dir / "ln")

    for move in (False, True):
        with pytest.raises(HTTPClientError) as refused:
            await jp_fetch(URL, "copy", method="POST", body=json.dumps(body | {"move": move}))
        assert refused.value.code == code

    assert routes._copy_jobs == {}
    assert sorted(os.listdir(jp_root_dir / "dst")) == ["keep"]


@pytest.mark.parametrize(
    "parts, method",
    [
        (("copy",), "POST"),
        (("copy", "0" * 32), "GET"),
        (("copy", "0" * 32), "POST"),
        (("copy", "0" * 32), "DELETE"),
    ],
)
async def test_copy_routes_refuse_an_unauthenticated_request(jp_fetch, parts, method):
    body = json.dumps({"paths": ["f"], "to": ""}) if method == "POST" else None
    with pytest.raises(HTTPClientError) as refused:
        await jp_fetch(URL, *parts, method=method, body=body, headers={"Authorization": ""})
    assert refused.value.code == 403
