"""Static market configuration for Indonesia and Southeast Asia.

All tax rates, payment methods and regulatory notes are DEMO ASSUMPTIONS taken from
public sources (Grant Thornton ASEAN tax guide 2026, Xendit/Stripe docs) and must be
verified with local tax advisors and payment partners before production use.
"""

# Money is stored as integers in the currency's minor unit.
# IDR and VND are stored in whole units (decimals = 0).
COUNTRIES = {
    "ID": {
        "name": "Indonesia",
        "currency": "IDR",
        "locale": "id-ID",
        "decimals": 0,
        "round_to": 100,
        "tz_min": 420,
        "default_lang": "id",
        "tax": {
            "name": "PB1 / PBJT",
            "rate": 0.10,
            "inclusive": False,
            "note": "Regional restaurant tax (PBJT, formerly PB1) 10%, usually added on top of menu prices.",
        },
        "payments": ["QRIS", "GoPay", "OVO", "DANA", "ShopeePay", "LinkAja", "BCA Virtual Account", "Mandiri Virtual Account", "Card"],
        "gateways": ["Xendit", "Midtrans"],
        "couriers": ["GoSend", "GrabExpress", "Café staff"],
        "chat_apps": ["WhatsApp", "Telegram", "Lark", "Microsoft Teams"],
        "perk_tax": {
            "staff_allowance": "Food & drinks provided to ALL employees are excluded from employee taxable income under PMK 66/2023 (natura). Verify with your tax advisor.",
            "meeting": "Business meeting / entertainment cost. Keep attendee list (auto-attached).",
            "gift_individual": "Individual gifts or vouchers may be taxable natura for the recipient above thresholds. Verify.",
        },
    },
    "SG": {
        "name": "Singapore",
        "currency": "SGD",
        "locale": "en-SG",
        "decimals": 2,
        "round_to": 10,
        "tz_min": 480,
        "default_lang": "en",
        "tax": {
            "name": "GST",
            "rate": 0.09,
            "inclusive": True,
            "note": "GST 9%, café prices shown GST-inclusive.",
        },
        "payments": ["PayNow", "GrabPay", "Card", "Apple Pay"],
        "gateways": ["Stripe", "Xendit", "2C2P"],
        "couriers": ["GrabExpress", "Lalamove", "Café staff"],
        "chat_apps": ["WhatsApp", "Slack", "Microsoft Teams"],
        "perk_tax": {
            "staff_allowance": "Staff refreshment benefits: check IRAS benefits-in-kind rules. Verify.",
            "meeting": "Meeting / client entertainment expense.",
            "gift_individual": "Individual gifts may be taxable benefits. Verify.",
        },
    },
    "MY": {
        "name": "Malaysia",
        "currency": "MYR",
        "locale": "en-MY",
        "decimals": 2,
        "round_to": 10,
        "tz_min": 480,
        "default_lang": "en",
        "tax": {
            "name": "SST",
            "rate": 0.06,
            "inclusive": False,
            "note": "Service tax 6% on F&B for registered outlets, added on top.",
        },
        "payments": ["DuitNow QR", "Touch 'n Go eWallet", "GrabPay", "Boost", "Card"],
        "gateways": ["Xendit", "2C2P", "Stripe"],
        "couriers": ["GrabExpress", "Lalamove", "Café staff"],
        "chat_apps": ["WhatsApp", "Telegram", "Microsoft Teams"],
        "perk_tax": {
            "staff_allowance": "Refreshments provided at the workplace: check LHDN perquisite rules. Verify.",
            "meeting": "Meeting / entertainment expense.",
            "gift_individual": "Individual gifts may be perquisites. Verify.",
        },
    },
    "TH": {
        "name": "Thailand",
        "currency": "THB",
        "locale": "th-TH",
        "decimals": 2,
        "round_to": 100,
        "tz_min": 420,
        "default_lang": "en",
        "tax": {
            "name": "VAT",
            "rate": 0.07,
            "inclusive": True,
            "note": "VAT 7%, prices shown VAT-inclusive.",
        },
        "payments": ["PromptPay", "TrueMoney", "Rabbit LINE Pay", "Card"],
        "gateways": ["2C2P", "Xendit", "Stripe"],
        "couriers": ["Grab Express", "LINE MAN", "Café staff"],
        "chat_apps": ["LINE", "Microsoft Teams", "Slack"],
        "perk_tax": {
            "staff_allowance": "Staff welfare benefits: check Revenue Department rules. Verify.",
            "meeting": "Meeting expense.",
            "gift_individual": "Individual gifts may be taxable income. Verify.",
        },
    },
    "PH": {
        "name": "Philippines",
        "currency": "PHP",
        "locale": "en-PH",
        "decimals": 2,
        "round_to": 100,
        "tz_min": 480,
        "default_lang": "en",
        "tax": {
            "name": "VAT",
            "rate": 0.12,
            "inclusive": True,
            "note": "VAT 12%, prices shown VAT-inclusive.",
        },
        "payments": ["GCash", "Maya", "QR Ph", "Card"],
        "gateways": ["Xendit", "PayMongo", "2C2P"],
        "couriers": ["Lalamove", "Grab Express", "Café staff"],
        "chat_apps": ["Viber", "Messenger", "Microsoft Teams", "Slack"],
        "perk_tax": {
            "staff_allowance": "De minimis benefits rules may apply. Verify with BIR guidance.",
            "meeting": "Meeting / representation expense.",
            "gift_individual": "Gifts above de minimis may be taxable. Verify.",
        },
    },
    "VN": {
        "name": "Vietnam",
        "currency": "VND",
        "locale": "vi-VN",
        "decimals": 0,
        "round_to": 1000,
        "tz_min": 420,
        "default_lang": "en",
        "tax": {
            "name": "VAT",
            "rate": 0.08,
            "inclusive": True,
            "note": "VAT 8% (temporary reduction from 10%; check whether still in force).",
        },
        "payments": ["MoMo", "ZaloPay", "VNPay QR", "Card"],
        "gateways": ["2C2P", "Stripe", "Xendit"],
        "couriers": ["Grab Express", "Ahamove", "Café staff"],
        "chat_apps": ["Zalo", "Microsoft Teams", "Slack"],
        "perk_tax": {
            "staff_allowance": "Mid-shift meal / welfare rules may apply. Verify.",
            "meeting": "Meeting expense.",
            "gift_individual": "Individual gifts may be taxable income. Verify.",
        },
    },
}

