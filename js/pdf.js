/* Inkwell — "Print all": one PDF with every student's writing, a name header on each page,
   and a blank page after any student who ends on an odd page, so double-sided printing keeps
   each student on their own sheets. Layout is done here (not by the browser) so page counts are exact. */
(function () {
  const PAGE_W = 612, PAGE_H = 792; // US Letter, points
  const M = { l: 72, r: 72, t: 72, b: 66 };
  const CW = PAGE_W - M.l - M.r;

  async function lib() {
    if (!window.PDFLib) await Ink.loadScript('vendor/pdf-lib.min.js?v=1');
    return window.PDFLib;
  }

  // Characters the built-in PDF fonts can't draw are swapped for close equivalents.
  const SWAP = { ' ': ' ', ' ': ' ', '​': '', '‑': '-', '‒': '-', '―': '—', '−': '-', '′': "'", '″': '"', '­': '' };
  function safeText(font, s) {
    s = String(s || '').replace(/[  ​‑‒―−′″­]/g, function (c) { return SWAP[c]; });
    let out = '';
    for (const ch of s) {
      if (font.__ok === undefined) font.__ok = new Map();
      let ok = font.__ok.get(ch);
      if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch (e) { ok = false; } font.__ok.set(ch, ok); }
      if (ok) out += ch;
      else {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        let ok2 = false;
        try { if (base && base !== ch) { font.encodeText(base); ok2 = true; } } catch (e) { ok2 = false; }
        out += ok2 ? base : '?';
      }
    }
    return out;
  }

  /* ── HTML → blocks of styled runs ── */
  function parse(html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body><div id="r">' + Ink.sanitize(html || '') + '</div>', 'text/html');
    const root = doc.getElementById('r');
    const blocks = [];
    let cur = null;
    function newBlock(kind, el, extra) {
      const align = (el && el.style && el.style.textAlign) || '';
      cur = Object.assign({ kind: kind, align: align, fi: !!(el && el.classList && el.classList.contains('fi')), runs: [] }, extra || {});
      blocks.push(cur);
      return cur;
    }
    function inline(n, st) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          if (!cur) newBlock('p', null);
          cur.runs.push({ text: c.data, b: st.b, i: st.i, u: st.u });
        } else if (c.nodeType === 1) {
          const t = c.tagName;
          if (t === 'BR') { if (!cur) newBlock('p', null); cur.runs.push({ br: true }); continue; }
          if (/^(P|DIV|H1|H2|H3|BLOCKQUOTE|UL|OL|LI)$/.test(t)) { block(c, st); continue; }
          inline(c, { b: st.b || t === 'B' || t === 'STRONG', i: st.i || t === 'I' || t === 'EM', u: st.u || t === 'U' });
        }
      }
    }
    function block(el, st, ctx) {
      const t = el.tagName;
      ctx = ctx || {};
      if (t === 'UL' || t === 'OL') {
        let n = 0;
        for (let c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 1 && c.tagName === 'LI') { n++; newBlock('li', c, { marker: t === 'OL' ? n + '.' : '•', depth: (ctx.depth || 0) + 1, quote: ctx.quote }); inline(c, st); cur = null; }
        }
        return;
      }
      if (t === 'BLOCKQUOTE') {
        let hasBlocks = false;
        for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && /^(P|DIV|UL|OL)$/.test(c.tagName)) hasBlocks = true;
        if (!hasBlocks) { newBlock('p', el, { quote: true }); inline(el, st); cur = null; return; }
        for (let c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 1) { if (/^(UL|OL)$/.test(c.tagName)) block(c, st, { quote: true }); else { newBlock('p', c, { quote: true }); inline(c, st); cur = null; } }
          else if (c.nodeType === 3 && c.data.trim()) { newBlock('p', el, { quote: true }); cur.runs.push({ text: c.data, b: st.b, i: st.i, u: st.u }); cur = null; }
        }
        return;
      }
      const kind = t === 'H1' ? 'h1' : t === 'H2' ? 'h2' : t === 'H3' ? 'h3' : 'p';
      newBlock(kind, el);
      inline(el, st);
      cur = null;
    }
    for (let c = root.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && /^(P|DIV|H1|H2|H3|BLOCKQUOTE|UL|OL)$/.test(c.tagName)) { cur = null; block(c, {}); }
      else if (c.nodeType === 3) { if (c.data.trim()) { if (!cur) newBlock('p', null); cur.runs.push({ text: c.data }); } }
      else if (c.nodeType === 1) { if (!cur) newBlock('p', null); inline(c, { b: c.tagName === 'B' || c.tagName === 'STRONG', i: c.tagName === 'I' || c.tagName === 'EM', u: c.tagName === 'U' }); }
    }
    return blocks.filter(function (b) { return b.runs.some(function (r) { return r.br || (r.text && r.text.trim()); }) || b.kind === 'p'; });
  }

  /* ── Writer: paginates and draws ── */
  function Writer(pdf, F, rgb, opts) {
    this.pdf = pdf; this.F = F; this.rgb = rgb; this.opts = opts;
    this.pages = []; this.page = null; this.y = 0;
  }
  Writer.prototype.newPage = function () {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - M.t;
    if (this.onPage) this.onPage(this.page, this.pages.length);
    return this.page;
  };
  Writer.prototype.ensure = function (h) { if (this.y - h < M.b) this.newPage(); };
  Writer.prototype.font = function (r) { const F = this.F; return r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r; };

  // Lay out styled runs into lines; returns [{items:[{text,font,size,u,w}], width, spaces, last}]
  Writer.prototype.lines = function (runs, size, width, firstIndent, baseBold) {
    const self = this;
    const lines = [];
    let line = { items: [], width: 0, indent: firstIndent || 0 };
    const pushLine = function (last) { line.last = !!last; lines.push(line); line = { items: [], width: 0, indent: 0 }; };
    const avail = function () { return width - line.indent; };
    runs.forEach(function (r) {
      if (r.br) { pushLine(true); return; }
      const font = self.font({ b: r.b || baseBold, i: r.i });
      const text = safeText(font, r.text || '').replace(/[\r\n\t]+/g, ' ');
      const parts = text.split(/( +)/);
      parts.forEach(function (p) {
        if (!p) return;
        const isSpace = /^ +$/.test(p);
        if (isSpace) {
          if (!line.items.length) return;
          const w = font.widthOfTextAtSize(' ', size);
          line.items.push({ text: ' ', font: font, size: size, u: r.u, w: w, space: true });
          line.width += w;
          return;
        }
        let w = font.widthOfTextAtSize(p, size);
        if (line.width + w > avail() && line.items.length) {
          while (line.items.length && line.items[line.items.length - 1].space) line.width -= line.items.pop().w;
          pushLine(false);
        }
        // a single word wider than the line: break it
        let word = p;
        while (font.widthOfTextAtSize(word, size) > avail() && word.length > 1) {
          let k = word.length - 1;
          while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > avail() - line.width) k--;
          const head = word.slice(0, k);
          line.items.push({ text: head, font: font, size: size, u: r.u, w: font.widthOfTextAtSize(head, size) });
          pushLine(false);
          word = word.slice(k);
        }
        w = font.widthOfTextAtSize(word, size);
        line.items.push({ text: word, font: font, size: size, u: r.u, w: w });
        line.width += w;
      });
    });
    while (line.items.length && line.items[line.items.length - 1].space) line.width -= line.items.pop().w;
    if (line.items.length || !lines.length) pushLine(true);
    return lines;
  };

  Writer.prototype.drawLines = function (lines, x0, width, lh, align, color) {
    const self = this;
    const col = color || this.rgb(0.07, 0.07, 0.07);
    lines.forEach(function (ln) {
      self.ensure(lh);
      const baseline = self.y - lh + (lh - ln.items.reduce(function (m, it) { return Math.max(m, it.size); }, 12)) / 2 + 2;
      const x = x0 + (ln.indent || 0);
      const room = width - (ln.indent || 0);
      let extra = 0, spaceAdd = 0;
      if (align === 'center') extra = (room - ln.width) / 2;
      else if (align === 'right') extra = room - ln.width;
      else if (align === 'justify' && !ln.last) {
        const n = ln.items.filter(function (it) { return it.space; }).length;
        if (n) spaceAdd = (room - ln.width) / n;
      }
      let cx = x + Math.max(0, extra);
      ln.items.forEach(function (it) {
        if (!it.space) self.page.drawText(it.text, { x: cx, y: baseline, size: it.size, font: it.font, color: col });
        const w = it.w + (it.space ? spaceAdd : 0);
        if (it.u) self.page.drawLine({ start: { x: cx, y: baseline - 1.6 }, end: { x: cx + w, y: baseline - 1.6 }, thickness: 0.6, color: col });
        cx += w;
      });
      self.y -= lh;
    });
  };

  Writer.prototype.text = function (str, o) {
    o = o || {};
    const size = o.size || 11;
    const font = o.font || this.F.r;
    const lines = this.lines([{ text: str, b: o.bold, i: o.italic }], size, (o.width || CW) - (o.indent || 0), 0, false);
    if (o.fontOverride) lines.forEach(function (l) { l.items.forEach(function (it) { it.font = o.fontOverride; it.w = o.fontOverride.widthOfTextAtSize(it.text, size); }); l.width = l.items.reduce(function (s, it) { return s + it.w; }, 0); });
    this.drawLines(lines, M.l + (o.indent || 0), (o.width || CW) - (o.indent || 0), o.lh || size * 1.4, o.align, o.color);
    void font;
  };

  Writer.prototype.essay = function (blocks, dbl) {
    const self = this;
    if (!blocks.length) { this.text('(No writing yet)', { italic: true, color: this.rgb(0.45, 0.45, 0.45) }); return; }
    blocks.forEach(function (b, bi) {
      const isH = b.kind[0] === 'h';
      const size = b.kind === 'h1' ? 16 : b.kind === 'h2' ? 14 : 12;
      const lh = isH ? size * 1.45 : size * (dbl ? 2 : 1.5);
      const left = (b.quote ? 36 : 0) + (b.kind === 'li' ? 18 * (b.depth || 1) + 6 : 0);
      const width = CW - left - (b.quote ? 18 : 0);
      const align = b.align || (b.kind === 'h1' ? 'center' : 'left');
      if (isH && bi > 0) self.y -= size * 0.4;
      const lines = self.lines(b.runs, size, width, b.fi && !isH ? 36 : 0, isH);
      if (isH) self.ensure(lh * Math.min(lines.length, 2) + 30); // keep headings with what follows
      if (b.kind === 'li') {
        self.ensure(lh);
        const mf = self.F.r;
        const baseline = self.y - lh + (lh - size) / 2 + 2;
        self.page.drawText(b.marker, { x: M.l + left - 16, y: baseline, size: size, font: mf, color: self.rgb(0.07, 0.07, 0.07) });
      }
      self.drawLines(lines, M.l + left, width, lh, align);
      if (!dbl || isH) self.y -= isH ? size * 0.35 : 4;
    });
  };

  async function build(items, assignment, opts) {
    opts = opts || {};
    const P = await lib();
    const pdf = await P.PDFDocument.create();
    pdf.setTitle(assignment.title || 'Student writing');
    pdf.setCreator('Inkwell');
    const F = {
      r: await pdf.embedFont(P.StandardFonts.TimesRoman), b: await pdf.embedFont(P.StandardFonts.TimesRomanBold),
      i: await pdf.embedFont(P.StandardFonts.TimesRomanItalic), bi: await pdf.embedFont(P.StandardFonts.TimesRomanBoldItalic),
      h: await pdf.embedFont(P.StandardFonts.Helvetica), hb: await pdf.embedFont(P.StandardFonts.HelveticaBold), hi: await pdf.embedFont(P.StandardFonts.HelveticaOblique)
    };
    const rgb = P.rgb;
    const grey = rgb(0.42, 0.42, 0.42);
    const W = new Writer(pdf, F, rgb, opts);
    const stats = [];
    const title = assignment.title || '';
    const R = Ink.Rubric;

    items.forEach(function (it) {
      const startIdx = W.pages.length;
      const name = (it.first + ' ' + it.last).trim();
      const hdr = safeText(F.h, name + (it.className ? '  ·  ' + it.className : ''));
      const ttl = safeText(F.h, title.length > 60 ? title.slice(0, 58) + '…' : title);
      W.onPage = function (pg, n) {
        if (n - startIdx > 1) {
          pg.drawText(hdr, { x: M.l, y: PAGE_H - 40, size: 9, font: F.hb, color: grey });
          const tw = F.h.widthOfTextAtSize(ttl, 9);
          pg.drawText(ttl, { x: PAGE_W - M.r - tw, y: PAGE_H - 40, size: 9, font: F.h, color: grey });
          pg.drawLine({ start: { x: M.l, y: PAGE_H - 46 }, end: { x: PAGE_W - M.r, y: PAGE_H - 46 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
        }
      };
      W.newPage();
      // Name block on the first page
      const pg = W.page;
      const meta = (it.status === 'submitted' ? 'Submitted ' + new Date(it.submittedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Draft — not submitted') + '  ·  ' + it.words + ' words';
      const metaS = safeText(F.h, meta);
      const mw = F.h.widthOfTextAtSize(metaS, 9.5);
      pg.drawText(safeText(F.hb, name), { x: M.l, y: PAGE_H - 54, size: 15, font: F.hb, color: rgb(0.1, 0.1, 0.1) });
      pg.drawText(metaS, { x: PAGE_W - M.r - mw, y: PAGE_H - 54, size: 9.5, font: F.h, color: grey });
      let sub = safeText(F.h, [it.className, title].filter(Boolean).join('  ·  '));
      while (sub.length > 4 && F.h.widthOfTextAtSize(sub, 9.5) > CW) sub = sub.slice(0, -2).replace(/\s+$/, '');
      if (sub !== safeText(F.h, [it.className, title].filter(Boolean).join('  ·  '))) sub += '...';
      pg.drawText(sub, { x: M.l, y: PAGE_H - 70, size: 9.5, font: F.h, color: grey });
      pg.drawLine({ start: { x: M.l, y: PAGE_H - 80 }, end: { x: PAGE_W - M.r, y: PAGE_H - 80 }, thickness: 0.8, color: rgb(0.55, 0.17, 0.22) });
      W.y = PAGE_H - 102;
      W.essay(parse(it.html), opts.doubleSpace);

      const g0 = it.grade && (Object.keys(it.grade.scores || {}).length || it.grade.comment) ? it.grade : null;
      if (opts.feedback && ((assignment.rubric && g0) || (g0 && g0.comment) || (it.comments && it.comments.length))) {
        W.newPage();
        W.text('Feedback', { fontOverride: F.hb, size: 14, lh: 20 });
        W.y -= 4;
        const g = it.grade || {};
        if (assignment.rubric && assignment.rubric.criteria && g0) {
          const rb = assignment.rubric;
          rb.criteria.forEach(function (c) {
            const sel = g.scores ? g.scores[c.id] : undefined;
            const lv = sel !== undefined && sel !== null ? rb.levels[sel] : null;
            const pts = lv ? R.critPoints(rb, c, sel) : null;
            W.ensure(46);
            const line = c.name + ':  ' + (lv ? lv.label + '  (' + R.fmt(pts) + ' / ' + R.fmt(R.topPoints(rb) * (Number(c.weight) || 1)) + ')' : 'not scored');
            W.text(line, { fontOverride: F.hb, size: 10.5, lh: 15 });
            if (lv && c.cells && c.cells[sel]) W.text(c.cells[sel], { fontOverride: F.h, size: 9.5, lh: 13, indent: 12, color: grey });
            W.y -= 5;
          });
          W.ensure(24);
          W.text('Total:  ' + R.fmt(R.total(rb, g.scores || {})) + ' / ' + R.fmt(R.max(rb)), { fontOverride: F.hb, size: 12, lh: 20 });
          W.y -= 6;
        }
        if (g.comment) {
          W.ensure(40);
          W.text('Comments', { fontOverride: F.hb, size: 11, lh: 16 });
          String(g.comment).split(/\n+/).forEach(function (para) { if (para.trim()) { W.text(para, { size: 11, lh: 15 }); W.y -= 3; } });
          W.y -= 6;
        }
        if (it.comments && it.comments.length) {
          W.ensure(40);
          W.text('Comments in the writing', { fontOverride: F.hb, size: 11, lh: 16 });
          it.comments.forEach(function (c) {
            W.ensure(30);
            const q = c.quote.length > 140 ? c.quote.slice(0, 137) + '…' : c.quote;
            W.text('“' + q + '”', { fontOverride: F.hi, size: 9.5, lh: 13, color: grey });
            W.text(c.text + (c.resolved ? '   (checked off by student)' : ''), { size: 11, lh: 15, indent: 12 });
            W.y -= 4;
          });
        }
      }

      const n = W.pages.length - startIdx;
      // Page numbers for this student
      for (let k = 0; k < n; k++) {
        const pgk = W.pages[startIdx + k];
        const label = safeText(F.h, name + '  ·  page ' + (k + 1) + ' of ' + n);
        const lw = F.h.widthOfTextAtSize(label, 8.5);
        pgk.drawText(label, { x: (PAGE_W - lw) / 2, y: 36, size: 8.5, font: F.h, color: grey });
      }
      let padded = false;
      if (opts.duplex && n % 2 === 1) {
        W.onPage = null;
        const blank = W.newPage();
        const t = 'This page is intentionally blank.';
        blank.drawText(t, { x: (PAGE_W - F.hi.widthOfTextAtSize(t, 8)) / 2, y: 36, size: 8, font: F.hi, color: rgb(0.72, 0.72, 0.72) });
        padded = true;
      }
      stats.push({ name: name, pages: n, padded: padded });
    });

    const bytes = await pdf.save();
    return { bytes: bytes, pages: W.pages.length, stats: stats };
  }

  /** Builds the PDF and opens it in a tab (pass a window opened during the click, to dodge pop-up blockers). */
  async function open(items, assignment, opts, win) {
    const r = await build(items, assignment, opts);
    const blob = new Blob([r.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    if (win && !win.closed) win.location.href = url;
    else {
      const w = window.open(url, '_blank');
      if (!w) {
        const a = document.createElement('a');
        a.href = url; a.download = (assignment.title || 'writing') + '.pdf';
        document.body.appendChild(a); a.click(); a.remove();
      }
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 10 * 60 * 1000);
    return r;
  }

  window.Ink.PDF = { build: build, open: open, parse: parse };
})();
