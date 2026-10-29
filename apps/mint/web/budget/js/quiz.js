/* Mint Budget onboarding quiz + personality reveal. */
(function (root) {
  'use strict';
  const K = root.Kitty;
  const ui = K.ui;
  const esc = ui.esc;

  function personaCard(result, currency, opts) {
    const o = opts || {};
    const p = K.PERSONAS[result.persona];
    const plan = K.suggestPlan({ persona: result.persona, facts: result.facts, currency: currency }, currency);
    const traitBars = Object.keys(K.TRAITS)
      .map((t) => {
        const v = result.traits[t];
        const meta = K.TRAITS[t];
        return (
          '<div class="trait"><div class="trait-head"><span>' + esc(meta.low) + '</span><span>' + esc(meta.high) + '</span></div>' +
          '<div class="trait-track"><span class="trait-dot" style="left:' + v + '%"></span><span class="trait-fill" style="width:' + v + '%"></span></div></div>'
        );
      })
      .join('');
    const buckets = Object.keys(K.GROUPS)
      .map((g) => {
        const amount = plan.amounts[g];
        return (
          '<div class="bucket" style="--b:' + K.GROUPS[g].color + '"><b>' + plan.pct[g] + '%</b><span>' + esc(K.GROUPS[g].label) + '</span>' +
          (plan.income > 0 ? '<small>' + esc(K.fmt(amount, currency)) + '</small>' : '') + '</div>'
        );
      })
      .join('');
    const runnerUp = K.PERSONAS[result.ranking[1].key];
    return (
      '<div class="persona-card" style="--pc:' + p.color + '">' +
      '<div class="persona-glow"></div>' +
      '<div class="persona-emoji">' + p.emoji + '</div>' +
      '<p class="eyebrow">' + esc(o.eyebrow || 'Your money personality') + '</p>' +
      '<h2>' + esc(p.name) + '</h2>' +
      '<p class="persona-tag">' + esc(p.tagline) + ' · with a bit of ' + esc(runnerUp.name.replace('The ', '')) + ' ' + runnerUp.emoji + '</p>' +
      '<p class="persona-blurb">' + esc(p.blurb) + '</p>' +
      '<div class="persona-cols">' +
      '<div><h4>Superpowers</h4><ul>' + p.strengths.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' +
      '<div><h4>Watch out for</h4><ul>' + p.watch.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div>' +
      '</div>' +
      '<h4>Your money traits</h4><div class="traits">' + traitBars + '</div>' +
      '<h4>Mint\'s plan for you</h4><div class="buckets">' + buckets + '</div>' +
      (plan.notes.length ? '<ul class="plan-notes">' + plan.notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '') +
      '</div>'
    );
  }

  function open(opts) {
    const o = opts || {};
    const answers = Object.assign({}, o.initial || {});
    let currency = o.currency || 'IDR';
    // quick: a short setup (o.only question ids), no intro and no personality result.
    let step = o.skipIntro ? 0 : -1; // -1 intro, QUIZ.length = result
    const questions = K.QUIZ.filter((q) => !(o.skipName && q.id === 'name') && (!o.only || o.only.indexOf(q.id) >= 0));
    const host = document.createElement('div');
    host.className = 'quiz-overlay';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', o.quick ? 'Quick setup' : 'Money personality quiz');
    document.body.appendChild(host);
    document.body.classList.add('no-scroll');

    function close() {
      host.remove();
      document.body.classList.remove('no-scroll');
    }

    function next() {
      step++;
      draw();
    }
    function back() {
      if (o.skipIntro && step === 0) {
        close();
        return o.onCancel && o.onCancel();
      }
      step = Math.max(-1, step - 1);
      draw();
    }

    function draw() {
      if (step >= questions.length) return o.quick ? finishQuick() : drawResult();
      if (step < 0) return drawIntro();
      const q = questions[step];
      const pct = Math.round((step / questions.length) * 100);
      let body = '';
      if (q.type === 'choice') {
        body =
          '<div class="q-options">' +
          q.options
            .map(
              (opt, i) =>
                '<button class="q-opt' + (String(answers[q.id]) === String(opt.v) ? ' is-on' : '') + '" data-v="' + esc(opt.v) + '" style="--i:' + i + '">' +
                '<span class="q-emoji">' + opt.emoji + '</span><span>' + esc(opt.label) + '</span></button>'
            )
            .join('') +
          '</div>';
      } else if (q.type === 'multi') {
        const sel = answers[q.id] || [];
        body =
          '<div class="q-chips">' +
          q.options
            .map(
              (opt, i) =>
                '<button class="q-chip' + (sel.indexOf(opt.v) >= 0 ? ' is-on' : '') + '" data-v="' + esc(opt.v) + '" style="--i:' + i + '">' +
                opt.emoji + ' ' + esc(opt.label) + '</button>'
            )
            .join('') +
          '</div><button class="btn btn-primary q-next" data-act="continue">Continue</button>';
      } else if (q.type === 'money') {
        const val = answers[q.id] ? K.fmt(answers[q.id], currency).replace(/[^\d.,]/g, '') : '';
        body =
          '<div class="q-money">' +
          (q.id === 'income'
            ? '<select class="q-cur" aria-label="Currency">' +
              Object.keys(K.CURRENCIES).map((c) => '<option value="' + c + '"' + (c === currency ? ' selected' : '') + '>' + c + '</option>').join('') +
              '</select>'
            : '<span class="q-cur-label">' + esc(currency) + '</span>') +
          '<input class="q-input" inputmode="decimal" autocomplete="off" placeholder="' + (currency === 'IDR' ? 'e.g. 12jt or 12.000.000' : 'e.g. 4,500') + '" value="' + esc(val) + '">' +
          '</div><p class="q-preview" aria-live="polite"></p>' +
          '<div class="q-actions">' + (q.optional ? '<button class="btn btn-ghost" data-act="skip">Skip</button>' : '') +
          '<button class="btn btn-primary q-next" data-act="continue">Continue</button></div>';
      } else {
        body =
          '<input class="q-input q-text" maxlength="40" autocomplete="given-name" placeholder="' + esc(q.placeholder || '') + '" value="' + esc(answers[q.id] || '') + '">' +
          '<div class="q-actions"><button class="btn btn-primary q-next" data-act="continue">Continue</button></div>';
      }
      host.innerHTML =
        '<div class="quiz">' +
        '<div class="quiz-top"><button class="icon-btn" data-act="back" aria-label="Back">' + ui.icon('left') + '</button>' +
        '<div class="quiz-progress"><span style="width:' + pct + '%"></span></div>' +
        '<span class="quiz-count">' + (step + 1) + '/' + questions.length + '</span>' +
        (o.onCancel ? '<button class="icon-btn" data-act="cancel" aria-label="Close">' + ui.icon('x') + '</button>' : '') + '</div>' +
        '<div class="quiz-body" key="' + step + '">' +
        '<div class="kitty-bubble"><span class="kitty-face">🌿</span></div>' +
        '<h2 class="q-title">' + esc(q.q) + '</h2>' +
        (q.hint ? '<p class="q-hint">' + esc(q.hint) + '</p>' : '') +
        body +
        '</div></div>';
      const input = host.querySelector('.q-input');
      if (input) {
        setTimeout(() => input.focus(), 60);
        const preview = host.querySelector('.q-preview');
        const update = () => {
          if (!preview) return;
          const v = K.parseAmount(input.value, currency);
          preview.textContent = isFinite(v) && v > 0 ? '= ' + K.fmt(v, currency) + (q.id === 'income' ? ' a month' : '') : '';
        };
        input.addEventListener('input', update);
        update();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitInput(q, input);
          }
        });
      }
      const curSel = host.querySelector('.q-cur');
      if (curSel) {
        curSel.addEventListener('change', () => {
          currency = curSel.value;
          if (input) input.dispatchEvent(new Event('input'));
        });
      }
    }

    function submitInput(q, input) {
      if (q.type === 'money') {
        const v = K.parseAmount(input.value, currency);
        if (!(v > 0)) {
          if (q.optional) {
            answers[q.id] = 0;
            return next();
          }
          input.classList.add('shake');
          setTimeout(() => input.classList.remove('shake'), 500);
          return;
        }
        answers[q.id] = v;
      } else {
        const v = input.value.trim();
        if (!v) {
          input.classList.add('shake');
          setTimeout(() => input.classList.remove('shake'), 500);
          return;
        }
        answers[q.id] = v;
      }
      next();
    }

    function drawIntro() {
      host.innerHTML =
        '<div class="quiz quiz-intro">' +
        (o.onCancel ? '<div class="quiz-top"><span></span><span></span><span></span><button class="icon-btn" data-act="cancel" aria-label="Close">' + ui.icon('x') + '</button></div>' : '') +
        '<div class="quiz-body">' +
        '<div class="intro-orbit"><span>🐿️</span><span>🦉</span><span>🦋</span><span>🦁</span><span>🐬</span><span>🐢</span><b>🌿</b></div>' +
        '<h1>What kind of money animal are you?</h1>' +
        '<p class="q-hint">' + questions.length + ' quick questions, about 2 minutes. Mint learns what you need, how you spend and what you want, then builds a budget that fits you, not an average person.</p>' +
        '<button class="btn btn-primary btn-lg" data-act="start">Let\'s go ' + ui.icon('right', 18) + '</button>' +
        '<p class="fine">' + ui.icon('lock', 14) + ' Your answers stay on this device.</p>' +
        '</div></div>';
    }

    function finishQuick() {
      const result = K.scoreQuiz(answers);
      close();
      if (o.onDone) o.onDone(answers, result, currency);
    }

    function drawResult() {
      const result = K.scoreQuiz(answers);
      host.innerHTML =
        '<div class="quiz quiz-result"><div class="quiz-body">' +
        '<div class="computing"><span class="kitty-face spin">🌿</span><p>Reading your money style…</p></div>' +
        '</div></div>';
      setTimeout(() => {
        host.innerHTML =
          '<div class="quiz quiz-result"><div class="quiz-top"><button class="icon-btn" data-act="back" aria-label="Back">' + ui.icon('left') + '</button><span></span><span></span></div>' +
          '<div class="quiz-body reveal">' +
          personaCard(result, currency) +
          '<div class="q-actions center"><button class="btn btn-ghost" data-act="restart">Retake</button>' +
          '<button class="btn btn-primary btn-lg" data-act="finish">' + esc(o.finishLabel || 'Build my budget') + ' ' + ui.icon('right', 18) + '</button></div>' +
          '</div></div>';
        ui.confetti(host);
      }, 1100);
    }

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'start') return next();
      if (act === 'back') return back();
      if (act === 'cancel') {
        close();
        return o.onCancel && o.onCancel();
      }
      if (act === 'restart') {
        step = -1;
        return draw();
      }
      if (act === 'finish') {
        const result = K.scoreQuiz(answers);
        close();
        return o.onDone && o.onDone(answers, result, currency);
      }
      if (act === 'skip') {
        answers[questions[step].id] = 0;
        return next();
      }
      const q = questions[step];
      if (!q) return;
      if (act === 'continue') {
        if (q.type === 'multi') {
          answers[q.id] = answers[q.id] || [];
          return next();
        }
        const input = host.querySelector('.q-input');
        if (input) return submitInput(q, input);
      }
      if (btn.classList.contains('q-opt')) {
        const opt = q.options.find((x) => String(x.v) === btn.dataset.v);
        answers[q.id] = opt ? opt.v : btn.dataset.v;
        host.querySelectorAll('.q-opt').forEach((b) => b.classList.toggle('is-on', b === btn));
        setTimeout(next, 260);
      } else if (btn.classList.contains('q-chip')) {
        const sel = answers[q.id] || (answers[q.id] = []);
        const v = btn.dataset.v;
        const i = sel.indexOf(v);
        if (i >= 0) sel.splice(i, 1);
        else sel.push(v);
        btn.classList.toggle('is-on', i < 0);
      }
    });
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && o.onCancel) {
        close();
        o.onCancel();
      }
    });

    if (o.startAt === 'result') step = questions.length;
    draw();
    return { close: close };
  }

  K.quizUI = { open: open, personaCard: personaCard };
})(window);
