/**
 * Pure path resolution and formatting utilities.
 *
 * This module has no JupyterLab or DOM dependencies so it can be unit
 * tested in isolation.
 */

/**
 * MIME type set by the file browser on a drag, carrying an array of the
 * dragged items' contents paths (relative to the server root).
 */
export const CONTENTS_MIME = 'application/x-jupyter-icontents';

/**
 * MIME type this extension sets on a drag it starts itself, from a file
 * browser breadcrumb. The payload is the same as `CONTENTS_MIME` carries - an
 * array of contents paths - under a private name so that JupyterLab's own
 * drop targets decline it: the file listing and the other crumbs read
 * `CONTENTS_MIME` as "move these items here", and a breadcrumb drag asks for
 * a path to be inserted, not for a directory to be moved.
 */
export const PATH_MIME = 'application/x-jupyterlab-drag-and-drop-path';

/** Whether dropped paths are absolute or relative. */
export type PathType = 'absolute' | 'relative';

/** How a path is rendered into Python code. */
export type PythonPathStyle = 'posix' | 'pathlib';

/** What separates several paths sent to a terminal in one drop. */
export type TerminalSeparator = 'space' | 'newline';

/** Extension settings. */
export interface ISettings {
  dragDropPathEnabled: boolean;
  pathType: PathType;
  pythonPathStyle: PythonPathStyle;
  pathlibConstructor: string;
  terminalSeparator: TerminalSeparator;
  terminalQuotePaths: boolean;
}

/** Default settings, mirroring `schema/plugin.json`. */
export const DEFAULT_SETTINGS: ISettings = {
  dragDropPathEnabled: true,
  pathType: 'relative',
  pythonPathStyle: 'posix',
  pathlibConstructor: 'pathlib.Path',
  terminalSeparator: 'space',
  terminalQuotePaths: false
};

/**
 * Normalize a POSIX path, resolving `.` and `..` segments. A leading
 * slash is preserved; `..` cannot escape an absolute root.
 */
export function normalize(path: string): string {
  const isAbsolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!isAbsolute) {
        out.push('..');
      }
    } else {
      out.push(segment);
    }
  }
  return (isAbsolute ? '/' : '') + out.join('/');
}

/** Return the directory portion of a POSIX path. */
export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index < 0) {
    return '';
  }
  return index === 0 ? '/' : trimmed.slice(0, index);
}

/** Join a base directory and a path, then normalize the result. */
export function join(base: string, path: string): string {
  if (!base) {
    return normalize(path);
  }
  return normalize(base.replace(/\/+$/, '') + '/' + path);
}

/**
 * Compute the POSIX path of `to` relative to directory `from`. Both
 * arguments must be either both absolute or both relative to the same
 * root.
 */
export function relative(from: string, to: string): string {
  const fromParts = normalize(from)
    .split('/')
    .filter(segment => segment.length > 0);
  const toParts = normalize(to)
    .split('/')
    .filter(segment => segment.length > 0);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }

  const up = new Array(fromParts.length - common).fill('..');
  const down = toParts.slice(common);
  const parts = up.concat(down);
  return parts.length > 0 ? parts.join('/') : '.';
}

/** Context for resolving a dragged file's path. */
export interface IResolveContext {
  /** Absolute server root directory. */
  rootDir: string;
  /**
   * Base directory for relative paths - the terminal cwd, or the open
   * document's directory.
   */
  baseDir: string;
  /** Whether `baseDir` is an absolute filesystem path. */
  baseIsAbsolute: boolean;
}

/**
 * Resolve a dragged file's contents path (relative to the server root)
 * into the path string to insert.
 */
export function resolvePath(
  contentsPath: string,
  pathType: PathType,
  context: IResolveContext
): string {
  if (pathType === 'absolute') {
    return join(context.rootDir, contentsPath);
  }
  if (context.baseIsAbsolute) {
    return relative(context.baseDir, join(context.rootDir, contentsPath));
  }
  return relative(context.baseDir, contentsPath);
}

/**
 * Escape a path for use as a bare (unquoted) shell argument. Every
 * character outside a safe set is backslash-escaped.
 */
export function shellEscape(path: string): string {
  // The `u` flag is load-bearing: without it the regex matches UTF-16 code
  // units, so a character outside the basic plane - an emoji in a filename -
  // is split and a backslash is inserted between the halves of its surrogate
  // pair. The pty then receives lone surrogates, which fail to encode.
  return path.replace(/[^A-Za-z0-9_./@%+:,=-]/gu, '\\$&');
}

/**
 * Wrap a path in a single-quoted shell word.
 *
 * Inside single quotes the shell treats every character literally, so the
 * only one needing work is the quote itself: the word is closed, an escaped
 * quote is emitted, and the word is reopened - the standard POSIX idiom
 * `'\''`, which every Bourne-family shell reads as one literal quote.
 */
