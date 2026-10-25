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

  function updateStatus() {
    banner.classList.toggle('offline', !navigator.onLine);
    networkLabel.textContent = navigator.onLine ? '瀏覽器連線模式' : '離線模式 · 僅本機示範';
    installButton.textContent = installed() ? '已安裝 · 使用說明' : installPrompt ? '安裝 App' : '安裝說明';
  }

  function installationHelp() {
    const fileMode = location.protocol === 'file:';
    const warning = fileMode
      ? '目前是直接開啟檔案，不能註冊離線服務。請使用 localhost 預覽，或將專案部署到 HTTPS 網站後再安裝。'
      : !window.isSecureContext
        ? '目前不是安全連線，無法啟用完整 PWA。手機需要 HTTPS 網址；同一 Wi-Fi 的 HTTP IP 網址通常不符合要求。'
        : '這是可安裝的網頁 App（PWA），不是 App Store / Google Play 原生應用。瀏覽器對安裝的支援不同。';
    modal('安裝光耀同行', `
      <div class="callout warning">${warning}</div>
      <ol class="install-steps">
        <li><strong>iPhone / iPad：</strong>使用 Safari 開啟 HTTPS 網站，點「分享」→「加入主畫面」。若顯示「以網頁 App 開啟」，請啟用。</li>
        <li><strong>Android：</strong>使用 Chrome 開啟網站。若出現安裝選項，可選「安裝應用程式」；否則查看瀏覽器選單。</li>
        <li><strong>電腦：</strong>支援的瀏覽器會在網址列或選單提供安裝選項。沒有安裝功能時仍可直接使用網頁。</li>
      </ol>
      <div class="settings-note"><strong>離線範圍：</strong>首次載入完成後，可離線開啟已快取的 App 外殼與示範流程。真實影片、帳戶、聊天、付款、外部參考頁及跨裝置同步尚未接入。資料只在此瀏覽器／安裝實例；手機與電腦不會同步。</div>
      <p class="muted" style="font-size:12px;margin-top:15px">登出不會刪除本機示範資料。共用裝置請使用帳戶選單的「重設原型」。瀏覽器清理或解除安裝可能移除本機紀錄。</p>
      <div class="form-actions">${button('了解了', 'close', '', 'secondary')}</div>
    `);
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
