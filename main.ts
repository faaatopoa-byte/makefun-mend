// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

// ---------- shared line machinery (SPEC.md sections 3 and 5) ----------

/** Successful move edits, in order, for the `R` lines of section 2. */
const MOVES: Array<readonly [string, string]> = [];

interface FileLines {
  lines: string[];
  br: string;
  finalBreak: boolean;
}

function splitFile(text: string): FileLines {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const finalBreak = text.endsWith(br);
  const lines = text.split(br);
  if (finalBreak) lines.pop();
  return { lines, br, finalBreak };
}

function joinFile(fl: FileLines): string {
  if (fl.lines.length === 0) return '';
  return fl.lines.join(fl.br) + (fl.finalBreak ? fl.br : '');
}

const leadWs = (s: string): string => /^[ \t]*/.exec(s)![0];
const rstripWs = (s: string): string => s.replace(/[ \t]+$/, '');

function normLine(s: string, tier: number): string {
  if (tier === 0) return s;
  if (tier === 1) return rstripWs(s);
  return rstripWs(s).replace(/^[ \t]+/, '');
}

interface Match {
  tier: number;
  positions: number[];
}

/** Every start index at or after `from` where O occurs, at the first tier that has one (section 5). */
function matchO(lines: string[], o: string[], strict: boolean, from = 0): Match | null {
  const tiers = strict ? [0] : [0, 1, 2];
  const no = o.map((l) => normLine(l, 2));
  for (const tier of tiers) {
    const want = o.map((l) => normLine(l, tier));
    void no;
    const positions: number[] = [];
    for (let i = from; i + o.length <= lines.length; i += 1) {
      let ok = true;
      for (let j = 0; j < o.length; j += 1) {
        if (normLine(lines[i + j]!, tier) !== want[j]) {
          ok = false;
          break;
        }
      }
      if (ok) positions.push(i);
    }
    if (positions.length > 0) return { tier, positions };
  }
  return null;
}

/** One body line of a hunk or chunk: context, removed or added. `oPos` is its index within O (context only). */
interface BodyItem {
  kind: 'ctx' | 'del' | 'add';
  text: string;
  oPos: number;
  /** A `\` line follows this body line. */
  bs?: boolean;
  /** The patch line was completely empty (a context line, unless a section-end rule drops it). */
  emptyLine?: boolean;
  /** The patch line was blank: empty or only whitespace (section 4's definition). */
  blankLine?: boolean;
}

/** The lines N writes at a match: context lines are the file's own; at tier 2 the rest are re-indented (section 5). */
function writtenLines(fl: FileLines, pos: number, items: BodyItem[], o: string[], tier: number): string[] {
  const f = leadWs(fl.lines[pos] ?? '');
  const p = leadWs(o[0] ?? '');
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === 'del') continue;
    if (it.kind === 'ctx') {
      out.push(fl.lines[pos + it.oPos]!);
    } else if (tier === 2 && it.text.trim() !== '' && it.text.startsWith(p)) {
      out.push(f + it.text.slice(p.length));
    } else {
      out.push(it.text);
    }
  }
  return out;
}

/** Whether a `\` line follows the body's last context or `+` line (the section 6 end-of-file rule). */
function bsAfterLastCtxOrAdd(items: BodyItem[]): boolean {
  for (let k = items.length - 1; k >= 0; k -= 1) {
    const it = items[k]!;
    if (it.kind === 'ctx' || it.kind === 'add') return it.bs === true;
  }
  return false;
}

// ---------- unified diffs (SPEC.md section 6) ----------

interface UHunk {
  a: number;
  items: BodyItem[];
}
interface USection {
  diffOld?: string;
  diffNew?: string;
  oldPath?: string;
  newPath?: string;
  renameFrom?: string;
  renameTo?: string;
  newFile: boolean;
  deletedFile: boolean;
  hunks: UHunk[];
}

