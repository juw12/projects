"""Build the Glow offline library packs (web/library/*.json) from curated Wikipedia articles.

Each pack is a list of articles split into short passages that GlowChat stores on the device and
searches with no internet. Answers made with a pack cite the articles they used (Wikipedia text is
CC BY-SA 4.0, so every passage keeps its article title and link).

Stdlib only. Run from the repo root:
    python -X utf8 apps/glow/tools/build_library.py            # build every pack
    python -X utf8 apps/glow/tools/build_library.py first-aid  # build one pack
    python -X utf8 apps/glow/tools/build_library.py --selftest # check the chunker offline
"""
import datetime
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
OUT = APP / "web" / "library"
API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "GlowLibraryBuilder/1.0 (https://github.com/juw12/projects; offline reference packs)"
LICENSE = "Text from Wikipedia, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)"

# Passages are short so a small on-device model can read several of them in its working memory.
CHUNK_CHARS = 900
# Long articles keep their opening sections (definition, signs, treatment usually come first).
ARTICLE_CHARS = 24000
# Sections that are not reference material.
DROP_SECTIONS = re.compile(
    r"^(references|external links|see also|further reading|notes|bibliography|sources|citations|"
    r"footnotes|gallery|in popular culture|popular culture|in fiction|etymology|terminology|"
    r"history|historical|society and culture|culture|research|other animals|in other animals|"
    r"veterinary|works cited|explanatory notes|alternative medicine|notable (people|cases|victims|incidents))\b",
    re.I,
)

PACKS = {
    "first-aid": {
        "name": "First aid & emergency medicine",
        "about": "CPR, bleeding, burns, choking, fractures, bites, heat and cold injuries, poisoning.",
        "note": "Reference text, not medical advice. In an emergency, contact local emergency services if you can.",
        "titles": [
            "First aid", "Cardiopulmonary resuscitation", "Automated external defibrillator", "Recovery position",
            "Choking", "Abdominal thrusts", "Bleeding", "Tourniquet", "Pressure dressing", "Wound",
            "Laceration", "Wound healing", "Burn", "Frostbite", "Hypothermia", "Hyperthermia",
            "Heat stroke", "Heat exhaustion", "Dehydration", "Oral rehydration therapy", "Shock (circulatory)",
            "Anaphylaxis", "Epinephrine autoinjector", "Asthma", "Myocardial infarction", "Stroke",
            "Epileptic seizure", "Hypoglycemia", "Bone fracture", "Splint (medicine)", "Sprain",
            "Dislocation", "Concussion", "Head injury", "Spinal cord injury", "Snakebite", "Spider bite",
            "Bee sting", "Tick", "Rabies", "Tetanus", "Drowning", "Electrical injury",
            "Carbon monoxide poisoning", "Poisoning", "Allergy", "Nosebleed", "Eye injury", "Sepsis",
            "Diarrhea", "Cholera", "Altitude sickness", "Lightning injury", "Triage", "Sunburn",
            "Infection", "Fever", "Vomiting", "Hyponatremia", "Cardiac arrest", "Respiratory arrest",
            "Syncope (medicine)", "Basic life support", "Rescue breathing",
        ],
    },
    "survival": {
        "name": "Survival & outdoors",
        "about": "Safe water, fire, shelter, navigation, signalling, food, clothing and hygiene.",
        "note": "Reference text. Check local conditions and rules; some techniques carry real risk.",
        "titles": [
            "Survival skills", "Water purification", "Portable water purification", "Boiling",
            "Solar water disinfection", "Water chlorination", "Rainwater harvesting", "Drinking water",
            "Bivouac shelter", "Fire making", "Fire striker", "Bow drill", "Knot", "Orienteering",
            "Navigation", "Compass", "Celestial navigation", "Dead reckoning", "Topographic map",
            "Mushroom poisoning", "Foraging", "Trapping", "Fishing", "Food preservation", "Smoking (cooking)",
            "Food drying", "Signal mirror", "Distress signal", "SOS", "Mayday",
            "Emergency position-indicating radiobeacon", "Rope", "Hiking", "Layered clothing",
            "Space blanket", "Pit latrine", "Hand washing", "Campfire", "Cold-weather warfare",
            "Bushcraft", "Wilderness medical emergency", "Lean-to", "Quinzhee", "Snow cave",
            "Edible plants", "Water filter",
        ],
    },
    "disaster": {
        "name": "Disasters & preparedness",
        "about": "Earthquakes, floods, storms, wildfires, heat waves, outages, evacuation and supplies.",
        "note": "Reference text. Always follow instructions from local authorities.",
        "titles": [
            "Emergency management", "Emergency preparedness", "Bug-out bag", "Emergency ration",
            "Earthquake", "Earthquake preparedness", "Tsunami", "Flood", "Flash flood", "Tropical cyclone",
            "Tornado", "Wildfire", "Volcanic ash", "Blizzard", "Heat wave", "Power outage", "Drought",
            "Landslide", "Avalanche", "Lightning", "Pandemic", "Nuclear fallout", "Fallout shelter",
            "Potassium iodide", "Emergency evacuation", "Search and rescue", "Mass-casualty incident",
            "Engine-generator", "Amateur radio emergency communications", "Storm surge", "Ice storm",
            "Shelter in place", "Disaster response", "Water scarcity", "Household hazardous waste",
            "Tropical cyclone preparedness", "Wildfire emergency management", "Flood warning", "Survival kit",
        ],
    },
}


