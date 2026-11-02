"""Payment gateway abstraction + simulated provider.

Real providers (Xendit, Midtrans, 2C2P, Stripe) follow the same shape:
  1. create a charge  -> provider returns an id + QR string / deeplink, status PENDING
  2. customer pays in their bank / e-wallet app
  3. provider calls our webhook with a shared callback token / signature -> we credit once (idempotent)

Only the simulated provider is implemented. A real adapter must implement the same three methods and
be configured with credentials from the provider dashboard (never hard-coded).
"""

import hashlib
import hmac
import secrets

PENDING = "PENDING"
PAID = "PAID"
EXPIRED = "EXPIRED"


def crc16_ccitt(data: str) -> str:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as used by EMVCo merchant-presented QR."""
    crc = 0xFFFF
    for byte in data.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def _tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def emv_qr_payload(merchant_name, city, amount, reference, country="ID", currency_numeric="360",
                   merchant_account="ID.CREWCUP.DEMO", merchant_id="DEMO000000000001"):
    """Build an EMVCo-style dynamic QR string (the format QRIS is based on).

    DEMO ONLY: the merchant account is fake, so banking apps will refuse to pay it. A real QRIS
    string must come from a licensed acquirer / payment gateway.
    """
    merchant_info = _tlv("00", merchant_account) + _tlv("01", merchant_id)
    body = (
        _tlv("00", "01")                     # payload format indicator
        + _tlv("01", "12")                   # point of initiation: dynamic
        + _tlv("26", merchant_info)          # merchant account information
        + _tlv("52", "5814")                 # MCC: eating places / restaurants
        + _tlv("53", currency_numeric)       # 360 = IDR
        + _tlv("54", str(amount))            # amount
        + _tlv("58", country)
        + _tlv("59", merchant_name[:25])
        + _tlv("60", city[:15])
        + _tlv("62", _tlv("01", reference[:25]))  # bill number
        + "6304"
    )
    return body + crc16_ccitt(body)


def verify_emv_crc(payload: str) -> bool:
    return len(payload) > 8 and payload[-8:-4] == "6304" and crc16_ccitt(payload[:-4]) == payload[-4:]


class SimulatedGateway:
    """In-process stand-in for a QRIS / e-wallet gateway. Same lifecycle as a real one."""

    name = "Simulated gateway (Xendit/Midtrans-style)"

    def __init__(self, callback_token):
        self.callback_token = callback_token

    def create_charge(self, reference, amount, currency, method, merchant_name="CrewCup Wallet", city="JAKARTA",
                      country="ID", currency_numeric="360", display_amount=None):
        """`amount` is in minor units (what we store); `display_amount` is the decimal string the QR carries."""
        charge_id = "ch_" + secrets.token_hex(8)
        payload = None
        if method in ("QRIS", "PayNow", "DuitNow QR", "PromptPay", "QR Ph", "VNPay QR"):
            payload = emv_qr_payload(merchant_name, city, display_amount or str(amount), reference, country, currency_numeric)
        return {
            "id": charge_id,
            "reference": reference,
            "amount": amount,
            "currency": currency,
            "method": method,
            "status": PENDING,
            "qr_string": payload,
            "deeplink": None if payload else f"https://pay.example/{method.lower().replace(' ', '-')}/{charge_id}",
        }

    def verify_callback(self, token_header):
        return bool(token_header) and hmac.compare_digest(str(token_header), self.callback_token)

    def simulate_paid_callback(self, charge):
        """What the provider would POST to our webhook once the customer pays."""
        return {
            "headers": {"x-callback-token": self.callback_token},
            "body": {"id": charge["id"], "reference": charge["reference"], "status": PAID,
                     "amount": charge["amount"], "currency": charge["currency"]},
        }


CURRENCY_NUMERIC = {"IDR": "360", "SGD": "702", "MYR": "458", "THB": "764", "PHP": "608", "VND": "704"}


def derive_token(secret: bytes, label: str) -> str:
    return hmac.new(secret, label.encode(), hashlib.sha256).hexdigest()
