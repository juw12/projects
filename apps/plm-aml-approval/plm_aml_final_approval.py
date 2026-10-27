"""
PLM AML Final / Conditional Approval Submission - automation
=============================================================

Label: "Customer Assigned Final Approval Submission"
Variants:
  --approval final        (default)  樣品數目 1 / 限量數目 0     / Comment Options "Final approve"
  --approval conditional             樣品數目 0 / 限量數目 50000 / Comment Options "Conditional ..."
  --mode customer-assigned | not-customer-assigned

What it does in a Windchill PLM with a customised AML approval workflow (same as the manual flow):
  1. Opens the PLM portal page (plm_home_url in plm_config.json)
  2. Part/BOM -> Search Part To AML -> searches the part number
  3. Ticks the part and presses 送件 (starts the AML workflow)
  4. 工作清單 -> opens "ME-AML / T1: Submit (Single)" for that part
  5. Reassign Team -> project
  6. Update Related Documents Link -> creates / links the documents
       - approval sheet   -> PQ-承認相關文件   (always)
       - email evidence   -> PG-客指佐證文件   (customer-assigned only)
     Document name: "<part number> <part name> approval sheet" / "... email evidence",
     stage MP, project = the same project.
  7. Fills the task form (00 / Green / PureGMS / HSF資料相關 / ... )
  8. Comment Options = Final approve / Conditional approve, then RESETS 意見
     to the exact lines (PLM auto-appends the option text - the script removes it)
  9. Adds the reviewer (default_reviewer in plm_config.json) under 設定參與者
 10. Verifies every field, saves a screenshot and STOPS before Submit.
     Use --submit to also press Submit (each PLM confirm pop-up is shown
     and must be confirmed in this console).

Usage (interactive - it will ask for anything missing):
  python plm_aml_final_approval.py
  python plm_aml_final_approval.py --mode customer-assigned --part XXXX-XXXXXXX
  python plm_aml_final_approval.py --mode not-customer-assigned --part XXXX-YYYYYYY
  python plm_aml_final_approval.py --approval conditional --mode customer-assigned
  python plm_aml_final_approval.py --approval conditional --limit-qty 50000
  python plm_aml_final_approval.py --check-only --part XXXX-XXXXXXX   (search only, changes nothing)

Requirements: Windows, Microsoft Edge, Python 3 with the "playwright" package
(pip install playwright). Edge itself is used, no browser download is needed.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
VERSION = "v0.1 Preliminary Release (2026-10-27)"
DEBUG_PORT = 9471
SCRIPT_DIR = Path(__file__).resolve().parent

# --------------------------------------------------------------------------
# Site settings – kept OUT of the repository (plm_config.json is git-ignored).
# Copy plm_config.example.json -> plm_config.json and fill in your PLM values.
# --------------------------------------------------------------------------
CONFIG_PATH = Path(os.environ.get("PLM_CONFIG", str(SCRIPT_DIR / "plm_config.json")))
SITE_KEYS = {
    "plm_home_url": "PLM portal start page (the dcasearch.jsp?history=4 page)",
    "part_bom_tab_selector": "CSS selector of the Part/BOM tab link",
    "green_rule_checkbox_id": "element id of the 'meets company green rule' checkbox",
    "default_reviewer": "PLM user id of the default 審核者 (reviewer)",
}


def load_site_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {key: "" for key in SITE_KEYS}


SITE = load_site_config()
PLM_HOME_URL = SITE.get("plm_home_url", "")
PLM_ORIGIN = "/".join(PLM_HOME_URL.split("/")[:3]) if PLM_HOME_URL else "https://"
DEFAULT_PROFILE_DIR = SCRIPT_DIR / "edge_plm_profile"
SCREENSHOT_DIR = SCRIPT_DIR / "screenshots"
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

COMMON_FORM_VALUES = {
    "special_customer": "00",          # 特殊標準客戶
    "green_spec_value": "GA",          # 客戶Green Spec. ("Green")
    "condition_reason": "HSF資料相關",  # 限量原因 dropdown
    "survey_form": "PureGMS",          # HSF文件提供方式
    "document_stage": "MP",            # 專案階段 of the uploaded documents
    "default_reviewer": SITE.get("default_reviewer", ""),  # 設定參與者 -> 審核者
}

# Final vs conditional approval
APPROVAL_TYPES = {
    "final": {
        "label": "Final Approval",
        "sample_qty": "1",                      # 樣品數目
        "limit_qty": "0",                       # 限量數目
        "comment_option": "Final approve",      # Comment Options (exact text)
        "comment_option_pattern": r"^\s*final\s*approv",
    },
    "conditional": {
        "label": "Conditional Approval",
        "sample_qty": "0",                      # 樣品數目
        "limit_qty": "50000",                   # 限量數目 (change with --limit-qty)
        "comment_option": None,                 # picked from the list by pattern
        "comment_option_pattern": r"conditional",
    },
}

# Customer assigned vs not customer assigned
MODES = {
    "customer-assigned": {
        "label": "Customer Assigned",
        "extra_comment_lines": ["3. Customer Assigned Part"],
        "consign_part_type": "Assign Part",   # 客指料
        "assign_data": "yes",                 # Assign須提供資料
        "needs_email_evidence": True,
    },
    "not-customer-assigned": {
        "label": "NOT Customer Assigned",
        "extra_comment_lines": [],
        "consign_part_type": "",              # 客指料 left blank
        "assign_data": "no",                  # Assign須提供資料
        "needs_email_evidence": False,
    },
}


def quantity_label(limit_qty):
    """50000 -> '50K' (used in the first comment line)."""
    value = int(limit_qty)
    if value >= 1000 and value % 1000 == 0:
        return f"{value // 1000}K"
    return str(value)


def build_settings(mode, approval, limit_qty=None):
    """Merge the approval type and customer-assigned mode into one settings dict."""
    approval_settings = dict(APPROVAL_TYPES[approval])
    if approval == "conditional" and limit_qty:
        approval_settings["limit_qty"] = str(int(limit_qty))
    mode_settings = MODES[mode]
    if approval == "final":
        first_line = "1. Final Approval"
    else:
        first_line = f"1. Conditional Approval {quantity_label(approval_settings['limit_qty'])}"
    settings = dict(mode_settings)
    settings.update(approval_settings)
    settings["approval"] = approval
    settings["label"] = f"{mode_settings['label']} {approval_settings['label']} Submission"
    settings["comment_lines"] = [first_line, "2. RD send sample to IQC"] + mode_settings["extra_comment_lines"]
    return settings


DOCUMENT_TYPES = {
    "approval sheet": "PQ-承認相關文件",
    "email evidence": "PG-客指佐證文件",
}


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def log(message):
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def ask(prompt, default=None):
    suffix = f" [{default}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    return answer or (default or "")


def ask_yes_no(prompt, default_no=True):
    hint = "[y/N]" if default_no else "[Y/n]"
    answer = input(f"{prompt} {hint}: ").strip().lower()
    if not answer:
        return not default_no
    return answer in ("y", "yes")


def clean_path(raw_path):
    return raw_path.strip().strip('"').strip("'")


def ask_existing_file(prompt, given=None):
    candidate = clean_path(given) if given else ""
    while True:
        if not candidate:
            candidate = clean_path(ask(prompt))
        if candidate and Path(candidate).is_file():
            return str(Path(candidate))
        print(f"  File not found: {candidate!r} - please paste the full path of the file.")
        candidate = ""


def disable_local_proxy():
    """The PC proxy (port 3128) breaks the local DevTools connection."""
    for variable in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
        os.environ.pop(variable, None)
    os.environ["NO_PROXY"] = "127.0.0.1,localhost,::1"
    os.environ["no_proxy"] = "127.0.0.1,localhost,::1"


def devtools_ready(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{port}/json/version", timeout=3) as response:
            return "Browser" in json.loads(response.read())
    except Exception:
        return False


def ensure_edge(port, profile_dir):
    if devtools_ready(port):
        log(f"Re-using the automation Edge window on port {port}.")
        return
    edge_exe = next((path for path in EDGE_CANDIDATES if Path(path).exists()), None)
    if not edge_exe:
        sys.exit("Microsoft Edge was not found.")
    Path(profile_dir).mkdir(parents=True, exist_ok=True)
    log("Starting a separate Edge window for PLM automation ...")
    subprocess.Popen([
        edge_exe,
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--accept-lang=zh-TW,zh",
        "--start-maximized",
        PLM_HOME_URL,
    ])
    for _ in range(40):
        if devtools_ready(port):
            return
        time.sleep(0.5)
    sys.exit("Edge did not open its automation port in time.")


def page_with_title(context, title, timeout_s=20):
    end = time.time() + timeout_s
    while time.time() < end:
        for candidate in context.pages:
            try:
                if candidate.title() == title:
                    return candidate
            except Exception:
                pass
        time.sleep(0.5)
    raise RuntimeError(f"No browser tab titled {title!r} was found.")


def save_screenshot(page, name):
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SCREENSHOT_DIR / f"{datetime.now():%Y%m%d_%H%M%S}_{name}.png"
    page.bring_to_front()
    page.screenshot(path=str(path), full_page=True, timeout=30000)
    log(f"Screenshot saved: {path}")
    return path


# --------------------------------------------------------------------------
# PLM steps
# --------------------------------------------------------------------------
def open_search_part_to_aml(page):
    page.bring_to_front()
    page.goto(PLM_HOME_URL, timeout=60000)
    page.wait_for_load_state("load")
    page.wait_for_timeout(1500)
    if not page.locator("a:has-text('Part/BOM')").count():
        input("PLM login page detected. Please log in in the Edge window, then press Enter here ...")
        page.goto(PLM_HOME_URL, timeout=60000)
        page.wait_for_timeout(1500)
    # Matched by link target, so it works whether PLM shows
    # "Search Part To AML" (English menu) or "零件承認" (Chinese menu).
    page.click(SITE["part_bom_tab_selector"])
    page.wait_for_timeout(1200)
    page.click("a[href*='Action=SearchPartToAML']")
    page.wait_for_load_state("load")
    page.wait_for_timeout(1500)
    log("Opened Part/BOM -> Search Part To AML (零件承認).")


def search_part(page, part_number):
    page.fill("input[name='partNo']", part_number)
    page.click("#searchbtnforAML")
    page.wait_for_load_state("load")
    page.wait_for_timeout(2000)
    rows = page.evaluate(
        """(partNumber) => Array.from(document.querySelectorAll('input[type=checkbox]'))
            .map(box => box.closest('tr'))
            .filter(row => row && Array.from(row.querySelectorAll('a')).some(a => a.innerText.trim() === partNumber))
            .map(row => Array.from(row.children).map(cell => cell.innerText.trim().replace(/\\s+/g, ' ')))""",
        part_number,
    )
    if len(rows) != 1:
        page_text = page.evaluate("() => document.body.innerText")
        if not rows and ("No Record Found" in page_text or "沒有" in page_text or "查無" in page_text):
            raise RuntimeError(
                f"PLM found no record for {part_number}. Check the part number - "
                "or the part may already be in an AML workflow (cancel it first, or finish it from 工作清單)."
            )
        raise RuntimeError(f"Expected exactly 1 search result for {part_number}, found {len(rows)}.")
    cells = rows[0]
    part_info = {
        "number": cells[1],
        "name": cells[2],
        "spec": cells[3] if len(cells) > 3 else "",
        "product_line": cells[4] if len(cells) > 4 else "",
        "status": cells[5] if len(cells) > 5 else "",
    }
    log(f"Found part: {part_info['number']} | {part_info['name']} | {part_info['spec']} | {part_info['product_line']}")
    return part_info


def start_aml_workflow(page, part_number):
    row = page.locator("tr", has=page.locator(f"a:text-is('{part_number}')")).last
    row.locator("input[type='checkbox']").first.check()
    page.click("input[value='送件'], input[value='Submit']")
    page.wait_for_load_state("load")
    page.wait_for_timeout(3000)
    body = page.evaluate("() => document.body.innerText")
    success_part = body.split("Fail List")[0]
    fail_part = body.split("Fail List")[-1]
    if part_number not in success_part or part_number in fail_part:
        raise RuntimeError("送件 did not report success:\n" + body[-600:])
    log(f"送件 OK - Submit {part_number} to PartBOM-ME AML.")


def open_workflow_task(page, part_number):
    page.locator("a[href*='WfWorkList']").first.click()
    page.wait_for_load_state("load")
    page.wait_for_timeout(2500)
    rows = page.locator("tr", has_text=part_number).filter(has=page.locator("a", has_text="ME-AML / T1"))
    leaf_rows = [row for row in rows.all() if row.locator("tr").count() == 0]
    if not leaf_rows:
        raise RuntimeError(f"No 'ME-AML / T1: Submit (Single)' task for {part_number} in 工作清單.")
    if len(leaf_rows) > 1:
        print("More than one task found for this part:")
        for index, row in enumerate(leaf_rows, start=1):
            print(f"  {index}. {row.inner_text().strip()[:150]}")
        choice = int(ask("Which one should be used", "1"))
        target_row = leaf_rows[choice - 1]
    else:
        target_row = leaf_rows[0]
    target_row.locator("a", has_text="ME-AML / T1").first.click()
    page.wait_for_load_state("load")
    page.wait_for_timeout(2500)
    if page.title() != "審核":
        raise RuntimeError("The task form did not open.")
    log("Opened task ME-AML / T1: Submit (Single).")
    return page


def pick_project_in_picker(context, opener_page, opener_selector, project_name):
    with context.expect_page(timeout=20000) as picker_info:
        opener_page.click(opener_selector)
    picker = picker_info.value
    picker.wait_for_load_state("load")
    picker.fill("input[name='criteria']", project_name)
    picker.click("input[name='submitTeam']")
    picker.wait_for_timeout(3500)
    options = picker.evaluate("() => Array.from(document.querySelectorAll('option')).map(o => o.text.trim())")
    if project_name not in options:
        picker.close()
        raise RuntimeError(f"Project {project_name!r} not found in PLM project search (got {options}).")
    picker.locator("select").first.select_option(label=project_name)
    picker.click("text=OK")


def read_part_project(context, task_page):
    """The part's 專案名稱 shown on the Update Related Documents page."""
    with context.expect_page(timeout=20000) as docs_info:
        task_page.click("a:has-text('Update Related Documents Link')")
    docs_page = docs_info.value
    docs_page.wait_for_load_state("load")
    docs_page.wait_for_timeout(1500)
    text = docs_page.evaluate("() => document.body.innerText")
    docs_page.close()
    match = re.search(r"專案名稱\s*[:：]\s*(\S+)", text)
    return match.group(1) if match else ""


