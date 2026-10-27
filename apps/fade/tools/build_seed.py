#!/usr/bin/env python3
"""Build web/data.js (window.SEED = {...};) from the v1 seed plus Fade 2.0 additions.

The output is a pure JSON literal after `window.SEED = ` so the Python server
can load exactly the same seed as the browser (single source of truth).
Usage: python tools/build_seed.py path/to/seed_v1.json
"""
import json
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent

TIMEZONES = {
    "Jakarta": "Asia/Jakarta",
    "London": "Europe/London",
    "New York": "America/New_York",
    "Lagos": "Africa/Lagos",
    "Tokyo": "Asia/Tokyo",
}

CREATORS = [
    {"id": "u1", "name": "Rizky A.", "handle": "rizky.fresh", "hue": 15, "followers": 21400, "following": 310,
     "bio": "Fresh cut every 2 weeks. Reviews Jakarta barbers honestly."},
    {"id": "u2", "name": "Nadia P.", "handle": "nadiacuts", "hue": 300, "followers": 48700, "following": 520,
     "bio": "Hair, coffee, city guides. Partnerships: DM."},
    {"id": "u3", "name": "Kevin T.", "handle": "kev.perms", "hue": 200, "followers": 9300, "following": 140,
     "bio": "Documenting my perm journey."},
    {"id": "u4", "name": "Sarah L.", "handle": "sarah.braids", "hue": 340, "followers": 132000, "following": 890,
     "bio": "Protective styles + NYC salons."},
]


def creator_shorts():
    return [
        {"id": "sh_u1_a", "authorType": "user", "authorId": "u1", "category": "Cut reveal",
         "caption": "Cleanest mid fade I've had all year 🔥 @fadebymarcus at Kings #skinfade #jakarta",
         "media": {"kind": "art", "style": "fade", "hue": 95}, "likes": 18400, "views": 241000, "shares": 1900,
         "agoHours": 20, "conversions": 37,
         "tags": [{"type": "barber", "id": "b1", "kind": "featured", "status": "approved"},
                  {"type": "place", "id": "p1", "kind": "featured", "status": "approved"}]},
        {"id": "sh_u2_a", "authorType": "user", "authorId": "u2", "category": "Shop tour",
         "caption": "Inside Kings Lounge: espresso bar, PS5 lounge and hot towels ☕🎮 #barbershop #luxe",
         "media": {"kind": "art", "style": "pomp", "hue": 42}, "likes": 26100, "views": 388000, "shares": 4200,
         "agoHours": 9, "conversions": 52,
         "tags": [{"type": "place", "id": "p1", "kind": "sponsored", "status": "approved"}]},
        {"id": "sh_u3_a", "authorType": "user", "authorId": "u3", "category": "Before / after",
         "caption": "Straight hair → Korean perm with Kenji. Week 1 update 🌀 #koreanperm #beforeafter",
         "media": {"kind": "art", "style": "curly", "hue": 200}, "likes": 9900, "views": 120000, "shares": 800,
         "agoHours": 30, "conversions": 14,
         "tags": [{"type": "barber", "id": "b4", "kind": "featured", "status": "approved"}]},
        {"id": "sh_u4_a", "authorType": "user", "authorId": "u4", "category": "Cut reveal",
         "caption": "Stitch cornrows by Tasha at Harlem Crown 💜 #braids #nyc",
         "media": {"kind": "art", "style": "braids", "hue": 330}, "likes": 61000, "views": 902000, "shares": 9100,
         "agoHours": 40, "conversions": 120,
         "tags": [{"type": "barber", "id": "b8", "kind": "sponsored", "status": "approved"},
                  {"type": "place", "id": "p8", "kind": "featured", "status": "approved"}]},
        {"id": "sh_u1_b", "authorType": "user", "authorId": "u1", "category": "Tutorial",
         "caption": "How to keep a fade fresh for 2 weeks: clay, not pomade 🫙 #haircare #tutorial",
         "media": {"kind": "art", "style": "buzz", "hue": 120}, "likes": 7300, "views": 64000, "shares": 1200,
         "agoHours": 70, "conversions": 9,
         "tags": [{"type": "barber", "id": "b3", "kind": "featured", "status": "approved"}]},
    ]


def barber_and_place_shorts(seed):
    shorts = []
    for barber in seed["barbers"]:
        for index, item in enumerate(barber["portfolio"][:3]):
            shorts.append({
                "id": f"sh_{barber['id']}_{item['id']}",
                "authorType": "barber",
                "authorId": barber["id"],
                "category": "Cut reveal",
                "caption": f"{item['title']} ✂️ #{item['style']} #{barber['city'].replace(' ', '').lower()}",
                "media": {"kind": "art", "style": item["style"], "hue": item["hue"], "color": item.get("color")},
                "likes": item["likes"],
                "views": item["likes"] * 12,
                "shares": item["likes"] // 15,
                "agoHours": 6 + index * 31 + (sum(map(ord, barber["id"])) % 50),
                "conversions": item["likes"] // 900,
                "portfolioId": item["id"],
                "tags": [],
            })
    shorts.append({
        "id": "sh_p3_tour", "authorType": "place", "authorId": "p3", "category": "Shop tour",
        "caption": "Vinyl Fridays at Kemang Social Club 🎶 4 chairs open tonight #kemang #barbershop",
        "media": {"kind": "art", "style": "afro", "hue": 280}, "likes": 5200, "views": 70000, "shares": 600,
        "agoHours": 5, "conversions": 11,
        "tags": [{"type": "barber", "id": "b2", "kind": "featured", "status": "approved"}],
    })
    shorts.append({
        "id": "sh_p6_drop", "authorType": "place", "authorId": "p6", "category": "Products",
        "caption": "New: Color Lock Toner by @bima.designs, now at PIK 🎨 #color #products",
        "media": {"kind": "art", "style": "design", "hue": 260}, "likes": 3100, "views": 41000, "shares": 300,
        "agoHours": 15, "conversions": 6,
        "tags": [{"type": "barber", "id": "b10", "kind": "featured", "status": "approved"}],
    })
    return shorts


def main():
    seed = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for place in seed["places"]:
        place["tz"] = TIMEZONES[place["city"]]
        place["followers"] = place["reviews"] * 6
    seed["creators"] = CREATORS
    seed["shorts"] = creator_shorts() + barber_and_place_shorts(seed)
    seed["version"] = "3.3.0"
    body = json.dumps(seed, ensure_ascii=False, indent=1)
    header = "/* Fade seed data, generated by tools/build_seed.py. Pure JSON after the assignment so the server can read it. */\n"
    (APP_DIR / "web" / "data.js").write_text(header + "window.SEED = " + body + ";\n", encoding="utf-8")
    print("shorts:", len(seed["shorts"]), "creators:", len(CREATORS))


if __name__ == "__main__":
    main()
