/* Installation, offline status and explicit shell updates. No user-data caching. */
(() => {
  'use strict';

  let installPrompt = null;
  let registration = null;
  let reloadRequested = false;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const banner = document.getElementById('app-status');
  const networkLabel = document.getElementById('network-state');
  const installButton = document.querySelector('[data-pwa-action="install"]');
  const updateButton = document.getElementById('update-app');
  const installed = () => standalone.matches || navigator.standalone === true;
  // Inside the iPhone/Android app shell (Capacitor) the page is the same site; only a few things differ.
  const nativeApp = /GuangYaoApp\//.test(navigator.userAgent) || Boolean(window.Capacitor?.isNativePlatform?.());
  const ANDROID_APK_URL = 'https://github.com/juw12/projects/releases/download/guangyao-android/GuangYao-android.apk';
  const IOS_IPA_URL = 'https://github.com/juw12/projects/releases/download/guangyao-ios/GuangYao-iOS.ipa';
  const IOS_RELEASE_URL = 'https://github.com/juw12/projects/releases/tag/guangyao-ios';
  const IOS_PROMPT_KEY = 'gy-ios-install-dismissed';
  // iPadOS reports itself as a Mac, so touch support tells them apart.
  const iosDevice = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosSafari = iosDevice && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  const SHARE_ICON = '<svg class="ios-share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  window.GY_NATIVE = {
    isApp: nativeApp,
    androidApkUrl: ANDROID_APK_URL,
    iosIpaUrl: IOS_IPA_URL,
    showIphoneGuide: () => iphoneGuide(),
    // Saves a generated file (progress card, calendar entry) and opens the phone's share sheet.
    async shareFile(filename, blob, title) {
      const plugins = window.Capacitor?.Plugins;
      if (!nativeApp || !plugins?.Filesystem || !plugins?.Share) return false;
      const written = await plugins.Filesystem.writeFile({path: filename, data: await blobToBase64(blob), directory: 'CACHE'});
      try {
        await plugins.Share.share({title: title || filename, files: [written.uri], dialogTitle: title || '分享'});
      } catch (error) {
        if (!/cancel/i.test(String(error?.message || error))) throw error;
      }
      return true;
    }
  };
  document.documentElement.classList.toggle('native-app', nativeApp);

  function updateStatus() {
    banner.classList.toggle('offline', !navigator.onLine);
    networkLabel.textContent = navigator.onLine ? (nativeApp ? '光耀同行 App' : '瀏覽器連線模式') : '離線模式 · 僅本機示範';
    installButton.textContent = installed() ? '已安裝 · 使用說明' : installPrompt ? '安裝 App' : iosDevice ? '加到主畫面' : '安裝說明';
    installButton.hidden = nativeApp;
  }

  function installationHelp() {
    if (iosDevice && !installed()) {
      iphoneGuide();
      return;
    }
    const fileMode = location.protocol === 'file:';
    const warning = fileMode
      ? '目前是直接開啟檔案，不能註冊離線服務。請使用 localhost 預覽，或將專案部署到 HTTPS 網站後再安裝。'
      : !window.isSecureContext
        ? '目前不是安全連線，無法啟用完整 PWA。手機需要 HTTPS 網址；同一 Wi-Fi 的 HTTP IP 網址通常不符合要求。'
        : '光耀同行可以裝成手機 App：iPhone 加到主畫面，Android 下載 App。全部免費。';
    modal('安裝光耀同行', `
      <div class="callout warning">${warning}</div>
      <ol class="install-steps">
        <li><strong>iPhone / iPad：</strong>用 Safari（或 Chrome、Edge）開啟網址，點「分享」${SHARE_ICON}→「加入主畫面」→「加入」。之後從主畫面開啟，就是全螢幕 App。<button type="button" class="text-button" data-pwa-action="iphone-guide">看 iPhone 圖解</button></li>
        <li><strong>Android App：</strong><a href="${ANDROID_APK_URL}" target="_blank" rel="noopener">下載 GuangYao-android.apk</a>，在手機上開啟並允許安裝。也可以用 Chrome 選單「安裝應用程式」。</li>
        <li><strong>電腦：</strong>支援的瀏覽器會在網址列或選單提供安裝選項。沒有安裝功能時仍可直接使用網頁。</li>
      </ol>
      <div class="settings-note"><strong>資料：</strong>登入 Puter 帳號後，學習進度會在手機、電腦之間同步；以訪客身分使用時，資料只留在這台裝置。首次載入後可離線開啟已快取的頁面。</div>
      <div class="form-actions">${button('了解了', 'close', '', 'secondary')}</div>
    `);
  }

  function iphoneGuide() {
    rememberIosPromptDismissed();
    hideIosPrompt();
    const browserNote = iosSafari
      ? '你正在使用 Safari。'
      : '你正在使用 iPhone 上的其他瀏覽器；Chrome、Edge 也可以用同樣的「分享」選單加入主畫面（iOS 16.4 以上）。';
    modal('把光耀同行裝到 iPhone', `
      <p class="muted">${browserNote}免費、不需要 App Store，從主畫面開啟就是全螢幕 App，網站更新時 App 也會自動更新。</p>
      <ol class="ios-steps">
        <li><span class="ios-step-number">1</span><div><strong>點「分享」按鈕 ${SHARE_ICON}</strong><span>Safari 在畫面下方（或網址列旁的「⋯」裡）；Chrome 在網址列右側。</span></div></li>
        <li><span class="ios-step-number">2</span><div><strong>選「加入主畫面」</strong><span>看不到就把選單往上滑，或點「更多」。</span></div></li>
        <li><span class="ios-step-number">3</span><div><strong>確認「以網頁 App 開啟」已開啟，點「加入」</strong><span>主畫面會出現光耀同行的太陽圖示。</span></div></li>
        <li><span class="ios-step-number">4</span><div><strong>從主畫面開啟，登入一次</strong><span>主畫面 App 與 Safari 的資料分開；用 Email 登入 Puter 後進度會同步。</span></div></li>
      </ol>
      <details class="ios-advanced">
        <summary>進階：安裝原生 iPhone App（免費側載）</summary>
        <p>我們也提供原生 App 檔案 <a href="${IOS_IPA_URL}" target="_blank" rel="noopener">GuangYao-iOS.ipa</a>。不經 App Store，需要用電腦上的 Sideloadly 或 AltStore，以你自己的免費 Apple ID 簽署安裝，並在 iPhone 開啟「開發者模式」。</p>
        <p class="muted">限制（Apple 規定）：免費 Apple ID 安裝的 App 每 7 天要重新簽署一次，最多同時 3 個。大多數人用上面的「加入主畫面」就夠了。<a href="${IOS_RELEASE_URL}" target="_blank" rel="noopener">安裝說明</a></p>
      </details>
      <div class="form-actions">${button('知道了', 'close', '', 'secondary')}</div>
    `);
  }

  // A small, dismissible hint for iPhone visitors who have not added the app yet.
  let iosPrompt = null;
  function rememberIosPromptDismissed() {
    try {
      localStorage.setItem(IOS_PROMPT_KEY, String(Date.now()));
    } catch {}
  }
  function iosPromptDismissed() {
    try {
      return Boolean(localStorage.getItem(IOS_PROMPT_KEY));
    } catch {
      return true;
    }
  }
  function hideIosPrompt() {
    iosPrompt?.remove();
    iosPrompt = null;
  }
  function maybeShowIosPrompt() {
    if (!iosDevice || nativeApp || installed() || iosPromptDismissed() || iosPrompt) return;
    // Wait until the welcome screen and tour are out of the way.
    if (document.querySelector('.welcome') || document.getElementById('modal')?.open) return;
    iosPrompt = document.createElement('div');
    iosPrompt.className = 'ios-install-prompt';
    iosPrompt.setAttribute('role', 'region');
    iosPrompt.setAttribute('aria-label', '加到主畫面');
    iosPrompt.innerHTML = `
      <img src="icons/apple-touch-icon.png" alt="" width="40" height="40">
      <div><strong>把光耀同行加到主畫面</strong><span>像 App 一樣全螢幕開啟，免費。</span></div>
      <button type="button" class="ios-install-how" data-pwa-action="iphone-guide">怎麼做</button>
      <button type="button" class="ios-install-close" data-pwa-action="iphone-dismiss" aria-label="不要再提示">×</button>`;
    document.body.appendChild(iosPrompt);
  }
  if (iosDevice && !nativeApp) {
    setTimeout(function checkIosPrompt() {
      maybeShowIosPrompt();
      if (!iosPrompt && !iosPromptDismissed() && !installed()) setTimeout(checkIosPrompt, 4000);
    }, 6000);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateStatus();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    updateStatus();
    toast('已完成瀏覽器安裝。資料仍只保存在這個裝置。');
  });
  window.addEventListener('online', () => {
    updateStatus();
    registration?.update().catch(() => {});
  });
  window.addEventListener('offline', updateStatus);
  standalone.addEventListener('change', updateStatus);

  document.addEventListener('click', async event => {
    const action = event.target.closest('[data-pwa-action]')?.dataset.pwaAction;
    if (action === 'iphone-guide') {
      iphoneGuide();
      return;
    }
    if (action === 'iphone-dismiss') {
      rememberIosPromptDismissed();
      hideIosPrompt();
      return;
    }
    if (action === 'install') {
      if (installPrompt && !installed()) {
        const pending = installPrompt;
        installPrompt = null;
        try {
          await pending.prompt();
          const choice = await pending.userChoice;
          toast(choice.outcome === 'accepted' ? '瀏覽器正在處理安裝。' : '你仍可直接使用網頁版。');
        } catch {
          installationHelp();
        }
        updateStatus();
      } else {
        installationHelp();
      }
    }
    if (action === 'update' && registration?.waiting) {
      const proceed = window.confirm('重新載入將套用新版。已儲存的本機資料會保留；尚未送出的表單或訊息可能遺失。要繼續嗎？');
      if (!proceed) return;
      updateButton.disabled = true;
      reloadRequested = true;
      registration.waiting.postMessage({type: 'ACTIVATE_APPROVED_UPDATE'});
    }
  });

  async function registerOfflineShell() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      });
      if (registration.waiting) updateButton.hidden = false;
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            updateButton.hidden = false;
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadRequested) location.reload();
      });
    } catch (error) {
      console.warn('Offline shell is unavailable:', error.message);
      networkLabel.textContent = '網頁可用 · 離線安裝尚未啟用';
    }
  }

  updateStatus();
  registerOfflineShell();
})();