function stripPrefix(p: string): string {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}
function headerPath(line: string): string {
  let t = line.slice(4);
  const tab = t.indexOf('\t');
  if (tab >= 0) t = t.slice(0, tab);
  return stripPrefix(t.trim());
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const sections: USection[] = [];
  let cur: USection | null = null;
  let inHeader = false;
  const newSection = (): USection => {
    const s: USection = { newFile: false, deletedFile: false, hunks: [] };
    sections.push(s);
    cur = s;
    inHeader = true;
    return s;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const no = i + 1;
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${no}`);
      const s = newSection();
      s.diffOld = m[1]!;
      s.diffNew = m[2]!;
      i += 1;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (cur !== null && inHeader && cur.oldPath === undefined) {
        cur.oldPath = headerPath(line);
        cur.newPath = headerPath(lines[i + 1]!);
      } else {
        const s = newSection();
        s.oldPath = headerPath(line);
        s.newPath = headerPath(lines[i + 1]!);
      }
      i += 2;
      continue;
    }
    if (line.startsWith('--- ') && cur !== null && inHeader) {
      throw new Exit2(`error: parse ${no + 1}`);
    }
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${no}`);
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m === null) throw new Exit2(`error: parse ${no}`);
      inHeader = false;
      const raw: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.startsWith('diff --git ')) break;
        if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
        if (l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+' || l[0] === '\\') {
          raw.push(l);
          j += 1;
        } else break;
      }
      while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
      const items: BodyItem[] = [];
      let oPos = 0;
      for (const l of raw) {
        if (l[0] === '\\') {
          const prev = items[items.length - 1];
          if (prev !== undefined) prev.bs = true;
        } else if (l === '' || l[0] === ' ') {
          items.push({ kind: 'ctx', text: l.slice(1), oPos, emptyLine: l === '' });
          oPos += 1;
        } else if (l[0] === '-') {
          items.push({ kind: 'del', text: l.slice(1), oPos });
          oPos += 1;
        } else {
          items.push({ kind: 'add', text: l.slice(1), oPos: -1 });
        }
      }
      cur.hunks.push({ a: parseInt(m[1]!, 10), items });
      i = j;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('+++ ')) {
        if (cur.newPath === undefined) cur.newPath = headerPath(line);
      } else if (line.startsWith('rename from ')) cur.renameFrom = line.slice(12).trim();
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice(10).trim();
      else if (line.startsWith('new file mode')) cur.newFile = true;
      else if (line.startsWith('deleted file mode')) cur.deletedFile = true;
    }
    i += 1;
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => unifiedSectionEdit(s, strict));
}

/** Apply one hunk to `fl`; returns the section's new line delta total (section 6). */
function applyHunk(fl: FileLines, items: BodyItem[], a: number, d: number, strict: boolean, path: string): number {
  const o = items.filter((it) => it.kind !== 'add').map((it) => it.text);
  const nLen = items.filter((it) => it.kind !== 'del').length;
  if (o.length === 0) {
    const at = Math.min(a + d, fl.lines.length);
    const atEnd = at === fl.lines.length;
    const written = items.filter((it) => it.kind === 'add').map((it) => it.text);
    fl.lines.splice(at, 0, ...written);
    if (atEnd) fl.finalBreak = !bsAfterLastCtxOrAdd(items);
    return d + written.length;
  }
  const m = matchO(fl.lines, o, strict);
  if (m === null) throw new Fail('no-match', path);
  const target = a - 1 + d;
  let pos = m.positions[0]!;
  for (const p of m.positions) {
    if (Math.abs(p - target) < Math.abs(pos - target)) pos = p;
  }
  const written = writtenLines(fl, pos, items, o, m.tier);
  const ranToEnd = pos + o.length === fl.lines.length;
  fl.lines.splice(pos, o.length, ...written);
  if (ranToEnd) fl.finalBreak = !bsAfterLastCtxOrAdd(items);
  return d + (nLen - o.length);
}

function unifiedSectionEdit(sec: USection, strict: boolean): Edit {
  return (tree) => {
    const oldP = sec.oldPath ?? sec.renameFrom ?? sec.diffOld;
    const newP = sec.newPath ?? sec.renameTo ?? sec.diffNew;
    const isCreate = sec.newFile || oldP === '/dev/null';
    const isDelete = sec.deletedFile || newP === '/dev/null';
    if (isCreate) {
      const p = newP!;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const outLines: string[] = [];
      let lastAdd: BodyItem | undefined;
      for (const h of sec.hunks) {
        for (const it of h.items) {
          if (it.kind === 'add') {
            outLines.push(it.text);
            lastAdd = it;
          }
        }
      }
      const noBreak = lastAdd !== undefined && lastAdd.bs === true;
      tree.now.set(p, outLines.length === 0 ? '' : outLines.join('\n') + (noBreak ? '' : '\n'));
      return;
    }
    if (isDelete) {
      const p = oldP!;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const o = oldP!;
    const n = newP!;
    if (!safe(o)) throw new Fail('unsafe', o);
    if (!safe(n)) throw new Fail('unsafe', n);
    const before = tree.get(o);
    if (before === null) throw new Fail('missing', o);
    if (n !== o && tree.get(n) !== null) throw new Fail('exists', n);
    const fl = splitFile(before);
    let d = 0;
    for (const h of sec.hunks) d = applyHunk(fl, h.items, h.a, d, strict, o);
    const out = joinFile(fl);
    if (n !== o) {
      tree.now.set(o, null);
      tree.now.set(n, out);
      MOVES.push([o, n]);
    } else {
      tree.now.set(o, out);
    }
  };
}

// ---------- SEARCH/REPLACE blocks (SPEC.md section 7) ----------

function srBlockEdit(p: string, oldLines: string[], newLines: string[], strict: boolean): Edit {
  return (tree) => {
    if (!safe(p)) throw new Fail('unsafe', p);
    if (oldLines.length === 0) {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, newLines.length === 0 ? '' : `${newLines.join('\n')}\n`);
      return;
    }
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    const fl = splitFile(before);
    const m = matchO(fl.lines, oldLines, strict);
    if (m === null) throw new Fail('no-match', p);
    if (m.positions.length > 1) throw new Fail('ambiguous', p);
    const pos = m.positions[0]!;
    const items: BodyItem[] = newLines.map((t) => ({ kind: 'add' as const, text: t, oPos: -1 }));
    const written = writtenLines(fl, pos, items, oldLines, m.tier);
    fl.lines.splice(pos, oldLines.length, ...written);
    tree.now.set(p, joinFile(fl));
  };
}

function srEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevPath: string | null = null;
  let searchFrom = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    const searchLine = i + 1;
    let mid = -1;
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const t = lines[j]!.trimEnd();
      if (t === '<<<<<<< SEARCH') break;
      if (mid < 0 && t === '=======') mid = j;
      else if (mid >= 0 && t === '>>>>>>> REPLACE') {
        end = j;
        break;
      }
    }
    if (mid < 0 || end < 0) throw new Exit2(`error: parse ${searchLine}`);
    let p: string | null = null;
    for (let j = i - 1; j >= searchFrom; j -= 1) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      p = t;
      break;
    }
    if (p === null) p = prevPath;
    if (p === null) throw new Exit2(`error: parse ${searchLine}`);
    edits.push(srBlockEdit(p, lines.slice(i + 1, mid), lines.slice(mid + 1, end), strict));
    prevPath = p;
    searchFrom = end + 1;
    i = end + 1;
  }
  if (edits.length === 0) throw new Exit2('error: parse 1');
  return edits;
}

// ---------- V4A patches (SPEC.md section 8) ----------

interface VChunk {
  anchor: string | null;
  eof: boolean;
  items: BodyItem[];
}
interface VSection {
  kind: 'add' | 'del' | 'update';
  path: string;
  moveTo?: string;
  lines: string[];
  chunks: VChunk[];
  lineNo: number;
}

/** Apply one V4A chunk at the cursor; returns the new cursor (section 8). */
function applyChunk(fl: FileLines, ch: VChunk, cursor: number, strict: boolean, path: string): number {
  if (ch.anchor !== null) {
    const am = matchO(fl.lines, [ch.anchor], strict, cursor);
    if (am === null) throw new Fail('no-match', path);
    cursor = am.positions[0]! + 1;
  }
  const o = ch.items.filter((it) => it.kind !== 'add').map((it) => it.text);
  if (o.length === 0) {
    const at = ch.eof ? fl.lines.length : Math.min(cursor, fl.lines.length);
    const written = ch.items.filter((it) => it.kind === 'add').map((it) => it.text);
    fl.lines.splice(at, 0, ...written);
    return at + written.length;
  }
  const m = matchO(fl.lines, o, strict, cursor);
  if (m === null) throw new Fail('no-match', path);
  let pos: number;
  if (ch.eof) {
    const want = fl.lines.length - o.length;
    if (!m.positions.includes(want)) throw new Fail('no-match', path);
    pos = want;
  } else {
    pos = m.positions[0]!;
  }
  const written = writtenLines(fl, pos, ch.items, o, m.tier);
  fl.lines.splice(pos, o.length, ...written);
  return pos + written.length;
}