def reassign_team(context, task_page, project_name):
    with context.expect_page(timeout=20000) as reassign_info:
        task_page.click("a:has-text('Reassign Team')")
    reassign_page = reassign_info.value
    reassign_page.wait_for_load_state("load")
    reassign_page.wait_for_timeout(1500)
    pick_project_in_picker(context, reassign_page, "#find", project_name)
    reassign_page.wait_for_timeout(2000)
    if reassign_page.eval_on_selector("#teamTemplatetext", "el => el.value") != project_name:
        raise RuntimeError("Project was not filled in Reassign Team.")
    reassign_page.click("#bt_check")
    reassign_page.wait_for_timeout(4000)
    body = reassign_page.evaluate("() => document.body.innerText")
    reassign_page.close()
    if not re.search(r"專案:\s*" + re.escape(project_name), body):
        raise RuntimeError("Reassign Team did not confirm the project.")
    log(f"Reassign Team -> project {project_name}.")


def linked_documents(docs_page):
    return docs_page.evaluate(
        """() => Array.from(document.querySelectorAll('input[type=checkbox]'))
            .map(box => box.closest('tr'))
            .filter(Boolean)
            .map(row => row.innerText.trim().replace(/\\s+/g, ' '))"""
    )


def find_existing_document(context, docs_page, document_name):
    """Search 加入參考 for a document with exactly this name; tick it if found."""
    with context.expect_page(timeout=20000) as search_info:
        docs_page.click("a:has-text('加入參考')")
    search_page = search_info.value
    search_page.wait_for_load_state("load")
    search_page.wait_for_timeout(1500)
    search_page.fill("#PartNametxt", document_name)
    search_page.fill("#createDate", "")
    search_page.click("#searchbt")
    search_page.wait_for_load_state("load")
    search_page.wait_for_timeout(2500)
    boxes = search_page.locator("input[name='docName']").all()
    for box in boxes:
        value = box.get_attribute("value") or ""
        number, _, name = value.partition("|")
        row_text = box.locator("xpath=ancestor::tr[1]").inner_text()
        if document_name in row_text:
            box.check()
            search_page.click("input[name='B1']")
            docs_page.wait_for_timeout(2500)
            return number
    search_page.close()
    return None


