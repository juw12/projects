# 光耀同行 · 管理員指南 (Admin guide)

管理員後台：<https://juw12.github.io/projects/guangyao/admin.html>
內容庫：<https://github.com/juw12/projects/tree/main/content/guangyao>（**公開**，請勿上傳個人或內部資料）

## 1. 成為管理員（只需做一次）

1. 擁有者到 `projects` → Settings → Collaborators → **Add people**，輸入對方的 GitHub 帳號。
2. 對方到 GitHub 通知或電子郵件接受邀請。

## 2. 建立權杖 (token)

**擁有者 (juw12)**：建議用 fine-grained token。
GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token：
- Repository access: *Only select repositories* → `projects`
- Permissions → Repository → **Contents: Read and write**
- 設定到期日（例如 90 天）

**協作者**：fine-grained token 無法寫入別人的個人儲存庫，請改用 **Tokens (classic)**，只勾選 `public_repo`，並設定到期日。

權杖就像密碼：不要貼到聊天、群組或文件裡。外洩時立刻到同一頁面 Revoke。

## 3. 登入後台

打開 `admin.html` → 貼上權杖 → 登入。系統會確認帳號與內容庫寫入權限。
權杖只存在這個分頁（關閉即清除）；勾選「在這台裝置記住」才會長期保存——共用電腦請不要勾。用完請按「登出」。

## 4. 可以做什麼

| 分頁 | 功能 |
| --- | --- |
| 教材檔案 | 上傳 PDF／圖片／音檔（每個 ≤ 20 MB）或新增 YouTube／網頁連結；「重點筆記」會成為光光回答問題的依據。 |
| 課程單元 | 課文（空一行分段）、YouTube 影片、最多 5 題選擇題、反思題、閃卡（每行 `問題 \| 答案`）、附加教材、排序、草稿。 |
| 活動 | 日期時間（台北時間）、地點／線上、報名連結。 |
| 設定 | 首頁公告、是否隱藏範例活動。 |

- 存成**草稿**的項目學員看不到。
- 刪除教材會一併移除課程中的連結；GitHub 歷史仍保留，可還原。
- 發布後學員 App 約 **5 分鐘**內更新（重新整理即可）。
- 兩位管理員同時儲存時，系統會自動重試，不會互相覆蓋。

## 5. 內容格式（給開發者）

`catalog.json`（version 1）包含 `settings`、`materials`、`lessons`、`events`。檔案路徑必須在 `files/` 之下；學員端只接受 `https:` 連結與 YouTube 影片 ID，並會過濾草稿與格式錯誤的項目。檔案以固定 commit 的 jsDelivr 網址提供下載。

## 儲存位置與權限

目錄：`content/guangyao/catalog.json`。附件：`content/guangyao/files/`。
目錄中的附件路徑仍以 `files/` 開頭，由應用程式加上內容資料夾前綴。
管理員的寫入權限涵蓋整個 `juw12/projects`，不是只有內容資料夾；請只邀請可信任的維護者。
舊內容庫的 fine-grained token 必須重新授權到 `juw12/projects`。
