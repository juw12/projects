# Datum CAD — 20-engineer validation kit

A 2-week test to decide whether Datum CAD (PRD + photos → validated STEP) is worth
building further. Fill in `validation-tracker.csv` as you go.

---

## 0. The gate (decide on this)

| Metric | Threshold |
| --- | --- |
| People who actually **generate** a part | **≥ 10 / 20** |
| Would **pay** (Yes) | **≥ 3 / 20** |
| Verbatim quotes collected | **≥ 5** |
| **Decision** | Met → double down on Datum CAD. Partial → iterate (pricing/UX) or narrow the ICP. Not met → stop. |

Timebox: **2 weeks.**

---

## 1. Who (ICP — one sentence)

Mechanical / hardware / product engineers and serious makers who **already design parts** —
MechE students, NPI/design/drafting engineers, 3D-printing/CAD hobbyists. Not "people who
might like CAD."

## 2. Where (pick 4, ~60% warm)

| Channel | Effort | Expected hit rate |
| --- | --- | --- |
| **Your LinkedIn network** (MEs, ex-classmates) | low | **highest** — start here |
| **Colleagues** (Batam / aerospace contacts) | low | high |
| **Reddit**: r/MechanicalEngineering, r/cad, r/SolidWorks, r/functionalprint, r/3Dprinting | med | med |
| **Hardware Discords / makerspaces** | med | med |
| **X/Twitter** ME community | med | low–med |

## 3. Outreach copy

**Warm DM (ex-colleague / network)**

> Hey [name] — I built a small tool that turns a written spec + a few photos into a real STEP
> file, and I'm trying to see if it's actually useful to engineers like you. Could I borrow 10
> minutes? You'd try it on a real part and tell me honestly where it breaks. No pitch, just
> feedback. [link]

**Cold DM (Reddit / LinkedIn, 1:1)**

> Hi [name] — saw your post about [X]. I made a free tool: paste a part spec → get a STEP model
> you can open in CAD. I'm looking for a few mechanical folks to test it on a real part and tell
> me if it's junk. 10 min, no signup? [link]

**Reddit post**

> **Title:** I built a free tool that turns a part spec (+6 photos) into a real STEP file — looking for harsh feedback
>
> I'm a mechanical R&D engineer. You describe a part in a PRD, add up to 6 reference photos, and
> it generates a **validated STEP** solid (checked by re-import, not just a render). Free, no
> signup, rate-limited demo. I'd love 5–10 mechanical people to try it on a real part and tell me
> where it fails. Link in comments. [link]

**LinkedIn post**

> I'm a mechanical R&D engineer, and I built a tool that skips the tedious start of a design:
> give it a written spec and a few photos, get back a **validated STEP** you can open in
> Creo/SolidWorks/Fusion. It's a free demo right now — I'm looking for 20 engineers to test it on
> a real part and tell me if it's useful or useless. Honest feedback only. [link]

## 4. The task (send with the link)

> 1. Open [link].
> 2. Click a **TRY** example, or paste a spec of a part you actually need.
> 3. (Optional) add up to 6 photos.
> 4. Generate → **download the STEP** → open it in your CAD.
> 5. Time how long that took. That's it.

## 5. The survey (keep it this short)

1. Did it produce a STEP you could **open**? (Yes / Partly / No)
2. Was it **usable as a starting point**? (1–5)
3. Would you **use it again**? (Yes / Maybe / No)
4. Would you **pay**? (No / Maybe / **Yes**) — if yes, roughly how much **$/month**?
5. What would make it a **must-have** for you? *(open text)*

## 6. Tracking

Use `validation-tracker.csv` — one row per person:
`Name · Channel · Contacted · Used? · STEP ok? · Usable(1-5) · Reuse? · Pay? · Price · Quote · Followed up?`

## 7. Funnel math (be realistic)

Expect **~10%** conversion on cold outreach, higher on warm. To land 20 participants:

- ~10 warm touches → ~5–7 participants
- ~120–150 cold touches (posts + DMs) → ~13–15 participants
- **Budget ~150–200 touches over 2 weeks.** This is the real work.

## 8. Timeline

| Days | Do |
| --- | --- |
| 0 | Demo live |
| 1–3 | Warm outreach (10) |
| 4–7 | Cold: Reddit + Discords + LinkedIn post |
| 8–12 | Follow-ups; run sessions; collect quotes |
| 13–14 | Tally the gate → decide |

## 9. Rules (don't get banned, don't be spammy)

- One ask, free, 10 min, no signup. Ask nothing else.
- Follow every subreddit's self-promo rules; lead with feedback, not promotion.
- Offer the generated STEP for free; the artifact is the hook.
- If they say "not useful," **thank them and ask why** — that's the most valuable data.