def create_document(context, docs_page, type_label, document_name, project_name, file_path):
    with context.expect_page(timeout=20000) as picker_info:
        docs_page.click("a:has-text('建立文件')")
    form_page = picker_info.value
    form_page.wait_for_load_state("load")
    form_page.wait_for_timeout(2500)
    template_rows = form_page.locator("tr").filter(
        has=form_page.locator("input[name='radio']")
    ).filter(has_text=type_label)
    matched = [row for row in template_rows.all() if row.locator("tr").count() == 0]
    if len(matched) != 1:
        raise RuntimeError(f"Document template {type_label} not found.")
    matched[0].locator("input[name='radio']").first.check()
    form_page.click("input[name='okButton']")
    form_page.wait_for_timeout(5000)
    if form_page.title() != "建立 文件":
        raise RuntimeError("The Create Document form did not open.")
    form_page.fill("#docName", document_name)
    form_page.select_option("#projectPhase", label=COMMON_FORM_VALUES["document_stage"])
    pick_project_in_picker(context, form_page, "input[name='find']", project_name)
    form_page.wait_for_timeout(2000)
    form_page.set_input_files("#id_primaryContent", file_path)
    form_page.wait_for_timeout(800)
    form_page.click("#general_okay_button")
    form_page.wait_for_load_state("load")
    form_page.wait_for_timeout(6000)
    body = form_page.evaluate("() => document.body.innerText")
    number_match = re.search(r"編號:\s*(\d+)", body)
    if not number_match or document_name not in body:
        raise RuntimeError("Document creation was not confirmed:\n" + body[:800])
    form_page.close()
    log(f"Created document {number_match.group(1)} - {document_name}")
    return number_match.group(1)


