'use strict';
/* ============================== DIFF ENGINE ==============================
   Compares two documents given as lists of paragraphs. Paragraphs are matched first;
   paragraphs that changed are then compared word by word. Pure functions, tested in
   test/diff.test.js. */
const Diff = (() => {
  const MAX_CELLS = 3e7; // ~60 MB of 16-bit cells; larger inputs are refused instead of freezing the tab

  // Longest-common-subsequence diff. Returns ops: ['=', i, j], ['-', i] or ['+', j].
  function seq(a, b, eq = (x, y) => x === y) {
    let pre = 0;
    while (pre < a.length && pre < b.length && eq(a[pre], b[pre])) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && eq(a[a.length - 1 - suf], b[b.length - 1 - suf]))
      suf++;
    const n = a.length - pre - suf,
      m = b.length - pre - suf;
    if (n * m > MAX_CELLS) throw new Error('these files are too different or too long to compare');
    // L[i][j] = LCS length of a[pre+i..] and b[pre+j..], stored flat
    const L = new (n < 65535 && m < 65535 ? Uint16Array : Uint32Array)((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * (m + 1) + j] = eq(a[pre + i], b[pre + j])
          ? L[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    const ops = [];
    for (let k = 0; k < pre; k++) ops.push(['=', k, k]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && eq(a[pre + i], b[pre + j])) ops.push(['=', pre + i++, pre + j++]);
      else if (j >= m || (i < n && L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]))
        ops.push(['-', pre + i++]);
      else ops.push(['+', pre + j++]);
    }
    for (let k = 0; k < suf; k++) ops.push(['=', a.length - suf + k, b.length - suf + k]);
    return ops;
  }

  // Words and punctuation, keeping the whitespace between them so text can be rebuilt as written.
  const tokens = (s) => s.match(/\s+|[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*|[^\s]/gu) || [];
  const isSpace = (t) => /^\s+$/.test(t);
  const countWords = (s) => tokens(s).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

  // Word-level diff of two paragraphs: parts [{ op: '=' | '-' | '+', t }] plus words added and removed.
  function words(a, b, ignoreCase) {
    const ta = tokens(a),
      tb = tokens(b);
    const key = (t) => (isSpace(t) ? ' ' : ignoreCase ? t.toLowerCase() : t);
    const parts = [];
    let ins = 0,
      del = 0;
    for (const [op, i, j] of seq(ta.map(key), tb.map(key))) {
      const t = op === '+' ? tb[i] : ta[i];
      if (op === '=') parts.push({ op, t: tb[j] });
      else {
        parts.push({ op, t });
        if (!isSpace(t)) op === '+' ? ins++ : del++;
      }
    }
    return { parts, ins, del };
  }

  // Share of words two paragraphs have in common, 0..1 (case-insensitive: it only decides pairing).
  function similarity(a, b) {
    const ta = tokens(a.toLowerCase()).filter((t) => !isSpace(t)),
      tb = tokens(b.toLowerCase()).filter((t) => !isSpace(t));
    if (!ta.length || !tb.length) return 0;
    const same = seq(ta, tb).filter((o) => o[0] === '=').length;
    return (2 * same) / (ta.length + tb.length);
  }

  // Rows for display. kind: same | changed | removed | added | movedOut | movedIn.
  function compare(A, B, { ignoreCase = false } = {}) {
    const clean = (s) => s.replace(/\s+/g, ' ').trim();
    A = A.map(clean).filter(Boolean);
    B = B.map(clean).filter(Boolean);
    const norm = (s) => (ignoreCase ? s.toLowerCase() : s);
    const ops = seq(A.map(norm), B.map(norm));

    // A paragraph removed in one place and added unchanged in another was moved (short lines like
    // "Notes" repeat too often to count).
    const added = new Map();
    for (const [op, j] of ops)
      if (op === '+' && B[j].length > 20) {
        const k = norm(B[j]);
        added.set(k, (added.get(k) || 0) + 1);
      }
    const moved = new Map();
    for (const [op, i] of ops)
      if (op === '-' && added.get(norm(A[i]))) {
        const k = norm(A[i]);
        added.set(k, added.get(k) - 1);
        moved.set(k, (moved.get(k) || 0) + 1);
      }
    const movedIn = new Map(moved);

    const rows = [];
    const stats = { ins: 0, del: 0, changed: 0, added: 0, removed: 0, moved: 0 };
    let run = [];
    const flush = () => {
      const dels = run.filter((o) => o[0] === '-'),
        adds = run.filter((o) => o[0] === '+');
      const used = new Set();
      let after = 0;
      for (const [, i] of dels) {
        const k = norm(A[i]);
        if (moved.get(k)) {
          moved.set(k, moved.get(k) - 1);
          rows.push({ kind: 'movedOut', l: A[i] });
          continue;
        }
        // Pair with the next added paragraph that is mostly the same text, keeping document order.
        let pair = -1;
        for (let x = after; x < adds.length; x++)
          if (!used.has(x) && !movedIn.get(norm(B[adds[x][1]])) && similarity(A[i], B[adds[x][1]]) >= 0.5) {
            pair = x;
            break;
          }
        if (pair < 0) {
          rows.push({ kind: 'removed', l: A[i] });
          stats.removed++;
          stats.del += countWords(A[i]);
          continue;
        }
        for (let x = after; x < pair; x++) if (!used.has(x)) addRow(adds[x][1], used, x);
        used.add(pair);
        after = pair + 1;
        const w = words(A[i], B[adds[pair][1]], ignoreCase);
        rows.push({ kind: 'changed', l: A[i], r: B[adds[pair][1]], parts: w.parts });
        stats.changed++;
        stats.ins += w.ins;
        stats.del += w.del;
      }
      for (let x = 0; x < adds.length; x++) if (!used.has(x)) addRow(adds[x][1], used, x);
      run = [];
    };
    function addRow(j, used, x) {
      used.add(x);
      const k = norm(B[j]);
      if (movedIn.get(k)) {
        movedIn.set(k, movedIn.get(k) - 1);
        rows.push({ kind: 'movedIn', r: B[j] });
        stats.moved++;
        return;
      }
      rows.push({ kind: 'added', r: B[j] });
      stats.added++;
      stats.ins += countWords(B[j]);
    }
    for (const o of ops) {
      if (o[0] === '=') {
        flush();
        rows.push({ kind: 'same', l: A[o[1]], r: B[o[2]] });
      } else run.push(o);
    }
    flush();

    // An edited paragraph that also moved lands in two different runs above. Pair those here and show
    // one changed row at its new position.
    for (const out of rows.filter((x) => x.kind === 'removed')) {
      const into = rows.find((x) => x.kind === 'added' && similarity(out.l, x.r) >= 0.5);
      if (!into) continue;
      const w = words(out.l, into.r, ignoreCase);
      Object.assign(into, { kind: 'changed', l: out.l, parts: w.parts, moved: true });
      rows.splice(rows.indexOf(out), 1);
      stats.removed--;
      stats.added--;
      stats.changed++;
      stats.moved++;
      stats.del += w.del - countWords(out.l);
      stats.ins += w.ins - countWords(into.r);
    }
    return { rows, stats };
  }

  return { seq, words, similarity, compare, countWords };
})();
