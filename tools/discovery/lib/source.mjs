// A small, dependency-free reader for TypeScript/JavaScript source: blanks comments, reads string
// literals, and finds decorated classes and methods. It is not a full parser; it understands enough
// of NestJS controllers and i18n dictionaries for the checks, and keeps character offsets intact so
// line numbers stay right.

// Unicode-aware: dictionary keys such as `حذف: 'Supprimer'` are plain identifiers
const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}\p{Mn}\p{Mc}_$‌‍]/u;
// after one of these, a `/` starts a regular expression rather than a division
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/** Index just past the string literal that starts at `i` (quote at src[i]). Template `${}` is skipped as code. */
export function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    if (q !== '`' && c === '\n') return j; // unterminated single-line string: stop at the line end
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      j = skipBalanced(src, j + 1, '{', '}');
      continue;
    }
    j++;
  }
  return j;
}

/** Index just past the bracket that closes the one at `i`, skipping strings. */
export function skipBalanced(src, i, open, close) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(src, j);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return j;
}

function skipRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== '\n') {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return j;
}

/**
 * The source with every comment replaced by spaces (newlines kept), regexes untouched, and string
 * literals untouched, or with their contents blanked too when `blankStrings` is set.
 */
export function stripComments(src, { blankStrings = false } = {}) {
  const out = src.split('');
  let i = 0;
  let prev = ''; // last significant code character (or keyword) seen
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      if (blankStrings) for (let k = i + 1; k < end - 1; k++) if (src[k] !== '\n') out[k] = ' ';
      i = end;
      prev = 'str';
      continue;
    }
    if (c === '/' && (REGEX_PREV.has(prev) || REGEX_KEYWORDS.has(prev))) {
      i = skipRegex(src, i);
      prev = 'regex';
      continue;
    }
    if (ID_START.test(c)) {
      let j = i;
      while (j < src.length && ID_PART.test(src[j])) j++;
      prev = src.slice(i, j);
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** The value of a string literal's source text (quotes removed, simple escapes resolved). */
export function unquote(lit) {
  return lit.slice(1, -1).replace(/\\(.)/g, (_, ch) => ({ n: '\n', t: '\t' })[ch] ?? ch);
}

/** First string literal inside `text`, or null. */
export function firstString(text) {
  const m = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(text);
  return m ? unquote(m[0]) : null;
}

/** Tokens of (comment-free) code: { type: 'str'|'id'|'num'|'punct', value, index }. */
export function tokenize(code) {
  const tokens = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(code, i);
      const raw = code.slice(i, end);
      tokens.push({ type: 'str', value: unquote(raw), raw, index: i });
      i = end;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i;
      while (j < code.length && ID_PART.test(code[j])) j++;
      tokens.push({ type: 'id', value: code.slice(i, j), index: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < code.length && /[0-9._a-fA-Fxn]/.test(code[j])) j++;
      tokens.push({ type: 'num', value: code.slice(i, j), index: i });
      i = j;
      continue;
    }
    tokens.push({ type: 'punct', value: c, index: i });
    i++;
  }
  return tokens;
}

const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'async', 'readonly', 'abstract', 'override', 'declare', 'get', 'set']);

/** Index of the next non-space character at or after `i`. */
function nextSig(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/**
 * Decorated classes and their methods in comment-free code:
 * [{ name, index, decorators: [{ name, args, index }], methods: [{ name, index, decorators }] }]
 */
export function parseClasses(code) {
  const classes = [];
  let pending = [];
  let depth = 0;
  let current = null; // { cls, bodyDepth }
  let i = 0;
  let prevSig = '';
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(code, i);
      prevSig = 'str';
      continue;
    }
    if (c === '/' && (REGEX_PREV.has(prevSig) || REGEX_KEYWORDS.has(prevSig))) {
      i = skipRegex(code, i);
      prevSig = 'regex';
      continue;
    }
    if (c === '@' && ID_START.test(code[i + 1] ?? '')) {
      let j = i + 1;
      while (j < code.length && (ID_PART.test(code[j]) || code[j] === '.')) j++;
      const name = code.slice(i + 1, j).split('.').pop();
      let args = null;
      const k = nextSig(code, j);
      if (code[k] === '(') {
        const end = skipBalanced(code, k, '(', ')');
        args = code.slice(k + 1, end - 1);
        j = end;
      }
      pending.push({ name, args, index: i });
      i = j;
      prevSig = ')';
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      prevSig = '{';
      continue;
    }
    if (c === '}') {
      depth--;
      if (current && depth < current.bodyDepth) current = null;
      i++;
      prevSig = '}';
      continue;
    }
    if (c === ';') {
      if (current && depth === current.bodyDepth) pending = [];
      i++;
      prevSig = ';';
      continue;
    }
    if (ID_START.test(c) && !ID_PART.test(code[i - 1] ?? '')) {
      let j = i;
      while (j < code.length && ID_PART.test(code[j])) j++;
      const word = code.slice(i, j);
      if (word === 'class' && !current) {
        const k = nextSig(code, j);
        let e = k;
        while (e < code.length && ID_PART.test(code[e])) e++;
        const cls = { name: code.slice(k, e) || '(anonymous)', index: i, decorators: pending, methods: [] };
        pending = [];
        classes.push(cls);
        const open = code.indexOf('{', e);
        if (open === -1) break;
        depth++;
        current = { cls, bodyDepth: depth };
        i = open + 1;
        prevSig = '{';
        continue;
      }
      // `get list()` is a modifier; `get(` is a method named get
      const isModifier = MODIFIERS.has(word) && ID_START.test(code[nextSig(code, j)] ?? '');
      if (current && depth === current.bodyDepth && !isModifier) {
        let k = nextSig(code, j);
        if (code[k] === '?' || code[k] === '!') k = nextSig(code, k + 1);
        if (code[k] === '<') k = nextSig(code, skipBalanced(code, k, '<', '>'));
        if (code[k] === '(') {
          current.cls.methods.push({ name: word, index: i, decorators: pending });
          pending = [];
          i = skipMethod(code, k);
          prevSig = '}';
          continue;
        }
      }
      prevSig = word;
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return classes;
}

/** From a method's `(`, the index just past its body (or its `;` for a signature without body). */
function skipMethod(code, open) {
  let i = skipBalanced(code, open, '(', ')');
  let angle = 0;
  let prev = ')';
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(code, i);
      prev = 'str';
      continue;
    }
    if (c === '=' && code[i + 1] === '>') {
      i += 2;
      prev = '>';
      continue;
    }
    if (c === '<') angle++;
    else if (c === '>') angle = Math.max(0, angle - 1);
    else if (c === '(') {
      i = skipBalanced(code, i, '(', ')');
      prev = ')';
      continue;
    } else if (c === '{') {
      const end = skipBalanced(code, i, '{', '}');
      if (angle === 0 && !(prev === ':' || prev === '|' || prev === '&' || prev === ',')) return end;
      i = end;
      prev = '}';
      continue;
    } else if (c === ';' && angle === 0) return i + 1;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return i;
}