def upload_related_documents(context, task_page, required_documents, project_name):
    """required_documents: list of (kind, document_name, file_path)."""
    with context.expect_page(timeout=20000) as docs_info:
        task_page.click("a:has-text('Update Related Documents Link')")
    docs_page = docs_info.value
    docs_page.wait_for_load_state("load")
    docs_page.wait_for_timeout(2000)

    for kind, document_name, file_path in required_documents:
        if any(document_name in row for row in linked_documents(docs_page)):
            log(f"Already linked: {document_name}")
            continue
        existing_number = find_existing_document(context, docs_page, document_name)
        if existing_number:
            log(f"Re-linked existing document {existing_number} - {document_name}")
            continue
        create_document(context, docs_page, DOCUMENT_TYPES[kind], document_name, project_name, file_path)
        linked_number = find_existing_document(context, docs_page, document_name)
        if not linked_number:
            raise RuntimeError(f"Could not link the new document {document_name}.")

    rows = linked_documents(docs_page)
    missing = [name for _, name, _ in required_documents if not any(name in row for row in rows)]
    if missing:
        raise RuntimeError(f"Documents not in the list: {missing}")
    docs_page.click("input[name='SubmitButton']")
    docs_page.wait_for_timeout(5000)
    result = docs_page.evaluate("() => document.body.innerText")
    docs_page.close()
    if "Successfully" not in result:
        raise RuntimeError("Saving related documents failed:\n" + result[:400])
    log("Related documents saved (part reference updated successfully).")


