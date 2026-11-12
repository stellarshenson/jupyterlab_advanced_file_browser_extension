/**
 * Unit tests for the pure path utilities in `src/dragPaths.ts`, and the
 * settings and refusal helpers of `src/dragDrop.ts`.
 */
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { readSettings, resolveOrRefuse } from '../dragDrop';
import {
  crumbContentsPath,
  DEFAULT_SETTINGS,
  dirname,
  draggedPaths,
  formatForPython,
  formatForTerminal,
  join,
  normalize,
  pythonString,
  relative,
  resolvePath,
  shellEscape,
  shellQuote,
  isPythonMimeType,
  singleDraggedPath
} from '../dragPaths';

describe('normalize', () => {
  it('resolves "." and ".." segments', () => {
    expect(normalize('/a/b/../c')).toEqual('/a/c');
    expect(normalize('a/./b')).toEqual('a/b');
  });

  it('does not let ".." escape an absolute root', () => {
    expect(normalize('/a/../../b')).toEqual('/b');
  });

  it('keeps ".." in a relative path', () => {
    expect(normalize('../a')).toEqual('../a');
  });
});

describe('dirname', () => {
  it('returns the directory portion', () => {
    expect(dirname('a/b/c')).toEqual('a/b');
    expect(dirname('/a/file')).toEqual('/a');
  });

  it('handles top-level paths', () => {
    expect(dirname('file')).toEqual('');
    expect(dirname('/file')).toEqual('/');
  });
});

describe('join', () => {
  it('joins and normalizes', () => {
    expect(join('/root', 'a/b')).toEqual('/root/a/b');
    expect(join('d1/d2', 'f')).toEqual('d1/d2/f');
  });

  it('handles an empty base', () => {
    expect(join('', 'a/b')).toEqual('a/b');
  });
});

describe('relative', () => {
  it('computes relative absolute paths', () => {
    expect(relative('/a/b/c', '/a/b/d/e')).toEqual('../d/e');
  });

  it('returns "." for identical paths', () => {
    expect(relative('/a/b', '/a/b')).toEqual('.');
  });

  it('computes relative paths sharing a root', () => {
    expect(relative('d1/d2', 'd1/f.txt')).toEqual('../f.txt');
    expect(relative('', 'f.txt')).toEqual('f.txt');
  });
});

describe('resolvePath', () => {
  const ctx = { rootDir: '/srv/root', baseDir: '', baseIsAbsolute: true };

  it('builds absolute paths from the server root', () => {
    expect(resolvePath('data/f.csv', 'absolute', ctx)).toEqual(
      '/srv/root/data/f.csv'
    );
  });

  it('builds terminal-relative paths from an absolute base', () => {
    expect(
      resolvePath('data/f.csv', 'relative', {
        rootDir: '/srv/root',
        baseDir: '/srv/root/work',
        baseIsAbsolute: true
      })
    ).toEqual('../data/f.csv');
  });

  it('builds document-relative paths from a contents base', () => {
    expect(
      resolvePath('data/f.csv', 'relative', {
        rootDir: '/srv/root',
        baseDir: 'notebooks',
        baseIsAbsolute: false
      })
    ).toEqual('../data/f.csv');
  });
});

describe('shellEscape', () => {
  it('escapes spaces and shell metacharacters', () => {
    expect(shellEscape('/home/my data/f (1).csv')).toEqual(
      '/home/my\\ data/f\\ \\(1\\).csv'
    );
  });

  it('leaves plain paths unchanged', () => {
    expect(shellEscape('/home/user/file.csv')).toEqual('/home/user/file.csv');
  });
});

describe('pythonString', () => {
  it('wraps a path in single quotes', () => {
    expect(pythonString('/a/b')).toEqual("'/a/b'");
  });

  it('escapes quotes and backslashes', () => {
    expect(pythonString("/a'b")).toEqual("'/a\\'b'");
    expect(pythonString('/a\\b')).toEqual("'/a\\\\b'");
  });
});

