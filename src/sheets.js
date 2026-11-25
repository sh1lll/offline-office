'use strict';
/* ============================== SHEETS ============================== */
Mods.sheet = (() => {
  const wrap = $('#shWrap'),
    grid = $('#shGrid'),
    fbar = $('#shFormula'),
    refBox = $('#shRef'),
    bar = $('#shBar');
  let book = { sheets: [] },
    active = 0,
    name = 'Untitled workbook',
    booted = false;
  let A = { r: 0, c: 0 },
    F = { r: 0, c: 0 },
    editor = null,
    undoS = [],
    redoS = [],
    lastCopy = null,
    mouseSel = false;
  const sh = () => book.sheets[active];
  const {
    FErr,
    ERR,
    FN,
    compile,
    rewriteRefs,
    shiftFormula,
    colName,
    colIdx,
    key,
    parseRef,
    flat,
    sum,
    fromSerial,
  } = Formula;
  let cache = new Map();
  const visiting = new Set();
  const newSheet = (n) => ({ name: n, cells: {}, rows: 100, cols: 26, colW: {} });
  const bounds = () => [Math.min(A.r, F.r), Math.max(A.r, F.r), Math.min(A.c, F.c), Math.max(A.c, F.c)];
  const snap = () => JSON.stringify({ book, active });
  function hist() {
    undoS.push(snap());
    if (undoS.length > 80) undoS.shift();
    redoS = [];
  }
  function undo() {
    if (!undoS.length) return;
    redoS.push(snap());
    ({ book, active } = JSON.parse(undoS.pop()));
    renderAll();
  }
  function redo() {
    if (!redoS.length) return;
    undoS.push(snap());
    ({ book, active } = JSON.parse(redoS.pop()));
    renderAll();
  }
  const autosave = debounce(() => {
    const j = JSON.stringify({ book, name });
    keepDraft('sheet', 'sheet2', j.length < 2e6 ? { book, name } : null);
  }, 1000);

  function literal(raw) {
    const t = String(raw).trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
    if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
    if (/^-?[$€£]\s?\d[\d,]*(\.\d+)?$/.test(t)) return parseFloat(t.replace(/[$€£,\s]/g, ''));
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    return raw;
  }
  const findSheet = (sn) => (sn ? book.sheets.find((x) => x.name.toLowerCase() === sn.toLowerCase()) : null);
  function val(s, k) {
    const id = s.name + '!' + k;
    if (cache.has(id)) return cache.get(id);
    const cell = s.cells[k];
    let v;
    if (!cell || cell.v == null || cell.v === '') v = null;
    else if (typeof cell.v === 'string' && cell.v.startsWith('=') && cell.v.length > 1) {
      if (visiting.has(id)) return ERR('#CIRC!');
      visiting.add(id);
      try {
        const C = (sn, kk) => {
          const t = sn ? findSheet(sn) : s;
          if (!t) return ERR('#REF!');
          const x = val(t, kk);
          return x ?? 0;
        };
        const R = (sn, a, b) => {
          const t = sn ? findSheet(sn) : s;
          if (!t) return ERR('#REF!');
          const p = parseRef(a),
            q = parseRef(b);
          const r1 = Math.min(Math.max(p.r, q.r), t.rows - 1),
            c1 = Math.min(Math.max(p.c, q.c), t.cols - 1);
          const out = [];
          for (let r = Math.min(p.r, q.r); r <= r1; r++) {
            const row = [];
            for (let c = Math.min(p.c, q.c); c <= c1; c++) row.push(val(t, key(r, c)));
            out.push(row);
          }
          return out;
        };
        v = compile(cell.v.slice(1))(C, R, FN);
      } catch (e) {
        v = e instanceof FErr ? e : ERR('#ERROR!');
      }
      visiting.delete(id);
      if (Array.isArray(v)) v = flat(v)[0] ?? null;
      if (typeof v === 'number' && !isFinite(v)) v = ERR(isNaN(v) ? '#VALUE!' : '#DIV/0!');
    } else v = literal(cell.v);
    cache.set(id, v);
    return v;
  }
  function general(v) {
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-6 || a >= 1e15)) return v.toExponential(4);
    return String(+v.toPrecision(11));
  }
  function display(v, cell) {
    if (v === null || v === undefined) return '';
    if (v instanceof FErr) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') {
      const st = (cell && cell.s) || {};
      let f = st.fmt;
      const d = st.dec ?? 2;
      if (!f && cell && /^=\s*(TODAY|DATE)\(/i.test(cell.v)) f = 'date';
      switch (f) {
        case 'num':
          return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
        case 'cur':
          return v.toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: d,
            maximumFractionDigits: d,
          });
        case 'eur':
          return v.toLocaleString(undefined, {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: d,
            maximumFractionDigits: d,
          });
        case 'pct':
          return (v * 100).toFixed(d) + '%';
        case 'int':
          return Math.round(v).toLocaleString();
        case 'date':
          return fromSerial(v).toLocaleDateString();
        default:
          return st.dec != null ? v.toFixed(d) : general(v);
      }
    }
    return String(v);
  }

  /* --- rendering --- */
  // Only rows near the viewport are in the DOM; spacer rows keep the scroll height right.
  const ROW_H = 24, // must match .grid td height in styles.css
    win = { r0: 0, r1: -1 };
  function renderGrid() {
    cache = new Map();
    const s = sh();
    win.r0 = Math.max(0, Math.floor(wrap.scrollTop / ROW_H) - 30);
    win.r1 = Math.min(s.rows - 1, win.r0 + Math.ceil(wrap.clientHeight / ROW_H) + 90);
    const rowHeadW = Math.max(46, String(s.rows).length * 8 + 16);
    let h = `<colgroup><col style="width:${rowHeadW}px">`;
    for (let c = 0; c < s.cols; c++) h += `<col style="width:${s.colW[c] || 100}px">`;
    h += '</colgroup><thead><tr><th class="corner"></th>';
    for (let c = 0; c < s.cols; c++)
      h += `<th data-c="${c}" style="position:sticky">${colName(c)}<span class="colrs" data-rs="${c}"></span></th>`;
    h += `</tr></thead><tbody><tr class="spacer" style="height:${win.r0 * ROW_H}px"><td colspan="${s.cols + 1}"></td></tr>`;
    for (let r = win.r0; r <= win.r1; r++) {
      h += `<tr data-r="${r}"><th data-r="${r}">${r + 1}</th>`;
      for (let c = 0; c < s.cols; c++) {
        const k = key(r, c),
          cell = s.cells[k];
        if (!cell) {
          h += '<td></td>';
          continue;
        }
        const v = val(s, k),
          st = cell.s || {};
        const cls = [];
        let css = '';
        if (typeof v === 'number' || v instanceof FErr) cls.push(typeof v === 'number' ? 'num' : 'err');
        if (st.b) css += 'font-weight:700;';
        if (st.i) css += 'font-style:italic;';
        if (st.u) css += 'text-decoration:underline;';
        if (st.al) css += `text-align:${st.al};`;
        if (st.c) css += `color:${st.c};`;
        if (st.bg) {
          css += `background:${st.bg};`;
          if (!st.c) css += `color:${lum(st.bg) > 0.5 ? '#1a1f25' : '#f3f5f7'};`;
        }
        h += `<td class="${cls.join(' ')}" style="${css}">${esc(display(v, cell))}</td>`;
      }
      h += '</tr>';
    }
    h += `<tr class="spacer" style="height:${(s.rows - 1 - win.r1) * ROW_H}px"><td colspan="${s.cols + 1}"></td></tr>`;
    grid.innerHTML = h + '</tbody>';
    grid.style.width =
      rowHeadW + Array.from({ length: s.cols }, (_, c) => s.colW[c] || 100).reduce((a, b) => a + b, 0) + 'px';
    updateSel();
  }
  const lum = (c) => {
    const h = toHex(c) || 'FFFFFF';
    const n = parseInt(h, 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  // cells[0] is the row header, so tdAt(r, -1) gives it.
  const tdAt = (r, c) =>
    r < win.r0 || r > win.r1 ? null : grid.tBodies[0]?.rows[r - win.r0 + 1]?.cells[c + 1];
  // Scroll row r into view, redrawing if it lies outside the rendered window.
  function reveal(r, c) {
    const head = grid.tHead?.offsetHeight || ROW_H,
      top = r * ROW_H;
    if (top < wrap.scrollTop) wrap.scrollTop = top;
    else if (top + ROW_H > wrap.scrollTop + wrap.clientHeight - head)
      wrap.scrollTop = top + ROW_H - wrap.clientHeight + head;
    if (r < win.r0 || r > win.r1) renderGrid();
    tdAt(r, c)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  let scrollRaf = 0;
  wrap.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => {
      const first = Math.floor(wrap.scrollTop / ROW_H),
        last = first + Math.ceil(wrap.clientHeight / ROW_H);
      if ((first < win.r0 + 5 && win.r0 > 0) || (last > win.r1 - 5 && win.r1 < sh().rows - 1)) renderGrid();
    });
  });
  let prevSel = [];
  function updateSel() {
    prevSel.forEach((n) => n.classList.remove('in', 'cur', 'hl'));
    prevSel = [];
    const [r0, r1, c0, c1] = bounds();
    const s = sh();
    for (let r = Math.max(r0, win.r0); r <= Math.min(r1, win.r1); r++) {
      const th = tdAt(r, -1);
      if (th) {
        th.classList.add('hl');
        prevSel.push(th);
      }
      for (let c = c0; c <= Math.min(c1, s.cols - 1); c++) {
        const td = tdAt(r, c);
        if (td && (r1 > r0 || c1 > c0)) {
          td.classList.add('in');
          prevSel.push(td);
        }
      }
    }
    for (let c = c0; c <= Math.min(c1, s.cols - 1); c++) {
      const th = grid.tHead.rows[0].cells[c + 1];
      th.classList.add('hl');
      prevSel.push(th);
    }
    const cur = tdAt(A.r, A.c);
    if (cur) {
      cur.classList.add('cur');
      prevSel.push(cur);
    }
    refBox.value = r1 > r0 || c1 > c0 ? `${key(r0, c0)}:${key(r1, c1)}` : key(A.r, A.c);
    if (document.activeElement !== fbar) fbar.value = s.cells[key(A.r, A.c)]?.v ?? '';
    const st = s.cells[key(A.r, A.c)]?.s || {};
    $$('[data-st]', bar).forEach((b) => b.setAttribute('aria-pressed', !!st[b.dataset.st]));
    $('#shFmt').value = st.fmt || '';
    // status: stats for the selection
    const vals = [];
    let filled = 0;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const v = val(s, key(r, c));
        if (v !== null && v !== '') filled++;
        if (typeof v === 'number' && !isNaN(v)) vals.push(v);
      }
    $('#shStatus').innerHTML =
      `<span><b>${esc(name)}</b></span><span>${esc(s.name)}</span>` +
      (vals.length > 1 || r1 > r0 || c1 > c0
        ? `<span>Sum <b>${general(sum(vals))}</b></span><span>Average <b>${vals.length ? general(sum(vals) / vals.length) : '—'}</b></span><span>Count <b>${filled}</b></span><span>Min <b>${vals.length ? general(Math.min(...vals)) : '—'}</b></span><span>Max <b>${vals.length ? general(Math.max(...vals)) : '—'}</b></span>`
        : '<span>Type to enter data · = starts a formula · F2 edits · Ctrl+C / Ctrl+V work with Excel</span>');
  }
  function renderTabs() {
    const t = $('#shTabs');
    t.innerHTML = '';
    book.sheets.forEach((s, i) => {
      const b = el('button', { class: 'stab' + (i === active ? ' on' : '') }, s.name);
      b.onclick = () => {
        commit();
        active = i;
        A = F = { r: 0, c: 0 };
        renderAll();
      };
      b.ondblclick = () => sheetMenu(i);
      t.append(b);
    });
    t.append(
      el('button', {
        class: 'btn sq ghost',
        title: 'Add sheet',
        html: icon('plus'),
        onclick: () => {
          hist();
          let n = book.sheets.length + 1;
          while (findSheet('Sheet' + n)) n++;
          book.sheets.push(newSheet('Sheet' + n));
          active = book.sheets.length - 1;
          renderAll();
        },
      }),
      el(
        'span',
        { class: 'lbl', style: { marginLeft: '6px', color: 'var(--faint)' } },
        'Double-click a tab to rename',
      ),
    );
  }
  async function sheetMenu(i) {
    const s = book.sheets[i];
    const r = await UI.modal({
      title: 'Sheet',
      fields: [{ id: 'name', label: 'Name', value: s.name }],
      ok: 'Rename',
      extra: [
        { label: 'Duplicate', value: 'dup' },
        ...(book.sheets.length > 1 ? [{ label: 'Delete sheet', value: 'del' }] : []),
      ],
    });
    if (!r) return;
    hist();
    if (r._extra === 'del') {
      book.sheets.splice(i, 1);
      active = Math.max(0, Math.min(active, book.sheets.length - 1));
    } else if (r._extra === 'dup') {
      const c = JSON.parse(JSON.stringify(s));
      c.name = s.name + ' (copy)';
      book.sheets.splice(i + 1, 0, c);
      active = i + 1;
    } else if (r.name.trim() && !findSheet(r.name.trim())) s.name = r.name.trim();
    renderAll();
  }
  function renderAll() {
    active = clamp(active, 0, book.sheets.length - 1);
    renderTabs();
    renderGrid();
    autosave();
  }
  function changed() {
    renderGrid();
    autosave();
  }

  /* --- editing --- */
  function ensure(r, c) {
    const s = sh();
    if (r >= s.rows - 1) s.rows = r + 20;
    if (c >= s.cols - 1) s.cols = Math.min(c + 5, 702);
  }
  function setCell(r, c, v, noHist) {
    if (!noHist) hist();
    const s = sh(),
      k = key(r, c);
    const cell = s.cells[k] || {};
    cell.v = v;
    if ((v === '' || v == null) && !cell.s) delete s.cells[k];
    else s.cells[k] = cell;
    ensure(r, c);
  }
  function startEdit(initial) {
    commit();
    reveal(A.r, A.c);
    const td = tdAt(A.r, A.c);
    if (!td) return;
    const wr = wrap.getBoundingClientRect(),
      r = td.getBoundingClientRect();
    editor = el('input', {
      class: 'cell-editor',
      spellcheck: 'false',
      style: {
        left: r.left - wr.left + wrap.scrollLeft + 'px',
        top: r.top - wr.top + wrap.scrollTop + 'px',
        width: Math.max(r.width, 90) + 'px',
        height: r.height + 'px',
      },
    });
    editor.value = initial ?? sh().cells[key(A.r, A.c)]?.v ?? '';
    editor.dataset.fresh = initial != null ? '1' : '';
    wrap.append(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    editor.oninput = () => (fbar.value = editor.value);
    editor.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        move(e.shiftKey ? -1 : 1, 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commit();
        move(0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        editor.remove();
        editor = null;
        wrap.focus();
        updateSel();
      } else if (editor.dataset.fresh && e.key.startsWith('Arrow') && !editor.value.startsWith('=')) {
        e.preventDefault();
        commit();
        move(...{ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]);
      }
    };
    editor.onblur = () =>
      setTimeout(() => {
        if (editor && document.activeElement !== editor) commit();
      }, 0);
  }
  function commit() {
    if (!editor) return;
    const v = editor.value;
    const e = editor;
    editor = null;
    e.remove();
    const old = sh().cells[key(A.r, A.c)]?.v ?? '';
    if (v !== old) {
      setCell(A.r, A.c, v);
      changed();
    }
    wrap.focus({ preventScroll: true });
  }
  function move(dr, dc, extend) {
    const s = sh();
    if (extend) {
      F = { r: clamp(F.r + dr, 0, s.rows - 1), c: clamp(F.c + dc, 0, s.cols - 1) };
    } else {
      A = { r: clamp(A.r + dr, 0, s.rows - 1), c: clamp(A.c + dc, 0, s.cols - 1) };
      F = { ...A };
    }
    const p = extend ? F : A;
    if (p.r >= s.rows - 2) {
      s.rows += 20;
      renderGrid();
    } else updateSel();
    reveal(p.r, p.c);
  }
  function eachSel(fn) {
    const [r0, r1, c0, c1] = bounds();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r, c, key(r, c));
  }
  function styleSel(fn) {
    hist();
    const s = sh();
    eachSel((r, c, k) => {
      const cell = s.cells[k] || (s.cells[k] = { v: '' });
      cell.s = cell.s || {};
      fn(cell.s);
      if (!Object.keys(cell.s).length) delete cell.s;
      if (cell.v === '' && !cell.s) delete s.cells[k];
    });
    changed();
  }

  wrap.addEventListener('mousedown', (e) => {
    const rs = e.target.dataset.rs;
    if (rs != null) {
      e.preventDefault();
      const c = +rs,
        x0 = e.clientX,
        w0 = sh().colW[c] || 100;
      hist();
      const mv = (ev) => {
        sh().colW[c] = Math.max(30, w0 + ev.clientX - x0);
        grid.querySelectorAll('col')[c + 1].style.width = sh().colW[c] + 'px';
      };
      const up = () => {
        removeEventListener('mousemove', mv);
        removeEventListener('mouseup', up);
        renderGrid();
        autosave();
      };
      addEventListener('mousemove', mv);
      addEventListener('mouseup', up);
      return;
    }
    if (e.target === editor) return;
    const td = e.target.closest('td'),
      th = e.target.closest('th');
    if (td && td.parentElement.dataset.r) {
      commit();
      const r = +td.parentElement.dataset.r,
        c = td.cellIndex - 1;
      if (e.shiftKey) F = { r, c };
      else {
        A = { r, c };
        F = { r, c };
      }
      mouseSel = true;
      updateSel();
      e.preventDefault();
      wrap.focus({ preventScroll: true });
    } else if (th) {
      commit();
      const s = sh();
      if (th.dataset.c != null) {
        A = { r: 0, c: +th.dataset.c };
        F = { r: s.rows - 1, c: +th.dataset.c };
      } else if (th.dataset.r != null) {
        A = { r: +th.dataset.r, c: 0 };
        F = { r: +th.dataset.r, c: s.cols - 1 };
      } else {
        A = { r: 0, c: 0 };
        F = { r: s.rows - 1, c: s.cols - 1 };
      }
      updateSel();
      e.preventDefault();
      wrap.focus({ preventScroll: true });
    }
  });
  wrap.addEventListener('mouseover', (e) => {
    if (!mouseSel) return;
    const td = e.target.closest('td');
    if (!td) return;
    if (!td.parentElement.dataset.r) return;
    F = { r: +td.parentElement.dataset.r, c: td.cellIndex - 1 };
    updateSel();
  });
  addEventListener('mouseup', () => (mouseSel = false));
  wrap.addEventListener('dblclick', (e) => {
    if (e.target.closest('td')) startEdit(null);
  });
  function tsv() {
    const [r0, r1, c0, c1] = bounds();
    const s = sh();
    const out = [],
      raw = [];
    for (let r = r0; r <= r1; r++) {
      const a = [],
        b = [];
      for (let c = c0; c <= c1; c++) {
        const k = key(r, c);
        a.push(display(val(s, k), s.cells[k]));
        b.push(s.cells[k] ? JSON.parse(JSON.stringify(s.cells[k])) : null);
      }
      out.push(a.join('\t'));
      raw.push(b);
    }
    return { text: out.join('\n'), raw, r0, c0 };
  }
  wrap.addEventListener('keydown', (e) => {
    if (editor) return;
    const m = e.ctrlKey || e.metaKey,
      k = e.key;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      let [dr, dc] = arrows[k];
      if (m) {
        dr *= 1000;
        dc *= 1000;
      }
      move(dr, dc, e.shiftKey);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      move(e.shiftKey ? -1 : 1, 0);
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
      return;
    }
    if (k === 'F2') {
      e.preventDefault();
      startEdit(null);
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      hist();
      eachSel((r, c, kk) => {
        const cell = sh().cells[kk];
        if (cell) {
          cell.v = '';
          if (!cell.s) delete sh().cells[kk];
        }
      });
      changed();
      return;
    }
    if (m) {
      const l = k.toLowerCase();
      if (l === 'c' || l === 'x') {
        const t = tsv();
        lastCopy = t;
        navigator.clipboard?.writeText(t.text).catch(() => {});
        if (l === 'x') {
          hist();
          eachSel((r, c, kk) => delete sh().cells[kk]);
          changed();
        }
        UI.toast(l === 'x' ? 'Cut' : 'Copied');
        e.preventDefault();
        return;
      }
      if (l === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (l === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (l === 'b' || l === 'i' || l === 'u') {
        e.preventDefault();
        const on = !(sh().cells[key(A.r, A.c)]?.s || {})[l];
        styleSel((st) => (on ? (st[l] = true) : delete st[l]));
        return;
      }
      if (l === 'd') {
        e.preventDefault();
        act('fillDown');
        return;
      }
      if (l === 'a') {
        e.preventDefault();
        A = { r: 0, c: 0 };
        F = { r: sh().rows - 1, c: sh().cols - 1 };
        updateSel();
        return;
      }
      return;
    }
    if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(k);
    }
  });
  wrap.addEventListener('paste', (e) => {
    if (editor) return;
    const text = e.clipboardData?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    hist();
    const s = sh();
    if (lastCopy && text === lastCopy.text) {
      const dr = A.r - lastCopy.r0,
        dc = A.c - lastCopy.c0;
      lastCopy.raw.forEach((row, i) =>
        row.forEach((cell, j) => {
          const k = key(A.r + i, A.c + j);
          if (!cell) {
            delete s.cells[k];
            return;
          }
          const c2 = JSON.parse(JSON.stringify(cell));
          if (typeof c2.v === 'string' && c2.v.startsWith('=')) c2.v = shiftFormula(c2.v, dr, dc);
          s.cells[k] = c2;
          ensure(A.r + i, A.c + j);
        }),
      );
    } else {
      const rows = text
        .replace(/\r/g, '')
        .replace(/\n$/, '')
        .split('\n')
        .map((l) => l.split('\t'));
      rows.forEach((row, i) => row.forEach((v, j) => setCell(A.r + i, A.c + j, v, true)));
      F = { r: A.r + rows.length - 1, c: A.c + Math.max(...rows.map((r) => r.length)) - 1 };
    }
    changed();
  });
  fbar.addEventListener('focus', () => commit());
  fbar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setCell(A.r, A.c, fbar.value);
      changed();
      wrap.focus();
      move(1, 0);
    }
    if (e.key === 'Escape') {
      fbar.value = sh().cells[key(A.r, A.c)]?.v ?? '';
      wrap.focus();
    }
  });
  refBox.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const [a, b] = refBox.value.split(':');
    const p = parseRef(a),
      q = b ? parseRef(b) : p;
    if (!p || !q) return UI.toast('Type a cell like B12 or a range like A1:C5', true);
    A = p;
    F = q;
    ensure(Math.max(p.r, q.r), Math.max(p.c, q.c));
    renderGrid();
    reveal(p.r, p.c);
    wrap.focus();
  });

  /* --- structure ops --- */
  function shiftStructure(axis, at, n) {
    hist();
    const s = sh();
    const nc = {};
    const map = (i) => (n > 0 ? (i >= at ? i + n : i) : i >= at - n ? i + n : i >= at ? null : i);
    for (const [k, cell] of Object.entries(s.cells)) {
      const p = parseRef(k);
      const ni = map(axis === 'r' ? p.r : p.c);
      if (ni === null) continue;
      nc[axis === 'r' ? key(ni, p.c) : key(p.r, ni)] = cell;
    }
    for (const cell of Object.values(nc))
      if (typeof cell.v === 'string' && cell.v.startsWith('='))
        cell.v = rewriteRefs(cell.v, (d1, col, d2, row) => {
          const c = colIdx(col),
            r = row - 1;
          const ni = map(axis === 'r' ? r : c);
          if (ni === null) return '#REF!';
          return axis === 'r' ? d1 + col + d2 + (ni + 1) : d1 + colName(ni) + d2 + row;
        });
    if (axis === 'c') {
      const w = {};
      for (const [c, v] of Object.entries(s.colW)) {
        const ni = map(+c);
        if (ni !== null) w[ni] = v;
      }
      s.colW = w;
      s.cols = Math.max(1, s.cols + n);
    } else s.rows = Math.max(1, s.rows + n);
    Formula.clearCache();
    changed();
  }
  function usedRange(s = sh()) {
    let r1 = -1,
      c1 = -1;
    for (const k of Object.keys(s.cells)) {
      if (s.cells[k].v === '' || s.cells[k].v == null) continue;
      const p = parseRef(k);
      r1 = Math.max(r1, p.r);
      c1 = Math.max(c1, p.c);
    }
    return [r1, c1];
  }
  function sortBy(dir) {
    const s = sh();
    let [r0, r1, c0, c1] = bounds();
    const [ur, uc] = usedRange();
    if (r0 === r1) {
      r0 = 1;
      r1 = ur;
      c0 = 0;
      c1 = uc;
      UI.toast('Sorted rows 2–' + (ur + 1) + ' by column ' + colName(A.c) + ' (row 1 kept as header)');
    }
    if (r1 <= r0) return;
    hist();
    const rows = [];
    for (let r = r0; r <= r1; r++) {
      const row = [];
      for (let c = c0; c <= c1; c++) row.push(s.cells[key(r, c)] || null);
      rows.push({ row, v: val(s, key(r, A.c)) });
    }
    rows.sort((a, b) => {
      const x = a.v,
        y = b.v;
      if (x === null || x === '') return 1;
      if (y === null || y === '') return -1;
      if (typeof x === 'number' && typeof y === 'number') return dir * (x - y);
      if (typeof x === 'number') return -1;
      if (typeof y === 'number') return 1;
      return dir * String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    });
    rows.forEach((o, i) =>
      o.row.forEach((cell, j) => {
        const k = key(r0 + i, c0 + j);
        if (cell) s.cells[k] = cell;
        else delete s.cells[k];
      }),
    );
    changed();
  }
  async function act(a) {
    const s = sh();
    const [r0, r1, c0, c1] = bounds();
    switch (a) {
      case 'new':
        if (
          !(await UI.confirm(
            'Start a new workbook?',
            'The current workbook will be replaced. Export it first if you want to keep it.',
            'New workbook',
          ))
        )
          return;
        book = { sheets: [newSheet('Sheet1')] };
        active = 0;
        name = 'Untitled workbook';
        A = F = { r: 0, c: 0 };
        undoS = [];
        renderAll();
        break;
      case 'open':
        return open();
      case 'xlsx':
        return exportXlsx();
      case 'xls':
        return exportXlsx('xls');
      case 'ods':
        return exportXlsx('ods');
      case 'csv':
        return exportCsv();
      case 'html':
        return exportHtml();
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'clearFmt':
        styleSel((st) => Object.keys(st).forEach((k) => delete st[k]));
        break;
      case 'decLess':
        styleSel((st) => (st.dec = Math.max(0, (st.dec ?? 2) - 1)));
        break;
      case 'decMore':
        styleSel((st) => (st.dec = Math.min(10, (st.dec ?? 2) + 1)));
        break;
      case 'rowAbove':
        shiftStructure('r', r0, r1 - r0 + 1);
        break;
      case 'rowBelow':
        shiftStructure('r', r1 + 1, r1 - r0 + 1);
        break;
      case 'colLeft':
        shiftStructure('c', c0, c1 - c0 + 1);
        break;
      case 'colRight':
        shiftStructure('c', c1 + 1, c1 - c0 + 1);
        break;
      case 'delRow':
        shiftStructure('r', r0, -(Math.min(r1, s.rows - 1) - r0 + 1));
        A = F = { r: r0, c: A.c };
        updateSel();
        break;
      case 'delCol':
        shiftStructure('c', c0, -(Math.min(c1, s.cols - 1) - c0 + 1));
        A = F = { r: A.r, c: c0 };
        updateSel();
        break;
      case 'sortAsc':
        sortBy(1);
        break;
      case 'sortDesc':
        sortBy(-1);
        break;
      case 'fillDown': {
        if (r1 === r0) return UI.toast('Select a range of rows first: the top row is copied down.', true);
        hist();
        for (let c = c0; c <= c1; c++) {
          const src = s.cells[key(r0, c)];
          for (let r = r0 + 1; r <= r1; r++) {
            const k = key(r, c);
            if (!src) {
              delete s.cells[k];
              continue;
            }
            const n = JSON.parse(JSON.stringify(src));
            if (typeof n.v === 'string' && n.v.startsWith('=')) n.v = shiftFormula(n.v, r - r0, 0);
            s.cells[k] = n;
          }
        }
        changed();
        break;
      }
      case 'dedupe': {
        const [ur, uc] = usedRange();
        const R0 = r1 > r0 ? r0 : 0,
          R1 = r1 > r0 ? r1 : ur;
        hist();
        const seen = new Set();
        const keep = [];
        for (let r = R0; r <= R1; r++) {
          const sig = Array.from({ length: uc + 1 }, (_, c) =>
            display(val(s, key(r, c)), s.cells[key(r, c)]),
          ).join('\u0001');
          if (seen.has(sig)) continue;
          seen.add(sig);
          keep.push(Array.from({ length: uc + 1 }, (_, c) => s.cells[key(r, c)] || null));
        }
        const removed = R1 - R0 + 1 - keep.length;
        for (let r = R0; r <= R1; r++) for (let c = 0; c <= uc; c++) delete s.cells[key(r, c)];
        keep.forEach((row, i) =>
          row.forEach((cell, c) => {
            if (cell) s.cells[key(R0 + i, c)] = cell;
          }),
        );
        changed();
        UI.toast(`Removed ${removed} duplicate row${removed === 1 ? '' : 's'}`);
        break;
      }
      case 'trim':
        hist();
        eachSel((r, c, k) => {
          const cell = s.cells[k];
          if (cell && typeof cell.v === 'string' && !cell.v.startsWith('='))
            cell.v = cell.v.trim().replace(/\s+/g, ' ');
        });
        changed();
        break;
      case 'find': {
        const r = await UI.modal({
          title: 'Find & replace',
          fields: [
            { id: 'q', label: 'Find' },
            { id: 'rep', label: 'Replace with' },
            { id: 'cs', label: 'Match case', type: 'checkbox' },
            { id: 'all', label: 'Search all sheets', type: 'checkbox' },
          ],
          ok: 'Replace all',
          extra: [{ label: 'Find', value: 'find' }],
        });
        if (!r || !r.q) return;
        const re = new RegExp(escRe(r.q), r.cs ? 'g' : 'gi');
        const sheets = r.all ? book.sheets : [s];
        if (r._extra === 'find') {
          for (const t of sheets)
            for (const [k, cell] of Object.entries(t.cells)) {
              re.lastIndex = 0;
              if (re.test(String(cell.v)) || ((re.lastIndex = 0), re.test(display(val(t, k), cell)))) {
                active = book.sheets.indexOf(t);
                A = F = parseRef(k);
                renderAll();
                reveal(A.r, A.c);
                return;
              }
            }
          UI.toast('No matches');
          return;
        }
        hist();
        let n = 0;
        for (const t of sheets)
          for (const cell of Object.values(t.cells)) {
            const v = String(cell.v ?? '');
            const c = (v.match(re) || []).length;
            if (c) {
              n += c;
              cell.v = v.replace(re, r.rep);
            }
          }
        Formula.clearCache();
        changed();
        UI.toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`);
        break;
      }
      case 'chart':
        return chart();
      case 'example':
        if (!(await replaceOk(book.sheets.some((x) => Object.keys(x.cells).length)))) return;
        sample();
        active = 0;
        A = F = { r: 0, c: 0 };
        undoS = [];
        redoS = [];
        Formula.clearCache();
        renderAll();
        break;
    }
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a],[data-st],[data-al],[data-fn]');
    if (!b) return;
    if (b.dataset.a) return act(b.dataset.a);
    if (b.dataset.st) {
      const k = b.dataset.st;
      const on = !(sh().cells[key(A.r, A.c)]?.s || {})[k];
      styleSel((st) => (on ? (st[k] = true) : delete st[k]));
    }
    if (b.dataset.al) styleSel((st) => (st.al = b.dataset.al));
    if (b.dataset.fn) {
      const fn = b.dataset.fn;
      const [r0, r1, c0, c1] = bounds();
      if (r1 > r0 || c1 > c0) {
        const tr = r1 > r0 ? r1 + 1 : r0,
          tc = r1 > r0 ? c0 : c1 + 1;
        if (r1 > r0) {
          hist();
          for (let c = c0; c <= c1; c++) setCell(r1 + 1, c, `=${fn}(${key(r0, c)}:${key(r1, c)})`, true);
        } else {
          hist();
          setCell(r0, c1 + 1, `=${fn}(${key(r0, c0)}:${key(r0, c1)})`, true);
        }
        A = F = { r: tr, c: tc };
        changed();
      } else {
        startEdit(`=${fn}(`);
        editor.dataset.fresh = '';
      }
    }
  });
  $('#shFns').append(
    el('div', { class: 'mh' }, 'Select a range first to total it'),
    ...[
      'SUM',
      'AVERAGE',
      'COUNT',
      'MIN',
      'MAX',
      'MEDIAN',
      'ROUND',
      'IF',
      'IFERROR',
      'COUNTIF',
      'SUMIF',
      'VLOOKUP',
      'XLOOKUP',
      'CONCAT',
      'TODAY',
    ].map((f) => el('button', { 'data-fn': f }, f)),
    el('hr'),
    el(
      'div',
      {
        class: 'mh',
        style: {
          whiteSpace: 'normal',
          maxWidth: '230px',
          lineHeight: 1.4,
          textTransform: 'none',
          letterSpacing: 0,
        },
      },
      'Also: ' +
        Object.keys(FN)
          .filter(
            (f) =>
              ![
                'SUM',
                'AVERAGE',
                'COUNT',
                'MIN',
                'MAX',
                'MEDIAN',
                'ROUND',
                'IF',
                'IFERROR',
                'COUNTIF',
                'SUMIF',
                'VLOOKUP',
                'XLOOKUP',
                'CONCAT',
                'TODAY',
                'AVG',
              ].includes(f),
          )
          .join(', '),
    ),
  );
  $('#shColor').addEventListener('change', (e) => styleSel((st) => (st.c = e.target.value)));
  $('#shFill').addEventListener('change', (e) => styleSel((st) => (st.bg = e.target.value)));
  $('#shFmt').onchange = (e) =>
    styleSel((st) => (e.target.value ? (st.fmt = e.target.value) : delete st.fmt));

  /* --- chart --- */
  async function chart() {
    const s = sh();
    let [r0, r1, c0, c1] = bounds();
    if (r0 === r1 && c0 === c1) {
      const [ur, uc] = usedRange();
      r0 = 0;
      c0 = 0;
      c1 = uc;
      let r = 0;
      while (
        r <= ur &&
        Array.from({ length: uc + 1 }, (_, c) => s.cells[key(r, c)]).some((x) => x && x.v !== '')
      )
        r++;
      r1 = Math.max(0, r - 1);
    }
    const grid2 = [];
    for (let r = r0; r <= r1; r++) {
      const row = [];
      for (let c = c0; c <= c1; c++) row.push(val(s, key(r, c)));
      grid2.push(row);
    }
    const hasHeader =
      grid2[0].slice(1).some((v) => typeof v === 'string') || grid2[0].every((v) => typeof v !== 'number');
    const hasLabels = grid2.slice(hasHeader ? 1 : 0).some((r) => typeof r[0] === 'string');
    const body = grid2.slice(hasHeader ? 1 : 0).filter((r) => r.some((v) => typeof v === 'number'));
    const labels = body.map((r, i) => (hasLabels ? String(r[0] ?? '') : String(i + 1)));
    const sc = hasLabels ? 1 : 0;
    const series = [];
    for (let j = sc; j < (grid2[0]?.length || 0); j++) {
      const data = body.map((r) => (typeof r[j] === 'number' ? r[j] : 0));
      if (body.some((r) => typeof r[j] === 'number'))
        series.push({ name: hasHeader ? String(grid2[0][j] ?? colName(c0 + j)) : colName(c0 + j), data });
    }
    if (!series.length)
      return UI.toast(
        'Select a range with numbers to chart. Put labels in the first column and series names in the first row.',
        true,
      );
    const cv = el('canvas', {
      width: 1280,
      height: 720,
      style: { width: '100%', borderRadius: '8px', border: '1px solid var(--line)' },
    });
    const type = el(
      'select',
      { class: 'ctl' },
      ...[
        ['bar', 'Column'],
        ['hbar', 'Bar'],
        ['line', 'Line'],
        ['area', 'Area'],
        ['pie', 'Pie'],
        ['donut', 'Donut'],
      ].map(([v, l]) => el('option', { value: v }, l)),
    );
    const title = el('input', { type: 'text', class: 'ctl', value: s.name, style: { flex: 1 } });
    const draw = () => drawChart(cv, type.value, labels, series, title.value);
    type.onchange = draw;
    title.oninput = draw;
    const body2 = el(
      'div',
      { style: { display: 'grid', gap: '10px' } },
      el('div', { class: 'row' }, type, title),
      cv,
    );
    draw();
    const r = await UI.modal({ title: 'Chart', body: body2, wide: true, ok: 'Save as PNG', cancel: 'Close' });
    if (r)
      saveFile((title.value || 'chart') + '.png', await new Promise((res) => cv.toBlob(res, 'image/png')));
  }
  function drawChart(cv, type, labels, series, title) {
    const g = cv.getContext('2d'),
      W = cv.width,
      H = cv.height;
    const PAL = ['#2b5cb8', '#e07b2a', '#1e7b47', '#7a4bc2', '#c0392b', '#0d8a84', '#b8860b', '#d1477a'];
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1f25';
    g.font = '600 34px "IBM Plex Sans", Arial';
    g.textBaseline = 'top';
    g.fillText(title, 40, 30);
    g.font = '22px "IBM Plex Sans", Arial';
    let lx = 40;
    const ly = 82;
    const legendItems =
      type === 'pie' || type === 'donut'
        ? labels.map((l, i) => [l, PAL[i % PAL.length]])
        : series.map((s, i) => [s.name, PAL[i % PAL.length]]);
    let lyy = ly;
    legendItems.forEach(([l, c]) => {
      const w = g.measureText(l).width + 46;
      if (lx + w > W - 40) {
        lx = 40;
        lyy += 32;
      }
      g.fillStyle = c;
      g.fillRect(lx, lyy + 3, 18, 18);
      g.fillStyle = '#3a434d';
      g.fillText(l, lx + 26, lyy);
      lx += w;
    });
    const top = lyy + 56,
      bottom = H - 70,
      left = 110,
      right = W - 40;
    if (type === 'pie' || type === 'donut') {
      const d = series[0].data.map((v) => Math.max(0, v));
      const tot = sum(d) || 1;
      const cx = W / 2,
        cy = (top + bottom) / 2 + 10,
        R = Math.min(W, bottom - top) / 2;
      let a = -Math.PI / 2;
      d.forEach((v, i) => {
        const b = a + (v / tot) * Math.PI * 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, R, a, b);
        g.closePath();
        g.fillStyle = PAL[i % PAL.length];
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.stroke();
        const m = (a + b) / 2;
        if (v / tot > 0.04) {
          g.fillStyle = '#fff';
          g.font = '600 22px "IBM Plex Sans", Arial';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(
            Math.round((v / tot) * 100) + '%',
            cx + Math.cos(m) * R * (type === 'donut' ? 0.78 : 0.62),
            cy + Math.sin(m) * R * (type === 'donut' ? 0.78 : 0.62),
          );
        }
        a = b;
      });
      if (type === 'donut') {
        g.beginPath();
        g.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
        g.fillStyle = '#1a1f25';
        g.font = '600 30px "IBM Plex Sans", Arial';
        g.fillText(general(+tot.toFixed(2)), cx, cy);
      }
      g.textAlign = 'left';
      return;
    }
    const all = series.flatMap((s) => s.data);
    let mn = Math.min(0, ...all),
      mx = Math.max(0, ...all);
    if (mx === mn) mx = mn + 1;
    const step = (() => {
      const raw = (mx - mn) / 5;
      const p = 10 ** Math.floor(Math.log10(raw));
      return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    })();
    mn = Math.floor(mn / step) * step;
    mx = Math.ceil(mx / step) * step;
    const horiz = type === 'hbar';
    const fmtN = (v) =>
      Math.abs(v) >= 1e6 ? v / 1e6 + 'M' : Math.abs(v) >= 1e3 ? v / 1e3 + 'k' : general(+v.toFixed(6));
    const L = horiz ? 200 : left;
    const plotW = right - L,
      plotH = bottom - top;
    const vx = (v) => L + ((v - mn) / (mx - mn)) * plotW,
      vy = (v) => bottom - ((v - mn) / (mx - mn)) * plotH;
    g.font = '20px "IBM Plex Sans", Arial';
    g.strokeStyle = '#e3e7eb';
    g.lineWidth = 1.5;
    g.fillStyle = '#5b6672';
    for (let v = mn; v <= mx + 1e-9; v += step) {
      g.beginPath();
      if (horiz) {
        g.moveTo(vx(v), top);
        g.lineTo(vx(v), bottom);
        g.stroke();
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(fmtN(v), vx(v), bottom + 10);
      } else {
        g.moveTo(L, vy(v));
        g.lineTo(right, vy(v));
        g.stroke();
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillText(fmtN(v), L - 12, vy(v));
      }
    }
    const n = labels.length;
    const band = (horiz ? plotH : plotW) / n;
    const show = Math.max(1, Math.ceil((n * (horiz ? 30 : 120)) / (horiz ? plotH : plotW)));
    labels.forEach((l, i) => {
      if (i % show) return;
      const mx = horiz ? 16 : Math.max(4, Math.floor((band * show) / 11));
      const t = l.length > mx ? l.slice(0, mx - 1) + '…' : l;
      if (horiz) {
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillText(t, L - 12, top + band * (i + 0.5));
      } else {
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(t, L + band * (i + 0.5), bottom + 12);
      }
    });
    if (type === 'bar' || type === 'hbar') {
      const bw = (band * 0.72) / series.length;
      series.forEach((s, j) =>
        s.data.forEach((v, i) => {
          g.fillStyle = PAL[j % PAL.length];
          const o = band * 0.14 + bw * j;
          if (horiz) {
            const y = top + band * i + o;
            g.fillRect(Math.min(vx(0), vx(v)), y, Math.abs(vx(v) - vx(0)), bw - 2);
          } else {
            const x = L + band * i + o;
            g.fillRect(x, Math.min(vy(0), vy(v)), bw - 2, Math.abs(vy(v) - vy(0)));
          }
        }),
      );
    } else {
      series.forEach((s, j) => {
        const c = PAL[j % PAL.length];
        const pts = s.data.map((v, i) => [L + band * (i + 0.5), vy(v)]);
        if (type === 'area') {
          g.beginPath();
          g.moveTo(pts[0][0], vy(0));
          pts.forEach((p) => g.lineTo(...p));
          g.lineTo(pts[pts.length - 1][0], vy(0));
          g.closePath();
          g.globalAlpha = 0.18;
          g.fillStyle = c;
          g.fill();
          g.globalAlpha = 1;
        }
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
        g.strokeStyle = c;
        g.lineWidth = 4;
        g.stroke();
        pts.forEach((p) => {
          g.beginPath();
          g.arc(...p, 6, 0, Math.PI * 2);
          g.fillStyle = '#fff';
          g.fill();
          g.lineWidth = 3;
          g.stroke();
        });
      });
    }
    g.strokeStyle = '#9aa4ae';
    g.lineWidth = 2;
    g.beginPath();
    if (horiz) {
      g.moveTo(vx(0), top);
      g.lineTo(vx(0), bottom);
    } else {
      g.moveTo(L, vy(0));
      g.lineTo(right, vy(0));
    }
    g.stroke();
    g.textAlign = 'left';
  }

  /* --- import / export --- */
  async function load(file) {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
      type: 'array',
      cellFormula: true,
      cellNF: true,
      cellDates: false,
    });
    book = {
      sheets: wb.SheetNames.map((sn) => {
        const ws = wb.Sheets[sn];
        const s = newSheet(sn);
        if (!ws['!ref']) return s;
        const rg = XLSX.utils.decode_range(ws['!ref']);
        for (let r = rg.s.r; r <= rg.e.r; r++)
          for (let c = rg.s.c; c <= rg.e.c; c++) {
            const cl = ws[XLSX.utils.encode_cell({ r, c })];
            if (!cl) continue;
            let v;
            if (cl.f) v = '=' + cl.f;
            else if (cl.t === 'n') v = String(cl.v);
            else if (cl.t === 'b') v = cl.v ? 'TRUE' : 'FALSE';
            else if (cl.t === 'e') v = cl.w || '#ERROR!';
            else v = cl.v == null ? '' : String(cl.v);
            if (v.startsWith('=')) {
              try {
                compile(v.slice(1));
              } catch {
                v = cl.t === 'n' ? String(cl.v) : (cl.w ?? String(cl.v ?? ''));
              }
            }
            const cell = { v };
            const z = cl.z && String(cl.z);
            if (z && cl.t === 'n' && z !== 'General') {
              if (XLSX.SSF.is_date(z)) cell.s = { fmt: 'date' };
              else if (z.includes('%'))
                cell.s = { fmt: 'pct', dec: (z.split('.')[1] || '').replace(/[^0]/g, '').length };
              else if (/[$]/.test(z))
                cell.s = { fmt: 'cur', dec: (z.split('.')[1] || '').replace(/[^0]/g, '').length };
              else if (/€/.test(z)) cell.s = { fmt: 'eur' };
              else if (/#,##0/.test(z))
                cell.s = { fmt: 'num', dec: (z.split('.')[1] || '').replace(/[^0]/g, '').length };
            }
            s.cells[key(r, c)] = cell;
          }
        s.rows = Math.max(100, rg.e.r + 21);
        s.cols = Math.max(26, rg.e.c + 3);
        (ws['!cols'] || []).forEach((ci, i) => {
          if (ci && (ci.wpx || ci.wch)) s.colW[i] = Math.round(ci.wpx || ci.wch * 7.5);
        });
        return s;
      }),
    };
    if (!book.sheets.length) book.sheets.push(newSheet('Sheet1'));
    name = base(file.name);
    active = 0;
    A = F = { r: 0, c: 0 };
    undoS = [];
    redoS = [];
    Formula.clearCache();
    booted = true;
    renderAll();
  }
  async function open() {
    const [f] = await pickFiles(
      '.xlsx,.xls,.xlsm,.xlsb,.xltx,.csv,.tsv,.ods,.fods,.numbers,.dbf,.dif,.slk,.prn',
    );
    if (f) openFile(f);
  }
  function toWs(s, values) {
    cache = new Map();
    const [ur, uc] = usedRange(s);
    const ws = {};
    const fmtCode = {
      num: '#,##0.00',
      cur: '"$"#,##0.00',
      eur: '"€"#,##0.00',
      pct: '0.00%',
      int: '#,##0',
      date: 'yyyy-mm-dd',
    };
    for (let r = 0; r <= ur; r++)
      for (let c = 0; c <= uc; c++) {
        const k = key(r, c),
          cell = s.cells[k];
        if (!cell || cell.v === '' || cell.v == null) continue;
        const v = val(s, k);
        const out = {};
        if (v instanceof FErr) {
          out.t = 'e';
          out.v = 0x0f;
          out.w = v.code;
        } else if (typeof v === 'number') {
          out.t = 'n';
          out.v = v;
        } else if (typeof v === 'boolean') {
          out.t = 'b';
          out.v = v;
        } else {
          out.t = 's';
          out.v = v == null ? '' : String(v);
        }
        if (!values && typeof cell.v === 'string' && cell.v.startsWith('=')) out.f = cell.v.slice(1);
        if (cell.s?.fmt && fmtCode[cell.s.fmt]) out.z = fmtCode[cell.s.fmt];
        ws[XLSX.utils.encode_cell({ r, c })] = out;
      }
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, ur), c: Math.max(0, uc) },
    });
    ws['!cols'] = Array.from({ length: uc + 1 }, (_, c) => ({ wpx: s.colW[c] || 100 }));
    return ws;
  }
  async function exportXlsx(fmt = 'xlsx') {
    const wb = XLSX.utils.book_new();
    book.sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, toWs(s), s.name.slice(0, 31)));
    const out = XLSX.write(wb, { bookType: fmt, type: 'array' });
    savedWhole('sheet', await saveFile(name + '.' + fmt, new Blob([out])));
  }
  async function exportCsv() {
    const s = sh();
    await saveFile(
      `${name}${book.sheets.length > 1 ? ' - ' + s.name : ''}.csv`,
      XLSX.utils.sheet_to_csv(toWs(s, true)),
      'text/csv',
    );
  }
  async function exportHtml() {
    const s = sh();
    cache = new Map();
    const [ur, uc] = usedRange(s);
    let h = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.name)}</title><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse}td{border:1px solid #ccc;padding:4px 8px}td.n{text-align:right}</style></head><body><table>`;
    for (let r = 0; r <= ur; r++) {
      h += '<tr>';
      for (let c = 0; c <= uc; c++) {
        const k = key(r, c),
          cell = s.cells[k],
          v = val(s, k),
          st = cell?.s || {};
        h += `<td class="${typeof v === 'number' ? 'n' : ''}" style="${st.b ? 'font-weight:bold;' : ''}${st.i ? 'font-style:italic;' : ''}${st.c ? 'color:' + st.c + ';' : ''}${st.bg ? 'background:' + st.bg + ';' : ''}${st.al ? 'text-align:' + st.al : ''}">${esc(display(v, cell))}</td>`;
      }
      h += '</tr>';
    }
    await saveFile(name + '.html', h + '</table></body></html>', 'text/html');
  }
  function sample() {
    const s = newSheet('Budget');
    const rows = [
      ['Item', 'Category', 'Qty', 'Unit cost', 'Total', '% of budget'],
      ['Compost (bulk bags)', 'Soil', '12', '51.67'],
      ['Rain barrel 200 L', 'Water', '2', '170'],
      ['Hand trowels', 'Tools', '10', '9.5'],
      ['Pruning shears', 'Tools', '6', '22.5'],
      ['Seed packets', 'Plants', '40', '2.75'],
      ['Seedling trays', 'Plants', '15', '4.2'],
      ['Hose fittings', 'Water', '8', '6.25'],
      ['Signage boards', 'Other', '4', '18'],
    ];
    rows.forEach((r, i) => r.forEach((v, j) => (s.cells[key(i, j)] = { v })));
    for (let i = 1; i < rows.length; i++) {
      s.cells[key(i, 4)] = { v: `=C${i + 1}*D${i + 1}`, s: { fmt: 'cur' } };
      s.cells[key(i, 3)].s = { fmt: 'cur' };
      s.cells[key(i, 5)] = { v: `=E${i + 1}/$E$${rows.length + 2}`, s: { fmt: 'pct', dec: 1 } };
    }
    const n = rows.length;
    s.cells[key(n + 1, 0)] = { v: 'Total', s: { b: true } };
    s.cells[key(n + 1, 2)] = { v: `=SUM(C2:C${n})`, s: { b: true } };
    s.cells[key(n + 1, 4)] = { v: `=SUM(E2:E${n})`, s: { b: true, fmt: 'cur', bg: '#fff3bf' } };
    s.cells[key(n + 2, 0)] = { v: 'Average line cost' };
    s.cells[key(n + 2, 4)] = { v: `=ROUND(AVERAGE(E2:E${n}),2)`, s: { fmt: 'cur' } };
    s.cells[key(n + 3, 0)] = { v: 'Tool spend' };
    s.cells[key(n + 3, 4)] = { v: `=SUMIF(B2:B${n},"Tools",E2:E${n})`, s: { fmt: 'cur' } };
    s.cells[key(n + 4, 0)] = { v: 'Approved budget' };
    s.cells[key(n + 4, 4)] = { v: '1850', s: { fmt: 'cur' } };
    s.cells[key(n + 5, 0)] = { v: 'Status' };
    s.cells[key(n + 5, 4)] = {
      v: `=IF(E${n + 2}<=E${n + 5},"Within budget","Over budget")`,
      s: { b: true, c: '#1e7b47' },
    };
    for (let j = 0; j < 6; j++) s.cells[key(0, j)].s = { b: true, bg: '#e3f0ee' };
    s.colW = { 0: 170, 1: 90, 2: 60, 3: 90, 4: 100, 5: 100 };
    const s2 = newSheet('Plots');
    [
      ['Plot', 'Holder', 'Size (m²)', 'Fee'],
      ['A1', 'R. Okafor', '6', '=C2*5'],
      ['A2', 'L. Brandt', '6', '=C3*5'],
      ['B1', 'M. Haddad', '9', '=C4*5'],
      ['B2', 'J. Silva', '9', '=C5*5'],
      ['C1', 'A. Novak', '12', '=C6*5'],
      ['', 'Total fees', '', '=SUM(D2:D6)'],
    ].forEach((r, i) =>
      r.forEach((v, j) => {
        if (v !== '')
          s2.cells[key(i, j)] = {
            v,
            s: i === 0 ? { b: true, bg: '#e3f0ee' } : j === 3 ? { fmt: 'cur' } : undefined,
          };
      }),
    );
    s2.colW = { 1: 130 };
    book = { sheets: [s, s2] };
    name = 'Garden budget (example)';
  }
  return {
    load,
    act,
    open,
    save: () => exportXlsx(),
    onShow() {
      if (!booted) {
        booted = true;
        const d = store.get('sheet2');
        if (d && d.book?.sheets?.length) {
          book = d.book;
          name = d.name || name;
        } else {
          book = { sheets: [newSheet('Sheet1')] };
          name = 'Untitled workbook';
        }
        renderAll();
      }
      wrap.focus({ preventScroll: true });
    },
  };
})();