def find_input_by_label(task_page, label_text):
    """Return a CSS selector for the text box next to a form label (e.g. 限量數目)."""
    marker = task_page.evaluate(
        """(labelText) => {
            const cells = Array.from(document.querySelectorAll('td, th'));
            const labelCell = cells.find(cell => cell.innerText && cell.innerText.trim().startsWith(labelText)
                && !cell.querySelector('td'));
            if (!labelCell) return null;
            let input = labelCell.querySelector('input[type=text], input:not([type])');
            let cell = labelCell;
            while (!input && cell.nextElementSibling) {
                cell = cell.nextElementSibling;
                input = cell.querySelector('input[type=text], input:not([type])');
            }
            if (!input) return null;
            if (input.id) return '#' + input.id;
            input.setAttribute('data-auto-label', labelText);
            return '[data-auto-label="' + labelText + '"]';
        }""",
        label_text,
    )
    if not marker:
        raise RuntimeError(f"Could not find the {label_text} text box on the task form.")
    return marker


def select_comment_option(task_page, mode_settings):
    """Pick Comment Options by exact text (final) or by pattern (conditional)."""
    options = task_page.evaluate("() => Array.from(document.getElementById('reviewComments').options).map(o => o.text.trim())")
    if mode_settings["comment_option"] and mode_settings["comment_option"] in options:
        chosen = mode_settings["comment_option"]
    else:
        pattern = re.compile(mode_settings["comment_option_pattern"], re.IGNORECASE)
        candidates = [text for text in options if pattern.search(text)]
        if len(candidates) != 1:
            raise RuntimeError(f"Comment Options: expected one '{mode_settings['approval']}' entry, found {candidates}. All options: {options}")
        chosen = candidates[0]
    task_page.select_option("#reviewComments", label=chosen)
    return chosen


