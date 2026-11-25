'use strict';
/* ============================== FORMULA ENGINE ==============================
   Turns spreadsheet formulas into JavaScript. compile() is the security boundary:
   only cell references, ranges, numbers, strings, operators and FN functions may
   reach new Function. test/formula.test.js checks it. */
const Formula = (() => {
  const colName = (c) => {
    let s = '';
    c++;
    while (c) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  };
  const colIdx = (s) => {
    let n = 0;
    for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  const key = (r, c) => colName(c) + (r + 1);
  const parseRef = (s) => {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim());
    return m ? { r: +m[2] - 1, c: colIdx(m[1]) } : null;
  };
  class FErr {
    constructor(code) {
      this.code = code;
    }
    valueOf() {
      return NaN;
    }
    toString() {
      return this.code;
    }
  }
  const ERR = (c) => new FErr(c);
  const compiled = new Map();
  const EPOCH = Date.UTC(1899, 11, 30);
  const toSerial = (d) =>
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5 +
    (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  const fromSerial = (n) => {
    const d = new Date(EPOCH + Math.round(n * 864e5));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  };
  const flat = (a) => a.flat(Infinity);
  const nums = (a) => flat(a).filter((v) => typeof v === 'number' && !isNaN(v));
  const isErr = (v) => v instanceof FErr || (typeof v === 'number' && !isFinite(v));
  const eq = (a, b) =>
    typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;
  function crit(c) {
    if (typeof c === 'number') return (v) => v === c;
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(c));
    const op = m[1] || '=',
      rhs = m[2];
    const n = parseFloat(rhs);
    const isN = rhs !== '' && !isNaN(n) && isFinite(rhs);
    const re = /[*?]/.test(rhs)
      ? new RegExp('^' + escRe(rhs).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$', 'i')
      : null;
    return (v) => {
      if (isN && typeof v === 'number')
        return { '=': v === n, '<>': v !== n, '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n }[op];
      const s = v == null ? '' : String(v);
      if (op === '=') return re ? re.test(s) : s.toLowerCase() === rhs.toLowerCase();
      if (op === '<>') return re ? !re.test(s) : s.toLowerCase() !== rhs.toLowerCase();
      return false;
    };
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const FN = {
    SUM: (...a) => sum(nums(a)),
    AVERAGE: (...a) => {
      const n = nums(a);
      return n.length ? sum(n) / n.length : ERR('#DIV/0!');
    },
    AVG: (...a) => FN.AVERAGE(...a),
    MIN: (...a) => {
      const n = nums(a);
      return n.length ? Math.min(...n) : 0;
    },
    MAX: (...a) => {
      const n = nums(a);
      return n.length ? Math.max(...n) : 0;
    },
    COUNT: (...a) => nums(a).length,
    COUNTA: (...a) => flat(a).filter((v) => v !== null && v !== '').length,
    COUNTBLANK: (...a) => flat(a).filter((v) => v === null || v === '').length,
    PRODUCT: (...a) => nums(a).reduce((x, y) => x * y, 1),
    MEDIAN: (...a) => {
      const n = nums(a).sort((x, y) => x - y);
      if (!n.length) return ERR('#NUM!');
      const m = n.length >> 1;
      return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
    },
    STDEV: (...a) => {
      const n = nums(a);
      if (n.length < 2) return ERR('#DIV/0!');
      const m = sum(n) / n.length;
      return Math.sqrt(sum(n.map((x) => (x - m) ** 2)) / (n.length - 1));
    },
    VAR: (...a) => FN.STDEV(...a) ** 2,
    LARGE: (r, k) => nums([r]).sort((x, y) => y - x)[k - 1] ?? ERR('#NUM!'),
    SMALL: (r, k) => nums([r]).sort((x, y) => x - y)[k - 1] ?? ERR('#NUM!'),
    ROUND: (x, d = 0) => {
      const k = 10 ** d;
      return Math.round(x * k) / k;
    },
    ROUNDUP: (x, d = 0) => {
      const k = 10 ** d;
      return (Math.sign(x) * Math.ceil(Math.abs(x) * k)) / k;
    },
    ROUNDDOWN: (x, d = 0) => {
      const k = 10 ** d;
      return (Math.sign(x) * Math.floor(Math.abs(x) * k)) / k;
    },
    INT: (x) => Math.floor(x),
    ABS: (x) => Math.abs(x),
    SQRT: (x) => (x < 0 ? ERR('#NUM!') : Math.sqrt(x)),
    POWER: (a, b) => a ** b,
    MOD: (a, b) => (b === 0 ? ERR('#DIV/0!') : a - b * Math.floor(a / b)),
    EXP: (x) => Math.exp(x),
    LN: (x) => Math.log(x),
    LOG10: (x) => Math.log10(x),
    LOG: (x, b = 10) => Math.log(x) / Math.log(b),
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    CEILING: (x, s = 1) => Math.ceil(x / s) * s,
    FLOOR: (x, s = 1) => Math.floor(x / s) * s,
    SIGN: (x) => Math.sign(x),
    IF: (c, a, b = false) => (c ? a : b),
    IFERROR: (v, alt) => (isErr(v) ? alt : v),
    IFS: (...a) => {
      for (let i = 0; i < a.length; i += 2) if (a[i]) return a[i + 1];
      return ERR('#N/A');
    },
    AND: (...a) => flat(a).every(Boolean),
    OR: (...a) => flat(a).some(Boolean),
    NOT: (x) => !x,
    XOR: (...a) => flat(a).filter(Boolean).length % 2 === 1,
    ISBLANK: (x) => x === null || x === '',
    ISNUMBER: (x) => typeof x === 'number' && !isNaN(x),
    ISTEXT: (x) => typeof x === 'string',
    ISERROR: (x) => isErr(x),
    CONCAT: (...a) =>
      flat(a)
        .map((v) => v ?? '')
        .join(''),
    CONCATENATE: (...a) => FN.CONCAT(...a),
    TEXTJOIN: (d, ig, ...a) =>
      flat(a)
        .filter((v) => !(ig && (v === null || v === '')))
        .map((v) => v ?? '')
        .join(d),
    LEN: (s) => String(s ?? '').length,
    UPPER: (s) => String(s ?? '').toUpperCase(),
    LOWER: (s) => String(s ?? '').toLowerCase(),
    PROPER: (s) =>
      String(s ?? '')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    TRIM: (s) =>
      String(s ?? '')
        .trim()
        .replace(/\s+/g, ' '),
    LEFT: (s, n = 1) => String(s ?? '').slice(0, n),
    RIGHT: (s, n = 1) => (n ? String(s ?? '').slice(-n) : ''),
    MID: (s, i, n) => String(s ?? '').substr(i - 1, n),
    SUBSTITUTE: (s, a, b) =>
      String(s ?? '')
        .split(String(a))
        .join(String(b)),
    REPT: (s, n) => String(s).repeat(Math.max(0, n)),
    FIND: (a, s) => {
      const i = String(s).indexOf(a);
      return i < 0 ? ERR('#VALUE!') : i + 1;
    },
    SEARCH: (a, s) => {
      const i = String(s).toLowerCase().indexOf(String(a).toLowerCase());
      return i < 0 ? ERR('#VALUE!') : i + 1;
    },
    VALUE: (s) => {
      const n = parseFloat(String(s).replace(/[$,%]/g, ''));
      return isNaN(n) ? ERR('#VALUE!') : n;
    },
    TEXT: (v, f) =>
      typeof v === 'number'
        ? /%/.test(f)
          ? (v * 100).toFixed((f.split('.')[1] || '').replace(/[^0]/g, '').length) + '%'
          : v.toFixed((String(f).split('.')[1] || '').replace(/[^0#]/g, '').length)
        : String(v),
    TODAY: () => Math.floor(toSerial(new Date())),
    NOW: () => toSerial(new Date()),
    DATE: (y, m, d) => toSerial(new Date(y, m - 1, d)),
    YEAR: (n) => fromSerial(n).getFullYear(),
    MONTH: (n) => fromSerial(n).getMonth() + 1,
    DAY: (n) => fromSerial(n).getDate(),
    WEEKDAY: (n) => fromSerial(n).getDay() + 1,
    DAYS: (a, b) => Math.round(a - b),
    COUNTIF: (r, c) => flat([r]).filter(crit(c)).length,
    SUMIF: (r, c, s) => {
      const a = flat([r]),
        b = s ? flat([s]) : a,
        f = crit(c);
      return a.reduce((t, v, i) => t + (f(v) && typeof b[i] === 'number' ? b[i] : 0), 0);
    },
    AVERAGEIF: (r, c, s) => {
      const a = flat([r]),
        b = s ? flat([s]) : a,
        f = crit(c);
      const v = a.map((x, i) => (f(x) ? b[i] : null)).filter((x) => typeof x === 'number');
      return v.length ? sum(v) / v.length : ERR('#DIV/0!');
    },
    VLOOKUP: (v, t, col, approx = true) => {
      if (!Array.isArray(t)) return ERR('#REF!');
      for (const row of t) if (eq(row[0], v)) return row[col - 1] ?? ERR('#REF!');
      if (approx && typeof v === 'number') {
        let hit = null;
        for (const row of t) if (typeof row[0] === 'number' && row[0] <= v) hit = row;
        if (hit) return hit[col - 1];
      }
      return ERR('#N/A');
    },
    HLOOKUP: (v, t, row, approx = true) => {
      if (!Array.isArray(t)) return ERR('#REF!');
      const i = t[0].findIndex((x) => eq(x, v));
      return i < 0 ? ERR('#N/A') : (t[row - 1]?.[i] ?? ERR('#REF!'));
    },
    INDEX: (t, r, c = 1) => (Array.isArray(t) ? (t[r - 1]?.[c - 1] ?? ERR('#REF!')) : t),
    MATCH: (v, r, type = 1) => {
      const a = flat([r]);
      const i = a.findIndex((x) => eq(x, v));
      if (i >= 0) return i + 1;
      if (type === 1 && typeof v === 'number') {
        let k = -1;
        a.forEach((x, j) => {
          if (typeof x === 'number' && x <= v) k = j;
        });
        if (k >= 0) return k + 1;
      }
      return ERR('#N/A');
    },
    XLOOKUP: (v, l, r, nf) => {
      const a = flat([l]),
        b = flat([r]);
      const i = a.findIndex((x) => eq(x, v));
      return i < 0 ? (nf ?? ERR('#N/A')) : b[i];
    },
  };
  function rewriteRefs(src, fn) {
    // apply fn to every unqualified cell reference outside string literals
    return src
      .split(/("(?:[^"]|"")*")/)
      .map((part, i) =>
        i % 2
          ? part
          : part.replace(
              /(?<![A-Za-z0-9_!.])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g,
              (m, d1, col, d2, row) => fn(d1, col.toUpperCase(), d2, +row) ?? m,
            ),
      )
      .join('');
  }
  const shiftFormula = (src, dr, dc) =>
    rewriteRefs(src, (d1, col, d2, row) => {
      const c = d1 ? colIdx(col) : colIdx(col) + dc,
        r = d2 ? row : row + dr;
      return c < 0 || r < 1 ? '#REF!' : d1 + colName(c) + d2 + r;
    });
  function compile(src) {
    if (compiled.has(src)) return compiled.get(src);
    const strs = [],
      toks = [];
    const T = (x) => {
      toks.push(x);
      return `\u0002${toks.length - 1}\u0002`;
    };
    let s = src.replace(/"((?:[^"]|"")*)"/g, (m, a) => {
      strs.push(a.replace(/""/g, '"'));
      return `\u0001${strs.length - 1}\u0001`;
    });
    s = s.replace(
      /(?:'([^']+)'|([A-Za-z_][\w.]*))!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/g,
      (m, q, b, c1, r1, c2, r2) => {
        const sn = JSON.stringify(q || b);
        return T(
          c2
            ? `R(${sn},"${c1.toUpperCase()}${r1}","${c2.toUpperCase()}${r2}")`
            : `C(${sn},"${c1.toUpperCase()}${r1}")`,
        );
      },
    );
    s = s.replace(/\$?([A-Za-z]{1,3})\$?(\d+)\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+)/g, (m, a, b, c, d) =>
      T(`R(null,"${a.toUpperCase()}${b}","${c.toUpperCase()}${d}")`),
    );
    s = s.replace(/(?<![A-Za-z0-9_])\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_(])/g, (m, a, b) =>
      T(`R(null,"${a.toUpperCase()}1","${b.toUpperCase()}100000")`),
    );
    s = s.replace(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g, (m, n) => {
      const N = n.toUpperCase().replace(/\./g, '_');
      if (!FN[N]) throw ERR('#NAME?');
      return T(`F.${N}(`);
    });
    s = s.replace(/(?<![A-Za-z0-9_])\$?([A-Za-z]{1,3})\$?(\d+)(?![A-Za-z0-9_])/g, (m, a, b) =>
      T(`C(null,"${a.toUpperCase()}${b}")`),
    );
    s = s.replace(/\b(TRUE|FALSE)\b/gi, (m) => T(m.toLowerCase()));
    s = s
      .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')
      .replace(/<>/g, '!=')
      .replace(/(?<![<>!=])=(?!=)/g, '===')
      .replace(/!=(?!=)/g, '!==')
      .replace(/\^/g, '**')
      .replace(/&/g, '+""+');
    const bare = s.replace(/\u0001\d+\u0001|\u0002\d+\u0002/g, '');
    if (/[A-Za-z_$`[\]{};\\]/.test(bare) || /=>/.test(bare)) throw ERR('#ERROR!');
    s = s
      .replace(/\u0002(\d+)\u0002/g, (m, i) => toks[i])
      .replace(/\u0001(\d+)\u0001/g, (m, i) => JSON.stringify(strs[i]));
    let fn;
    try {
      fn = new Function('C', 'R', 'F', '"use strict";return (' + s + ');');
    } catch {
      throw ERR('#ERROR!');
    }
    compiled.set(src, fn);
    return fn;
  }
  return {
    FErr,
    ERR,
    FN,
    compile,
    clearCache: () => compiled.clear(),
    rewriteRefs,
    shiftFormula,
    colName,
    colIdx,
    key,
    parseRef,
    flat,
    sum,
    fromSerial,
  };
})();
