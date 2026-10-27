# PLM AML Final / Conditional Approval Submission – automation

> **v0.1 Preliminary Release (2026-10-27)** – first version for trial use; a new version may follow.

Python + Playwright tool that drives **Microsoft Edge** through a Windchill-based PLM
"Search Part To AML (零件承認)" approval workflow: it searches the part, starts the workflow (送件),
assigns the project, uploads / links the approval documents, fills the approval form, adds the
reviewer, verifies every field and **stops before Submit** so a person always makes the final check.

## Setup
1. Windows, Microsoft Edge, Python 3 ("Add python.exe to PATH"). The launchers install `playwright` on first run.
2. Copy `plm_config.example.json` to `plm_config.json` and fill in your site values
   (PLM portal URL, Part/BOM tab selector, green-rule checkbox id, default reviewer id).
   `plm_config.json` is git-ignored – never commit it.

## Run
| Launcher | Use for |
|---|---|
| `Run_Customer_Assigned_Final_Approval.bat` | Customer assigned – final approval |
| `Run_NOT_Customer_Assigned_Final_Approval.bat` | Not customer assigned – final approval |
| `Run_Customer_Assigned_Conditional_Approval.bat` | Customer assigned – conditional approval |
| `Run_NOT_Customer_Assigned_Conditional_Approval.bat` | Not customer assigned – conditional approval |

It asks for the part number, approval sheet path, email evidence path (customer assigned only),
reviewer and project (read from PLM), and confirms before starting the workflow.

## What it fills
| Field | Final | Conditional |
|---|---|---|
| Comment Options | Final approve | "Conditional …" entry |
| 樣品數目 / 限量數目 | 1 / 0 | 0 / 50000 (`--limit-qty`) |
| 意見 and 限量原因 text, line 1 | 1. Final Approval | 1. Conditional Approval 50K |
| line 2 | 2. RD send sample to IQC | 2. RD send sample to IQC |
| line 3 (customer assigned only) | 3. Customer Assigned Part | 3. Customer Assigned Part |

Customer assigned also uploads an email-evidence document and sets 客指料 = Assign Part,
Assign須提供資料 = yes (not assigned: blank / no).

## Options
```
python plm_aml_final_approval.py --mode customer-assigned|not-customer-assigned
    --approval final|conditional [--limit-qty 50000]
    [--part XXXX-XXXXXXX] [--project NAME] [--approval-sheet PATH] [--email-evidence PATH]
    [--reviewer ID] [--check-only] [--submit]
```
`--check-only` only searches; `--submit` also presses Submit and asks before every PLM pop-up.

## Notes
- The Edge profile (`edge_plm_profile/`) holds your PLM login session – it is git-ignored, never share it.
- Selectors match one specific PLM customisation; other sites will need adjustments.
- See `DEVLOG.md` for design notes and the verification status.