def fill_task_form(task_page, mode_settings):
    comment_text = "\n".join(mode_settings["comment_lines"])
    task_page.bring_to_front()
    task_page.select_option("#SpecialCustomer", label=COMMON_FORM_VALUES["special_customer"])
    task_page.wait_for_timeout(2500)
    task_page.select_option("#CustomerSpec", value=COMMON_FORM_VALUES["green_spec_value"])
    task_page.fill("#SampleQty", mode_settings["sample_qty"])
    limit_selector = find_input_by_label(task_page, "限量數目")
    mode_settings["limit_qty_selector"] = limit_selector
    task_page.fill(limit_selector, mode_settings["limit_qty"])
    task_page.select_option("#ConditionReason", label=COMMON_FORM_VALUES["condition_reason"])
    task_page.fill("#ConditionReasonDetail", comment_text)
    task_page.check("#" + SITE["green_rule_checkbox_id"])
    task_page.select_option("#SurveyFormSupport", label=COMMON_FORM_VALUES["survey_form"])
    task_page.check("#GuaranteeUploaded")
    if mode_settings["consign_part_type"]:
        task_page.select_option("#ConsignPartType", label=mode_settings["consign_part_type"])
    else:
        task_page.select_option("#ConsignPartType", index=0)
    task_page.wait_for_timeout(1200)
    task_page.select_option("#IsNeedAssignPartData", label=mode_settings["assign_data"])
    task_page.wait_for_timeout(1200)
    # Comment Options auto-appends its text into 意見 -> reset 意見 afterwards.
    mode_settings["comment_option_selected"] = select_comment_option(task_page, mode_settings)
    task_page.wait_for_timeout(1200)
    task_page.fill("#comments", comment_text)
    log(f"Task form filled (Comment Options: {mode_settings['comment_option_selected']}).")


def add_reviewer(context, task_page, reviewer):
    task_page.check("input[name='userSel'][value='selrole0']")
    with context.expect_page(timeout=20000) as picker_info:
        task_page.click("#ss")
    picker = picker_info.value
    picker.wait_for_load_state("load")
    picker.fill("#criteria", reviewer)
    picker.click("input[name='bt_search']")
    picker.wait_for_timeout(4000)
    options = picker.evaluate("() => Array.from(document.querySelectorAll('#principalPool option')).map(o => [o.value, o.text])")
    matches = [index for index, (value, _) in enumerate(options) if value.lower().startswith(reviewer.lower() + "_oid")]
    if len(matches) != 1:
        picker.close()
        raise RuntimeError(f"Reviewer {reviewer!r} not uniquely found: {options}")
    picker.select_option("#principalPool", index=matches[0])
    picker.click("input[name='bt_add']")
    picker.wait_for_timeout(800)
    picker.click("#bt_submit")
    task_page.wait_for_timeout(2500)
    log(f"Reviewer added: {options[matches[0]][1]}")


