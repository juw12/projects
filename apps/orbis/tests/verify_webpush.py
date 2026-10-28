#!/usr/bin/env python3
"""Known-answer tests for Orbis's standard-library Web Push crypto.

Every check compares against a published vector, so a pass means the
implementation reproduces the standard byte-for-byte:

* FIPS-197 Appendix C.1      AES-128 block encryption
* NIST GCM spec, cases 1-4   AES-128-GCM encryption and tags
* RFC 6979 A.2.5             P-256 key derivation and deterministic ECDSA (SHA-256)
* RFC 8291 Section 5         complete Web Push message encryption example

Run:
    python tests/verify_webpush.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import webpush  # noqa: E402

PASSED = 0
FAILED = 0


def check(condition, label):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print("  ok  - %s" % label)
    else:
        FAILED += 1
        print("  FAIL - %s" % label)


def hx(text):
    return bytes.fromhex(text.replace(" ", ""))


def main():
    print("AES-128 (FIPS-197 C.1)")
    out = webpush.aes128_encrypt_block(hx("000102030405060708090a0b0c0d0e0f"),
                                       hx("00112233445566778899aabbccddeeff"))
    check(out == hx("69c4e0d86a7b0430d8cdb78070b4c55a"), "AES-128 block matches FIPS-197")

    print("AES-128-GCM (NIST test cases)")
    zero_key = bytes(16)
    zero_iv = bytes(12)
    check(webpush.aes_gcm_encrypt(zero_key, zero_iv, b"") == hx("58e2fccefa7e3061367f1d57a4e7455a"),
          "case 1: empty plaintext tag")
    check(webpush.aes_gcm_encrypt(zero_key, zero_iv, bytes(16)) ==
          hx("0388dace60b6a392f328c2b971b2fe78" "ab6e47d42cec13bdf53a67b21257bddf"),
          "case 2: one block ciphertext + tag")
    key3 = hx("feffe9928665731c6d6a8f9467308308")
    iv3 = hx("cafebabefacedbaddecaf888")
    pt3 = hx("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72"
             "1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255")
    ct3 = hx("42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e"
             "21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091473f5985")
    check(webpush.aes_gcm_encrypt(key3, iv3, pt3) == ct3 + hx("4d5c2af327cd64a62cf35abd2ba6fab4"),
          "case 3: four blocks ciphertext + tag")
    aad4 = hx("feedfacedeadbeeffeedfacedeadbeefabaddad2")
    ct4 = webpush.aes_gcm_encrypt(key3, iv3, pt3[:60], aad4)
    check(ct4 == ct3[:60] + hx("5bc94fbc3221a5db94fae95ae7121a47"),
          "case 4: partial block with AAD")
    check(webpush.aes_gcm_decrypt(key3, iv3, ct4, aad4) == pt3[:60], "decrypt round-trip")
    tampered = bytearray(ct4)
    tampered[0] ^= 1
    try:
        webpush.aes_gcm_decrypt(key3, iv3, bytes(tampered), aad4)
        rejected = False
    except ValueError:
        rejected = True
    check(rejected, "tampered ciphertext is rejected")

    print("P-256 ECDSA (RFC 6979 A.2.5, SHA-256)")
    private = int("C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721", 16)
    public = webpush.public_key(private)
    check(public == b"\x04" + hx("60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6")
          + hx("7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299"),
          "public key derivation matches RFC 6979")
    signature = webpush.ecdsa_sign(private, b"sample")
    check(signature == hx("EFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716")
          + hx("F7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8"),
          "deterministic signature for 'sample' matches RFC 6979")
    signature_test = webpush.ecdsa_sign(private, b"test")
    check(signature_test == hx("F1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367")
          + hx("019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083"),
          "deterministic signature for 'test' matches RFC 6979")
    check(webpush.ecdsa_verify(public, b"sample", signature), "signature verifies")
    check(not webpush.ecdsa_verify(public, b"samplE", signature), "signature rejects a changed message")
    try:
        webpush.decode_point(b"\x04" + bytes(64))
        off_curve_rejected = False
    except ValueError:
        off_curve_rejected = True
    check(off_curve_rejected, "points not on the curve are rejected")

    print("Web Push message encryption (RFC 8291 Section 5)")
    plaintext = webpush.b64url_decode("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24")
    as_private = webpush._int(webpush.b64url_decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
    as_public = webpush.b64url_decode(
        "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
    ua_private = webpush._int(webpush.b64url_decode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"))
    ua_public = webpush.b64url_decode(
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
    salt = webpush.b64url_decode("DGv6ra1nlYgDCS1FRnbzlw")
    auth = webpush.b64url_decode("BTBZMqHH6r4Tts7J_aSIgg")
    expected = webpush.b64url_decode(
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz"
        "AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
    check(webpush.public_key(as_private) == as_public, "application server key pair matches RFC 8291")
    check(webpush.public_key(ua_private) == ua_public, "user agent key pair matches RFC 8291")
    body = webpush.encrypt(plaintext, ua_public, auth, _sender_private=as_private, _salt=salt)
    check(body == expected, "encrypted push body matches RFC 8291 byte-for-byte")
    check(webpush.decrypt(expected, ua_private, auth) == plaintext, "RFC 8291 body decrypts to the plaintext")
    fresh = webpush.encrypt(b'{"hello":"orbis"}', ua_public, auth)
    check(webpush.decrypt(fresh, ua_private, auth) == b'{"hello":"orbis"}', "random-key encryption round-trip")

    print("VAPID (RFC 8292) and endpoint safety")
    vapid = webpush.Vapid(webpush.generate_private_key(), "mailto:admin@orbis.example")
    header = vapid.authorization("https://fcm.googleapis.com/fcm/send/abc")
    token = header.split("t=")[1].split(",")[0]
    key = header.split("k=")[1]
    head, claims, sig = token.split(".")
    import json
    claim_data = json.loads(webpush.b64url_decode(claims))
    check(claim_data["aud"] == "https://fcm.googleapis.com" and claim_data["sub"].startswith("mailto:"),
          "VAPID claims carry audience and subject")
    check(webpush.ecdsa_verify(webpush.b64url_decode(key), (head + "." + claims).encode(),
                               webpush.b64url_decode(sig)), "VAPID JWT signature verifies with k=")
    check(webpush.endpoint_allowed("https://web.push.apple.com/QGuQyavXutnMH"), "Apple push endpoint allowed")
    check(webpush.endpoint_allowed("https://fcm.googleapis.com/fcm/send/x"), "FCM endpoint allowed")
    check(not webpush.endpoint_allowed("https://169.254.169.254/latest"), "internal address rejected")
    check(not webpush.endpoint_allowed("http://fcm.googleapis.com/x"), "plain http rejected")
    check(not webpush.endpoint_allowed("https://fcm.googleapis.com.evil.example/x"), "look-alike host rejected")

    print()
    print("%d passed, %d failed" % (PASSED, FAILED))
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