describe('formatForPython', () => {
  it('produces a quoted string in posix style', () => {
    expect(formatForPython('/a/b', 'posix', 'pathlib.Path')).toEqual("'/a/b'");
  });

  it('joins pathlib path segments with the / operator', () => {
    expect(formatForPython('/a/b/c', 'pathlib', 'pathlib.Path')).toEqual(
      "pathlib.Path('/a') / 'b' / 'c'"
    );
    expect(formatForPython('a/b', 'pathlib', 'Path')).toEqual(
      "Path('a') / 'b'"
    );
  });

  it('emits a single constructor call when there is only one segment', () => {
    expect(formatForPython('/file', 'pathlib', 'Path')).toEqual(
      "Path('/file')"
    );
    expect(formatForPython('file', 'pathlib', 'Path')).toEqual("Path('file')");
  });
});

describe('singleDraggedPath', () => {
  it('returns the path of a single string item', () => {
    expect(singleDraggedPath(['a/b.csv'])).toEqual('a/b.csv');
  });

  it('returns the path of a single object item', () => {
    expect(singleDraggedPath([{ path: 'a/b.csv' }])).toEqual('a/b.csv');
  });

  it('returns null for multi-item or empty drags', () => {
    expect(singleDraggedPath(['a', 'b'])).toBeNull();
    expect(singleDraggedPath([])).toBeNull();
  });

  it('returns null for non-array data', () => {
    expect(singleDraggedPath(undefined)).toBeNull();
    expect(singleDraggedPath('a/b.csv')).toBeNull();
  });
});

describe('isPythonMimeType', () => {
  it('accepts the python media types', () => {
    expect(isPythonMimeType('text/x-python')).toBe(true);
    expect(isPythonMimeType('text/x-ipython')).toBe(true);
  });

  it('rejects markdown, whose mimetype contains "python" as a substring', () => {
    // JupyterLab gives markdown `text/x-ipythongfm`. A substring test on
    // 'python' matches it, which made every markdown file insert a quoted
    // Python string instead of a bare path.
    expect(isPythonMimeType('text/x-ipythongfm')).toBe(false);
  });

  it('rejects other languages', () => {
    expect(isPythonMimeType('text/plain')).toBe(false);
    expect(isPythonMimeType('text/x-rsrc')).toBe(false);
    expect(isPythonMimeType('application/json')).toBe(false);
  });

  it('ignores parameters and case', () => {
    expect(isPythonMimeType('TEXT/X-PYTHON')).toBe(true);
    expect(isPythonMimeType('text/x-python; charset=utf-8')).toBe(true);
  });
});