def verify_task_form(task_page, part_number, mode_settings, reviewer):
    comment_text = "\n".join(mode_settings["comment_lines"])
    if task_page.eval_on_selector("#comments", "el => el.value") != comment_text:
        task_page.fill("#comments", comment_text)
    state = task_page.evaluate(
        """({limitSelector, greenRuleSelector}) => {
            const el = id => document.getElementById(id);
            const selText = id => el(id).options[el(id).selectedIndex] ? el(id).options[el(id).selectedIndex].text : '';
            return {
                part: (document.body.innerText.match(/\\[PART\\] Part (\\S+)/) || ['', ''])[1],
                special_customer: selText('SpecialCustomer'),
                green_spec: el('CustomerSpec').value,
                sample_qty: el('SampleQty').value,
                limit_qty: document.querySelector(limitSelector).value,
                condition_reason: selText('ConditionReason'),
                condition_text: el('ConditionReasonDetail').value,
                company_green_rule: document.querySelector(greenRuleSelector).checked,
                survey_form: selText('SurveyFormSupport'),
                guarantee_uploaded: el('GuaranteeUploaded').checked,
                consign_part_type: selText('ConsignPartType'),
                assign_data: selText('IsNeedAssignPartData'),
                comment_option: selText('reviewComments'),
                comments: el('comments').value,
                reviewers: Array.from(el('REVIEWER').options).map(o => o.value + '|' + o.text)
            };
        }""",
        {"limitSelector": mode_settings["limit_qty_selector"], "greenRuleSelector": "#" + SITE["green_rule_checkbox_id"]},
    )
    expected = {
        "part": part_number,
        "special_customer": COMMON_FORM_VALUES["special_customer"],
        "green_spec": COMMON_FORM_VALUES["green_spec_value"],
        "sample_qty": mode_settings["sample_qty"],
        "limit_qty": mode_settings["limit_qty"],
        "condition_reason": COMMON_FORM_VALUES["condition_reason"],
        "condition_text": comment_text,
        "company_green_rule": True,
        "survey_form": COMMON_FORM_VALUES["survey_form"],
        "guarantee_uploaded": True,
        "consign_part_type": mode_settings["consign_part_type"],
        "assign_data": mode_settings["assign_data"],
        "comment_option": mode_settings["comment_option_selected"],
        "comments": comment_text,
    }
    problems = [f"{key}: got {state[key]!r}, expected {value!r}" for key, value in expected.items() if state[key] != value]
    if not any(entry.lower().startswith(reviewer.lower() + "_oid") for entry in state["reviewers"]):
        problems.append(f"reviewer {reviewer} missing (got {state['reviewers']})")
    print("\n----- Task form check -----")
    for key, value in state.items():
        print(f"  {key:20s}: {value!r}")
    if problems:
        print("PROBLEMS:")
        for problem in problems:
            print("  -", problem)
        raise RuntimeError("Task form verification failed - NOT submitting.")
    log("All task form values verified.")