export function shellQuote(path: string): string {
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

/**
 * Render dragged paths as the one string sent to a terminal.
 *
 * `space` keeps every path on one line, as arguments to whatever command is
 * already typed. `newline` gives each path a line of its own by ending the
 * line with a space, a backslash and a carriage return: the carriage return
 * is what the Enter key sends, and the backslash in front of it is a shell
 * line continuation, so the shell keeps reading instead of running what is
 * typed. Nothing is submitted, and the paths still arrive as arguments of
 * one command when the user presses Enter. The space before the backslash is
 * load-bearing - the shell removes the backslash and the newline together,
 * and without it the last character of one path would join the first of the
 * next.
 */
export function formatForTerminal(
  paths: string[],
  quote: boolean,
  separator: TerminalSeparator
): string {
  return paths
    .map(path => (quote ? shellQuote(path) : shellEscape(path)))
    .join(separator === 'newline' ? ' \\\r' : ' ');
}

/** Wrap a path in a single-quoted Python string literal. */
export function pythonString(path: string): string {
  return (
    "'" +
    path
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      // A raw newline inside a single-quoted literal is a syntax error, so a
      // filename containing one would insert code the cell cannot parse.
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t') +
    "'"
  );
}

/**
 * Format a path for insertion into Python code.
 *
 * - `posix` style returns a single-quoted string literal.
 * - `pathlib` style returns a constructor call joined to the remaining
 *   path segments via the `/` operator, e.g. `Path('/a') / 'b' / 'c'`.
 *   Absolute paths keep the leading slash on the first segment so the
 *   resulting expression evaluates to the same absolute Path.
 */
export function formatForPython(
  path: string,
  style: PythonPathStyle,
  constructor: string
): string {
  if (style !== 'pathlib') {
    return pythonString(path);
  }
  const isAbsolute = path.startsWith('/');
  const segments = path.split('/').filter(segment => segment.length > 0);
  if (segments.length === 0) {
    return `${constructor}(${pythonString(isAbsolute ? '/' : '.')})`;
  }
  const first = isAbsolute ? '/' + segments[0] : segments[0];
  const head = `${constructor}(${pythonString(first)})`;
  if (segments.length === 1) {
    return head;
  }
  const tail = segments
    .slice(1)
    .map(segment => pythonString(segment))
    .join(' / ');
  return `${head} / ${tail}`;
}

/** Media types that denote Python source. */
const PYTHON_MIME_TYPES = ['text/x-python', 'text/x-ipython'];

/**
 * Whether a CodeMirror mimetype denotes Python source.
 *
 * This is an exact match on the media type, deliberately not a substring
 * test: JupyterLab gives markdown the mimetype `text/x-ipythongfm`, which
 * contains the substring `python` and would otherwise be read as Python,
 * so every markdown file would receive a quoted string instead of a path.
 * Any parameters after a `;` are ignored.
 */
export function isPythonMimeType(mimeType: string): boolean {
  const media = mimeType.split(';')[0].trim().toLowerCase();
  return PYTHON_MIME_TYPES.includes(media);
}

/** The contents path carried by one dragged item, or null if it carries none. */
function itemPath(item: unknown): string | null {
  if (typeof item === 'string') {
    return item;
  }
  if (
    item &&
    typeof item === 'object' &&
    typeof (item as { path?: unknown }).path === 'string'
  ) {
    return (item as { path: string }).path;
  }
  return null;
}

/**
 * Extract every dragged contents path from drag MIME data. Returns `null`
 * for anything that is not a non-empty array of readable items, so a partly
 * unreadable drag inserts nothing rather than a subset of what was dragged.
 */
export function draggedPaths(data: unknown): string[] | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const paths: string[] = [];
  for (const item of data) {
    const path = itemPath(item);
    if (path === null) {
      return null;
    }
    paths.push(path);
  }
  return paths;
}

/**
 * Extract the single dragged contents path from drag MIME data. Returns
 * `null` unless there is exactly one item, so multi-item drags are ignored
 * by the targets that take only one.
 */
export function singleDraggedPath(data: unknown): string | null {
  const paths = draggedPaths(data);
  return paths !== null && paths.length === 1 ? paths[0] : null;
}

/**
 * The contents path a file browser breadcrumb stands for, read from its
 * `data-path` attribute, or `null` when the element carries none.
 *
 * A crumb for a directory under the server root holds a root-relative path,
 * while the home and preferred crumbs hold one with a leading slash. Removing
 * the slash puts both in the form the contents API uses, in which the server
 * root itself is the empty string.
 */
export function crumbContentsPath(dataPath: string | undefined): string | null {
  if (dataPath === undefined) {
    return null;
  }
  return dataPath.replace(/^\/+/, '');
}
