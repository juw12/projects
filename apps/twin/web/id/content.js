/* Twin Indonesia content (codename Satu): analysts, community seed, plans, Academy lessons and the guide.
 * All people and posts here are fictional demo content.
 */
window.SATU_CONTENT = {
  analysts: {
    rina: {
      id: 'rina',
      name: 'Rina Kartika',
      initials: 'RK',
      color: '#0f766e',
      focus: 'IDX equities · banks, consumer, commodities',
      licence: 'Investment adviser licence (demo profile)',
      markets: ['IDX'],
    },
    arif: {
      id: 'arif',
      name: 'Arif Santoso',
      initials: 'AS',
      color: '#2f54eb',
      focus: 'US equities · large caps and ETFs',
      licence: 'Investment adviser licence (demo profile)',
      markets: ['US'],
    },
    maya: {
      id: 'maya',
      name: 'Maya Lestari',
      initials: 'ML',
      color: '#b45309',
      focus: 'Crypto & gold · risk-first macro',
      licence: 'Investment adviser licence (demo profile)',
      markets: ['CRYPTO', 'GOLD'],
    },
  },

  rooms: [
    { id: 'lobby', name: 'Lobby · beginners', market: null, tier: 'free', about: 'Ask anything. No question is too basic.' },
    { id: 'us', name: 'US stocks', market: 'US', tier: 'free', about: 'Fractional US shares and ETFs.' },
    { id: 'idx', name: 'Saham Indonesia', market: 'IDX', tier: 'free', about: 'IDX stocks, lots, dividends and corporate actions.' },
    { id: 'crypto', name: 'Crypto', market: 'CRYPTO', tier: 'free', about: 'Licensed exchanges only. Nobody sells signals here.' },
    { id: 'gold', name: 'Gold', market: 'GOLD', tier: 'free', about: 'Digital gold, spreads and long-term saving.' },
    { id: 'dividend', name: 'IDX Dividend Club', market: 'IDX', tier: 'plus', about: 'Members: dividend calendars, payout history and yield traps.' },
    { id: 'earnings', name: 'US Earnings Club', market: 'US', tier: 'plus', about: 'Members: earnings previews and honest post-mortems.' },
    { id: 'riskdesk', name: 'Crypto Risk Desk', market: 'CRYPTO', tier: 'plus', about: 'Members: sizing and drawdown control for crypto.' },
  ],

  posts: [
    {
      id: 'p1', room: 'lobby', handle: 'dina_belajar', name: 'Dina', createdAt: '2026-10-28T03:12:00Z', likes: 24,
      text: 'Just finished the fees lesson. I had no idea an IDX round trip costs about 0.4% before I make anything. Changes how often I want to trade.',
    },
    {
      id: 'p2', room: 'idx', handle: 'budi.s', name: 'Budi', createdAt: '2026-10-28T02:40:00Z', likes: 17, holder: true, sentiment: 'neutral',
      text: '$BBCA is close to its 52-week low. Anyone comparing it with $BMRI? Not a call, I just want to learn how you look at banks.',
    },
    {
      id: 'p3', room: 'idx', handle: 'sari_dividen', name: 'Sari', createdAt: '2026-10-27T23:05:00Z', likes: 31,
      text: 'Beginner reminder: 1 lot = 100 shares. At Rp2,070 a $TLKM lot is about Rp207,000 plus fees.',
    },
    {
      id: 'p4', room: 'us', handle: 'kevin.w', name: 'Kevin', createdAt: '2026-10-27T15:30:00Z', likes: 12, holder: true, sentiment: 'bullish',
      text: 'Bought my first fractional $VOO with Rp200k in practice mode. The FX spread showed clearly in the preview before I confirmed.',
    },
    {
      id: 'p5', room: 'us', handle: 'tasya', name: 'Tasya', createdAt: '2026-10-27T13:10:00Z', likes: 9, sentiment: 'neutral',
      text: '$NVDA swings a lot, so I keep it under 10% of my practice portfolio. How do you size positions around earnings?',
    },
    {
      id: 'p6', room: 'crypto', handle: 'raka_btc', name: 'Raka', createdAt: '2026-10-27T20:45:00Z', likes: 20, holder: true,
      text: 'Crypto never closes. I write my stop rule down before I buy $BTC, otherwise I end up checking prices at 3am.',
    },
    {
      id: 'p7', room: 'crypto', handle: 'sinyal_cuan88', name: 'Sinyal Cuan', createdAt: '2026-10-28T01:00:00Z', likes: 0,
      text: 'Join VIP grup sinyal saya, pasti cuan 30% per minggu! WA 081234567890',
    },
    {
      id: 'p8', room: 'gold', handle: 'ibu.rahma', name: 'Rahma', createdAt: '2026-10-27T09:20:00Z', likes: 15, holder: true, sentiment: 'neutral',
      text: 'Gold here costs about 2% for a round trip, so I treat $XAU as long-term saving, not quick flips.',
    },
    {
      id: 'p9', room: 'lobby', handle: 'adit', name: 'Adit', createdAt: '2026-10-27T11:55:00Z', likes: 28,
      text: 'Someone offered me a "trading robot" that pays a fixed weekly return. Isn\u2019t that exactly what OJK warns about?',
    },
    {
      id: 'p10', room: 'idx', handle: 'gorengan_alert', name: 'Info Saham', createdAt: '2026-10-28T04:30:00Z', likes: 0,
      text: 'Saham ini dijamin naik 50% minggu depan, beli sekarang sebelum terbang! DM aku untuk kode sahamnya.',
    },
    {
      id: 'p11', room: 'dividend', handle: 'sari_dividen', name: 'Sari', createdAt: '2026-10-26T08:00:00Z', likes: 22,
      text: 'A high dividend yield after a price crash can be a trap. Check whether earnings actually cover the payout before buying for yield.',
    },
    {
      id: 'p12', room: 'earnings', handle: 'kevin.w', name: 'Kevin', createdAt: '2026-10-25T22:10:00Z', likes: 14,
      text: 'My earnings post-mortem template: what was expected, what came out, how the price reacted, what I would do differently.',
    },
    {
      id: 'p13', room: 'riskdesk', handle: 'raka_btc', name: 'Raka', createdAt: '2026-10-26T14:00:00Z', likes: 19,
      text: 'Rule I use: if a coin falls 20% from my entry I cut half. Written down before I buy, so emotions do not decide.',
    },
  ],

  plans: [
    {
      id: 'free',
      name: 'Free',
      priceIdr: 0,
      tagline: 'Learn and practise',
      features: [
        'Practice trading in US, IDX, crypto and gold',
        'Delayed live prices and news',
        'Public community rooms',
        'Every Academy lesson and mission',
        'Scam Shield on every post',
        'Analyst track records (proof is free)',
      ],
    },
    {
      id: 'plus',
      name: 'Plus',
      priceIdr: 49000,
      tagline: 'Join the members\u2019 rooms',
      features: [
        'Everything in Free',
        'Members\u2019 rooms: IDX Dividend Club, US Earnings Club, Crypto Risk Desk',
        'Weekly live Q&A with licensed analysts',
        'Portfolio X-ray and no ads',
      ],
    },
    {
      id: 'pro',
      name: 'Pro',
      priceIdr: 149000,
      tagline: 'Live ideas from licensed advisers',
      features: [
        'Everything in Plus',
        'Analyst Desk: live ideas with entry, target, stop and reasoning',
        'Every idea is scored automatically; losers are never deleted',
        'Send an idea to your practice ticket (you still decide)',
        'Idea alerts',
      ],
    },
  ],

  riskQuestions: [
    { key: 'goal', q: 'What is your main goal?', options: ['Protect my savings', 'Steady growth', 'Grow wealth over years', 'Fast gains from trading'] },
    { key: 'horizon', q: 'When might you need this money?', options: ['Within a year', 'In 1\u20133 years', 'In 3\u20137 years', 'Not for 7+ years'] },
    { key: 'drawdown', q: 'Your portfolio falls 20% in a month. You\u2026', options: ['Sell everything', 'Sell some', 'Hold and wait', 'Buy more'] },
    { key: 'experience', q: 'Your investing experience', options: ['None yet', 'Savings or mutual funds', 'Some stocks or crypto', 'I trade actively'] },
    { key: 'emergencyFund', q: 'Do you have 3\u20136 months of expenses saved for emergencies?', options: ['No', 'Yes'], boolean: true },
  ],

  scamExamples: [
    { text: 'Gabung grup VIP kami, pasti cuan 5% per hari!', scam: true },
    { text: 'IDX fees here are 0.15% to buy and 0.25% to sell. Check them before you trade.', scam: false },
    { text: 'Transfer dulu Rp500rb ke rekening saya, nanti robot trading kerja otomatis.', scam: true },
    { text: 'Before investing, I checked the platform on sipasti.ojk.go.id.', scam: false },
    { text: 'Mau profit konsisten? DM aku, link Telegram ada di bio.', scam: true },
    { text: 'I keep crypto under 10% of my portfolio because it swings so much.', scam: false },
  ],

  levels: [
    { id: 1, name: 'Foundations' },
    { id: 2, name: 'Building a portfolio' },
    { id: 3, name: 'Going global' },
  ],

  lessons: [
    {
      id: 'four-markets',
      level: 1,
      title: 'Four markets, one wallet',
      minutes: 4,
      cards: [
        'US stocks: you own a slice of a US company. With fractional shares you can start from $1. Prices are in dollars, so the USD/IDR rate also moves your result.',
        'Indonesian stocks (IDX): shares listed in Jakarta, bought in lots of 100 shares, during weekday sessions with a lunch break.',
        'Crypto: digital assets that trade 24/7 and can move 10% in a day. Use only exchanges licensed by OJK.',
        'Gold: bought by the gram. It often moves differently from stocks, but the buy/sell spread makes quick trades costly.',
      ],
      widget: 'market-match',
      quiz: [
        { q: 'You buy 1 lot of an IDX stock. How many shares do you own?', options: ['1', '10', '100', '1,000'], answer: 2, why: 'On the IDX, 1 lot = 100 shares.' },
        { q: 'Which market is priced in US dollars?', options: ['US stocks', 'IDX stocks', 'Crypto (here)', 'Gold (here)'], answer: 0, why: 'Twin Indonesia prices crypto and gold in rupiah; US stocks stay in dollars and convert at the shown rate.' },
        { q: 'A US stock gains 5%, but your rupiah result is lower. Why?', options: ['IDX lunch break', 'The rupiah strengthened against the dollar', 'The gold spread', 'Nothing can cause that'], answer: 1, why: 'A stronger rupiah means each dollar buys fewer rupiah when you sell.' },
      ],
    },
    {
      id: 'fees',
      level: 1,
      title: 'Fees and the break-even move',
      minutes: 4,
      cards: [
        'Every trade costs something: broker fees, taxes, spreads or currency conversion.',
        'The break-even move is how far the price must rise before a sale covers both fees: (1 + buy fee) \u00f7 (1 \u2212 sell fee) \u2212 1.',
        'Frequent trading multiplies the cost. Ten IDX round trips cost about 4% of the money you trade, before any gain or loss.',
      ],
      widget: 'fee-calculator',
      quiz: [
        { q: 'With 0.15% to buy and 0.25% to sell, roughly how far must an IDX price rise to break even?', options: ['0.1%', '0.4%', '1%', '4%'], answer: 1, why: '1.0015 \u00f7 0.9975 \u2212 1 \u2248 0.40%.' },
        { q: 'In Twin Indonesia, which is most expensive for a quick in-and-out trade?', options: ['An IDX stock', 'A US ETF', 'Digital gold', 'They cost the same'], answer: 2, why: 'Gold has a ~2% round-trip spread, versus ~0.4% (IDX) and ~1% (US incl. FX).' },
      ],
    },
    {
      id: 'idx-lots',
      level: 1,
      title: 'IDX lots and price steps',
      minutes: 3,
      cards: [
        'IDX stocks trade in lots of 100 shares. A Rp5,000 stock needs at least Rp500,000 plus fees for one lot.',
        'Prices move in fixed steps (fraksi harga): Rp1 below Rp200, Rp2 up to Rp500, Rp5 up to Rp2,000, Rp10 up to Rp5,000 and Rp25 above that.',
        'A limit order has to sit on a valid step. Twin checks it before you send the order.',
      ],
      widget: 'lot-calculator',
      quiz: [
        { q: 'Budget Rp1,000,000, stock at Rp4,500. How many whole lots can you buy, ignoring fees?', options: ['1', '2', '22', '222'], answer: 1, why: 'One lot costs Rp450,000, so two lots fit (Rp900,000).' },
        { q: 'Which limit price is valid for a stock trading near Rp3,000?', options: ['Rp3,003', 'Rp3,005', 'Rp3,010', 'Rp3,012'], answer: 2, why: 'Between Rp2,000 and Rp5,000 the step is Rp10.' },
      ],
    },
    {
      id: 'scam-shield',
      level: 1,
      title: 'Scam Shield: spot investasi bodong',
      minutes: 5,
      cards: [
        'Red flags: guaranteed or fixed returns ("pasti cuan 5% per minggu"), pressure to act now, private WhatsApp or Telegram groups, requests to transfer money to a person, and Binomo, Quotex, Olymp Trade or "robot trading".',
        'Before trusting any platform, check OJK: call 157, WhatsApp 081-157-157-157, or visit sipasti.ojk.go.id.',
        'In Indonesia, paid investment recommendations need an OJK investment-adviser licence. Twin only lets licensed advisers publish ideas, and every idea is scored automatically.',
      ],
      widget: 'scam-sorter',
      quiz: [
        { q: 'Which message is a red flag?', options: ['Spread your money across markets', 'Join our VIP group, guaranteed 20% weekly', 'Check the fees before trading', 'Decide your stop before you buy'], answer: 1, why: 'Guaranteed or fixed returns and private paid groups are classic investasi bodong signs.' },
        { q: 'Where can you check that a platform is licensed?', options: ['Its Instagram bio', 'Kontak OJK 157 or sipasti.ojk.go.id', 'The Telegram admin', 'App store reviews'], answer: 1, why: 'Only OJK\u2019s own channels can confirm a licence.' },
      ],
    },
    {
      id: 'compounding',
      level: 2,
      title: 'Compounding versus "weekly income"',
      minutes: 4,
      cards: [
        'Compounding means returns earn returns. Time and regular deposits matter more than the starting amount.',
        'A diversified portfolio has bad years as well as good ones. Nobody can promise a return, and anyone who does is a red flag.',
        'Weekly "income" from a small balance is tiny: Rp100,000 at 5% a year earns about Rp96 a week.',
      ],
      widget: 'compound-slider',
      quiz: [
        { q: 'What helps a small investor most over 10 years?', options: ['Trading every day', 'Regular deposits and time', 'Borrowing to invest', 'Buying signals'], answer: 1, why: 'Deposits plus time let compounding work; frequent trading mostly adds fees.' },
        { q: 'Rp1,000,000 at 6% a year earns roughly how much per week?', options: ['Rp1,150', 'Rp11,500', 'Rp60,000', 'Rp115,000'], answer: 0, why: 'Rp1,000,000 \u00d7 6% \u00f7 52 \u2248 Rp1,154.' },
      ],
    },
    {
      id: 'diversification',
      level: 2,
      title: 'Diversifying across four markets',
      minutes: 4,
      cards: [
        'Different markets do not always move together. Mixing them can lower the swings of the whole portfolio.',
        'Crypto is far more volatile than stocks or gold, so even a small slice changes the total risk noticeably.',
        'The numbers in this lesson are teaching assumptions, not forecasts.',
      ],
      widget: 'allocation',
      quiz: [
        { q: 'Adding a small slice of a very volatile asset\u2026', options: ['Never changes the risk', 'Can raise the total risk a lot', 'Always lowers the risk', 'Removes the fees'], answer: 1, why: 'Volatility scales with weight times volatility, so a very volatile slice matters.' },
        { q: 'Why can gold help a stock portfolio?', options: ['It never falls', 'It often moves differently from stocks', 'It has no spread', 'It pays dividends'], answer: 1, why: 'Low correlation is what lowers the combined swings.' },
      ],
    },
    {
      id: 'position-sizing',
      level: 2,
      title: 'Position sizing and stop rules',
      minutes: 4,
      cards: [
        'Decide how much you are willing to lose on one idea before you buy. Many traders use 0.5\u20131% of the portfolio.',
        'Position size = money at risk \u00f7 distance to your stop.',
        'Your Twin Indonesia risk profile sets a maximum per asset and a crypto cap. The order ticket warns you when an order goes past them.',
      ],
      widget: 'sizing-calculator',
      quiz: [
        { q: 'Capital Rp10,000,000, risk 1%, entry Rp1,000, stop Rp900. How many shares?', options: ['100', '1,000', '10,000', '100,000'], answer: 1, why: 'Rp100,000 at risk \u00f7 Rp100 per share = 1,000 shares.' },
        { q: 'On the IDX, how many lots is that?', options: ['1', '10', '100', '1,000'], answer: 1, why: '1,000 shares \u00f7 100 = 10 lots.' },
      ],
    },
    {
      id: 'fx-risk',
      level: 3,
      title: 'US stocks and the rupiah',
      minutes: 3,
      cards: [
        'When you own US stocks, your rupiah result combines the stock\u2019s return with the change in USD/IDR.',
        'Rupiah return = (1 + stock return) \u00d7 (1 + USD/IDR change) \u2212 1.',
        'A conversion spread applies when you buy and again when you sell.',
      ],
      widget: 'fx-calculator',
      quiz: [
        { q: 'A US stock rises 10% while USD/IDR falls 5% (the rupiah strengthens). Your rupiah return is about\u2026', options: ['+15%', '+10%', '+4.5%', '\u22125%'], answer: 2, why: '1.10 \u00d7 0.95 \u2212 1 = 4.5%.' },
        { q: 'Which cost applies to US trades in Twin Indonesia?', options: ['None', 'A currency conversion spread', 'The IDX levy', 'The gold spread'], answer: 1, why: 'US trades convert rupiah to dollars and back, at a spread.' },
      ],
    },
    {
      id: 'judging-analysts',
      level: 3,
      title: 'How to judge an analyst',
      minutes: 5,
      cards: [
        'A real track record includes every call, winners and losers, timestamped before the move.',
        'Compare with a benchmark: a +8% call is unimpressive if the whole market rose 10% over the same time.',
        'Win rate alone misleads. One big loss can erase many small wins, so look at the average return too.',
        'Check the licence. In Indonesia, paid recommendations need an OJK investment-adviser licence.',
      ],
      widget: 'scorecard-reader',
      quiz: [
        { q: 'An analyst only shows winning trades. What is the problem?', options: ['Nothing', 'Cherry-picking hides the losers', 'Too many fees', 'Wrong currency'], answer: 1, why: 'Without the losers you cannot judge the real average result.' },
        { q: 'An idea returned +6% while its benchmark rose 9% over the same period. Excess return?', options: ['+15%', '+6%', '\u22123%', '+3%'], answer: 2, why: '6% \u2212 9% = \u22123%: you would have done better just holding the index.' },
      ],
    },
  ],

  guide: [
    {
      title: 'Getting started',
      body: [
        'Twin Indonesia is the rupiah side of Twin, a practice-first investing app for four markets: US stocks, Indonesian stocks, crypto and gold. Everything in this prototype uses practice money; nothing here moves real money.',
        'Pick your markets and answer five risk questions. Your answers set guard-rails: a maximum share of the portfolio per asset and a crypto cap. The order ticket warns you when an order would break them.',
      ],
    },
    {
      title: 'Prices and data',
      body: [
        'Live mode uses delayed prices: US and IDX stocks from Yahoo Finance via the Twin snapshot (refreshed hourly), crypto and gold from CoinGecko (gold = tokenised gold XAUT, converted per gram). Every price shows its source.',
        'Offline, Twin Indonesia falls back to the bundled snapshot. Simulated mode moves prices randomly so you can practise limit orders at any time; simulated prices are labelled.',
      ],
    },
    {
      title: 'Placing a practice order',
      body: [
        'Open any asset and tap Buy or Sell. Enter an amount in rupiah or a quantity (lots for IDX). The preview shows every fee line, the total and the break-even move before you confirm.',
        'Market orders fill at once while the market is open. Outside trading hours they queue and fill at the next open. Limit orders wait until the price reaches your limit.',
      ],
    },
    {
      title: 'Community and Scam Shield',
      body: [
        'Rooms per market are free; members\u2019 rooms need Plus. Use $TICKER to link an asset. A Holder badge appears when you actually hold the asset in your portfolio.',
        'Scam Shield blocks posts that promise guaranteed or fixed returns, push private chats, ask for money transfers or mention illegal platforms, and explains why.',
      ],
    },
    {
      title: 'Analyst Desk',
      body: [
        'Only licensed advisers can publish ideas. Each idea records entry, target, stop and horizon, and is scored automatically against a benchmark. Ideas cannot be edited or deleted.',
        'Track records are free for everyone; live ideas need Pro. "Send to ticket" only fills in a practice order; you always decide.',
      ],
    },
    {
      title: 'Your data',
      body: [
        'Everything is stored in this browser. Export or reset it under Me. Your Twin Indonesia practice account sits next to Twin\'s US-dollar practice portfolio: Portfolio → Your two wallets moves money between them at the delayed mid rate minus a 0.5% practice spread, and moved money counts as money put in, not profit.',
      ],
    },
  ],
};
