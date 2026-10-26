/* Optional Windows host integration. The same UI remains usable in a browser. */
(() => {
  'use strict';
  const host = window.airizDesktop;
  if (!host) return;

  function initializeDesktop() {
    document.documentElement.classList.add('desktop-edition');
    const downloadPanel = document.getElementById('desktop-download-banner');
    if (downloadPanel) downloadPanel.hidden = true;
    document.getElementById('btn-install-app').hidden = true;

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDesktop);
  else initializeDesktop();
})();
