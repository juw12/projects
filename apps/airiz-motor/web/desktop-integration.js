/* Optional Windows host integration. The same UI remains usable in a browser. */
(() => {
  'use strict';
  const host = window.airizDesktop;
  if (!host) {
    async function refreshDesktopLinks() {
      try {
        const response = await fetch('./updates/windows/release.json', { cache: 'no-store' });
        if (!response.ok) return;
        const release = await response.json();
        if (!/^\d+\.\d+\.\d+$/.test(release.version)) return;
        const base = 'https://github.com/juwpegatron/projects/releases/download/airiz-desktop-v' + release.version + '/';
        const installer = base + 'AIRIZ-Console-Setup-' + release.version + '-x64.exe';
        const portable = base + 'AIRIZ-Console-Portable-' + release.version + '-x64.exe';
        if (release.installer.url !== installer || release.portable.url !== portable) return;
        document.getElementById('download-windows-installer').href = installer;
        document.getElementById('download-windows-portable').href = portable;
        document.querySelector('.desktop-download-copy strong').textContent = 'Get the Windows desktop app · v' + release.version;
      } catch {
        // Retain the last known download links if the version feed is offline.
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshDesktopLinks);
    else refreshDesktopLinks();
    return;
  }

  function initializeDesktop() {
    document.documentElement.classList.add('desktop-edition');
    const downloadPanel = document.getElementById('desktop-download-banner');
    if (downloadPanel) downloadPanel.hidden = true;
    document.getElementById('btn-install-app').hidden = true;

    initializeUpdates();
    host.getAppInfo().then(info => {
      document.title = 'AIRIZ Console — Windows ' + info.version;
      const badge = document.querySelector('.header-session');
      if (badge) badge.textContent = 'WINDOWS APP / ' + info.version;
      const footer = document.querySelector('.sidebar-footer');
      if (footer) footer.textContent = 'LOCAL DESKTOP EDITION';
    });

    const chooser = document.createElement('dialog');
    chooser.id = 'native-serial-dialog';
    chooser.className = 'help-dialog native-serial-dialog';
    chooser.setAttribute('aria-labelledby', 'native-serial-title');
    const title = document.createElement('h2');
    title.id = 'native-serial-title';
    title.textContent = 'Choose your serial device';
    const description = document.createElement('p');
    description.textContent = 'Select the connected AIRIZ serial port. No port is selected automatically. The list updates while this dialog is open.';
    const list = document.createElement('div');
    list.id = 'native-serial-list';
    list.className = 'native-serial-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Available serial ports');
    const cancel = document.createElement('button');
    cancel.id = 'native-serial-cancel';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel connection';
    chooser.append(title, description, list, cancel);
    document.body.append(chooser);

    function cancelSelection() {
      host.chooseSerialPort('');
      if (chooser.open) chooser.close();
    }
    cancel.addEventListener('click', cancelSelection);
    chooser.addEventListener('cancel', event => {
      event.preventDefault();
      cancelSelection();
    });
    host.onSerialPorts(({ ports }) => {
      list.replaceChildren();
      if (!ports.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No serial devices found. Connect the AIRIZ USB serial interface and check its Windows driver. You can cancel and use Demo mode without hardware.';
        list.append(empty);
      }
      for (const port of ports) {
        const button = document.createElement('button');
        button.className = 'native-serial-port';
        button.dataset.portId = port.id;
        const name = document.createElement('strong');
        name.textContent = port.name;
        const details = document.createElement('span');
        details.textContent = [port.port, port.vendorId ? 'VID ' + port.vendorId : '', port.productId ? 'PID ' + port.productId : ''].filter(Boolean).join(' · ');
        button.append(name, details);
        button.addEventListener('click', async () => {
          const selected = await host.chooseSerialPort(port.id);
          if (selected) chooser.close();
        });
        list.append(button);
      }
      if (!chooser.open) chooser.showModal();
    });
  }

  function initializeUpdates() {
    const button = document.createElement('button');
    button.id = 'btn-app-updates';
    button.className = 'theme-switcher';
    button.textContent = 'Updates';
    document.querySelector('.header-meta').append(button);
    const modal = document.createElement('dialog');
    modal.id = 'desktop-updates-dialog';
    modal.className = 'help-dialog';
    modal.setAttribute('aria-labelledby', 'desktop-updates-title');
    modal.innerHTML = '<h2 id="desktop-updates-title">AIRIZ updates</h2>'
      + '<p id="desktop-update-version"></p><p id="desktop-update-message" role="status"></p>'
      + '<progress id="desktop-update-progress" max="100" value="0" hidden></progress>'
      + '<p class="desktop-update-note">Checks run automatically. Updates never install on quit or restart an active device session. Portable builds require manual replacement.</p>'
      + '<div class="desktop-update-actions"><button id="desktop-update-check" class="btn">Check now</button>'
      + '<button id="desktop-update-download" class="btn btn-primary" hidden>Download update</button>'
      + '<button id="desktop-update-install" class="btn btn-primary" hidden>Install and restart</button>'
      + '<button id="desktop-update-close" class="btn btn-secondary">Close</button></div>';
    document.body.append(modal);
    const $ = id => document.getElementById(id);
    function render(state) {
      $('desktop-update-version').textContent = 'Installed: ' + state.currentVersion
        + (state.availableVersion ? ' · Available: ' + state.availableVersion : '')
        + (state.portable ? ' · Portable' : '');
      $('desktop-update-message').textContent = state.message;
      $('desktop-update-progress').hidden = state.status !== 'downloading';
      $('desktop-update-progress').value = state.percent || 0;
      $('desktop-update-check').disabled = ['checking', 'downloading', 'downloaded', 'installing'].includes(state.status);
      $('desktop-update-download').hidden = state.status !== 'available';
      $('desktop-update-download').textContent = state.portable ? 'Download portable app' : 'Download update';
      $('desktop-update-install').hidden = state.status !== 'downloaded';
      button.textContent = state.status === 'available' ? 'Update available'
        : state.status === 'downloading' ? 'Downloading ' + Math.round(state.percent || 0) + '%'
        : state.status === 'downloaded' ? 'Install update' : 'Updates';
      document.body.inert = state.status === 'installing';
    }
    function open() {
      if (!modal.open) modal.showModal();
      host.getUpdateState().then(render);
    }
    button.addEventListener('click', open);
    $('desktop-update-close').addEventListener('click', () => modal.close());
    $('desktop-update-check').addEventListener('click', () => host.checkForUpdates().then(render));
    $('desktop-update-download').addEventListener('click', () => host.downloadUpdate().then(render));
    $('desktop-update-install').addEventListener('click', () => host.installUpdate().then(render));
    host.onUpdateState(render);
    host.onShowUpdates(open);
    host.getUpdateState().then(render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDesktop);
  else initializeDesktop();
})();
