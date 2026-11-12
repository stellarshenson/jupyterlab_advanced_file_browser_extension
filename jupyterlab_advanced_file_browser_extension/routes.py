"""
API handlers for drag-and-drop path resolution.

``terminal-cwd/<name>`` returns the current working directory of a terminal,
used to turn an absolute path into a path relative to that terminal.
"""
import json
import os
import subprocess
import sys

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

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


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    hello_route_pattern = url_path_join(base_url, "jupyterlab-advanced-file-browser-extension", "hello")
    terminal_cwd_route = url_path_join(
        base_url,
        "jupyterlab-advanced-file-browser-extension",
        "terminal-cwd",
        "([^/]+)"  # terminal_name parameter
    )
    handlers = [
        (hello_route_pattern, HelloRouteHandler),
        (terminal_cwd_route, TerminalCwdHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