def fetch_article(title):
    """Plain text, canonical title, link and revision of one Wikipedia article (redirects followed)."""
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
        "titles": title,
        "prop": "extracts|info|revisions",
        "explaintext": "1",
        "exsectionformat": "wiki",
        "inprop": "url",
        "rvprop": "ids",
    }
    request = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    pages = data.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or not pages[0].get("extract"):
        return None
    page = pages[0]
    return {
        "title": page["title"],
        "url": page.get("canonicalurl") or f"https://en.wikipedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}",
        "rev": (page.get("revisions") or [{}])[0].get("revid", 0),
        "text": page["extract"],
    }


def sections(text):
    """(section path, body) pairs from a plain-text extract with == wiki == headings."""
    path = []
    body = []
    found = []
    for line in text.splitlines():
        heading = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", line)
        if heading:
            found.append((" › ".join(path), "\n".join(body)))
            level = len(heading.group(1)) - 1
            path = path[: max(level - 1, 0)] + [heading.group(2)]
            body = []
        else:
            body.append(line)
    found.append((" › ".join(path), "\n".join(body)))
    return found


def clean(text):
    text = re.sub(r"\[\d+\]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_article(text, limit=CHUNK_CHARS, article_limit=ARTICLE_CHARS, min_chars=60):
    """Short passages on paragraph (then sentence) boundaries, each with its section name."""
    chunks = []
    used = 0
    for section, body in sections(text):
        if section and any(DROP_SECTIONS.match(part) for part in section.split(" › ")):
            continue
        body = clean(body)
        if not body:
            continue
        pieces = []
        for paragraph in [p.strip() for p in body.split("\n") if p.strip()]:
            if len(paragraph) <= limit:
                pieces.append(paragraph)
                continue
            sentence_buffer = ""
            for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
                if sentence_buffer and len(sentence_buffer) + len(sentence) + 1 > limit:
                    pieces.append(sentence_buffer)
                    sentence_buffer = ""
                sentence_buffer = f"{sentence_buffer} {sentence}".strip()
            if sentence_buffer:
                pieces.append(sentence_buffer)
        buffer = ""
        for piece in pieces:
            if buffer and len(buffer) + len(piece) + 1 > limit:
                chunks.append({"s": section, "t": buffer})
                used += len(buffer)
                buffer = ""
            buffer = f"{buffer}\n{piece}".strip()
        if buffer:
            chunks.append({"s": section, "t": buffer})
            used += len(buffer)
        if used >= article_limit:
            break
    return [c for c in chunks if len(c["t"]) >= min_chars]


def build_pack(pack_id):
    spec = PACKS[pack_id]
    articles = []
    chunks = []
    missing = []
    seen = set()
    for title in spec["titles"]:
        article = fetch_article(title)
        time.sleep(0.2)
        if not article:
            missing.append(title)
            continue
        if article["title"] in seen:
            continue
        seen.add(article["title"])
        passages = chunk_article(article["text"])
        if not passages:
            missing.append(title)
            continue
        index = len(articles)
        articles.append({"title": article["title"], "url": article["url"], "rev": article["rev"]})
        chunks.extend({"a": index, **passage} for passage in passages)
    pack = {
        "format": 1,
        "id": pack_id,
        "name": spec["name"],
        "about": spec["about"],
        "note": spec["note"],
        "license": LICENSE,
        "built": datetime.date.today().isoformat(),
        "articles": articles,
        "chunks": chunks,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{pack_id}.json"
    path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{pack_id}: {len(articles)} articles, {len(chunks)} passages, {path.stat().st_size / 1e6:.2f} MB")
    if missing:
        print(f"  not found or empty: {', '.join(missing)}")
    return pack


def write_index():
    """The catalog GlowChat reads to list the packs (sizes shown before downloading)."""
    packs = []
    for pack_id in PACKS:
        path = OUT / f"{pack_id}.json"
        if not path.exists():
            continue
        pack = json.loads(path.read_text(encoding="utf-8"))
        packs.append({
            "id": pack_id,
            "name": pack["name"],
            "about": pack["about"],
            "note": pack["note"],
            "version": pack["built"],
            "articles": len(pack["articles"]),
            "passages": len(pack["chunks"]),
            "bytes": path.stat().st_size,
            "file": f"{pack_id}.json",
        })
    index = {"format": 1, "license": LICENSE, "packs": packs}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"index.json: {len(packs)} packs")


def selftest():
    sample = (
        "Hypothermia is a low body temperature.[1] It is dangerous.\n\n"
        "== Signs and symptoms ==\nShivering and confusion.\n"
        "=== Severe ===\nShivering may stop.\n"
        "== History ==\nOld text that should be dropped.\n"
        "== References ==\nShould be dropped too.\n"
    )
    chunks = chunk_article(sample, limit=60, min_chars=1)
    texts = " ".join(c["t"] for c in chunks)
    assert "[1]" not in texts, chunks
    assert "Old text" not in texts and "Should be dropped" not in texts, chunks
    assert any(c["s"] == "Signs and symptoms › Severe" for c in chunks), chunks
    long_text = "Sentence number one is here. " * 80
    assert all(len(c["t"]) <= 200 for c in chunk_article(long_text, limit=200)), "long paragraphs must be split"
    for pack_id, spec in PACKS.items():
        assert len(spec["titles"]) == len(set(spec["titles"])), f"{pack_id} lists an article twice"
    print("build_library selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return
    wanted = [a for a in argv if not a.startswith("-")] or list(PACKS)
    for pack_id in wanted:
        build_pack(pack_id)
    write_index()


if __name__ == "__main__":
    main(sys.argv[1:])
