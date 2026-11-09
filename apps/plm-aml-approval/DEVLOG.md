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

## 2026-11-03 – first live final-approval run (13B7-06N0U01, customer assigned)
- Full flow ran live up to "stop before Submit": 送件, Reassign Team, 2 new documents, form, reviewer.
- Fix: 加入參考 search page's #createDate is now read-only -> cleared via JS instead of fill().
- Fix: reviewer list now stores "OR:wt.org.WTUser:<n>|<name>" -> verify also matches the display name picked in add_reviewer().
- Site values confirmed: Part/BOM tab a[onclick*='asus_modulepartbom.jsp'], green rule checkbox IsMatchGreenASUSRule (符合PEGATRON規則).
- Note: 符合客戶規則 (IsMatchGreenCustomerRule) is not ticked by the script – check per customer.
