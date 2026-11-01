"""Fake `cloudflared` for hermetic tests (point BEACON_CLOUDFLARED at this file).

FAKE_CF_MODE=ok       prints the quick-tunnel banner like cloudflared 2026.x, checks that
                      the --url target answers /v1/health, then "registers" and stays up.
FAKE_CF_MODE=blocked  fails the way it does behind a corporate firewall.
"""

import os
import sys
import time
import urllib.request


def log(message: str) -> None:
    sys.stdout.write(time.strftime("%Y-%m-%dT%H:%M:%SZ ") + message + "\n")
    sys.stdout.flush()


def main(argv: list[str]) -> int:
    if argv[:1] == ["--version"]:
        print("cloudflared version 2026.10.7 (fake)")
        return 0
    if argv[:1] != ["tunnel"] or "--url" not in argv:
        print("fake cloudflared: unsupported " + " ".join(argv), file=sys.stderr)
        return 2
    target = argv[argv.index("--url") + 1]
    log("INF Thank you for trying Cloudflare Tunnel.")
    log("INF Requesting new quick Tunnel on trycloudflare.com...")
    if os.environ.get("FAKE_CF_MODE") == "blocked":
        print('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": read tcp '
              "10.0.0.5:9837->104.16.230.132:443: wsarecv: An existing connection was forcibly closed by the remote host.")
        return 1
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(target + "/v1/health", timeout=5) as response:
        if response.status != 200:
            log("ERR origin did not answer")
            return 1
    log("INF +--------------------------------------------------------------------------------------------+")
    log("INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |")
    log("INF |  https://fuzzy-pickle-test-lab.trycloudflare.com                                           |")
    log("INF +--------------------------------------------------------------------------------------------+")
    log(f"INF Starting metrics server on 127.0.0.1:20241/metrics; origin {target}")
    time.sleep(0.3)
    log("INF Registered tunnel connection connIndex=0 connection=fake event=0 ip=198.41.200.13 location=sin01 protocol=quic")
    while True:
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
