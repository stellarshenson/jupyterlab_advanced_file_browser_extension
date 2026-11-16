"""
API handlers for drag-and-drop path resolution and the permanent delete.

``terminal-cwd/<name>`` returns the current working directory of a terminal,
used to turn an absolute path into a path relative to that terminal.

``delete/size``, ``delete`` and ``delete/<id>`` size a selection against
``LARGE_REMOVAL_BYTES``, start a removal to the trash or a permanent one and
report its progress. ``delete/trash-check`` says for each item of a selection whether
the trash management extension monitors its trash, so Move to Trash may be offered.

``AdvancedFileBrowser`` holds the server options of this extension.
"""
import asyncio
import errno
import json
import os
import re
import stat
import subprocess
import sys
import uuid

from jupyter_core.paths import is_hidden
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import ensure_async, to_api_path, url_path_join
import tornado
from traitlets import Bool
from traitlets.config import Configurable

try:
    from send2trash import plat_other
except (ImportError, AttributeError):  # Windows: the module calls os.getuid on import
    plat_other = None

# A selection above this many bytes gets the warning that the trash is not advised.
# Not a setting; the Galata server config lowers it by assigning this module name.
LARGE_REMOVAL_BYTES = 10 * 1024 ** 3

# The mount table of this process, read as core patches reads it.
_MOUNTINFO = "/proc/self/mountinfo"

# The Delete Failed reasons in this extension's words, by the errno of the failure.
_REASONS = {
    errno.EACCES: "permission denied",
    errno.EPERM: "permission denied",
    errno.ENOENT: "not found",
    errno.EBUSY: "in use",
}

# shortcut: a job leaves memory only through the GET that reports it done, so a job whose
# page closed mid-removal stays; add an expiry if abandoned jobs ever accumulate.
_jobs: dict[str, dict] = {}
_tasks: set[asyncio.Task] = set()


class AdvancedFileBrowser(Configurable):
    """The server options of this extension, set as ``c.AdvancedFileBrowser.<name>``."""

    trash_on_all_volumes = Bool(
        False,
        config=True,
        help=(
            "Offer Move to Trash for every item whatever its mount, and move it through the"
            " contents manager's delete; False offers it only where the trash management"
            " extension monitors the trash (TrashManagement.locations)."
        ),
    )

class HelloRouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": (
                "Hello, world!"
                " This is the '/jupyterlab-advanced-file-browser-extension/hello' endpoint."
                " Try visiting me in your browser!"
            ),
        }))


