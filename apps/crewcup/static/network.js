/* CrewCup Network — cross-company feed, directory, coffee chats, meetups and the building challenge.
   Everything shown here comes from /api/state → `social`, which the server filters per viewer. */

S.net = { seg: new URLSearchParams(location.search).get("net") || "feed", filter: "all", comments: {} };

const NET_COLORS = ["#344054", "#1d4ed8", "#0e7490", "#4d7c0f", "#9a5b2b", "#6d28d9", "#be123c", "#475467"];
const NET_KINDS = ["update", "recommendation", "question", "hiring"];
const NET_KIND_LABEL = { update: "Update", recommendation: "Recommendation", question: "Question", hiring: "Hiring", announcement: "Announcement", recognition: "Recognition" };
const NET_OPEN_TO = ["coffee_chat", "mentoring", "hiring", "partnerships"];
const NET_OPEN_LABEL = { coffee_chat: "Coffee chats", mentoring: "Mentoring", hiring: "Hiring", partnerships: "Partnerships" };
const NET_REASONS = ["spam", "inappropriate", "confidential", "other"];
const NET_REASON_LABEL = { spam: "Spam or advertising", inappropriate: "Inappropriate or offensive", confidential: "Shares confidential information", other: "Something else" };

function net() {
  return S.social || { enabled: false, feed: [], companies: [], people: [], chats: [], meetups: [], trending: [], viewer: {}, challenge: { rows: [] } };
}