# Allergens carried by milk options.
for _country in COUNTRIES.values():
    _country["perk_tax"].setdefault(
        "client_gift",
        "Coffee for clients/partners is business promotion or entertainment; keep recipient and purpose. Deductibility varies. Verify.",
    )

MILK_ALLERGENS = {
    "fresh": ["dairy"],
    "oat": [],
    "soy": ["soy"],
    "almond": ["nuts"],
    None: [],
}

SUGAR_LEVELS = [0, 25, 50, 75, 100]
ICE_LEVELS = ["less", "normal", "extra"]

# Carry planner: cups per tray and trays one person can carry safely.
CUPS_PER_TRAY = 4
TRAYS_PER_CARRIER = 2

# Unclaimed-order timers (minutes after ready).
UNCLAIMED_REMIND_MIN = 15
UNCLAIMED_RELEASE_MIN = 30

# Platform commission charged to the café on each captured line (demo value).
CAFE_COMMISSION_PCT = 5

# Freshness buffer: fire the order this many minutes before the runner arrives
# in addition to the computed prep time.
FIRE_BUFFER_MIN = 0

TEAM_COLORS = {
    "Engineering": "#2563eb",
    "Design": "#db2777",
    "Marketing": "#ea580c",
    "Sales": "#16a34a",
    "Finance": "#7c3aed",
    "Operations": "#0891b2",
    "People": "#ca8a04",
}