describe('shellEscape unicode handling', () => {
  it('keeps a non-BMP character intact', () => {
    // Regression for DEF-TERM-12: without the `u` flag the regex matches
    // UTF-16 code units and backslashes between the halves of the surrogate
    // pair, so the pty receives lone surrogates that fail to encode.
    const escaped = shellEscape('data/\u{1F600}.csv');
    expect(escaped).toBe('data/\\\u{1F600}.csv');
    expect(escaped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(escaped).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('round-trips a non-BMP path through the escape', () => {
    const original = 'a/\u{1F4C1}/b.csv';
    expect(shellEscape(original).replace(/\\(.)/gu, '$1')).toBe(original);
  });

  it('still escapes spaces and metacharacters', () => {
    expect(shellEscape('/home/my data/f (1).csv')).toBe(
      '/home/my\\ data/f\\ \\(1\\).csv'
    );
  });
});

describe('pythonString control characters', () => {
  it('escapes a newline so the literal still parses', () => {
    // Regression for DEF-PATHS-14: a raw newline inside a single-quoted
    // literal is a SyntaxError in the cell it is dropped into.
    expect(pythonString('a\nb.txt')).toBe("'a\\nb.txt'");
    expect(pythonString('a\nb.txt')).not.toContain('\n');
  });

  it('escapes carriage return and tab', () => {
    expect(pythonString('a\rb')).toBe("'a\\rb'");
    expect(pythonString('a\tb')).toBe("'a\\tb'");
  });

  it('still escapes quotes and backslashes', () => {
    expect(pythonString("/a'b")).toBe("'/a\\'b'");
    expect(pythonString('/a\\b')).toBe("'/a\\\\b'");
  });
});

describe('shellQuote', () => {
  it('wraps a path in single quotes and leaves its contents alone', () => {
    expect(shellQuote('/home/my data/f (1).csv')).toBe(
      "'/home/my data/f (1).csv'"
    );
  });

  it('closes and reopens the quoting around an embedded quote', () => {
    // The shell reads 'it'\''s.csv' as the single word it's.csv.
    expect(shellQuote("it's.csv")).toBe("'it'\\''s.csv'");
  });
});

describe('formatForTerminal', () => {
  it('escapes each path and joins them with a space', () => {
    expect(formatForTerminal(['a b.csv', 'c.csv'], false, 'space')).toBe(
      'a\\ b.csv c.csv'
    );
  });

  it('continues the line under the newline separator', () => {
    // A carriage return is what the Enter key sends, so each path lands on
    // its own line; the backslash in front of it is a shell line
    // continuation, so the shell reads on instead of running the line.
    expect(formatForTerminal(['a.csv', 'b.csv'], false, 'newline')).toBe(
      'a.csv \\\rb.csv'
    );
  });

  it('leaves no continuation after the last path', () => {
    // A trailing continuation would leave the shell waiting for a line that
    // never comes, so the user's Enter would submit nothing.
    const sent = formatForTerminal(['a.csv', 'b.csv'], false, 'newline');
    expect(sent.endsWith('b.csv')).toBe(true);
    expect(sent.split('\r')).toHaveLength(2);
  });

  it('quotes each path instead of escaping it when asked to', () => {
    expect(formatForTerminal(['a b.csv', 'c.csv'], true, 'space')).toBe(
      "'a b.csv' 'c.csv'"
    );
  });

  it('renders one path with no separator at all', () => {
    expect(formatForTerminal(['a b.csv'], false, 'space')).toBe('a\\ b.csv');
    expect(formatForTerminal(['a b.csv'], true, 'newline')).toBe("'a b.csv'");
  });
});

describe('draggedPaths', () => {
  it('returns every dragged path, in order', () => {
    expect(draggedPaths(['a.csv', { path: 'b.csv' }])).toEqual([
      'a.csv',
      'b.csv'
    ]);
  });

  it('returns null for an empty or non-array payload', () => {
    expect(draggedPaths([])).toBeNull();
    expect(draggedPaths(undefined)).toBeNull();
    expect(draggedPaths('a.csv')).toBeNull();
  });

  it('returns null when one item carries no path, never a subset', () => {
    // Half a drag inserted is worse than none: the user sees a command line
    // that looks complete and is missing a file.
    expect(draggedPaths(['a.csv', { name: 'b.csv' }])).toBeNull();
  });
});

describe('crumbContentsPath', () => {
  it('passes a root-relative crumb path through unchanged', () => {
    expect(crumbContentsPath('a/b/c')).toEqual('a/b/c');
  });

  it('turns the home crumb into the empty path', () => {
    expect(crumbContentsPath('/')).toEqual('');
  });

  it('strips the leading slash the preferred crumb carries', () => {
    expect(crumbContentsPath('/projects/data')).toEqual('projects/data');
  });

  it('returns null for an element with no data-path', () => {
    expect(crumbContentsPath(undefined)).toBeNull();
  });
});

describe('readSettings', () => {
  it('falls back to the defaults when the composite value is missing', () => {
    const loaded = {
      get: () => ({ composite: undefined })
    } as unknown as ISettingRegistry.ISettings;
    expect(readSettings(loaded)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('resolveOrRefuse', () => {
  it('refuses an absolute drop when the server root is empty', () => {
    // An empty root joined with an absolute path yields the bare contents
    // path - a relative path where an absolute one was asked for.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const state = {
      app: {} as never,
      settings: { ...DEFAULT_SETTINGS, pathType: 'absolute' as const },
      rootDir: ''
    };
    expect(resolveOrRefuse(state, 'data/f.csv', '', false)).toBeNull();
    warn.mockRestore();
  });
});