function netColor(key) {
  let hash = 0;
  for (const char of String(key || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return NET_COLORS[hash % NET_COLORS.length];
}

function netAvatar(card) {
  if (card.kind === "company") {
    return `<span class="avatar-sm sq" style="background:${netColor(card.company)}">${ic("building")}</span>`;
  }
  if (card.kind === "cafe") {
    return `<span class="avatar-sm sq" style="background:#7a4a2a">${ic("coffee")}</span>`;
  }
  return `<span class="avatar-sm" style="background:${netColor(card.company || card.key)}">${esc(initials(card.name))}</span>`;
}

function netAgo(ts) {
  const minutes = Math.max(0, Math.round((S.now - ts) / 60));
  if (minutes < 1) {
    return t("just now");
  }
  if (minutes < 60) {
    return t("{n} min ago", { n: minutes });
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return t("{n} h ago", { n: hours });
  }
  return dayHm(ts, contextTz());
}

function netAudience(audience, where) {
  if (audience === "company") {
    return `<span class="chip">{{i:lock}} ${esc(t("My company"))}</span>`;
  }
  if (audience === "building") {
    return `<span class="chip">{{i:building}} ${esc(where && where.building ? where.building : t("Building"))}</span>`;
  }
  return `<span class="chip">{{i:globe}} ${esc(where && where.city ? where.city : t("Network"))}</span>`;
}

function netCompany(id) {
  return net().companies.find((company) => company.id === id);
}

function netNearbyCafes() {
  const p = persona();
  if (p.kind === "cafe") {
    const own = S.data.cafes[p.id];
    return Object.values(S.data.cafes).filter((cafe) => cafe.country === own.country);
  }
  const office = officeOf(me());
  return Object.values(S.data.cafes).filter((cafe) => cafe.walk_min[office.id] != null);
}

function netLocalDayStart(tzMin) {
  const local = S.now + tzMin * 60;
  return Math.floor(local / 86400) * 86400 - tzMin * 60;
}

function netSlotOptions(tzMin, days, minLeadMin) {
  const options = [];
  const dayStart = netLocalDayStart(tzMin);
  for (let day = 0; day < days; day += 1) {
    for (let minutes = 8 * 60; minutes <= 17 * 60; minutes += 30) {
      const ts = dayStart + day * 86400 + minutes * 60;
      if (ts >= S.now + minLeadMin * 60) {
        options.push(ts);
      }
    }
  }
  return options;
}

function netTz() {
  const p = persona();
  if (p.kind === "cafe") {
    return S.data.cafes[p.id].tz_min;
  }
  if (p.kind === "emp") {
    return officeOf(me()).tz_min;
  }
  return contextTz();
}

/* ------------------------------------------------------------------ posts */

function netPost(post) {
  const p = persona();
  const canInteract = p.kind === "emp";
  const open = S.net.comments[post.id];
  const cafeTag = post.cafe && S.data.cafes[post.cafe] ? `<span class="chip">{{i:coffee}} ${esc(cafeName(post.cafe))}</span>` : "";
  const kind = post.kind && post.kind !== "update" ? `<span class="chip ${post.kind === "hiring" ? "info" : post.kind === "announcement" ? "dark" : post.kind === "recognition" ? "ok" : ""}">${esc(t(NET_KIND_LABEL[post.kind] || post.kind))}</span>` : "";
  const sameBuilding = !post.same_company && post.same_building ? `<span class="chip ok">{{i:building}} ${esc(t("Your building"))}</span>` : "";
  const menu = canInteract && !post.mine
    ? `<button class="btn small flat-btn" data-act="netreport" data-post="${post.id}" title="${esc(t("Report"))}">{{i:flag}}</button>
       <button class="btn small flat-btn" data-act="nethide" data-post="${post.id}" title="${esc(t("Hide"))}">{{i:eye-off}}</button>`
    : post.mine ? `<button class="btn small flat-btn" data-act="netdelete" data-post="${post.id}" title="${esc(t("Delete"))}">{{i:trash}}</button>` : "";
  const comments = open || post.comments.length <= 2 ? post.comments : post.comments.slice(-2);
  return `<article class="post">
    <div class="post-head">
      ${netAvatar(post.author)}
      <div class="post-who">
        <div class="post-name">${esc(post.author.name)}</div>
        <div class="small muted">${esc(post.author.title)}${post.author.company_name && post.author.kind === "person" ? " · " + esc(post.author.company_name) : ""} · ${esc(netAgo(post.ts))}</div>
      </div>
      <div class="post-menu">${menu}</div>
    </div>
    <div class="post-body">${esc(post.text).replace(/\n/g, "<br>")}</div>
    <div class="row post-tags">${kind}${netAudience(post.audience, post)}${sameBuilding}${cafeTag}</div>
    <div class="row post-actions">
      <button class="btn small ${post.liked ? "sel" : ""}" ${canInteract ? "" : "disabled"} data-act="netlike" data-post="${post.id}">{{i:thumbs-up}} ${post.likes}</button>
      <button class="btn small" data-act="netcomments" data-post="${post.id}">{{i:message}} ${post.comments.length}</button>
      ${post.author.kind === "person" && post.author.key.startsWith("member:") && canInteract ? `<button class="btn small" data-act="netchat" data-to="${esc(post.author.key)}">{{i:coffee}} ${esc(t("Invite for coffee"))}</button>` : ""}
    </div>
    ${comments.length || open ? `<div class="comments">
      ${post.comments.length > comments.length ? `<button class="linkish small" data-act="netcomments" data-post="${post.id}">${esc(t("View all {n} comments", { n: post.comments.length }))}</button>` : ""}
      ${comments.map((comment) => `<div class="comment">${netAvatar(comment.by)}<div><b>${esc(comment.by.name)}</b> <span class="muted small">${esc(comment.by.company_name || "")} · ${esc(netAgo(comment.ts))}</span><div>${esc(comment.text)}</div></div></div>`).join("")}
      ${open && canInteract ? `<div class="row"><input type="text" maxlength="280" data-draft="netc_${post.id}" value="${esc(d("netc_" + post.id, ""))}" placeholder="${esc(t("Write a comment…"))}" style="flex:1"><button class="btn small primary" data-act="netcomment" data-post="${post.id}">${esc(t("Reply"))}</button></div>` : ""}
    </div>` : ""}
  </article>`;
}

function netComposer() {
  const s = net();
  const profile = s.me || {};
  const site = s.viewer.site || {};
  const externalOk = s.enabled && profile.visibility === "network";
  const audience = d("net_aud", externalOk ? "building" : "company");
  const kind = d("net_kind", "update");
  const cafes = netNearbyCafes();
  const audiences = [
    ["building", t("People in {b}", { b: site.building || t("my building") }), externalOk],
    ["network", t("CrewCup companies in {c}", { c: site.city || t("my city") }), externalOk],
    ["company", t("{co} only", { co: S.data.company.name }), true],
  ];
  return `<div class="card stack">
    <div class="row between"><h3 style="margin:0">{{i:edit}} ${esc(t("Share with your network"))}</h3><span class="small muted">${esc(t("Max {n} characters", { n: s.limits ? s.limits.post : 500 }))}</span></div>
    <textarea rows="3" maxlength="${s.limits ? s.limits.post : 500}" data-draft="net_text" placeholder="${esc(t("Share an update, recommend a café, ask a question or post an opening…"))}">${esc(d("net_text", ""))}</textarea>
    <div class="row">
      <select data-draft="net_aud" aria-label="${esc(t("Audience"))}">${audiences.map(([value, label, ok]) => `<option value="${value}" ${value === audience ? "selected" : ""} ${ok ? "" : "disabled"}>${esc(label)}</option>`).join("")}</select>
      <select data-draft="net_kind" aria-label="${esc(t("Type"))}">${NET_KINDS.map((value) => `<option value="${value}" ${value === kind ? "selected" : ""}>${esc(t(NET_KIND_LABEL[value]))}</option>`).join("")}</select>
      <select data-draft="net_cafe" aria-label="${esc(t("Tag a café"))}"><option value="">${esc(t("No café tag"))}</option>${cafes.map((cafe) => `<option value="${cafe.id}" ${d("net_cafe", "") === cafe.id ? "selected" : ""}>${esc(cafe.name)}</option>`).join("")}</select>
      <span class="spacer" style="flex:1"></span>
      <button class="btn primary" data-act="netpost">${esc(t("Post"))}</button>
    </div>
    ${!s.enabled ? `<div class="banner warn small">{{i:lock}} ${esc(t("Your company has turned off the cross-company network. Posts stay inside your company."))}</div>`
      : profile.visibility !== "network" ? `<div class="small muted">{{i:lock}} ${esc(t("Your profile is not visible to other companies, so you can only post to your company. Change this in Network profile."))}</div>` : ""}
  </div>`;
}

function netFeedFilters() {
  const filters = [["all", "All"], ["building", "My building"], ["following", "Following"], ["company", "My company"]];
  return `<div class="row seg">${filters.map(([key, label]) => `<button class="btn small ${S.net.filter === key ? "sel" : ""}" data-act="netfilter" data-v="${key}">${esc(t(label))}</button>`).join("")}</div>`;
}

function netFilteredFeed() {
  const s = net();
  const follows = (s.me && s.me.follows) || [];
  const building = s.viewer.site ? s.viewer.site.building : null;
  return s.feed.filter((post) => {
    if (S.net.filter === "building") {
      return post.building === building;
    }
    if (S.net.filter === "following") {
      return follows.includes(post.author.company);
    }
    if (S.net.filter === "company") {
      return post.same_company;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ directory & people */

function netCompanyCard(company) {
  const p = persona();
  const stats = company.stats;
  const site = company.sites[0] || {};
  return `<div class="company-card">
    <div class="row between" style="align-items:flex-start">
      <div class="row" style="gap:10px;align-items:flex-start;flex-wrap:nowrap">
        <span class="avatar-sm sq" style="background:${netColor(company.id)}">${ic("building")}</span>
        <div>
          <div class="post-name">${esc(company.name)} ${company.verified ? `<span class="verified" title="${esc(t("Verified domain"))}">{{i:shield}} ${esc(company.verified)}</span>` : ""}</div>
          <div class="small muted">${esc(company.industry)} · ${esc(company.headcount)}</div>
          <div class="small muted">{{i:pin}} ${esc(site.building || "")}${site.floors ? " · " + esc(site.floors) : ""}</div>
        </div>
      </div>
      ${company.mine ? `<span class="chip dark">${esc(t("Your company"))}</span>` : p.kind === "emp" ? `<button class="btn small ${company.following ? "sel" : ""}" data-act="netfollow" data-company="${company.id}" data-on="${company.following ? "0" : "1"}">${company.following ? "{{i:check}} " + esc(t("Following")) : "{{i:plus}} " + esc(t("Follow"))}</button>` : ""}
    </div>
    <div class="row" style="margin-top:8px">
      ${company.same_building && !company.mine ? `<span class="chip ok">{{i:building}} ${esc(t("Your building"))}</span>` : ""}
      ${stats ? `<span class="chip">{{i:coffee}} ${esc(t("{n} cups this month", { n: stats.cups }))}</span><span class="chip">{{i:leaf}} ${esc(t("{p}% reusable", { p: stats.reusable_pct }))}</span>` : `<span class="chip">${esc(t("Stats private"))}</span>`}
      ${company.open_people.length ? `<span class="chip info">{{i:users}} ${esc(t("{n} open to coffee chats", { n: company.open_people.length }))}</span>` : ""}
    </div>
    <div class="row between" style="margin-top:8px">
      <span class="small muted">${company.fav_cafes.length ? esc(t("Usually orders from")) + " " + company.fav_cafes.map((id) => esc(cafeName(id))).join(", ") : ""}</span>
      <button class="btn small" data-act="netcompany" data-company="${company.id}">${esc(t("View"))}</button>
    </div>
  </div>`;
}

function netCompanies() {
  const s = net();
  const others = s.companies.filter((company) => !company.mine);
  return `<div class="card stack">
    <div class="row between"><h3 style="margin:0">{{i:building}} ${esc(t("Companies near you"))}</h3><span class="small muted">${esc(t("{n} companies", { n: others.length }))}</span></div>
    ${others.length ? others.map(netCompanyCard).join("") : `<div class="empty">${esc(t("No other companies visible yet."))}</div>`}
    ${s.private_in_building ? `<div class="small muted">{{i:lock}} ${esc(s.private_in_building === 1 ? t("1 more company in your building keeps its profile private.") : t("{n} more companies in your building keep their profile private.", { n: s.private_in_building }))}</div>` : ""}
  </div>`;
}

function netPersonCard(person) {
  const reasons = { closed: "Not taking requests", building_only: "Accepts requests from their building only" };
  const openTo = person.open_to.map((key) => `<span class="chip ${key === "hiring" ? "info" : ""}">${esc(t(NET_OPEN_LABEL[key] || key))}</span>`).join("");
  return `<div class="person">
    <div class="row" style="gap:10px;flex-wrap:nowrap;align-items:flex-start">
      ${netAvatar({ kind: "person", name: person.name, company: person.company, key: person.key })}
      <div style="flex:1;min-width:0">
        <div class="post-name">${esc(person.name)}</div>
        <div class="small muted">${esc(person.title)} · ${esc(person.company_name)}</div>
        <div class="row" style="margin-top:6px">${person.same_building ? `<span class="chip ok">{{i:building}} ${esc(t("Your building"))}</span>` : ""}${openTo}${person.interests.map((item) => `<span class="chip">${esc(item)}</span>`).join("")}</div>
      </div>
      ${person.can_request
        ? `<button class="btn small primary" data-act="netchat" data-to="${esc(person.key)}">{{i:coffee}} ${esc(t("Invite for coffee"))}</button>`
        : `<span class="small muted" style="max-width:140px;text-align:right">${esc(t(person.chat_pref === "building" ? reasons.building_only : reasons.closed))}</span>`}
    </div>
  </div>`;
}

function netPeople() {
  const s = net();
  const query = String(d("net_q", "")).trim().toLowerCase();
  const people = s.people.filter((person) => !query || [person.name, person.title, person.company_name, ...person.interests].join(" ").toLowerCase().includes(query));
  return `<div class="card stack">
    <div class="row between"><h3 style="margin:0">{{i:users}} ${esc(t("People open to meeting"))}</h3>
      <input type="search" data-draft="net_q" value="${esc(d("net_q", ""))}" placeholder="${esc(t("Search name, company, interest"))}" style="min-width:220px"></div>
    <div class="small muted">${esc(t("Only people who chose to be visible are listed. Requests are private between the two of you."))}</div>
    ${people.length ? people.map(netPersonCard).join("") : `<div class="empty">${esc(t("Nobody matches yet."))}</div>`}
  </div>`;
}

/* ------------------------------------------------------------------ chats, meetups, challenge */

function netChats() {
  const s = net();
  const tz = netTz();
  const status = { pending: ["warn", "Waiting for reply"], accepted: ["ok", "Confirmed"], declined: ["bad", "Declined"], cancelled: ["", "Cancelled"] };
  return `<div class="card stack">
    <h3>{{i:coffee}} ${esc(t("Coffee chats"))}</h3>
    ${s.chats.length ? s.chats.map((chat) => {
      const [tone, label] = status[chat.status] || ["", chat.status];
      const incomingPending = !chat.outgoing && chat.status === "pending";
      return `<div class="chat-row">
        <div class="row between" style="flex-wrap:nowrap;align-items:flex-start">
          <div class="row" style="gap:8px;flex-wrap:nowrap">${netAvatar(chat.other)}<div><div class="post-name">${esc(chat.other.name)}</div><div class="small muted">${esc(chat.other.company_name || chat.other.title)}</div></div></div>
          <span class="chip ${tone}">${esc(t(label))}</span>
        </div>
        <div class="small" style="margin-top:6px">{{i:pin}} ${esc(cafeName(chat.cafe))} · {{i:clock}} ${esc(dayHm(chat.slot, tz))}${chat.outgoing ? "" : " · " + esc(t("invited you"))}</div>
        ${chat.note ? `<div class="small muted">“${esc(chat.note)}”</div>` : ""}
        ${chat.reason ? `<div class="small muted">${esc(chat.reason)}</div>` : ""}
        <div class="row" style="margin-top:6px">
          ${incomingPending ? `<button class="btn small good" data-act="netrespond" data-chat="${chat.id}" data-v="1">${esc(t("Accept"))}</button><button class="btn small" data-act="netrespond" data-chat="${chat.id}" data-v="0">${esc(t("Decline"))}</button>` : ""}
          ${chat.outgoing && (chat.status === "pending" || chat.status === "accepted") ? `<button class="btn small" data-act="netcancel" data-chat="${chat.id}">${esc(t("Cancel"))}</button>` : ""}
          ${chat.status === "accepted" ? `<button class="btn small" data-act="netics" data-chat="${chat.id}">{{i:calendar}} ${esc(t("Add to calendar"))}</button><button class="btn small" data-act="tab" data-tab="order">{{i:coffee}} ${esc(t("Pre-order"))}</button>` : ""}
        </div>
      </div>`;
    }).join("") : `<div class="empty">${esc(t("No coffee chats yet. Invite someone from People."))}</div>`}
  </div>`;
}

function netMeetupCard(meetup) {
  const p = persona();
  const tz = netTz();
  const pct = Math.min(100, Math.round((meetup.going / meetup.capacity) * 100));
  const capReached = meetup.max_per_company && meetup.my_company_count >= meetup.max_per_company && !meetup.me_going;
  return `<div class="meetup">
    <div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
      <div>
        <div class="post-name">${esc(meetup.title)}</div>
        <div class="small muted">${esc(t("Hosted by {h}", { h: meetup.host.name }))} · ${netAudience(meetup.audience, null)}</div>
      </div>
      <div class="date-badge"><div>${esc(dayHm(meetup.start, tz).split(" ")[0])}</div><b>${esc(hmAt(meetup.start, tz))}</b></div>
    </div>
    ${meetup.description ? `<div class="small" style="margin-top:6px">${esc(meetup.description)}</div>` : ""}
    <div class="small muted" style="margin-top:6px">{{i:pin}} ${esc(cafeName(meetup.cafe))} · ${esc(t("{m} min", { m: meetup.duration_min }))}</div>
    <div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div>
    <div class="row between" style="margin-top:6px">
      <span class="small">${esc(t("{n} of {c} going · {k} companies", { n: meetup.going, c: meetup.capacity, k: meetup.companies }))}</span>
      ${p.kind === "emp" ? (meetup.me_going
        ? `<button class="btn small sel" data-act="netrsvp" data-meetup="${meetup.id}" data-v="0">{{i:check}} ${esc(t("Going"))}</button>`
        : `<button class="btn small primary" ${capReached || meetup.going >= meetup.capacity ? "disabled" : ""} data-act="netrsvp" data-meetup="${meetup.id}" data-v="1">${esc(t("Join"))}</button>`) : ""}
    </div>
    <div class="row" style="margin-top:6px">${meetup.breakdown.slice(0, 4).map((row) => `<span class="chip">${esc(row.name)} · ${row.count}</span>`).join("")}</div>
    ${meetup.max_per_company ? `<div class="small muted" style="margin-top:4px">${esc(t("Max {n} per company so every company gets a seat.", { n: meetup.max_per_company }))}${capReached ? " " + esc(t("Your company's seats are taken.")) : ""}</div>` : ""}
  </div>`;
}

function netMeetups(showHost) {
  const s = net();
  return `<div class="card stack">
    <div class="row between"><h3 style="margin:0">{{i:calendar}} ${esc(t("Meetups at partner cafés"))}</h3>${showHost ? `<button class="btn small" data-act="nethost">{{i:plus}} ${esc(t("Host a meetup"))}</button>` : ""}</div>
    ${s.meetups.length ? s.meetups.map(netMeetupCard).join("") : `<div class="empty">${esc(t("No upcoming meetups."))}</div>`}
  </div>`;
}

function netChallenge() {
  const board = net().challenge;
  if (!board || !board.visible || !board.rows.length) {
    return "";
  }
  const emp = persona().kind === "emp" ? me() : null;
  return `<div class="card stack">
    <h3>{{i:leaf}} ${esc(S.lang === "id" ? board.title_id : board.title)}</h3>
    <div class="small muted">${esc(t("Share of cups ordered in a reusable cup. Only companies that share aggregate stats are ranked."))}</div>
    <table class="lb"><tbody>${board.rows.map((row) => `<tr class="${row.mine ? "mine" : ""}"><td class="rk">${row.rank}</td><td>${esc(row.name)}</td><td class="num">${row.reusable_pct}%</td><td class="num muted small">${esc(t("{n} cups", { n: row.cups }))}</td></tr>`).join("")}</tbody></table>
    ${board.not_shown ? `<div class="small muted">${esc(t("{n} companies in these buildings are not shown.", { n: board.not_shown }))}</div>` : ""}
    ${emp && !emp.profile.reusable ? `<button class="btn small" data-act="netreusable">{{i:leaf}} ${esc(t("Use my own cup by default"))}</button>` : ""}
  </div>`;
}

function netTrending(onlyCafe) {
  const rows = net().trending.filter((row) => !onlyCafe || row.cafe === onlyCafe);
  if (!rows.length) {
    return "";
  }
  return `<div class="card stack">
    <h3>{{i:chart}} ${esc(t("Popular nearby this week"))}</h3>
    ${rows.map((row) => {
      const cafe = S.data.cafes[row.cafe];
      return `<div class="trend"><div class="row between"><b>${esc(cafe.name)}</b><span class="small muted">${esc(t("across {n} companies", { n: row.companies }))}</span></div>
        ${row.top.map(([item, share]) => `<div class="trend-row"><span>${esc(itemName(cafe, item))}</span><span class="bar thin"><i style="width:${share}%"></i></span><span class="small num">${share}%</span></div>`).join("")}</div>`;
    }).join("")}
    <div class="small muted">${esc(t("Aggregated across companies; no individual orders are shared."))}</div>
  </div>`;
}

function netProfileCard() {
  const s = net();
  const profile = s.me || {};
  const visibility = d("netp_vis", profile.visibility);
  const chatPref = d("netp_chat", profile.chat_pref);
  const visOptions = [["network", "Other companies nearby"], ["company", "My company only"], ["hidden", "Hidden"]];
  const chatOptions = [["anyone", "Anyone in my network"], ["building", "People in my building"], ["nobody", "Nobody"]];
  return `<div class="card stack">
    <h3>{{i:user}} ${esc(t("Network profile"))}</h3>
    <label class="field">${esc(t("Who can see my profile"))}<select data-draft="netp_vis">${visOptions.map(([value, label]) => `<option value="${value}" ${visibility === value ? "selected" : ""}>${esc(t(label))}</option>`).join("")}</select></label>
    <label class="field">${esc(t("Who can invite me for coffee"))}<select data-draft="netp_chat">${chatOptions.map(([value, label]) => `<option value="${value}" ${chatPref === value ? "selected" : ""}>${esc(t(label))}</option>`).join("")}</select></label>
    <label class="field">${esc(t("Headline"))}<input type="text" maxlength="80" data-draft="netp_head" value="${esc(d("netp_head", profile.headline || ""))}" placeholder="${esc(t("e.g. Backend engineer, payments"))}"></label>
    <label class="field">${esc(t("Interests (comma separated)"))}<input type="text" data-draft="netp_int" value="${esc(d("netp_int", (profile.interests || []).join(", ")))}"></label>
    <div class="row">${NET_OPEN_TO.map((key) => `<label class="check"><input type="checkbox" data-draft="netp_open_${key}" ${d("netp_open_" + key, (profile.open_to || []).includes(key)) ? "checked" : ""}> ${esc(t(NET_OPEN_LABEL[key]))}</label>`).join("")}</div>
    <button class="btn primary" data-act="netprofile">${esc(t("Save profile"))}</button>
    <div class="small muted">${esc(t("Your orders, wallet and allowance are never shared with other companies."))}</div>
  </div>`;
}

/* ------------------------------------------------------------------ tabs */

function empNetwork() {
  const s = net();
  const segs = [["feed", "Feed"], ["companies", "Companies"], ["people", "People"], ["meetups", "Meetups"], ["profile", "My profile"]];
  let main = "";
  if (S.net.seg === "feed") {
    const feed = netFilteredFeed();
    main = `${netComposer()}${netFeedFilters()}${feed.length ? feed.map(netPost).join("") : `<div class="empty">${esc(t("Nothing here yet."))}</div>`}`;
  } else if (S.net.seg === "companies") {
    main = netCompanies();
  } else if (S.net.seg === "people") {
    main = netPeople();
  } else if (S.net.seg === "meetups") {
    main = netMeetups(true);
  } else {
    main = netProfileCard();
  }
  const site = s.viewer.site || {};
  return `<div class="stack">
    <div class="row between">
      <div><h2 class="net-title">${esc(t("Network"))}</h2><div class="small muted">{{i:pin}} ${esc(site.building || "")} · ${esc(site.city || "")} · ${esc(t("{n} companies", { n: s.companies.length }))}</div></div>
      <div class="row seg">${segs.map(([key, label]) => `<button class="btn small ${S.net.seg === key ? "sel" : ""}" data-act="netseg" data-v="${key}">${esc(t(label))}</button>`).join("")}</div>
    </div>
    ${!s.enabled ? `<div class="banner warn">{{i:lock}} ${esc(t("Your company has turned off the cross-company network. You can still post to your company."))}</div>` : ""}
    <div class="split">
      <div class="stack">${main}</div>
      <div class="stack">${netChats()}${S.net.seg !== "meetups" ? netMeetups(false) : ""}${netChallenge()}${netTrending()}</div>
    </div>
  </div>`;
}

function cafeNetwork() {
  const s = net();
  const cafe = S.data.cafes[persona().id];
  const mine = s.feed.filter((post) => post.mine);
  const others = s.feed.filter((post) => !post.mine);
  return `<div class="split">
    <div class="stack">
      <div class="card stack">
        <h3>{{i:edit}} ${esc(t("Announce to companies nearby"))}</h3>
        <textarea rows="3" maxlength="500" data-draft="netcafe_text" placeholder="${esc(t("New menu item, opening hours, delivery offer…"))}">${esc(d("netcafe_text", ""))}</textarea>
        <div class="row between"><span class="small muted">${esc(t("Visible to CrewCup companies in {c}.", { c: (s.viewer.site || {}).city || "" }))}</span><button class="btn primary" data-act="netcafepost">${esc(t("Post announcement"))}</button></div>
      </div>
      ${mine.length ? `<h3>${esc(t("Your announcements"))}</h3>${mine.map(netPost).join("")}` : ""}
      <h3>${esc(t("What companies nearby are saying"))}</h3>
      ${others.length ? others.map(netPost).join("") : `<div class="empty">${esc(t("Nothing here yet."))}</div>`}
    </div>
    <div class="stack">
      <div class="card stack">
        <div class="row between"><h3 style="margin:0">{{i:calendar}} ${esc(t("Host a meetup at {c}", { c: cafe.name }))}</h3></div>
        <div class="small muted">${esc(t("Meetups bring groups from several companies at once — and fill quiet slots."))}</div>
        <button class="btn" data-act="nethost">{{i:plus}} ${esc(t("Create meetup"))}</button>
      </div>
      ${cafePromosCard()}
      ${netMeetups(false)}
      ${netTrending(cafe.id)}
      ${netChallenge()}
    </div>
  </div>`;
}

function adminNetwork() {
  const s = net();
  const admin = s.admin;
  if (!admin) {
    return `<div class="empty">${esc(t("Loading…"))}</div>`;
  }
  const settings = admin.settings;
  const vis = d("neta_vis", settings.visibility);
  const visOptions = [["network", "Listed to CrewCup companies in our cities"], ["building", "Only companies in our buildings"], ["private", "Private — not listed"]];
  return `<div class="stack">
    <div class="grid g4">
      ${kpi(t("Employee posts (7 days)"), admin.stats.posts_week)}
      ${kpi(t("Coffee chats confirmed"), admin.stats.chats_accepted)}
      ${kpi(t("Profiles visible to network"), admin.stats.profiles_network)}
      ${kpi(t("Company-only / hidden"), admin.stats.profiles_company + " / " + admin.stats.profiles_hidden)}
    </div>
    <div class="split">
      <div class="stack">
        <div class="card stack">
          <h3>{{i:flag}} ${esc(t("Moderation queue"))}</h3>
          <div class="small muted">${esc(t("You moderate posts by your own employees. Reports your employees file about other companies go to CrewCup Trust & Safety."))}</div>
          ${admin.queue.length ? admin.queue.map((item) => `<div class="report">
            <div class="row between"><span><b>${esc(item.author.name)}</b> <span class="muted small">${esc(item.author.company_name)}</span></span><span class="chip ${item.status === "open" ? "warn" : item.status === "removed" ? "bad" : "ok"}">${esc(t(item.status === "open" ? "Open" : item.status === "removed" ? "Removed" : "Kept"))}</span></div>
            <div class="small" style="margin:6px 0">${esc(item.text)}</div>
            <div class="small muted">${esc(t("Reported by {r} · {why}", { r: item.reporter.name, why: t(NET_REASON_LABEL[item.reason] || item.reason) }))}</div>
            ${item.can_moderate ? `<div class="row" style="margin-top:6px"><button class="btn small bad" data-act="netmoderate" data-post="${item.post}" data-v="remove">${esc(t("Remove post"))}</button><button class="btn small" data-act="netmoderate" data-post="${item.post}" data-v="keep">${esc(t("Keep"))}</button></div>`
              : `<div class="small muted">${esc(t("Sent to CrewCup Trust & Safety"))}</div>`}
          </div>`).join("") : `<div class="empty">${esc(t("No reports."))}</div>`}
        </div>
        <div class="card stack">
          <h3>{{i:building}} ${esc(t("Companies on the network"))}</h3>
          <table><thead><tr><th>${esc(t("Company"))}</th><th>${esc(t("Industry"))}</th><th>${esc(t("City"))}</th><th></th></tr></thead><tbody>
          ${admin.all_companies.map((company) => `<tr><td>${esc(company.name)}</td><td class="muted">${esc(company.industry)}</td><td>${esc(company.city)}</td><td style="text-align:right"><button class="btn small ${company.blocked ? "bad" : ""}" data-act="netblock" data-company="${company.id}" data-on="${company.blocked ? "0" : "1"}">${esc(t(company.blocked ? "Unblock" : "Block"))}</button></td></tr>`).join("")}
          </tbody></table>
          <div class="small muted">${esc(t("Blocking hides that company's posts, people and meetups from all your employees."))}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card stack">
          <h3>{{i:sliders}} ${esc(t("Network settings"))}</h3>
          <label class="check"><input type="checkbox" data-draft="neta_part" ${d("neta_part", settings.participation) ? "checked" : ""}> ${esc(t("Allow employees to use the cross-company network"))}</label>
          <label class="check"><input type="checkbox" data-draft="neta_stats" ${d("neta_stats", settings.share_stats) ? "checked" : ""}> ${esc(t("Share aggregate stats (cups, reusable-cup rate)"))}</label>
          <label class="field">${esc(t("Company profile visibility"))}<select data-draft="neta_vis">${visOptions.map(([value, label]) => `<option value="${value}" ${vis === value ? "selected" : ""}>${esc(t(label))}</option>`).join("")}</select></label>
          <label class="field">${esc(t("About the company"))}<textarea rows="3" maxlength="300" data-draft="neta_about">${esc(d("neta_about", settings.about))}</textarea></label>
          <button class="btn primary" data-act="netadminsave">${esc(t("Save settings"))}</button>
          <div class="small muted">${esc(t("Individual orders, spend and allowances are never shared. Employees choose their own profile visibility."))}</div>
        </div>
        ${netChallenge()}
      </div>
    </div>
  </div>`;
}

function networkTeaser() {
  const s = net();
  if (!s.enabled) {
    return "";
  }
  const pending = s.chats.filter((chat) => !chat.outgoing && chat.status === "pending").length;
  const confirmed = s.chats.filter((chat) => chat.status === "accepted" && chat.slot > S.now);
  const building = s.viewer.site ? s.viewer.site.building : null;
  const recent = s.feed.filter((post) => !post.same_company && post.building === building && S.now - post.ts < 6 * 3600).length;
  const next = s.meetups.find((meetup) => meetup.start > S.now);
  const tz = netTz();
  const bits = [];
  if (pending) {
    bits.push(t("{n} coffee-chat invitations", { n: pending }));
  }
  if (confirmed.length) {
    bits.push(t("Coffee chat with {name} {when}", { name: confirmed[0].other.name, when: dayHm(confirmed[0].slot, tz) }));
  }
  if (recent) {
    bits.push(t("{n} new posts in your building", { n: recent }));
  }
  if (next) {
    bits.push(t("Next meetup: {title}, {when}", { title: next.title, when: dayHm(next.start, tz) }));
  }
  if (!bits.length) {
    return "";
  }
  return `<div class="card row between">
    <div class="row" style="gap:10px">{{i:share}}<div><b>${esc(t("Your network"))}</b><div class="small muted">${bits.map(esc).join(" · ")}</div></div></div>
    <button class="btn small" data-act="tab" data-tab="network">${esc(t("Open Network"))}</button>
  </div>`;
}

/* ------------------------------------------------------------------ modals */

function networkModal() {
  const m = S.modal;
  const s = net();
  const tz = netTz();
  if (m.type === "net_report") {
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>{{i:flag}} ${esc(t("Report post"))}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <div class="small muted">${esc(t("The post is hidden for you right away. Repeated reports hide it for everyone until it's reviewed."))}</div>
      ${NET_REASONS.map((reason) => `<button class="btn full" data-act="netdoreport" data-post="${m.post}" data-v="${reason}">${esc(t(NET_REASON_LABEL[reason]))}</button>`).join("")}
    </div></div>`;
  }
  if (m.type === "net_chat") {
    const person = s.people.find((row) => row.key === m.to);
    const cafes = netNearbyCafes();
    const slots = netSlotOptions(tz, 3, 15);
    const cafe = d("netchat_cafe", (person && person.usual_cafe && cafes.some((row) => row.id === person.usual_cafe)) ? person.usual_cafe : cafes[0].id);
    const slot = Number(d("netchat_slot", slots[0]));
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>{{i:coffee}} ${esc(t("Invite {name} for coffee", { name: person ? person.name : "" }))}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      ${person ? `<div class="small muted">${esc(person.title)} · ${esc(person.company_name)}</div>` : ""}
      <label class="field">${esc(t("Café"))}<select data-draft="netchat_cafe">${cafes.map((row) => `<option value="${row.id}" ${row.id === cafe ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select></label>
      <label class="field">${esc(t("When"))}<select data-draft="netchat_slot">${slots.map((ts) => `<option value="${ts}" ${ts === slot ? "selected" : ""}>${esc(dayHm(ts, tz))}</option>`).join("")}</select></label>
      <label class="field">${esc(t("Note (optional)"))}<input type="text" maxlength="200" data-draft="netchat_note" value="${esc(d("netchat_note", ""))}" placeholder="${esc(t("What would you like to talk about?"))}"></label>
      <div class="small muted">${esc(t("They see your name, title and company. Nothing else is shared."))}</div>
      <button class="btn primary" data-act="netdochat" data-to="${esc(m.to)}">${esc(t("Send invitation"))}</button>
    </div></div>`;
  }
  if (m.type === "net_host") {
    const cafes = netNearbyCafes();
    const isCafe = persona().kind === "cafe";
    const slots = netSlotOptions(tz, 8, 60);
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>{{i:calendar}} ${esc(t("Host a meetup"))}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <label class="field">${esc(t("Title"))}<input type="text" maxlength="80" data-draft="nethost_title" value="${esc(d("nethost_title", ""))}" placeholder="${esc(t("e.g. Product managers breakfast"))}"></label>
      ${isCafe ? "" : `<label class="field">${esc(t("Café"))}<select data-draft="nethost_cafe">${cafes.map((row) => `<option value="${row.id}" ${d("nethost_cafe", cafes[0].id) === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select></label>`}
      <label class="field">${esc(t("When"))}<select data-draft="nethost_slot">${slots.map((ts) => `<option value="${ts}" ${Number(d("nethost_slot", slots[0])) === ts ? "selected" : ""}>${esc(dayHm(ts, tz))}</option>`).join("")}</select></label>
      <div class="grid g2">
        <label class="field">${esc(t("Capacity"))}<input type="number" min="2" max="200" data-draft="nethost_cap" value="${esc(d("nethost_cap", isCafe ? 30 : 12))}"></label>
        <label class="field">${esc(t("Max per company (0 = no limit)"))}<input type="number" min="0" max="50" data-draft="nethost_per" value="${esc(d("nethost_per", isCafe ? 0 : 4))}"></label>
      </div>
      ${isCafe ? "" : `<label class="field">${esc(t("Who can join"))}<select data-draft="nethost_aud"><option value="building">${esc(t("People in my building"))}</option><option value="network" ${d("nethost_aud", "building") === "network" ? "selected" : ""}>${esc(t("CrewCup companies in my city"))}</option></select></label>`}
      <label class="field">${esc(t("Description"))}<input type="text" maxlength="300" data-draft="nethost_desc" value="${esc(d("nethost_desc", ""))}"></label>
      <button class="btn primary" data-act="netdohost">${esc(t("Publish meetup"))}</button>
    </div></div>`;
  }
  if (m.type === "net_company") {
    const company = netCompany(m.company);
    if (!company) {
      return "";
    }
    const people = s.people.filter((person) => person.company === company.id);
    const posts = s.feed.filter((post) => post.author.company === company.id).slice(0, 3);
    return `<div class="modal-bg"><div class="modal stack" style="width:min(680px,94vw)">
      <div class="row between"><h3>{{i:building}} ${esc(company.name)}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <div class="small muted">${esc(company.industry)} · ${esc(company.headcount)} · ${company.sites.map((site) => esc(site.building + (site.floors ? " " + site.floors : ""))).join("; ")}</div>
      ${company.about ? `<div>${esc(company.about)}</div>` : ""}
      <div class="row">${company.verified ? `<span class="chip">{{i:shield}} ${esc(t("Verified domain"))} ${esc(company.verified)}</span>` : ""}<span class="chip">{{i:users}} ${esc(t("{n} followers", { n: company.followers }))}</span>${company.stats ? `<span class="chip">{{i:leaf}} ${esc(t("{p}% reusable", { p: company.stats.reusable_pct }))}</span>` : ""}</div>
      <h3>${esc(t("People open to meeting"))}</h3>
      ${people.length ? people.map(netPersonCard).join("") : `<div class="empty">${esc(t("Nobody from this company is listed."))}</div>`}
      <h3>${esc(t("Recent posts"))}</h3>
      ${posts.length ? posts.map(netPost).join("") : `<div class="empty">${esc(t("No recent posts."))}</div>`}
    </div></div>`;
  }
  return "";
}

/* ------------------------------------------------------------------ actions */

A.netseg = (ds) => {
  S.net.seg = ds.v;
  render();
};
A.netfilter = (ds) => {
  S.net.filter = ds.v;
  render();
};
A.netcomments = (ds) => {
  S.net.comments[ds.post] = !S.net.comments[ds.post];
  render();
};
A.netpost = async () => {
  const text = String(d("net_text", "")).trim();
  if (!text) {
    toast(t("Write something first"), "error");
    return;
  }
  const profile = net().me || {};
  const externalOk = net().enabled && profile.visibility === "network";
  const payload = await api("social.post", {
    emp: me().id,
    text,
    audience: d("net_aud", externalOk ? "building" : "company"),
    kind: d("net_kind", "update"),
    cafe: d("net_cafe", "") || null,
  }, { success: t("Posted") });
  if (payload.ok) {
    S.drafts.net_text = "";
    render();
  }
};
A.netcafepost = async () => {
  const text = String(d("netcafe_text", "")).trim();
  if (!text) {
    toast(t("Write something first"), "error");
    return;
  }
  const payload = await api("social.cafe_post", { cafe: persona().id, text }, { success: t("Announcement posted") });
  if (payload.ok) {
    S.drafts.netcafe_text = "";
    render();
  }
};
A.netlike = (ds) => api("social.react", { emp: me().id, post: ds.post }, { silent: false });
A.netcomment = async (ds) => {
  const key = "netc_" + ds.post;
  const text = String(d(key, "")).trim();
  if (!text) {
    return;
  }
  const payload = await api("social.comment", { emp: me().id, post: ds.post, text });
  if (payload.ok) {
    S.drafts[key] = "";
    render();
  }
};
A.netdelete = (ds) => api("social.delete", { emp: me().id, post: ds.post }, { success: t("Post deleted") });
A.nethide = (ds) => api("social.hide", { emp: me().id, post: ds.post }, { success: t("Hidden from your feed") });
A.netreport = (ds) => {
  S.modal = { type: "net_report", post: ds.post };
  render();
};
A.netdoreport = async (ds) => {
  S.modal = null;
  await api("social.report", { emp: me().id, post: ds.post, reason: ds.v }, { success: t("Thanks — the post is hidden and has been reported") });
};
A.netfollow = (ds) => api("social.follow", { emp: me().id, company: ds.company, on: ds.on === "1" });
A.netcompany = (ds) => {
  S.modal = { type: "net_company", company: ds.company };
  render();
};
A.netchat = (ds) => {
  S.modal = { type: "net_chat", to: ds.to };
  delete S.drafts.netchat_cafe;
  delete S.drafts.netchat_slot;
  render();
};
A.netdochat = async (ds) => {
  const tz = netTz();
  const slots = netSlotOptions(tz, 3, 15);
  const person = net().people.find((row) => row.key === ds.to);
  const cafes = netNearbyCafes();
  const fallbackCafe = person && person.usual_cafe && cafes.some((row) => row.id === person.usual_cafe) ? person.usual_cafe : cafes[0].id;
  const payload = await api("social.chat_request", {
    emp: me().id,
    to: ds.to,
    cafe: d("netchat_cafe", fallbackCafe),
    slot: Number(d("netchat_slot", slots[0])),
    note: d("netchat_note", ""),
  }, { success: t("Invitation sent") });
  if (payload.ok) {
    S.modal = null;
    S.drafts.netchat_note = "";
    render();
  }
};
A.netrespond = (ds) => api("social.chat_respond", { emp: me().id, chat: ds.chat, accept: ds.v === "1" }, { success: ds.v === "1" ? t("Coffee chat confirmed") : t("Declined") });
A.netcancel = (ds) => api("social.chat_cancel", { emp: me().id, chat: ds.chat }, { success: t("Cancelled") });
A.netics = (ds) => {
  const chat = net().chats.find((row) => row.id === ds.chat);
  if (!chat) {
    return;
  }
  const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const cafe = S.data.cafes[chat.cafe];
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CrewCup//Network//EN", "BEGIN:VEVENT",
    "UID:" + chat.id + "@crewcup", "DTSTAMP:" + stamp(S.now), "DTSTART:" + stamp(chat.slot), "DTEND:" + stamp(chat.slot + 1800),
    "SUMMARY:Coffee chat with " + chat.other.name, "LOCATION:" + cafe.name + ", " + cafe.area,
    "DESCRIPTION:" + (chat.note || "Arranged via CrewCup Network"), "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  link.download = "coffee-chat-" + chat.id + ".ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
};
A.netrsvp = (ds) => api("social.meetup_rsvp", { emp: me().id, meetup: ds.meetup, going: ds.v === "1" }, { success: ds.v === "1" ? t("You're on the list") : t("RSVP removed") });
A.nethost = () => {
  S.modal = { type: "net_host" };
  render();
};
A.netdohost = async () => {
  const tz = netTz();
  const slots = netSlotOptions(tz, 8, 60);
  const isCafe = persona().kind === "cafe";
  const common = {
    title: d("nethost_title", ""),
    start: Number(d("nethost_slot", slots[0])),
    capacity: Number(d("nethost_cap", isCafe ? 30 : 12)),
    max_per_company: Number(d("nethost_per", isCafe ? 0 : 4)),
    description: d("nethost_desc", ""),
  };
  const payload = isCafe
    ? await api("social.cafe_meetup", Object.assign({ cafe: persona().id }, common), { success: t("Meetup published") })
    : await api("social.meetup_create", Object.assign({ emp: me().id, cafe: d("nethost_cafe", netNearbyCafes()[0].id), audience: d("nethost_aud", "building") }, common), { success: t("Meetup published") });
  if (payload.ok) {
    S.modal = null;
    ["nethost_title", "nethost_desc"].forEach((key) => delete S.drafts[key]);
    render();
  }
};
A.netprofile = () => {
  const profile = net().me || {};
  const openTo = NET_OPEN_TO.filter((key) => d("netp_open_" + key, (profile.open_to || []).includes(key)));
  return api("social.profile", {
    emp: me().id,
    fields: {
      visibility: d("netp_vis", profile.visibility),
      chat_pref: d("netp_chat", profile.chat_pref),
      headline: d("netp_head", profile.headline || ""),
      interests: d("netp_int", (profile.interests || []).join(", ")),
      open_to: openTo,
    },
  }, { success: t("Network profile saved") });
};
A.netreusable = () => api("profile.update", { emp: me().id, fields: { reusable: true } }, { success: t("Reusable cup set as your default") });
A.netadminsave = () => {
  const settings = net().admin.settings;
  return api("social.company_settings", {
    fields: {
      participation: d("neta_part", settings.participation),
      share_stats: d("neta_stats", settings.share_stats),
      visibility: d("neta_vis", settings.visibility),
      about: d("neta_about", settings.about),
    },
  }, { success: t("Network settings saved") });
};
A.netblock = (ds) => api("social.block", { company: ds.company, on: ds.on === "1" }, { success: ds.on === "1" ? t("Company blocked") : t("Company unblocked") });
A.netmoderate = (ds) => api("social.moderate", { post: ds.post, decision: ds.v }, { success: ds.v === "remove" ? t("Post removed") : t("Post kept") });
