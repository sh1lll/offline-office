'use strict';
/* ============================== SLIDES ============================== */
Mods.slides = (() => {
  const list = $('#slList'),
    wrap = $('#slStageWrap'),
    box = $('#slStageBox'),
    props = $('#slProps'),
    bar = $('#slBar');
  let deck = { w: 960, h: 540, theme: 'harbor', slides: [] },
    cur = 0,
    sel = null,
    name = 'Untitled presentation',
    stageK = 1,
    editing = false;
  let undoS = [],
    redoS = [],
    clip = null,
    booted = false;
  const THEMES = {
    paper: {
      name: 'Paper',
      bg: '#ffffff',
      title: '#1a1f25',
      text: '#3a434d',
      accent: '#0d6b66',
      font: 'Arial',
    },
    midnight: {
      name: 'Midnight',
      bg: '#14181d',
      title: '#ffffff',
      text: '#c3ccd5',
      accent: '#4cbdb4',
      font: 'Arial',
    },
    harbor: {
      name: 'Harbor',
      bg: '#0f3b57',
      title: '#ffffff',
      text: '#d3e4f0',
      accent: '#f2b544',
      font: 'Georgia',
    },
    linen: {
      name: 'Linen',
      bg: '#f1ede4',
      title: '#2d2a26',
      text: '#55504a',
      accent: '#a8481f',
      font: 'Georgia',
    },
    meadow: {
      name: 'Meadow',
      bg: '#f4f9f1',
      title: '#1d3b2a',
      text: '#3d5446',
      accent: '#3c8d4f',
      font: 'Verdana',
    },
    grape: {
      name: 'Grape',
      bg: '#2a1840',
      title: '#ffffff',
      text: '#e2d6f3',
      accent: '#ff7ab6',
      font: 'Trebuchet MS',
    },
  };
  const FONTS = [
    'Arial',
    'Helvetica',
    'Georgia',
    'Times New Roman',
    'Verdana',
    'Trebuchet MS',
    'Calibri',
    'Garamond',
    'Courier New',
    'Impact',
  ];
  const slide = () => deck.slides[cur];
  const selEl = () => slide()?.els.find((o) => o.id === sel) || null;
  const th = () => THEMES[deck.theme] || THEMES.paper;
  const snap = () => JSON.stringify({ deck, cur });
  function hist() {
    unsaved.add('slides');
    undoS.push(snap());
    if (undoS.length > 50) undoS.shift();
    redoS = [];
  }
  function undo() {
    if (!undoS.length) return;
    redoS.push(snap());
    ({ deck, cur } = JSON.parse(undoS.pop()));
    sel = null;
    renderAll();
  }
  function redo() {
    if (!redoS.length) return;
    undoS.push(snap());
    ({ deck, cur } = JSON.parse(redoS.pop()));
    sel = null;
    renderAll();
  }

  /* --- element factories & layouts --- */
  const txt = (o) => ({
    id: uid(),
    type: 'box',
    x: 80,
    y: 80,
    w: 800,
    h: 80,
    text: '',
    fontSize: 28,
    color: th().text,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    valign: 'top',
    font: th().font,
    fill: '',
    stroke: '',
    strokeW: 0,
    shape: 'rect',
    opacity: 1,
    rot: 0,
    ...o,
  });
  function layout(kind) {
    const t = th(),
      W = deck.w,
      H = deck.h;
    const title = (o) => txt({ fontSize: 44, bold: true, color: t.title, ...o });
    switch (kind) {
      case 'title':
        return [
          title({
            x: 80,
            y: H * 0.3,
            w: W - 160,
            h: 110,
            text: 'Presentation title',
            fontSize: 56,
            align: 'center',
            valign: 'bottom',
          }),
          txt({
            x: 80,
            y: H * 0.3 + 125,
            w: W - 160,
            h: 60,
            text: 'Subtitle or presenter name',
            align: 'center',
            fontSize: 24,
          }),
          txt({ x: W / 2 - 40, y: H * 0.3 + 115, w: 80, h: 4, fill: t.accent, shape: 'rect' }),
        ];
      case 'content':
        return [
          title({ x: 64, y: 40, w: W - 128, h: 80, text: 'Slide title', valign: 'middle' }),
          txt({
            x: 64,
            y: 140,
            w: W - 128,
            h: H - 190,
            text: '• First point\n• Second point\n• Third point',
            fontSize: 26,
          }),
        ];
      case 'two':
        return [
          title({ x: 64, y: 40, w: W - 128, h: 80, text: 'Comparison', valign: 'middle' }),
          txt({
            x: 64,
            y: 140,
            w: (W - 160) / 2,
            h: H - 190,
            text: 'Left column\n• Point one\n• Point two',
            fontSize: 24,
          }),
          txt({
            x: 96 + (W - 160) / 2,
            y: 140,
            w: (W - 160) / 2,
            h: H - 190,
            text: 'Right column\n• Point one\n• Point two',
            fontSize: 24,
          }),
        ];
      case 'section':
        return [
          txt({ x: 0, y: 0, w: 18, h: H, fill: t.accent }),
          title({
            x: 80,
            y: H / 2 - 70,
            w: W - 160,
            h: 90,
            text: 'Section title',
            fontSize: 52,
            valign: 'bottom',
          }),
          txt({
            x: 80,
            y: H / 2 + 28,
            w: W - 160,
            h: 50,
            text: 'A one-line summary of this section',
            fontSize: 22,
          }),
        ];
      case 'image':
        return [
          txt({
            x: 64,
            y: 48,
            w: W * 0.55,
            h: H - 96,
            fill: t.accent,
            opacity: 0.25,
            text: 'Use Image in the toolbar to add a picture',
            align: 'center',
            valign: 'middle',
            fontSize: 18,
          }),
          title({
            x: W * 0.55 + 96,
            y: 80,
            w: W * 0.45 - 160,
            h: 120,
            text: 'Picture title',
            fontSize: 34,
            valign: 'bottom',
          }),
          txt({
            x: W * 0.55 + 96,
            y: 215,
            w: W * 0.45 - 160,
            h: 200,
            text: 'Short caption describing what the picture shows.',
            fontSize: 18,
          }),
        ];
      default:
        return [];
    }
  }
  const newSlide = (kind) => ({ id: uid(), bg: th().bg, bgImage: '', notes: '', els: layout(kind) });

  /* --- rendering --- */
  function renderSlide(s, interactive) {
    const c = el('div', {
      class: 'slide-canvas',
      style: { width: deck.w + 'px', height: deck.h + 'px', background: s.bg || '#fff' },
    });
    if (s.bgImage)
      Object.assign(c.style, {
        backgroundImage: `url("${Img.get(s.bgImage)}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      });
    s.els.forEach((o) => c.append(elNode(o, interactive)));
    return c;
  }
  function elNode(o, interactive) {
    const n = el('div', { class: 'el' + (interactive && o.id === sel ? ' sel' : ''), 'data-id': o.id });
    Object.assign(n.style, {
      left: o.x + 'px',
      top: o.y + 'px',
      width: o.w + 'px',
      height: o.h + 'px',
      opacity: o.opacity ?? 1,
      transform: o.rot ? `rotate(${o.rot}deg)` : '',
    });
    if (o.type === 'image') n.append(el('img', { src: Img.get(o.src), alt: '' }));
    else if (o.shape === 'line') {
      n.style.height = Math.max(o.strokeW || 3, 1) + 'px';
      n.style.background = o.stroke || o.color;
    } else {
      n.style.background = o.fill || 'transparent';
      if (o.stroke && o.strokeW) n.style.border = `${o.strokeW}px solid ${o.stroke}`;
      n.style.borderRadius =
        o.shape === 'ellipse' ? '50%' : o.shape === 'roundRect' ? Math.min(o.w, o.h) * 0.16 + 'px' : '0';
      if (o.shape === 'triangle') n.style.clipPath = 'polygon(50% 0,100% 100%,0 100%)';
      n.style.justifyContent = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[o.valign || 'top'];
      const tx = el('div', { class: 'tx' });
      tx.textContent = o.text || '';
      Object.assign(tx.style, {
        fontSize: o.fontSize + 'px',
        color: o.color,
        fontWeight: o.bold ? '700' : '400',
        fontStyle: o.italic ? 'italic' : 'normal',
        textDecoration: o.underline ? 'underline' : 'none',
        textAlign: o.align || 'left',
        fontFamily: `"${o.font || 'Arial'}", Arial, sans-serif`,
      });
      n.append(tx);
    }
    if (interactive)
      ['nw', 'ne', 'sw', 'se'].forEach((k) => n.append(el('div', { class: 'hd ' + k, 'data-h': k })));
    return n;
  }
  function fit() {
    const k = Math.max(0.05, Math.min((wrap.clientWidth - 40) / deck.w, (wrap.clientHeight - 40) / deck.h));
    stageK = k;
    box.style.width = deck.w * k + 'px';
    box.style.height = deck.h * k + 'px';
    const c = box.firstChild;
    if (c) c.style.transform = `scale(${k})`;
  }
  new ResizeObserver(() => fit()).observe(wrap);
  function renderStage() {
    box.innerHTML = '';
    if (!slide()) return;
    const c = renderSlide(slide(), true);
    box.append(c);
    wireStage(c);
    fit();
  }
  function thumbNode(i) {
    const s = deck.slides[i];
    const fw = 104;
    const k = fw / deck.w;
    const c = renderSlide(s, false);
    c.style.transform = `scale(${k})`;
    const frame = el(
      'div',
      { class: 'frame', style: { width: fw + 'px', height: deck.h * k + 'px', aspectRatio: 'auto' } },
      c,
    );
    const t = el(
      'div',
      {
        class: 'sthumb' + (i === cur ? ' sel' : ''),
        draggable: 'true',
        'data-i': i,
        title: 'Drag to reorder',
      },
      el('span', { class: 'n' }, i + 1),
      frame,
    );
    t.onclick = () => {
      if (editing) return;
      cur = i;
      sel = null;
      renderAll();
    };
    t.ondragstart = (e) => e.dataTransfer.setData('text/x-slide', i);
    t.ondragover = (e) => {
      if (e.dataTransfer.types.includes('text/x-slide')) {
        e.preventDefault();
        t.classList.add('drag-over');
      }
    };
    t.ondragleave = () => t.classList.remove('drag-over');
    t.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const from = +e.dataTransfer.getData('text/x-slide');
      if (from === i) return;
      hist();
      const [m] = deck.slides.splice(from, 1);
      deck.slides.splice(i, 0, m);
      cur = i;
      renderAll();
    };
    return t;
  }
  function renderList() {
    list.innerHTML = '';
    deck.slides.forEach((_, i) => list.append(thumbNode(i)));
  }
  const refreshThumb = debounce(() => {
    const old = list.children[cur];
    if (old) old.replaceWith(thumbNode(cur));
  }, 250);
  function renderAll() {
    cur = clamp(cur, 0, deck.slides.length - 1);
    renderList();
    renderStage();
    renderProps();
    status();
  }
  function status() {
    $('#slStatus').innerHTML =
      `<span><b>${esc(name)}</b></span><span>Slide ${cur + 1} of ${deck.slides.length}</span><span>${deck.w}×${deck.h}</span><span>Double-click text to edit · drag corners to resize · arrows nudge · Shift snaps freely</span>`;
  }
  function changed() {
    refreshThumb();
  }

  /* --- stage interaction --- */
  const toSlide = (e, c) => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / stageK, (e.clientY - r.top) / stageK];
  };
  function wireStage(c) {
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const n = e.target.closest('.el');
      if (!n) {
        if (sel) {
          sel = null;
          $$('.el.sel', c).forEach((x) => x.classList.remove('sel'));
          renderProps();
        }
        return;
      }
      if (n.classList.contains('editing')) return;
      const o = slide().els.find((x) => x.id === n.dataset.id);
      if (!o) return;
      if (sel !== o.id) {
        sel = o.id;
        $$('.el.sel', c).forEach((x) => x.classList.remove('sel'));
        n.classList.add('sel');
        renderProps();
      }
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const [sx, sy] = toSlide(e, c);
      const o0 = { ...o };
      const h = e.target.dataset.h;
      let moved = false;
      const guides = [];
      const clearG = () => {
        guides.forEach((g) => g.remove());
        guides.length = 0;
      };
      const mv = (ev) => {
        let [x, y] = toSlide(ev, c);
        const dx = x - sx,
          dy = y - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
        if (!moved) {
          hist();
          moved = true;
        }
        if (h) {
          let { x: X, y: Y, w: Wd, h: Ht } = o0;
          if (h.includes('e')) Wd = o0.w + dx;
          if (h.includes('s')) Ht = o0.h + dy;
          if (h.includes('w')) {
            Wd = o0.w - dx;
            X = o0.x + dx;
          }
          if (h.includes('n')) {
            Ht = o0.h - dy;
            Y = o0.y + dy;
          }
          if ((o.type === 'image') !== ev.shiftKey && o0.h > 0) {
            const r = o0.w / o0.h;
            Ht = Wd / r;
            if (h.includes('n')) Y = o0.y + o0.h - Ht;
          }
          o.w = Math.max(8, Wd);
          o.h = Math.max(o.shape === 'line' ? 1 : 8, Ht);
          o.x = h.includes('w') ? o0.x + o0.w - o.w : X;
          o.y = h.includes('n') ? o0.y + o0.h - o.h : Y;
        } else {
          let nx = o0.x + dx,
            ny = o0.y + dy;
          clearG();
          if (!ev.shiftKey) {
            const t = 6 / stageK,
              W = deck.w,
              H = deck.h;
            const xs = [
              [nx + o.w / 2, W / 2, () => (nx = W / 2 - o.w / 2), W / 2],
              [nx, 0, () => (nx = 0), 0],
              [nx + o.w, W, () => (nx = W - o.w), W],
            ];
            const ys = [
              [ny + o.h / 2, H / 2, () => (ny = H / 2 - o.h / 2), H / 2],
              [ny, 0, () => (ny = 0), 0],
              [ny + o.h, H, () => (ny = H - o.h), H],
            ];
            for (const [a, b, f, g] of xs)
              if (Math.abs(a - b) < t) {
                f();
                const gl = el('div', {
                  class: 'guide',
                  style: {
                    left: g - 0.5 / stageK + 'px',
                    top: 0,
                    width: 1 / stageK + 'px',
                    height: H + 'px',
                  },
                });
                c.append(gl);
                guides.push(gl);
                break;
              }
            for (const [a, b, f, g] of ys)
              if (Math.abs(a - b) < t) {
                f();
                const gl = el('div', {
                  class: 'guide',
                  style: {
                    top: g - 0.5 / stageK + 'px',
                    left: 0,
                    height: 1 / stageK + 'px',
                    width: W + 'px',
                  },
                });
                c.append(gl);
                guides.push(gl);
                break;
              }
          }
          o.x = Math.round(nx);
          o.y = Math.round(ny);
        }
        Object.assign(n.style, {
          left: o.x + 'px',
          top: o.y + 'px',
          width: o.w + 'px',
          height: (o.shape === 'line' ? Math.max(o.strokeW || 3, 1) : o.h) + 'px',
        });
      };
      const up = () => {
        c.removeEventListener('pointermove', mv);
        c.removeEventListener('pointerup', up);
        clearG();
        if (moved) {
          changed();
          renderProps();
        }
      };
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', up);
    });
    c.addEventListener('dblclick', (e) => {
      const n = e.target.closest('.el');
      if (n) editText(n);
    });
  }
  function editText(n) {
    const o = slide().els.find((x) => x.id === n.dataset.id);
    if (!o || o.type === 'image' || o.shape === 'line') return;
    const tx = $('.tx', n);
    n.classList.add('editing');
    editing = true;
    try {
      tx.contentEditable = 'plaintext-only';
    } catch {}
    if (tx.contentEditable !== 'plaintext-only') tx.contentEditable = 'true';
    tx.focus();
    const r = document.createRange();
    r.selectNodeContents(tx);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const before = o.text;
    tx.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') tx.blur();
    };
    tx.onblur = () => {
      editing = false;
      n.classList.remove('editing');
      tx.contentEditable = 'false';
      const t = tx.innerText.replace(/\n$/, '');
      if (t !== before) {
        hist();
        o.text = t;
        changed();
        renderProps();
      }
    };
  }
  document.addEventListener('keydown', (e) => {
    if (
      curMod !== 'slides' ||
      editing ||
      e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]') ||
      $('.present') ||
      $('.modal-bg')
    )
      return;
    const m = e.ctrlKey || e.metaKey,
      o = selEl();
    if (m && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (m && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (m && e.key.toLowerCase() === 'c' && o) {
      clip = JSON.parse(JSON.stringify(o));
      UI.toast('Copied');
      return;
    }
    if (m && e.key.toLowerCase() === 'v' && clip) {
      e.preventDefault();
      hist();
      const c = { ...JSON.parse(JSON.stringify(clip)), id: uid(), x: clip.x + 20, y: clip.y + 20 };
      slide().els.push(c);
      sel = c.id;
      renderStage();
      renderProps();
      changed();
      return;
    }
    if (m && e.key.toLowerCase() === 'd' && o) {
      e.preventDefault();
      act('dupEl');
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      present();
      return;
    }
    if (!o) {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        cur = Math.min(cur + 1, deck.slides.length - 1);
        renderAll();
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        cur = Math.max(cur - 1, 0);
        renderAll();
      }
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      act('delEl');
      return;
    }
    if (e.key === 'Enter') {
      const n = $(`.el[data-id="${o.id}"]`, box);
      if (n) {
        e.preventDefault();
        editText(n);
      }
      return;
    }
    if (e.key === 'Escape') {
      sel = null;
      renderStage();
      renderProps();
      return;
    }
    const d = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (mv) {
      e.preventDefault();
      hist();
      o.x += mv[0];
      o.y += mv[1];
      renderStage();
      changed();
      renderProps();
    }
  });

  /* --- properties panel --- */
  function field(label, input) {
    return el('div', { class: 'field' }, el('label', { class: 'lbl' }, label), input);
  }
  function bind(input, get, set, live = true) {
    let pushed = false;
    input.addEventListener('focus', () => (pushed = false));
    const apply = () => {
      if (!pushed) {
        hist();
        pushed = true;
      }
      set(
        input.type === 'checkbox'
          ? input.checked
          : input.type === 'number' || input.type === 'range'
            ? parseFloat(input.value)
            : input.value,
      );
      renderStage();
      changed();
    };
    input.addEventListener(live ? 'input' : 'change', apply);
    return input;
  }
  function num(v, onset, step = 1) {
    const i = el('input', { type: 'number', class: 'ctl', step });
    i.value = Math.round(v * 100) / 100;
    return bind(i, null, onset);
  }
  function color(v, onset) {
    const i = el('input', { type: 'color', class: 'ctl' });
    i.value = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000';
    return bind(i, null, onset);
  }
  function renderProps() {
    props.innerHTML = '';
    const s = slide();
    if (!s) return;
    const o = selEl();
    if (!o) {
      const bgImg = el(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            const [f] = await pickFiles('image/*');
            if (!f) return;
            hist();
            s.bgImage = Img.put(await readAs(f, 'url'));
            renderAll();
          },
        },
        s.bgImage ? 'Replace background image' : 'Background image…',
      );
      const notes = el('textarea', { class: 'notes', placeholder: 'Speaker notes for this slide' });
      notes.value = s.notes || '';
      bind(notes, null, (v) => (s.notes = v));
      props.append(
        el('h4', {}, `Slide ${cur + 1}`),
        field(
          'Background color',
          color(s.bg, (v) => (s.bg = v)),
        ),
        el(
          'div',
          { class: 'row' },
          bgImg,
          s.bgImage
            ? el(
                'button',
                {
                  class: 'btn ghost',
                  onclick: () => {
                    hist();
                    s.bgImage = '';
                    renderAll();
                  },
                },
                'Remove',
              )
            : null,
        ),
        el(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              hist();
              deck.slides.forEach((x) => {
                x.bg = s.bg;
                x.bgImage = s.bgImage;
              });
              renderAll();
              UI.toast('Background applied to all slides');
            },
          },
          'Apply background to all slides',
        ),
        field('Speaker notes', notes),
        el(
          'p',
          { class: 'lbl', style: { lineHeight: 1.5, textTransform: 'none', letterSpacing: 0 } },
          'Select an object on the slide to edit it. Double-click text to type.',
        ),
      );
      return;
    }
    props.append(
      el(
        'h4',
        {},
        o.type === 'image'
          ? 'Image'
          : o.shape === 'line'
            ? 'Line'
            : o.fill || o.stroke
              ? 'Shape'
              : 'Text box',
      ),
    );
    props.append(
      el(
        'div',
        { class: 'grid2' },
        field(
          'X',
          num(o.x, (v) => (o.x = v)),
        ),
        field(
          'Y',
          num(o.y, (v) => (o.y = v)),
        ),
        field(
          'Width',
          num(o.w, (v) => (o.w = Math.max(4, v))),
        ),
        field(
          'Height',
          num(o.h, (v) => (o.h = Math.max(1, v))),
        ),
        field(
          'Rotation°',
          num(o.rot || 0, (v) => (o.rot = v)),
        ),
        field(
          'Opacity %',
          num((o.opacity ?? 1) * 100, (v) => (o.opacity = clamp(v / 100, 0, 1)), 5),
        ),
      ),
    );
    if (o.type === 'box' && o.shape !== 'line') {
      const ta = el('textarea', { class: 'notes', style: { minHeight: '70px' } });
      ta.value = o.text;
      bind(ta, null, (v) => (o.text = v));
      const font = el(
        'select',
        { class: 'ctl' },
        ...[...FONTS, ...userFonts].map((f) => el('option', { value: f, selected: f === o.font }, f)),
      );
      bind(font, null, (v) => (o.font = v), false);
      const tog = (k, label) => {
        const b = el('button', { class: 'btn sq', 'aria-pressed': !!o[k], html: label });
        b.onclick = () => {
          hist();
          o[k] = !o[k];
          b.setAttribute('aria-pressed', o[k]);
          renderStage();
          changed();
        };
        return b;
      };
      const seg = (k, opts) =>
        el(
          'div',
          { class: 'seg' },
          ...opts.map(([v, l]) => {
            const b = el('button', { class: o[k] === v ? 'on' : '', html: l });
            b.onclick = () => {
              hist();
              o[k] = v;
              renderStage();
              renderProps();
              changed();
            };
            return b;
          }),
        );
      const shape = el(
        'select',
        { class: 'ctl' },
        ...[
          ['rect', 'Rectangle'],
          ['roundRect', 'Rounded'],
          ['ellipse', 'Ellipse'],
          ['triangle', 'Triangle'],
        ].map(([v, l]) => el('option', { value: v, selected: v === o.shape }, l)),
      );
      bind(shape, null, (v) => (o.shape = v), false);
      const noFill = el('input', { type: 'checkbox', checked: !o.fill });
      noFill.onchange = () => {
        hist();
        o.fill = noFill.checked ? '' : th().accent;
        renderStage();
        renderProps();
        changed();
      };
      props.append(
        field('Text', ta),
        el(
          'div',
          { class: 'grid2' },
          field('Font', font),
          field(
            'Size (px)',
            num(o.fontSize, (v) => (o.fontSize = clamp(v, 4, 400))),
          ),
        ),
        el(
          'div',
          { class: 'row' },
          field(
            'Color',
            color(o.color, (v) => (o.color = v)),
          ),
          tog('bold', icon('bold')),
          tog('italic', icon('italic')),
          tog('underline', icon('underline')),
        ),
        seg('align', [
          ['left', icon('alignL')],
          ['center', icon('alignC')],
          ['right', icon('alignR')],
          ['justify', icon('alignJ')],
        ]),
        seg('valign', [
          ['top', 'Top'],
          ['middle', 'Middle'],
          ['bottom', 'Bottom'],
        ]),
        el('h4', {}, 'Fill & outline'),
        el(
          'div',
          { class: 'row' },
          field(
            'Fill',
            color(o.fill || th().accent, (v) => (o.fill = v)),
          ),
          el('label', { class: 'check' }, noFill, 'No fill'),
        ),
        el(
          'div',
          { class: 'grid2' },
          field(
            'Outline',
            color(o.stroke || '#000000', (v) => (o.stroke = v)),
          ),
          field(
            'Outline width',
            num(o.strokeW || 0, (v) => (o.strokeW = clamp(v, 0, 40))),
          ),
        ),
        field('Shape', shape),
      );
    }
    if (o.shape === 'line')
      props.append(
        el(
          'div',
          { class: 'grid2' },
          field(
            'Color',
            color(o.stroke || o.color, (v) => (o.stroke = v)),
          ),
          field(
            'Thickness',
            num(o.strokeW || 3, (v) => (o.strokeW = clamp(v, 1, 40))),
          ),
        ),
      );
    if (o.type === 'image')
      props.append(
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                const [f] = await pickFiles('image/*');
                if (!f) return;
                hist();
                o.src = Img.put(await readAs(f, 'url'));
                renderAll();
              },
            },
            'Replace image',
          ),
          el(
            'button',
            {
              class: 'btn ghost',
              onclick: async () => {
                const im = await loadImg(Img.get(o.src));
                hist();
                o.h = (o.w * im.height) / im.width;
                renderAll();
              },
            },
            'Reset aspect ratio',
          ),
        ),
      );
    props.append(
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', onclick: () => act('dupEl') }, 'Duplicate'),
        el('button', { class: 'btn', onclick: () => act('front') }, 'Front'),
        el('button', { class: 'btn', onclick: () => act('back') }, 'Back'),
        el('button', { class: 'btn danger', onclick: () => act('delEl') }, 'Delete'),
      ),
    );
  }

  /* --- actions --- */
  async function addImage() {
    const [f] = await pickFiles('image/*');
    if (!f) return;
    const src = await readAs(f, 'url');
    const im = await loadImg(src);
    let w = Math.min(im.width, deck.w * 0.6),
      h = (w * im.height) / im.width;
    if (h > deck.h * 0.8) {
      h = deck.h * 0.8;
      w = (h * im.width) / im.height;
    }
    hist();
    const o = {
      id: uid(),
      type: 'image',
      x: (deck.w - w) / 2,
      y: (deck.h - h) / 2,
      w,
      h,
      src: Img.put(src),
      opacity: 1,
      rot: 0,
    };
    slide().els.push(o);
    sel = o.id;
    renderStage();
    renderProps();
    changed();
  }
  function act(a) {
    const s = slide(),
      o = selEl();
    switch (a) {
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'dupSlide':
        hist();
        deck.slides.splice(cur + 1, 0, {
          ...JSON.parse(JSON.stringify(s)),
          id: uid(),
          els: s.els.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: uid() })),
        });
        cur++;
        renderAll();
        break;
      case 'delSlide':
        if (deck.slides.length < 2) return UI.toast('A presentation needs at least one slide.', true);
        hist();
        deck.slides.splice(cur, 1);
        sel = null;
        renderAll();
        break;
      case 'addText':
        hist();
        {
          const t = txt({
            x: deck.w / 2 - 200,
            y: deck.h / 2 - 30,
            w: 400,
            h: 60,
            text: 'New text',
            fontSize: 28,
          });
          s.els.push(t);
          sel = t.id;
        }
        renderStage();
        renderProps();
        changed();
        setTimeout(() => {
          const n = $(`.el[data-id="${sel}"]`, box);
          n && editText(n);
        }, 30);
        break;
      case 'addImage':
        return addImage();
      case 'dupEl':
        if (!o) return;
        hist();
        {
          const c = { ...JSON.parse(JSON.stringify(o)), id: uid(), x: o.x + 20, y: o.y + 20 };
          s.els.push(c);
          sel = c.id;
        }
        renderStage();
        renderProps();
        changed();
        break;
      case 'delEl':
        if (!o) return;
        hist();
        s.els = s.els.filter((x) => x !== o);
        sel = null;
        renderStage();
        renderProps();
        changed();
        break;
      case 'front':
        if (!o) return;
        hist();
        s.els = s.els.filter((x) => x !== o).concat(o);
        renderStage();
        changed();
        break;
      case 'back':
        if (!o) return;
        hist();
        s.els = [o, ...s.els.filter((x) => x !== o)];
        renderStage();
        changed();
        break;
      case 'present':
        return present();
      case 'new':
        return (async () => {
          if (
            !(await UI.confirm(
              'Start a new presentation?',
              'The current slides will be replaced. Export first if you want to keep them.',
              'New presentation',
            ))
          )
            return;
          deck = { w: 960, h: 540, theme: deck.theme, slides: [] };
          deck.slides.push(newSlide('title'));
          name = 'Untitled presentation';
          cur = 0;
          sel = null;
          undoS = [];
          renderAll();
        })();
      case 'open':
        return open();
      case 'example':
        return (async () => {
          if (!(await replaceOk(deck.slides.some((x) => x.els.length)))) return;
          sample();
          cur = 0;
          sel = null;
          undoS = [];
          redoS = [];
          renderAll();
        })();
      case 'pptx':
        return exportPptx();
      case 'pdf':
        return exportPdf();
      case 'png':
        return exportPng();
      case 'json':
        return saveFile(
          name + '.deck.json',
          JSON.stringify(deck, (k, v) => (k === 'src' || k === 'bgImage' ? Img.get(v) : v)),
          'application/json',
        ).then((ok) => savedWhole('slides', ok));
    }
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a],[data-l],[data-s],[data-al],[data-th]');
    if (!b) return;
    if (b.dataset.a) return act(b.dataset.a);
    if (b.dataset.l) {
      hist();
      deck.slides.splice(cur + 1, 0, newSlide(b.dataset.l));
      cur++;
      sel = null;
      renderAll();
      return;
    }
    if (b.dataset.s) {
      hist();
      const sh = b.dataset.s;
      const o =
        sh === 'line'
          ? txt({
              x: deck.w / 2 - 150,
              y: deck.h / 2,
              w: 300,
              h: 3,
              shape: 'line',
              stroke: th().accent,
              strokeW: 4,
            })
          : txt({
              x: deck.w / 2 - 110,
              y: deck.h / 2 - 80,
              w: 220,
              h: sh === 'ellipse' ? 220 : 160,
              shape: sh,
              fill: th().accent,
              align: 'center',
              valign: 'middle',
              color: '#ffffff',
              fontSize: 22,
            });
      slide().els.push(o);
      sel = o.id;
      renderStage();
      renderProps();
      changed();
      return;
    }
    if (b.dataset.al) {
      const o = selEl();
      if (!o) return UI.toast('Select an object first.', true);
      hist();
      const W = deck.w,
        H = deck.h;
      ({
        l: () => (o.x = 0),
        c: () => (o.x = (W - o.w) / 2),
        r: () => (o.x = W - o.w),
        t: () => (o.y = 0),
        m: () => (o.y = (H - o.h) / 2),
        b: () => (o.y = H - o.h),
      })[b.dataset.al]();
      renderStage();
      renderProps();
      changed();
      return;
    }
    if (b.dataset.th) {
      applyTheme(b.dataset.th);
    }
  });
  $('#slThemes').append(
    ...Object.entries(THEMES).map(([k, t]) =>
      el(
        'button',
        { 'data-th': k },
        el('span', {}, t.name),
        el(
          'span',
          { style: { display: 'inline-flex', gap: '3px' } },
          ...[t.bg, t.title, t.accent].map((c) =>
            el('span', {
              style: {
                width: '14px',
                height: '14px',
                borderRadius: '3px',
                background: c,
                border: '1px solid rgba(128,128,128,.4)',
              },
            }),
          ),
        ),
      ),
    ),
  );
  function applyTheme(k) {
    const old = th(),
      t = THEMES[k];
    if (!t) return;
    hist();
    deck.theme = k;
    deck.slides.forEach((s) => {
      if (!s.bgImage) s.bg = t.bg;
      s.els.forEach((o) => {
        if (o.type !== 'box') return;
        if (o.fill && o.fill.toLowerCase() === old.accent.toLowerCase()) o.fill = t.accent;
        if (o.stroke && o.stroke.toLowerCase() === old.accent.toLowerCase()) o.stroke = t.accent;
        if (!o.fill) o.color = o.bold || o.fontSize >= 34 ? t.title : t.text;
        if (o.font === old.font) o.font = t.font;
      });
    });
    renderAll();
    UI.toast(`Applied ${t.name} theme`);
  }

  /* --- present --- */
  function present(from = cur) {
    let i = from,
      notes = false;
    const ov = el('div', { class: 'present', tabindex: '0' });
    document.body.append(ov);
    const draw = () => {
      ov.innerHTML = '';
      const s = deck.slides[i];
      const k = Math.min(innerWidth / deck.w, innerHeight / deck.h);
      const c = renderSlide(s, false);
      Object.assign(c.style, { transform: `scale(${k})`, position: 'absolute', left: 0, top: 0, opacity: 0 });
      ov.append(
        el(
          'div',
          { style: { width: deck.w * k + 'px', height: deck.h * k + 'px', position: 'relative' } },
          c,
        ),
        el('div', { class: 'pinfo' }, `${i + 1} / ${deck.slides.length} · ← → move · N notes · Esc exit`),
      );
      if (notes && s.notes) ov.append(el('div', { class: 'pnotes' }, s.notes));
      requestAnimationFrame(() => (c.style.opacity = 1));
    };
    const close = () => {
      ov.remove();
      removeEventListener('keydown', key, true);
      removeEventListener('resize', draw);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      cur = i;
      renderAll();
    };
    const go = (d) => {
      const n = clamp(i + d, 0, deck.slides.length - 1);
      if (n !== i) {
        i = n;
        draw();
      }
    };
    const key = (e) => {
      e.stopPropagation();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Escape') close();
      else if (e.key.toLowerCase() === 'n') {
        notes = !notes;
        draw();
      } else if (e.key === 'Home') {
        i = 0;
        draw();
      } else if (e.key === 'End') {
        i = deck.slides.length - 1;
        draw();
      }
    };
    addEventListener('keydown', key, true);
    addEventListener('resize', draw);
    ov.onclick = (e) => go(e.clientX < innerWidth / 3 ? -1 : 1);
    document.addEventListener('fullscreenchange', function fc() {
      if (!document.fullscreenElement && ov.isConnected) {
        document.removeEventListener('fullscreenchange', fc);
        close();
      }
    });
    try {
      ov.requestFullscreen?.().catch(() => {});
    } catch {}
    draw();
    ov.focus();
  }

  /* --- export --- */
  const hx = (c) => toHex(c) || '000000';
  async function exportPptx() {
    if (!window.PptxGenJS)
      return UI.toast('The PowerPoint library did not load. Check your connection and reload.', true);
    const done = UI.busy('Building PowerPoint…');
    try {
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'FOLIO', width: deck.w / 96, height: deck.h / 96 });
      pptx.layout = 'FOLIO';
      pptx.title = name;
      pptx.company = 'Offline Office';
      const SH = {
        rect: pptx.ShapeType.rect,
        roundRect: pptx.ShapeType.roundRect,
        ellipse: pptx.ShapeType.ellipse,
        triangle: pptx.ShapeType.triangle,
      };
      for (const s of deck.slides) {
        const sl = pptx.addSlide();
        sl.background = s.bgImage ? { data: Img.get(s.bgImage) } : { color: hx(s.bg) };
        for (const o of s.els) {
          const pos = {
            x: o.x / 96,
            y: o.y / 96,
            w: Math.max(o.w, 1) / 96,
            h: Math.max(o.h, 1) / 96,
            rotate: o.rot || 0,
          };
          if (o.type === 'image') {
            sl.addImage({
              data: Img.get(o.src),
              ...pos,
              transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
            });
            continue;
          }
          if (o.shape === 'line') {
            sl.addShape(pptx.ShapeType.line, {
              ...pos,
              h: 0,
              line: { color: hx(o.stroke || o.color), width: (o.strokeW || 3) * 0.75 },
            });
            continue;
          }
          const tr = Math.round((1 - (o.opacity ?? 1)) * 100);
          const opts = {
            ...pos,
            shape: SH[o.shape] || SH.rect,
            fontFace: o.font,
            fontSize: Math.round(o.fontSize * 0.75 * 10) / 10,
            color: hx(o.color),
            bold: !!o.bold,
            italic: !!o.italic,
            align: o.align,
            valign: o.valign,
            margin: [7.5, 3.75, 7.5, 3.75],
          };
          if (o.underline) opts.underline = { style: 'sng' };
          if (o.fill) opts.fill = { color: hx(o.fill), transparency: tr };
          if (o.stroke && o.strokeW) opts.line = { color: hx(o.stroke), width: o.strokeW * 0.75 };
          sl.addText(o.text || '', opts);
        }
        if (s.notes) sl.addNotes(s.notes);
      }
      savedWhole('slides', await saveFile(name + '.pptx', await pptx.write({ outputType: 'blob' })));
    } catch (e) {
      console.error(e);
      UI.toast('PowerPoint export failed: ' + e.message, true);
    } finally {
      done();
    }
  }
  async function rasterize(s, k = 2) {
    const c = renderSlide(s, false);
    const holder = el('div', { style: { position: 'fixed', left: '-30000px', top: '0' } }, c);
    document.body.append(holder);
    try {
      return await html2canvas(c, { scale: k, useCORS: true, backgroundColor: null, logging: false });
    } finally {
      holder.remove();
    }
  }
  async function exportPdf() {
    const done = UI.busy('Rendering slides…');
    try {
      const d = await PDFLib.PDFDocument.create();
      d.setTitle(name);
      for (const s of deck.slides) {
        const cv = await rasterize(s);
        const im = await d.embedPng(dataURLtoBytes(cv.toDataURL('image/png')));
        const pg = d.addPage([deck.w * 0.75, deck.h * 0.75]);
        pg.drawImage(im, { x: 0, y: 0, width: deck.w * 0.75, height: deck.h * 0.75 });
      }
      savedWhole(
        'slides',
        await saveFile(name + '.pdf', new Blob([await d.save()], { type: 'application/pdf' })),
      );
    } catch (e) {
      console.error(e);
      UI.toast('PDF export failed: ' + e.message, true);
    } finally {
      done();
    }
  }
  async function exportPng() {
    const done = UI.busy('Rendering slide…');
    try {
      const cv = await rasterize(slide());
      await saveFile(`${name}-slide-${cur + 1}.png`, await new Promise((r) => cv.toBlob(r, 'image/png')));
    } finally {
      done();
    }
  }

  /* --- PPTX import --- */
  async function importPptx(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const X = async (p) => {
      const f = zip.file(p);
      return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
    };
    const kids = (n, t) => (n ? [...n.children].filter((c) => c.tagName === t) : []);
    const kid = (n, t) => kids(n, t)[0] || null;
    const desc = (n, t) => (n ? n.getElementsByTagName(t)[0] || null : null);
    const resolve = (dir, t) => {
      if (t.startsWith('/')) return t.slice(1);
      const parts = dir.split('/');
      for (const seg of t.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
      }
      return parts.join('/');
    };
    const relsOf = async (path) => {
      const dir = path.slice(0, path.lastIndexOf('/'));
      const f = path.slice(path.lastIndexOf('/') + 1);
      const x = await X(dir + '/_rels/' + f + '.rels');
      const m = {};
      if (x)
        for (const r of x.getElementsByTagName('Relationship'))
          m[r.getAttribute('Id')] = {
            target: resolve(dir, r.getAttribute('Target')),
            type: r.getAttribute('Type') || '',
            external: r.getAttribute('TargetMode') === 'External',
          };
      return m;
    };
    const pres = await X('ppt/presentation.xml');
    if (!pres) throw new Error('not a valid .pptx file');
    const sz = desc(pres, 'p:sldSz');
    const cx = +(sz?.getAttribute('cx') || 12192000),
      cy = +(sz?.getAttribute('cy') || 6858000);
    const W = 960,
      k = W / cx,
      H = Math.round(cy * k);
    const ptPx = 12700 * k;
    const prels = await relsOf('ppt/presentation.xml');
    const theme = {};
    const fonts = { major: 'Arial', minor: 'Arial' };
    const thr = Object.values(prels).find((r) => r.type.endsWith('/theme'));
    if (thr) {
      const tx = await X(thr.target);
      const cs = desc(tx, 'a:clrScheme');
      if (cs)
        for (const c of cs.children) {
          const s = desc(c, 'a:srgbClr'),
            y = desc(c, 'a:sysClr');
          theme[c.tagName.replace('a:', '')] = s
            ? s.getAttribute('val')
            : y
              ? y.getAttribute('lastClr') || '000000'
              : null;
        }
      const mj = desc(desc(tx, 'a:majorFont'), 'a:latin'),
        mn = desc(desc(tx, 'a:minorFont'), 'a:latin');
      if (mj) fonts.major = mj.getAttribute('typeface') || 'Arial';
      if (mn) fonts.minor = mn.getAttribute('typeface') || 'Arial';
    }
    const MAP = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    const clr = (n) => {
      if (!n) return null;
      const s = desc(n, 'a:srgbClr');
      if (s) return '#' + s.getAttribute('val');
      const sc = desc(n, 'a:schemeClr');
      if (sc) {
        const v = theme[MAP[sc.getAttribute('val')] || sc.getAttribute('val')];
        return v ? '#' + v : null;
      }
      const y = desc(n, 'a:sysClr');
      if (y) return '#' + (y.getAttribute('lastClr') || '000000');
      const p = desc(n, 'a:prstClr');
      if (p) return p.getAttribute('val');
      return null;
    };
    const fillOf = (sp) => {
      if (!sp) return undefined;
      if (kid(sp, 'a:noFill')) return '';
      const sf = kid(sp, 'a:solidFill');
      if (sf) return clr(sf);
      const gf = kid(sp, 'a:gradFill');
      if (gf) return clr(desc(gf, 'a:gs'));
      return undefined;
    };
    const media = async (target) => {
      const f = zip.file(target);
      if (!f) return null;
      const e = ext(target);
      const mime = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        webp: 'image/webp',
      }[e];
      if (!mime) return null;
      return `data:${mime};base64,` + (await f.async('base64'));
    };
    const xf = (x, T) => {
      if (!x) return null;
      const off = kid(x, 'a:off'),
        e = kid(x, 'a:ext');
      if (!off || !e) return null;
      return T(
        [+off.getAttribute('x'), +off.getAttribute('y'), +e.getAttribute('cx'), +e.getAttribute('cy')],
        +(x.getAttribute('rot') || 0) / 60000,
      );
    };
    const ID = ([x, y, w, h], r) => ({ x: x * k, y: y * k, w: w * k, h: h * k, rot: r });
    const phMap = async (path) => {
      const m = {};
      if (!path) return m;
      const x = await X(path);
      if (!x) return m;
      for (const sp of x.getElementsByTagName('p:sp')) {
        const ph = desc(sp, 'p:ph');
        if (!ph) continue;
        const g = xf(desc(kid(sp, 'p:spPr'), 'a:xfrm'), ID);
        if (!g) continue;
        const t = ph.getAttribute('type') || 'body',
          i = ph.getAttribute('idx');
        const lst = desc(desc(sp, 'p:txBody'), 'a:lvl1pPr');
        const dr = desc(lst, 'a:defRPr');
        const info = { ...g, sz: dr?.getAttribute('sz'), color: clr(kid(dr, 'a:solidFill')) };
        if (i && !m['i' + i]) m['i' + i] = info;
        if (!m['t' + t]) m['t' + t] = info;
      }
      return m;
    };
    const bgOf = async (x, rels) => {
      const bg = desc(x, 'p:bg');
      if (!bg) return null;
      const pr = kid(bg, 'p:bgPr');
      if (pr) {
        const bl = desc(pr, 'a:blip');
        if (bl && rels[bl.getAttribute('r:embed')])
          return { img: await media(rels[bl.getAttribute('r:embed')].target) };
        const f = fillOf(pr);
        if (f) return { color: f };
      }
      const ref = kid(bg, 'p:bgRef');
      if (ref) {
        const c = clr(ref);
        if (c) return { color: c };
      }
      return null;
    };
    const slides = [];
    for (const sid of pres.getElementsByTagName('p:sldId')) {
      const rel = prels[sid.getAttribute('r:id')];
      if (!rel) continue;
      const sx = await X(rel.target);
      if (!sx) continue;
      const srels = await relsOf(rel.target);
      const lay = Object.values(srels).find((r) => r.type.endsWith('/slideLayout'));
      const lrels = lay ? await relsOf(lay.target) : {};
      const mas = Object.values(lrels).find((r) => r.type.endsWith('/slideMaster'));
      const lph = await phMap(lay?.target),
        mph = await phMap(mas?.target);
      const s = { id: uid(), bg: '#ffffff', bgImage: '', notes: '', els: [] };
      const bg =
        (await bgOf(sx, srels)) ||
        (lay && (await bgOf(await X(lay.target), lrels))) ||
        (mas && (await bgOf(await X(mas.target), await relsOf(mas.target))));
      if (bg?.img) s.bgImage = bg.img;
      else if (bg?.color) s.bg = bg.color;
      const walk = async (tree, T) => {
        for (const n of tree.children) {
          const tag = n.tagName;
          if (tag === 'p:grpSp') {
            const gx = desc(kid(n, 'p:grpSpPr'), 'a:xfrm');
            const off = kid(gx, 'a:off'),
              e = kid(gx, 'a:ext'),
              co = kid(gx, 'a:chOff'),
              ce = kid(gx, 'a:chExt');
            if (off && e && co && ce) {
              const [ox, oy, ex, ey, cox, coy, cex, cey] = [
                off.getAttribute('x'),
                off.getAttribute('y'),
                e.getAttribute('cx'),
                e.getAttribute('cy'),
                co.getAttribute('x'),
                co.getAttribute('y'),
                ce.getAttribute('cx'),
                ce.getAttribute('cy'),
              ].map(Number);
              const sxk = cex ? ex / cex : 1,
                syk = cey ? ey / cey : 1;
              await walk(n, ([x, y, w, h], r) =>
                T([ox + (x - cox) * sxk, oy + (y - coy) * syk, w * sxk, h * syk], r),
              );
            } else await walk(n, T);
          } else if (tag === 'p:sp' || tag === 'p:cxnSp') {
            const spPr = kid(n, 'p:spPr');
            const ph = desc(kid(n, tag === 'p:sp' ? 'p:nvSpPr' : 'p:nvCxnSpPr'), 'p:ph');
            const phType = ph ? ph.getAttribute('type') || 'body' : null;
            const phIdx = ph?.getAttribute('idx');
            let g = xf(desc(spPr, 'a:xfrm'), T);
            const inh = ph
              ? lph['i' + phIdx] ||
                lph['t' + phType] ||
                mph['t' + phType] ||
                mph['t' + (phType === 'ctrTitle' ? 'title' : phType === 'subTitle' ? 'body' : phType)]
              : null;
            if (!g && inh) g = { ...inh };
            if (!g) {
              if (!ph) continue;
              g = phType.includes('itle')
                ? { x: 60, y: 30, w: W - 120, h: 100, rot: 0 }
                : { x: 60, y: 150, w: W - 120, h: H - 200, rot: 0 };
            }
            const prst = desc(spPr, 'a:prstGeom')?.getAttribute('prst') || 'rect';
            const style = kid(n, 'p:style');
            let fill = fillOf(spPr);
            if (fill === undefined)
              fill =
                style && desc(style, 'a:fillRef')?.getAttribute('idx') !== '0'
                  ? clr(desc(style, 'a:fillRef')) || ''
                  : '';
            const ln = kid(spPr, 'a:ln');
            let stroke = '',
              strokeW = 0;
            if (ln && !kid(ln, 'a:noFill')) {
              stroke = clr(kid(ln, 'a:solidFill')) || '';
              strokeW = (+ln.getAttribute('w') || 12700) * k;
            }
            if (!ln && style && desc(style, 'a:lnRef')?.getAttribute('idx') !== '0') {
              stroke = clr(desc(style, 'a:lnRef')) || '';
              strokeW = stroke ? 12700 * k : 0;
            }
            if (tag === 'p:cxnSp' || prst === 'line' || prst.includes('Connector')) {
              s.els.push(
                txt({
                  ...g,
                  h: Math.max(1, g.h),
                  shape: 'line',
                  stroke: stroke || '#000000',
                  strokeW: Math.max(1, strokeW),
                  fill: '',
                  text: '',
                }),
              );
              continue;
            }
            const tb = kid(n, 'p:txBody');
            let text = '',
              fr = {},
              algn = null;
            const isTitle = phType && phType.includes('itle') && phType !== 'subTitle';
            const bodyPh =
              phType === 'body' ||
              (ph &&
                !phType.includes('itle') &&
                phType !== 'subTitle' &&
                !['sldNum', 'dt', 'ftr'].includes(phType));
            if (tb) {
              const lines = [];
              for (const p of kids(tb, 'a:p')) {
                const pPr = kid(p, 'a:pPr');
                if (!algn && pPr?.getAttribute('algn')) algn = pPr.getAttribute('algn');
                let t = '';
                for (const c of p.children) {
                  if (c.tagName === 'a:r' || c.tagName === 'a:fld') {
                    const r = kid(c, 'a:rPr');
                    if (r && !fr.got) {
                      fr = {
                        got: 1,
                        sz: r.getAttribute('sz'),
                        b: r.getAttribute('b') === '1',
                        i: r.getAttribute('i') === '1',
                        u: !!r.getAttribute('u') && r.getAttribute('u') !== 'none',
                        color: clr(kid(r, 'a:solidFill')),
                        font: kid(r, 'a:latin')?.getAttribute('typeface'),
                      };
                    }
                    t += desc(c, 'a:t')?.textContent || '';
                  } else if (c.tagName === 'a:br') t += '\n';
                }
                const bu = pPr && kid(pPr, 'a:buChar');
                const lvl = +(pPr?.getAttribute('lvl') || 0);
                const bullet =
                  t.trim() && !(pPr && kid(pPr, 'a:buNone')) && (bu || bodyPh)
                    ? '  '.repeat(lvl) + (bu ? bu.getAttribute('char') : '•') + ' '
                    : '';
                lines.push(bullet + t);
              }
              text = lines.join('\n').replace(/\n+$/, '');
              if (!fr.sz)
                fr.sz =
                  desc(tb, 'a:endParaRPr')?.getAttribute('sz') || desc(tb, 'a:defRPr')?.getAttribute('sz');
            }
            if (!text && !fill && !stroke && ph) continue; // empty placeholder
            const bodyPr = tb && kid(tb, 'a:bodyPr');
            const scaleF = +(desc(bodyPr, 'a:normAutofit')?.getAttribute('fontScale') || 100000) / 100000;
            const pt =
              (fr.sz
                ? +fr.sz / 100
                : inh?.sz
                  ? +inh.sz / 100
                  : isTitle
                    ? phType === 'ctrTitle'
                      ? 54
                      : 40
                    : phType === 'subTitle'
                      ? 24
                      : bodyPh
                        ? 24
                        : 18) * scaleF;
            let font = fr.font || (isTitle ? fonts.major : fonts.minor);
            if (font === '+mj-lt') font = fonts.major;
            if (font === '+mn-lt') font = fonts.minor;
            const anchor =
              bodyPr?.getAttribute('anchor') ||
              (phType === 'ctrTitle' ? 'b' : isTitle ? 'ctr' : prst !== 'rect' || fill ? 'ctr' : 't');
            const fontRefColor = style ? clr(desc(style, 'a:fontRef')) : null;
            const tcolor =
              fr.color || inh?.color || fontRefColor || (fill ? '#ffffff' : '#' + (theme.dk1 || '000000'));
            s.els.push(
              txt({
                ...g,
                text,
                fontSize: Math.round(pt * ptPx * 10) / 10,
                color: tcolor,
                bold: fr.b || false,
                italic: fr.i || false,
                underline: fr.u || false,
                align:
                  { ctr: 'center', r: 'right', just: 'justify' }[algn] ||
                  (phType === 'ctrTitle' || phType === 'subTitle' ? 'center' : 'left'),
                valign: { ctr: 'middle', b: 'bottom' }[anchor] || 'top',
                font,
                fill: fill || '',
                stroke,
                strokeW,
                shape:
                  {
                    ellipse: 'ellipse',
                    roundRect: 'roundRect',
                    triangle: 'triangle',
                    flowChartConnector: 'ellipse',
                  }[prst] || 'rect',
              }),
            );
          } else if (tag === 'p:pic') {
            const g = xf(desc(kid(n, 'p:spPr'), 'a:xfrm'), T);
            const bl = desc(n, 'a:blip');
            const r = bl && srels[bl.getAttribute('r:embed')];
            if (g && r && !r.external) {
              const src = await media(r.target);
              if (src) s.els.push({ id: uid(), type: 'image', ...g, src, opacity: 1 });
              else
                s.els.push(
                  txt({
                    ...g,
                    text: '[Unsupported image format]',
                    fill: '#eeeeee',
                    color: '#666666',
                    fontSize: 14,
                    align: 'center',
                    valign: 'middle',
                  }),
                );
            }
          } else if (tag === 'p:graphicFrame') {
            const gx = kid(n, 'p:xfrm');
            const g = gx && xf(gx, T);
            if (!g) continue;
            const tbl = desc(n, 'a:tbl');
            if (tbl) {
              const rows = [...tbl.getElementsByTagName('a:tr')].map((tr) =>
                [...tr.getElementsByTagName('a:tc')]
                  .map((tc) => [...tc.getElementsByTagName('a:t')].map((t) => t.textContent).join(' '))
                  .join('   |   '),
              );
              s.els.push(
                txt({
                  ...g,
                  text: rows.join('\n'),
                  fontSize: 16,
                  color: '#' + (theme.dk1 || '000000'),
                  stroke: '#999999',
                  strokeW: 1,
                }),
              );
            } else
              s.els.push(
                txt({
                  ...g,
                  text: 'Chart or diagram (view only in PowerPoint)',
                  fill: '#f1f3f5',
                  color: '#5b6672',
                  fontSize: 16,
                  align: 'center',
                  valign: 'middle',
                }),
              );
          }
        }
      };
      const tree = desc(sx, 'p:spTree');
      if (tree) await walk(tree, ID);
      const nr = Object.values(srels).find((r) => r.type.endsWith('/notesSlide'));
      if (nr) {
        const nx = await X(nr.target);
        if (nx)
          for (const sp of nx.getElementsByTagName('p:sp')) {
            const ph = desc(sp, 'p:ph');
            if (ph && ph.getAttribute('type') === 'body')
              s.notes = kids(desc(sp, 'p:txBody'), 'a:p')
                .map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join(''))
                .join('\n')
                .trim();
          }
      }
      slides.push(s);
    }
    if (!slides.length) throw new Error('no slides found');
    deck = { w: W, h: H, theme: 'paper', slides };
  }
  async function load(file) {
    const e = ext(file.name);
    if (e === 'json') {
      const d = JSON.parse(await readAs(file, 'text'));
      if (!d.slides) throw new Error('not an Offline Office presentation');
      deck = d;
    } else if (e === 'ppt' || e === 'pps' || e === 'pot') {
      deck = Formats.pptToDeck(await file.arrayBuffer());
      UI.toast('Old .ppt files keep slide text only; pictures and layout are not imported.');
    } else if (e === 'odp' || e === 'otp') deck = await Formats.odpToDeck(await file.arrayBuffer());
    else await importPptx(file);
    deck.slides.forEach((s) => {
      s.bgImage = Img.put(s.bgImage);
      s.els.forEach((o) => o.src && (o.src = Img.put(o.src)));
    });
    name = base(file.name).replace(/\.(deck|folio)$/, '');
    cur = 0;
    sel = null;
    undoS = [];
    redoS = [];
    booted = true;
    renderAll();
    UI.toast(`Opened ${deck.slides.length} slide${deck.slides.length > 1 ? 's' : ''}`);
  }
  async function open() {
    const [f] = await pickFiles('.pptx,.pptm,.ppsx,.potx,.ppt,.pps,.odp,.key,.json');
    if (f) {
      if (ext(f.name) === 'json') {
        const d = UI.busy('Opening…');
        try {
          await load(f);
          show('slides');
        } catch (e) {
          UI.toast(e.message, true);
        } finally {
          d();
        }
      } else openFile(f);
    }
  }

  function sample() {
    deck = { w: 960, h: 540, theme: 'harbor', slides: [] };
    const t = THEMES.harbor;
    const s1 = newSlide('title');
    s1.els[0].text = 'Season kickoff';
    s1.els[1].text = 'Harbor Street Community Garden · March 2026';
    s1.notes = 'Example deck. Edit it, or open your own .pptx from the File menu.';
    const s2 = newSlide('content');
    s2.els[0].text = 'What we are doing this season';
    s2.els[1].text =
      '• Assign all 42 raised beds by 15 March\n• Install two rain barrels\n• Four open days with the primary school\n• Autumn harvest market in October';
    const s3 = newSlide('two');
    s3.els[0].text = 'Budget at a glance';
    s3.els[1].text = 'Spending\n• Compost: $620\n• Rain barrels: $340\n• Hand tools: $280';
    s3.els[2].text = 'Funding\n• Plot fees: $1,260\n• Council grant: $500\n• Bake sale: $90';
    s3.els.push(
      txt({
        x: 64,
        y: 440,
        w: 832,
        h: 56,
        text: 'Total budget  $1,850',
        fill: t.accent,
        color: '#0f3b57',
        bold: true,
        fontSize: 24,
        align: 'center',
        valign: 'middle',
        shape: 'roundRect',
      }),
    );
    const s4 = newSlide('section');
    s4.els[1].text = 'Questions?';
    s4.els[2].text = 'Sign-up sheet is by the tool shed door';
    deck.slides = [s1, s2, s3, s4];
    name = 'Season kickoff (example)';
  }
  return {
    load,
    act,
    open,
    save: exportPptx,
    onShow() {
      if (!booted) {
        booted = true;
        deck = { w: 960, h: 540, theme: 'paper', slides: [] };
        deck.slides.push(newSlide('blank'));
        name = 'Untitled presentation';
      }
      requestAnimationFrame(renderAll);
    },
  };
})();