def press_submit(task_page):
    def handle_dialog(dialog):
        print("\nPLM pop-up:\n  " + dialog.message)
        if ask_yes_no("Accept this pop-up (OK)?"):
            dialog.accept()
        else:
            dialog.dismiss()

    task_page.on("dialog", handle_dialog)
    task_page.click("#submitButton")
    task_page.wait_for_timeout(8000)
    body = task_page.evaluate("() => document.body.innerText")
    if "工作項目已經順利完成" in body:
        log("Submitted: 工作項目已經順利完成。")
    else:
        log("Submit result not confirmed - please check the Edge window.")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="PLM AML Final / Conditional Approval Submission")
    parser.add_argument("--mode", choices=list(MODES), help="customer-assigned or not-customer-assigned")
    parser.add_argument("--approval", choices=list(APPROVAL_TYPES), help="final (default prompt) or conditional")
    parser.add_argument("--limit-qty", help="限量數目 for conditional approval (default 50000)")
    parser.add_argument("--part", help="Part number, e.g. XXXX-XXXXXXX")
    parser.add_argument("--project", help="PLM project name (default: read from the part in PLM)")
    parser.add_argument("--approval-sheet", help="Full path of the approval sheet file")
    parser.add_argument("--email-evidence", help="Full path of the customer email evidence (customer-assigned only)")
    parser.add_argument("--reviewer", help="Reviewer PLM user id (default: default_reviewer in plm_config.json)")
    parser.add_argument("--submit", action="store_true", help="Also press Submit at the end (asks before each PLM pop-up)")
    parser.add_argument("--check-only", action="store_true", help="Only search the part and check inputs, change nothing")
    parser.add_argument("--port", type=int, default=DEBUG_PORT)
    parser.add_argument("--profile-dir", default=str(DEFAULT_PROFILE_DIR))
    args = parser.parse_args()

    missing = [key for key in SITE_KEYS if not SITE.get(key)]
    if missing:
        print(f"Site configuration missing or incomplete: {CONFIG_PATH}")
        print("Copy plm_config.example.json to plm_config.json and fill in:")
        for key in missing:
            print(f"  - {key}: {SITE_KEYS[key]}")
        sys.exit(2)

    print("=" * 70)
    print(" PLM AML Final / Conditional Approval Submission  -  " + VERSION)
    print("=" * 70)

    approval = args.approval
    if not approval:
        approval = "conditional" if ask_yes_no("Is this a CONDITIONAL approval? (No = Final approval)") else "final"
    mode = args.mode
    if not mode:
        assigned = ask_yes_no("Is this a CUSTOMER ASSIGNED part?", default_no=False)
        mode = "customer-assigned" if assigned else "not-customer-assigned"
    settings = build_settings(mode, approval, args.limit_qty)
    log(f"Mode: {settings['label']}  (樣品數目 {settings['sample_qty']}, 限量數目 {settings['limit_qty']})")
    log("Comment lines: " + " / ".join(settings["comment_lines"]))

    part_number = (args.part or ask("Part number (e.g. XXXX-XXXXXXX)")).strip().upper()
    approval_sheet = ask_existing_file("Approval sheet file - full path", args.approval_sheet) if not args.check_only or args.approval_sheet else ""
    email_evidence = ""
    if settings["needs_email_evidence"] and (not args.check_only or args.email_evidence):
        email_evidence = ask_existing_file("Email evidence file - full path", args.email_evidence)
    reviewer = (args.reviewer or ask("Reviewer PLM id", COMMON_FORM_VALUES["default_reviewer"])).strip()

    disable_local_proxy()
    ensure_edge(args.port, args.profile_dir)
    playwright = sync_playwright().start()
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{args.port}")
    context = browser.contexts[0]
    # Force the Chinese PLM interface - the script matches the Chinese labels
    # (工作清單 / 送件 / 建立文件 / 加入參考 ...).
    context.set_extra_http_headers({"Accept-Language": "zh-TW,zh;q=0.9"})
    plm_pages = [candidate for candidate in context.pages if candidate.url.startswith(PLM_ORIGIN)]
    page = plm_pages[0] if plm_pages else context.new_page()

    open_search_part_to_aml(page)
    part_info = search_part(page, part_number)

    if args.check_only:
        log("--check-only: stopping before 送件. Nothing was changed in PLM.")
        return

    print("\nSummary before starting the workflow:")
    print(f"  Mode           : {settings['label']}")
    print(f"  樣品數目/限量數目: {settings['sample_qty']} / {settings['limit_qty']}")
    print(f"  意見 / 限量原因 : {' | '.join(settings['comment_lines'])}")
    print(f"  Part           : {part_info['number']}  {part_info['name']}")
    print(f"  Approval sheet : {approval_sheet}")
    if email_evidence:
        print(f"  Email evidence : {email_evidence}")
    print(f"  Reviewer       : {reviewer}")
    if not ask_yes_no("Press 送件 now and start the AML workflow?"):
        log("Stopped by user before 送件.")
        return

    start_aml_workflow(page, part_number)
    task_page = open_workflow_task(page, part_number)

    project_name = args.project or read_part_project(context, task_page)
    project_name = ask("Project name (from PLM part data - Enter to accept)", project_name).strip()
    reassign_team(context, task_page, project_name)

    part_label = f"{part_info['number']} {part_info['name']}"
    required_documents = [("approval sheet", f"{part_label} approval sheet", approval_sheet)]
    if settings["needs_email_evidence"]:
        required_documents.append(("email evidence", f"{part_label} email evidence", email_evidence))
    upload_related_documents(context, task_page, required_documents, project_name)

    fill_task_form(task_page, settings)
    add_reviewer(context, task_page, reviewer)
    verify_task_form(task_page, part_number, settings, reviewer)
    save_screenshot(task_page, f"{part_number}_before_submit")

    if args.submit:
        if ask_yes_no("Everything is verified. Press Submit now?"):
            press_submit(task_page)
            save_screenshot(task_page, f"{part_number}_after_submit")
            return
    log("Stopped BEFORE Submit. Review the form in the Edge window and press Submit yourself.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
    except Exception as error:
        print(f"\nSTOPPED: {error}")
        sys.exit(1)
