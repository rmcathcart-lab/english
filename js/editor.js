/* Inkwell — a small, purpose-built rich text editor (no fonts, just structure). */
(function () {
  const I = {
    bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg>',
    italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 5h-4M14 19h-4M15 5l-6 14"/></svg>',
    underline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
    center: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
    justify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>',
    indent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 6h9M4 10h16M4 14h16M4 18h16M4 4.5l3 2-3 2"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h11M9 10h11M9 14h11M9 18h11M4 5v14"/></svg>',
    ul: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg>',
    ol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.5V9M3.5 9h3M3.5 14.5c.5-1 2.8-1 2.8.4 0 1.2-2.8 2-2.8 3.6h3" stroke-width="1.5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    spacing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h10M10 12h10M10 18h10M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2"/></svg>'
  };

  const BLOCKS = 'P,DIV,H1,H2,H3,LI,BLOCKQUOTE';

  /**
   * Ink.makeEditor(host, opts) → { el, toolbar, getHTML, setHTML, focus, setEditable, onInput }
   * opts: { placeholder, spacing (bool: show double-space toggle), compact }
   */
  window.Ink.makeEditor = function (host, opts) {
    opts = opts || {};
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML =
      '<select class="tb-select" data-block title="Text style"><option value="p">Normal text</option><option value="h1">Title</option><option value="h2">Heading</option></select>' +
      btn('bold', 'Bold (Ctrl+B)') + btn('italic', 'Italic (Ctrl+I)') + btn('underline', 'Underline (Ctrl+U)') +
      '<span class="sep"></span>' +
      btn('left', 'Align left', 'justifyLeft') + btn('center', 'Center', 'justifyCenter') + btn('right', 'Align right', 'justifyRight') + btn('justify', 'Justify', 'justifyFull') +
      '<span class="sep"></span>' +
      btn('indent', 'Indent first line of paragraph (Tab)', 'firstIndent') + btn('quote', 'Block quote', 'blockquote') +
      '<span class="sep"></span>' +
      btn('ul', 'Bulleted list', 'insertUnorderedList') + btn('ol', 'Numbered list', 'insertOrderedList') +
      '<span class="sep"></span>' +
      btn('undo', 'Undo (Ctrl+Z)') + btn('redo', 'Redo (Ctrl+Y)') +
      (opts.spacing ? '<span class="sep"></span>' + btn('spacing', 'Double spacing', 'spacing') : '');

    const el = document.createElement('div');
    el.className = 'doc';
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-multiline', 'true');
    el.setAttribute('data-placeholder', opts.placeholder || 'Start writing…');
    // Ask writing assistants, autofill and AI writing suggestions to stay out.
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'sentences');
    el.setAttribute('writingsuggestions', 'false');
    el.setAttribute('data-gramm', 'false');
    el.setAttribute('data-gramm_editor', 'false');
    el.setAttribute('data-enable-grammarly', 'false');
    el.setAttribute('data-lt-active', 'false');
    el.setAttribute('translate', 'no');

    host.appendChild(toolbar);
    host.appendChild(el);

    function btn(icon, title, cmd) {
      return '<button type="button" class="tb" tabindex="-1" data-cmd="' + (cmd || icon) + '" title="' + title + '" aria-label="' + title + '">' + I[icon] + '</button>';
    }

    const listeners = [];
    function emit() { listeners.forEach(function (f) { f(); }); }

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* ignore */ }
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }

    function ensureFocus() {
      const sel = window.getSelection();
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }

    function selectedBlocks() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return [];
      const range = sel.getRangeAt(0);
      const blocks = [];
      const start = closestBlock(range.startContainer);
      const end = closestBlock(range.endContainer);
      if (!start) return [];
      if (start === end) return [start];
      let walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (n) { return n.matches(BLOCKS) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
      });
      let n, on = false;
      while ((n = walker.nextNode())) {
        if (n === start) on = true;
        if (on && !n.querySelector('p,div,h1,h2,h3,li,blockquote')) blocks.push(n);
        if (n === end) break;
      }
      return blocks.length ? blocks : [start];
    }

    function closestBlock(node) {
      while (node && node !== el) {
        if (node.nodeType === 1 && node.matches(BLOCKS)) return node;
        node = node.parentNode;
      }
      return null;
    }

    function wrapLooseText() {
      // A bare text node at the root becomes a paragraph so formatting has something to hold onto.
      const loose = Array.from(el.childNodes).filter(function (n) { return n.nodeType === 3 && n.textContent.trim(); });
      if (loose.length) {
        try { document.execCommand('formatBlock', false, '<p>'); } catch (e) { /* ignore */ }
      }
    }

    function toggleFirstIndent(force) {
      ensureFocus();
      wrapLooseText();
      const blocks = selectedBlocks().filter(function (b) { return b.tagName === 'P' || b.tagName === 'DIV'; });
      if (!blocks.length) return;
      const on = force !== undefined ? force : !blocks[0].classList.contains('fi');
      blocks.forEach(function (b) { b.classList.toggle('fi', on); if (!b.className) b.removeAttribute('class'); });
      emit();
    }

    function exec(cmd) {
      ensureFocus();
      if (cmd === 'firstIndent') return toggleFirstIndent();
      if (cmd === 'spacing') {
        el.classList.toggle('double');
        Ink.store.set('inkwell_double', el.classList.contains('double'));
        refresh();
        return;
      }
      if (cmd === 'blockquote') {
        const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
        document.execCommand('formatBlock', false, cur === 'blockquote' ? '<p>' : '<blockquote>');
      } else if (cmd === 'undo' || cmd === 'redo') {
        document.execCommand(cmd, false, null);
      } else {
        wrapLooseText();
        document.execCommand(cmd, false, null);
      }
      emit();
      refresh();
    }

    toolbar.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) e.preventDefault(); // keep the selection in the editor
    });
    toolbar.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-cmd]');
      if (!b || el.contentEditable !== 'true') return;
      exec(b.dataset.cmd);
    });
    const blockSel = toolbar.querySelector('[data-block]');
    blockSel.addEventListener('change', function () {
      ensureFocus();
      document.execCommand('formatBlock', false, '<' + blockSel.value + '>');
      emit();
      refresh();
      el.focus();
    });

    el.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const li = closestBlock(window.getSelection().anchorNode);
        if (li && li.tagName === 'LI') { document.execCommand(e.shiftKey ? 'outdent' : 'indent'); emit(); return; }
        toggleFirstIndent(!e.shiftKey);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'e') { e.preventDefault(); exec('justifyCenter'); }
        else if (k === 'l') { e.preventDefault(); exec('justifyLeft'); }
        else if (k === 'r') { e.preventDefault(); exec('justifyRight'); }
        else if (k === 'j') { e.preventDefault(); exec('justifyFull'); }
      }
    });

    // Enter after a Title or Heading should go back to normal text.
    el.addEventListener('input', function (e) {
      if (e.inputType === 'insertParagraph') {
        const b = closestBlock(window.getSelection().anchorNode);
        if (b && /^H[1-3]$/.test(b.tagName) && !b.textContent.trim()) document.execCommand('formatBlock', false, '<p>');
      }
      if (!el.firstChild) { /* keep empty for placeholder */ }
      else if (el.innerHTML === '<br>' || el.innerHTML === '<p><br></p>') { el.innerHTML = ''; }
      emit();
      refresh();
    });

    function refresh() {
      const inside = (function () { const s = window.getSelection(); return s.rangeCount && el.contains(s.anchorNode); })();
      toolbar.querySelectorAll('button[data-cmd]').forEach(function (b) {
        const c = b.dataset.cmd;
        let on = false;
        if (c === 'spacing') on = el.classList.contains('double');
        else if (!inside) on = false;
        else if (c === 'firstIndent') { const bl = closestBlock(window.getSelection().anchorNode); on = !!(bl && bl.classList.contains('fi')); }
        else if (c === 'blockquote') on = (document.queryCommandValue('formatBlock') || '').toLowerCase() === 'blockquote';
        else if (['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'].indexOf(c) >= 0) {
          try { on = document.queryCommandState(c); } catch (e) { on = false; }
        }
        b.classList.toggle('on', !!on);
      });
      if (inside) {
        const v = (document.queryCommandValue('formatBlock') || 'p').toLowerCase();
        blockSel.value = (v === 'h1' || v === 'h2') ? v : 'p';
      }
    }
    document.addEventListener('selectionchange', refresh);

    if (opts.spacing && Ink.store.get('inkwell_double')) el.classList.add('double');

    return {
      el: el,
      toolbar: toolbar,
      getHTML: function () { return Ink.sanitize(el.innerHTML); },
      setHTML: function (h) { el.innerHTML = Ink.sanitize(h || ''); refresh(); },
      focus: function () { el.focus(); },
      setEditable: function (on) {
        el.contentEditable = on ? 'true' : 'false';
        toolbar.style.opacity = on ? '' : '.45';
        toolbar.style.pointerEvents = on ? '' : 'none';
      },
      onInput: function (f) { listeners.push(f); },
      refresh: refresh
    };
  };
})();
