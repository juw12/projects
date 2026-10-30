/* AIRIZ remote controls: the Stop motor button.
 *
 * 1.11.18: the Bluetooth parts are gone (Connect Bluetooth, the Bluefy iPhone button and the
 * Phone remote dialog that installed the AIRIZ Bluetooth bridge). Phones and other PCs control
 * the AIRIZ with Remote by code (remote-control.js), which works in any browser - Chrome or
 * Safari on iPhone included - because it goes over the internet, not Bluetooth.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const toast = text => {
    const notice = $('ui-toast');
    if (!notice) return;
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { notice.hidden = true; }, 9000);
  };

  // ------------------------------------------------------------ Stop motor
  const stopButton = $('btn-stop-motor');
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      const sent = await api.stopMotor();
      toast(sent ? 'Stop sent. The motor driver halts the current move.' : 'Not connected.');
    });
  }

  // Old links (Safari -> Bluefy) opened the console with ?ble=connect: drop the parameter.
  const params = new URLSearchParams(location.search);
  if (params.has('ble')) {
    params.delete('ble');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  }

  // ------------------------------------------------------------ availability
  function refresh() {
    if (stopButton) stopButton.disabled = !api.getStatus().connected;
  }
  setInterval(refresh, 500);
  refresh();
}());
