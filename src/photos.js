'use strict';
/* ============================== PHOTO EDITOR ============================== */
Mods.image = (() => {
  const cv = $('#imCanvas'),
    pv = $('#imPv'),
    ov = $('#imOv'),
    lay = $('#imLayers');
  const ctx = cv.getContext('2d', { willReadFrequently: true }),
    octx = ov.getContext('2d');
  let name = 'image',
    tool = 'none',
    undoS = [],
    redoS = [],
    crop = null,
    origBytes = 0,
    origType = '',
    booted = false;
  let layers = [],
    selL = null,
    restoreSrc = null,
    original = null,
    proxy = null,
    straighten = 0;
  const ADJ = [
    [
      'Light',
      [
        ['exposure', 'Exposure'],
        ['contrast', 'Contrast'],
        ['highlights', 'Highlights'],
        ['shadows', 'Shadows'],
      ],
    ],
    [
      'Color',
      [
        ['temperature', 'Temperature'],
        ['tint', 'Tint'],
        ['saturation', 'Saturation'],
        ['vibrance', 'Vibrance'],
        ['hue', 'Hue', -180, 180],
      ],
    ],
    [
      'Detail & effects',
      [
        ['clarity', 'Clarity'],
        ['sharpen', 'Sharpen', 0, 100],
        ['blur', 'Blur', 0, 30],
        ['vignette', 'Vignette', 0, 100],
        ['grain', 'Grain', 0, 100],
        ['grayscale', 'Black & white', 0, 100],
        ['sepia', 'Sepia', 0, 100],
      ],
    ],
  ];
  const KEYS = ADJ.flatMap((g) => g[1]);
  const adj = {};
  KEYS.forEach(([k]) => (adj[k] = 0));
  const ZERO = Object.fromEntries(KEYS.map(([k]) => [k, 0]));
  const PRESETS = {
    Original: {},
    Vivid: { saturation: 30, vibrance: 30, contrast: 15, clarity: 15 },
    Punch: { contrast: 30, clarity: 35, vibrance: 35, sharpen: 30 },
    Warm: { temperature: 35, vibrance: 15, shadows: 10 },
    Cool: { temperature: -30, tint: -5, exposure: 5 },
    Mono: { grayscale: 100, contrast: 20, clarity: 20 },
    Noir: { grayscale: 100, contrast: 55, exposure: -10, vignette: 50 },
    Vintage: { sepia: 45, contrast: -15, exposure: 5, saturation: -20, vignette: 35, grain: 25 },
    Fade: { contrast: -25, shadows: 30, saturation: -25, exposure: 8 },
    Film: { temperature: 12, contrast: -8, shadows: 15, grain: 35, vibrance: -10, vignette: 20 },
  };
  const FONTS = [
    'Bricolage Grotesque',
    'IBM Plex Sans',
    'Anton',
    'Bebas Neue',
    'Playfair Display',
    'Pacifico',
    'Permanent Marker',
    'Caveat',
    'Dancing Script',
    'IBM Plex Mono',
    'Georgia',
    'Impact',
    'Arial',
  ];
  const isNeutral = () => KEYS.every(([k]) => !adj[k]);
  const newCanvas = (w, h) =>
    el('canvas', { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
  const copyCanvas = (src = cv) => {
    const c = newCanvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  };
  const lw = () => +$('#imSize').value * Math.max(1, cv.width / 1200);

  /* --- pixel helpers --- */
  function blurPlane(src, w, h, r) {
    // three box passes ≈ gaussian
    r = Math.max(1, Math.round(r));
    const a = Float32Array.from(src),
      b = new Float32Array(a.length),
      d = 2 * r + 1;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++) {
        const o = y * w;
        let s = 0;
        for (let i = -r; i <= r; i++) s += a[o + clamp(i, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          b[o + x] = s / d;
          s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) s += b[clamp(i, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          a[y * w + x] = s / d;
          s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
        }
      }
    }
    return a;
  }
  function lumaSharpen(d, w, h, amount, radius) {
    const n = w * h,
      Y = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) Y[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    const B = blurPlane(Y, w, h, radius);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = (Y[i] - B[i]) * amount;
      d[j] += v;
      d[j + 1] += v;
      d[j + 2] += v;
    }
  }
  function blurRGBA(d, w, h, r) {
    const n = w * h,
      P = new Float32Array(n);
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < n; i++) P[i] = d[i * 4 + ch];
      const B = blurPlane(P, w, h, r);
      for (let i = 0; i < n; i++) d[i * 4 + ch] = B[i];
    }
  }
  function hueMatrix(deg) {
    const a = (deg * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    return [
      0.213 + c * 0.787 - s * 0.213,
      0.715 - c * 0.715 - s * 0.715,
      0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143,
      0.715 + c * 0.285 + s * 0.14,
      0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787,
      0.715 - c * 0.715 + s * 0.715,
      0.072 + c * 0.928 + s * 0.072,
    ];
  }
  function process(src, a, scale = 1) {
    const w = src.width,
      h = src.height,
      c = copyCanvas(src),
      g = c.getContext('2d');
    const id = g.getImageData(0, 0, w, h),
      d = id.data;
    const exp = 2 ** (a.exposure / 60),
      con = 1 + a.contrast / 100,
      sat = 1 + a.saturation / 100,
      vib = a.vibrance / 100,
      temp = a.temperature * 0.35,
      tint = a.tint * 0.3,
      sh = a.shadows / 100,
      hl = a.highlights / 100,
      gray = a.grayscale / 100,
      sep = a.sepia / 100,
      vig = a.vignette / 100,
      grain = a.grain * 0.6;
    const hm = a.hue ? hueMatrix(a.hue) : null;
    const cx = w / 2,
      cy = h / 2,
      maxd = Math.hypot(cx, cy);
    if (
      exp !== 1 ||
      con !== 1 ||
      sat !== 1 ||
      vib ||
      temp ||
      tint ||
      sh ||
      hl ||
      gray ||
      sep ||
      vig ||
      grain ||
      hm
    )
      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        for (let x = 0; x < w; x++) {
          const j = (y * w + x) * 4;
          let r = d[j],
            gg = d[j + 1],
            b = d[j + 2];
          r *= exp;
          gg *= exp;
          b *= exp;
          r += temp;
          b -= temp;
          gg -= tint;
          if (con !== 1) {
            r = (r - 128) * con + 128;
            gg = (gg - 128) * con + 128;
            b = (b - 128) * con + 128;
          }
          if (sh || hl) {
            const l = clamp((0.299 * r + 0.587 * gg + 0.114 * b) / 255, 0, 1);
            const dd = (sh * (1 - l) * (1 - l) * 0.6 + hl * l * l * 0.6) * 255;
            r += dd;
            gg += dd;
            b += dd;
          }
          if (sat !== 1 || vib) {
            const L = 0.299 * r + 0.587 * gg + 0.114 * b,
              mx = Math.max(r, gg, b),
              mn = Math.min(r, gg, b);
            const s0 = mx > 0 ? (mx - mn) / Math.max(mx, 1) : 0;
            const f = sat * (1 + vib * (1 - s0));
            r = L + (r - L) * f;
            gg = L + (gg - L) * f;
            b = L + (b - L) * f;
          }
          if (hm) {
            const R = r,
              G = gg,
              B = b;
            r = hm[0] * R + hm[1] * G + hm[2] * B;
            gg = hm[3] * R + hm[4] * G + hm[5] * B;
            b = hm[6] * R + hm[7] * G + hm[8] * B;
          }
          if (sep) {
            const R = r,
              G = gg,
              B = b;
            r += (R * 0.393 + G * 0.769 + B * 0.189 - R) * sep;
            gg += (R * 0.349 + G * 0.686 + B * 0.168 - G) * sep;
            b += (R * 0.272 + G * 0.534 + B * 0.131 - B) * sep;
          }
          if (gray) {
            const L = 0.299 * r + 0.587 * gg + 0.114 * b;
            r += (L - r) * gray;
            gg += (L - gg) * gray;
            b += (L - b) * gray;
          }
          if (vig) {
            const t = Math.hypot(x - cx, dy) / maxd;
            const f = 1 - vig * Math.max(0, (t - 0.3) / 0.7) ** 1.6 * 0.85;
            r *= f;
            gg *= f;
            b *= f;
          }
          if (grain) {
            const nn = (Math.random() - 0.5) * grain;
            r += nn;
            gg += nn;
            b += nn;
          }
          d[j] = r;
          d[j + 1] = gg;
          d[j + 2] = b;
        }
      }
    if (a.blur) blurRGBA(d, w, h, a.blur * scale * 0.6);
    if (a.clarity) lumaSharpen(d, w, h, (a.clarity / 100) * 0.8, Math.max(2, 18 * scale));
    if (a.sharpen) lumaSharpen(d, w, h, (a.sharpen / 100) * 1.6, Math.max(1, 1.2 * scale));
    g.putImageData(id, 0, 0);
    return c;
  }
  function drawStraight(g, src, deg) {
    const w = src.width,
      h = src.height,
      t = (deg * Math.PI) / 180,
      c = Math.abs(Math.cos(t)),
      s = Math.abs(Math.sin(t));
    const k = Math.max((w * c + h * s) / w, (w * s + h * c) / h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(t);
    g.scale(k, k);
    g.drawImage(src, -w / 2, -h / 2);
    g.restore();
    return k;
  }

  /* --- preview, history, info --- */
  function getProxy() {
    if (proxy) return proxy;
    const k = Math.min(1, 1100 / Math.max(cv.width, cv.height));
    const c = newCanvas(cv.width * k, cv.height * k);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cv, 0, 0, c.width, c.height);
    proxy = { c, k };
    return proxy;
  }
  let raf = 0;
  function preview() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (isNeutral() && !straighten) {
        pv.hidden = true;
        return;
      }
      const { c, k } = getProxy();
      const out = isNeutral() ? c : process(c, adj, k);
      pv.width = out.width;
      pv.height = out.height;
      const g = pv.getContext('2d');
      g.clearRect(0, 0, pv.width, pv.height);
      if (straighten) drawStraight(g, out, straighten);
      else g.drawImage(out, 0, 0);
      pv.hidden = false;
    });
  }
  function dirty() {
    proxy = null;
    info();
    renderLayers();
    preview();
  }
  const snap = () => ({ c: copyCanvas(), L: JSON.stringify(layers) });
  function push() {
    unsaved.add('image');
    undoS.push(snap());
    // Each step is a full pixel copy: keep about 60 megapixels of history (20 steps at 3 MP, 5 at 12 MP).
    const keep = clamp(Math.floor(6e7 / (cv.width * cv.height)), 3, 20);
    while (undoS.length > keep) undoS.shift();
    redoS = [];
  }
  function restoreSnap(s) {
    cv.width = ov.width = s.c.width;
    cv.height = ov.height = s.c.height;
    ctx.drawImage(s.c, 0, 0);
    layers = JSON.parse(s.L);
    selL = null;
    dirty();
    renderTextPanel();
  }
  function undo() {
    if (!undoS.length) return;
    redoS.push(snap());
    restoreSnap(undoS.pop());
  }
  function redo() {
    if (!redoS.length) return;
    undoS.push(snap());
    restoreSnap(redoS.pop());
  }
  const HINTS = {
    none: 'Click text to select it, drag to move, double-click to edit',
    crop: 'Drag to choose the area, then Apply crop',
    text: 'Click on the photo to add text',
    brush: 'Drag to paint',
    erase: 'Drag to erase to transparency',
    restore: 'Drag to paint the original back in',
    wand: 'Click a color area to make it transparent',
    rect: 'Drag to draw a box',
    ellipse: 'Drag to draw an oval',
    line: 'Drag to draw a line',
    arrow: 'Drag to draw an arrow',
    pixelate: 'Drag over an area to pixelate it',
    blur: 'Drag over an area to blur it',
    pick: 'Click to pick a color',
  };
  function info() {
    let alpha = false;
    if (cv.width && cv.width * cv.height < 4e6) {
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 16)
        if (d[i] < 250) {
          alpha = true;
          break;
        }
    }
    $('#imInfo').innerHTML =
      `<span>${cv.width} × ${cv.height} px · ${((cv.width * cv.height) / 1e6).toFixed(1)} MP</span>${alpha ? '<span>Has transparency: save as PNG or WebP to keep it</span>' : ''}${origBytes ? `<span>Original: ${(origBytes / 1024).toFixed(0)} KB ${esc(origType)}</span>` : ''}`;
    $('#imStatus').innerHTML =
      `<span><b>${esc(name)}</b></span><span>${cv.width} × ${cv.height}</span>${layers.length ? `<span>${layers.length} text layer${layers.length > 1 ? 's' : ''}</span>` : ''}<span>${HINTS[tool]}</span>`;
  }
  let hasImage = false;
  $('#imEmpty').append(
    emptyState(
      'fImg',
      'No photo open',
      'Open a photo or drop one here. JPG, PNG, HEIC, TIFF, WebP and more.',
      [
        ['Open photo…', () => act('open'), true],
        ['New blank canvas', () => act('newImg')],
        ['Load example', () => act('example')],
      ],
    ),
  );
  function setImage(src) {
    hasImage = true;
    $('#imDesk').classList.remove('is-empty');
    $('#imEmpty').hidden = true;
    $('#imStack').hidden = false;
    cv.width = ov.width = src.width;
    cv.height = ov.height = src.height;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, 0, 0);
    original = copyCanvas();
    undoS = [];
    redoS = [];
    layers = [];
    selL = null;
    restoreSrc = null;
    resetAdj();
    resetStraight();
    renderTextPanel();
    dirty();
  }

  /* --- adjust UI --- */
  $('#imRanges').append(
    ...ADJ.flatMap(([grp, items]) => [
      el('span', { class: 'grp' }, grp),
      ...items.map(([k, l, mn = -100, mx = 100]) => {
        const i = el('input', { type: 'range', id: 'im_' + k, min: mn, max: mx, value: 0 });
        const o = el('output', {}, '0');
        i.oninput = () => {
          adj[k] = +i.value;
          o.textContent = i.value;
          preview();
        };
        i.ondblclick = () => {
          adj[k] = 0;
          syncRanges();
          preview();
        };
        return el('div', { class: 'range' }, el('label', { for: 'im_' + k }, l), i, o);
      }),
    ]),
  );
  $('#imPresets').append(
    ...Object.entries(PRESETS).map(([n, p]) =>
      el(
        'button',
        {
          class: 'btn',
          onclick: () => {
            KEYS.forEach(([k]) => (adj[k] = p[k] || 0));
            syncRanges();
            preview();
          },
        },
        n,
      ),
    ),
  );
  function syncRanges() {
    KEYS.forEach(([k]) => {
      $('#im_' + k).value = adj[k];
      $('#im_' + k).nextElementSibling.textContent = adj[k];
    });
  }
  function resetAdj() {
    KEYS.forEach(([k]) => (adj[k] = 0));
    syncRanges();
    preview();
  }
  [
    ['bgTol', ''],
    ['bgSoft', ''],
    ['imStraight', '°'],
  ].forEach(([id, u]) => {
    const i = $('#' + id);
    i.addEventListener('input', () => {
      i.nextElementSibling.textContent = i.value + u;
      if (id === 'imStraight') {
        straighten = +i.value;
        preview();
      }
    });
  });
  function resetStraight() {
    straighten = 0;
    $('#imStraight').value = 0;
    $('#imStraight').nextElementSibling.textContent = '0°';
    preview();
  }

  async function busy(label, fn, toast) {
    const done = UI.busy(label);
    await sleep(40);
    try {
      await fn();
      dirty();
      if (toast) UI.toast(toast);
    } catch (e) {
      console.error(e);
      UI.toast(label.replace('…', '') + ' failed: ' + e.message, true);
    } finally {
      done();
    }
  }
  async function applyAdj() {
    if (isNeutral()) return;
    push();
    const out = process(cv, adj, 1);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(out, 0, 0);
    resetAdj();
  }
  function applyStraight() {
    if (!straighten) return;
    push();
    const src = copyCanvas();
    const w = cv.width,
      h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const k = drawStraight(ctx, src, straighten);
    const t = (straighten * Math.PI) / 180;
    layers.forEach((L) => {
      const m = measure(L);
      const cx = L.x + m.w / 2 - w / 2,
        cy = L.y + m.h / 2 - h / 2;
      const nx = (cx * Math.cos(t) - cy * Math.sin(t)) * k + w / 2,
        ny = (cx * Math.sin(t) + cy * Math.cos(t)) * k + h / 2;
      L.size *= k;
      L.strokeW *= k;
      L.rot += straighten;
      const m2 = measure(L);
      L.x = nx - m2.w / 2;
      L.y = ny - m2.h / 2;
    });
    restoreSrc = null;
    resetStraight();
  }

  /* --- enhance --- */
  function levels(perChannel, clip = 0.004) {
    const w = cv.width,
      h = cv.height,
      id = ctx.getImageData(0, 0, w, h),
      d = id.data;
    const hs = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let n = 0;
    for (let j = 0; j < d.length; j += 4) {
      if (d[j + 3] < 8) continue;
      n++;
      if (perChannel) {
        hs[0][d[j]]++;
        hs[1][d[j + 1]]++;
        hs[2][d[j + 2]]++;
      } else hs[0][Math.round(0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2])]++;
    }
    if (!n) return;
    const bounds = (hist) => {
      let lo = 0,
        hi = 255,
        s = 0;
      while (lo < 255 && (s += hist[lo]) < n * clip) lo++;
      s = 0;
      while (hi > 0 && (s += hist[hi]) < n * clip) hi--;
      if (hi - lo < 10) return [0, 255];
      return [lo, hi];
    };
    const lut = (perChannel ? hs : [hs[0], hs[0], hs[0]]).map((hh) => {
      const [lo, hi] = bounds(hh);
      const t = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) t[v] = ((v - lo) * 255) / (hi - lo);
      return t;
    });
    for (let j = 0; j < d.length; j += 4) {
      d[j] = lut[0][d[j]];
      d[j + 1] = lut[1][d[j + 1]];
      d[j + 2] = lut[2][d[j + 2]];
    }
    ctx.putImageData(id, 0, 0);
  }
  function whiteBalance(strength = 1) {
    const id = ctx.getImageData(0, 0, cv.width, cv.height),
      d = id.data;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let j = 0; j < d.length; j += 4) {
      if (d[j + 3] < 8) continue;
      const l = d[j] + d[j + 1] + d[j + 2];
      if (l < 30 || l > 735) continue;
      r += d[j];
      g += d[j + 1];
      b += d[j + 2];
      n++;
    }
    if (!n) return;
    r /= n;
    g /= n;
    b /= n;
    const avg = (r + g + b) / 3;
    const f = (x) => 1 + (clamp(avg / x, 0.7, 1.45) - 1) * strength;
    const fr = f(r),
      fg = f(g),
      fb = f(b);
    for (let j = 0; j < d.length; j += 4) {
      d[j] *= fr;
      d[j + 1] *= fg;
      d[j + 2] *= fb;
    }
    ctx.putImageData(id, 0, 0);
  }
  function denoise(level) {
    // level 0: color noise only, 1: + light luminance smoothing, 2: stronger
    const w = cv.width,
      h = cv.height,
      n = w * h,
      id = ctx.getImageData(0, 0, w, h),
      d = id.data;
    const Y = new Float32Array(n),
      Cb = new Float32Array(n),
      Cr = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j],
        g = d[j + 1],
        b = d[j + 2];
      Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      Cb[i] = -0.1687 * r - 0.3313 * g + 0.5 * b;
      Cr[i] = 0.5 * r - 0.4187 * g - 0.0813 * b;
    }
    const rc = Math.max(1, Math.round((1 + level) * Math.max(1, Math.min(w, h) / 1500)));
    const Cb2 = blurPlane(Cb, w, h, rc),
      Cr2 = blurPlane(Cr, w, h, rc);
    let Y2 = Y;
    if (level > 0) {
      const R = level,
        sr = 7 + level * 6,
        lut = new Float32Array(256);
      for (let v = 0; v < 256; v++) lut[v] = Math.exp((-v * v) / (2 * sr * sr));
      Y2 = new Float32Array(n);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x,
            c = Y[i];
          let s = 0,
            ws = 0;
          for (let dy = -R; dy <= R; dy++) {
            const yy = clamp(y + dy, 0, h - 1) * w;
            for (let dx = -R; dx <= R; dx++) {
              const v = Y[yy + clamp(x + dx, 0, w - 1)];
              const wt = lut[Math.min(255, Math.abs(v - c) | 0)];
              s += v * wt;
              ws += wt;
            }
          }
          Y2[i] = s / ws;
        }
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const y = Y2[i],
        cb = Cb2[i],
        cr = Cr2[i];
      d[j] = y + 1.402 * cr;
      d[j + 1] = y - 0.34414 * cb - 0.71414 * cr;
      d[j + 2] = y + 1.772 * cb;
    }
    ctx.putImageData(id, 0, 0);
  }
  function sharpenNow(amount, radius) {
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    lumaSharpen(id.data, cv.width, cv.height, amount, radius);
    ctx.putImageData(id, 0, 0);
  }
  function lanczos(src, W2, H2) {
    const W = src.width,
      H = src.height,
      s = src.getContext('2d').getImageData(0, 0, W, H).data,
      A = 3;
    const kern = (x) => {
      if (x === 0) return 1;
      if (x <= -A || x >= A) return 0;
      const px = Math.PI * x;
      return (A * Math.sin(px) * Math.sin(px / A)) / (px * px);
    };
    const weights = (sn, dn) => {
      const sc = sn / dn,
        f = Math.max(1, sc),
        sup = A * f;
      return Array.from({ length: dn }, (_, i) => {
        const c = (i + 0.5) * sc - 0.5,
          st = Math.max(0, Math.floor(c - sup + 1)),
          en = Math.min(sn - 1, Math.ceil(c + sup - 1));
        const ws = [];
        let sum = 0;
        for (let j = st; j <= en; j++) {
          const v = kern((j - c) / f);
          ws.push(v);
          sum += v;
        }
        return { st, ws: Float32Array.from(ws, (v) => v / sum) };
      });
    };
    const pre = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const a = s[i * 4 + 3] / 255;
      pre[i * 4] = s[i * 4] * a;
      pre[i * 4 + 1] = s[i * 4 + 1] * a;
      pre[i * 4 + 2] = s[i * 4 + 2] * a;
      pre[i * 4 + 3] = s[i * 4 + 3];
    }
    const wx = weights(W, W2),
      wy = weights(H, H2),
      tmp = new Float32Array(W2 * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W2; x++) {
        const { st, ws } = wx[x];
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (let k = 0; k < ws.length; k++) {
          const i = (y * W + st + k) * 4,
            v = ws[k];
          r += pre[i] * v;
          g += pre[i + 1] * v;
          b += pre[i + 2] * v;
          a += pre[i + 3] * v;
        }
        const o = (y * W2 + x) * 4;
        tmp[o] = r;
        tmp[o + 1] = g;
        tmp[o + 2] = b;
        tmp[o + 3] = a;
      }
    const out = new ImageData(W2, H2),
      d = out.data;
    for (let y = 0; y < H2; y++) {
      const { st, ws } = wy[y];
      for (let x = 0; x < W2; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (let k = 0; k < ws.length; k++) {
          const i = ((st + k) * W2 + x) * 4,
            v = ws[k];
          r += tmp[i] * v;
          g += tmp[i + 1] * v;
          b += tmp[i + 2] * v;
          a += tmp[i + 3] * v;
        }
        const o = (y * W2 + x) * 4,
          al = clamp(a, 0, 255) / 255;
        d[o + 3] = a;
        if (al > 0) {
          d[o] = r / al;
          d[o + 1] = g / al;
          d[o + 2] = b / al;
        }
      }
    }
    const c = newCanvas(W2, H2);
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }
  async function upscale(f) {
    const MAX = 16.7e6;
    let k = f;
    while (k > 1 && cv.width * k * cv.height * k > MAX) k -= 0.5;
    if (k <= 1) return UI.toast('This image is already at the largest size the browser can handle.', true);
    if (k < f) UI.toast(`Upscaled ${k}× instead of ${f}× to stay within the browser's image size limit.`);
    await busy(
      `Upscaling ${k}×…`,
      () => {
        push();
        const W2 = Math.round(cv.width * k),
          H2 = Math.round(cv.height * k);
        const out = lanczos(cv, W2, H2);
        cv.width = ov.width = W2;
        cv.height = ov.height = H2;
        ctx.drawImage(out, 0, 0);
        sharpenNow(0.45, Math.max(1, k * 0.7));
        layers.forEach((L) => {
          L.x *= k;
          L.y *= k;
          L.size *= k;
          L.strokeW *= k;
        });
        restoreSrc = null;
        original = null;
      },
      `Now ${Math.round(cv.width * k)} × ${Math.round(cv.height * k)} px`,
    );
  }

  /* --- background removal --- */
  const rm = (r1, g1, b1, r2, g2, b2) => {
    const m = (r1 + r2) / 2,
      dr = r1 - r2,
      dg = g1 - g2,
      db = b1 - b2;
    return Math.sqrt((2 + m / 256) * dr * dr + 4 * dg * dg + (2 + (255 - m) / 256) * db * db);
  };
  const tolT = () => 8 + +$('#bgTol').value * 2.2;
  function edgeColors(d, w, h) {
    const S = [];
    const step = Math.max(1, Math.floor((w + h) / 700));
    const add = (x, y) => {
      const j = (y * w + x) * 4;
      if (d[j + 3] > 200) S.push([d[j], d[j + 1], d[j + 2]]);
    };
    for (let x = 0; x < w; x += step) {
      add(x, 0);
      add(x, h - 1);
    }
    for (let y = 0; y < h; y += step) {
      add(0, y);
      add(w - 1, y);
    }
    if (!S.length) return [];
    let C = [0, 0.25, 0.5, 0.75].map((f) => S[Math.floor(f * (S.length - 1))].slice());
    let cnt = [];
    for (let it = 0; it < 10; it++) {
      const acc = C.map(() => [0, 0, 0, 0]);
      for (const p of S) {
        let bi = 0,
          bd = 1e9;
        C.forEach((c, i) => {
          const v = rm(...p, ...c);
          if (v < bd) {
            bd = v;
            bi = i;
          }
        });
        const a = acc[bi];
        a[0] += p[0];
        a[1] += p[1];
        a[2] += p[2];
        a[3]++;
      }
      C = acc.map((a, i) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : C[i]));
      cnt = acc.map((a) => a[3]);
    }
    return C.filter((_, i) => cnt[i] >= S.length * 0.04);
  }
  function removeBackground() {
    const w = cv.width,
      h = cv.height,
      n = w * h,
      id = ctx.getImageData(0, 0, w, h),
      d = id.data,
      T = tolT();
    const C = edgeColors(d, w, h);
    if (!C.length) return UI.toast('The edges are already transparent.');
    const near = (j) => {
      let m = 1e9;
      for (const c of C) {
        const v = rm(d[j], d[j + 1], d[j + 2], c[0], c[1], c[2]);
        if (v < m) m = v;
      }
      return m;
    };
    const mask = new Uint8Array(n),
      q = new Int32Array(n);
    let qh = 0,
      qt = 0;
    const seed = (i) => {
      if (mask[i]) return;
      const j = i * 4;
      if (d[j + 3] < 16 || near(j) < T) {
        mask[i] = 1;
        q[qt++] = i;
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x);
      seed((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      seed(y * w);
      seed(y * w + w - 1);
    }
    while (qh < qt) {
      const i = q[qh++],
        x = i % w,
        j = i * 4;
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (k < 0 || k >= n || mask[k]) continue;
        const jk = k * 4;
        if (
          d[jk + 3] < 16 ||
          (near(jk) < T && rm(d[jk], d[jk + 1], d[jk + 2], d[j], d[j + 1], d[j + 2]) < T * 0.7)
        ) {
          mask[k] = 1;
          q[qt++] = k;
        }
      }
    }
    let removed = 0;
    for (let i = 0; i < n; i++) removed += mask[i];
    if (removed > n * 0.985)
      return UI.toast('That would remove almost everything. Lower the tolerance and try again.', true);
    if (removed < n * 0.005)
      return UI.toast(
        'No background found along the edges. Raise the tolerance or use the Magic eraser.',
        true,
      );
    // drop small foreground specks
    const seen = new Uint8Array(n),
      minSize = Math.max(24, n * 0.0004);
    for (let s = 0; s < n; s++) {
      if (mask[s] || seen[s]) continue;
      qh = 0;
      qt = 0;
      q[qt++] = s;
      seen[s] = 1;
      while (qh < qt) {
        const i = q[qh++],
          x = i % w;
        for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (k < 0 || k >= n || mask[k] || seen[k]) continue;
          seen[k] = 1;
          q[qt++] = k;
        }
      }
      if (qt < minSize) for (let t = 0; t < qt; t++) mask[q[t]] = 1;
    }
    push();
    restoreSrc = restoreSrc || copyCanvas();
    const soft = +$('#bgSoft').value * Math.max(1, Math.max(w, h) / 1500);
    let A = new Float32Array(n);
    for (let i = 0; i < n; i++) A[i] = mask[i] ? 0 : 1;
    if (soft > 0) {
      A = blurPlane(A, w, h, soft * 0.6);
      for (let i = 0; i < n; i++) A[i] = clamp((A[i] - 0.5) * 2 + 0.5, 0, 1);
    }
    for (let i = 0; i < n; i++) {
      const a = A[i],
        j = i * 4;
      if (a >= 1) continue;
      if (a > 0) {
        let bc = C[0],
          bd = 1e9;
        for (const c of C) {
          const v = rm(d[j], d[j + 1], d[j + 2], ...c);
          if (v < bd) {
            bd = v;
            bc = c;
          }
        }
        for (let ch = 0; ch < 3; ch++) d[j + ch] = (d[j + ch] - bc[ch] * (1 - a)) / a;
      }
      d[j + 3] = Math.min(d[j + 3], a * 255);
    }
    ctx.putImageData(id, 0, 0);
  }
  function magicErase(px, py) {
    const w = cv.width,
      h = cv.height,
      n = w * h,
      id = ctx.getImageData(0, 0, w, h),
      d = id.data,
      T = tolT();
    const s = (py * w + px) * 4;
    const ref = [d[s], d[s + 1], d[s + 2]];
    if (d[s + 3] < 10) return UI.toast('That spot is already transparent.');
    push();
    restoreSrc = restoreSrc || copyCanvas();
    let count = 0;
    const ok = (j) => d[j + 3] > 0 && rm(d[j], d[j + 1], d[j + 2], ...ref) < T;
    if ($('#bgContig').checked) {
      const mask = new Uint8Array(n),
        q = new Int32Array(n);
      let qh = 0,
        qt = 0;
      q[qt++] = py * w + px;
      mask[py * w + px] = 1;
      while (qh < qt) {
        const i = q[qh++],
          x = i % w;
        d[i * 4 + 3] = 0;
        count++;
        for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (k < 0 || k >= n || mask[k]) continue;
          mask[k] = 1;
          if (ok(k * 4)) q[qt++] = k;
        }
      }
    } else
      for (let j = 0; j < d.length; j += 4)
        if (ok(j)) {
          d[j + 3] = 0;
          count++;
        }
    ctx.putImageData(id, 0, 0);
    dirty();
    UI.toast(`Erased ${((count / n) * 100).toFixed(1)}% of the image`);
  }
  async function replaceBg(kind) {
    let drawBg;
    if (kind === 'white' || kind === 'color') {
      let col = '#ffffff';
      if (kind === 'color') {
        const r = await UI.modal({
          title: 'Background color',
          fields: [{ id: 'c', label: 'Color', type: 'color', value: '#e8f0ff' }],
        });
        if (!r) return;
        col = r.c;
      }
      drawBg = (g) => {
        g.fillStyle = col;
        g.fillRect(0, 0, cv.width, cv.height);
      };
    }
    if (kind === 'blur') {
      const src = restoreSrc || copyCanvas();
      const k = Math.min(1, 600 / Math.max(src.width, src.height));
      const sm = newCanvas(src.width * k, src.height * k);
      const sg = sm.getContext('2d');
      sg.drawImage(src, 0, 0, sm.width, sm.height);
      const id = sg.getImageData(0, 0, sm.width, sm.height);
      blurRGBA(id.data, sm.width, sm.height, 8);
      for (let j = 3; j < id.data.length; j += 4) id.data[j] = 255;
      sg.putImageData(id, 0, 0);
      drawBg = (g) => {
        g.imageSmoothingQuality = 'high';
        g.drawImage(sm, 0, 0, cv.width, cv.height);
      };
    }
    if (kind === 'image') {
      const [f] = await pickFiles('image/*,.heic,.heif,.tif,.tiff');
      if (!f) return;
      const im = await Formats.decodeImage(f);
      drawBg = (g) => {
        const k = Math.max(cv.width / im.width, cv.height / im.height);
        g.drawImage(
          im,
          (cv.width - im.width * k) / 2,
          (cv.height - im.height * k) / 2,
          im.width * k,
          im.height * k,
        );
      };
    }
    push();
    const c = newCanvas(cv.width, cv.height),
      g = c.getContext('2d');
    drawBg(g);
    g.drawImage(cv, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(c, 0, 0);
    dirty();
    if (!restoreSrc)
      UI.toast('Tip: remove the background first, otherwise the new background is hidden behind the photo.');
  }

  /* --- text layers --- */
  const LDEF = () => ({
    id: uid(),
    text: 'Your text',
    x: 0,
    y: 0,
    size: Math.round(Math.max(24, cv.width / 12)),
    font: 'Bricolage Grotesque',
    color: '#ffffff',
    bold: true,
    italic: false,
    align: 'left',
    stroke: '#000000',
    strokeW: 0,
    shadow: true,
    bg: '',
    bgOpacity: 0.85,
    rot: 0,
    opacity: 1,
  });
  const fontStr = (L) =>
    `${L.italic ? 'italic ' : ''}${L.bold ? 700 : 400} ${L.size}px "${L.font}", "IBM Plex Sans", Arial, sans-serif`;
  const mctx = newCanvas(1, 1).getContext('2d');
  function measure(L) {
    mctx.font = fontStr(L);
    const lines = L.text.split('\n');
    const tw = Math.max(1, ...lines.map((l) => mctx.measureText(l).width));
    const padX = L.bg ? L.size * 0.35 : 0,
      padY = L.bg ? L.size * 0.2 : 0;
    return { lines, tw, w: tw + padX * 2, h: lines.length * L.size * 1.2 + padY * 2, padX, padY };
  }
  const rgba = (hex, a) => {
    const n = parseInt((hex || '#000000').slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  function drawLayer(g, L) {
    const m = measure(L);
    g.save();
    g.globalAlpha = L.opacity;
    g.translate(L.x + m.w / 2, L.y + m.h / 2);
    g.rotate((L.rot * Math.PI) / 180);
    g.translate(-m.w / 2, -m.h / 2);
    if (L.bg) {
      g.fillStyle = rgba(L.bg, L.bgOpacity);
      g.beginPath();
      g.roundRect ? g.roundRect(0, 0, m.w, m.h, L.size * 0.18) : g.rect(0, 0, m.w, m.h);
      g.fill();
    }
    g.font = fontStr(L);
    g.textAlign = L.align;
    g.textBaseline = 'alphabetic';
    const ax = L.align === 'center' ? m.w / 2 : L.align === 'right' ? m.w - m.padX : m.padX;
    m.lines.forEach((ln, i) => {
      const mt = g.measureText(ln || 'M');
      const asc = mt.fontBoundingBoxAscent ?? L.size * 0.92,
        desc = mt.fontBoundingBoxDescent ?? L.size * 0.24;
      const y = m.padY + i * L.size * 1.2 + (L.size * 1.2 - asc - desc) / 2 + asc;
      if (L.shadow) {
        g.shadowColor = 'rgba(0,0,0,.5)';
        g.shadowBlur = L.size * 0.18;
        g.shadowOffsetY = L.size * 0.06;
      }
      if (L.strokeW) {
        g.lineJoin = 'round';
        g.lineWidth = L.strokeW * 2;
        g.strokeStyle = L.stroke;
        g.strokeText(ln, ax, y);
        g.shadowColor = 'transparent';
      }
      g.fillStyle = L.color;
      g.fillText(ln, ax, y);
      g.shadowColor = 'transparent';
    });
    g.restore();
  }
  function renderLayers() {
    lay.innerHTML = '';
    if (!cv.width || !cv.clientWidth) return;
    const k = cv.clientWidth / cv.width;
    layers.forEach((L) => {
      const m = measure(L);
      const n = el('div', { class: 'tl' + (L === selL ? ' sel' : ''), 'data-id': L.id });
      n.textContent = L.text;
      Object.assign(n.style, {
        left: (L.x / cv.width) * 100 + '%',
        top: (L.y / cv.height) * 100 + '%',
        width: m.w * k + 'px',
        height: m.h * k + 'px',
        font: fontStr({ ...L, size: L.size * k }),
        lineHeight: 1.2,
        color: L.color,
        textAlign: L.align,
        padding: `${m.padY * k}px ${m.padX * k}px`,
        opacity: L.opacity,
        transform: `rotate(${L.rot}deg)`,
        background: L.bg ? rgba(L.bg, L.bgOpacity) : 'transparent',
        borderRadius: L.size * 0.18 * k + 'px',
        textShadow: L.shadow ? `0 ${L.size * 0.06 * k}px ${L.size * 0.18 * k}px rgba(0,0,0,.5)` : 'none',
        webkitTextStroke: L.strokeW ? `${L.strokeW * 2 * k}px ${L.stroke}` : '0',
      });
      lay.append(n);
    });
  }
  new ResizeObserver(() => renderLayers()).observe(cv);
  async function flattenInto(c) {
    for (const L of layers) {
      try {
        await document.fonts.load(fontStr(L), L.text);
      } catch {}
      drawLayer(c.getContext('2d'), L);
    }
  }
  async function mergeLayers() {
    if (!layers.length) return;
    push();
    await flattenInto(cv);
    layers = [];
    selL = null;
    dirty();
    renderTextPanel();
    UI.toast('Text merged into the image');
  }
  function editLayer(n) {
    const L = layers.find((x) => x.id === n.dataset.id);
    if (!L) return;
    try {
      n.contentEditable = 'plaintext-only';
    } catch {}
    if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
    n.style.width = 'auto';
    n.style.height = 'auto';
    n.style.minWidth = '1em';
    n.focus();
    const r = document.createRange();
    r.selectNodeContents(n);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const before = L.text;
    n.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') n.blur();
    };
    n.onblur = () => {
      n.contentEditable = 'false';
      const t = n.innerText.replace(/\n$/, '');
      if (!t.trim()) {
        layers = layers.filter((x) => x !== L);
        selL = null;
      } else if (t !== before) {
        push();
        L.text = t;
      }
      renderLayers();
      renderTextPanel();
      info();
    };
  }
  function addLayerAt(e) {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) * cv.width) / r.width,
      y = ((e.clientY - r.top) * cv.height) / r.height;
    push();
    const L = LDEF();
    L.color = $('#imColor').value;
    L.x = Math.round(x);
    L.y = Math.round(y - L.size * 0.6);
    layers.push(L);
    selL = L;
    renderLayers();
    renderTextPanel();
    info();
    setTimeout(() => {
      const n = lay.querySelector(`[data-id="${L.id}"]`);
      n && editLayer(n);
    }, 0);
  }
  lay.addEventListener('pointerdown', (e) => {
    const n = e.target.closest('.tl');
    if (!n) {
      if (tool === 'text') {
        e.preventDefault();
        addLayerAt(e);
      } else if (selL) {
        selL = null;
        renderLayers();
        renderTextPanel();
      }
      return;
    }
    if (n.isContentEditable) return;
    const L = layers.find((x) => x.id === n.dataset.id);
    selL = L;
    $$('.tl', lay).forEach((x) => x.classList.toggle('sel', x === n));
    renderTextPanel();
    e.preventDefault();
    lay.setPointerCapture(e.pointerId);
    const k = cv.clientWidth / cv.width,
      sx = e.clientX,
      sy = e.clientY,
      x0 = L.x,
      y0 = L.y;
    let moved = false;
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / k,
        dy = (ev.clientY - sy) / k;
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 3) return;
      if (!moved) {
        push();
        moved = true;
      }
      L.x = Math.round(x0 + dx);
      L.y = Math.round(y0 + dy);
      n.style.left = (L.x / cv.width) * 100 + '%';
      n.style.top = (L.y / cv.height) * 100 + '%';
    };
    const up = () => {
      lay.removeEventListener('pointermove', mv);
      lay.removeEventListener('pointerup', up);
    };
    lay.addEventListener('pointermove', mv);
    lay.addEventListener('pointerup', up);
  });
  lay.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.tl');
    if (n) editLayer(n);
  });
  function renderTextPanel() {
    const P = $('#imTextPanel');
    P.innerHTML = '';
    P.hidden = !selL;
    if (!selL) return;
    const L = selL;
    let pushed = false;
    const upd = (k, v) => {
      if (!pushed) {
        push();
        pushed = true;
      }
      L[k] = v;
      renderLayers();
    };
    const inp = (type, v, k, attrs = {}) => {
      const i = el('input', { type, class: 'ctl', ...attrs });
      if (type === 'checkbox') i.checked = !!v;
      else i.value = v;
      i.addEventListener('focus', () => (pushed = false));
      i.addEventListener('input', () =>
        upd(k, type === 'checkbox' ? i.checked : type === 'number' || type === 'range' ? +i.value : i.value),
      );
      return i;
    };
    const ta = el('textarea', { class: 'notes', style: { minHeight: '56px' } });
    ta.value = L.text;
    ta.oninput = () => upd('text', ta.value || ' ');
    const font = el(
      'select',
      { class: 'ctl' },
      ...[...FONTS, ...userFonts].map((f) =>
        el('option', { value: f, selected: f === L.font, style: { fontFamily: `"${f}"` } }, f),
      ),
    );
    font.onchange = () => {
      upd('font', font.value);
      document.fonts
        .load(fontStr(L))
        .then(renderLayers)
        .catch(() => {});
    };
    const tog = (k, h) => {
      const b = el('button', { class: 'btn sq', 'aria-pressed': !!L[k], html: h });
      b.onclick = () => {
        pushed = false;
        upd(k, !L[k]);
        b.setAttribute('aria-pressed', L[k]);
      };
      return b;
    };
    const seg = el(
      'div',
      { class: 'seg' },
      ...[
        ['left', icon('alignL')],
        ['center', icon('alignC')],
        ['right', icon('alignR')],
      ].map(([v, l]) => {
        const b = el('button', { class: L.align === v ? 'on' : '', html: l });
        b.onclick = () => {
          pushed = false;
          upd('align', v);
          renderTextPanel();
        };
        return b;
      }),
    );
    const bgOn = el('input', { type: 'checkbox', checked: !!L.bg });
    bgOn.onchange = () => {
      pushed = false;
      upd('bg', bgOn.checked ? '#111111' : '');
      renderTextPanel();
    };
    const fld = (l, i) => el('div', { class: 'field' }, el('label', { class: 'lbl' }, l), i);
    P.append(
      el(
        'h4',
        {
          style: {
            margin: 0,
            fontSize: '13.5px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
        },
        'Text layer',
        el('button', {
          class: 'btn sq ghost',
          'aria-label': 'Deselect',
          html: icon('x'),
          onclick: () => {
            selL = null;
            renderLayers();
            renderTextPanel();
          },
        }),
      ),
      ta,
      el(
        'div',
        { class: 'grid2' },
        fld('Font', font),
        fld('Size', inp('number', Math.round(L.size), 'size', { min: 4, max: 2000 })),
      ),
      el(
        'div',
        { class: 'row' },
        fld('Color', inp('color', L.color, 'color')),
        tog('bold', icon('bold')),
        tog('italic', icon('italic')),
        seg,
      ),
      el(
        'div',
        { class: 'grid2' },
        fld('Outline', inp('color', L.stroke, 'stroke')),
        fld('Outline width', inp('number', L.strokeW, 'strokeW', { min: 0, max: 200 })),
      ),
      el('label', { class: 'check' }, inp('checkbox', L.shadow, 'shadow'), 'Drop shadow'),
      el(
        'div',
        { class: 'row' },
        el('label', { class: 'check' }, bgOn, 'Label box'),
        L.bg ? inp('color', L.bg, 'bg') : null,
        L.bg
          ? el(
              'div',
              { class: 'range', style: { flex: 1, gridTemplateColumns: '1fr' } },
              inp('range', L.bgOpacity, 'bgOpacity', { min: 0, max: 1, step: 0.05, title: 'Box opacity' }),
            )
          : null,
      ),
      el(
        'div',
        { class: 'range' },
        el('label', {}, 'Rotation'),
        inp('range', L.rot, 'rot', { min: -180, max: 180 }),
        el('output', {}, ''),
      ),
      el(
        'div',
        { class: 'range' },
        el('label', {}, 'Opacity'),
        inp('range', L.opacity, 'opacity', { min: 0.05, max: 1, step: 0.05 }),
        el('output', {}, ''),
      ),
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'btn',
            onclick: () => {
              push();
              const c = { ...L, id: uid(), x: L.x + L.size * 0.5, y: L.y + L.size * 0.5 };
              layers.push(c);
              selL = c;
              renderLayers();
              renderTextPanel();
            },
          },
          'Duplicate',
        ),
        el(
          'button',
          {
            class: 'btn danger',
            onclick: () => {
              push();
              layers = layers.filter((x) => x !== L);
              selL = null;
              renderLayers();
              renderTextPanel();
              info();
            },
          },
          'Delete',
        ),
        el(
          'button',
          { class: 'btn', title: 'Burn all text into the photo', onclick: mergeLayers },
          'Merge into photo',
        ),
      ),
    );
  }

  /* --- drawing tools --- */
  function setTool(t) {
    tool = t;
    $$('#imTools button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    crop = null;
    octx.clearRect(0, 0, ov.width, ov.height);
    $('#imCropActs').hidden = t !== 'crop';
    ov.style.pointerEvents = t === 'none' || t === 'text' ? 'none' : 'auto';
    lay.classList.toggle('live', t === 'text');
    ov.style.cursor = t === 'pick' || t === 'wand' ? 'copy' : 'crosshair';
    if (t === 'restore' && !restoreSrc)
      UI.toast('Restore paints back pixels removed by the background remover or eraser.');
    info();
  }
  $('#imTools').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (b) setTool(b.dataset.t);
  };
  const P = (e) => {
    const r = ov.getBoundingClientRect();
    return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
  };
  function drawCrop() {
    octx.clearRect(0, 0, ov.width, ov.height);
    if (!crop) return;
    const { x, y, w, h } = crop;
    octx.fillStyle = 'rgba(0,0,0,.55)';
    octx.fillRect(0, 0, ov.width, ov.height);
    octx.clearRect(x, y, w, h);
    octx.strokeStyle = '#fff';
    octx.lineWidth = Math.max(2, cv.width / 500);
    octx.setLineDash([10, 6]);
    octx.strokeRect(x, y, w, h);
    octx.setLineDash([]);
    octx.globalAlpha = 0.4;
    for (let i = 1; i < 3; i++) {
      octx.beginPath();
      octx.moveTo(x + (w * i) / 3, y);
      octx.lineTo(x + (w * i) / 3, y + h);
      octx.moveTo(x, y + (h * i) / 3);
      octx.lineTo(x + w, y + (h * i) / 3);
      octx.stroke();
    }
    octx.globalAlpha = 1;
    octx.fillStyle = '#fff';
    octx.font = `${Math.max(14, cv.width / 50)}px IBM Plex Mono, monospace`;
    octx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + 8, y + Math.max(20, cv.width / 40));
  }
  function arrow(g, x0, y0, x1, y1, w, color) {
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = w;
    g.lineCap = 'round';
    const a = Math.atan2(y1 - y0, x1 - x0),
      hl = w * 4.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1 - Math.cos(a) * hl * 0.6, y1 - Math.sin(a) * hl * 0.6);
    g.stroke();
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 - hl * Math.cos(a - 0.45), y1 - hl * Math.sin(a - 0.45));
    g.lineTo(x1 - hl * Math.cos(a + 0.45), y1 - hl * Math.sin(a + 0.45));
    g.closePath();
    g.fill();
  }
  function shape(g, kind, x0, y0, x1, y1, color) {
    g.strokeStyle = color;
    g.lineWidth = lw();
    g.lineCap = 'round';
    g.beginPath();
    if (kind === 'rect') g.rect(x0, y0, x1 - x0, y1 - y0);
    else if (kind === 'ellipse')
      g.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
    else {
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
    }
    g.stroke();
  }
  function region(x0, y0, x1, y1) {
    const x = Math.round(Math.max(0, Math.min(x0, x1))),
      y = Math.round(Math.max(0, Math.min(y0, y1)));
    return {
      x,
      y,
      w: Math.round(Math.min(cv.width, Math.max(x0, x1)) - x),
      h: Math.round(Math.min(cv.height, Math.max(y0, y1)) - y),
    };
  }
  function pixelate({ x, y, w, h }) {
    if (w < 2 || h < 2) return;
    const b = Math.max(6, Math.round(Math.max(w, h) / 18));
    const t = newCanvas(Math.ceil(w / b), Math.ceil(h / b));
    t.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, t.width, t.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h);
    ctx.restore();
  }
  function blurArea({ x, y, w, h }) {
    if (w < 2 || h < 2) return;
    const id = ctx.getImageData(x, y, w, h);
    blurRGBA(id.data, w, h, Math.max(4, Math.max(w, h) / 30));
    ctx.putImageData(id, x, y);
  }
  function strokeSeg(a, b, color) {
    ctx.save();
    ctx.lineWidth = lw();
    ctx.lineCap = ctx.lineJoin = 'round';
    if (tool === 'erase') ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = tool === 'restore' ? ctx.createPattern(restoreSrc, 'no-repeat') : color;
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
    ctx.restore();
  }
  ov.addEventListener('pointerdown', async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const [x0, y0] = P(e);
    const color = $('#imColor').value;
    let last = [x0, y0];
    if (tool === 'pick') {
      const d = ctx.getImageData(
        clamp(Math.floor(x0), 0, cv.width - 1),
        clamp(Math.floor(y0), 0, cv.height - 1),
        1,
        1,
      ).data;
      const hx = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      $('#imColor').value = hx;
      if (selL) {
        push();
        selL.color = hx;
        renderLayers();
        renderTextPanel();
      }
      UI.toast('Picked ' + hx);
      return;
    }
    if (tool === 'wand')
      return magicErase(clamp(Math.floor(x0), 0, cv.width - 1), clamp(Math.floor(y0), 0, cv.height - 1));
    if (tool === 'restore' && !restoreSrc)
      return UI.toast('Nothing to restore yet. Remove a background or erase first.', true);
    ov.setPointerCapture(e.pointerId);
    const painting = tool === 'brush' || tool === 'erase' || tool === 'restore';
    if (painting) {
      push();
      if (tool === 'erase') restoreSrc = restoreSrc || undoS[undoS.length - 1].c;
      strokeSeg([x0, y0], [x0 + 0.01, y0], color);
    }
    const mv = (ev) => {
      const [x, y] = P(ev);
      if (painting) {
        strokeSeg(last, [x, y], color);
        last = [x, y];
        return;
      }
      octx.clearRect(0, 0, ov.width, ov.height);
      if (tool === 'crop') {
        const ar = +$('#imAspect').value;
        let w = x - x0,
          h = y - y0;
        if (ar) h = (Math.sign(h || 1) * Math.abs(w)) / ar;
        crop = region(x0, y0, x0 + w, y0 + h);
        drawCrop();
        return;
      }
      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') shape(octx, tool, x0, y0, x, y, color);
      if (tool === 'arrow') arrow(octx, x0, y0, x, y, lw(), color);
      if (tool === 'pixelate' || tool === 'blur') {
        octx.strokeStyle = '#fff';
        octx.setLineDash([8, 6]);
        octx.lineWidth = 2;
        octx.strokeRect(x0, y0, x - x0, y - y0);
        octx.setLineDash([]);
      }
      last = [x, y];
    };
    const up = () => {
      ov.removeEventListener('pointermove', mv);
      ov.removeEventListener('pointerup', up);
      const [x, y] = last;
      if (painting) {
        dirty();
        return;
      }
      if (tool === 'crop') return;
      octx.clearRect(0, 0, ov.width, ov.height);
      if (Math.abs(x - x0) < 3 && Math.abs(y - y0) < 3) return;
      push();
      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') shape(ctx, tool, x0, y0, x, y, color);
      if (tool === 'arrow') arrow(ctx, x0, y0, x, y, lw(), color);
      if (tool === 'pixelate') pixelate(region(x0, y0, x, y));
      if (tool === 'blur') blurArea(region(x0, y0, x, y));
      dirty();
    };
    ov.addEventListener('pointermove', mv);
    ov.addEventListener('pointerup', up);
  });

  /* --- geometry --- */
  function transform(kind) {
    push();
    const s = copyCanvas();
    const W0 = s.width,
      H0 = s.height;
    const rot = kind === 'rotL' || kind === 'rotR';
    layers.forEach((L) => {
      const m = measure(L);
      const cx = L.x + m.w / 2,
        cy = L.y + m.h / 2;
      const [nx, ny] = {
        rotR: [H0 - cy, cx],
        rotL: [cy, W0 - cx],
        flipH: [W0 - cx, cy],
        flipV: [cx, H0 - cy],
      }[kind];
      if (kind === 'rotR') L.rot += 90;
      if (kind === 'rotL') L.rot -= 90;
      L.x = nx - m.w / 2;
      L.y = ny - m.h / 2;
    });
    if (rot) {
      cv.width = ov.width = H0;
      cv.height = ov.height = W0;
    }
    ctx.save();
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (kind === 'rotR') {
      ctx.translate(cv.width, 0);
      ctx.rotate(Math.PI / 2);
    }
    if (kind === 'rotL') {
      ctx.translate(0, cv.height);
      ctx.rotate(-Math.PI / 2);
    }
    if (kind === 'flipH') {
      ctx.translate(cv.width, 0);
      ctx.scale(-1, 1);
    }
    if (kind === 'flipV') {
      ctx.translate(0, cv.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(s, 0, 0);
    ctx.restore();
    restoreSrc = null;
    dirty();
  }
  async function composite() {
    if (!isNeutral()) await applyAdj();
    if (straighten) applyStraight();
    const c = copyCanvas();
    await flattenInto(c);
    return c;
  }
  async function exportAs(fmt) {
    const done = UI.busy('Preparing image…');
    await sleep(30);
    try {
      const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
      let src = await composite();
      dirty();
      if (fmt === 'jpg') {
        const c = newCanvas(src.width, src.height),
          g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(src, 0, 0);
        src = c;
      }
      const blob = await new Promise((r) => src.toBlob(r, type, +$('#imQ').value));
      if (!blob || (fmt === 'webp' && blob.type !== 'image/webp'))
        return UI.toast('This browser cannot encode ' + fmt.toUpperCase() + '. Use PNG or JPG.', true);
      savedWhole('image', await saveFile(`${name}.${fmt}`, blob));
    } finally {
      done();
    }
  }
  async function act(a) {
    if (!hasImage && !['open', 'newImg', 'example'].includes(a)) return UI.toast('Open a photo first.', true);
    switch (a) {
      case 'example':
        if (!(await replaceOk(hasImage))) return;
        sample();
        setTool('none');
        return;
      case 'open': {
        const [f] = await pickFiles('image/*,.heic,.heif,.tif,.tiff,.svg,.avif,.bmp,.ico');
        if (f) openFile(f);
        break;
      }
      case 'newImg': {
        const r = await UI.modal({
          title: 'New canvas',
          fields: [
            { id: 'w', label: 'Width (px)', type: 'number', value: 1080, min: 1, max: 8000 },
            { id: 'h', label: 'Height (px)', type: 'number', value: 1080, min: 1, max: 8000 },
            { id: 'bg', label: 'Background', type: 'color', value: '#ffffff' },
            { id: 'tr', label: 'Transparent background', type: 'checkbox' },
          ],
        });
        if (!r) return;
        const c = newCanvas(r.w, r.h);
        const g = c.getContext('2d');
        if (!r.tr) {
          g.fillStyle = r.bg;
          g.fillRect(0, 0, c.width, c.height);
        }
        name = 'canvas';
        origBytes = 0;
        setImage(c);
        break;
      }
      case 'undo':
        return undo();
      case 'redo':
        return redo();
      case 'rotL':
      case 'rotR':
      case 'flipH':
      case 'flipV':
        return transform(a);
      case 'resize': {
        const r = await UI.modal({
          title: 'Resize image',
          text: 'To enlarge with better quality, use Upscale in the Enhance panel.',
          fields: [
            { id: 'w', label: 'Width (px)', type: 'number', value: cv.width, min: 1, max: 10000 },
            { id: 'h', label: 'Height (px)', type: 'number', value: cv.height, min: 1, max: 10000 },
            { id: 'lock', label: 'Keep proportions (uses the width)', type: 'checkbox', value: true },
          ],
          ok: 'Resize',
        });
        if (!r) return;
        const w = Math.round(r.w),
          h = Math.round(r.lock ? (r.w * cv.height) / cv.width : r.h);
        await busy('Resizing…', () => {
          push();
          const fx = w / cv.width,
            fy = h / cv.height;
          const out =
            w > cv.width || h > cv.height
              ? lanczos(cv, w, h)
              : (() => {
                  const c = newCanvas(w, h),
                    g = c.getContext('2d');
                  g.imageSmoothingQuality = 'high';
                  let s = cv;
                  while (s.width / 2 > w && s.height / 2 > h) {
                    const t = newCanvas(s.width / 2, s.height / 2);
                    const tg = t.getContext('2d');
                    tg.imageSmoothingQuality = 'high';
                    tg.drawImage(s, 0, 0, t.width, t.height);
                    s = t;
                  }
                  g.drawImage(s, 0, 0, w, h);
                  return c;
                })();
          cv.width = ov.width = w;
          cv.height = ov.height = h;
          ctx.drawImage(out, 0, 0);
          layers.forEach((L) => {
            L.x *= fx;
            L.y *= fy;
            L.size *= Math.min(fx, fy);
            L.strokeW *= Math.min(fx, fy);
          });
          restoreSrc = null;
        });
        break;
      }
      case 'applyCrop':
        if (!crop || crop.w < 2 || crop.h < 2)
          return UI.toast('Drag on the image to choose an area first.', true);
        push();
        {
          const s = copyCanvas();
          const { x, y, w, h } = crop;
          cv.width = ov.width = w;
          cv.height = ov.height = h;
          ctx.drawImage(s, x, y, w, h, 0, 0, w, h);
          if (restoreSrc) {
            const r2 = newCanvas(w, h);
            r2.getContext('2d').drawImage(restoreSrc, x, y, w, h, 0, 0, w, h);
            restoreSrc = r2;
          }
          layers.forEach((L) => {
            L.x -= x;
            L.y -= y;
          });
        }
        setTool('none');
        dirty();
        break;
      case 'cancelCrop':
        setTool('none');
        break;
      case 'applyAdj':
        return busy('Applying adjustments…', applyAdj, 'Adjustments applied');
      case 'resetAdj':
        resetAdj();
        break;
      case 'applyStraight':
        return busy('Straightening…', applyStraight);
      case 'resetStraight':
        resetStraight();
        break;
      case 'autoEnhance':
        return busy(
          'Enhancing…',
          () => {
            push();
            denoise(0);
            whiteBalance(0.5);
            levels(false, 0.003);
            const out = process(cv, { ...ZERO, vibrance: 20, clarity: 15, sharpen: 22 }, 1);
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(out, 0, 0);
          },
          'Enhanced: color, tone, clarity and sharpness',
        );
      case 'autoColor':
        return busy(
          'Correcting color…',
          () => {
            push();
            levels(true);
          },
          'Color corrected',
        );
      case 'autoContrast':
        return busy(
          'Fixing contrast…',
          () => {
            push();
            levels(false);
          },
          'Contrast stretched',
        );
      case 'wb':
        return busy(
          'Balancing white…',
          () => {
            push();
            whiteBalance(1);
          },
          'White balance corrected',
        );
      case 'denoise': {
        const r = await UI.modal({
          title: 'Denoise',
          fields: [
            {
              id: 'lv',
              label: 'Strength',
              type: 'select',
              value: '1',
              options: [
                ['0', 'Color noise only (fastest)'],
                ['1', 'Light'],
                ['2', 'Strong'],
              ],
            },
          ],
          ok: 'Denoise',
        });
        if (!r) return;
        return busy(
          'Removing noise…',
          () => {
            push();
            denoise(+r.lv);
          },
          'Noise reduced',
        );
      }
      case 'sharpenOnce':
        return busy(
          'Sharpening…',
          () => {
            push();
            sharpenNow(0.7, Math.max(1, cv.width / 2000));
          },
          'Sharpened',
        );
      case 'deblur':
        return busy(
          'Sharpening…',
          () => {
            push();
            sharpenNow(1.1, Math.max(2, cv.width / 900));
            sharpenNow(0.6, 1);
          },
          'Detail recovered',
        );
      case 'up2':
        return upscale(2);
      case 'up4':
        return upscale(4);
      case 'removeBg':
        return busy('Removing background…', removeBackground);
      case 'bgColor':
        return replaceBg('color');
      case 'bgWhite':
        return replaceBg('white');
      case 'bgBlur':
        return replaceBg('blur');
      case 'bgImage':
        return replaceBg('image');
      case 'png':
      case 'jpg':
      case 'webp':
        return exportAs(a);
      case 'toPdf': {
        const c = await composite();
        dirty();
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        await Mods.pdf.fromImage(b, name + '.png');
        break;
      }
      case 'ocrText': {
        const langs = await Mods.addons.pickLangs();
        if (!langs) return;
        const msg = el('span', {}, 'Loading text recognition…');
        const bg = el('div', { class: 'busy' }, el('div', {}, el('span', { class: 'spin' }), msg));
        document.body.append(bg);
        try {
          const { text } = await Formats.ocr(await composite(), langs, (f) => {
            msg.textContent = `Reading text… ${Math.round(f * 100)}%`;
          });
          dirty();
          if (!text.trim()) return UI.toast('No text found in this image.', true);
          Mods.text.setContent(text.trim() + '\n', name + '.txt');
        } catch (e) {
          UI.toast('Text recognition failed: ' + e.message, true);
        } finally {
          bg.remove();
        }
        break;
      }
    }
  }
  $('#imBar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b) act(b.dataset.a);
  });
  $('#imSide').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b && !b.closest('#imTextPanel')) act(b.dataset.a);
  });
  $('#imQ').oninput = (e) => ($('#imQo').textContent = Math.round(e.target.value * 100) + '%');
  // hold to compare with the original
  const cmp = $('#imCompare');
  const showOrig = () => {
    if (!original) return UI.toast('The original is not available after resizing or upscaling.');
    const g = pv.getContext('2d');
    const k = Math.min(1, 1400 / Math.max(cv.width, cv.height));
    pv.width = Math.round(cv.width * k);
    pv.height = Math.round(cv.height * k);
    const f = Math.min(pv.width / original.width, pv.height / original.height);
    g.clearRect(0, 0, pv.width, pv.height);
    g.drawImage(
      original,
      (pv.width - original.width * f) / 2,
      (pv.height - original.height * f) / 2,
      original.width * f,
      original.height * f,
    );
    pv.hidden = false;
    lay.style.visibility = 'hidden';
  };
  const hideOrig = () => {
    lay.style.visibility = '';
    pv.hidden = true;
    preview();
  };
  cmp.addEventListener('pointerdown', showOrig);
  cmp.addEventListener('pointerup', hideOrig);
  cmp.addEventListener('pointerleave', hideOrig);
  document.addEventListener('keydown', (e) => {
    if (
      curMod !== 'image' ||
      e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]') ||
      $('.modal-bg')
    )
      return;
    const m = e.ctrlKey || e.metaKey;
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && selL) {
      e.preventDefault();
      push();
      layers = layers.filter((x) => x !== selL);
      selL = null;
      renderLayers();
      renderTextPanel();
      return;
    }
    if (e.key === 'Enter' && tool === 'crop') {
      act('applyCrop');
      return;
    }
    if (e.key === 'Escape') {
      setTool('none');
      return;
    }
    if (!m && !e.altKey) {
      const t = {
        v: 'none',
        c: 'crop',
        t: 'text',
        b: 'brush',
        e: 'erase',
        r: 'restore',
        w: 'wand',
        i: 'pick',
      }[e.key.toLowerCase()];
      if (t) setTool(t);
    }
  });
  async function load(file) {
    const im = await Formats.decodeImage(file);
    name = base(file.name);
    origBytes = file.size;
    origType = ext(file.name).toUpperCase();
    booted = true;
    setImage(im);
    setTool('none');
  }
  function sample() {
    const c = newCanvas(1200, 800),
      g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 520);
    sky.addColorStop(0, '#2c6e9b');
    sky.addColorStop(0.6, '#f2b26b');
    sky.addColorStop(1, '#f7d9a8');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1200, 800);
    g.fillStyle = '#fff4d6';
    g.beginPath();
    g.arc(840, 380, 70, 0, Math.PI * 2);
    g.fill();
    [
      ['#3f6b4a', 470, 0.004, 60],
      ['#2f5539', 540, 0.006, 45],
      ['#1f3d29', 620, 0.009, 35],
    ].forEach(([col, b, f, amp]) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(0, 800);
      for (let x = 0; x <= 1200; x += 10)
        g.lineTo(x, b + Math.sin(x * f + b) * amp + Math.sin(x * f * 2.7) * amp * 0.3);
      g.lineTo(1200, 800);
      g.fill();
    });
    for (let i = 0; i < 14; i++) {
      const x = 60 + i * 82,
        y = 690 + (i % 3) * 18;
      g.fillStyle = '#5a3a22';
      g.fillRect(x, y, 56, 30);
      g.fillStyle = '#7fb069';
      for (let j = 0; j < 4; j++) {
        g.beginPath();
        g.arc(x + 8 + j * 13, y - 4, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
    const id = g.getImageData(0, 0, 1200, 800);
    for (let j = 0; j < id.data.length; j += 4) {
      const nn = (Math.random() - 0.5) * 26;
      id.data[j] += nn;
      id.data[j + 1] += nn;
      id.data[j + 2] += nn;
    }
    g.putImageData(id, 0, 0);
    name = 'garden-sunset (example)';
    origBytes = 0;
    setImage(c);
    const L = LDEF();
    L.text = 'Harbor Street Garden';
    L.x = 48;
    L.y = 40;
    L.size = 64;
    L.font = 'Bricolage Grotesque';
    layers.push(L);
    renderLayers();
  }
  return {
    load,
    act,
    open: () => act('open'),
    save: () => act('png'),
    onShow() {
      booted = true;
      if (hasImage)
        setTimeout(() => {
          renderLayers();
          preview();
          info();
        }, 50);
    },
  };
})();