function v4aSectionEdit(sec: VSection, strict: boolean): Edit {
  return (tree) => {
    const p = sec.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (sec.kind === 'add') {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, sec.lines.length === 0 ? '' : `${sec.lines.join('\n')}\n`);
      return;
    }
    if (sec.kind === 'del') {
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const target = sec.moveTo;
    if (target !== undefined && !safe(target)) throw new Fail('unsafe', target);
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    if (target !== undefined && tree.get(target) !== null) throw new Fail('exists', target);
    const fl = splitFile(before);
    let cursor = 0;
    for (const ch of sec.chunks) cursor = applyChunk(fl, ch, cursor, strict, p);
    const out = joinFile(fl);
    if (target !== undefined) {
      tree.now.set(p, null);
      tree.now.set(target, out);
      MOVES.push([p, target]);
    } else {
      tree.now.set(p, out);
    }
  };
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const firstIdx = lines.findIndex((l) => !blank(l));
  if (firstIdx < 0) throw new Exit2('error: parse 1');
  if (lines[firstIdx]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${firstIdx + 1}`);
  let lastIdx = -1;
  for (let k = lines.length - 1; k >= 0; k -= 1) {
    if (!blank(lines[k]!)) {
      lastIdx = k;
      break;
    }
  }
  if (lines[lastIdx]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: VSection[] = [];
  let cur: VSection | null = null;
  let chunk: VChunk | null = null;
  const endChunk = (): void => {
    if (cur !== null && chunk !== null) {
      cur.chunks.push(chunk);
      chunk = null;
    }
  };
  for (let i = firstIdx + 1; i < lastIdx; i += 1) {
    const line = lines[i]!;
    const no = i + 1;
    const secStart = /^\*\*\* (Add File|Delete File|Update File): (.*)$/.exec(line);
    if (secStart !== null) {
      endChunk();
      const kind = secStart[1] === 'Add File' ? 'add' : secStart[1] === 'Delete File' ? 'del' : 'update';
      cur = { kind, path: secStart[2]!.trim(), lines: [], chunks: [], lineNo: no };
      sections.push(cur);
      continue;
    }
    if (cur === null) {
      if (blank(line)) continue;
      throw new Exit2(`error: parse ${no}`);
    }
    if (cur.kind === 'add') {
      if (line.startsWith('+')) cur.lines.push(line.slice(1));
      else if (line === '') cur.lines.push('');
      else throw new Exit2(`error: parse ${no}`);
      continue;
    }
    if (cur.kind === 'del') {
      if (blank(line)) continue;
      throw new Exit2(`error: parse ${no}`);
    }
    // update section
    if (line.startsWith('*** Move to: ') && chunk === null && cur.chunks.length === 0 && cur.moveTo === undefined) {
      cur.moveTo = line.slice('*** Move to: '.length).trim();
      continue;
    }
    if (line.startsWith('@@')) {
      endChunk();
      const anchorText = line.slice(2).trim();
      chunk = { anchor: anchorText === '' ? null : anchorText, eof: false, items: [] };
      continue;
    }
    if (line.trim() === '*** End of File') {
      if (chunk === null) chunk = { anchor: null, eof: false, items: [] };
      chunk.eof = true;
      endChunk();
      continue;
    }
    if (line === '' || line[0] === ' ' || line[0] === '-' || line[0] === '+') {
      if (chunk === null) chunk = { anchor: null, eof: false, items: [] };
      let oPos = 0;
      for (const it of chunk.items) if (it.kind !== 'add') oPos += 1;
      if (line === '' || line[0] === ' ') chunk.items.push({ kind: 'ctx', text: line.slice(1), oPos, emptyLine: line === '', blankLine: line.trim() === '' });
      else if (line[0] === '-') chunk.items.push({ kind: 'del', text: line.slice(1), oPos });
      else chunk.items.push({ kind: 'add', text: line.slice(1), oPos: -1 });
      continue;
    }
    throw new Exit2(`error: parse ${no}`);
  }
  endChunk();
  for (const s of sections) {
    if (s.kind === 'add') {
      while (s.lines.length > 0 && s.lines[s.lines.length - 1] === '') s.lines.pop();
    }
    if (s.kind === 'update') {
      const last = s.chunks[s.chunks.length - 1];
      if (last !== undefined) {
        while (last.items.length > 0) {
          const tail = last.items[last.items.length - 1]!;
          if (tail.kind === 'ctx' && tail.blankLine === true) last.items.pop();
          else break;
        }
      }
      if (s.chunks.length === 0 && s.moveTo === undefined) throw new Exit2(`error: parse ${s.lineNo}`);
    }
  }
  if (sections.length === 0) throw new Exit2('error: parse 1');
  return sections.map((s) => v4aSectionEdit(s, strict));
}

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? srEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const entries: { key: string; line: string }[] = [];
  const rPaths = new Set<string>();
  for (const [o, n] of MOVES) {
    if (tree.original(o) !== null && tree.now.get(o) === null && tree.original(n) === null && tree.now.get(n) !== null && tree.now.get(n) !== undefined) {
      entries.push({ key: n, line: `R ${o} -> ${n}` });
      rPaths.add(o);
      rPaths.add(n);
    }
  }
  for (const p of tree.now.keys()) {
    if (rPaths.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    entries.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  entries.sort((x, y) => Buffer.compare(Buffer.from(x.key), Buffer.from(y.key)));
  const rows = entries.map((e) => e.line);
  if (!check) {
    for (const p of tree.now.keys()) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
