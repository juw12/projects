"""Connect a Telegram bot to the live TradeBot Worker (run once, by the owner).

1. In Telegram, talk to @BotFather: /newbot, pick a name and a username ending in "bot".
   BotFather answers with a token like 123456789:AA...
2. Run this script. It asks for that token and your setup code (the same one GlowBot uses;
   nothing is saved or printed), tells the Worker to take the bot over, and prints a one-time
   pairing link.
3. Open the link on your phone and tap Start: you become the bot's owner and the agent starts.

    python apps/tradebot/tools/connect_telegram.py
    python apps/tradebot/tools/connect_telegram.py --new-pairing   # make a fresh owner link

Environment variables TRADE_BOT_TOKEN and TRADE_SETUP_CODE are used instead of the questions when set.
"""
import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://trade-bot.juw12.workers.dev"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=DEFAULT_URL, help="the TradeBot Worker (default: %(default)s)")
    parser.add_argument("--new-pairing", action="store_true", help="forget the owner and make a new pairing link")
    args = parser.parse_args()

    token = os.environ.get("TRADE_BOT_TOKEN") or getpass.getpass("Bot token from @BotFather (hidden; Enter to keep the current one): ")
    code = os.environ.get("TRADE_SETUP_CODE") or getpass.getpass("Setup code (hidden): ")
    if not code.strip():
        sys.exit("The setup code is needed.")

    body = {"newPairing": args.new_pairing}
    if token.strip():
        body["token"] = token.strip()
    request = urllib.request.Request(
        args.url.rstrip("/") + "/v1/setup",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Setup-Code": code.strip(), "User-Agent": "trade-bot-setup"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            answer = json.load(response)
    except urllib.error.HTTPError as error:
        try:
            detail = json.load(error).get("error", "")
        except ValueError:
            detail = ""
        sys.exit(f"The Worker said no (HTTP {error.code}): {detail or error.reason}")

    bot = answer.get("bot") or {}
    print(f"Connected: @{bot.get('username')} ({bot.get('name')})")
    print(f"Webhook:   {answer.get('webhook')}")
    if answer.get("pairLink"):
        print()
        print("Open this link on your phone and tap Start to become the owner (works once, for 24 hours):")
        print(f"  {answer['pairLink']}")
    else:
        print("Already paired with its owner. Use --new-pairing to make a fresh owner link.")


if __name__ == "__main__":
    main()