class TerminalCwdHandler(APIHandler):
    """Handler for getting terminal current working directory."""

    @tornado.web.authenticated
    async def get(self, terminal_name: str):
        """Get the cwd for a terminal by name.

        Args:
            terminal_name: The name of the terminal (e.g., "1", "2")
        """
        try:
            # Get the terminal manager from the server app
            terminal_manager = self.settings.get("terminal_manager")

            if terminal_manager is None:
                self.set_status(503)
                self.finish(json.dumps({
                    "error": "Terminal service not available"
                }))
                return

            # Look the terminal up; never create one. terminado's
            # NamedTermManager.get_terminal is a get-*or-create* API, so
            # calling it here would spawn a live shell for any name a
            # request happens to carry - unbounded, unculled (the culler
            # only starts from create()), and reachable by a plain GET,
            # which tornado does not XSRF-check.
            terminals = getattr(terminal_manager, "terminals", None) or {}
            terminal = terminals.get(terminal_name)

            if terminal is None:
                self.set_status(404)
                self.finish(json.dumps({
                    "error": f"Terminal '{terminal_name}' not found"
                }))
                return

            # Get the pty process
            ptyproc = getattr(terminal, "ptyproc", None)

            if ptyproc is None:
                self.set_status(500)
                self.finish(json.dumps({
                    "error": "Could not access terminal process"
                }))
                return

            pid = ptyproc.pid
            cwd = self._get_process_cwd(pid)

            if cwd is None:
                self.set_status(500)
                self.finish(json.dumps({
                    "error": "Could not determine terminal cwd"
                }))
                return

            self.finish(json.dumps({
                "terminal_name": terminal_name,
                "cwd": cwd
            }))

        except Exception as e:
            # The message goes to the server log, not to the browser: the
            # frontend discards the body on any non-ok response, so echoing
            # the exception text buys nothing and discloses internals.
            self.log.exception("Error getting terminal cwd: %s", e)
            self.set_status(500)
            self.finish(json.dumps({
                "error": "Could not determine the terminal working directory"
            }))

    def _get_process_cwd(self, pid: int) -> str | None:
        """Get the current working directory of a process.

        Traverses the full process tree recursively, tries deepest shells
        first, but validates that every candidate cwd is a real filesystem
        directory (filters out pseudo-paths like /proc/*/fdinfo or /sys/*
        that appear on Chrome and other sandboxed processes).

        Args:
            pid: Process ID

        Returns:
            The cwd path or None if it couldn't be determined
        """
        known_shells = {'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh'}

        # Build complete process tree with depth information
        all_processes = []
        self._collect_process_tree(pid, 0, all_processes, known_shells)

        # Shells first, then deepest first among them. Shell-ness has to be
        # the primary key: with depth first, a non-shell child that changed
        # directory outranks the shell the user is actually typing in, and
        # the drop resolves against that child's directory.
        all_processes.sort(key=lambda x: (not x[2], -x[1]))

        # Try each process, deepest shells first, but validate cwd
        for target_pid, depth, is_shell, comm in all_processes:
            cwd = self._try_get_cwd(target_pid)
            if cwd and self._is_valid_cwd(cwd):
                return cwd

        # Fallback: the original pid, but held to the same validity gate.
        # The loop above already tried this pid, so reaching here means its
        # cwd was missing or rejected; returning it unchecked would hand back
        # exactly the pseudo-filesystem paths _is_valid_cwd exists to filter.
        cwd = self._try_get_cwd(pid)
        return cwd if cwd and self._is_valid_cwd(cwd) else None

    def _is_valid_cwd(self, path: str) -> bool:
        """Check whether a cwd path is a real filesystem directory.

        Filters out pseudo-filesystem paths (e.g. /proc/*/fdinfo,
        /sys/*) that appear on sandboxed processes like Chrome.

        Args:
            path: Absolute path to validate

        Returns:
            True if the path is a usable real directory
        """
        if not path or not path.startswith('/'):
            return False
        # Reject kernel pseudo-filesystems
        if path.startswith(('/proc/', '/sys/', '/dev/')):
            return False
        return os.path.isdir(path)

    def _collect_process_tree(
        self,
        pid: int,
        depth: int,
        results: list,
        known_shells: set
    ) -> None:
        """Recursively collect all processes in the tree with depth info.

        Args:
            pid: Process ID to start from
            depth: Current depth in the tree
            results: List to append (pid, depth, is_shell, comm) tuples
            known_shells: Set of known shell command names
        """
        # Get process command name
        comm = self._get_process_comm(pid)
        is_shell = comm in known_shells if comm else False

        results.append((pid, depth, is_shell, comm))

        # Get direct children and recurse
        children = self._get_direct_children(pid)
        for child_pid in children:
            self._collect_process_tree(child_pid, depth + 1, results, known_shells)

    def _get_process_comm(self, pid: int) -> str | None:
        """Get the command name for a process.

        Args:
            pid: Process ID

        Returns:
            Command name or None
        """
        try:
            if sys.platform == "linux":
                comm_file = f"/proc/{pid}/comm"
                if os.path.exists(comm_file):
                    with open(comm_file, "r") as f:
                        return f.read().strip()
            else:
                # macOS/other: use ps
                result = subprocess.run(
                    ["ps", "-p", str(pid), "-o", "comm="],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    # ps may return full path, extract basename
                    return os.path.basename(result.stdout.strip())
        except Exception:
            pass
        return None

    def _get_direct_children(self, parent_pid: int) -> list[int]:
        """Get direct child PIDs of a process.

        Args:
            parent_pid: Parent process ID

        Returns:
            List of child PIDs
        """
        children = []
        # An empty children file means "leaf", not "unreadable". Without this
        # distinction the pgrep fallback fired for every leaf process, so a
        # terminal running a wide build cost one subprocess spawn per leaf on
        # every drop - each with a 5 second timeout, on the tornado IOLoop.
        listed = False
        try:
            if sys.platform == "linux":
                children_file = f"/proc/{parent_pid}/task/{parent_pid}/children"
                if os.path.exists(children_file):
                    with open(children_file, "r") as f:
                        for child in f.read().strip().split():
                            try:
                                children.append(int(child))
                            except ValueError:
                                pass
                    listed = True

            # Fallback: use pgrep, only when the children file was unavailable
            if not listed and not children:
                result = subprocess.run(
                    ["pgrep", "-P", str(parent_pid)],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    for pid_str in result.stdout.strip().split("\n"):
                        try:
                            children.append(int(pid_str))
                        except ValueError:
                            pass
        except Exception:
            pass
        return children

    def _try_get_cwd(self, pid: int) -> str | None:
        """Try to get cwd for a specific process.

        Args:
            pid: Process ID

        Returns:
            The cwd path or None
        """
        cwd = None

        if sys.platform == "linux":
            # Try /proc/pid/cwd first
            cwd = self._get_cwd_linux(pid)

            # Fallback to PWD from environment
            if cwd is None:
                cwd = self._get_pwd_from_environ(pid)

        elif sys.platform == "darwin":
            cwd = self._get_cwd_macos(pid)
        else:
            # Windows or other - try Linux methods
            cwd = self._get_cwd_linux(pid)
            if cwd is None:
                cwd = self._get_pwd_from_environ(pid)

        return cwd

    def _get_cwd_linux(self, pid: int) -> str | None:
        """Get process cwd on Linux using /proc filesystem.

        Args:
            pid: Process ID

        Returns:
            The cwd path or None
        """
        try:
            cwd_link = f"/proc/{pid}/cwd"
            if os.path.exists(cwd_link):
                return os.readlink(cwd_link)
        except (OSError, PermissionError):
            pass
        return None

    def _get_pwd_from_environ(self, pid: int) -> str | None:
        """Get PWD environment variable from process environment.

        Args:
            pid: Process ID

        Returns:
            The PWD value or None
        """
        try:
            environ_file = f"/proc/{pid}/environ"
            if os.path.exists(environ_file):
                with open(environ_file, "rb") as f:
                    environ_data = f.read()
                    # Environment variables are null-separated
                    for entry in environ_data.split(b"\x00"):
                        if entry.startswith(b"PWD="):
                            return entry[4:].decode("utf-8", errors="replace")
        except (OSError, PermissionError):
            pass
        return None

    def _get_cwd_macos(self, pid: int) -> str | None:
        """Get process cwd on macOS using lsof.

        Args:
            pid: Process ID

        Returns:
            The cwd path or None
        """
        try:
            result = subprocess.run(
                ["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                for line in result.stdout.split("\n"):
                    if line.startswith("n"):
                        return line[1:]  # Remove the 'n' prefix
        except Exception:
            pass
        return None


def _request_paths(handler: APIHandler) -> list[str]:
    """The API paths of the request body ``{"paths": [...]}``."""
    body = handler.get_json_body()
    paths = body.get("paths") if isinstance(body, dict) else None
    if not paths or not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise tornado.web.HTTPError(400, "Expected a non-empty list of paths")
    return [path.strip("/") for path in paths]


def _removal_size(os_paths: list[str]) -> int:
    """Bytes of the files and links at or below `os_paths`, counted until the
    sum passes LARGE_REMOVAL_BYTES; links are counted as themselves, never followed."""
    total = 0
    stack = list(os_paths)
    while stack and total <= LARGE_REMOVAL_BYTES:
        path = stack.pop()
        try:
            info = os.lstat(path)
            if stat.S_ISDIR(info.st_mode):
                with os.scandir(path) as entries:
                    stack.extend(entry.path for entry in entries)
            else:
                total += info.st_size
        except OSError:
            pass
    return total


def _bottom_up(top: str, onerror=None):
    """Yield `(path, is_folder)` for `top` and everything below it, each folder
    after its content; a link is an entry of its own and is never followed."""
    is_folder = os.path.isdir(top) and not os.path.islink(top)
    if is_folder:
        for folder, folders, files in os.walk(top, topdown=False, onerror=onerror):
            for name in files:
                yield os.path.join(folder, name), False
            for name in folders:
                path = os.path.join(folder, name)
                yield path, not os.path.islink(path)
    yield top, is_folder


def _reason(error: BaseException | None) -> str:
    """The Delete Failed reason for `error`, never the library's message, which can hold an
    absolute server path: an HTTPError of the contents manager's delete by its status, or by
    the OSError behind it (send2trash failed); an OSError by its errno."""
    if isinstance(error, tornado.web.HTTPError):
        reason = {403: "permission denied", 404: "not found"}.get(error.status_code)
        return reason or _reason(error.__cause__)
    return _REASONS.get(getattr(error, "errno", None), "reason unknown")


def _remove(job: dict, root: str, os_paths: list[str], log) -> None:
    """Remove `os_paths` and everything below them, counting into `job`."""
    job["total"] = sum(1 for top in os_paths for _ in _bottom_up(top))
    # Failures already reported, and the folders kept only because something below failed.
    explained: set[str] = set()

    def fail(error: OSError) -> None:
        path = error.filename
        if path not in explained:
            # The library's message reaches the server log only, as in _trash.
            log.warning("Delete of %s failed: %s", path, error)
            job["errors"].append({"path": to_api_path(path, root), "message": _reason(error)})
        explained.update((path, os.path.dirname(path)))

    for top in os_paths:
        for path, is_folder in _bottom_up(top, fail):
            try:
                if is_folder:
                    os.rmdir(path)
                else:
                    os.unlink(path)
                job["removed"] += 1
            except OSError as error:
                fail(error)


async def _trash(job: dict, contents_manager, paths: list[str], os_paths: list[str], log) -> None:
    """Move `paths` to the trash through the contents manager's delete, so the server's
    delete_file runs with its checks and any patch of it, counting one equal share per item
    into `job` when the item ends."""
    job["total"] = len(paths)
    for index, (path, os_path) in enumerate(zip(paths, os_paths)):
        try:
            await ensure_async(contents_manager.delete(path))
        except tornado.web.HTTPError as error:
            # Never a permanent removal in its place: the item stays. The library's message
            # reaches the server log only.
            log.warning("Move to trash of %s failed: %s", os_path, error)
            job["errors"].append({"path": path, "message": _reason(error)})
        except Exception as error:
            # Any other fault is reported for this item too, and the next items are still moved.
            log.exception("Move to trash of %s failed", os_path)
            job["errors"].append({"path": path, "message": _reason(error)})
        job["removed"] = index + 1


async def _run_removal(
    job: dict, contents_manager, paths: list[str], os_paths: list[str], trash: bool, log
) -> None:
    try:
        if trash:
            await _trash(job, contents_manager, paths, os_paths, log)
        else:
            await asyncio.get_running_loop().run_in_executor(
                None, _remove, job, os.path.abspath(contents_manager.root_dir), os_paths, log
            )
            # As ContentsManager.delete does for the path it removes.
            for path, os_path in zip(paths, os_paths):
                if not os.path.lexists(os_path):
                    await ensure_async(contents_manager.checkpoints.delete_all_checkpoints(path))
    except Exception:
        log.exception("Delete of %s failed", paths)
    finally:
        job["done"] = True


def _mounts() -> list[str]:
    """The mount points of `_MOUNTINFO`, in file order, with their octal escapes decoded."""
    with open(_MOUNTINFO, "rb") as f:
        text = os.fsdecode(f.read())
    return [
        re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), line.split()[4])
        for line in text.splitlines()
    ]


def _mount_point(path: str, mounts: list[str]) -> str:
    """The longest mount point that is a path prefix of `path`."""
    return max(
        (m for m in mounts if path == m or path.startswith(m.rstrip("/") + "/")),
        key=len,
        default="/",
    )


def _trash_monitored(os_paths: list[str], root: str, locations: list[str]) -> list[bool]:
    """Whether the trash management extension monitors the trash of each path: the mount of
    the real path of its folder, joined with its name, is the home trash's mount, or is the
    server root or a folder of `locations` (each ~-expanded, a relative one taken from the
    root). A link is judged where it lies; a path below a link, by the link's target. Without
    a mount table to read (another platform) the trash stays offered, as stock."""
    try:
        mounts = _mounts()
    except OSError:
        return [True] * len(os_paths)
    # The home trash folder, or its nearest existing parent.
    home_trash = os.path.realpath(plat_other.HOMETRASH)
    while not os.path.exists(home_trash):
        home_trash = os.path.dirname(home_trash)
    root = os.path.realpath(root)
    monitored = {_mount_point(home_trash, mounts), root}
    monitored.update(
        os.path.realpath(os.path.join(root, os.path.expanduser(location))) for location in locations
    )
    return [
        _mount_point(
            os.path.join(os.path.realpath(os.path.dirname(path)), os.path.basename(path)), mounts
        )
        in monitored
        for path in os_paths
    ]


class DeleteTrashCheckHandler(APIHandler):
    """For each path of a selection, in order, whether the trash management extension monitors
    its trash, by its server option ``TrashManagement.locations``: Move to Trash is offered for
    a selection with a monitored item and moves only those, and with
    ``AdvancedFileBrowser.trash_on_all_volumes`` every item is monitored."""

    def initialize(self, trash_on_all_volumes: bool) -> None:
        self.trash_on_all_volumes = trash_on_all_volumes

    @tornado.web.authenticated
    async def post(self):
        os_paths = [self.contents_manager._get_os_path(path) for path in _request_paths(self)]
        # That extension's option, from the server's own config.
        locations = self.serverapp.config.get("TrashManagement", {}).get("locations", [])
        # With trash_on_all_volumes every path answers monitored; the mount table is not read.
        monitored = (
            [True] * len(os_paths)
            if self.trash_on_all_volumes
            else await asyncio.get_running_loop().run_in_executor(
                None, _trash_monitored, os_paths, self.contents_manager.root_dir, locations
            )
        )
        self.finish(json.dumps({"monitored": monitored}))


class DeleteSizeHandler(APIHandler):
    """Whether a selection is larger than LARGE_REMOVAL_BYTES."""

    @tornado.web.authenticated
    async def post(self):
        os_paths = [self.contents_manager._get_os_path(path) for path in _request_paths(self)]
        size = await asyncio.get_running_loop().run_in_executor(None, _removal_size, os_paths)
        self.finish(json.dumps({"over": size > LARGE_REMOVAL_BYTES}))


class DeleteHandler(APIHandler):
    """Start a removal: to the trash when the body says ``"trash": true``, through the contents
    manager's delete, else permanent, whatever delete_to_trash and always_delete_dir say."""

    @tornado.web.authenticated
    async def post(self):
        contents_manager = self.contents_manager
        paths = _request_paths(self)
        trash = self.get_json_body().get("trash") is True
        # With the trash off the contents manager's delete removes permanently.
        if trash and not contents_manager.delete_to_trash:
            raise tornado.web.HTTPError(400, "The server's trash is off")
        os_paths = []
        root = os.path.abspath(contents_manager.root_dir)
        for path in paths:
            # _get_os_path normalises, so '', '.' and 'a/..' all name the root.
            os_path = contents_manager._get_os_path(path)
            if os_path == root:
                raise tornado.web.HTTPError(400, "Can't delete root")
            if not contents_manager.allow_hidden and is_hidden(os_path, contents_manager.root_dir):
                raise tornado.web.HTTPError(400, "Cannot delete file or directory %r" % path)
            os_paths.append(os_path)
        job_id = uuid.uuid4().hex
        job = _jobs[job_id] = {"total": 0, "removed": 0, "done": False, "errors": []}
        task = asyncio.ensure_future(
            _run_removal(job, contents_manager, paths, os_paths, trash, self.log)
        )
        # The event loop keeps only a weak reference to a task.
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
        self.set_status(202)
        self.finish(json.dumps({"id": job_id}))


class DeleteJobHandler(APIHandler):
    """Progress of a removal: total, removed and done; the errors once done."""

    @tornado.web.authenticated
    def get(self, job_id: str):
        job = _jobs.get(job_id)
        if job is None:
            raise tornado.web.HTTPError(404, "Unknown delete job")
        if job["done"]:
            del _jobs[job_id]
            self.finish(json.dumps(job))
        else:
            # The errors go once, in the report that says done, not on every poll.
            self.finish(json.dumps({key: value for key, value in job.items() if key != "errors"}))


def setup_route_handlers(web_app, options: AdvancedFileBrowser):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    hello_route_pattern = url_path_join(base_url, "jupyterlab-advanced-file-browser-extension", "hello")
    terminal_cwd_route = url_path_join(
        base_url,
        "jupyterlab-advanced-file-browser-extension",
        "terminal-cwd",
        "([^/]+)"  # terminal_name parameter
    )
    delete_route = url_path_join(base_url, "jupyterlab-advanced-file-browser-extension", "delete")
    handlers = [
        (hello_route_pattern, HelloRouteHandler),
        (terminal_cwd_route, TerminalCwdHandler),
        (url_path_join(delete_route, "size"), DeleteSizeHandler),
        (
            url_path_join(delete_route, "trash-check"),
            DeleteTrashCheckHandler,
            {"trash_on_all_volumes": options.trash_on_all_volumes},
        ),
        (delete_route, DeleteHandler),
        (url_path_join(delete_route, "([0-9a-f]{32})"), DeleteJobHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
