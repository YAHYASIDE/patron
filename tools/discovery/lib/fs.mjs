// Read-only file helpers. Nothing in the discovery engine writes inside the scanned repo.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', '.dart_tool', 'out', '.gradle',
]);

/** Every file under `dir` (recursively) whose path passes `filter`; skips build and dependency folders. */
export function walk(dir, filter = () => true) {
  const files = [];
  if (!existsSync(dir)) return files;
  const visit = (d) => {
    let names;
    try {
      names = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(p);
      else if (st.isFile() && filter(p)) files.push(p);
    }
  };
  visit(dir);
  return files;
}

/** Directories directly under `dir`, sorted. */
export function subdirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !SKIP_DIRS.has(n))
    .filter((n) => {
      try {
        return statSync(join(dir, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export const read = (p) => readFileSync(p, 'utf8');

/** Repo-relative path with forward slashes, so fingerprints are the same on every OS. */
export const rel = (root, p) => relative(root, p).split(sep).join('/');

/** 1-based line number of a character offset. */
export function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** A line finder for repeated lookups in the same text. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
