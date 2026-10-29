/* Mint Budget: Invest learning (quiz + personal tips) and the bridge to the Marketplace, where a budget plan
 * or an investing mix becomes a spreadsheet template others can buy, and bought ones apply back to a budget.
 * Depends on core.js. Text here is English source; the i18n DOM pass translates what is rendered. */
(function (root) {
  'use strict';
  const K = root.MintBudget;

  // ---------------------------------------------------------------- budget plan <-> template
  const GROUP_LABELS = { needs: 'Needs', wants: 'Wants', savings: 'Savings', invest: 'Investing' };
  const KIND_LABELS = { flex: 'Flexible', fixed: 'Fixed bill' };
  // Planned amounts in a sold plan are for a reference income, never the seller's own.
  const REFERENCE_INCOME_USD = 3000;

  function colId(i) {
    return 'c' + (i + 1);
  }

  /** A sellable spreadsheet of this budget's envelopes: shares of income, no transactions, no real amounts. */
  K.planToSpec = function (book, opts) {
    const o = opts || {};
    const cur = book.meta.currency;
    const income = K.monthlyIncome(book);
    const cats = K.list(book, 'categories')
      .filter((c) => c.name)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const totalLimit = cats.reduce((s, c) => s + Math.max(0, Number(c.limit) || 0), 0);
    const basis = income > 0 ? income : totalLimit;
    const reference = K.niceRound(K.convert(REFERENCE_INCOME_USD, 'USD', cur), cur) || REFERENCE_INCOME_USD;
    const share = (c) => (basis > 0 ? Math.round(((Math.max(0, Number(c.limit) || 0) / basis) * 1000)) / 1000 : 0);
    const groupPct = {};
    cats.forEach((c) => {
      groupPct[c.group] = (groupPct[c.group] || 0) + share(c);
    });
    const pct = (g) => Math.round((groupPct[g] || 0) * 100);
    const columns = [
      { id: colId(0), name: 'Envelope', type: 'text' },
      { id: colId(1), name: 'Group', type: 'select', options: ['Needs', 'Wants', 'Savings', 'Investing'] },
      { id: colId(2), name: 'Type', type: 'select', options: ['Flexible', 'Fixed bill'] },
      { id: colId(3), name: 'Share of Income', type: 'percent' },
      { id: colId(4), name: 'Planned', type: 'currency' },
      { id: colId(5), name: 'Spent', type: 'currency' },
      { id: colId(6), name: 'Left', type: 'formula', formula: '[Planned]-[Spent]', format: 'currency' },
      { id: colId(7), name: 'Status', type: 'formula', formula: 'IF([Spent]>[Planned],"Over","OK")', format: 'text' },
    ];
    const rows = cats.slice(0, 120).map((c, i) => ({
      id: 'r' + (i + 1),
      c1: ((c.emoji ? c.emoji + ' ' : '') + c.name).slice(0, 60),
      c2: GROUP_LABELS[c.group] || 'Needs',
      c3: c.group === 'savings' || c.group === 'invest' ? 'Fixed bill' : KIND_LABELS[c.kind === 'fixed' ? 'fixed' : 'flex'],
      c4: share(c),
      c5: K.roundMoney(share(c) * reference, cur),
      c6: 0,
    }));
    const name = String(o.title || book.meta.name || 'My budget').slice(0, 50);
    return {
      title: (name + ' plan').slice(0, 70),
      description: (
        'A ' + rows.length + '-envelope monthly budget made in Mint: needs ' + pct('needs') + '%, wants ' + pct('wants') + '%, savings ' + pct('savings') +
        '%, investing ' + pct('invest') + '% of income. Planned amounts are for a ' + K.fmt(reference, cur) +
        ' monthly income; open it in Mint to size every envelope to yours automatically.'
      ).slice(0, 500),
      category: 'Finance',
      blueprint: 'mint-budget-plan',
      theme: 'mint',
      currency: cur,
      prompt: '',
      sheet: { name: 'Budget', columns: columns, rows: rows },
      summary: [
        { label: 'Total planned', fn: 'SUM', column: 'Planned' },
        { label: 'Total spent', fn: 'SUM', column: 'Spent' },
        { label: 'Left to spend', fn: 'SUM', column: 'Left' },
        { label: 'Envelopes over', fn: 'COUNTIF', column: 'Status', match: 'Over' },
      ],
      rules: [
        { column: 'Left', op: '<', value: 0, style: 'bad' },
        { column: 'Status', op: '=', value: 'Over', style: 'bad' },
        { column: 'Status', op: '=', value: 'OK', style: 'good' },
      ],
    };
  };

  /** A sellable investing mix: target allocation per asset class (+ optional example tickers, never amounts). */
  K.mixToSpec = function (book, opts) {
    const o = opts || {};
    const target = book.meta.target || K.targetFor(50);
    const mix = target.mix || {};
    const examples = {};
    if (o.includeSymbols) {
      K.list(book, 'holdings').forEach((h) => {
        const cls = K.ASSET_CLASSES[h.cls] ? h.cls : 'other';
        if (h.symbol) examples[cls] = (examples[cls] ? examples[cls] + ', ' : '') + h.symbol;
      });
    }
    const classes = Object.keys(K.ASSET_CLASSES).filter((k) => Number(mix[k]) > 0);
    const columns = [
      { id: 'c1', name: 'Asset Class', type: 'text' },
      { id: 'c2', name: 'Target', type: 'percent' },
      { id: 'c3', name: 'Examples', type: 'text' },
      { id: 'c4', name: 'My Value', type: 'currency' },
      { id: 'c5', name: 'Notes', type: 'text' },
    ];
    const rows = classes.map((k, i) => ({
      id: 'r' + (i + 1),
      c1: K.ASSET_CLASSES[k].label,
      c2: Math.round(Number(mix[k]) * 10) / 1000,
      c3: (examples[k] || '').slice(0, 120),
      c4: 0,
      c5: '',
    }));
    const label = target.label && target.label !== 'Custom' ? target.label : 'Custom';
    return {
      title: (String(o.title || label + ' investing mix')).slice(0, 70),
      description: (
        'A ' + label.toLowerCase() + ' target allocation made in Mint: ' +
        classes.map((k) => K.ASSET_CLASSES[k].label + ' ' + Math.round(Number(mix[k])) + '%').join(', ') +
        '. Fill in your values to see how far you are from target, or open it in Mint to set it as your portfolio target. Educational, not financial advice.'
      ).slice(0, 500),
      category: 'Finance',
      blueprint: 'mint-invest-mix',
      theme: 'mint',
      currency: book.meta.currency,
      prompt: '',
      sheet: { name: 'Mix', columns: columns, rows: rows },
      summary: [{ label: 'Portfolio total', fn: 'SUM', column: 'My Value' }],
      rules: [],
    };
  };

  function colByName(spec, name) {
    const want = name.toLowerCase();
    return (spec.sheet.columns || []).find((c) => String(c.name).toLowerCase() === want);
  }

  /** Read a Mint plan/mix template back. Returns {kind:'plan', envelopes:[...]} | {kind:'mix', mix:{...}} | null. */
  K.specToPlan = function (spec) {
    if (!spec || !spec.sheet || !Array.isArray(spec.sheet.rows)) return null;
    const bp = String(spec.blueprint || '');
    if (bp === 'mint-budget-plan') {
      const nameCol = colByName(spec, 'Envelope');
      const groupCol = colByName(spec, 'Group');
      const typeCol = colByName(spec, 'Type');
      const shareCol = colByName(spec, 'Share of Income');
      const plannedCol = colByName(spec, 'Planned');
      if (!nameCol || !groupCol) return null;
      const groupBy = {};
      Object.keys(GROUP_LABELS).forEach((g) => (groupBy[GROUP_LABELS[g].toLowerCase()] = g));
      const envelopes = spec.sheet.rows
        .map((r) => {
          const raw = String(r[nameCol.id] || '').trim();
          const m = raw.match(/^(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)\s+(.+)$/u);
          const group = groupBy[String(r[groupCol.id] || '').toLowerCase()] || 'needs';
          return {
            name: (m ? m[2] : raw).slice(0, 40),
            emoji: m ? m[1] : '',
            group: group,
            kind: typeCol && /fixed/i.test(String(r[typeCol.id] || '')) ? 'fixed' : 'flex',
            share: shareCol ? Math.max(0, Math.min(1, Number(r[shareCol.id]) || 0)) : 0,
            planned: plannedCol ? Math.max(0, Number(r[plannedCol.id]) || 0) : 0,
          };
        })
        .filter((e) => e.name);
      return envelopes.length ? { kind: 'plan', title: spec.title, currency: spec.currency, envelopes: envelopes } : null;
    }
    if (bp === 'mint-invest-mix') {
      const clsCol = colByName(spec, 'Asset Class');
      const pctCol = colByName(spec, 'Target');
      if (!clsCol || !pctCol) return null;
      const byLabel = {};
      Object.keys(K.ASSET_CLASSES).forEach((k) => (byLabel[K.ASSET_CLASSES[k].label.toLowerCase()] = k));
      const mix = {};
      spec.sheet.rows.forEach((r) => {
        const cls = byLabel[String(r[clsCol.id] || '').toLowerCase()];
        const v = Number(r[pctCol.id]);
        if (cls && isFinite(v) && v > 0) mix[cls] = Math.round(v * 1000) / 10;
      });
      return Object.keys(mix).length ? { kind: 'mix', title: spec.title, mix: mix } : null;
    }
    return null;
  };

  // ---------------------------------------------------------------- investing quiz
  // a = index of the right answer. Short enough for a phone screen; explanations teach the idea.
  K.INVEST_QUIZ = [
    {
      topic: 'Compounding',
      q: 'You invest once and it grows 7% a year. Roughly how long until it doubles?',
      o: ['About 5 years', 'About 10 years', 'About 20 years'],
      a: 1,
      why: 'Rule of 72: 72 ÷ 7 ≈ 10 years. Your gains start earning gains too. That is compounding.',
    },
    {
      topic: 'Diversification',
      q: 'Which is usually the least risky?',
      o: ['Shares of one company', 'A fund that holds hundreds of companies', 'Two companies in the same industry'],
      a: 1,
      why: 'Spreading money over many companies means one bad result cannot sink your whole portfolio.',
    },
    {
      topic: 'Safety net',
      q: 'What should usually come before long-term investing?',
      o: ['An emergency fund of 3–6 months of expenses', 'A position in crypto', 'A new credit card'],
      a: 0,
      why: 'With a cash cushion you will not be forced to sell investments at a bad time when life happens.',
    },
    {
      topic: 'Fees',
      q: 'One fund charges 2% a year, another 0.2%. Over 30 years the cheaper one…',
      o: ['Makes almost no difference', 'Can leave you with a lot more money', 'Is always riskier'],
      a: 1,
      why: 'Fees compound too. Paying 1.8% more every year can eat roughly 40% of the final amount over 30 years.',
    },
    {
      topic: 'Inflation',
      q: 'Your savings earn 2% a year while prices rise 4% a year. Your buying power…',
      o: ['Grows', 'Stays the same', 'Shrinks'],
      a: 2,
      why: 'Real return = return − inflation. 2% − 4% means you can buy about 2% less each year.',
    },
    {
      topic: 'Risk and return',
      q: 'Which usually has the highest long-term return and the biggest swings?',
      o: ['Cash deposits', 'Government bonds', 'Stocks'],
      a: 2,
      why: 'Higher expected return comes with bigger ups and downs. That is why time horizon matters.',
    },
    {
      topic: 'Habits',
      q: 'Investing the same amount every month, whatever the price, is called…',
      o: ['Dollar-cost averaging', 'Market timing', 'Day trading'],
      a: 0,
      why: 'You automatically buy more when prices are low and never have to guess the perfect moment.',
    },
    {
      topic: 'Time horizon',
      q: 'Money you need in one year for a house deposit is best kept in…',
      o: ['Stocks', 'Cash or short-term deposits', 'Crypto'],
      a: 1,
      why: 'Short-term money should not ride the market. A drop right before you need it would hurt.',
    },
    {
      topic: 'Rebalancing',
      q: 'Your target is 60% stocks and 40% bonds, but stocks grew to 75%. Rebalancing means…',
      o: ['Moving money back to 60/40', 'Buying even more stocks', 'Never changing anything'],
      a: 0,
      why: 'Rebalancing keeps your risk where you chose it and quietly sells high and buys low.',
    },
    {
      topic: 'Scams',
      q: 'Someone promises "guaranteed 30% a month, no risk". This is most likely…',
      o: ['A great deal', 'A scam', 'A government bond'],
      a: 1,
      why: 'No real investment guarantees high returns with no risk. Walk away and check your regulator\'s warning list.',
    },
    {
      topic: 'Index funds',
      q: 'An index fund…',
      o: ['Tries to beat the market by picking stocks', 'Holds every company in a market index at low cost', 'Only buys bank deposits'],
      a: 1,
      why: 'Index funds buy the whole market, so you get its return with low fees and no stock picking.',
    },
    {
      topic: 'Staying calm',
      q: 'The market falls 20% and your long-term plan has not changed. A sensible move is usually…',
      o: ['Sell everything now', 'Stay the course and keep investing', 'Borrow money to buy more'],
      a: 1,
      why: 'Markets have recovered from every major fall so far. Selling in a panic turns a temporary drop into a real loss.',
    },
  ];

  K.quizBadge = function (score, total) {
    const r = total ? score / total : 0;
    if (r >= 0.9) return { emoji: '🏆', label: 'Money master' };
    if (r >= 0.7) return { emoji: '🎓', label: 'Smart investor' };
    if (r >= 0.5) return { emoji: '📚', label: 'Getting there' };
    return { emoji: '🌱', label: 'Just starting' };
  };

  // ---------------------------------------------------------------- personal investing tips
  const EVERGREEN = [
    { icon: '🧾', title: 'Check the fees', body: 'Before buying a fund, look at its yearly fee. Under 0.5% is a good sign for broad index funds.' },
    { icon: '🤖', title: 'Automate it', body: 'Set an automatic transfer on payday. Money you never see is money you do not spend.' },
    { icon: '🗓️', title: 'Review once a year', body: 'Checking daily makes you nervous. A yearly check-up to rebalance is enough for most people.' },
    { icon: '📣', title: 'Ignore hot tips', body: 'If everyone is talking about it, the easy gains are usually gone. Stick to your plan.' },
    { icon: '🏦', title: 'Use tax-friendly accounts', body: 'Many countries offer retirement or tax-advantaged accounts. Ask what exists where you live before investing elsewhere.' },
    { icon: '⏳', title: 'Time beats timing', body: 'Staying invested for years matters far more than finding the perfect day to buy.' },
  ];

  /** Personal tips from this budget and portfolio, most important first, then a daily evergreen tip. */
  K.investTips = function (book, stats, todayStr) {
    const pf = K.portfolio(book);
    const cur = book.meta.currency;
    const tips = [];
    const pctOf = (v) => (pf.total > 0 ? Math.round((v / pf.total) * 100) : 0);
    if (!pf.rows.length) {
      tips.push({ icon: '🌱', tone: 'good', title: 'Start small', body: 'You do not need much to begin. A low-cost index fund every month beats waiting for the perfect moment.' });
    }
    const worst = pf.drift.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (pf.total > 0 && worst && Math.abs(worst.diff) > 5) {
      const label = (K.ASSET_CLASSES[worst.cls] || K.ASSET_CLASSES.other).label;
      tips.push({
        icon: '⚖️',
        tone: 'warn',
        title: 'Time to rebalance',
        body: K.t('{cls} is {diff} points off target. Moving about {amount} brings you back to your plan.', {
          cls: K.i18n ? K.i18n.tr(label) : label,
          diff: Math.abs(worst.diff).toFixed(1),
          amount: K.fmt(Math.abs(worst.trade), cur, true),
        }),
      });
    }
    const crypto = pctOf(pf.byClass.crypto || 0);
    if (crypto > 10) {
      tips.push({ icon: '🎢', tone: 'warn', title: K.t('Crypto is {pct}% of your portfolio', { pct: crypto }), body: 'That is a lot of swing. Many planners keep speculative assets under 5–10%.' });
    }
    const big = pf.rows[0];
    if (pf.rows.length > 1 && big && pctOf(big.value) > 30 && big.cls !== 'cash') {
      tips.push({ icon: '🧺', tone: 'warn', title: K.t('{name} is {pct}% of your portfolio', { name: big.symbol || big.name || '—', pct: pctOf(big.value) }), body: 'One company can fall hard. Spreading out lowers the risk of a single surprise.' });
    }
    const cash = pctOf(pf.byClass.cash || 0);
    if (pf.total > 0 && cash > 25) {
      tips.push({ icon: '💤', tone: 'info', title: 'Lots of idle cash', body: K.t('{pct}% of your portfolio sits in cash. Beyond your emergency fund, inflation slowly eats it.', { pct: cash }) });
    }
    if (pf.basis > 0 && pf.plPct < -0.1) {
      tips.push({ icon: '🧘', tone: 'info', title: K.t('Down {pct}%? Breathe.', { pct: Math.round(-pf.plPct * 100) }), body: 'Falls are normal. If your plan and time horizon have not changed, selling now locks in the loss.' });
    }
    const income = stats ? stats.income : 0;
    const investRow = stats ? stats.rows.filter((r) => r.cat.group === 'invest') : [];
    const investPlanned = investRow.reduce((s, r) => s + r.limit, 0);
    if (income > 0 && investPlanned / income < 0.1) {
      tips.push({ icon: '📈', tone: 'info', title: 'Invest a little more', body: K.t('You plan {pct}% of income for investing. Raising it by 1% of income each year adds up fast.', { pct: Math.round((investPlanned / income) * 100) }) });
    }
    const hasEmergency = K.list(book, 'goals').some((g) => /emergenc|darurat|应急|emergencia|🛟/i.test((g.emoji || '') + ' ' + (g.name || '')));
    if (!hasEmergency) {
      tips.push({ icon: '🛟', tone: 'info', title: 'Emergency fund first', body: 'Keep 3–6 months of expenses in cash before taking investment risk. Add it as a goal in Goals.' });
    }
    const foreign = pf.rows.filter((h) => h.cur && h.cur !== cur).length;
    if (foreign) {
      tips.push({ icon: '🌏', tone: 'info', title: 'Currency counts too', body: K.t('{n} of your holdings are priced in other currencies, so exchange rates move their value in {cur}.', { n: foreign, cur: cur }) });
    }
    const day = Math.floor(Date.parse((todayStr || K.today()) + 'T00:00:00Z') / 864e5);
    tips.push(Object.assign({ tone: 'info' }, EVERGREEN[((day % EVERGREEN.length) + EVERGREEN.length) % EVERGREEN.length]));
    return tips;
  };
})(window);
