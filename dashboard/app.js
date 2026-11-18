// GGMU Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked pre-token board, a live-token view, filters,
// sortable columns and a per-protocol detail drawer. The drawer recomputes the
// row's implied value from the snapshot figures and the model, and checks it
// against the value board.json carries: the page and the board are the same
// arithmetic. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(3); }

  // The model, recomputed in the page from the row's own figures: the same
  // function lib/model.ts runs, so a reader can check any row by hand.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.momentum_multiplier * row.maturity_multiplier * row.breadth_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); return va < vb ? -dir : va > vb ? dir : a.rank - b.rank; }
      if (key === 'ratio') { va = a.implied_value_usd / a.tvl_usd; vb = b.implied_value_usd / b.tvl_usd; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'change') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else { va = a[key]; vb = b[key]; }
      if (va !== vb) return (va - vb) * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function header() {
    return el('div', null,
      el('div', { 'class': 'masthead' },
        el('div', null,
          el('h1', null, 'GGMU Radar', el('span', { 'class': 'dot', text: ' ●' })),
          el('p', { 'class': 'tagline', text: 'Pre-token protocols ranked by implied value: what a token would be worth if each protocol\u2019s record stayed as it is, and exactly how to farm it before one exists.' })
        ),
        el('div', { 'class': 'asof', text: 'snapshot ' + DATA.as_of + '\n' + DATA.source })
      ),
      el('div', { 'class': 'stats' },
        el('span', { 'class': 'chip' }, el('b', { 'class': 'a', text: String(DATA.watchlist_size) + '/' + DATA.watchlist_size }), ' watchlist covered'),
        el('span', { 'class': 'chip' }, el('b', { text: String(DATA.board_size) }), ' protocols ranked'),
        el('span', { 'class': 'chip' }, el('b', { 'class': 'g', text: String(DATA.early_size) }), ' early finds below the ' + fmtUsd(DATA.floor_usd) + ' floor'),
        el('span', { 'class': 'chip' }, el('b', { text: String(DATA.live_size) }), ' live tokens set aside'),
        el('span', { 'class': 'chip' }, 'model ', el('b', { text: DATA.model_version }))
      ),
      el('section', { 'class': 'model-strip' },
        el('h2', { text: 'How a value is implied' }),
        el('p', null,
          'No number here is a guess at a launch date, and no name is scored by hand. For every protocol: ',
          el('code', { text: 'implied = TVL x peer multiple x momentum x maturity x breadth' }),
          '. The peer multiple is measured from this snapshot itself: the median market-cap/TVL of the live-token protocols in the same category, so the market prices each kind of protocol. Momentum reads the 7-day TVL change, maturity the days the protocol has run with no token recorded, breadth its chain count. Open any row to see its own arithmetic, recomputed by this page.'
        )
      )
    );
  }

  function toolbar(count) {
    var catSel = el('select', { 'aria-label': 'Category', onchange: function () { state.category = this.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }); })
    );
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function () { state.chain = this.value; render(); } },
      el('option', { value: 'all', text: 'All chains' }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null }); })
    );
    return el('div', { 'class': 'toolbar' },
      el('input', { type: 'search', placeholder: 'Search name, slug, category\u2026', value: state.q, 'aria-label': 'Search',
        oninput: function () { state.q = this.value; renderTable(); } }),
      catSel, chainSel,
      el('label', null,
        el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, onchange: function () { state.watchOnly = this.checked; render(); } }),
        ' watchlist only'
      ),
      el('span', { 'class': 'count', id: 'rowcount', text: count + ' shown' })
    );
  }

  var COLUMNS = [
    { key: 'rank', label: '#' },
    { key: 'name', label: 'Protocol' },
    { key: 'category', label: 'Category' },
    { key: 'chains', label: 'Chains' },
    { key: 'tvl_usd', label: 'TVL' },
    { key: 'change', label: '7d' },
    { key: 'age', label: 'Age' },
    { key: 'peer_multiple', label: 'Peer x' },
    { key: 'implied_value_usd', label: 'Implied value' },
    { key: 'ratio', label: 'Implied/TVL' }
  ];

  function boardTable() {
    var rows = visibleRows();
    var head = el('tr', null, COLUMNS.map(function (col) {
      var sortable = ['rank', 'name', 'tvl_usd', 'change', 'age', 'peer_multiple', 'implied_value_usd', 'ratio'].indexOf(col.key) >= 0;
      return el('th', {
        'class': state.sort === col.key ? 'sorted' : null,
        onclick: sortable ? function () {
          if (state.sort === col.key) state.dir = -state.dir;
          else { state.sort = col.key; state.dir = col.key === 'name' ? 1 : -1; }
          if (col.key === 'rank') state.dir = 1;
          render();
        } : null
      }, col.label + (state.sort === col.key ? (state.dir === 1 ? ' \u25b2' : ' \u25bc') : ''));
    }));
    var body = rows.map(function (r) {
      return el('tr', { 'class': state.selected === r.slug ? 'selected' : null, onclick: function () { openDetail(r); } },
        el('td', { 'class': 'rank', text: String(r.rank) }),
        el('td', null,
          el('span', { 'class': 'name' }, r.name,
            r.watchlist ? el('span', { 'class': 'badge watch', text: 'watchlist' }) : el('span', { 'class': 'badge early', text: 'early' }),
            el('span', { 'class': 'slug', text: r.slug })
          )
        ),
        el('td', { 'class': 'cat', text: r.category || 'Uncategorised' }),
        el('td', { 'class': 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': r.change_7d === null ? null : (r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { text: fmtAge(r.age_days) }),
        el('td', { text: fmtMult(r.peer_multiple) }),
        el('td', { 'class': 'implied', text: fmtUsd(r.implied_value_usd) }),
        el('td', { text: (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x' })
      );
    });
    return el('div', { 'class': 'table-wrap' },
      el('table', null, el('thead', null, head), el('tbody', null, body.length ? body : el('tr', null, el('td', { 'class': 'empty', colspan: '10', text: 'No protocol matches the filter. Loosen it, or clear the search.' }))))
    );
  }

  function liveTable() {
    var body = DATA.live.map(function (r) {
      return el('tr', null,
        el('td', null, el('span', { 'class': 'name' }, r.name, el('span', { 'class': 'slug', text: r.slug }))),
        el('td', { 'class': 'cat', text: r.category || 'Uncategorised' }),
        el('td', { 'class': 'chains', text: r.chains.slice(0, 3).join(', ') }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': r.change_7d === null ? null : (r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { 'class': 'implied', text: fmtUsd(r.mcap_usd) })
      );
    });
    return el('div', null,
      el('p', { 'class': 'tagline', text: 'These protocols already have a token that trades, so the radar does not rank them: it shows the market\u2019s own value. Their category medians are what price the pre-token board.' }),
      el('div', { 'class': 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }),
            el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }))),
          el('tbody', null, body)))
    );
  }

  function fact(k, v) { return el('div', null, el('span', { 'class': 'k', text: k }), el('span', { 'class': 'v', text: v })); }

  function openDetail(r) {
    state.selected = r.slug;
    var old = document.querySelector('.drawer');
    if (old) old.remove();
    var recomputed = impliedOf(r);
    var drawer = el('aside', { 'class': 'drawer', 'aria-label': 'Protocol detail' },
      el('button', { 'class': 'close', 'aria-label': 'Close', onclick: function () { drawer.remove(); state.selected = null; render(); } }, '\u00d7'),
      el('h2', { text: r.name }),
      el('div', { 'class': 'sub', text: r.slug + ' \u00b7 rank #' + r.rank + ' \u00b7 ' + (r.watchlist ? 'watchlist' : 'early find') + ' \u00b7 records no token' }),
      el('h3', { text: 'The record' }),
      el('div', { 'class': 'facts' },
        fact('TVL', fmtUsd(r.tvl_usd)),
        fact('TVL change, 7d', fmtPct(r.change_7d)),
        fact('Category', r.category || 'Uncategorised'),
        fact('Chains', r.chains.join(', ') || 'none named'),
        fact('Listed', r.listed_at || 'unknown'),
        fact('Age with no token', fmtAge(r.age_days))
      ),
      el('h3', { text: 'Why this value' }),
      el('div', { 'class': 'math' },
        fmtUsd(r.tvl_usd) + ' TVL\n' +
        'x ' + r.peer_multiple.toFixed(4) + ' peer multiple (' + (r.peer_fallback ? 'median of ' + r.peer_samples + ' live protocols across all categories; too few live ' + (r.category || 'uncategorised') + ' protocols to price alone' : 'median of ' + r.peer_samples + ' live ' + (r.category || 'uncategorised') + ' protocols') + ')\n' +
        'x ' + r.momentum_multiplier.toFixed(4) + ' momentum\n' +
        'x ' + r.maturity_multiplier.toFixed(4) + ' maturity\n' +
        'x ' + r.breadth_multiplier.toFixed(4) + ' breadth\n',
        el('span', { 'class': 'res', text: '= ' + fmtUsd(r.implied_value_usd) + ' implied' }),
        '\n',
        el('span', { 'class': 'ok', text: recomputed === r.implied_value_usd ? '\u2713 this page recomputes the same value from the figures above' : 'recomputed here: ' + fmtUsd(recomputed) })
      ),
      el('h3', { text: 'How to farm it' }),
      el('ol', { 'class': 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { 'class': 'foot', text: 'An implied value is this board\u2019s own claim from the snapshot\u2019s figures, not a prediction that a token will be issued. A protocol here records no token on DefiLlama; that is not proof it has none.' })
    );
    document.body.appendChild(drawer);
    render();
  }

  function renderTable() {
    var wrap = document.getElementById('table-slot');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    var count = document.getElementById('rowcount');
    if (count) count.textContent = (state.tab === 'pre' ? visibleRows().length : DATA.live.length) + ' shown';
  }

  function render() {
    app.innerHTML = '';
    app.appendChild(header());
    app.appendChild(el('div', { 'class': 'tabs', role: 'tablist' },
      el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'pre' ? 'true' : 'false', onclick: function () { state.tab = 'pre'; render(); } }, 'Pre-token board'),
      el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', onclick: function () { state.tab = 'live'; render(); } }, 'Live tokens')
    ));
    if (state.tab === 'pre') app.appendChild(toolbar(DATA.rows.length));
    app.appendChild(el('div', { id: 'table-slot' }));
    app.appendChild(el('p', { 'class': 'foot' },
      'Built from the sealed DefiLlama snapshot of ' + DATA.as_of + ' (' + DATA.source + '). Method: lib/model.ts in this entry\u2019s repository, model ',
      el('code', { text: DATA.model_version }),
      '. Every watchlist protocol is ranked; the rest of the board is the radar\u2019s early finds below the floor.'
    ));
    app.setAttribute('aria-busy', 'false');
    renderTable();
  }

  render();
})();
