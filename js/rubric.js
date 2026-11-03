/* Inkwell — rubrics: templates, display, scoring and the editor. */
(function () {
  const esc = Ink.esc;
  const L5 = function () {
    return [{ label: 'Excellent', points: 5 }, { label: 'Proficient', points: 4 }, { label: 'Satisfactory', points: 3 }, { label: 'Limited', points: 2 }, { label: 'Poor', points: 1 }];
  };
  const crit = function (id, name, desc, cells, weight) { return { id: id, name: name, desc: desc || '', weight: weight || 1, cells: cells }; };

  const TEMPLATES = [
    {
      key: 'narrative', title: 'Personal Narrative', levels: L5(), criteria: [
        crit('focus', 'Focus & Purpose', 'Centres on one meaningful moment', ['Insightfully centred on a single moment; its significance is clear and compelling.', 'Clearly focused on one moment; significance is evident.', 'Generally focused; significance is stated but somewhat general.', 'Focus wanders; significance is unclear.', 'No clear focus or purpose.']),
        crit('detail', 'Details & Description', 'Sensory detail, dialogue, showing', ['Vivid, precise sensory details and purposeful dialogue bring the moment to life.', 'Effective details and dialogue support the narrative.', 'Some relevant details; tells more than shows.', 'Few or vague details.', 'Details are missing or irrelevant.']),
        crit('org', 'Organization', 'Sequence, pacing, transitions', ['Purposeful structure and pacing build to a resonant ending.', 'Logical sequence with smooth transitions and a clear ending.', 'Mostly logical sequence; transitions are basic.', 'Sequence is hard to follow.', 'No discernible structure.']),
        crit('reflect', 'Reflection', 'Shows how the writer changed', ['Reflection is thoughtful and original, revealing genuine insight.', 'Reflection clearly explains the change and why it matters.', 'Reflection is present but general.', 'Reflection is minimal or tacked on.', 'No reflection.']),
        crit('conv', 'Conventions', 'Spelling, punctuation, grammar', ['Virtually error-free; conventions enhance meaning.', 'Few errors; none interfere with meaning.', 'Some errors; meaning remains clear.', 'Frequent errors interfere with meaning.', 'Errors make the writing difficult to understand.'])
      ]
    },
    {
      key: 'literary', title: 'Literary Analysis Essay', levels: L5(), criteria: [
        crit('thesis', 'Thesis', 'A clear, arguable interpretation', ['Insightful, precise thesis that frames a sophisticated interpretation.', 'Clear, arguable thesis that addresses the prompt.', 'Thesis is present but general or partly descriptive.', 'Thesis is vague or mostly summary.', 'No identifiable thesis.']),
        crit('evidence', 'Textual Evidence', 'Relevant, well-chosen quotations', ['Carefully chosen evidence is smoothly integrated and precisely cited.', 'Relevant evidence supports each point and is cited.', 'Evidence is adequate but sometimes loosely connected.', 'Evidence is sparse, misread, or dropped in without context.', 'Little or no evidence.']),
        crit('analysis', 'Analysis', 'Explains how evidence supports the thesis', ['Perceptive analysis explains how and why; goes well beyond the obvious.', 'Clear analysis connects evidence to the thesis.', 'Some analysis, but often summarizes instead.', 'Mostly summary with little explanation.', 'No analysis.']),
        crit('org', 'Organization', 'Paragraphing, transitions, flow of ideas', ['Purposeful structure; each paragraph builds the argument; seamless transitions.', 'Logical paragraphs with topic sentences and transitions.', 'Basic structure; some paragraphs lack focus.', 'Ideas are loosely connected or repetitive.', 'Disorganized.']),
        crit('style', 'Style & Conventions', 'Academic voice, word choice, mechanics', ['Precise, fluent academic voice; virtually error-free.', 'Appropriate voice; few errors.', 'Generally clear; some lapses in voice or mechanics.', 'Frequent errors or informal voice distract the reader.', 'Errors impede understanding.'])
      ]
    },
    {
      key: 'argument', title: 'Persuasive / Argumentative', levels: L5(), criteria: [
        crit('claim', 'Claim', 'A clear position on the issue', ['Compelling, nuanced claim that sets up the whole argument.', 'Clear, specific claim.', 'Claim is present but general.', 'Claim is unclear or inconsistent.', 'No claim.']),
        crit('support', 'Reasons & Evidence', 'Convincing support for the claim', ['Strong, varied, credible evidence makes the case convincingly.', 'Relevant reasons and evidence support the claim.', 'Some support; evidence is general or uneven.', 'Support is weak or mostly opinion.', 'Little or no support.']),
        crit('counter', 'Counterargument', 'Acknowledges and answers other views', ['Fairly presents and effectively refutes opposing views.', 'Addresses an opposing view with a reasonable response.', 'Mentions an opposing view with a limited response.', 'Opposing views are dismissed or ignored.', 'No counterargument.']),
        crit('org', 'Organization', 'Structure and transitions', ['Persuasive structure builds to a powerful conclusion.', 'Logical structure with clear transitions.', 'Basic structure; transitions are mechanical.', 'Structure is hard to follow.', 'Disorganized.']),
        crit('conv', 'Conventions', 'Spelling, punctuation, grammar', ['Virtually error-free.', 'Few errors.', 'Some errors; meaning is clear.', 'Frequent errors interfere with meaning.', 'Errors impede understanding.'])
      ]
    },
    {
      key: 'expository', title: 'Expository / Informational', levels: L5(), criteria: [
        crit('focus', 'Focus', 'Clear controlling idea', ['Sharp, engaging controlling idea maintained throughout.', 'Clear controlling idea.', 'Controlling idea is general.', 'Focus is unclear.', 'No focus.']),
        crit('dev', 'Development', 'Facts, examples and explanation', ['Rich, accurate details thoroughly explain the topic.', 'Relevant details and explanation develop the topic.', 'Some development; details are general.', 'Thin or inaccurate development.', 'Little or no development.']),
        crit('org', 'Organization', 'Logical order and transitions', ['Skillful organization guides the reader effortlessly.', 'Logical order with clear transitions.', 'Basic organization.', 'Order is confusing.', 'Disorganized.']),
        crit('words', 'Word Choice', 'Precise, topic-appropriate vocabulary', ['Precise, vivid vocabulary suited to audience and purpose.', 'Appropriate, specific vocabulary.', 'Generally adequate vocabulary.', 'Vague or repetitive vocabulary.', 'Vocabulary interferes with meaning.']),
        crit('conv', 'Conventions', 'Spelling, punctuation, grammar', ['Virtually error-free.', 'Few errors.', 'Some errors; meaning is clear.', 'Frequent errors interfere with meaning.', 'Errors impede understanding.'])
      ]
    },
    {
      key: 'story', title: 'Short Story / Creative Writing', levels: L5(), criteria: [
        crit('plot', 'Plot & Structure', 'Conflict, rising action, resolution', ['Compelling conflict and well-paced structure with a satisfying resolution.', 'Clear conflict and structure.', 'Plot is present but predictable or uneven.', 'Plot is confusing or incomplete.', 'No discernible plot.']),
        crit('char', 'Characterization', 'Believable, developed characters', ['Complex characters revealed through action, dialogue and thought.', 'Characters are believable and developed.', 'Characters are somewhat flat.', 'Characters are undeveloped.', 'No meaningful characters.']),
        crit('setting', 'Setting & Description', 'Imagery and sense of place', ['Vivid imagery creates mood and a strong sense of place.', 'Effective description of setting.', 'Some description.', 'Little description.', 'No setting established.']),
        crit('voice', 'Voice & Style', 'Distinct voice, sentence variety, word choice', ['Distinctive voice; deliberate, varied sentences and word choice.', 'Consistent voice; varied sentences.', 'Voice is generic; some variety.', 'Little voice; repetitive sentences.', 'No sense of voice.']),
        crit('conv', 'Conventions', 'Including dialogue punctuation', ['Virtually error-free, including dialogue punctuation.', 'Few errors.', 'Some errors; meaning is clear.', 'Frequent errors interfere with meaning.', 'Errors impede understanding.'])
      ]
    },
    {
      key: 'paragraph', title: 'Paragraph / Short Response', levels: [{ label: 'Strong', points: 4 }, { label: 'Proficient', points: 3 }, { label: 'Developing', points: 2 }, { label: 'Beginning', points: 1 }], criteria: [
        crit('topic', 'Topic Sentence', 'States the main idea', ['Clear, engaging topic sentence that directly answers the question.', 'Clear topic sentence.', 'Topic sentence is vague.', 'No topic sentence.']),
        crit('support', 'Support', 'Examples or evidence', ['Specific, well-chosen support.', 'Relevant support.', 'Support is general.', 'Little or no support.']),
        crit('explain', 'Explanation', 'Connects support to the main idea', ['Insightful explanation of how support proves the point.', 'Clear explanation.', 'Explanation is limited.', 'No explanation.']),
        crit('conv', 'Conventions', '', ['Virtually error-free.', 'Few errors.', 'Several errors.', 'Errors interfere with meaning.'])
      ]
    },
    {
      key: 'alberta', title: 'Personal Response (Alberta-style categories)', levels: L5(), criteria: [
        crit('ideas', 'Ideas & Impressions', 'Exploration of the topic and connection to the prompt', ['Ideas are insightful and carefully considered; impressions are perceptive.', 'Ideas are thoughtful and well considered.', 'Ideas are conventional and straightforward.', 'Ideas are superficial or only loosely connected.', 'Ideas are irrelevant or minimal.'], 2),
        crit('support', 'Support', 'Details that develop the ideas', ['Precise, apt details strongly reinforce the ideas.', 'Specific, relevant details support the ideas.', 'Details are general and somewhat relevant.', 'Details are vague or repetitive.', 'Details are missing or inappropriate.']),
        crit('form', 'Form & Structure', 'Unity and coherence', ['Purposeful structure; unity and coherence are skillfully maintained.', 'Clear structure; unity is maintained.', 'Basic structure; coherence is generally maintained.', 'Structure is inconsistent.', 'Little evidence of structure.']),
        crit('choice', 'Matters of Choice', 'Diction, syntax, voice', ['Precise diction and syntax create a confident, engaging voice.', 'Specific diction; varied syntax; clear voice.', 'Adequate diction; some variety in syntax.', 'Imprecise diction; awkward syntax.', 'Diction and syntax obscure meaning.']),
        crit('correct', 'Matters of Correctness', 'Sentence construction, usage, mechanics', ['Essentially error-free; errors do not reduce clarity.', 'Few errors; minor errors do not reduce clarity.', 'Some errors; clarity is generally maintained.', 'Frequent errors impede clarity.', 'Errors severely impede clarity.'])
      ]
    }
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid() { return 'k' + Math.random().toString(36).slice(2, 8); }

  function topPoints(r) { return Math.max.apply(null, (r.levels || []).map(function (l) { return Number(l.points) || 0; }).concat([0])); }
  function max(r) { if (!r || !r.criteria) return 0; const t = topPoints(r); return r.criteria.reduce(function (s, c) { return s + t * (Number(c.weight) || 1); }, 0); }
  function critPoints(r, c, idx) { const lv = (r.levels || [])[Number(idx)]; return lv ? (Number(lv.points) || 0) * (Number(c.weight) || 1) : null; }
  function total(r, scores) {
    if (!r || !r.criteria) return 0;
    let t = 0;
    r.criteria.forEach(function (c) { const p = critPoints(r, c, scores && scores[c.id]); if (p != null && scores[c.id] !== undefined && scores[c.id] !== null) t += p; });
    return Math.round(t * 100) / 100;
  }
  function scoredCount(r, scores) { return (r.criteria || []).filter(function (c) { return scores && scores[c.id] !== undefined && scores[c.id] !== null; }).length; }
  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }
  function pct(r, scores) { const m = max(r); return m ? Math.round(total(r, scores) / m * 100) : 0; }

  /** Read-only grid (student feedback, record, print). */
  function grid(r, scores, opts) {
    opts = opts || {};
    if (!r || !r.criteria || !r.criteria.length) return '';
    scores = scores || {};
    let h = '<div class="rb-wrap"><table class="rb-grid' + (opts.compact ? ' compact' : '') + '"><thead><tr><th class="rb-c">Criterion</th>' +
      r.levels.map(function (l) { return '<th>' + esc(l.label) + '<span>' + fmt(l.points) + '</span></th>'; }).join('') + '<th class="rb-pts">Score</th></tr></thead><tbody>';
    r.criteria.forEach(function (c) {
      const sel = scores[c.id];
      const p = sel !== undefined && sel !== null ? critPoints(r, c, sel) : null;
      h += '<tr><th class="rb-c"><b>' + esc(c.name) + '</b>' + (c.desc ? '<span>' + esc(c.desc) + '</span>' : '') + (Number(c.weight) !== 1 ? '<em>×' + fmt(c.weight) + '</em>' : '') + '</th>' +
        r.levels.map(function (l, i) { return '<td class="' + (Number(sel) === i ? 'on' : '') + '">' + esc((c.cells || [])[i] || '') + '</td>'; }).join('') +
        '<td class="rb-pts">' + (p == null ? '—' : fmt(p) + '<span>/' + fmt(topPoints(r) * (Number(c.weight) || 1)) + '</span>') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><th class="rb-c">Total</th><td colspan="' + r.levels.length + '"></td><td class="rb-pts"><b>' + fmt(total(r, scores)) + '</b><span>/' + fmt(max(r)) + '</span></td></tr></tfoot></table></div>';
    return h;
  }

  /** Stacked list version of the grid, for narrow panels (student feedback). */
  function list(r, scores) {
    if (!r || !r.criteria || !r.criteria.length) return '';
    scores = scores || {};
    return '<div class="rb-list">' + r.criteria.map(function (c) {
      const sel = scores[c.id];
      const has = sel !== undefined && sel !== null;
      const lv = has ? r.levels[sel] : null;
      const p = has ? critPoints(r, c, sel) : null;
      return '<div class="rb-li"><div class="rb-lh"><b>' + esc(c.name) + '</b><span class="rb-lp">' + (p == null ? '—' : fmt(p)) + '<small>/' + fmt(topPoints(r) * (Number(c.weight) || 1)) + '</small></span></div>' +
        (lv ? '<div class="rb-ll"><span class="pill plain xs">' + esc(lv.label) + '</span></div>' + ((c.cells || [])[sel] ? '<div class="rb-ld">' + esc(c.cells[sel]) + '</div>' : '') : '<div class="muted small">Not scored</div>') + '</div>';
    }).join('') + '</div>';
  }

  /**
   * Interactive scoring panel (teacher grading). Calls onChange(scores) when a level is picked.
   */
  function scorer(host, r, scores, onChange, opts) {
    opts = opts || {};
    scores = Object.assign({}, scores || {});
    const showDesc = opts.showDesc !== false;
    function draw() {
      host.innerHTML = r.criteria.map(function (c) {
        const sel = scores[c.id];
        const p = sel !== undefined && sel !== null ? critPoints(r, c, sel) : null;
        return '<div class="sc-crit" data-c="' + esc(c.id) + '"><div class="sc-head"><b>' + esc(c.name) + '</b>' + (Number(c.weight) !== 1 ? '<span class="sc-w">×' + fmt(c.weight) + '</span>' : '') +
          '<span class="sc-p">' + (p == null ? '—' : fmt(p)) + '<small>/' + fmt(topPoints(r) * (Number(c.weight) || 1)) + '</small></span></div>' +
          (c.desc ? '<div class="sc-desc">' + esc(c.desc) + '</div>' : '') +
          '<div class="sc-levels">' + r.levels.map(function (l, i) {
            return '<button type="button" class="sc-lv' + (Number(sel) === i ? ' on' : '') + '" data-i="' + i + '" title="' + esc((c.cells || [])[i] || '') + '"><b>' + esc(l.label) + '</b><span>' + fmt(l.points) + '</span></button>';
          }).join('') + '</div>' +
          (showDesc && sel !== undefined && sel !== null && (c.cells || [])[sel] ? '<div class="sc-cell">' + esc(c.cells[sel]) + '</div>' : '') + '</div>';
      }).join('');
      host.querySelectorAll('.sc-crit').forEach(function (row) {
        row.querySelectorAll('.sc-lv').forEach(function (b) {
          b.onclick = function () {
            const id = row.dataset.c, i = Number(b.dataset.i);
            if (scores[id] === i) delete scores[id]; else scores[id] = i;
            draw();
            onChange(Object.assign({}, scores));
          };
        });
      });
    }
    draw();
    return { set: function (s) { scores = Object.assign({}, s || {}); draw(); } };
  }

  /* ───────────── Editor ───────────── */
  function blank() {
    return { title: '', levels: L5(), criteria: [crit(uid(), '', '', ['', '', '', '', ''])] };
  }

  /**
   * Opens the rubric editor. Resolves to the rubric, '' (removed) or null (cancelled).
   * opts: { sources: [{title, rubric, archived}], title }
   */
  function edit(rubric, opts) {
    opts = opts || {};
    let r = rubric && rubric.criteria ? clone(rubric) : null;
    return new Promise(function (resolve) {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal rb-modal" role="dialog" aria-modal="true" aria-label="Rubric editor">' +
        '<div class="rb-top"><h3>Rubric' + (opts.title ? ' · <span class="muted">' + esc(opts.title) + '</span>' : '') + '</h3>' +
        '<div class="row" style="gap:8px"><label class="label" for="rb-from">Start from</label><select class="input" id="rb-from" style="width:auto;min-width:260px"></select></div></div>' +
        '<div class="rb-scroll"><div id="rb-body"></div></div>' +
        '<div class="rb-foot"><span class="muted small" id="rb-total"></span><div class="row" style="gap:8px">' +
        (rubric && rubric.criteria ? '<button class="btn danger" id="rb-remove">' + Ink.bi('trash', 'Remove rubric') + '</button>' : '') +
        '<button class="btn" id="rb-cancel">Cancel</button><button class="btn primary" id="rb-save">' + Ink.bi('check', 'Save rubric') + '</button></div></div></div>';
      document.body.appendChild(back);
      const $ = function (s) { return back.querySelector(s); };
      const from = $('#rb-from');
      let opt = '<option value="">' + (r ? 'Keep editing this rubric' : 'Choose a starting point…') + '</option><option value="blank">Blank rubric</option><optgroup label="Pre-built rubrics">' +
        TEMPLATES.map(function (t, i) { return '<option value="t' + i + '">' + esc(t.title) + '</option>'; }).join('') + '</optgroup>';
      if (opts.sources && opts.sources.length) {
        opt += '<optgroup label="From another assignment">' + opts.sources.map(function (s, i) { return '<option value="s' + i + '">' + esc(s.title) + (s.archived ? ' (archived)' : '') + '</option>'; }).join('') + '</optgroup>';
      }
      from.innerHTML = opt;
      from.onchange = async function () {
        const v = from.value;
        if (!v) return;
        const hasContent = r && r.criteria.some(function (c) { return c.name || (c.cells || []).some(String); });
        if (hasContent && !(await Ink.confirm('Replace this rubric?', 'Your current criteria will be replaced.', 'Replace', false, back))) { from.value = ''; return; }
        if (v === 'blank') r = blank();
        else if (v[0] === 't') { r = clone(TEMPLATES[Number(v.slice(1))]); delete r.key; }
        else r = clone(opts.sources[Number(v.slice(1))].rubric);
        r.criteria.forEach(function (c) { c.id = c.id || uid(); });
        from.value = '';
        draw();
      };

      function sync() {
        // read inputs back into r
        if (!r) return;
        r.title = $('#rb-title') ? $('#rb-title').value : r.title;
        back.querySelectorAll('[data-lv]').forEach(function (th) {
          const i = Number(th.dataset.lv);
          r.levels[i].label = th.querySelector('.lv-label').value;
          r.levels[i].points = Number(th.querySelector('.lv-pts').value) || 0;
        });
        back.querySelectorAll('tr[data-ci]').forEach(function (tr) {
          const c = r.criteria[Number(tr.dataset.ci)];
          c.name = tr.querySelector('.c-name').value;
          c.desc = tr.querySelector('.c-desc').value;
          c.weight = Number(tr.querySelector('.c-w').value) || 1;
          c.cells = Array.from(tr.querySelectorAll('.c-cell')).map(function (t) { return t.value; });
        });
      }

      function draw() {
        const body = $('#rb-body');
        if (!r) {
          body.innerHTML = '<div class="empty" style="padding:50px 20px"><div class="display">Start a rubric</div><p>Pick a pre-built rubric, copy one from another assignment, or start blank.</p><div class="row" style="justify-content:center;gap:8px;flex-wrap:wrap">' +
            TEMPLATES.slice(0, 4).map(function (t, i) { return '<button class="btn" data-t="' + i + '">' + esc(t.title) + '</button>'; }).join('') + '<button class="btn teal" data-t="blank">' + Ink.bi('plus', 'Blank') + '</button></div></div>';
          body.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { from.value = b.dataset.t === 'blank' ? 'blank' : 't' + b.dataset.t; from.onchange(); }; });
          $('#rb-total').textContent = '';
          return;
        }
        const n = r.levels.length;
        let h = '<div class="field" style="max-width:480px"><label for="rb-title">Rubric name</label><input class="input" id="rb-title" maxlength="120" placeholder="e.g. Literary Analysis Essay"></div>' +
          '<table class="rb-edit"><thead><tr><th class="rb-c">Criterion</th>' +
          r.levels.map(function (l, i) {
            return '<th data-lv="' + i + '"><div class="lv-h"><input class="input lv-label" maxlength="40" aria-label="Level name"><button type="button" class="icon-btn" data-del-lv="' + i + '" title="Remove this level" aria-label="Remove level">' + Ink.icon('x') + '</button></div>' +
              '<div class="lv-p"><input class="input lv-pts" type="number" min="0" step="0.5" aria-label="Points"><span>pts</span></div></th>';
          }).join('') + '<th class="rb-addlv">' + (n < 8 ? '<button type="button" class="btn sm" id="rb-add-lv" title="Add a level">' + Ink.bi('plus', 'Level') + '</button>' : '') + '</th></tr></thead><tbody>';
        r.criteria.forEach(function (c, ci) {
          h += '<tr data-ci="' + ci + '"><th class="rb-c"><input class="input c-name" maxlength="120" placeholder="Criterion name"><textarea class="input c-desc" maxlength="500" rows="2" placeholder="What it measures (optional)"></textarea>' +
            '<div class="row c-tools"><label class="small muted">Weight <select class="input c-w">' + [0.5, 1, 1.5, 2, 3, 4].map(function (w) { return '<option value="' + w + '">×' + w + '</option>'; }).join('') + '</select></label>' +
            '<span style="flex:1"></span><button type="button" class="icon-btn" data-up="' + ci + '" title="Move up" aria-label="Move up">' + Ink.icon('up') + '</button><button type="button" class="icon-btn" data-dn="' + ci + '" title="Move down" aria-label="Move down">' + Ink.icon('chevD') + '</button><button type="button" class="icon-btn" data-del="' + ci + '" title="Delete criterion" aria-label="Delete criterion">' + Ink.icon('trash') + '</button></div></th>' +
            r.levels.map(function (l, i) { return '<td><textarea class="input c-cell" rows="4" maxlength="700" placeholder="What ' + esc(l.label || 'this level') + ' looks like"></textarea></td>'; }).join('') + '<td></td></tr>';
        });
        h += '</tbody></table><button type="button" class="btn teal" id="rb-add-c" style="margin-top:12px">' + Ink.bi('plus', 'Add criterion') + '</button>';
        body.innerHTML = h;
        $('#rb-title').value = r.title || '';
        back.querySelectorAll('[data-lv]').forEach(function (th) {
          const l = r.levels[Number(th.dataset.lv)];
          th.querySelector('.lv-label').value = l.label;
          th.querySelector('.lv-pts').value = l.points;
        });
        back.querySelectorAll('tr[data-ci]').forEach(function (tr) {
          const c = r.criteria[Number(tr.dataset.ci)];
          tr.querySelector('.c-name').value = c.name || '';
          tr.querySelector('.c-desc').value = c.desc || '';
          tr.querySelector('.c-w').value = String(Number(c.weight) || 1);
          if (!tr.querySelector('.c-w').value) tr.querySelector('.c-w').value = '1';
          tr.querySelectorAll('.c-cell').forEach(function (t, i) { t.value = (c.cells || [])[i] || ''; });
        });
        body.oninput = function () { sync(); showTotal(); };
        body.onchange = function () { sync(); showTotal(); };
        const addLv = $('#rb-add-lv');
        if (addLv) addLv.onclick = function () { sync(); r.levels.push({ label: 'Level ' + (r.levels.length + 1), points: 0 }); r.criteria.forEach(function (c) { c.cells.push(''); }); draw(); };
        back.querySelectorAll('[data-del-lv]').forEach(function (b) {
          b.onclick = function () { sync(); if (r.levels.length <= 2) { Ink.toast('A rubric needs at least two levels.', 'warn'); return; } const i = Number(b.dataset.delLv); r.levels.splice(i, 1); r.criteria.forEach(function (c) { c.cells.splice(i, 1); }); draw(); };
        });
        back.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { sync(); r.criteria.splice(Number(b.dataset.del), 1); if (!r.criteria.length) r.criteria.push(crit(uid(), '', '', r.levels.map(function () { return ''; }))); draw(); }; });
        back.querySelectorAll('[data-up]').forEach(function (b) { b.onclick = function () { sync(); const i = Number(b.dataset.up); if (i > 0) { const x = r.criteria.splice(i, 1)[0]; r.criteria.splice(i - 1, 0, x); draw(); } }; });
        back.querySelectorAll('[data-dn]').forEach(function (b) { b.onclick = function () { sync(); const i = Number(b.dataset.dn); if (i < r.criteria.length - 1) { const x = r.criteria.splice(i, 1)[0]; r.criteria.splice(i + 1, 0, x); draw(); } }; });
        $('#rb-add-c').onclick = function () { sync(); r.criteria.push(crit(uid(), '', '', r.levels.map(function () { return ''; }))); draw(); const rows = back.querySelectorAll('.c-name'); rows[rows.length - 1].focus(); };
        showTotal();
      }
      function showTotal() {
        if (!r) return;
        $('#rb-total').textContent = r.criteria.length + ' criteria · out of ' + fmt(max(r)) + ' points';
      }
      const close = function (v) { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = function (e) { if (e.key === 'Escape' && !back.querySelector('.modal-back')) { e.preventDefault(); close(null); } };
      document.addEventListener('keydown', onKey, true);
      $('#rb-cancel').onclick = function () { close(null); };
      if ($('#rb-remove')) $('#rb-remove').onclick = async function () { if (await Ink.confirm('Remove the rubric?', 'Scores already given for this assignment will no longer count toward a total.', 'Remove', true, back)) close(''); };
      $('#rb-save').onclick = function () {
        if (!r) { Ink.toast('Choose a starting point first.', 'warn'); return; }
        sync();
        r.criteria = r.criteria.filter(function (c) { return c.name.trim() || c.cells.some(function (x) { return x.trim(); }); });
        if (!r.criteria.length) { Ink.toast('Add at least one criterion.', 'warn'); return; }
        if (r.criteria.some(function (c) { return !c.name.trim(); })) { Ink.toast('Every criterion needs a name.', 'warn'); draw(); return; }
        if (r.levels.some(function (l) { return !l.label.trim(); })) { Ink.toast('Every level needs a name.', 'warn'); return; }
        r.criteria.forEach(function (c) { c.id = c.id || uid(); });
        close(r);
      };
      draw();
    });
  }

  window.Ink.Rubric = { templates: TEMPLATES, grid: grid, list: list, scorer: scorer, edit: edit, total: total, max: max, pct: pct, fmt: fmt, scoredCount: scoredCount, critPoints: critPoints, topPoints: topPoints };
})();
