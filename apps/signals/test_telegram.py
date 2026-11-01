"""Send a one-shot test message to verify Telegram config.

Run after filling TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env:

    python test_telegram.py

If everything is wired correctly you'll see 'Test message sent OK.' in the console
and a message from your bot on your phone within 2 seconds.
"""
from __future__ import annotations

import config
import telegram


def main() -> None:
    config.load_env()
    token = config.get("TELEGRAM_BOT_TOKEN")
    chat_id = config.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("Not configured. Open .env in this folder and fill in:")
        print("  TELEGRAM_BOT_TOKEN=...")
        print("  TELEGRAM_CHAT_ID=...")
        print()
        print("How to get them (3 min):")
        print("  1. Telegram -> @BotFather -> /newbot -> copy token")
        print("  2. Telegram -> @userinfobot -> it replies with your numeric chat id")
        return

    text = (
        "Crypto Signal Bot is live.\n\n"
        "This is a test message. If you're reading this on your phone, "
        "Telegram is wired up correctly. The bot will send alerts here whenever "
        "it opens or closes a paper trade, or when you turn on LIVE_TRADING."
    )
    ok = telegram.send(token, chat_id, text)
    if ok:
        print("Test message sent OK. Check your phone.")
    else:
        print("Send FAILED. Common causes:")
        print("  - Token is wrong (re-copy from @BotFather)")
        print("  - Chat id is wrong (re-copy from @userinfobot — must be a pure number, no quotes)")
        print("  - Bot hasn't been started yet (open Telegram, send /start to your bot first)")


if __name__ == "__main__":
    main()
