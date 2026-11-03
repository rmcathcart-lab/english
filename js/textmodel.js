/* Inkwell — map between a document's DOM and its plain text, anchor comments to quotes,
   and paint highlights without touching the document (CSS Custom Highlight API). */
(function () {
  const BLOCK = { P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, LI: 1, BLOCKQUOTE: 1, UL: 1, OL: 1 };

  /** Build { text, segs:[{node,start,end}] } for everything inside root. */
  function model(root) {
    let text = '';
    const segs = [];
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const t = c.data.replace(/ /g, ' ');
          if (!t.length) continue;
          segs.push({ node: c, start: text.length, end: text.length + t.length });
          text += t;
        } else if (c.nodeType === 1) {
          const tag = c.tagName;
          if (tag === 'BR') { text += '\n'; continue; }
          const block = BLOCK[tag];
          if (block && text.length && text[text.length - 1] !== '\n') text += '\n';
          walk(c);
          if (block && text.length && text[text.length - 1] !== '\n') text += '\n';
        }
      }
    })(root);
    return { root: root, text: text, segs: segs };
  }

  function firstText(n) {
    if (!n) return null;
    if (n.nodeType === 3) return n;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    return w.nextNode();
  }
  function lastText(n) {
    if (!n) return null;
    if (n.nodeType === 3) return n;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    let t = null, x;
    while ((x = w.nextNode())) t = x;
    return t;
  }

  /** DOM position → text index. */
  function indexOf(m, node, offset) {
    if (node.nodeType !== 3) {
      const kids = node.childNodes;
      if (offset < kids.length) {
        const t = firstText(kids[offset]);
        if (t) return indexOf(m, t, 0);
        // nothing after it inside: fall through to the end of what precedes
        const p = lastText(kids[offset - 1]);
        if (p) return indexOf(m, p, p.data.length);
        return segIndexAfter(m, node);
      }
      const t = lastText(node);
      return t ? indexOf(m, t, t.data.length) : segIndexAfter(m, node);
    }
    for (let i = 0; i < m.segs.length; i++) {
      if (m.segs[i].node === node) return m.segs[i].start + Math.min(offset, m.segs[i].end - m.segs[i].start);
    }
    return -1;
  }
  function segIndexAfter(m, node) {
    for (let i = 0; i < m.segs.length; i++) {
      if (node.compareDocumentPosition(m.segs[i].node) & Node.DOCUMENT_POSITION_FOLLOWING) return m.segs[i].start;
    }
    return m.text.length;
  }

  /** Text index → DOM position. */
  function posOf(m, i, preferEnd) {
    const s = m.segs;
    for (let k = 0; k < s.length; k++) {
      if (i < s[k].end || (i === s[k].end && (preferEnd || !s[k + 1] || s[k + 1].start > i))) {
        if (i < s[k].start) return { node: s[k].node, offset: 0 };
        return { node: s[k].node, offset: i - s[k].start };
      }
    }
    const last = s[s.length - 1];
    return last ? { node: last.node, offset: last.node.data.length } : { node: m.root, offset: 0 };
  }

  function rangeOf(m, start, end) {
    const a = posOf(m, start, false), b = posOf(m, end, true);
    const r = document.createRange();
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch (e) { return null; }
    return r;
  }

  function selectionIndices(m) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!m.root.contains(r.startContainer) || !m.root.contains(r.endContainer)) return null;
    const s = indexOf(m, r.startContainer, r.startOffset), e = indexOf(m, r.endContainer, r.endOffset);
    if (s < 0 || e < 0) return null;
    return { start: Math.min(s, e), end: Math.max(s, e), collapsed: r.collapsed };
  }

  /* ── Quote anchors ── */
  function anchorFor(m, start, end) {
    // trim whitespace from the edges
    while (start < end && /\s/.test(m.text[start])) start++;
    while (end > start && /\s/.test(m.text[end - 1])) end--;
    if (end <= start) return null;
    return { quote: m.text.slice(start, end), prefix: m.text.slice(Math.max(0, start - 32), start), suffix: m.text.slice(end, end + 32), offset: start };
  }

  function commonSuffixLen(a, b) { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
  function commonPrefixLen(a, b) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }

  /** Find where an anchor sits in the current text. Returns {start,end} or null if the quoted text is gone. */
  function locate(m, a) {
    if (!a || !a.quote) return null;
    const t = m.text;
    let best = null, bestScore = -1e9, i = t.indexOf(a.quote);
    while (i >= 0) {
      const score = commonSuffixLen(t.slice(Math.max(0, i - 32), i), a.prefix || '') * 2 +
        commonPrefixLen(t.slice(i + a.quote.length, i + a.quote.length + 32), a.suffix || '') * 2 -
        Math.abs(i - (a.offset || 0)) / 50;
      if (score > bestScore) { bestScore = score; best = { start: i, end: i + a.quote.length }; }
      i = t.indexOf(a.quote, i + 1);
    }
    if (best) return best;
    // Whitespace may have changed: try a looser match.
    const esc = a.quote.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (esc.length < 3) return null;
    try {
      const re = new RegExp(esc, 'g');
      let mm, bd = 1e12;
      while ((mm = re.exec(t))) {
        const d = Math.abs(mm.index - (a.offset || 0));
        if (d < bd) { bd = d; best = { start: mm.index, end: mm.index + mm[0].length }; }
      }
    } catch (e) { /* ignore */ }
    return best;
  }

  /* ── Highlights ── */
  const HAS = !!(window.CSS && CSS.highlights && window.Highlight);
  function paint(name, ranges) {
    if (!HAS) return false;
    const list = (ranges || []).filter(Boolean);
    if (!list.length) { CSS.highlights.delete(name); return true; }
    const h = new Highlight();
    list.forEach(function (r) { h.add(r); });
    CSS.highlights.set(name, h);
    return true;
  }
  function clear(name) { if (HAS) CSS.highlights.delete(name); }

  /** Read-only fallback when the Highlight API is missing: wrap text in <mark>. Mutates root. */
  function markFallback(m, spans) {
    // spans: [{start,end,cls,id}], applied right-to-left so indices stay valid
    spans.slice().sort(function (a, b) { return b.start - a.start; }).forEach(function (sp) {
      const segs = m.segs.filter(function (s) { return s.end > sp.start && s.start < sp.end; });
      segs.reverse().forEach(function (s) {
        const node = s.node;
        const a = Math.max(0, sp.start - s.start), b = Math.min(node.data.length, sp.end - s.start);
        if (b <= a) return;
        let mid = node;
        if (a > 0) mid = node.splitText(a);
        if (b - a < mid.data.length) mid.splitText(b - a);
        const mk = document.createElement('mark');
        mk.className = sp.cls || 'cmt-mark';
        if (sp.id) mk.dataset.cid = sp.id;
        mid.parentNode.insertBefore(mk, mid);
        mk.appendChild(mid);
      });
    });
  }

  /** Index under a mouse point (for clicks on highlighted text). */
  function indexAtPoint(m, x, y) {
    let node = null, off = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; off = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; off = r.startOffset; }
    }
    if (!node || !m.root.contains(node)) return -1;
    return indexOf(m, node, off);
  }

  /** Words with their positions. */
  const WORD_RE = /[A-Za-zÀ-ɏ]+(?:['’][A-Za-zÀ-ɏ]+)*/g;
  function words(m) {
    const out = [];
    let r;
    WORD_RE.lastIndex = 0;
    while ((r = WORD_RE.exec(m.text))) out.push({ w: r[0], start: r.index, end: r.index + r[0].length });
    return out;
  }

  function wordAt(m, i) {
    const t = m.text;
    let s = i, e = i;
    const isW = function (ch) { return /[A-Za-zÀ-ɏ'’]/.test(ch || ''); };
    while (s > 0 && isW(t[s - 1])) s--;
    while (e < t.length && isW(t[e])) e++;
    while (s < e && /['’]/.test(t[s])) s++;
    while (e > s && /['’]/.test(t[e - 1])) e--;
    return e > s ? { w: t.slice(s, e), start: s, end: e } : null;
  }

  window.Ink = window.Ink || {};
  Ink.Text = {
    model: model, indexOf: indexOf, posOf: posOf, rangeOf: rangeOf, selection: selectionIndices,
    anchorFor: anchorFor, locate: locate, paint: paint, clear: clear, markFallback: markFallback,
    indexAtPoint: indexAtPoint, words: words, wordAt: wordAt, hasHighlights: HAS
  };
})();
