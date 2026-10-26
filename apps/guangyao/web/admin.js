/* Admin console: publishes lessons, materials, events and settings to the content repository.
 * Authorisation is enforced by GitHub: only collaborators with write access can commit.
 * The token stays in this browser (session storage unless "remember" is chosen). */
'use strict';

(function () {
  const {CONFIG} = window.GY_CATALOG;
  const API = 'https://api.github.com';
  const TOKEN_KEY = 'guangyao-admin-token';
  const REPO_PATH = `/repos/${CONFIG.owner}/${CONFIG.repo}`;
  const app = document.getElementById('app');
  const who = document.getElementById('who');

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const newId = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const formatBytes = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const formatDate = iso => iso ? new Date(iso).toLocaleString('zh-TW', {year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';

  let token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
  let user = null;
  let catalog = null;
  let tab = 'overview';
  let editing = null;
  let busy = false;
  let notice = null;

  /* ---------------------------------------------------------------- *
   * GitHub REST helpers
   * ---------------------------------------------------------------- */
  async function api(path, {method = 'GET', body} = {}) {
    const response = await fetch(`${API}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? {'Content-Type': 'application/json'} : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((data && data.message) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function explain(error) {
    if (error.status === 401) return '權杖無效或已過期，請重新登入。';
    if (error.status === 403) return '這個權杖沒有寫入內容庫的權限（請確認權杖範圍，或請擁有者把你加為協作者）。';
    if (error.status === 404) return '找不到內容庫，或這個帳號沒有存取權限。';
    if (error.status === 409 || error.status === 422) return '內容剛被其他管理員更新，請重新整理後再試。';
    return `GitHub 回應錯誤：${error.message}`;
  }

  const utf8ToBase64 = text => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  };
  const base64ToUtf8 = encoded => new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/\s/g, '')), character => character.charCodeAt(0)));
  const fileToBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsDataURL(file);
  });

  async function readCatalog() {
    const data = await api(`${REPO_PATH}/contents/${CONFIG.catalogPath}?ref=${CONFIG.branch}`);
    return {sha: data.sha, catalog: window.GY_CATALOG.sanitize(JSON.parse(base64ToUtf8(data.content)))};
  }

  /* Read-modify-write with retries so two admins never overwrite each other's changes. */
  async function saveCatalog(mutate, message) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const {sha, catalog: latest} = await readCatalog();
      const draft = JSON.parse(JSON.stringify(latest));
      mutate(draft);
      draft.updatedAt = new Date().toISOString();
      const clean = window.GY_CATALOG.sanitize(draft);
      try {
        const result = await api(`${REPO_PATH}/contents/${CONFIG.catalogPath}`, {
          method: 'PUT',
          body: {message: `${message} (by ${user.login})`, content: utf8ToBase64(`${JSON.stringify(clean, null, 2)}\n`), sha, branch: CONFIG.branch}
        });
        catalog = clean;
        return result.commit.sha;
      } catch (error) {
        if ((error.status === 409 || error.status === 422) && attempt < 2) continue;
        throw error;
      }
    }
    return '';
  }

  const safeName = name => {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
    const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
    return extension ? `${base}.${extension}` : base;
  };

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */
  function setNotice(kind, text) {
    notice = text ? {kind, text} : null;
    render();
  }
  function noticeHtml() {
    return notice ? `<div class="notice ${notice.kind}" role="${notice.kind === 'error' ? 'alert' : 'status'}">${esc(notice.text)}</div>` : '';
  }
  const status = item => item.status === 'draft' ? '<span class="tag draft">草稿</span>' : '<span class="tag">已發布</span>';

  function loginView() {
    const ownerLink = 'https://github.com/settings/personal-access-tokens/new';
    const classicLink = `https://github.com/settings/tokens/new?scopes=public_repo&description=${encodeURIComponent('光耀同行管理員後台')}`;
    return `<section class="login">
      <h1>管理員登入</h1>
      <p class="lead">管理員可以上傳講義、建立課程單元與練習題、發布活動公告。發布後約 5 分鐘內出現在所有學員的 App。</p>
      ${noticeHtml()}
      <form class="card" id="login-form">
        <label class="field"><span>GitHub 存取權杖</span><input type="password" name="token" autocomplete="off" required placeholder="github_pat_… 或 ghp_…" spellcheck="false"><small>權杖只存在這個瀏覽器，用來代表你把內容寫入內容庫；不會傳給光耀同行或其他伺服器。</small></label>
        <label class="check"><input type="checkbox" name="remember"> 記住這台裝置（共用電腦請勿勾選）</label>
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>${busy ? '驗證中…' : '登入後台'}</button>
      </form>
      <details class="help" open>
        <summary>第一次使用？如何取得權杖（約 3 分鐘）</summary>
        <p style="margin:10px 0 4px"><strong>內容庫擁有者（${esc(CONFIG.owner)}）</strong>：建立只限這個內容庫的權杖。</p>
        <ol class="steps">
          <li>開啟 <a href="${ownerLink}" target="_blank" rel="noopener noreferrer">建立 Fine-grained 權杖</a>。</li>
          <li>Token name 填「光耀同行後台」，Expiration 建議 90 天。</li>
          <li>Repository access 選 <em>Only select repositories</em> → <code>${esc(CONFIG.repo)}</code>。</li>
          <li>Permissions → Repository permissions → <em>Contents</em> 設為 <strong>Read and write</strong>。</li>
          <li>按 Generate token，複製後貼到上方。</li>
        </ol>
        <p style="margin:12px 0 4px"><strong>其他管理員</strong>：</p>
        <ol class="steps">
          <li>請擁有者到 <a href="https://github.com/${esc(CONFIG.owner)}/${esc(CONFIG.repo)}/settings/access" target="_blank" rel="noopener noreferrer">內容庫設定 → Collaborators</a> 邀請你的 GitHub 帳號，並接受邀請。</li>
          <li>開啟 <a href="${classicLink}" target="_blank" rel="noopener noreferrer">建立 Classic 權杖</a>（已預先勾選 <code>public_repo</code>），設定期限後產生並貼到上方。<br><small class="muted">GitHub 目前不允許 Fine-grained 權杖寫入他人擁有的個人內容庫，所以協作者需要 Classic 權杖。</small></li>
        </ol>
        <p style="font-size:12px;color:var(--muted)">移除管理員：擁有者在 Collaborators 移除該帳號即可，權杖會立刻失去寫入權限。所有變更都記錄在 <a href="${window.GY_CATALOG.historyUrl()}" target="_blank" rel="noopener noreferrer">內容庫歷史</a>。</p>
      </details>
    </section>`;
  }

  function overviewTab() {
    const count = (list, state) => list.filter(item => item.status === state).length;
    return `<div class="stats">
      <div class="stat"><strong>${count(catalog.lessons, 'published')}</strong><span>已發布課程單元</span></div>
      <div class="stat"><strong>${count(catalog.materials, 'published')}</strong><span>已發布講義與資源</span></div>
      <div class="stat"><strong>${count(catalog.events, 'published')}</strong><span>活動公告</span></div>
      <div class="stat"><strong>${catalog.lessons.length + catalog.materials.length + catalog.events.length - count(catalog.lessons, 'published') - count(catalog.materials, 'published') - count(catalog.events, 'published')}</strong><span>草稿</span></div>
    </div>
    <div class="grid"><section class="card"><h2>快速開始</h2>
      <ol class="steps">
        <li><strong>上傳講義</strong>：到「教材檔案」選擇 PDF、圖片或音檔（每個 20 MB 以內），填寫標題與重點說明。</li>
        <li><strong>建立課程單元</strong>：到「課程單元」輸入課文、練習題與閃卡，可附上講義與 YouTube 影片。</li>
        <li><strong>發布活動</strong>：到「活動公告」填寫日期、地點與報名連結。</li>
        <li>按「在學員 App 查看」確認畫面。學員端約 5 分鐘內自動更新。</li>
      </ol>
      <div class="actions"><button class="btn" data-tab="materials">上傳講義</button><button class="btn secondary" data-tab="lessons">建立課程單元</button><a class="btn secondary" href="index.html#library" target="_blank" rel="noopener">在學員 App 查看</a></div>
    </section>
    <aside class="card"><h2>注意事項</h2>
      <ul class="steps" style="padding-left:18px">
        <li>內容庫是<strong>公開</strong>的：不要上傳個人資料、名冊或未經授權的教材。</li>
        <li>影片請先上傳到 YouTube（可設為不公開），再把連結貼到課程單元或「新增連結」。</li>
        <li>「重點說明」會提供給 AI 學伴參考，寫得越清楚，回答越準確。</li>
        <li>每一次發布都有版本紀錄：<a href="${window.GY_CATALOG.historyUrl()}" target="_blank" rel="noopener noreferrer">查看變更歷史</a>。</li>
      </ul>
      <p style="font-size:12px;color:var(--muted)">最後更新：${esc(formatDate(catalog.updatedAt) || '尚未發布')}</p>
    </aside></div>`;
  }

  function materialsTab() {
    const current = editing && editing.type === 'material' ? catalog.materials.find(item => item.id === editing.id) : null;
    const list = catalog.materials.map(item => `<div class="item"><div><h3>${esc(item.title)} ${status(item)}</h3><p>${item.kind === 'file' ? `${esc(item.filename)} · ${formatBytes(item.size)}` : esc(item.url)}</p>${item.description ? `<p>${esc(item.description)}</p>` : ''}<p>${esc(formatDate(item.publishedAt))}${item.author ? ` · ${esc(item.author)}` : ''}</p></div><div class="actions"><a class="btn secondary small" href="${esc(window.GY_CATALOG.fileUrl(item))}" target="_blank" rel="noopener noreferrer">開啟</a><button class="btn secondary small" data-edit-material="${esc(item.id)}">編輯</button><button class="btn secondary small" data-toggle="materials" data-id="${esc(item.id)}">${item.status === 'draft' ? '發布' : '改為草稿'}</button><button class="btn danger small" data-delete="materials" data-id="${esc(item.id)}">刪除</button></div></div>`).join('') || '<p class="empty">還沒有教材。先上傳第一份講義吧。</p>';
    const metaFields = item => `<label class="field"><span>標題</span><input type="text" name="title" maxlength="80" required value="${esc(item?.title || '')}"></label>
      <label class="field"><span>簡介（學員會看到）</span><textarea name="description" maxlength="400" rows="2">${esc(item?.description || '')}</textarea></label>
      <label class="field"><span>重點說明（提供給 AI 學伴，選填）</span><textarea name="notes" maxlength="4000" rows="4" placeholder="用幾段文字寫下這份教材的重點、名詞解釋或常見問題。">${esc(item?.notes || '')}</textarea><small>AI 學伴無法讀取 PDF 內文，會根據這裡的文字回答並標註出處。</small></label>
      <label class="check"><input type="checkbox" name="draft" ${item?.status === 'draft' ? 'checked' : ''}> 先存成草稿（學員看不到）</label>`;
    const editor = current ? `<form class="card" id="material-edit-form"><h2>編輯教材資訊</h2>${metaFields(current)}<div class="actions"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>儲存</button><button class="btn secondary" type="button" data-cancel>取消</button></div></form>` : `
      <form class="card" id="upload-form"><h2>上傳講義或檔案</h2>
        <label class="field"><span>選擇檔案</span><input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.txt,.md,.docx,.pptx,.xlsx"><small>PDF、圖片、音檔或文件，每個檔案 20 MB 以內。</small></label>
        ${metaFields(null)}
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>${busy ? '上傳中…' : '上傳並發布'}</button>
        <div class="progress ${busy ? '' : 'hidden'}" aria-hidden="true"><i id="upload-progress"></i></div>
      </form>
      <form class="card" id="link-form"><h2>新增影片或連結</h2>
        <label class="field"><span>類型</span><select name="kind"><option value="video">影片（YouTube 等）</option><option value="link">網頁連結</option></select></label>
        <label class="field"><span>網址（https://）</span><input type="url" name="url" required placeholder="https://www.youtube.com/watch?v=…"></label>
        ${metaFields(null)}
        <button class="btn" type="submit" ${busy ? 'disabled' : ''}>新增</button>
      </form>`;
    return `<div class="grid"><section class="card"><h2>教材清單</h2>${list}</section><div class="stack">${editor}</div></div>`;
  }

  function lessonForm(lesson) {
    const quiz = lesson?.quiz?.length ? lesson.quiz : [null];
    const quizBlocks = quiz.map((item, index) => `<div class="quiz-block" data-quiz="${index}"><label class="field"><span>第 ${index + 1} 題　題目</span><input type="text" name="q-${index}" maxlength="200" value="${esc(item?.question || '')}" placeholder="例如：朋友分享心事時，最尊重的做法是？"></label><label class="field"><span>選項（每行一個，2–4 個）</span><textarea name="o-${index}" rows="3" placeholder="先聽完，再回應&#10;立刻給建議&#10;一邊滑手機一邊聽">${esc((item?.options || []).join('\n'))}</textarea></label><div class="row"><label class="field"><span>正確答案是第幾個選項</span><input type="number" name="a-${index}" min="1" max="4" value="${item ? item.answer + 1 : 1}"></label><label class="field"><span>解說（答完後顯示）</span><input type="text" name="e-${index}" maxlength="300" value="${esc(item?.explain || '')}"></label></div></div>`).join('');
    const materials = catalog.materials.map(item => `<label class="check"><input type="checkbox" name="materials" value="${esc(item.id)}" ${lesson?.materials?.includes(item.id) ? 'checked' : ''}> ${esc(item.title)} ${item.status === 'draft' ? '（草稿）' : ''}</label>`).join('') || '<p class="empty" style="padding:8px">還沒有教材可以附加。</p>';
    return `<form class="card" id="lesson-form" data-id="${esc(lesson?.id || '')}"><h2>${lesson ? '編輯課程單元' : '建立課程單元'}</h2>
      <label class="field"><span>單元標題</span><input type="text" name="title" maxlength="60" required value="${esc(lesson?.title || '')}"></label>
      <label class="field"><span>一句話摘要</span><input type="text" name="summary" maxlength="300" value="${esc(lesson?.summary || '')}"></label>
      <label class="field"><span>課文（段落之間空一行）</span><textarea name="reading" rows="8" required maxlength="9000">${esc((lesson?.reading || []).join('\n\n'))}</textarea><small>學員可以朗讀課文；AI 學伴也會引用這些段落。</small></label>
      <label class="field"><span>YouTube 影片網址（選填）</span><input type="url" name="video" value="${esc(lesson?.video || '')}" placeholder="https://youtu.be/…"></label>
      <h2 style="margin-top:20px">練習題（選填）</h2><div id="quiz-blocks">${quizBlocks}</div>
      <button class="btn secondary small" type="button" id="add-question" ${quiz.length >= 5 ? 'disabled' : ''}>＋ 新增一題</button>
      <label class="field" style="margin-top:16px"><span>反思題（選填）</span><input type="text" name="reflect" maxlength="200" value="${esc(lesson?.reflect || '')}" placeholder="這一課，你最想實踐的一件事是什麼？"></label>
      <label class="field"><span>閃卡（每行一張：問題 | 答案，選填）</span><textarea name="cards" rows="4" placeholder="傾聽的第一步是？ | 先聽完，再回應">${esc((lesson?.cards || []).map(card => card.join(' | ')).join('\n'))}</textarea><small>沒填的話，會用練習題自動產生閃卡。</small></label>
      <fieldset class="field" style="border:0;padding:0"><span>附加教材</span>${materials}</fieldset>
      <div class="row"><label class="field"><span>排序（數字小的在前）</span><input type="number" name="order" min="0" max="9999" value="${lesson?.order ?? 0}"></label></div>
      <label class="check"><input type="checkbox" name="draft" ${lesson?.status === 'draft' ? 'checked' : ''}> 先存成草稿（學員看不到）</label>
      <div class="actions"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${busy ? '儲存中…' : lesson ? '儲存變更' : '發布單元'}</button>${lesson ? '<button class="btn secondary" type="button" data-cancel>取消編輯</button>' : ''}</div>
    </form>`;
  }

  function lessonsTab() {
    const current = editing && editing.type === 'lesson' ? catalog.lessons.find(item => item.id === editing.id) : null;
    const list = catalog.lessons.slice().sort((a, b) => a.order - b.order).map(item => `<div class="item"><div><h3>${esc(item.title)} ${status(item)}</h3><p>${esc(item.summary || item.reading[0].slice(0, 60))}</p><p>${item.quiz.length} 題 · ${item.cards.length || item.quiz.length} 張閃卡${item.video ? ' · 影片' : ''}${item.materials.length ? ` · ${item.materials.length} 份附件` : ''} · 排序 ${item.order}</p></div><div class="actions"><button class="btn secondary small" data-edit-lesson="${esc(item.id)}">編輯</button><button class="btn secondary small" data-toggle="lessons" data-id="${esc(item.id)}">${item.status === 'draft' ? '發布' : '改為草稿'}</button><button class="btn danger small" data-delete="lessons" data-id="${esc(item.id)}">刪除</button></div></div>`).join('') || '<p class="empty">還沒有課程單元。</p>';
    return `<div class="grid"><div class="stack">${lessonForm(current)}</div><section class="card"><h2>課程單元</h2>${list}</section></div>`;
  }

  function eventsTab() {
    const current = editing && editing.type === 'event' ? catalog.events.find(item => item.id === editing.id) : null;
    const types = [['online', '線上'], ['offline', '實體'], ['social', '社群活動']];
    const list = catalog.events.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(item => `<div class="item"><div><h3>${esc(item.title)} ${status(item)}</h3><p>${esc(item.date)} ${esc(item.time)} · ${esc(types.find(type => type[0] === item.type)?.[1] || '')} · ${esc(item.place || '地點待公布')}</p></div><div class="actions"><button class="btn secondary small" data-edit-event="${esc(item.id)}">編輯</button><button class="btn danger small" data-delete="events" data-id="${esc(item.id)}">刪除</button></div></div>`).join('') || '<p class="empty">還沒有活動公告。</p>';
    return `<div class="grid"><form class="card" id="event-form" data-id="${esc(current?.id || '')}"><h2>${current ? '編輯活動' : '發布活動'}</h2>
      <label class="field"><span>活動名稱</span><input type="text" name="title" maxlength="60" required value="${esc(current?.title || '')}"></label>
      <div class="row"><label class="field"><span>日期</span><input type="date" name="date" required value="${esc(current?.date || '')}"></label><label class="field"><span>開始時間</span><input type="time" name="time" required value="${esc(current?.time || '19:30')}"></label><label class="field"><span>長度</span><input type="text" name="duration" maxlength="20" value="${esc(current?.duration || '60 分鐘')}"></label></div>
      <div class="row"><label class="field"><span>類型</span><select name="type">${types.map(([value, label]) => `<option value="${value}" ${current?.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>老師／主持人</span><input type="text" name="teacher" maxlength="30" value="${esc(current?.teacher || '')}"></label></div>
      <label class="field"><span>地點或線上連結說明</span><input type="text" name="place" maxlength="100" value="${esc(current?.place || '')}"></label>
      <label class="field"><span>活動說明</span><textarea name="description" maxlength="1000" rows="4">${esc(current?.description || '')}</textarea></label>
      <label class="field"><span>報名連結（https://，例如 Google 表單，選填）</span><input type="url" name="signupUrl" value="${esc(current?.signupUrl || '')}"></label>
      <label class="check"><input type="checkbox" name="draft" ${current?.status === 'draft' ? 'checked' : ''}> 先存成草稿</label>
      <div class="actions"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>${current ? '儲存變更' : '發布活動'}</button>${current ? '<button class="btn secondary" type="button" data-cancel>取消編輯</button>' : ''}</div>
    </form><section class="card"><h2>活動公告</h2>${list}</section></div>`;
  }

  function settingsTab() {
    return `<div class="grid"><form class="card" id="settings-form"><h2>學員 App 設定</h2>
      <label class="field"><span>首頁公告（選填）</span><input type="text" name="announcement" maxlength="200" value="${esc(catalog.settings.announcement)}" placeholder="例如：11 月共學活動開放報名中！"></label>
      <label class="check"><input type="checkbox" name="hideSamples" ${catalog.settings.hideSamples ? 'checked' : ''}> 隱藏示範活動（有正式活動後建議勾選）</label>
      <button class="btn" type="submit" ${busy ? 'disabled' : ''}>儲存設定</button>
    </form>
    <section class="card"><h2>管理員名單</h2><p style="font-size:13px">管理員就是內容庫的協作者。新增或移除管理員：</p><ol class="steps"><li>開啟 <a href="https://github.com/${esc(CONFIG.owner)}/${esc(CONFIG.repo)}/settings/access" target="_blank" rel="noopener noreferrer">內容庫 → Settings → Collaborators</a>（需要擁有者帳號）。</li><li>按 Add people 輸入對方的 GitHub 帳號；移除則按 Remove。</li><li>新管理員依「管理員登入」頁的說明建立權杖。</li></ol><p style="font-size:12px;color:var(--muted)">所有變更都會記錄是誰、何時、改了什麼：<a href="${window.GY_CATALOG.historyUrl()}" target="_blank" rel="noopener noreferrer">變更歷史</a>。</p></section></div>`;
  }

  function dashboard() {
    const tabs = [['overview', '總覽'], ['materials', '教材檔案'], ['lessons', '課程單元'], ['events', '活動公告'], ['settings', '設定']];
    const body = {overview: overviewTab, materials: materialsTab, lessons: lessonsTab, events: eventsTab, settings: settingsTab}[tab]();
    return `<h1>管理員後台</h1><p class="lead">內容庫：<a href="https://github.com/${esc(CONFIG.owner)}/${esc(CONFIG.repo)}" target="_blank" rel="noopener noreferrer">${esc(CONFIG.owner)}/${esc(CONFIG.repo)}</a> · 發布後約 5 分鐘內出現在學員 App。</p>
      ${noticeHtml()}
      <nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`).join('')}</nav>${body}`;
  }

  function render() {
    who.innerHTML = user
      ? `<span>已登入 <strong>@${esc(user.login)}</strong></span><a class="btn secondary small" href="index.html#library" target="_blank" rel="noopener">學員 App</a><button class="btn secondary small" id="logout">登出</button>`
      : '<a href="index.html">回到學員 App →</a>';
    app.innerHTML = user && catalog ? dashboard() : loginView();
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */
  const quizBlockHtml = index => `<div class="quiz-block" data-quiz="${index}"><label class="field"><span>第 ${index + 1} 題　題目</span><input type="text" name="q-${index}" maxlength="200"></label><label class="field"><span>選項（每行一個，2–4 個）</span><textarea name="o-${index}" rows="3"></textarea></label><div class="row"><label class="field"><span>正確答案是第幾個選項</span><input type="number" name="a-${index}" min="1" max="4" value="1"></label><label class="field"><span>解說（答完後顯示）</span><input type="text" name="e-${index}" maxlength="300"></label></div></div>`;

  async function login(candidate, remember) {
    busy = true;
    notice = null;
    render();
    token = candidate.trim();
    try {
      const account = await api('/user');
      const repo = await api(REPO_PATH);
      if (!repo.permissions || !repo.permissions.push) {
        throw Object.assign(new Error('no push'), {status: 403});
      }
      user = {login: account.login, name: account.name || account.login};
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
      (remember ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
      catalog = (await readCatalog()).catalog;
      notice = {kind: 'ok', text: `歡迎，${user.name}。你可以開始發布教材了。`};
    } catch (error) {
      user = null;
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      notice = {kind: 'error', text: error.status === 403 ? '這個帳號沒有內容庫的寫入權限。請請擁有者把你加為協作者，或確認權杖的權限設定。' : explain(error)};
    } finally {
      busy = false;
      render();
    }
  }
  function logout() {
    token = '';
    user = null;
    catalog = null;
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    notice = {kind: 'info', text: '已登出，權杖已從這個瀏覽器移除。'};
    render();
  }

  // Re-rendering replaces the forms, so keep what the admin typed when a save
  // is in progress or fails validation (file inputs cannot be restored).
  function captureForms() {
    return Array.from(app.querySelectorAll('form[id]')).map(form => ({
      id: form.id,
      questions: form.querySelectorAll('[data-quiz]').length,
      fields: Array.from(form.elements)
        .filter(field => field.name && field.type !== 'file')
        .map(field => ({name: field.name, value: field.value, checked: field.checked, checkable: field.type === 'checkbox' || field.type === 'radio'}))
    }));
  }

  function restoreForms(snapshot) {
    snapshot.forEach(saved => {
      const form = document.getElementById(saved.id);
      if (!form) return;
      const blocks = form.querySelector('#quiz-blocks');
      while (blocks && blocks.querySelectorAll('[data-quiz]').length < Math.min(saved.questions, 5)) {
        blocks.insertAdjacentHTML('beforeend', quizBlockHtml(blocks.querySelectorAll('[data-quiz]').length));
      }
      saved.fields.forEach(entry => {
        const matches = Array.from(form.elements).filter(field => field.name === entry.name);
        const field = entry.checkable ? matches.find(candidate => candidate.value === entry.value) : matches[0];
        if (!field) return;
        if (entry.checkable) field.checked = entry.checked;
        else field.value = entry.value;
      });
    });
  }

  async function run(task, success) {
    if (busy) return;
    const snapshot = captureForms();
    busy = true;
    notice = null;
    render();
    restoreForms(snapshot);
    let failed = false;
    try {
      await task();
      notice = {kind: 'ok', text: success};
      editing = null;
    } catch (error) {
      failed = true;
      notice = {kind: 'error', text: error.userMessage || explain(error)};
    } finally {
      busy = false;
      render();
      if (failed) restoreForms(snapshot);
      window.scrollTo({top: 0, behavior: 'smooth'});
    }
  }

  const formValue = (form, name) => String(new FormData(form).get(name) || '').trim();
  const metaFrom = form => ({
    title: formValue(form, 'title'),
    description: formValue(form, 'description'),
    notes: formValue(form, 'notes'),
    status: form.elements.draft?.checked ? 'draft' : 'published'
  });
  const stamp = item => ({...item, author: user.login, updatedAt: new Date().toISOString(), publishedAt: item.publishedAt || new Date().toISOString()});

  async function uploadMaterial(form) {
    const file = form.elements.file.files[0];
    if (!file) throw Object.assign(new Error('no file'), {userMessage: '請先選擇檔案。'});
    if (file.size > CONFIG.maxFileBytes) throw Object.assign(new Error('too big'), {userMessage: `檔案太大（${formatBytes(file.size)}）。請壓縮到 20 MB 以內，或把影片放 YouTube 再新增連結。`});
    const meta = metaFrom(form);
    const now = new Date();
    const path = `files/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${Date.now().toString(36)}-${safeName(file.name)}`;
    document.getElementById('upload-progress')?.style.setProperty('width', '35%');
    const content = await fileToBase64(file);
    document.getElementById('upload-progress')?.style.setProperty('width', '60%');
    const result = await api(`${REPO_PATH}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      body: {message: `Upload ${file.name} (by ${user.login})`, content, branch: CONFIG.branch}
    });
    document.getElementById('upload-progress')?.style.setProperty('width', '85%');
    const material = stamp({id: newId('m'), kind: 'file', path, commit: result.commit.sha, size: file.size, mime: file.type || 'application/octet-stream', filename: file.name.slice(0, 120), ...meta});
    await saveCatalog(draft => draft.materials.unshift(material), `Publish material: ${meta.title}`);
  }

  async function addLink(form) {
    const url = window.GY_CATALOG.httpsUrl(formValue(form, 'url'));
    if (!url) throw Object.assign(new Error('bad url'), {userMessage: '請輸入以 https:// 開頭的網址。'});
    const meta = metaFrom(form);
    const material = stamp({id: newId('m'), kind: formValue(form, 'kind') === 'link' ? 'link' : 'video', url, ...meta});
    await saveCatalog(draft => draft.materials.unshift(material), `Publish link: ${meta.title}`);
  }

  async function editMaterial(form) {
    const meta = metaFrom(form);
    await saveCatalog(draft => {
      const item = draft.materials.find(entry => entry.id === editing.id);
      if (item) Object.assign(item, meta, {updatedAt: new Date().toISOString(), author: user.login});
    }, `Update material: ${meta.title}`);
  }

  function lessonFromForm(form) {
    const reading = formValue(form, 'reading').split(/\n\s*\n/).map(paragraph => paragraph.replace(/\s*\n\s*/g, '').trim()).filter(Boolean);
    const quiz = [];
    form.querySelectorAll('[data-quiz]').forEach(block => {
      const index = block.dataset.quiz;
      const question = formValue(form, `q-${index}`);
      const options = formValue(form, `o-${index}`).split('\n').map(option => option.trim()).filter(Boolean);
      if (!question && !options.length) return;
      const answer = Number(formValue(form, `a-${index}`)) - 1;
      if (!question || options.length < 2 || options.length > 4 || !(answer >= 0 && answer < options.length)) {
        throw Object.assign(new Error('bad quiz'), {userMessage: `第 ${Number(index) + 1} 題需要題目、2–4 個選項，以及正確答案的編號。`});
      }
      quiz.push({question, options, answer, explain: formValue(form, `e-${index}`)});
    });
    const cards = formValue(form, 'cards').split('\n').map(line => line.split('|').map(part => part.trim())).filter(parts => parts.length >= 2 && parts[0] && parts[1]).map(parts => [parts[0], parts.slice(1).join(' | ')]);
    const video = formValue(form, 'video');
    if (video && !window.GY_CATALOG.youtubeId(video)) throw Object.assign(new Error('bad video'), {userMessage: '目前只支援 YouTube 影片網址。其他影片請到「教材檔案」新增連結。'});
    if (!reading.length) throw Object.assign(new Error('no reading'), {userMessage: '請輸入課文。'});
    return {
      title: formValue(form, 'title'),
      summary: formValue(form, 'summary'),
      reading,
      video,
      quiz,
      reflect: formValue(form, 'reflect'),
      cards,
      materials: new FormData(form).getAll('materials').map(String),
      order: Math.max(0, Math.min(9999, Number(formValue(form, 'order')) || 0)),
      status: form.elements.draft.checked ? 'draft' : 'published'
    };
  }
  async function saveLesson(form) {
    const fields = lessonFromForm(form);
    const id = form.dataset.id;
    await saveCatalog(draft => {
      const existing = id && draft.lessons.find(item => item.id === id);
      if (existing) Object.assign(existing, fields, {updatedAt: new Date().toISOString(), author: user.login});
      else draft.lessons.push(stamp({id: newId('l'), ...fields}));
    }, `${id ? 'Update' : 'Publish'} lesson: ${fields.title}`);
  }

  async function saveEvent(form) {
    const id = form.dataset.id;
    const signupUrl = formValue(form, 'signupUrl');
    if (signupUrl && !window.GY_CATALOG.httpsUrl(signupUrl)) throw Object.assign(new Error('bad url'), {userMessage: '報名連結需要以 https:// 開頭。'});
    const fields = {
      title: formValue(form, 'title'),
      date: formValue(form, 'date'),
      time: formValue(form, 'time'),
      duration: formValue(form, 'duration'),
      type: formValue(form, 'type'),
      teacher: formValue(form, 'teacher'),
      place: formValue(form, 'place'),
      description: formValue(form, 'description'),
      signupUrl,
      status: form.elements.draft.checked ? 'draft' : 'published'
    };
    await saveCatalog(draft => {
      const existing = id && draft.events.find(item => item.id === id);
      if (existing) Object.assign(existing, fields);
      else draft.events.push({id: newId('e'), ...fields, publishedAt: new Date().toISOString()});
    }, `${id ? 'Update' : 'Publish'} event: ${fields.title}`);
  }

  async function deleteItem(collection, id) {
    const item = catalog[collection].find(entry => entry.id === id);
    if (!item) return;
    if (collection === 'materials' && item.kind === 'file') {
      try {
        const file = await api(`${REPO_PATH}/contents/${item.path.split('/').map(encodeURIComponent).join('/')}?ref=${CONFIG.branch}`);
        await api(`${REPO_PATH}/contents/${item.path.split('/').map(encodeURIComponent).join('/')}`, {method: 'DELETE', body: {message: `Delete ${item.filename} (by ${user.login})`, sha: file.sha, branch: CONFIG.branch}});
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    await saveCatalog(draft => {
      draft[collection] = draft[collection].filter(entry => entry.id !== id);
      if (collection === 'materials') draft.lessons.forEach(lesson => { lesson.materials = lesson.materials.filter(materialId => materialId !== id); });
    }, `Delete ${collection.slice(0, -1)}: ${item.title}`);
  }

  async function toggleStatus(collection, id) {
    await saveCatalog(draft => {
      const item = draft[collection].find(entry => entry.id === id);
      if (item) item.status = item.status === 'draft' ? 'published' : 'draft';
    }, `Toggle visibility: ${id}`);
  }

  async function saveSettings(form) {
    await saveCatalog(draft => {
      draft.settings.announcement = formValue(form, 'announcement');
      draft.settings.hideSamples = form.elements.hideSamples.checked;
    }, 'Update app settings');
  }

  document.addEventListener('submit', event => {
    const form = event.target;
    event.preventDefault();
    if (form.id === 'login-form') login(formValue(form, 'token'), form.elements.remember.checked);
    else if (form.id === 'upload-form') run(() => uploadMaterial(form), '教材已上傳並發布。學員 App 約 5 分鐘內更新。');
    else if (form.id === 'link-form') run(() => addLink(form), '連結已新增。');
    else if (form.id === 'material-edit-form') run(() => editMaterial(form), '教材資訊已更新。');
    else if (form.id === 'lesson-form') run(() => saveLesson(form), form.dataset.id ? '課程單元已更新。' : '課程單元已發布。學員 App 約 5 分鐘內更新。');
    else if (form.id === 'event-form') run(() => saveEvent(form), '活動已儲存。');
    else if (form.id === 'settings-form') run(() => saveSettings(form), '設定已儲存。');
  });

  document.addEventListener('click', event => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target.id === 'logout') {
      logout();
    } else if (target.dataset.tab) {
      tab = target.dataset.tab;
      editing = null;
      notice = null;
      render();
    } else if (target.dataset.editMaterial) {
      editing = {type: 'material', id: target.dataset.editMaterial};
      render();
    } else if (target.dataset.editLesson) {
      editing = {type: 'lesson', id: target.dataset.editLesson};
      render();
      window.scrollTo({top: 0, behavior: 'smooth'});
    } else if (target.dataset.editEvent) {
      editing = {type: 'event', id: target.dataset.editEvent};
      render();
    } else if (target.hasAttribute('data-cancel')) {
      editing = null;
      render();
    } else if (target.dataset.toggle) {
      run(() => toggleStatus(target.dataset.toggle, target.dataset.id), '已更新顯示狀態。');
    } else if (target.dataset.delete) {
      const item = catalog[target.dataset.delete].find(entry => entry.id === target.dataset.id);
      if (item && window.confirm(`確定要刪除「${item.title}」嗎？學員將看不到它（變更歷史仍會保留）。`)) {
        run(() => deleteItem(target.dataset.delete, target.dataset.id), '已刪除。');
      }
    } else if (target.id === 'add-question') {
      const blocks = document.getElementById('quiz-blocks');
      const index = blocks.querySelectorAll('[data-quiz]').length;
      if (index >= 5) return;
      blocks.insertAdjacentHTML('beforeend', quizBlockHtml(index));
      if (index + 1 >= 5) target.disabled = true;
    }
  });

  window.GY_ADMIN = {get catalog() { return catalog; }, get user() { return user; }};

  if (token) login(token, Boolean(localStorage.getItem(TOKEN_KEY)));
  else render();
})();
