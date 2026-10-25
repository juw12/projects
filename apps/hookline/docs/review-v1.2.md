# Hookline 1.2.0 — real-song workflow and remaining control fixes

## Corrected explanation

Commercial recordings are not automatically blocked by the editor. Hookline can
transform user-provided audio; technical editing and permission to publish the
result are separate questions. No blanket claim is made that private editing is
lawful everywhere. See [music and publishing](music-and-publishing.md) for the
CapCut/TikTok/YouTube distinction and official references.

No commercial tracks were downloaded, no catalogue rights were acquired, and no
DRM or copyright-detection bypass was added. A license or exception appropriate
to the intended use remains the user's separate responsibility.

## Changes

- Added a **Real songs & publishing notes** panel with user-declared permission
  basis, license/reference, credit, restrictions, destination and commercial-use
  preference. Guidance is platform-specific; every report remains unverified.
- Current-session JSON exports preserve those notes and warn that names/notes
  may be sensitive. The rendered recipe remains a snapshot of the earlier edit.
  The publishing checklist explicitly describes current active sources, not an
  older WAV. Ordinary v1.1 portable recipes remain compatible; absent rights
  data defaults to unknown.
- Corrected coupled-mode pitch readouts to reflect the actual speed ratio and
  source nudge, rather than an unused independent-mode slider value.
- Auto-arrangement immediately unlocks duration. Tempo, pitch and length labels
  update as their controlling settings change. Input ranges match the engine.
- Invalid explicit BPM values produce an error while retaining the previous
  value, instead of silently turning into automatic tempo. Source pitch nudges
  are visible on main tracks as well as mash-in tracks.
- Manual source-start times remain exact; automatic beat snapping only moves
  automatically selected hook starts. Cancelled comparisons report a partial
  comparison rather than implying all variants were produced.

## Verification

44 engine regressions plus static checks and 21 isolated browser checks. New
coverage includes declaration validation, no fabricated rights-clearance flag,
legacy recipe compatibility, actual publishing-notes/session downloads, coupled
pitch readouts, unlocked auto-arrange duration, invalid explicit BPM and exact
manual source starts. A synthetic fixture named after a commercial song confirms
that title/undocumented rights metadata do not gate the local renderer.

All listening and analysis fixtures remain synthetic. The actual Paramore and
Fall Out Boy recordings, user-held licenses, real-device Safari/iOS behavior and
engagement outcomes have not been verified. The product still uses rule parsing
and whole-track sequencing/crossfades, not source separation or an AI music model.
