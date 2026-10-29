# Dev log – v0.1 (2026-10-27)

Built with an AI assistant while doing a real submission by hand, then turning the steps into a script
and a training deck (the deck stays internal – it contains system screenshots).

## Design
- Playwright attaches to a separate Edge instance over CDP (own profile, port 9471); local proxy bypassed.
- Forces zh-TW Accept-Language so the Chinese UI labels (工作清單 / 送件 / 建立文件 / 加入參考) match.
- Flow: portal → 零件承認 search → 送件 (asks y/N) → worklist task → Reassign Team (project read from the
  part, user confirms) → create or re-link documents → fill form → reviewer → verify → screenshot →
  stop before Submit.
- Comment Options auto-appends its text into 意見; the script resets 意見 to the exact lines.
- Existing documents with the same name are re-linked instead of uploaded twice
  (cancelling a workflow removes the document links).
- Conditional mode picks the Comment Options entry matching /conditional/i and finds the 限量數目
  box by its label; it stops with a clear message if either is not found.
- Site-specific values (URL, selectors, reviewer) live in `plm_config.json` (not committed).

## Verification status
- `--check-only` tested against the live system.
- Final-approval steps after 送件 mirror a manually verified run but were not yet run end-to-end as a script.
- Conditional mode tested on a mock form only – first live run still to be watched.
