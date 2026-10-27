/* Fade Network UI: screens and sheets that only exist when the app runs on Fade Network
 * (real accounts on public relays, direct payments, moderation, push). app.js calls
 * window.FadeNetUI(ctx) with its internals and uses the returned hooks when API.net is on.
 */
(function () {
  'use strict';

  window.FadeNetUI = function install(ctx) {
    const {
      API, VIEWS, ACTIONS, $, esc, money, icon, avatar, barberAvatar, pageHead, toast, openSheet, setSheet,
      closeSheet, go, refresh, pull, remoteDo, barberById, placeById, fmtDate, fmtTime, whenLabel, firstName,
      confetti, compact, ago, placeCover,
    } = ctx;
    const S = () => ctx.state();
    const N = () => window.FadeNet;
    const RAILS_EDIT = [
      ['lightning', 'Lightning address', 'you@getalby.com', 'Instant, near-free, verified automatically'],
      ['paypal', 'PayPal.me username', 'yourname', 'paypal.me/yourname — amount filled in'],
      ['venmo', 'Venmo username', 'yourname', 'US'],
      ['cashapp', 'Cash App $cashtag', '$yourname', 'US / UK'],
      ['revolut', 'Revolut username', 'yourname', 'revolut.me/yourname'],
      ['wise', 'Wise username', 'yourname', 'wise.com/pay/me/yourname'],
      ['stripe', 'Stripe Payment Link', 'https://buy.stripe.com/…', 'Cards via your own free Stripe account (Stripe fees apply)'],
      ['bank', 'Bank transfer details', 'BCA 1234567 a/n Your Name', 'Shown to the payer'],
      ['ewallet', 'E-wallet (GoPay / OVO / DANA / GCash…)', 'GoPay 0812…', 'Shown to the payer'],
      ['qris', 'QR code image (QRIS / PromptPay / PIX…)', '', 'Upload your static QR'],
    ];

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------
    function badge(text, kind = 'standard') {
      return `<span class="badge ${kind}">${esc(text)}</span>`;
    }

    async function copy(textValue) {
      try {
        await navigator.clipboard.writeText(textValue);
        toast('Copied');
      } catch (err) {
        window.prompt('Copy this:', textValue);
      }
    }

    async function act(fn, success) {
      return remoteDo(fn, success);
    }

    function userByPk(pk) {
      if (!pk) return null;
      const s = S();
      if (s.user && s.user.pk === pk) return s.user;
      return (s.creators || []).find((c) => c.pk === pk) || null;
    }

    function nameByPk(pk) {
      const user = userByPk(pk);
      if (user) return user.name;
      const barber = S().barbers.find((b) => b.ownerPk === pk);
      if (barber) return barber.name;
      const place = S().places.find((p) => p.ownerPk === pk);
      return place ? place.name : 'Fade user';
    }

    function qrSvg(textValue) {
      if (typeof window.qrcode !== 'function') return '';
      const qr = window.qrcode(0, 'M');
      qr.addData(textValue.toUpperCase().startsWith('LNBC') ? textValue.toUpperCase() : textValue);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }

    // -----------------------------------------------------------------------
    // Pay sheet: direct payment to a person (booking, tip, order, commission, rent)
    // -----------------------------------------------------------------------
    let PAY = null;

    function openPay(opts) {
      PAY = { ...opts, chosen: null, ln: null, ref: '' };
      openSheet(payHTML());
    }

    function payHTML() {
      const options = N().payOptions(PAY.toPk, PAY.amount, PAY.note);
      const toName = PAY.toName || nameByPk(PAY.toPk);
      const ln = PAY.ln;
      return `
        <div class="sheet-head"><div class="grow"><h2>${esc(PAY.title || `Pay ${firstName(toName)}`)}</h2>
          <div class="small muted">to ${esc(toName)}</div></div><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
        <div class="center mt12"><div style="font-size:40px;font-weight:900">${money(PAY.amount)}</div>
          <div class="xs muted">${esc(PAY.note || '')}</div></div>
        <div class="card mt12 xs" style="line-height:1.5">${icon('shield', 14)} The money goes straight to ${esc(firstName(toName))}. <b>Fade takes 0%</b> and never holds your money. Your payment app may charge its own fee.</div>
        ${ln ? lnBlock(ln) : ''}
        <div class="label">Choose how to pay</div>
        ${options.options.length ? options.options.map((o) => `
          <div class="card mt8 ${PAY.chosen === o.rail ? 'on' : ''}">
            <div class="row between"><b class="small">${esc(o.label)}</b><span class="xs muted ellip" style="max-width:55%">${esc(o.handle || '')}</span></div>
            ${o.image ? `<img src="${esc(o.image)}" alt="${esc(o.label)} QR code" style="width:180px;height:180px;object-fit:contain;margin:10px auto;display:block;background:#fff;border-radius:12px">` : ''}
            <div class="row gap8 mt8 wrap">
              ${o.rail === 'lightning' ? `<button class="btn sm primary" data-act="netLn">${icon('zap', 14)} Pay with Lightning</button>` : ''}
              ${o.url ? `<a class="btn sm ${o.rail === 'lightning' ? '' : 'primary'}" href="${esc(o.url)}" target="_blank" rel="noopener" data-act="netChoose" data-rail="${o.rail}">Open ${esc(o.label)} ${icon('chev', 14)}</a>` : ''}
              ${o.rail === 'bank' || o.rail === 'ewallet' ? `<button class="btn sm" data-act="netCopy" data-v="${esc(o.handle)}">Copy details</button>` : ''}
              ${o.rail !== 'lightning' ? `<button class="btn sm" data-act="netChoose" data-rail="${o.rail}">I paid with ${esc(o.label)}</button>` : ''}
            </div>
          </div>`).join('') : `<div class="card mt8 small">${esc(firstName(toName))} hasn’t added online payment methods yet.</div>`}
        ${PAY.chosen ? `
          <div class="card mt12">
            <b class="small">Confirm your ${esc(N().railLabel(PAY.chosen))} payment</b>
            <div class="field"><label for="pay-ref">Reference / last 4 digits (optional)</label><input id="pay-ref" maxlength="80" placeholder="e.g. PP-7F3K" value="${esc(PAY.ref)}"></div>
            <button class="btn primary block" data-act="netPaid">${icon('check', 16)} I’ve sent ${money(PAY.amount)}</button>
            <p class="xs muted mt8">${esc(firstName(toName))} gets notified and confirms when it arrives.</p>
          </div>` : ''}
        ${PAY.allowLater !== false && options.acceptsCash ? `<button class="btn ghost block mt12" data-act="closeSheet">${PAY.laterLabel || 'Pay in person at the shop instead'}</button>` : ''}`;
    }

    function lnBlock(ln) {
      if (ln.error) return `<div class="card mt12 small hot">${esc(ln.error)}</div>`;
      if (!ln.pr) return `<div class="card mt12 small">${icon('zap', 14)} Creating a Lightning invoice…</div>`;
      return `
        <div class="card mt12 center">
          <b class="small">Scan with any Lightning wallet</b>
          <div style="width:220px;margin:10px auto;background:#fff;border-radius:12px;padding:6px">${qrSvg(ln.pr)}</div>
          <div class="xs muted">${ln.sats.toLocaleString()} sats ≈ ${money(PAY.amount)}</div>
          <div class="row gap8 mt8" style="justify-content:center">
            <a class="btn sm primary" href="lightning:${esc(ln.pr)}">Open wallet</a>
            <button class="btn sm" data-act="netCopy" data-v="${esc(ln.pr)}">Copy invoice</button>
          </div>
          <div class="xs mt8 ${ln.settled ? 'ok' : 'muted'}">${ln.settled ? '✓ Paid — recorded automatically' : ln.verify ? 'Waiting for payment… this updates by itself' : 'After paying, tap “I paid” below'}</div>
          ${!ln.verify && !ln.settled ? `<button class="btn sm mt8" data-act="netChoose" data-rail="lightning">I paid</button>` : ''}
        </div>`;
    }

    async function startLightning() {
      const user = userByPk(PAY.toPk);
      const address = user && user.pay && user.pay.lightning;
      if (!address) return;
      PAY.ln = { pr: null };
      setSheet(payHTML());
      try {
        const invoice = await N().lnInvoice(address, PAY.amount, PAY.note || 'Fade');
        PAY.ln = { ...invoice, settled: false };
        setSheet(payHTML());
        if (invoice.verify) pollLightning(PAY, invoice.verify);
      } catch (err) {
        PAY.ln = { error: err.message || 'Could not create an invoice' };
        setSheet(payHTML());
      }
    }

    async function pollLightning(session, verifyUrl) {
      const started = Date.now();
      while (PAY === session && Date.now() - started < 15 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        if (PAY !== session) return;
        const result = await N().lnCheck(verifyUrl).catch(() => ({ settled: false }));
        if (result.settled) {
          session.ln.settled = true;
          setSheet(payHTML());
          await finishPay('lightning', session.ln.sats ? `${session.ln.sats} sats` : '', { verify: verifyUrl, verified: true, preimage: result.preimage });
          return;
        }
      }
    }

    async function finishPay(rail, ref, extra = {}) {
      const session = PAY;
      if (!session || !session.onPaid) return;
      try {
        await session.onPaid(rail, ref, extra);
        await pull();
        closeSheet();
        PAY = null;
        confetti();
        toast(`${money(session.amount)} sent via ${N().railLabel(rail)} — ${firstName(session.toName || nameByPk(session.toPk))} will confirm`);
        refresh();
      } catch (err) {
        toast(err.message);
      }
    }

    Object.assign(ACTIONS, {
      netLn: () => startLightning(),
      netChoose: (el) => {
        if (!PAY) return;
        PAY.chosen = el.dataset.rail;
        setTimeout(() => setSheet(payHTML()), el.tagName === 'A' ? 400 : 0);
        if (el.tagName === 'A') window.open(el.href, '_blank', 'noopener');
      },
      netPaid: () => {
        if (!PAY || !PAY.chosen) return;
        const ref = $('#pay-ref') ? $('#pay-ref').value.trim() : '';
        return finishPay(PAY.chosen, ref);
      },
      netCopy: (el) => copy(el.dataset.v),
    });

    // -----------------------------------------------------------------------
    // Booking flow hooks
    // -----------------------------------------------------------------------
    function payBooking(bk, kind) {
      const b = barberById(bk.barberId);
      const due = kind === 'balance' ? bk.payLater : kind === 'tip' ? bk.tip : bk.quote.dueNow || bk.quote.deposit;
      openPay({
        title: kind === 'tip' ? `Tip ${firstName(b.name)}` : kind === 'balance' ? 'Pay the balance' : 'Pay your deposit',
        amount: due, toPk: b.ownerPk, toName: b.name,
        note: `${bk.serviceName} · ${fmtDate(bk.date)}`,
        onPaid: (rail, ref, extra) => API.req('POST', `/api/bookings/${bk.id}/pay`, { amount: due, rail, ref, kind, ...extra }),
      });
    }

    function checkoutHTML(BK, b, svc, place) {
      const allowShop = !(b.settings && b.settings.allowShopPay === false);
      if (BK.payMode === 'shop' && !allowShop) BK.payMode = 'deposit';
      const service = svc.price;
      const facility = Math.round(service * place.fee) / 100;
      const total = Math.round((service + facility) * 100) / 100;
      const deposit = Math.round((facility + service * 0.2) * 100) / 100;
      const dueNow = BK.payMode === 'full' ? total : BK.payMode === 'shop' ? 0 : deposit;
      const options = N().payOptions(b.ownerPk, dueNow, '').options;
      return `
        <div class="sheet-head"><button class="iconbtn" data-act="bkBack">${icon('back')}</button><h2 class="grow">Request booking</h2></div>
        <div class="card row gap12 mt12">
          ${barberAvatar(b, 48)}
          <div class="grow"><b>${esc(svc.name)}</b><div class="small muted">${esc(b.name)} · ${svc.mins} min</div>
          <div class="small">${fmtDate(BK.date)} · ${fmtTime(BK.time)}</div><div class="xs muted">${esc(place.name)}${place.address ? `, ${esc(place.address)}` : place.area ? `, ${esc(place.area)}` : ''}</div></div>
        </div>
        <div class="label">How do you want to pay?</div>
        <div class="seg">
          <button class="${BK.payMode === 'deposit' ? 'on' : ''}" data-act="bkPay" data-mode="deposit">Deposit ${money(deposit)}</button>
          <button class="${BK.payMode === 'full' ? 'on' : ''}" data-act="bkPay" data-mode="full">Pay in full</button>
          ${allowShop ? `<button class="${BK.payMode === 'shop' ? 'on' : ''}" data-act="bkPay" data-mode="shop">At the shop</button>` : ''}
        </div>
        <div class="label">Breakdown</div>
        <div class="card breakdown">
          <div class="ln"><span>${esc(svc.name)}</span><span>${money(service)}</span></div>
          <div class="ln"><span>Facility fee · ${esc(place.short)} ${place.fee}%</span><span>${money(facility)}</span></div>
          <div class="ln"><span>Fade fee</span><span class="acc">Free — 0%</span></div>
          <div class="ln total"><span>Total</span><span>${money(total)}</span></div>
          <div class="ln"><b>${BK.payMode === 'shop' ? 'Pay now' : 'Send after booking'}</b><b>${money(dueNow)}</b></div>
          <div class="ln muted"><span>Pay at the shop</span><span>${money(Math.round((total - dueNow) * 100) / 100)}</span></div>
        </div>
        ${dueNow > 0 ? `<p class="xs muted mt8">${options.length ? `You’ll pay ${esc(firstName(b.name))} directly with ${options.map((o) => esc(o.label)).slice(0, 4).join(', ')}.` : `${esc(firstName(b.name))} hasn’t set up online payments — choose “At the shop” or pay in person.`}</p>` : ''}
        ${ctx.refNoteHTML(BK.refShortId, b.id, place.id)}
        <p class="xs muted mt12">${esc(firstName(b.name))} confirms requests automatically when the slot is free. Free cancellation up to 24 h before.</p>
        <button class="btn primary block mt12" data-act="bkConfirm">${icon('zap', 18)} Request booking</button>`;
    }

    function successExtra(bk) {
      if (!bk) return '';
      const due = bk.quote && bk.quote.dueNow > 0 && !bk.payments.length;
      return `
        <div class="card mt12 small" style="text-align:left">${icon('clock', 14)} ${bk.confirmed ? '<b class="ok">Confirmed</b>' : 'Request sent — the barber’s app confirms it automatically, usually within minutes.'}</div>
        ${due ? `<button class="btn primary block mt12" data-act="netPayBooking" data-id="${bk.id}" data-kind="${bk.payMode === 'full' ? 'full' : 'deposit'}">${icon('dollar', 16)} Pay ${money(bk.quote.dueNow)} now</button>` : ''}`;
    }

    function statusLabel(bk) {
      if (bk.declined) return 'declined';
      if (bk.status === 'cancelled') return 'cancelled';
      if (bk.noShow) return 'no-show';
      if (bk.status === 'completed') return 'completed';
      return bk.confirmed ? 'confirmed' : 'waiting for barber';
    }

    function paymentsLine(bk) {
      if (!bk.payments || !bk.payments.length) return '';
      return `<div class="xs mt8">${bk.payments.map((p) => `${money(p.amount)} ${esc(p.kind)} via ${esc(N().railLabel(p.rail))} ${p.received ? '<span class="ok">✓ confirmed</span>' : '<span class="muted">· awaiting barber</span>'}`).join('<br>')}</div>`;
    }

    function bookingCardExtra(bk) {
      const mineAsClient = bk.customerPk === S().user.pk;
      let html = paymentsLine(bk);
      if (bk.declined) html += `<div class="xs hot mt8">${esc(bk.declineReason || 'The barber declined this time')}</div>`;
      if (bk.refundDue && !(bk.refunds || []).length) html += `<div class="xs mt8">Refund of ${money(bk.refundDue)} requested from the barber.</div>`;
      if ((bk.refunds || []).length) html += `<div class="xs ok mt8">Refunded ${money(bk.refunds.reduce((s, r) => s + r.amount, 0))}</div>`;
      const buttons = [];
      if (mineAsClient && bk.status === 'upcoming' && !bk.declined) {
        const paid = bk.paidNow || 0;
        if (bk.quote && bk.quote.dueNow > paid + 0.004) buttons.push(`<button class="btn xs primary" data-act="netPayBooking" data-id="${bk.id}" data-kind="${bk.payMode === 'full' ? 'full' : 'deposit'}">Pay ${money(bk.quote.dueNow - paid)}</button>`);
      }
      if (mineAsClient && bk.status === 'completed' && !bk.noShow && bk.payLater > 0.004) {
        buttons.push(`<button class="btn xs" data-act="netPayBooking" data-id="${bk.id}" data-kind="balance">Pay balance ${money(bk.payLater)} online</button>`);
      }
      return html + (buttons.length ? `<div class="row gap6 mt8 wrap">${buttons.join('')}</div>` : '');
    }

    function rateTipNote(b) {
      return `<p class="xs muted mt8">Tips go straight to ${esc(firstName(b.name))} — after you submit you can send it with their payment link, Lightning, or in cash.</p>`;
    }

    function afterRate(bk, tip) {
      if (tip > 0) {
        const fresh = S().bookings.find((x) => x.id === bk.id) || bk;
        payBooking({ ...fresh, tip }, 'tip');
      }
    }

    function cancelMessage(bk) {
      const hoursAway = (bk.startMs - Date.now()) / 3600000;
      const paid = bk.paidNow || 0;
      if (!paid) return 'Cancel this booking?';
      return hoursAway >= 24
        ? `Cancel? ${barberById(bk.barberId).name} will be asked to refund your ${money(paid)}.`
        : `Less than 24 h away — the ${money(paid)} you sent stays with the barber. Cancel anyway?`;
    }

    // -----------------------------------------------------------------------
    // Barber studio panel
    // -----------------------------------------------------------------------
    function studioPanel(b) {
      const s = S();
      const mine = s.bookings.filter((bk) => bk.barberId === b.id);
      const requests = mine.filter((bk) => bk.status === 'upcoming' && !bk.confirmed && !bk.declined);
      const toConfirm = mine.filter((bk) => (bk.payments || []).some((p) => !p.received));
      const refunds = mine.filter((bk) => bk.refundDue && !(bk.refunds || []).length);
      const owed = (s.commissionsOwed || []).filter((c) => c.payerType === 'barber' && c.status === 'earned');
      const auto = !(b.settings && b.settings.autoAccept === false);
      const pending = b.schedulePending || [];
      const hasPay = Object.keys(s.user.pay || {}).some((k) => !['cash', 'currency'].includes(k));
      return `
        ${hasPay ? '' : `<button class="card tap mt12 row gap10" data-act="go" data-to="/payouts"><span class="acc">${icon('dollar')}</span><span class="grow small"><b>Set up how clients pay you</b><div class="xs muted">PayPal, Lightning, bank, QRIS… money goes straight to you, Fade takes 0%.</div></span>${icon('chev', 16)}</button>`}
        <label class="toggle-row mt12"><span class="small"><b>Auto-accept bookings</b><div class="xs muted">Confirm free slots instantly (recommended)</div></span>
          <span class="switch"><input type="checkbox" data-act="netAutoAccept" ${auto ? 'checked' : ''}><span></span></span></label>
        ${requests.length ? `<h2 class="sec">Booking requests <span class="badge hot">${requests.length}</span></h2>${requests.map((bk) => `
          <div class="listitem"><span class="grow"><b class="small">${esc(bk.customerName)}</b><div class="xs muted">${esc(bk.serviceName)} · ${whenLabel(bk)} · ${esc(placeById(bk.placeId).short)}</div></span>
            <span class="row gap6"><button class="btn xs primary" data-act="netAccept" data-id="${bk.id}">Accept</button><button class="btn xs" data-act="netDecline" data-id="${bk.id}">Decline</button></span></div>`).join('')}` : ''}
        ${toConfirm.length ? `<h2 class="sec">Payments to confirm</h2>${toConfirm.map((bk) => `
          <div class="listitem"><span class="grow"><b class="small">${esc(bk.customerName)}</b>${paymentsLine(bk)}</span>
            <button class="btn xs primary" data-act="netReceived" data-id="${bk.id}">Received</button></div>`).join('')}` : ''}
        ${refunds.length ? `<h2 class="sec">Refunds owed</h2>${refunds.map((bk) => `
          <div class="listitem"><span class="grow"><b class="small">${esc(bk.customerName)}</b><div class="xs muted">Cancelled ${esc(bk.serviceName)} · refund ${money(bk.refundDue)}</div></span>
            <button class="btn xs" data-act="netRefunded" data-id="${bk.id}" data-amt="${bk.refundDue}">Mark refunded</button></div>`).join('')}` : ''}
        ${owed.length ? `<h2 class="sec">Creator commissions to pay</h2>${owed.map((c) => commissionPayRow(c)).join('')}` : ''}
        ${mine.filter((bk) => bk.status === 'upcoming' && bk.confirmed && bk.startMs < Date.now()).map((bk) => `
          <div class="listitem"><span class="grow"><b class="small">${esc(bk.customerName)}</b><div class="xs muted">${esc(bk.serviceName)} · ${whenLabel(bk)}</div></span>
            <span class="row gap6"><button class="btn xs primary" data-act="proComplete" data-id="${bk.id}">Done</button><button class="btn xs" data-act="netNoShow" data-id="${bk.id}">No-show</button></span></div>`).join('')}
        ${pending.length ? `<div class="card mt12 small">${icon('clock', 14)} ${pending.length} shift${pending.length > 1 ? 's' : ''} waiting for the shop owner’s approval: ${[...new Set(pending.map((x) => placeById(x.placeId).name))].map(esc).join(', ')}</div>` : ''}
        ${s.mePlaceId ? '' : `<button class="btn block mt12" data-act="netCreateStudio">${icon('store', 16)} Work from your own studio / home / mobile</button>`}`;
    }

    function commissionPayRow(c) {
      const creator = (S().creators || []).find((u) => u.pk === c.creatorPk);
      return `
        <div class="listitem"><span class="grow"><b class="small">@${esc(creator ? creator.handle : 'creator')}</b>
          <div class="xs muted">${Math.round(c.rate * 100)}% ${esc(c.kind)} of ${money(c.base)} · ${c.sourceType}</div></span>
          <button class="btn xs primary" data-act="netPayCm" data-id="${c.id}">Pay ${money(c.amount)}</button></div>`;
    }

    // -----------------------------------------------------------------------
    // Shop owner panel
    // -----------------------------------------------------------------------
    function ownerPanel(p) {
      const s = S();
      const requests = s.barbers.filter((b) => (b.schedulePending || []).some((x) => x.placeId === p.id));
      const approved = s.barbers.filter((b) => (p.barbers || []).includes(b.id));
      const rents = (s.rent || []).filter((r) => r.placeId === p.id).sort((a, b) => b.createdAt - a.createdAt);
      const owed = (s.commissionsOwed || []).filter((c) => c.payerType === 'place' && c.status === 'earned');
      const orders = (s.orders || []).filter((o) => o.sellerPk === s.user.pk && !['completed', 'cancelled'].includes(o.status));
      const hasPay = Object.keys(s.user.pay || {}).some((k) => !['cash', 'currency'].includes(k));
      const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [p.tz];
      return `
        ${hasPay ? '' : `<button class="card tap mt12 row gap10" data-act="go" data-to="/payouts"><span class="acc">${icon('dollar')}</span><span class="grow small"><b>Set up how barbers pay rent</b><div class="xs muted">Direct to you — Fade takes 0%.</div></span>${icon('chev', 16)}</button>`}
        <h2 class="sec">Chair requests ${requests.length ? `<span class="badge hot">${requests.length}</span>` : ''}</h2>
        ${requests.map((b) => `
          <div class="listitem">${barberAvatar(b, 40)}<span class="grow"><b class="small">${esc(b.name)}</b><div class="xs muted">${(b.schedulePending || []).filter((x) => x.placeId === p.id).length} shifts requested · ${esc(b.title)}</div></span>
            <button class="btn xs primary" data-act="netApproveBarber" data-id="${b.id}">Approve</button></div>`).join('') || '<div class="empty">No pending chair requests</div>'}
        ${approved.length ? `<div class="xs muted mt8">Working here: ${approved.map((b) => `${esc(b.name)} <a class="hot" data-act="netRemoveBarber" data-id="${b.id}">remove</a>`).join(' · ')}</div>` : ''}
        <h2 class="sec">Rent statements</h2>
        ${rents.map((r) => {
          const b = s.barbers.find((x) => x.id === r.barberId);
          return `<div class="listitem"><span class="grow"><b class="small">${esc(b ? b.name : 'Barber')} · ${esc(r.week)}</b>
            <div class="xs muted">${r.lines.map((l) => `${esc(l.label)} ${money(l.amount)}`).join(' · ')}</div>
            <div class="xs">${money(r.amount)} via ${esc(N().railLabel((r.payment || {}).rail || 'cash'))}${(r.payment || {}).ref ? ` · ref ${esc(r.payment.ref)}` : ''}</div></span>
            ${r.confirmed ? badge('Received', 'acc') : `<button class="btn xs primary" data-act="netConfirmRent" data-id="${r.id}">Received</button>`}</div>`;
        }).join('') || '<div class="empty">No rent statements yet</div>'}
        ${owed.length ? `<h2 class="sec">Creator commissions to pay</h2>${owed.map((c) => commissionPayRow(c)).join('')}` : ''}
        ${orders.length ? `<h2 class="sec">Open orders</h2>${orders.map(orderRow).join('')}` : ''}
        <h2 class="sec">Shop details</h2>
        <div class="card">
          <div class="field"><label for="op-name">Name</label><input id="op-name" maxlength="60" value="${esc(p.name)}"></div>
          <div class="field"><label for="op-address">Street address</label><input id="op-address" maxlength="160" value="${esc(p.address || '')}" placeholder="Jl. Senopati No. 12"></div>
          <div class="frow">
            <div class="field"><label for="op-area">Area</label><input id="op-area" maxlength="40" value="${esc(p.area || '')}"></div>
            <div class="field"><label for="op-city">City</label><input id="op-city" maxlength="40" value="${esc(p.city || '')}"></div>
          </div>
          <div class="frow">
            <div class="field"><label for="op-hours">Hours</label><input id="op-hours" maxlength="40" value="${esc(p.hours || '')}"></div>
            <div class="field"><label for="op-tz">Time zone</label><select id="op-tz">${zones.map((z) => `<option ${z === p.tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="op-amen">Amenities (comma separated)</label><input id="op-amen" maxlength="200" value="${esc((p.amenities || []).join(', '))}"></div>
          <div class="xs muted">Map pin: ${p.lat ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : 'not set'}</div>
          <div class="row gap8 mt8"><button class="btn sm" data-act="netLocateShop">${icon('pin', 14)} Use my current location</button><button class="btn sm" data-act="netGeocode">Find address on map</button></div>
          <button class="btn primary block mt12" data-act="netSavePlace">Save shop details</button>
        </div>`;
    }

    function orderRow(o) {
      const buyer = o.buyerName || 'Customer';
      return `<div class="listitem"><span class="grow"><b class="small">${esc(buyer)} · ${money(o.total)}</b>
        <div class="xs muted">${o.items.map((i) => `${i.qty}× ${esc(i.name || i.id)}`).join(', ')} · ${esc(o.delivery)}${o.address ? ` · ${esc(o.address)}` : ''}</div>
        <div class="xs">${o.payments.length ? o.payments.map((p) => `${money(p.amount)} via ${esc(N().railLabel(p.rail))}`).join(', ') : 'Not paid yet'} · ${esc(o.status)}</div></span>
        <span class="col" style="gap:4px">${o.status === 'placed' ? `<button class="btn xs primary" data-act="netOrderStatus" data-id="${o.id}" data-v="accepted">Accept</button>` : ''}
        ${['accepted', 'placed'].includes(o.status) ? `<button class="btn xs" data-act="netOrderStatus" data-id="${o.id}" data-v="${o.delivery === 'delivery' ? 'shipped' : 'ready'}">${o.delivery === 'delivery' ? 'Shipped' : 'Ready'}</button>` : ''}
        ${['ready', 'shipped'].includes(o.status) ? `<button class="btn xs" data-act="netOrderStatus" data-id="${o.id}" data-v="completed">Completed</button>` : ''}</span></div>`;
    }

    // -----------------------------------------------------------------------
    // Creator earnings
    // -----------------------------------------------------------------------
    function creatorPanel() {
      const s = S();
      const list = [...(s.commissions || [])].sort((a, b) => b.createdAt - a.createdAt);
      const hasPay = Object.keys(s.user.pay || {}).some((k) => !['cash', 'currency'].includes(k));
      return `
        ${hasPay ? '' : `<button class="card tap mt12 row gap10" data-act="go" data-to="/payouts"><span class="acc">${icon('dollar')}</span><span class="grow small"><b>Add how you get paid</b><div class="xs muted">Barbers and shops pay your commission straight to you.</div></span>${icon('chev', 16)}</button>`}
        <h2 class="sec">Commissions</h2>
        ${list.map((c) => `
          <div class="listitem"><span class="grow"><b class="small">${c.sourceType === 'booking' ? 'Booking' : 'Product sale'} · ${esc(c.payerType === 'barber' ? (barberById(c.payerId) || {}).name || 'Barber' : (placeById(c.payerId) || {}).name || 'Shop')}</b>
            <div class="xs muted">${Math.round(c.rate * 100)}% ${esc(c.kind)} of ${money(c.base)}${c.paid ? ` · paid via ${esc(N().railLabel(c.paid.rail))}` : ''}</div></span>
            <span class="col" style="align-items:flex-end;gap:4px"><b class="small">${money(c.amount)}</b>
              ${badge(c.status, { pending: 'standard', earned: 'acc', paid: 'premium', void: 'hot' }[c.status] || 'standard')}
              ${c.status === 'paid' && !c.received ? `<button class="btn xs primary" data-act="netCmReceived" data-id="${c.id}">Got it</button>` : ''}</span></div>`).join('') || '<div class="empty">No commissions yet — tag your barber in a short</div>'}`;
    }

    // -----------------------------------------------------------------------
    // Comments + reports on shorts and profiles
    // -----------------------------------------------------------------------
    let COMMENTS = null;
    const LOCAL_BLOCKED_WORDS = ['nigger', 'faggot', 'kill yourself', 'kys', 'child porn', 'cp link'];
    const myId = () => S().user.pk || S().user.id;

    // Comments/reports work in all three modes: Fade Network (relays), a Fade server, or the offline demo.
    function commentsFor(shortId) {
      if (API.net) return N().commentsFor(shortId);
      if (API.on) return (S().comments || []).filter((c) => c.shortId === shortId);
      return (S().localComments || []).filter((c) => c.shortId === shortId);
    }

    function commentsHTML() {
      const list = commentsFor(COMMENTS.shortId);
      return `
        <div class="sheet-head"><h2 class="grow">Comments · ${list.length}</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
        <div class="mt12">${list.map((c) => `
          <div class="row gap10" style="padding:8px 0;align-items:flex-start">${avatar(c.name, c.hue, 32)}
            <div class="grow"><b class="xs">${esc(c.name)}</b> <span class="xs muted">${ago(c.at * 1000)}</span><div class="small" style="line-height:1.4">${esc(c.text)}</div></div>
            ${c.mine ? `<button class="iconbtn" style="width:28px;height:28px" data-act="netDelComment" data-id="${c.id}" aria-label="Delete">${icon('trash', 13)}</button>`
              : `<button class="iconbtn" style="width:28px;height:28px" data-act="netReport" data-target="${c.id}" data-pk="${c.by}" aria-label="Report comment">${icon('flag', 13)}</button>`}
          </div>`).join('') || '<div class="empty">Be the first to comment</div>'}</div>
        <div class="row gap8 mt12"><input class="input grow" id="cm-text" maxlength="500" placeholder="Add a comment…"><button class="btn primary" data-act="netPostComment">Post</button></div>`;
    }

    let REPORT = null;
    const REASONS = [['spam', 'Spam or scam'], ['nudity', 'Nudity or sexual content'], ['violence', 'Violence or dangerous acts'], ['harassment', 'Harassment or bullying'], ['hate', 'Hate speech'], ['impersonation', 'Impersonation / fake profile'], ['not-haircut', 'Not about haircuts'], ['other', 'Something else']];

    function reportHTML() {
      return `
        <div class="sheet-head"><h2 class="grow">Report</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
        <p class="small muted">Reports are anonymous to the person you report. Content reported by several people is hidden until a moderator reviews it.</p>
        ${REASONS.map(([value, label]) => `<button class="svc ${REPORT.reason === value ? 'on' : ''}" data-act="netReason" data-v="${value}"><b class="small">${label}</b></button>`).join('')}
        <div class="field"><label for="rp-note">Details (optional)</label><textarea id="rp-note" maxlength="300"></textarea></div>
        <button class="btn primary block" data-act="netReportSubmit" ${REPORT.reason ? '' : 'disabled'}>Send report</button>
        ${REPORT.pk ? `<button class="btn ghost block mt8" data-act="netBlock" data-pk="${REPORT.pk}">Also block this person</button>` : ''}`;
    }

    // -----------------------------------------------------------------------
    // Automatic checks that don't depend on the uploader's device
    // -----------------------------------------------------------------------
    const VIEWSCAN_KEY = 'fade.viewscan';
    const viewScanQueue = [];
    let viewScanBusy = false;

    function viewScans() {
      try {
        return JSON.parse(localStorage.getItem(VIEWSCAN_KEY) || '{}');
      } catch (err) {
        return {};
      }
    }

    function scanEntry(value) {  // older builds stored only the verdict string
      return typeof value === 'string' ? { v: value } : value || {};
    }

    function autoHidden() {
      const scans = viewScans();
      return new Set(Object.keys(scans).filter((id) => ['review', 'block', 'reupload'].includes(scanEntry(scans[id]).v)));
    }

    function saveViewScan(id, entry) {
      const scans = viewScans();
      scans[id] = entry;
      const ids = Object.keys(scans);
      ids.slice(0, Math.max(0, ids.length - 2000)).forEach((old) => delete scans[old]);  // bounded cache
      localStorage.setItem(VIEWSCAN_KEY, JSON.stringify(scans));
    }

    // Network mode has no server to trust, so every viewer's device checks what it is shown, independently of
    // the scan the uploader's app attached (a modified app can attach anything):
    //   * the photo, or the poster AND 3 frames of the video itself (a clean poster can't cover a bad video)
    //   * the result is compared with the uploader's claim — a big gap is reported as a possibly modified app
    //   * the frame's perceptual hash is compared with media moderators removed (signed moderation list)
    // Anything flagged is hidden on this device at once and reported; 3 devices' reports hide it for everyone.
    function queueViewerCheck(sh) {
      if (!API.net || !window.FadeScan || new URLSearchParams(location.search).get('scan') === '0') return;
      const media = sh.media || {};
      if (!media.url && !media.poster) return;
      if (sh.byMe || (sh.ownerPk && sh.ownerPk === myId())) return;
      if (viewScans()[sh.id] || viewScanQueue.some((q) => q.id === sh.id)) return;
      viewScanQueue.push(sh);
      runViewerChecks();
    }

    async function checkShortOnThisDevice(sh) {
      const media = sh.media || {};
      const results = [];
      if (media.poster) results.push(await window.FadeScan.scanUrl(media.poster, 'image'));
      if (media.url && (media.kind === 'video' || !media.poster)) {
        try {
          results.push(await window.FadeScan.scanUrl(media.url, media.kind === 'video' ? 'video' : 'image'));
        } catch (err) {
          if (!results.length) throw err;  // poster checked; the video itself couldn't be decoded here
        }
      }
      const worst = results.reduce((acc, r) => ({ nsfw: Math.max(acc.nsfw, r.nsfw), sexy: Math.max(acc.sexy, r.sexy) }), { nsfw: 0, sexy: 0 });
      const hashes = results.map((r) => r.phash).filter(Boolean);
      return { ...worst, verdict: window.FadeScan.verdict(worst), phash: hashes[hashes.length - 1] || '', hashes };
    }

    async function runViewerChecks() {
      if (viewScanBusy) return;
      viewScanBusy = true;
      while (viewScanQueue.length) {
        const sh = viewScanQueue.shift();
        const media = sh.media || {};
        let entry = { v: 'error' };
        try {
          const scan = await checkShortOnThisDevice(sh);
          entry = { v: scan.verdict, h: scan.phash, n: Math.round(scan.nsfw * 1000) / 1000 };
          const claimed = media.scan && typeof media.scan.nsfw === 'number' ? media.scan : null;
          const claimedOk = claimed && N().scanVerdict(claimed) === 'ok';
          const mismatch = claimedOk && (scan.verdict === 'review' || scan.verdict === 'block') && scan.nsfw - claimed.nsfw >= 0.3;
          const removed = scan.hashes.map((hash) => N().blockedMatch(hash, sh.id)).find(Boolean);
          if (scan.verdict === 'review' || scan.verdict === 'block') {
            let note = `automatic check on a viewer's device: ${Math.round(scan.nsfw * 100)}% explicit`;
            if (mismatch) note += ` — the uploader's app reported ${Math.round(claimed.nsfw * 100)}% (modified app?)`;
            await API.req('POST', '/api/report', { target: sh.id, pk: sh.ownerPk, reason: 'nudity', auto: true, note }).catch(() => {});
          } else if (removed) {
            entry.v = 'reupload';
            await API.req('POST', '/api/report', {
              target: sh.id, pk: sh.ownerPk, reason: 'spam', auto: true,
              note: `re-upload of media moderators removed (${removed}) — matched on a viewer's device`,
            }).catch(() => {});
          }
        } catch (err) {
          entry = { v: 'error' };
        }
        saveViewScan(sh.id, entry);
        if (['review', 'block', 'reupload'].includes(entry.v)) {
          S().shorts = S().shorts.filter((x) => x.id !== sh.id);
          refresh();
        }
      }
      viewScanBusy = false;
    }

    // Moderator console: check uploads that arrived without an on-device scan, on the moderator's device.
    let modScanRunning = false;
    const modScanTried = new Set();

    async function moderatorScans(items) {
      if (modScanRunning || !window.FadeScan || !items.length) return;
      modScanRunning = true;
      let flagged = 0;
      for (const item of items.slice(0, 10)) {
        modScanTried.add(item.id);
        const media = item.media || {};
        try {
          const url = media.poster || media.url;
          const scan = await window.FadeScan.scanUrl(API.net ? url : ctx.mediaUrl ? ctx.mediaUrl(url) : url, media.poster ? 'image' : media.kind);
          if (API.net) {
            saveViewScan(item.id, { v: scan.verdict, h: scan.phash, n: Math.round(scan.nsfw * 1000) / 1000 });
            if (scan.verdict === 'review' || scan.verdict === 'block') {
              await API.req('POST', '/api/mod', { action: 'hide', target: item.id, phash: [scan.phash] });
              flagged++;
            }
          } else {
            const result = await API.req('POST', '/api/mod', { action: 'scan', target: item.id, scan });
            if (result.verdict === 'review' || result.verdict === 'block') flagged++;
          }
        } catch (err) {
          // unreachable media: leave it in the list for a manual look
        }
      }
      modScanRunning = false;
      MODQ.loaded = false;
      if (flagged) toast(`Automatic check hid ${flagged} upload${flagged > 1 ? 's' : ''}`);
      refresh();
    }

    function reelButtons(sh) {
      queueViewerCheck(sh);
      const own = sh.byMe || (sh.ownerPk && sh.ownerPk === myId());
      const count = API.on ? sh.comments || 0 : commentsFor(sh.id).length;
      return `
        <button data-act="netComments" data-sid="${sh.id}" aria-label="Comments"><span class="rb">${icon('chat', 22)}</span><span class="cnt">${compact(count)}</span></button>
        ${own ? '' : `<button data-act="netReport" data-target="${sh.id}" data-pk="${sh.ownerPk || ''}" aria-label="Report short"><span class="rb">${icon('flag', 20)}</span>Report</button>`}`;
    }

    function profileMenu(target, pk) {
      if (!pk || pk === myId()) return '';
      return `<button class="btn xs" data-act="netReport" data-target="${esc(target)}" data-pk="${esc(pk)}">${icon('flag', 13)} Report</button>`;
    }

    function blocked() {
      try {
        return JSON.parse(localStorage.getItem('fade.blocked') || '[]');
      } catch (err) {
        return [];
      }
    }

    Object.assign(ACTIONS, {
      netComments: (el) => {
        COMMENTS = { shortId: el.dataset.sid };
        openSheet(commentsHTML());
      },
      netPostComment: async () => {
        const input = $('#cm-text');
        const value = input ? input.value.trim() : '';
        if (!value) return;
        try {
          if (API.on) {
            await API.req('POST', '/api/comments', { shortId: COMMENTS.shortId, text: value });
            if (!API.net) await pull();
          } else {
            const clean = N() && N().cleanText ? N().cleanText(value) : !LOCAL_BLOCKED_WORDS.some((word) => value.toLowerCase().includes(word));
            if (!clean) throw new Error('That comment breaks the community guidelines');
            const s = S();
            s.localComments = [...(s.localComments || []), {
              id: `lc${Date.now().toString(36)}`, shortId: COMMENTS.shortId, by: 'me', name: s.user.name, hue: s.user.hue,
              text: value, at: Date.now() / 1000, mine: true,
            }];
            ctx.save();
          }
          setSheet(commentsHTML());
        } catch (err) {
          toast(err.message);
        }
      },
      netDelComment: async (el) => {
        if (API.on) {
          await API.req('DELETE', `/api/comments/${el.dataset.id}`);
          if (!API.net) await pull();
        } else {
          S().localComments = (S().localComments || []).filter((c) => c.id !== el.dataset.id);
          ctx.save();
        }
        setSheet(commentsHTML());
      },
      netFlushReports: async () => {
        const sent = await flushOfflineReports();
        toast(sent ? `Sent ${sent} report${sent > 1 ? 's' : ''} to Fade’s moderators` : 'Still offline — they’ll go out when you’re connected');
        refresh();
      },
      netReport: (el) => {
        REPORT = { target: el.dataset.target, pk: el.dataset.pk || null, reason: null };
        openSheet(reportHTML());
      },
      netReason: (el) => {
        REPORT.reason = el.dataset.v;
        setSheet(reportHTML());
      },
      netReportSubmit: async () => {
        const note = ($('#rp-note') || {}).value || '';
        try {
          if (API.on) {
            const result = await API.req('POST', '/api/report', { target: REPORT.target, pk: REPORT.pk, reason: REPORT.reason, note });
            if (!API.net) await pull();
            closeSheet();
            toast(result && result.hidden ? 'Thanks — it’s hidden while a moderator reviews it' : 'Thanks — a moderator will review it');
          } else {
            // Offline demo: hide it here right away and deliver the report to Fade's moderators on the
            // relays (queued until this device is online). Their decision comes back to every offline device.
            const s = S();
            const short = s.shorts.find((sh) => sh.id === REPORT.target);
            const comment = (s.localComments || []).find((c) => c.id === REPORT.target);
            const preview = short ? short.caption : comment ? comment.text : REPORT.target;
            s.localReports = [...(s.localReports || []), {
              id: `lr${Date.now().toString(36)}`, target: REPORT.target, reason: REPORT.reason, note, preview: String(preview || '').slice(0, 140),
              at: Date.now(), status: 'queued',
            }];
            s.shorts = s.shorts.filter((sh) => sh.id !== REPORT.target);
            s.localComments = (s.localComments || []).filter((c) => c.id !== REPORT.target);
            ctx.save();
            closeSheet();
            const sent = await flushOfflineReports();
            toast(sent ? 'Thanks — hidden here and sent to Fade’s moderators' : 'Thanks — hidden here; it goes to Fade’s moderators when you’re online');
          }
          refresh();
        } catch (err) {
          toast(err.message);
        }
      },
      netBlock: (el) => {
        const list = new Set(blocked());
        list.add(el.dataset.pk);
        localStorage.setItem('fade.blocked', JSON.stringify([...list]));
        closeSheet();
        toast('Blocked — you won’t see their shorts or messages');
        refresh();
      },
    });

    // -----------------------------------------------------------------------
    // Booking / studio / owner / creator actions
    // -----------------------------------------------------------------------
    Object.assign(ACTIONS, {
      netPayBooking: (el) => {
        const bk = S().bookings.find((x) => x.id === el.dataset.id);
        if (bk) payBooking(bk, el.dataset.kind || 'deposit');
      },
      netAccept: (el) => act(() => API.req('POST', `/api/bookings/${el.dataset.id}/accept`), 'Accepted ✓'),
      netDecline: (el) => {
        const reason = window.prompt('Reason for the client (optional)', 'Sorry, I can’t make that time');
        if (reason === null) return null;
        return act(() => API.req('POST', `/api/bookings/${el.dataset.id}/decline`, { reason }), 'Declined');
      },
      netNoShow: (el) => {
        if (!window.confirm('Mark this client as a no-show?')) return null;
        return act(() => API.req('POST', `/api/bookings/${el.dataset.id}/noshow`), 'Marked as no-show');
      },
      netReceived: (el) => act(() => API.req('POST', `/api/bookings/${el.dataset.id}/received`, { all: true }), 'Payment confirmed ✓'),
      netRefunded: (el) => act(() => API.req('POST', `/api/bookings/${el.dataset.id}/refunded`, { amount: Number(el.dataset.amt), rail: 'bank' }), 'Refund recorded'),
      netAutoAccept: (el) => act(() => API.req('PUT', '/api/studio/barber', { settings: { autoAccept: el.checked, allowShopPay: true } }), el.checked ? 'Auto-accept on' : 'Auto-accept off — confirm requests yourself'),
      netPayCm: (el) => {
        const c = (S().commissionsOwed || []).find((x) => x.id === el.dataset.id);
        if (!c) return;
        openPay({
          title: 'Pay creator commission', amount: c.amount, toPk: c.creatorPk, note: `${Math.round(c.rate * 100)}% ${c.kind} commission`,
          allowLater: false,
          onPaid: (rail, ref) => API.req('POST', `/api/commissions/${c.id}/paid`, { rail, ref }),
        });
      },
      netCmReceived: (el) => act(() => API.req('POST', `/api/commissions/${el.dataset.id}/received`), 'Thanks — confirmed'),
      netApproveBarber: (el) => act(() => API.req('PUT', '/api/owner/place', { approve: el.dataset.id }), 'Approved — clients can book them here'),
      netRemoveBarber: (el) => {
        if (!window.confirm('Remove this barber from your shop?')) return null;
        return act(() => API.req('PUT', '/api/owner/place', { remove: el.dataset.id }), 'Removed');
      },
      netConfirmRent: (el) => act(() => API.req('POST', `/api/rent/${el.dataset.id}/confirm`), 'Rent confirmed ✓'),
      netOrderStatus: (el) => act(() => API.req('POST', `/api/orders/${el.dataset.id}/status`, { status: el.dataset.v, received: el.dataset.v === 'completed' }), 'Order updated'),
      netSavePlace: () => act(() => API.req('PUT', '/api/owner/place', {
        name: $('#op-name').value, address: $('#op-address').value, area: $('#op-area').value, city: $('#op-city').value,
        hours: $('#op-hours').value, tz: $('#op-tz').value, amenities: $('#op-amen').value,
      }), 'Shop saved'),
      netLocateShop: () => {
        if (!navigator.geolocation) return toast('Location not available');
        navigator.geolocation.getCurrentPosition(
          (pos) => act(() => API.req('PUT', '/api/owner/place', { lat: pos.coords.latitude, lng: pos.coords.longitude }), 'Map pin set to your location'),
          () => toast('Location permission denied'),
          { timeout: 10000 },
        );
        return null;
      },
      netGeocode: async () => {
        const query = [$('#op-address').value, $('#op-area').value, $('#op-city').value].filter(Boolean).join(', ');
        if (!query) return toast('Enter the address first');
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } });
        const hits = await res.json();
        if (!hits.length) return toast('Address not found — try “Use my current location”');
        return act(() => API.req('PUT', '/api/owner/place', { lat: Number(hits[0].lat), lng: Number(hits[0].lon), address: $('#op-address').value }), 'Map pin set');
      },
      netCreateStudio: async () => {
        const name = window.prompt('Name your chair / studio', `${S().user.name}’s Studio`);
        if (!name) return;
        const city = window.prompt('City', (S().barbers.find((b) => b.id === S().meBarberId) || {}).city || '') || '';
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const loc = S().user.location || {};
        await act(() => API.req('POST', '/api/me/place', { name, city, tz, lat: loc.lat, lng: loc.lng, personal: true }), 'Studio created — add shifts there below');
      },
    });

    // Rent in network mode: record the weekly statement after paying the owner directly.
    const localPayRent = ACTIONS.payRent;
    ACTIONS.payRent = (el) => {
      if (!API.net) return localPayRent(el);
      const place = placeById(el.dataset.id);
      openPay({
        title: `Rent · ${place.name}`, amount: Number(el.dataset.amt), toPk: place.ownerPk, toName: place.name,
        note: 'Chair rent + kit (facility fees are added to the statement)', allowLater: true, laterLabel: 'I paid in cash',
        onPaid: (rail, ref) => API.req('POST', '/api/studio/rent', { placeId: place.id, rail, ref }),
      });
      return null;
    };

    // -----------------------------------------------------------------------
    // Views: payouts, notifications, account, moderation, legal, payments, membership
    // -----------------------------------------------------------------------
    VIEWS.payouts = function () {
      const pay = S().user.pay || {};
      return `
        ${pageHead('Get paid')}
        <p class="small muted" style="line-height:1.5">Clients, barbers and shops pay you <b>directly</b> with what you add here. Fade never holds money and takes <b class="acc">0%</b>. Add at least one.</p>
        ${RAILS_EDIT.map(([key, label, placeholder, hint]) => key === 'qris' ? `
          <div class="field"><label>${label}</label>
            ${pay.qris ? `<img src="${esc(pay.qris)}" alt="Your QR code" style="width:140px;height:140px;object-fit:contain;background:#fff;border-radius:12px;display:block;margin-bottom:8px">` : ''}
            <label class="btn sm">${icon('upload', 14)} ${pay.qris ? 'Replace' : 'Upload'} QR image<input type="file" id="po-qris" accept="image/*" hidden></label>
            <div class="xs muted mt4">${hint}</div></div>` : `
          <div class="field"><label for="po-${key}">${label}</label><input id="po-${key}" maxlength="200" placeholder="${esc(placeholder)}" value="${esc(pay[key] || '')}"><div class="xs muted mt4">${hint}</div></div>`).join('')}
        <label class="toggle-row"><span class="small"><b>Accept cash in person</b></span><span class="switch"><input type="checkbox" id="po-cash" ${pay.cash !== false ? 'checked' : ''}><span></span></span></label>
        <div class="field"><label for="po-currency">Currency shown to payers</label><select id="po-currency">${['USD', 'IDR', 'EUR', 'GBP', 'SGD', 'MYR', 'PHP', 'THB', 'AUD', 'NGN', 'BRL', 'INR'].map((c) => `<option ${c === (pay.currency || 'USD') ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <button class="btn primary block mt12" data-act="netSavePayouts">Save</button>
        <p class="xs muted mt12">Prices in Fade are shown in USD. Payment links open your provider with the amount filled in where supported.</p>`;
    };

    function recentNotifications() {
      if (API.net) return [];
      const list = API.on ? S().notifications || [] : S().localNotifs || [];
      return list.slice(0, 30);
    }

    VIEWS.notifications = function () {
      const topic = API.net ? N().topic() : API.on ? S().user.notify || null : null;
      const base = API.net ? N().ntfyBase() : ((S().serverInfo || {}).ntfy || 'https://ntfy.sh');
      const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      const web = topic ? `${base}/${topic}` : '';
      const recent = recentNotifications();
      const privatePreview = (S().user || {}).pushPreview !== 'full';
      if (API.on && !API.net && recent.some((n) => !n.read)) {
        API.req('POST', '/api/notifications/read').then(() => recent.forEach((n) => { n.read = true; })).catch(() => {});
      }
      const recentHTML = !API.net ? `
        <h2 class="sec">Recent</h2>
        ${recent.map((n) => `<button class="listitem" data-act="go" data-to="${esc(n.click || '/')}" style="width:100%;text-align:left"><span class="grow"><b class="small">${n.read ? '' : '<span class="net-dot ok"></span>'}${esc(n.title)}</b><div class="xs muted">${esc(n.message)} · ${ago(n.createdAt * 1000)}</div></span></button>`).join('') || '<div class="empty">Nothing yet — bookings, comments, tags and reminders show up here</div>'}` : '';
      if (!API.on) {
        return `
          ${pageHead('Notifications')}
          <div class="card small" style="line-height:1.5">In the offline demo, booking confirmations and the reminder 2 h before your cut appear here and as device alerts while Fade is open. On the Fade Network or a Fade server they also arrive as push notifications when the app is closed.</div>
          <div class="listitem mt12"><span class="grow"><b class="small">Device alerts</b><div class="xs muted">${permission === 'granted' ? 'On' : permission === 'denied' ? 'Blocked in browser settings' : permission === 'unsupported' ? 'Not supported here' : 'Off'}</div></span>
            ${permission === 'default' ? '<button class="btn xs primary" data-act="netNotifyOn">Turn on</button>' : ''}</div>
          ${recentHTML}`;
      }
      return `
        ${pageHead('Notifications')}
        ${recentHTML}
        <div class="card small" style="line-height:1.5">Fade sends booking requests, confirmations, payments, reminders 2 h before your cut, tags and DMs through <b>ntfy</b> — free, no account.</div>
        <h2 class="sec">On this device</h2>
        <div class="listitem"><span class="grow"><b class="small">Alerts while Fade is open</b><div class="xs muted">${permission === 'granted' ? 'On' : permission === 'denied' ? 'Blocked in browser settings' : permission === 'unsupported' ? 'Not supported here' : 'Off'}</div></span>
          ${permission === 'default' ? '<button class="btn xs primary" data-act="netNotifyOn">Turn on</button>' : ''}</div>
        <h2 class="sec">When Fade is closed</h2>
        <p class="small muted">Install the free ntfy app and subscribe to your private topic — or subscribe in your desktop browser.</p>
        <div class="card"><div class="xs muted">Your private topic</div><b class="small" style="word-break:break-all">${esc(topic || 'not set')}</b>
          <div class="row gap8 mt8 wrap">
            ${topic ? `<a class="btn sm primary" href="ntfy://${esc(web.replace(/^https?:\/\//, ''))}">Open in ntfy app</a>
            <a class="btn sm" href="${esc(web)}" target="_blank" rel="noopener">Subscribe in browser</a>
            <button class="btn sm" data-act="netCopy" data-v="${esc(topic)}">Copy topic</button>` : ''}
          </div>
          <div class="row gap8 mt8 wrap">
            <a class="btn sm" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Android</a>
            <a class="btn sm" href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener">iPhone</a>
          </div></div>
        <h2 class="sec">Privacy</h2>
        <div class="listitem"><span class="grow"><b class="small">Private previews</b><div class="xs muted">${privatePreview ? 'On (default) — pushes only say what kind of thing happened, e.g. “Fade: New message”' : 'Off — pushes show who and what'}</div></span>
          <button class="btn xs ${privatePreview ? '' : 'primary'}" data-act="netPushPreview" data-v="${privatePreview ? 'full' : 'private'}">${privatePreview ? 'Show full previews' : 'Turn on'}</button></div>
        <p class="xs muted mt8">Why it's on: pushes travel through ntfy, which isn't end-to-end encrypted and keeps a copy for about 12 hours even after Fade takes a notification back. With private previews that copy never contains names, messages or places.</p>
        ${API.net ? '' : `<button class="btn block mt12" data-act="netRecallPushes">${icon('trash', 15)} Remove Fade notifications from my devices</button>`}
        <p class="xs muted mt8">Pushes about a cancelled booking, a deleted comment or removed content are taken back from your phone automatically, and reading them here clears them there.</p>
        <button class="btn ghost block mt12" data-act="netRotateTopic">Get a new private topic</button>
        <p class="xs muted mt8">Keep the topic private: anyone who knows it can send you notifications. Rotate it if you get spam.</p>`;
    };

    VIEWS.account = function () {
      const st = N().status();
      return `
        ${pageHead('Account & privacy')}
        <div class="card small" style="line-height:1.55">
          <b>Your account is a key, not a server login.</b> Your email + password create it on your device (we never see or store either). Use the same email and password on any device, or back up the key below.
        </div>
        <div class="field mt12"><label>Public ID</label><div class="input" style="height:auto;padding:10px;word-break:break-all;font-size:12px">${esc(N().npub() || '')}</div></div>
        <button class="btn block" data-act="netShowKey">${icon('shield', 16)} Back up my secret key</button>
        <div class="card mt12 small"><div class="row between"><span>Network</span><b>${st.connected}/${st.relays} relays</b></div>
          <div class="row between xs muted mt4"><span>Synced events</span><span>${compact(st.events)}${st.outbox ? ` · ${st.outbox} waiting to send` : ''}</span></div></div>
        <h2 class="sec">Your data</h2>
        <button class="btn block" data-act="netExport">${icon('download', 16)} Download my data (JSON)</button>
        <p class="xs muted mt8">Public: your profile, shorts, follows, likes, reviews and comments. Private and end-to-end encrypted: bookings, payments, orders, commissions and DMs — only the people involved can read them.</p>
        <button class="btn block mt12" data-act="go" data-to="/legal">Terms, privacy & community guidelines</button>
        <button class="btn block mt12" data-act="logout">${icon('logout', 16)} Log out on this device</button>
        <button class="btn ghost block mt12 hot" data-act="netDelete">Delete my account</button>`;
    };

    let MODQ = { loaded: false, loading: false, queue: [] };

    async function loadModQueue() {
      if (MODQ.loading) return;
      MODQ.loading = true;
      try {
        const data = await API.req('GET', '/api/mod');
        MODQ = { loaded: true, loading: false, queue: data.queue || [], unscanned: data.unscanned || [], blockedHashes: data.blockedHashes || 0 };
      } catch (err) {
        MODQ = { loaded: true, loading: false, queue: [] };
        toast(err.message);
      }
      if (ctx.activeRoute && ctx.activeRoute() === 'admin') refresh();
      else if (location.hash.startsWith('#/admin')) refresh();
    }

    VIEWS.admin = function () {
      const isAdmin = API.net ? N().isAdmin() : API.on && !!S().user.admin;
      if (!isAdmin && !API.on) {
        const mine = S().localReports || [];
        const sent = mine.filter((r) => r.status === 'sent').length;
        return `${pageHead('Moderation')}
          <div class="card small" style="line-height:1.5">Reports you make in the offline demo hide the item here at once and are delivered to Fade’s moderators on the Fade Network. When they remove something, it disappears from every offline device too.</div>
          <h2 class="sec">Your reports</h2>
          ${mine.map((r) => `<div class="listitem"><span class="grow"><b class="small">${esc(r.reason)}</b><div class="xs muted ellip">${esc(r.preview || r.target)}</div></span>${r.status === 'sent' ? badge('sent to moderators', 'acc') : badge('waiting for internet', 'standard')}</div>`).join('') || '<div class="empty">No reports yet</div>'}
          ${mine.length && sent < mine.length ? '<button class="btn block mt12" data-act="netFlushReports">Send now</button>' : ''}`;
      }
      if (!isAdmin) return `${pageHead('Moderation')}<div class="empty">Moderators only</div>`;
      if (!API.net && !MODQ.loaded) loadModQueue();
      const queue = API.net ? N().modQueue() : MODQ.queue;
      const unscanned = API.net
        ? S().shorts.filter((sh) => !(sh.media || {}).scan && !sh.hidden && !viewScans()[sh.id] && !sh.seed).map((sh) => ({ id: sh.id, caption: sh.caption, media: sh.media }))
        : MODQ.unscanned || [];
      const toScan = unscanned.filter((item) => !modScanTried.has(item.id));
      if (toScan.length) setTimeout(() => moderatorScans(toScan), 50);
      const s = S();
      return `
        ${pageHead('Moderation')}
        <div class="kpis"><div class="kpi"><span>Open reports</span><b>${queue.length}</b></div><div class="kpi"><span>Barbers</span><b>${s.barbers.length}</b></div><div class="kpi"><span>Shops</span><b>${s.places.length}</b></div><div class="kpi"><span>Shorts</span><b>${s.shorts.length}</b></div></div>
        <div class="card small mt12" style="line-height:1.5">${icon('shield', 14)} Automatic checks: uploads are classified on the uploader’s device (explicit ones never upload, borderline ones wait here)${API.net ? ', shorts without a scan are checked on viewers’ devices' : `, re-uploads of removed media are blocked by fingerprint${MODQ.blockedHashes ? ` (${MODQ.blockedHashes} blocked)` : ''}`}, and slurs, link spam and floods are refused.</div>
        ${toScan.length ? `<div class="card small mt8">${icon('shield', 14)} Checking ${toScan.length} upload${toScan.length > 1 ? 's' : ''} that arrived without an on-device scan…</div>` : ''}
        <h2 class="sec">Report queue</h2>
        ${queue.map((q) => `
          <div class="card mt8"><div class="row between"><b class="small">${esc(q.preview.type)} · ${q.reporters} reporter${q.reporters === 1 ? '' : 's'}${(q.auto || []).length || q.reports.some((r) => r.auto) ? ' · auto-flag' : ''}${q.reports.some((r) => r.offline) ? ' · from offline demo' : ''}</b>${q.hidden ? badge('hidden', 'hot') : q.kept ? badge('kept', 'acc') : ''}</div>
            <div class="small mt4 ellip">${esc(q.preview.text || q.target)}</div>
            <div class="xs muted mt4">${[...new Set(q.reports.map((r) => r.reason))].map(esc).join(', ')}${q.reports[0].note ? ` · “${esc(q.reports[0].note)}”` : ''}</div>
            <div class="row gap6 mt8 wrap">
              <button class="btn xs hot" data-act="netMod" data-a="hide" data-t="${esc(q.target)}">Hide</button>
              <button class="btn xs" data-act="netMod" data-a="keep" data-t="${esc(q.target)}">Keep</button>
              ${q.targetPk ? `<button class="btn xs hot" data-act="netMod" data-a="${q.banned ? 'unban' : 'ban'}" data-t="${esc(q.targetPk)}">${q.banned ? 'Unban' : 'Ban account'}</button>` : ''}
              ${q.reports.map((r) => `<button class="btn xs ghost" data-act="netMod" data-a="dismiss" data-t="${r.id}">Dismiss</button>`).slice(0, 1).join('')}
            </div></div>`).join('') || '<div class="empty">Nothing to review 🎉</div>'}
        <h2 class="sec">Verification</h2>
        ${[...s.barbers, ...s.places].map((x) => `<div class="listitem"><span class="grow"><b class="small">${esc(x.name)}</b><div class="xs muted">${x.id.startsWith('b') ? 'Barber' : 'Shop'} · ${esc(x.city || '')}</div></span>
          <button class="btn xs ${x.verified ? '' : 'primary'}" data-act="netMod" data-a="${x.verified ? 'unverify' : 'verify'}" data-t="${x.id}">${x.verified ? 'Unverify' : 'Verify'}</button></div>`).join('') || '<div class="empty">No profiles yet</div>'}`;
    };

    VIEWS.legal = function () {
      return `
        ${pageHead('Terms & guidelines')}
        <div class="card small" style="line-height:1.6">
          <b>What Fade is.</b> Fade is free, open software that connects clients, barbers, shops and creators. It runs in your browser on public, decentralised infrastructure (Nostr relays, Blossom media servers, ntfy). There is no Fade company server holding your data or money.<br><br>
          <b>Payments.</b> All payments go directly between users through the payment services they choose. Fade does not process, hold, refund or guarantee payments and charges no fees. Deposits, refunds, rent and commissions are agreements between the people involved; Fade records what each side confirms. Follow your local tax rules.<br><br>
          <b>Bookings.</b> Barbers confirm bookings (automatically by default). Cancel at least 24 h ahead to ask for your deposit back; later cancellations and no-shows may forfeit it.<br><br>
          <b>Commissions.</b> Featured tags earn the creator 5% and sponsored tags 10% of the service or product price for bookings and orders from their short, paid by the tagged barber or shop once the cut is done. Sponsored posts must be real paid partnerships and are labelled.<br><br>
          <b>Privacy.</b> Public data: profiles, shorts, likes, follows, reviews, comments, community posts and anonymous busy times. Encrypted (NIP-44 / NIP-17): bookings, payments, orders, commissions, rent and DMs — readable only by the people involved. Your email and password never leave your device. Deleting your account asks every relay to erase your events; copies may persist on relays that ignore deletion requests.
        </div>
        <h2 class="sec">Community guidelines</h2>
        <div class="card small" style="line-height:1.6">
          ✂️ Shorts are about hair, beards, barbering and shops.<br>🚫 No nudity, hate, harassment, violence, scams or spam.<br>🙅 Don’t impersonate barbers or shops, and don’t post people without their consent.<br>💸 Mark paid partnerships as sponsored.<br>⭐ Reviews count only after a completed cut confirmed by the barber.<br>🛡️ Content reported by 3+ people is hidden until a moderator reviews it; repeat offenders are banned.
        </div>
        <p class="xs muted center mt16">Fade is provided as is, without warranty.</p>`;
    };

    const localWallet = VIEWS.wallet;
    VIEWS.wallet = function (arg) {
      if (!API.net) return localWallet(arg);
      const s = S();
      const pay = s.user.pay || {};
      const rails = Object.keys(pay).filter((k) => !['cash', 'currency'].includes(k));
      return `
        ${pageHead('Payments')}
        <div class="ccard"><div class="small muted">Fade fee</div><div class="bal">0%</div><div class="small muted">You pay barbers, shops and creators directly. Fade never holds your money.</div></div>
        <button class="card tap mt12 row gap10" data-act="go" data-to="/payouts"><span class="acc">${icon('dollar')}</span><span class="grow small"><b>How people pay you</b><div class="xs muted">${rails.length ? rails.map((r) => N().railLabel(r)).join(' · ') : 'Not set up yet'}</div></span>${icon('chev', 16)}</button>
        <h2 class="sec">History</h2>
        ${(s.txns || []).map((t) => `<div class="row gap12" style="padding:10px 0;border-bottom:1px solid var(--line)"><span class="grow"><b class="small">${esc(t.label)}</b><div class="xs muted">${esc(t.method)} · ${fmtDate(t.date.slice(0, 10))}</div></span><b class="small ${t.amount > 0 ? 'ok' : ''}">${t.amount > 0 ? '+' : ''}${money(t.amount)}</b></div>`).join('') || '<div class="empty">No payments yet</div>'}`;
    };

    const localMembership = VIEWS.membership;
    VIEWS.membership = function (arg) {
      if (!API.net) return localMembership(arg);
      return `
        ${pageHead('Membership')}
        <div class="ccard"><div class="bal">Free</div><div class="small muted">Fade Network has no subscription and no booking fees. Every feature is free for clients, barbers, shops and creators.</div></div>
        <p class="small muted mt12" style="line-height:1.5">Want to support the project? Book often, post shorts and invite your barber.</p>`;
    };

    Object.assign(ACTIONS, {
      netSavePayouts: async () => {
        const pay = {};
        RAILS_EDIT.forEach(([key]) => {
          if (key !== 'qris' && $(`#po-${key}`)) pay[key] = $(`#po-${key}`).value.trim();
        });
        pay.qris = (S().user.pay || {}).qris || '';
        pay.cash = $('#po-cash').checked;
        pay.currency = $('#po-currency').value;
        await act(() => API.req('PUT', '/api/me', { pay }), 'Payout methods saved');
        const saved = S().user.pay || {};
        const dropped = RAILS_EDIT.filter(([key]) => key !== 'qris' && pay[key] && !saved[key]).map(([, label]) => label);
        if (dropped.length) toast(`Check the format of: ${dropped.join(', ')}`);
      },
      netNotifyOn: async () => {
        const result = await Notification.requestPermission();
        toast(result === 'granted' ? 'Alerts on' : 'Alerts are blocked');
        refresh();
      },
      netPushPreview: (el) => act(
        () => (API.net ? API.req('PUT', '/api/me', { pushPreview: el.dataset.v }) : API.req('PUT', '/api/me/push', { preview: el.dataset.v })),
        el.dataset.v === 'private' ? 'Private previews on' : 'Private previews off',
      ),
      netRecallPushes: async () => {
        try {
          const result = await API.req('POST', '/api/notifications/recall');
          await pull();
          toast(`Removed ${result.recalled || 0} notification${result.recalled === 1 ? '' : 's'} from your devices`);
        } catch (err) {
          toast(err.message);
        }
      },
      netRotateTopic: () => act(() => (API.net ? API.req('PUT', '/api/me', { rotateNotify: true }) : API.req('PUT', '/api/me/push', { rotate: true })), 'New private topic — re-subscribe in the ntfy app'),
      netShowKey: () => {
        if (!window.confirm('Your secret key gives full control of your account. Only reveal it somewhere private. Continue?')) return;
        openSheet(`
          <div class="sheet-head"><h2 class="grow">Secret key</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
          <p class="small muted">Store it in a password manager. Anyone with it can act as you. Log in on another device with it, or with your email + password.</p>
          <div class="input mt12" style="height:auto;padding:12px;word-break:break-all;font-size:12px">${esc(N().nsec())}</div>
          <button class="btn primary block mt12" data-act="netCopy" data-v="${esc(N().nsec())}">Copy key</button>`);
      },
      netExport: () => {
        const blob = new Blob([JSON.stringify(N().exportData(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fade-data-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
      netDelete: async () => {
        if (!window.confirm('Delete your account? Your profile, barber page, shop and shorts are removed from the network. This can’t be undone.')) return;
        if (window.prompt('Type DELETE to confirm') !== 'DELETE') return;
        await N().deleteAccount();
        ctx.logoutLocal();
        toast('Account deleted');
      },
      netMod: async (el) => {
        await act(() => API.req('POST', '/api/mod', { action: el.dataset.a, target: el.dataset.t }), 'Done');
        if (!API.net) {
          MODQ.loaded = false;
          loadModQueue();
        }
      },
      netKeyLogin: async () => {
        const key = window.prompt('Paste your secret key (nsec1… or 64-character hex)');
        if (!key) return;
        try {
          await N().loginWithKey(key);
          await ctx.afterLogin();
        } catch (err) {
          toast(err.message);
        }
      },
      netGoDemo: () => {
        localStorage.setItem('fade.forceLocal', '1');
        location.reload();
      },
      netGoNetwork: () => {
        localStorage.removeItem('fade.forceLocal');
        localStorage.removeItem('fade.api');
        location.search = '';
      },
    });

    // QR image upload for payouts
    document.addEventListener('change', async (e) => {
      if (e.target.id !== 'po-qris' || !e.target.files || !e.target.files[0]) return;
      try {
        toast('Uploading QR…');
        const file = e.target.files[0];
        const result = await N().upload('/api/media', file, file.type || 'image/png', {});
        const pay = { ...(S().user.pay || {}), qris: result.url };
        await act(() => API.req('PUT', '/api/me', { pay }), 'QR code saved');
      } catch (err) {
        toast(err.message);
      }
    });

    // -----------------------------------------------------------------------
    // Me page sections and welcome extras
    // -----------------------------------------------------------------------
    function meAccountItems(item) {
      const s = S();
      const rails = Object.keys(s.user.pay || {}).filter((k) => !['cash', 'currency'].includes(k));
      return `
        ${item('dollar', 'Payments & payouts', '/wallet', rails.length ? `Paid directly via ${rails.map((r) => N().railLabel(r)).slice(0, 3).join(', ')}` : 'Add how people pay you')}
        ${item('bell', 'Notifications', '/notifications', 'Bookings, payments, reminders, DMs')}
        ${item('shield', 'Account & privacy', '/account', 'Backup key, export, delete')}
        ${N().isAdmin() ? item('flag', 'Moderation', '/admin', `${N().modQueue().length} open reports`) : ''}`;
    }

    function meAppSection() {
      const st = N().status();
      return `
        <div class="card small row gap10">${icon('server', 18)}<span class="grow">Fade Network <span class="${st.connected ? 'ok' : 'hot'}">● ${st.connected ? 'online' : 'connecting'}</span>
          <div class="xs muted">${st.connected}/${st.relays} relays · free · open</div></span></div>
        <button class="btn block mt8" data-act="go" data-to="/legal">Terms & community guidelines</button>
        <button class="btn block mt8" data-act="logout">${icon('logout', 16)} Log out</button>
        <button class="btn ghost block mt8" data-act="netGoDemo">Explore the offline demo</button>`;
    }

    // Me-page entries for server / offline modes (the Fade Network has its own account section).
    function meSafetyItems(item) {
      const unread = API.on ? (S().notifications || []).filter((n) => !n.read).length : (S().localNotifs || []).filter((n) => !n.read).length;
      return `${item('bell', 'Notifications', '/notifications', unread ? `${unread} new` : 'Bookings, comments, reminders')}
        ${API.on && S().user.admin ? item('shield', 'Moderation', '/admin', `${(S().moderation || {}).openReports || 0} open reports`) : ''}`;
    }

    // Server mode: toast + device alert for notifications that arrived since the last sync.
    function onServerState(st) {
      const list = st.notifications || [];
      const key = `fade.seenNotif.${st.user.id}`;
      const seen = Number(localStorage.getItem(key) || 0);
      const newest = list.reduce((max, n) => Math.max(max, n.createdAt), seen);
      if (seen) {
        list.filter((n) => n.createdAt > seen && !n.read).slice(0, 3).forEach((n) => deviceAlert(n.title, n.message));
      }
      localStorage.setItem(key, String(newest || Date.now() / 1000));
    }

    function deviceAlert(title, message) {
      toast(`${title}: ${message}`.slice(0, 140));
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        try {
          new Notification(title, { body: message, icon: 'icons/icon-192.png' });
        } catch (err) {
          // some browsers only allow notifications from a service worker
        }
      }
    }

    // Offline demo → Fade moderators. Reports wait in S().localReports until they reach a relay.
    async function flushOfflineReports() {
      const s = S();
      const net = N();
      if (API.on || !s || !net || !net.offline) return 0;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
      let sent = 0;
      for (const report of (s.localReports || []).filter((r) => r.status !== 'sent')) {
        try {
          const id = await net.offline.sendReport(report);
          if (id) {
            report.status = 'sent';
            report.eventId = id;
            sent++;
          }
        } catch (err) {
          // stays queued
        }
      }
      if (sent) ctx.save();
      return sent;
    }

    // Moderators' decisions about demo content (hide) apply on every offline device.
    async function syncOfflineDecisions() {
      const s = S();
      const net = N();
      if (API.on || !s || !net || !net.offline) return null;
      const decisions = await net.offline.fetchDecisions().catch(() => null);
      if (!decisions) return null;
      const hidden = new Set(decisions.hidden);
      s.modHidden = [...hidden];
      const before = s.shorts.length;
      s.shorts = s.shorts.filter((sh) => !hidden.has(sh.id));
      s.localComments = (s.localComments || []).filter((c) => !hidden.has(c.id));
      ctx.save();
      if (s.shorts.length !== before) refresh();
      return decisions;
    }

    // Offline demo: local notification feed + 2 h reminders while the app is open.
    function localNotify(title, message, click = '/bookings') {
      const s = S();
      s.localNotifs = [{ id: `ln${Date.now().toString(36)}`, title, message, click, createdAt: Date.now() / 1000, read: false }, ...(s.localNotifs || [])].slice(0, 50);
      ctx.save();
      deviceAlert(title, message);
    }

    function localDuties() {
      if (API.on || !S() || !S().bookings) return;
      const now = Date.now();
      let changed = false;
      S().bookings.forEach((bk) => {
        if (bk.status !== 'upcoming' || bk.reminded) return;
        const place = placeById(bk.placeId);
        if (!place || !ctx.placeTimeToDate) return;
        const start = ctx.placeTimeToDate(place, bk.date, bk.time).getTime();
        if (start - 2 * 3600 * 1000 <= now && now < start) {
          bk.reminded = true;
          changed = true;
          const b = barberById(bk.barberId);
          localNotify('Your cut is in 2 hours ✂️', `${bk.serviceName} with ${b ? b.name : 'your barber'} at ${place.name}, ${fmtTime(bk.time)}`);
        }
      });
      if (changed) ctx.save();
    }

    function authExtras(signup) {
      return `
        <p class="xs muted mt8" style="line-height:1.45">${signup ? 'Your email + password create your private key on this device. Fade never sees or stores them — use the same ones to log in anywhere.' : 'Same email and password you signed up with.'}</p>
        <button class="btn ghost block mt8" data-act="netKeyLogin">Log in with a secret key</button>
        <p class="xs muted center mt12">Fade Network · free, no fees · <a class="acc" data-act="netGoDemo">try the offline demo</a></p>`;
    }

    function homeEmpty() {
      if (S().barbers.length) return '';
      return `
        <div class="card mt16" style="line-height:1.5">
          <b>Fade Network is brand new near you.</b>
          <div class="small muted mt4">Be the first barber or shop in your city — it’s free, and clients pay you directly.</div>
          <div class="row gap8 mt12 wrap">
            <button class="btn sm primary" data-act="shareInvite">${icon('share', 14)} Invite your barber</button>
            <button class="btn sm" data-act="netGoDemo">See the demo</button>
          </div>
        </div>`;
    }

    ACTIONS.shareInvite = () => ctx.shareLink('/welcome', 'Join me on Fade — free booking + shorts for barbers');

    // Shop checkout in network mode: create one order per seller, then pay the first seller.
    async function checkout(total) {
      const s = S();
      const result = await API.req('POST', '/api/orders', {
        items: s.cart.map((i) => ({ id: i.id, qty: i.qty })), delivery: ctx.cartDelivery(), address: ctx.cartAddress(), refShortId: ctx.activeRef(),
      });
      s.cart = [];
      ctx.save();
      await pull();
      const orders = result.orders || [result.order];
      const first = orders[0];
      openPay({
        title: 'Pay for your order', amount: first.total, toPk: first.sellerPk, note: `${first.items.length} item${first.items.length > 1 ? 's' : ''} · ${first.delivery}`,
        laterLabel: 'Pay when I pick it up',
        onPaid: (rail, ref, extra) => API.req('POST', `/api/orders/${first.id}/pay`, { amount: first.total, rail, ref, ...extra }),
      });
      if (orders.length > 1) toast(`${orders.length} orders created — one per seller. Pay the others from Shop → Orders.`);
      return total;
    }

    return {
      openPay, checkoutHTML, successExtra, statusLabel, bookingCardExtra, rateTipNote, afterRate, cancelMessage,
      meSafetyItems, onServerState, localNotify, localDuties, commentsFor, flushOfflineReports, syncOfflineDecisions, autoHidden,
      studioPanel, ownerPanel, creatorPanel, reelButtons, profileMenu, meAccountItems, meAppSection, authExtras,
      homeEmpty, checkout, blocked, orderRow,
    };
  };
})();
