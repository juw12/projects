"""
i18n.py - Pips translations + first-run language picker.

Languages: English, Bahasa Indonesia, Traditional Chinese, Simplified Chinese.

    import i18n
    i18n.set_language("id")
    i18n.t("start")                 -> "▶ Mulai"
    i18n.t("streak", n=3)           -> "Streak: 3 hari"
    i18n.lines("tickle")            -> list of random pet lines

The chosen language is stored in config.json -> "language". If it is missing
on start-up, app.py shows `pick_language()` before the widget is built.
Unknown keys / languages fall back to English, so nothing can crash on a
missing translation.
"""

from __future__ import annotations

import ctypes
import sys

LANGUAGES = [
    ("en", "English", "Hello!"),
    ("id", "Bahasa Indonesia", "Halo!"),
    ("zh_TW", "繁體中文", "你好！"),
    ("zh_CN", "简体中文", "你好！"),
]
LANG_CODES = [code for code, _name, _hi in LANGUAGES]
_INDEX = {code: i for i, code in enumerate(LANG_CODES)}

_current = "en"


def set_language(code: str) -> str:
    global _current
    _current = code if code in _INDEX else "en"
    return _current


def get_language() -> str:
    return _current


def language_name(code: str) -> str:
    for c, name, _hi in LANGUAGES:
        if c == code:
            return name
    return code


def detect_system_language() -> str:
    """Best guess from the Windows UI language (falls back to English)."""
    if sys.platform != "win32":
        return "en"
    try:
        lang_id = ctypes.windll.kernel32.GetUserDefaultUILanguage()
    except Exception:
        return "en"
    primary = lang_id & 0x3FF
    if primary == 0x21:          # Indonesian
        return "id"
    if primary == 0x04:          # Chinese
        if lang_id in (0x0804, 0x1004):   # PRC, Singapore
            return "zh_CN"
        return "zh_TW"           # Taiwan, Hong Kong, Macao
    return "en"


# -----------------------------------------------------------------------------
# Strings: key -> (en, id, zh_TW, zh_CN)
# -----------------------------------------------------------------------------
S = {
    # --- card ---
    "loading": ("Loading...", "Memuat...", "載入中...", "加载中..."),
    "idle": ("○ Idle", "○ Diam", "○ 閒置", "○ 空闲"),
    "focus": ("● Focus", "● Fokus", "● 專注", "● 专注"),
    "paused": ("● Paused", "● Jeda", "● 暫停", "● 暂停"),
    "break_m": ("● Break {m}m", "● Istirahat {m}m", "● 休息 {m} 分", "● 休息 {m} 分"),
    "start": ("▶ Start", "▶ Mulai", "▶ 開始", "▶ 开始"),
    "pause": ("⏸ Pause", "⏸ Jeda", "⏸ 暫停", "⏸ 暂停"),
    "reset": ("↻ Reset", "↻ Ulang", "↻ 重設", "↻ 重置"),
    "muted": ("Muted", "Bisu", "靜音", "静音"),
    "sound": ("Sound", "Suara", "聲音", "声音"),
    "dashboard_btn": ("Dashboard ›", "Dasbor ›", "儀表板 ›", "仪表板 ›"),
    "click_to_start": ("click to start", "klik untuk mulai", "點擊開始", "点击开始"),
    "ready": ("Ready when you are ✦", "Siap kapan pun kamu mau ✦", "準備好就開始吧 ✦", "准备好就开始吧 ✦"),
    "break_time_hint": ("Break time · stretch & sip some water", "Istirahat · regangkan badan & minum air",
                        "休息時間 · 伸展一下、喝點水", "休息时间 · 伸展一下、喝点水"),
    "paused_hint": ("Paused · click the ring to resume", "Jeda · klik lingkaran untuk lanjut",
                    "已暫停 · 點擊圓環繼續", "已暂停 · 点击圆环继续"),
    "this_pomo": ("This pomodoro: {m}m", "Pomodoro ini: {m}m", "本次番茄鐘: {m} 分", "本次番茄钟: {m} 分"),
    "this_pomo_app": ("This pomodoro: {m}m · {app}", "Pomodoro ini: {m}m · {app}",
                      "本次番茄鐘: {m} 分 · {app}", "本次番茄钟: {m} 分 · {app}"),
    "today_total": ("Today · {h}h {m}m", "Hari ini · {h}j {m}m", "今天 · {h} 小時 {m} 分", "今天 · {h} 小时 {m} 分"),
    "ai_tokens": ("AI · {n} tok today", "AI · {n} token hari ini", "AI · 今天 {n} tok", "AI · 今天 {n} tok"),
    "maas_tokens": ("MAAS · {n} tok today", "MAAS · {n} token hari ini", "MAAS · 今天 {n} tok", "MAAS · 今天 {n} tok"),
    "break_ends": ("Break ends in {m}:{s}", "Istirahat selesai dalam {m}:{s}", "休息將在 {m}:{s} 後結束",
                   "休息将在 {m}:{s} 后结束"),
    "done": ("Done", "Selesai", "完成", "完成"),
    "snooze5": ("Snooze 5 min", "Tunda 5 menit", "稍後 5 分鐘", "稍后 5 分钟"),

    # --- dashboard / history ---
    "dash_title": ("Dashboard", "Dasbor", "儀表板", "仪表板"),
    "dash_heading": ("Today's Dashboard", "Dasbor Hari Ini", "今日儀表板", "今日仪表板"),
    "time_split": ("Today's Time Split", "Pembagian Waktu Hari Ini", "今日時間分配", "今日时间分配"),
    "top_apps": ("Top Apps Today", "Aplikasi Teratas Hari Ini", "今日常用應用程式", "今日常用应用"),
    "score_trend": ("7-Day Score Trend", "Tren Skor 7 Hari", "7 天分數趨勢", "7 天分数趋势"),
    "heatmap": ("Hour-of-Day Heatmap (Last 7 Days)", "Peta Panas per Jam (7 Hari Terakhir)",
                "每小時熱力圖 (最近 7 天)", "每小时热力图 (最近 7 天)"),
    "click_chart": ("Click a chart element for details", "Klik elemen grafik untuk detail",
                    "點擊圖表查看詳細資料", "点击图表查看详细信息"),
    "focus_timeline": ("Focus Timeline (Today)", "Linimasa Fokus (Hari Ini)", "專注時間軸 (今天)", "专注时间轴 (今天)"),
    "pomos_7d": ("Pomodoros (Last 7 days)", "Pomodoro (7 hari terakhir)", "番茄鐘 (最近 7 天)", "番茄钟 (最近 7 天)"),
    "ai_7d": ("AI Tokens (Last 7 days)", "Token AI (7 hari terakhir)", "AI Token (最近 7 天)", "AI Token (最近 7 天)"),
    "maas_usage": ("MAAS Token Usage (account)", "Pemakaian Token MAAS (akun)", "MAAS Token 用量 (帳號)",
                   "MAAS Token 用量 (账号)"),
    "goals": ("Goals Progress", "Progres Target", "目標進度", "目标进度"),
    "deep_work": ("Deep Work:", "Kerja Fokus:", "深度工作:", "深度工作:"),
    "pomodoros_lbl": ("Pomodoros:", "Pomodoro:", "番茄鐘:", "番茄钟:"),
    "streak_xp": ("Streak & XP", "Streak & XP", "連續天數與經驗值", "连续天数与经验值"),
    "streak": ("Streak: {n} days", "Streak: {n} hari", "連續: {n} 天", "连续: {n} 天"),
    "xp": ("XP: {n}", "XP: {n}", "經驗值: {n}", "经验值: {n}"),
    "coach": ("Coach", "Pelatih", "教練", "教练"),
    "close": ("Close", "Tutup", "關閉", "关闭"),
    "no_data": ("No data", "Tidak ada data", "沒有資料", "没有数据"),
    "no_hour_data": ("No hour data", "Tidak ada data jam", "沒有每小時資料", "没有每小时数据"),
    "no_token_data": ("No token data", "Tidak ada data token", "沒有 token 資料", "没有 token 数据"),
    "less": ("less", "sedikit", "少", "少"),
    "more": ("more", "banyak", "多", "多"),
    "total": ("total", "total", "總計", "总计"),
    "clicked_open": ("Clicked: {day} - opening history...", "Diklik: {day} - membuka riwayat...",
                     "已點擊: {day} - 開啟歷史紀錄...", "已点击: {day} - 打开历史记录..."),
    "clicked_at": ("Clicked: {day} at {hour}:00", "Diklik: {day} pukul {hour}:00", "已點擊: {day} {hour}:00",
                   "已点击: {day} {hour}:00"),
    "hist_title": ("History", "Riwayat", "歷史紀錄", "历史记录"),
    "prev": ("◀ Prev", "◀ Sebelumnya", "◀ 上一天", "◀ 上一天"),
    "next": ("Next ▶", "Berikutnya ▶", "下一天 ▶", "下一天 ▶"),
    "today": ("Today", "Hari ini", "今天", "今天"),
    "score": ("Score: {s}", "Skor: {s}", "分數: {s}", "分数: {s}"),
    "pomos_n": ("Pomodoros: {n}", "Pomodoro: {n}", "番茄鐘: {n}", "番茄钟: {n}"),

    # --- card right-click menu ---
    "m_dashboard": ("Dashboard", "Dasbor", "儀表板", "仪表板"),
    "m_history": ("History", "Riwayat", "歷史紀錄", "历史记录"),
    "m_weekly": ("Weekly Report", "Laporan Mingguan", "每週報告", "每周报告"),
    "m_monthly": ("Monthly Report", "Laporan Bulanan", "每月報告", "每月报告"),
    "m_gen_diary": ("Generate Diary Now", "Buat Diary Sekarang", "立即產生日記", "立即生成日记"),
    "m_open_diary": ("Open Diary Folder", "Buka Folder Diary", "開啟日記資料夾", "打开日记文件夹"),
    "m_publish": ("Publish Diary to GitHub", "Terbitkan Diary ke GitHub", "發佈日記到 GitHub", "发布日记到 GitHub"),
    "m_refresh_maas": ("Refresh MAAS Tokens", "Segarkan Token MAAS", "重新整理 MAAS Token", "刷新 MAAS Token"),
    "m_sound": ("Sound", "Suara", "聲音", "声音"),
    "m_pet": ("Pet ({name})", "Peliharaan ({name})", "寵物 ({name})", "宠物 ({name})"),
    "m_hide_pet": ("Hide {name}", "Sembunyikan {name}", "隱藏 {name}", "隐藏 {name}"),
    "m_show_pet": ("Show {name}", "Tampilkan {name}", "顯示 {name}", "显示 {name}"),
    "m_snack": ("Give a snack ♨", "Kasih camilan ♨", "給點心 ♨", "给点心 ♨"),
    "m_pet_settings": ("Pet status & settings…", "Status & pengaturan peliharaan…", "寵物狀態與設定…",
                       "宠物状态与设置…"),
    "m_hide_to_pet": ("Hide window to pet", "Sembunyikan jendela ke peliharaan", "把視窗收到寵物",
                      "把窗口收到宠物"),
    "m_autostart": ("Autostart", "Mulai otomatis", "開機自動啟動", "开机自动启动"),
    "m_quit": ("Quit", "Keluar", "結束", "退出"),
    "m_language": ("Language", "Bahasa", "語言", "语言"),

    # --- reminders ---
    "rem_break": ("Break time", "Waktunya istirahat", "休息時間", "休息时间"),
    "rem_eye": ("Eye rest (20-20-20)", "Istirahat mata (20-20-20)", "護眼時間 (20-20-20)", "护眼时间 (20-20-20)"),
    "rem_hydration": ("Drink water", "Minum air", "喝水", "喝水"),

    # --- pet: menu ---
    "p_open": ("Open focus timer", "Buka timer fokus", "開啟專注計時", "打开专注计时"),
    "p_hide_window": ("Hide focus timer", "Sembunyikan timer fokus", "隱藏專注計時", "隐藏专注计时"),
    "p_dashboard": ("Dashboard", "Dasbor", "儀表板", "仪表板"),
    "p_snack": ("Give a snack ♨", "Kasih camilan ♨", "給點心 ♨", "给点心 ♨"),
    "p_pet": ("Pet {name} ♥", "Elus {name} ♥", "摸摸 {name} ♥", "摸摸 {name} ♥"),
    "p_wake": ("Wake up ☀", "Bangunkan ☀", "叫醒 ☀", "叫醒 ☀"),
    "p_sleep": ("Put to sleep ☾", "Tidurkan ☾", "哄睡 ☾", "哄睡 ☾"),
    "p_float": ("Float on desktop", "Melayang di desktop", "飄在桌面上", "飘在桌面上"),
    "p_taskbar": ("Go to the taskbar", "Pergi ke taskbar", "到工作列去", "到任务栏去"),
    "p_colour": ("Colour", "Warna", "顏色", "颜色"),
    "p_custom": ("Custom…", "Pilih sendiri…", "自訂…", "自定义…"),
    "p_ears": ("Ears", "Telinga", "耳朵", "耳朵"),
    "p_size": ("Size", "Ukuran", "大小", "大小"),
    "p_click": ("When I click", "Saat aku diklik", "點擊我時", "点击我时"),
    "p_click_open": ("Tickle + open focus timer", "Gelitik + buka timer fokus", "搔癢 + 開啟專注計時", "挠痒 + 打开专注计时"),
    "p_click_only": ("Just tickle (double-click opens Pips)", "Gelitik saja (klik dua kali buka Pips)",
                     "只搔癢 (雙擊開啟 Pips)", "只挠痒 (双击打开 Pips)"),
    "p_click_never": ("Only tickle (never open Pips)", "Hanya gelitik (tidak membuka Pips)",
                      "只搔癢 (不開啟 Pips)", "只挠痒 (不打开 Pips)"),
    "p_settings": ("Pet status & settings…", "Status & pengaturan peliharaan…", "寵物狀態與設定…", "宠物状态与设置…"),
    "p_hide": ("Hide {name}", "Sembunyikan {name}", "隱藏 {name}", "隐藏 {name}"),
    "p_quit": ("Quit Pips", "Keluar dari Pips", "結束 Pips", "退出 Pips"),
    "p_pick_colour": ("Pick {name}'s colour", "Pilih warna {name}", "選擇 {name} 的顏色", "选择 {name} 的颜色"),
    "ear_cat": ("Cat", "Kucing", "貓", "猫"),
    "ear_bunny": ("Bunny", "Kelinci", "兔子", "兔子"),
    "ear_bear": ("Bear", "Beruang", "熊", "熊"),
    "ear_blob": ("Blob (sprout)", "Blob (tunas)", "團子 (嫩芽)", "团子 (嫩芽)"),
    "size_S": ("Small", "Kecil", "小", "小"),
    "size_M": ("Medium", "Sedang", "中", "中"),
    "size_L": ("Large", "Besar", "大", "大"),
    "col_Peach": ("Peach", "Persik", "蜜桃", "蜜桃"),
    "col_Bubblegum": ("Bubblegum", "Permen karet", "泡泡糖", "泡泡糖"),
    "col_Mint": ("Mint", "Mint", "薄荷", "薄荷"),
    "col_Sky": ("Sky", "Langit", "天空", "天空"),
    "col_Lavender": ("Lavender", "Lavender", "薰衣草", "薰衣草"),
    "col_Lemon": ("Lemon", "Lemon", "檸檬", "柠檬"),
    "col_Snow": ("Snow", "Salju", "雪白", "雪白"),
    "col_Cocoa": ("Cocoa", "Cokelat", "可可", "可可"),
    "col_Charcoal": ("Charcoal", "Arang", "炭灰", "炭灰"),
    "col_Pips Red": ("Pips Red", "Merah Pips", "Pips 紅", "Pips 红"),

    # --- pet: moods ---
    "mood_happy": ("very happy", "sangat senang", "超開心", "超开心"),
    "mood_content": ("happy", "senang", "開心", "开心"),
    "mood_okay": ("okay", "biasa saja", "還好", "还好"),
    "mood_sad": ("sad", "sedih", "難過", "难过"),
    "mood_very_sad": ("very sad", "sangat sedih", "非常難過", "非常难过"),
    "mood_tired": ("tired", "capek", "很累", "很累"),
    "mood_hungry": ("hungry", "lapar", "肚子餓", "肚子饿"),
    "mood_grumpy": ("grumpy", "cemberut", "不高興", "不高兴"),
    "mood_sleeping": ("sleeping", "tidur", "睡覺中", "睡觉中"),
    "mood_phrase": ("{name} feels {mood}", "{name} merasa {mood}", "{name} 覺得{mood}", "{name} 觉得{mood}"),
    "sleeping_phrase": ("{name} is sleeping ☾", "{name} sedang tidur ☾", "{name} 正在睡覺 ☾", "{name} 正在睡觉 ☾"),

    # --- pet: settings window ---
    "s_title": ("{name} · pet settings", "{name} · pengaturan peliharaan", "{name} · 寵物設定", "{name} · 宠物设置"),
    "s_age": ("{d} days together · {p} pets · {s} snacks", "{d} hari bersama · {p} elusan · {s} camilan",
              "相處 {d} 天 · 摸摸 {p} 次 · 點心 {s} 個", "相处 {d} 天 · 摸摸 {p} 次 · 点心 {s} 个"),
    "bar_happy": ("Happy", "Senang", "快樂", "快乐"),
    "bar_energy": ("Energy", "Energi", "體力", "体力"),
    "bar_food": ("Food", "Makan", "飽足", "饱足"),
    "bar_bond": ("Bond", "Ikatan", "親密", "亲密"),
    "b_snack": ("Snack ♨", "Camilan ♨", "點心 ♨", "点心 ♨"),
    "b_pet": ("Pet ♥", "Elus ♥", "摸摸 ♥", "摸摸 ♥"),
    "b_sleep": ("Sleep ☾", "Tidur ☾", "睡覺 ☾", "睡觉 ☾"),
    "b_wake": ("Wake ☀", "Bangun ☀", "起床 ☀", "起床 ☀"),
    "b_tickle": ("Tickle", "Gelitik", "搔癢", "挠痒"),
    "sec_look": ("Look", "Tampilan", "外觀", "外观"),
    "sec_behaviour": ("Behaviour", "Perilaku", "行為", "行为"),
    "sec_language": ("Language", "Bahasa", "語言", "语言"),
    "l_name": ("Name", "Nama", "名字", "名字"),
    "l_colour": ("Colour", "Warna", "顏色", "颜色"),
    "l_cheeks": ("Cheeks", "Pipi", "腮紅", "腮红"),
    "l_ears": ("Ears", "Telinga", "耳朵", "耳朵"),
    "l_size": ("Size", "Ukuran", "大小", "大小"),
    "click_q": ("When I click the pet:", "Saat peliharaan diklik:", "點擊寵物時:", "点击宠物时:"),
    "click_open_long": ("Tickle it and open the focus timer (Pomodoro)", "Gelitik dan buka timer fokus (Pomodoro)", "搔癢並開啟專注計時 (番茄鐘)", "挠痒并打开专注计时 (番茄钟)"),
    "click_only_long": ("Just tickle it (double-click opens Pips)", "Gelitik saja (klik dua kali buka Pips)",
                        "只搔癢 (雙擊開啟 Pips)", "只挠痒 (双击打开 Pips)"),
    "click_never_long": ("Only tickle it - never open Pips (open it from the right-click menu)",
                         "Hanya gelitik - tidak pernah membuka Pips (buka lewat menu klik kanan)",
                         "只搔癢 - 永不開啟 Pips (從右鍵選單開啟)",
                         "只挠痒 - 永不打开 Pips (从右键菜单打开)"),
    "f_bubble_reminders": ("Show reminders & notifications as chat bubbles",
                           "Tampilkan pengingat & notifikasi sebagai gelembung chat",
                           "用對話泡泡顯示提醒與通知", "用对话气泡显示提醒与通知"),
    "f_walk_on_taskbar": ("Walk around on the taskbar", "Jalan-jalan di taskbar", "在工作列上散步", "在任务栏上散步"),
    "f_gravity": ("Gravity (falls to the taskbar when dropped)", "Gravitasi (jatuh ke taskbar saat dilepas)",
                  "重力 (放開時掉到工作列)", "重力 (松开时掉到任务栏)"),
    "f_sleep_when_away": ("Nap when I'm away from the PC", "Tidur saat aku tidak di depan PC",
                          "我離開電腦時打個盹", "我离开电脑时打个盹"),
    "f_open_near_pet": ("Open the Pips window next to the pet", "Buka jendela Pips di dekat peliharaan",
                        "在寵物旁邊開啟 Pips 視窗", "在宠物旁边打开 Pips 窗口"),
    "f_start_with_card": ("Show the Pips window at startup", "Tampilkan jendela Pips saat mulai",
                          "啟動時顯示 Pips 視窗", "启动时显示 Pips 窗口"),
    "f_chatty": ("Chatty (little messages now and then)", "Cerewet (pesan kecil sesekali)",
                 "愛聊天 (偶爾說說話)", "爱聊天 (偶尔说说话)"),
    "f_hide_in_fullscreen": ("Hide during full-screen apps", "Sembunyi saat aplikasi layar penuh",
                             "全螢幕應用時隱藏", "全屏应用时隐藏"),
    "s_tip": ("Tip: rub the mouse back & forth over {name} to pet it.",
              "Tips: gosok mouse bolak-balik di atas {name} untuk mengelusnya.",
              "小技巧: 滑鼠在 {name} 身上來回滑動就能摸摸牠。",
              "小技巧: 鼠标在 {name} 身上来回滑动就能摸摸它。"),
    "pick_colour": ("Pick a colour", "Pilih warna", "選擇顏色", "选择颜色"),

    # --- pet: bubbles ---
    "hungry_prompt": ("I'm getting hungry… snack? ♨", "Aku mulai lapar… camilan? ♨", "我肚子有點餓了… 點心? ♨",
                      "我肚子有点饿了… 点心? ♨"),
    "feed_me": ("Feed me", "Kasih makan", "餵我", "喂我"),
    "too_full": ("I'm so full~ ♨ maybe later!", "Aku kenyang banget~ ♨ nanti aja ya!", "我好飽~ ♨ 等一下再吃!",
                 "我好饱~ ♨ 等一下再吃!"),
    "goodnight": ("good night~ ☾", "selamat tidur~ ☾", "晚安~ ☾", "晚安~ ☾"),
    "hmph": ("hmph.", "hmph.", "哼。", "哼。"),
    "pomo_done": ("Pomodoro done! ★{extra}\nTime to stretch~", "Pomodoro selesai! ★{extra}\nWaktunya peregangan~",
                  "番茄鐘完成! ★{extra}\n來伸展一下吧~", "番茄钟完成! ★{extra}\n来伸展一下吧~"),
    "pomo_today": (" ({n} today)", " ({n} hari ini)", " (今天第 {n} 個)", " (今天第 {n} 个)"),
    "distracted": ("psst… {app}? We're in focus time ⌛", "psst… {app}? Kita lagi waktu fokus lho ⌛",
                   "欸… {app}? 現在是專注時間喔 ⌛", "欸… {app}? 现在是专注时间哦 ⌛"),
    "goal_reached": ("We hit today's goal!! ★★★\nI'm so proud of you!", "Target hari ini tercapai!! ★★★\nAku bangga sama kamu!",
                     "達成今天的目標了!! ★★★\n我好以你為榮!", "达成今天的目标了!! ★★★\n我好为你骄傲!"),
    "card_hidden": ("I'll keep it safe~ click me to open Pips ✦", "Aku jagain ya~ klik aku untuk buka Pips ✦",
                    "我幫你收好囉~ 點我開啟 Pips ✦", "我帮你收好咯~ 点我打开 Pips ✦"),
    "okay_btn": ("Okay!", "Oke!", "好!", "好!"),
    "snooze_btn": ("Snooze 5m", "Tunda 5m", "稍後 5 分", "稍后 5 分"),
    "done_btn": ("Done ✓", "Selesai ✓", "完成 ✓", "完成 ✓"),
    "greet_morning": ("Good morning! ☀", "Selamat pagi! ☀", "早安! ☀", "早上好! ☀"),
    "greet_afternoon": ("Good afternoon! ♪", "Selamat siang! ♪", "午安! ♪", "下午好! ♪"),
    "greet_evening": ("Good evening~ ☾", "Selamat malam~ ☾", "晚上好~ ☾", "晚上好~ ☾"),
    "greet_late": ("It's late… don't stay up too long ☾", "Sudah larut… jangan begadang ya ☾",
                   "很晚了… 別熬夜太久喔 ☾", "很晚了… 别熬夜太久哦 ☾"),
    "missed_you": ("I missed you! ♥ ", "Aku kangen kamu! ♥ ", "好想你! ♥ ", "好想你! ♥ "),
    "first_hi": ("Hi! I'm {name} ♥\nClick me to open Pips, drag me anywhere, rub me for pets!",
                 "Hai! Aku {name} ♥\nKlik aku untuk buka Pips, seret aku ke mana saja, gosok aku untuk dielus!",
                 "嗨! 我是 {name} ♥\n點我開啟 Pips, 可以把我拖到任何地方, 來回滑動就能摸摸我!",
                 "嗨! 我是 {name} ♥\n点我打开 Pips, 可以把我拖到任何地方, 来回滑动就能摸摸我!"),
    "click_to_open": ("\nClick me to open Pips ✦", "\nKlik aku untuk buka Pips ✦", "\n點我開啟 Pips ✦",
                      "\n点我打开 Pips ✦"),
    "lang_changed": ("Okay! I'll speak English now ♪", "Oke! Sekarang aku pakai Bahasa Indonesia ♪",
                     "好的! 我現在說繁體中文囉 ♪", "好的! 我现在说简体中文咯 ♪"),

    # --- animals ---
    "p_animal": ("Animal", "Hewan", "動物", "动物"),
    "cat_land": ("Land", "Darat", "陸地", "陆地"),
    "cat_water": ("Water", "Air", "水中", "水中"),
    "cat_air": ("Sky", "Udara", "天空", "天空"),
    "sp_cat": ("Cat", "Kucing", "貓咪", "猫咪"),
    "sp_dog": ("Dog", "Anjing", "狗狗", "狗狗"),
    "sp_bunny": ("Bunny", "Kelinci", "兔子", "兔子"),
    "sp_bear": ("Bear", "Beruang", "熊熊", "熊熊"),
    "sp_panda": ("Panda", "Panda", "熊貓", "熊猫"),
    "sp_fox": ("Fox", "Rubah", "狐狸", "狐狸"),
    "sp_hamster": ("Hamster", "Hamster", "倉鼠", "仓鼠"),
    "sp_pig": ("Piggy", "Babi", "小豬", "小猪"),
    "sp_sprout": ("Sprout", "Tunas", "小芽", "小芽"),
    "sp_fish": ("Fish", "Ikan", "小魚", "小鱼"),
    "sp_whale": ("Whale", "Paus", "鯨魚", "鲸鱼"),
    "sp_octopus": ("Octopus", "Gurita", "章魚", "章鱼"),
    "sp_axolotl": ("Axolotl", "Axolotl", "六角恐龍", "六角恐龙"),
    "sp_penguin": ("Penguin", "Penguin", "企鵝", "企鹅"),
    "sp_turtle": ("Turtle", "Kura-kura", "烏龜", "乌龟"),
    "sp_frog": ("Frog", "Katak", "青蛙", "青蛙"),
    "sp_jellyfish": ("Jellyfish", "Ubur-ubur", "水母", "水母"),
    "sp_bird": ("Birdie", "Burung", "小鳥", "小鸟"),
    "sp_owl": ("Owl", "Burung hantu", "貓頭鷹", "猫头鹰"),
    "sp_bat": ("Bat", "Kelelawar", "蝙蝠", "蝙蝠"),
    "sp_bee": ("Bee", "Lebah", "蜜蜂", "蜜蜂"),
    "sp_butterfly": ("Butterfly", "Kupu-kupu", "蝴蝶", "蝴蝶"),
    "sp_dragon": ("Dragon", "Naga", "小龍", "小龙"),

    # --- interactive guide (first run) ---
    "tour_welcome": ("Hi! I'm {name}, your new desk buddy \u2665\nLet me show you around - it takes about 1 minute.",
                     "Hai! Aku {name}, teman barumu di meja \u2665\nYuk aku tunjukkan caranya - cuma sekitar 1 menit.",
                     "嗨! 我是 {name}, 你的新桌面夥伴 \u2665\n讓我帶你逛一圈 - 大約 1 分鐘。",
                     "嗨! 我是 {name}, 你的新桌面伙伴 \u2665\n让我带你逛一圈 - 大约 1 分钟。"),
    "tour_go": ("Let's go!", "Ayo mulai!", "開始吧!", "开始吧!"),
    "tour_skip": ("Skip guide", "Lewati panduan", "跳過導覽", "跳过引导"),
    "tour_next": ("Next \u203a", "Lanjut \u203a", "下一步 \u203a", "下一步 \u203a"),
    "tour_done_btn": ("Done \u2713", "Selesai \u2713", "完成 \u2713", "完成 \u2713"),
    "tour_click": ("Step 1/6 \u00b7 Click me once - go on, try it!",
                   "Langkah 1/6 \u00b7 Klik aku sekali - ayo coba!",
                   "步驟 1/6 \u00b7 點我一下 - 試試看!",
                   "步骤 1/6 \u00b7 点我一下 - 试试看!"),
    "tour_card": ("Step 2/6 · Hehe, that tickles! Clicking me opens your Pips hub: friends, chat, groups and the shop (earn coins to buy props and moves for me!). The focus timer lives in right-click → Focus timer.", "Langkah 2/6 · Hehe, geli! Klik aku membuka hub Pips: teman, chat, grup dan toko (kumpulkan koin untuk membeli aksesori dan gerakan untukku!). Timer fokus ada di klik kanan → Timer fokus.", "步驟 2/6 · 嘿嘿，好癢！點我會開啟 Pips 中心：好友、聊天、群組和商店 (賺金幣幫我買配件和招式！)。專注計時在右鍵 → 專注計時。", "步骤 2/6 · 嘿嘿，好痒！点我会打开 Pips 中心：好友、聊天、群组和商店 (赚金币帮我买配件和招式！)。专注计时在右键 → 专注计时。"),
    "tour_drag": ("Step 3/6 \u00b7 Drag me anywhere!\nDrop me on the taskbar and I'll walk along it.",
                  "Langkah 3/6 \u00b7 Seret aku ke mana saja!\nLepaskan aku di taskbar dan aku akan jalan-jalan di sana.",
                  "步驟 3/6 \u00b7 把我拖到任何地方!\n放在工作列上我就會在那裡散步。",
                  "步骤 3/6 \u00b7 把我拖到任何地方!\n放在任务栏上我就会在那里散步。"),
    "tour_pet": ("Step 4/6 \u00b7 Wheee! Now rub your mouse back and forth over me to pet me \u2665",
                 "Langkah 4/6 \u00b7 Wiii! Sekarang gosok mouse bolak-balik di atasku untuk mengelusku \u2665",
                 "步驟 4/6 \u00b7 咻~! 現在用滑鼠在我身上來回滑動摸摸我 \u2665",
                 "步骤 4/6 \u00b7 咻~! 现在用鼠标在我身上来回滑动摸摸我 \u2665"),
    "tour_menu": ("Step 5/6 \u00b7 Purrr~ \u2665 Now right-click me!\nThat's where everything lives: snacks, sleep, 23 animals, colours, language and settings.",
                  "Langkah 5/6 \u00b7 Purrr~ \u2665 Sekarang klik kanan aku!\nSemua ada di sana: camilan, tidur, 23 hewan, warna, bahasa, dan pengaturan.",
                  "步驟 5/6 \u00b7 呼嚕~ \u2665 現在對我按右鍵!\n所有功能都在那裡: 點心、睡覺、23 種動物、顏色、語言和設定。",
                  "步骤 5/6 \u00b7 呼噜~ \u2665 现在对我按右键!\n所有功能都在那里: 点心、睡觉、23 种动物、颜色、语言和设置。"),
    "tour_moods": ("Step 6/6 \u00b7 I have moods! Pet me, feed me and finish pomodoros to keep me happy.\nI nap when you're away and remind you to take breaks and drink water.",
                   "Langkah 6/6 \u00b7 Aku punya perasaan! Elus, kasih makan, dan selesaikan pomodoro supaya aku senang.\nAku tidur saat kamu pergi dan mengingatkanmu istirahat dan minum air.",
                   "步驟 6/6 \u00b7 我有心情喔! 摸摸我、餵我、完成番茄鐘我就會開心。\n你離開時我會打盹, 也會提醒你休息和喝水。",
                   "步骤 6/6 \u00b7 我有心情哦! 摸摸我、喂我、完成番茄钟我就会开心。\n你离开时我会打盹, 也会提醒你休息和喝水。"),
    "tour_finish": ("You're all set! \u2605\nReplay this guide anytime: right-click me \u2192 Help \u2192 Interactive guide.",
                    "Siap semuanya! \u2605\nPutar ulang panduan kapan saja: klik kanan aku \u2192 Bantuan \u2192 Panduan interaktif.",
                    "全部完成! \u2605\n隨時可以重播導覽: 對我按右鍵 \u2192 說明 \u2192 互動導覽。",
                    "全部完成! \u2605\n随时可以重播引导: 对我按右键 \u2192 帮助 \u2192 互动引导。"),

    # --- help menu & updates ---
    "m_help": ("Help", "Bantuan", "說明", "帮助"),
    "m_guide": ("Interactive guide", "Panduan interaktif", "互動導覽", "互动引导"),
    "m_check_updates": ("Check for updates", "Cek update", "檢查更新", "检查更新"),
    "m_user_guide": ("User guide (PPT)", "Buku panduan (PPT)", "使用手冊 (PPT)", "使用手册 (PPT)"),
    "m_about": ("About Pips (v{v})", "Tentang Pips (v{v})", "關於 Pips (v{v})", "关于 Pips (v{v})"),
    "about_text": ("Pips {v} · your social desktop pet\nMade by {owner} (owner) · {email}\njuw12.github.io/projects/pips", "Pips {v} · peliharaan desktop sosialmu\nDibuat oleh {owner} (pemilik) · {email}\njuw12.github.io/projects/pips", "Pips {v} · 你的社交桌面寵物\n由 {owner}（擁有者）製作 · {email}\njuw12.github.io/projects/pips", "Pips {v} · 你的社交桌面宠物\n由 {owner}（所有者）制作 · {email}\njuw12.github.io/projects/pips"),
    "upd_available": ("New version {v} is here! \u2726\n{notes}",
                      "Versi baru {v} sudah ada! \u2726\n{notes}",
                      "新版本 {v} 來了! \u2726\n{notes}",
                      "新版本 {v} 来了! \u2726\n{notes}"),
    "upd_now": ("Update now", "Update sekarang", "立即更新", "立即更新"),
    "upd_later": ("Later", "Nanti", "稍後", "稍后"),
    "upd_skip": ("Skip this version", "Lewati versi ini", "略過此版本", "跳过此版本"),
    "upd_downloading": ("Downloading the update\u2026", "Mengunduh update\u2026", "正在下載更新\u2026", "正在下载更新\u2026"),
    "upd_installing": ("Installing\u2026 your settings stay safe", "Memasang\u2026 pengaturanmu tetap aman",
                       "正在安裝\u2026 你的設定會保留", "正在安装\u2026 你的设置会保留"),
    "upd_done": ("Updated to {v}! Restarting\u2026 \u2726", "Sudah update ke {v}! Memulai ulang\u2026 \u2726",
                 "已更新到 {v}! 重新啟動中\u2026 \u2726", "已更新到 {v}! 重新启动中\u2026 \u2726"),
    "upd_failed": ("The update didn't work: {err}\nYou can also download it from the website.",
                   "Update gagal: {err}\nKamu juga bisa mengunduhnya dari website.",
                   "更新失敗: {err}\n也可以從網站下載。",
                   "更新失败: {err}\n也可以从网站下载。"),
    "upd_latest": ("You have the latest version ({v}) \u2713", "Kamu sudah pakai versi terbaru ({v}) \u2713",
                   "你已經是最新版本 ({v}) \u2713", "你已经是最新版本 ({v}) \u2713"),
    "upd_offline": ("Couldn't check for updates right now (no connection?)",
                    "Tidak bisa cek update sekarang (tidak ada koneksi?)",
                    "目前無法檢查更新 (沒有網路?)", "目前无法检查更新 (没有网络?)"),
    "upd_open_site": ("Open website", "Buka website", "開啟網站", "打开网站"),
    "f_auto_update": ("Check for updates automatically", "Cek update otomatis", "自動檢查更新", "自动检查更新"),

    # --- pet sounds ---
    "f_sounds": ("Animal sounds (voice changes with mood)", "Suara hewan (berubah sesuai mood)",
                 "動物叫聲 (隨心情變化)", "动物叫声 (随心情变化)"),
    "f_quiet_focus": ("Stay quiet while I'm focusing", "Diam saat aku sedang fokus",
                      "專注時保持安靜", "专注时保持安静"),
    "l_volume": ("Volume", "Volume", "音量", "音量"),
    "b_hear": ("\u25b6 Hear me", "\u25b6 Dengar", "\u25b6 聽聽看", "\u25b6 听听看"),
    "p_sounds": ("Sounds", "Suara", "聲音", "声音"),

    # --- friends, levels & achievements ---
    "p_friends": ("Pips hub: friends, chat & shop…", "Hub Pips: teman, chat & toko…", "Pips 中心：好友、聊天、商店…", "Pips 中心：好友、聊天、商店…"),
    "fr_title": ("Pips hub", "Hub Pips", "Pips 中心", "Pips 中心"),
    "fr_tab_friends": ("Friends", "Teman", "好友", "好友"),
    "fr_tab_teams": ("Teams", "Tim", "團隊", "团队"),
    "fr_tab_achievements": ("Badges", "Lencana", "徽章", "徽章"),
    "fr_level_line": ("Level {level} \u00b7 {xp} XP", "Level {level} \u00b7 {xp} XP", "等級 {level} \u00b7 {xp} XP",
                      "等级 {level} \u00b7 {xp} XP"),
    "fr_stats_line": ("Today {today} pomodoros \u00b7 week {week} \u00b7 streak {streak} days",
                      "Hari ini {today} pomodoro \u00b7 minggu ini {week} \u00b7 streak {streak} hari",
                      "今天 {today} 個番茄 \u00b7 本週 {week} \u00b7 連續 {streak} 天",
                      "今天 {today} 个番茄 \u00b7 本周 {week} \u00b7 连续 {streak} 天"),
    "fr_off_title": ("Focus together with friends", "Fokus bareng teman", "和朋友一起專注", "和朋友一起专注"),
    "fr_off_body": ("Turn on Friends to add colleagues with a friend code, chat, visit each other's desktops, climb the Pips ranks and show off your profile. It's off until you turn it on.", "Aktifkan Teman untuk menambah rekan dengan kode teman, chat, saling berkunjung ke desktop, naik peringkat Pips dan pamerkan profilmu. Fitur ini mati sampai kamu menyalakannya.", "開啟好友功能，就能用好友代碼加同事、聊天、互訪桌面、挑戰 Pips 排行並展示你的個人檔案。在你開啟之前都是關閉的。", "开启好友功能，就能用好友代码加同事、聊天、互访桌面、挑战 Pips 排行并展示你的个人资料。在你开启之前都是关闭的。"),
    "fr_shared": ("Shared: display name, your pet & props, level, XP, streak, badges, online status and the profile you fill in (photo, bio, info - only friends see it if your profile is private). Never shared: app names, window titles, scores or files.", "Yang dibagikan: nama, peliharaan & aksesori, level, XP, beruntun, lencana, status online dan profil yang kamu isi (foto, bio, info - hanya teman yang bisa melihat jika profilmu pribadi). Tidak pernah dibagikan: nama aplikasi, judul jendela, skor atau file.", "會分享：名稱、寵物與配件、等級、經驗值、連續天數、徽章、在線狀態，以及你填寫的個人檔案（照片、自我介紹、資訊；設為私人時只有好友看得到）。絕不分享：應用程式名稱、視窗標題、分數或檔案。", "会分享：名称、宠物与配件、等级、经验值、连续天数、徽章、在线状态，以及你填写的个人资料（照片、简介、信息；设为私密时只有好友看得到）。绝不分享：应用名称、窗口标题、分数或文件。"),
    "fr_your_name": ("Your name:", "Namamu:", "你的名字：", "你的名字："),
    "fr_turn_on": ("Turn on Friends", "Aktifkan Teman", "開啟好友", "开启好友"),
    "fr_turn_off": ("Turn off & delete my online data", "Matikan & hapus data online-ku",
                    "關閉並刪除我的線上資料", "关闭并删除我的在线数据"),
    "fr_turn_off_q": ("Turn off Friends and delete your profile, friends and teams from the server?",
                      "Matikan Teman dan hapus profil, teman dan timmu dari server?",
                      "要關閉好友並從伺服器刪除你的個人資料、好友和團隊嗎？",
                      "要关闭好友并从服务器删除你的个人资料、好友和团队吗？"),
    "fr_your_code": ("Your friend code:", "Kode temanmu:", "你的好友代碼：", "你的好友代码："),
    "fr_copy": ("Copy", "Salin", "複製", "复制"),
    "fr_copied": ("Copied - send it to a friend!", "Disalin - kirim ke temanmu!", "已複製，傳給朋友吧！",
                  "已复制，发给朋友吧！"),
    "fr_add": ("Add friend", "Tambah teman", "加好友", "加好友"),
    "fr_add_hint": ("Type a friend's 6-letter code", "Ketik kode 6 huruf temanmu", "輸入朋友的 6 位代碼",
                    "输入朋友的 6 位代码"),
    "fr_today_board": ("Your friends", "Teman-temanmu", "你的好友", "你的好友"),
    "fr_no_friends": ("No friends yet - share your code and add theirs. Friendships go both ways.",
                      "Belum ada teman - bagikan kodemu dan tambahkan kode mereka. Pertemanan berlaku dua arah.",
                      "還沒有好友，分享你的代碼並加入他們的代碼，好友是雙向的。",
                      "还没有好友，分享你的代码并添加他们的代码，好友是双向的。"),
    "fr_you": ("(you)", "(kamu)", "(你)", "(你)"),
    "fr_row_line": ("Lv {level} \u00b7 streak {streak} \u00b7 {n} badges", "Lv {level} \u00b7 streak {streak} \u00b7 {n} lencana",
                    "等級 {level} \u00b7 連續 {streak} \u00b7 {n} 徽章", "等级 {level} \u00b7 连续 {streak} \u00b7 {n} 徽章"),
    "fr_poms_value": ("{today} today / {week} wk", "{today} hari ini / {week} mgg", "今天 {today} / 週 {week}",
                      "今天 {today} / 周 {week}"),
    "fr_week_value": ("{n} this week", "{n} minggu ini", "本週 {n}", "本周 {n}"),
    "fr_remove_q": ("Remove {name} from your friends?", "Hapus {name} dari temanmu?", "要把 {name} 從好友移除嗎？",
                    "要把 {name} 从好友移除吗？"),
    "fr_team_code": ("Team code:", "Kode tim:", "團隊代碼：", "团队代码："),
    "fr_join": ("Join", "Gabung", "加入", "加入"),
    "fr_team_hint": ("Anyone who types the same code joins the same team board, e.g. PTB or your department name.",
                     "Siapa pun yang mengetik kode yang sama masuk ke papan tim yang sama, mis. PTB atau nama departemenmu.",
                     "輸入相同代碼的人會加入同一個團隊排行榜，例如 PTB 或部門名稱。",
                     "输入相同代码的人会加入同一个团队排行榜，例如 PTB 或部门名称。"),
    "fr_no_teams": ("You're not in a team yet.", "Kamu belum ada di tim.", "你還沒有加入團隊。", "你还没有加入团队。"),
    "fr_team_head": ("Team {team} \u00b7 {n} members", "Tim {team} \u00b7 {n} anggota", "團隊 {team} \u00b7 {n} 人",
                     "团队 {team} \u00b7 {n} 人"),
    "fr_leave": ("leave", "keluar", "退出", "退出"),
    "fr_ach_count": ("{n} of {total} unlocked", "{n} dari {total} terbuka", "已解鎖 {n} / {total}",
                     "已解锁 {n} / {total}"),
    "fr_connecting": ("Connecting\u2026", "Menghubungkan\u2026", "連線中\u2026", "连接中\u2026"),
    "fr_updated": ("Updated {time}", "Diperbarui {time}", "更新於 {time}", "更新于 {time}"),
    "fr_privacy_short": ("Levels and achievements are calculated on this PC.",
                         "Level dan pencapaian dihitung di PC ini.", "等級與成就都在這台電腦上計算。",
                         "等级与成就都在这台电脑上计算。"),
    "fr_added": ("{name} is now your friend!", "{name} sekarang temanmu!", "{name} 成為你的好友了！",
                 "{name} 成为你的好友了！"),
    "fr_news": ("{name} just finished a pomodoro ({n} today)!", "{name} baru menyelesaikan pomodoro ({n} hari ini)!",
                "{name} 剛完成一個番茄 (今天第 {n} 個)！", "{name} 刚完成一个番茄 (今天第 {n} 个)！"),
    "fr_err_offline": ("Can't reach the Friends server (no connection?). Try again later.",
                       "Tidak bisa terhubung ke server Teman (tidak ada koneksi?). Coba lagi nanti.",
                       "無法連線到好友伺服器 (沒有網路?)，請稍後再試。", "无法连接到好友服务器 (没有网络?)，请稍后再试。"),
    "fr_err_not_found": ("No one has that friend code.", "Tidak ada yang punya kode teman itu.",
                         "沒有人使用這個好友代碼。", "没有人使用这个好友代码。"),
    "fr_err_self": ("That's your own code :)", "Itu kodemu sendiri :)",
                    "那是你自己的代碼 :)", "那是你自己的代码 :)"),
    "fr_err_bad_code": ("Friend codes have 6 letters/numbers.", "Kode teman terdiri dari 6 huruf/angka.",
                        "好友代碼是 6 個字母或數字。", "好友代码是 6 个字母或数字。"),
    "fr_err_too_many": ("That's the maximum for now.", "Itu sudah batas maksimum.", "已達上限。", "已达上限。"),
    "fr_err_bad_group": ("Team codes need at least 2 letters/numbers.", "Kode tim minimal 2 huruf/angka.",
                         "團隊代碼至少需要 2 個字母或數字。", "团队代码至少需要 2 个字母或数字。"),
    "fr_err_generic": ("Something went wrong ({code}).", "Ada yang salah ({code}).", "發生錯誤 ({code})。",
                       "发生错误 ({code})。"),
    "ach_unlocked": ("Achievement unlocked: {name}!", "Pencapaian terbuka: {name}!", "解鎖成就：{name}！",
                     "解锁成就：{name}！"),
    "ach_more": (" (+{n} more)", " (+{n} lagi)", " (另外 +{n})", " (另外 +{n})"),
    "ach_first_pom": ("First tomato: finish your first pomodoro", "Tomat pertama: selesaikan pomodoro pertamamu",
                      "第一顆番茄：完成第一個番茄鐘", "第一颗番茄：完成第一个番茄钟"),
    "ach_poms_10": ("Getting started: 10 pomodoros", "Mulai jalan: 10 pomodoro", "起步：10 個番茄", "起步：10 个番茄"),
    "ach_poms_50": ("Focused: 50 pomodoros", "Fokus: 50 pomodoro", "專注：50 個番茄", "专注：50 个番茄"),
    "ach_poms_100": ("Centurion: 100 pomodoros", "Centurion: 100 pomodoro", "百番茄：100 個番茄", "百番茄：100 个番茄"),
    "ach_poms_250": ("Focus master: 250 pomodoros", "Master fokus: 250 pomodoro", "專注大師：250 個番茄",
                     "专注大师：250 个番茄"),
    "ach_day_4": ("Good day: 4 pomodoros in one day", "Hari baik: 4 pomodoro sehari", "好的一天：一天 4 個番茄",
                  "好的一天：一天 4 个番茄"),
    "ach_day_8": ("Deep work day: 8 pomodoros in one day", "Hari kerja dalam: 8 pomodoro sehari",
                  "深度工作日：一天 8 個番茄", "深度工作日：一天 8 个番茄"),
    "ach_streak_3": ("On a roll: 3-day streak", "Lagi semangat: streak 3 hari", "手感正熱：連續 3 天",
                     "手感正热：连续 3 天"),
    "ach_streak_7": ("Full week: 7-day streak", "Seminggu penuh: streak 7 hari", "整整一週：連續 7 天",
                     "整整一周：连续 7 天"),
    "ach_streak_14": ("Unstoppable: 14-day streak", "Tak terhentikan: streak 14 hari", "勢不可擋：連續 14 天",
                      "势不可挡：连续 14 天"),
    "ach_early_bird": ("Early bird: a pomodoro before 8:00", "Burung pagi: pomodoro sebelum 08.00",
                       "早起鳥：8 點前完成番茄", "早起鸟：8 点前完成番茄"),
    "ach_night_owl": ("Night owl: a pomodoro after 22:00", "Burung hantu: pomodoro setelah 22.00",
                      "夜貓子：22 點後完成番茄", "夜猫子：22 点后完成番茄"),
    "ach_weekend": ("Weekend warrior: a pomodoro on a weekend", "Pejuang akhir pekan: pomodoro di akhir pekan",
                    "週末戰士：週末完成番茄", "周末战士：周末完成番茄"),
    "ach_level_5": ("Level 5: reach level 5", "Level 5: capai level 5", "等級 5：達到等級 5", "等级 5：达到等级 5"),
    "ach_level_10": ("Level 10: reach level 10", "Level 10: capai level 10", "等級 10：達到等級 10",
                     "等级 10：达到等级 10"),
    "ach_pet_lover": ("Pet lover: pet your pet 50 times", "Pecinta hewan: elus peliharaan 50 kali",
                      "愛寵人士：摸寵物 50 次", "爱宠人士：摸宠物 50 次"),
    "ach_tickler": ("Tickle monster: 100 tickles", "Monster gelitik: 100 gelitikan", "搔癢怪獸：搔癢 100 次",
                    "挠痒怪兽：挠痒 100 次"),
    "ach_chef": ("Chef: give 20 snacks", "Koki: beri 20 camilan", "大廚：餵 20 次點心", "大厨：喂 20 次点心"),
    "ach_friend_1": ("Buddy: add your first friend", "Sobat: tambah teman pertama", "好夥伴：加第一個好友",
                     "好伙伴：加第一个好友"),
    "ach_team_1": ("Team player: join a team", "Pemain tim: gabung tim", "團隊成員：加入團隊", "团队成员：加入团队"),

    # --- friends v2: chat, groups, affinity, pet interactions ---
    "fr_tab_chat": ("Chat", "Chat", "聊天", "聊天"),
    "fr_tab_groups": ("Groups", "Grup", "群組", "群组"),
    "aff_acq": ("Acquaintance", "Kenalan", "點頭之交", "点头之交"),
    "aff_buddy": ("Buddy", "Sobat", "好夥伴", "好伙伴"),
    "aff_good": ("Good friends", "Teman baik", "好朋友", "好朋友"),
    "aff_close": ("Close friends", "Teman dekat", "知心好友", "知心好友"),
    "aff_best": ("Best friends", "Sahabat", "最好的朋友", "最好的朋友"),
    "aff_soul": ("Soulmates", "Belahan jiwa", "靈魂伴侶", "灵魂伴侣"),
    "aff_level_up": ("You and {name} are now {level}!", "Kamu dan {name} sekarang {level}!",
                     "你和 {name} 升級為「{level}」了！", "你和 {name} 升级为「{level}」了！"),
    "ix_btn_chat": ("Chat", "Chat", "聊天", "聊天"),
    "ix_btn_wave": ("Wave", "Lambai", "揮手", "挥手"),
    "ix_btn_pet": ("Pet", "Elus", "摸摸", "摸摸"),
    "ix_btn_snack": ("Snack", "Camilan", "點心", "点心"),
    "ix_btn_highfive": ("High five", "Tos", "擊掌", "击掌"),
    "ix_btn_visit": ("Visit", "Kunjungi", "拜訪", "拜访"),
    "ix_btn_cheer": ("Cheer", "Semangati", "加油", "加油"),
    "ix_name_wave": ("waved", "melambai", "揮了揮手", "挥了挥手"),
    "ix_name_pet": ("petted your pet", "mengelus peliharaan", "摸了摸寵物", "摸了摸宠物"),
    "ix_name_snack": ("sent a snack", "mengirim camilan", "送了點心", "送了点心"),
    "ix_name_highfive": ("high five!", "tos!", "擊掌！", "击掌！"),
    "ix_name_visit": ("sent their pet to visit", "mengirim peliharaan berkunjung", "派寵物來拜訪", "派宠物来拜访"),
    "ix_name_cheer": ("cheered everyone on", "menyemangati semua", "幫大家加油", "帮大家加油"),
    "ix_name_text": ("message", "pesan", "訊息", "消息"),
    "ix_in_wave": ("{name} waves at you!", "{name} melambai padamu!", "{name} 向你揮手！", "{name} 向你挥手！"),
    "ix_in_pet": ("{name} petted {pet} \u2665", "{name} mengelus {pet} \u2665", "{name} 摸了摸 {pet} \u2665",
                  "{name} 摸了摸 {pet} \u2665"),
    "ix_in_snack": ("{name} sent {pet} a snack. Yum!", "{name} mengirim camilan untuk {pet}. Nyam!",
                    "{name} 送了點心給 {pet}，好吃！", "{name} 送了点心给 {pet}，好吃！"),
    "ix_in_highfive": ("{name}: high five! \u2605", "{name}: tos! \u2605", "{name}：擊掌！\u2605",
                       "{name}：击掌！\u2605"),
    "ix_in_visit": ("{name}'s pet came to visit!", "Peliharaan {name} datang berkunjung!",
                    "{name} 的寵物來拜訪了！", "{name} 的宠物来拜访了！"),
    "ix_in_cheer": ("{name} cheers everyone in {group}!", "{name} menyemangati semua di {group}!",
                    "{name} 在 {group} 幫大家加油！", "{name} 在 {group} 帮大家加油！"),
    "ix_sent_wave": ("Waved at {name}!", "Melambai ke {name}!", "向 {name} 揮手了！", "向 {name} 挥手了！"),
    "ix_sent_pet": ("You petted {name}'s pet \u2665", "Kamu mengelus peliharaan {name} \u2665",
                    "你摸了摸 {name} 的寵物 \u2665", "你摸了摸 {name} 的宠物 \u2665"),
    "ix_sent_snack": ("Snack sent to {name}'s pet!", "Camilan terkirim ke peliharaan {name}!",
                      "點心送給 {name} 的寵物了！", "点心送给 {name} 的宠物了！"),
    "ix_sent_highfive": ("High five sent to {name}!", "Tos terkirim ke {name}!", "和 {name} 擊掌了！",
                         "和 {name} 击掌了！"),
    "ix_sent_visit": ("I'm off to visit {name}! Back soon \u266a", "Aku berkunjung ke {name}! Segera kembali \u266a",
                      "我去拜訪 {name} 囉！馬上回來 \u266a", "我去拜访 {name} 啰！马上回来 \u266a"),
    "chat_bubble": ("{name}: {text}", "{name}: {text}", "{name}：{text}", "{name}：{text}"),
    "chat_empty": ("Add a friend or create a group to start chatting.",
                   "Tambah teman atau buat grup untuk mulai chat.", "加好友或建立群組就可以開始聊天。",
                   "添加好友或创建群组就可以开始聊天。"),
    "chat_say_hi": ("No messages yet - say hi!", "Belum ada pesan - sapa dulu!", "還沒有訊息，打個招呼吧！",
                    "还没有消息，打个招呼吧！"),
    "chat_back": ("Back", "Kembali", "返回", "返回"),
    "chat_send": ("Send", "Kirim", "傳送", "发送"),
    "cir_invited_you": ("{name} invited you to the group \"{group}\"", "{name} mengundangmu ke grup \"{group}\"",
                        "{name} 邀請你加入群組「{group}」", "{name} 邀请你加入群组「{group}」"),
    "cir_invite_line": ("{name} invited you to \"{group}\"", "{name} mengundangmu ke \"{group}\"",
                        "{name} 邀請你加入「{group}」", "{name} 邀请你加入「{group}」"),
    "cir_invite_sent": ("Invite sent to {name}!", "Undangan terkirim ke {name}!", "已邀請 {name}！", "已邀请 {name}！"),
    "cir_accept": ("Join", "Gabung", "加入", "加入"),
    "cir_decline": ("No thanks", "Tidak", "不用了", "不用了"),
    "cir_new": ("New group:", "Grup baru:", "新群組：", "新群组："),
    "cir_create": ("Create", "Buat", "建立", "创建"),
    "cir_hint": ("Your own private group: only friends you invite can join. Chat, cheer and compare pomodoros together.",
                 "Grup pribadimu: hanya teman yang kamu undang bisa gabung. Chat, saling semangati dan bandingkan pomodoro.",
                 "你自己的私人群組：只有你邀請的好友可以加入。一起聊天、加油、比較番茄數。",
                 "你自己的私人群组：只有你邀请的好友可以加入。一起聊天、加油、比较番茄数。"),
    "cir_none": ("No groups yet.", "Belum ada grup.", "還沒有群組。", "还没有群组。"),
    "cir_role_owner": ("owner", "pemilik", "群主", "群主"),
    "cir_role_member": ("member", "anggota", "成員", "成员"),
    "cir_invite_friend": ("Invite a friend:", "Undang teman:", "邀請好友：", "邀请好友："),
    "cir_invite": ("Invite", "Undang", "邀請", "邀请"),
    "cir_leave_q": ("Leave the group \"{group}\"?", "Keluar dari grup \"{group}\"?", "要退出群組「{group}」嗎？",
                    "要退出群组「{group}」吗？"),
    "cir_kick_q": ("Remove {name} from this group?", "Keluarkan {name} dari grup ini?", "要把 {name} 移出群組嗎？",
                   "要把 {name} 移出群组吗？"),
    "cir_err_member": ("They're already in this group.", "Dia sudah ada di grup ini.", "對方已經在群組裡了。",
                       "对方已经在群组里了。"),
    "cir_err_name": ("Group names need at least 2 characters.", "Nama grup minimal 2 karakter.",
                     "群組名稱至少需要 2 個字。", "群组名称至少需要 2 个字。"),
    "fr_err_too_fast": ("Slow down a little - try again in a moment.", "Pelan-pelan - coba lagi sebentar lagi.",
                        "慢一點，稍後再試。", "慢一点，稍后再试。"),
    "fr_err_not_friends": ("You can only do that with friends.", "Hanya bisa dilakukan dengan teman.",
                           "只能對好友這麼做。", "只能对好友这么做。"),
    "ach_close_friend": ("Close friends: reach \"Close friends\" with someone",
                         "Teman dekat: capai \"Teman dekat\" dengan seseorang",
                         "知心好友：和某人達到「知心好友」", "知心好友：和某人达到「知心好友」"),
    # --- owner & credits ---
    "owner_badge": ("Owner", "Pemilik", "擁有者", "所有者"),
    "owner_creator": ("Creator & owner of Pips", "Pembuat & pemilik Pips", "Pips 的創作者與擁有者", "Pips 的创作者与所有者"),
    "owner_welcome": ("Welcome back, boss! ♛ Owner mode: max level, every badge, the whole shop and endless coins are yours.", "Selamat datang, bos! ♛ Mode pemilik: level maks, semua lencana, seluruh toko dan koin tanpa batas milikmu.", "歡迎回來，老闆！♛ 擁有者模式：最高等級、所有徽章、整個商店和無限金幣都是你的。", "欢迎回来，老板！♛ 所有者模式：最高等级、所有徽章、整个商店和无限金币都是你的。"),
    "shop_unlimited": ("∞ coins (owner)", "∞ koin (pemilik)", "∞ 金幣（擁有者）", "∞ 金币（所有者）"),
    "credits_title": ("About Pips", "Tentang Pips", "關於 Pips", "关于 Pips"),
    "credits_made": ("Pips {v} is made with ♥ by {owner} - creator and owner of the app.", "Pips {v} dibuat dengan ♥ oleh {owner} - pembuat dan pemilik aplikasi ini.", "Pips {v} 由 {owner} 用 ♥ 打造，他是這個應用的創作者與擁有者。", "Pips {v} 由 {owner} 用 ♥ 打造，他是这个应用的创作者与所有者。"),
    "credits_body": ("Ideas, bugs or just want to say hi? Contact Juwen: {email}", "Punya ide, menemukan bug, atau sekadar ingin menyapa? Hubungi Juwen: {email}", "有點子、發現 bug 或只是想打聲招呼？聯絡 Juwen：{email}", "有点子、发现 bug 或只是想打声招呼？联系 Juwen：{email}"),
    "credits_email": ("Email Juwen", "Email Juwen", "寫信給 Juwen", "写信给 Juwen"),
    "credits_copy": ("Copy email", "Salin email", "複製信箱", "复制邮箱"),
    "credits_site": ("Website", "Situs web", "網站", "网站"),
    # --- profiles, ranks, requests, labels, status, theme (v2.6) ---
    "fr_tab_ranks": ("Ranks", "Peringkat", "排行", "排行"),
    "fr_tab_profile": ("Profile", "Profil", "個人檔案", "个人资料"),
    "p_dark_mode": ("Dark mode", "Mode gelap", "深色模式", "深色模式"),
    "theme_title": ("App theme", "Tema aplikasi", "應用主題", "应用主题"),
    "theme_light": ("Light", "Terang", "淺色", "浅色"),
    "theme_dark": ("Dark", "Gelap", "深色", "深色"),
    "st_auto": ("Auto", "Otomatis", "自動", "自动"),
    "st_online": ("Online", "Online", "在線", "在线"),
    "st_busy": ("Busy", "Sibuk", "忙碌", "忙碌"),
    "st_away": ("Away", "Pergi", "離開", "离开"),
    "st_offline": ("Offline", "Offline", "離線", "离线"),
    "st_auto_hint": ("Auto = online while Pips is running, away after 10 idle minutes, offline when Pips is closed. Pick \"Offline\" to appear offline.", "Otomatis = online saat Pips berjalan, pergi setelah 10 menit tidak aktif, offline saat Pips ditutup. Pilih \"Offline\" agar tampak offline.", "自動 = Pips 執行時顯示在線，閒置 10 分鐘顯示離開，關閉 Pips 時顯示離線。選「離線」可隱身。", "自动 = Pips 运行时显示在线，闲置 10 分钟显示离开，关闭 Pips 时显示离线。选「离线」可隐身。"),
    "vis_public": ("Public", "Publik", "公開", "公开"),
    "vis_private": ("Private", "Pribadi", "私人", "私密"),
    "vis_public_desc": ("anyone can add you directly and see your whole profile", "siapa pun bisa langsung menambahkanmu dan melihat seluruh profilmu", "任何人都能直接加你為好友並查看完整檔案", "任何人都能直接加你为好友并查看完整资料"),
    "vis_private_desc": ("people send a friend request you accept first; strangers only see your name, photo, pet, level and status", "orang harus mengirim permintaan yang kamu terima dulu; orang asing hanya melihat nama, foto, peliharaan, level dan status", "別人需先送出好友邀請並由你接受；陌生人只看得到名字、照片、寵物、等級和狀態", "别人需先发送好友申请并由你接受；陌生人只能看到名字、照片、宠物、等级和状态"),
    "lbl_set": ("Label", "Label", "關係", "关系"),
    "lbl_none": ("No label", "Tanpa label", "不設定", "不设置"),
    "lbl_buddy": ("Buddy", "Sobat", "好夥伴", "好伙伴"),
    "lbl_bro": ("Bro", "Bro", "兄弟", "兄弟"),
    "lbl_sis": ("Sis", "Sis", "姊妹", "姐妹"),
    "lbl_bestie": ("Bestie", "Sahabat", "閨蜜", "闺蜜"),
    "lbl_partner": ("Partner", "Pasangan", "伴侶", "伴侣"),
    "lbl_soulmate": ("Soulmate", "Belahan jiwa", "靈魂伴侶", "灵魂伴侣"),
    "lbl_family": ("Family", "Keluarga", "家人", "家人"),
    "lbl_work": ("Work buddy", "Rekan kerja", "同事", "同事"),
    "lbl_you_call": ("You: {label}", "Kamu: {label}", "你：{label}", "你：{label}"),
    "lbl_they_call": ("They: {label}", "Dia: {label}", "對方：{label}", "对方：{label}"),
    "req_title": ("Friend requests ({n})", "Permintaan pertemanan ({n})", "好友邀請 ({n})", "好友申请 ({n})"),
    "req_line": ("{name} wants to be friends", "{name} ingin berteman", "{name} 想加你為好友", "{name} 想加你为好友"),
    "req_new": ("{name} sent you a friend request! Click to answer.", "{name} mengirim permintaan pertemanan! Klik untuk menjawab.", "{name} 送來好友邀請！點一下回覆。", "{name} 发来好友申请！点一下回复。"),
    "req_sent": ("Friend request sent to {name} - their profile is private.", "Permintaan terkirim ke {name} - profilnya pribadi.", "已向 {name} 送出好友邀請（對方的檔案是私人的）。", "已向 {name} 发送好友申请（对方的资料是私密的）。"),
    "req_sent_count": ("{n} request(s) waiting for an answer", "{n} permintaan menunggu jawaban", "{n} 個邀請等待回覆", "{n} 个申请等待回复"),
    "req_accept": ("Accept", "Terima", "接受", "接受"),
    "req_decline": ("Decline", "Tolak", "拒絕", "拒绝"),
    "req_pending": ("Requested · cancel", "Diminta · batal", "已邀請 · 取消", "已申请 · 取消"),
    "rank_title": ("Everyone on Pips", "Semua pengguna Pips", "所有 Pips 使用者", "所有 Pips 用户"),
    "rank_sort_xp": ("XP", "XP", "經驗值", "经验值"),
    "rank_sort_badges": ("Badges", "Lencana", "徽章", "徽章"),
    "rank_sort_streak": ("Streak", "Beruntun", "連續", "连续"),
    "rank_total": ("{n} people", "{n} orang", "{n} 人", "{n} 人"),
    "rank_mine": ("you are #{n}", "kamu #{n}", "你是第 {n} 名", "你是第 {n} 名"),
    "rank_level": ("Lv {level}", "Lv {level}", "Lv {level}", "Lv {level}"),
    "rank_val_xp": ("{n} XP", "{n} XP", "{n} XP", "{n} XP"),
    "rank_val_badges": ("{n} badges", "{n} lencana", "{n} 枚徽章", "{n} 枚徽章"),
    "rank_val_streak": ("{n}-day streak", "{n} hari beruntun", "連續 {n} 天", "连续 {n} 天"),
    "rank_add": ("Add", "Tambah", "加好友", "加好友"),
    "rank_request": ("Request", "Minta", "邀請", "申请"),
    "rank_friend": ("Friend", "Teman", "好友", "好友"),
    "prof_photo": ("Profile picture", "Foto profil", "大頭貼", "头像"),
    "prof_pick_photo": ("Choose a picture…", "Pilih gambar…", "選擇圖片…", "选择图片…"),
    "prof_use_pet": ("Use my pet instead", "Pakai peliharaanku", "改用我的寵物", "改用我的宠物"),
    "prof_photo_hint": ("PNG / JPG - it is cropped to a circle (96 px).", "PNG / JPG - dipotong bulat (96 px).", "PNG / JPG，會裁成圓形 (96 px)。", "PNG / JPG，会裁成圆形 (96 px)。"),
    "prof_images": ("Pictures", "Gambar", "圖片", "图片"),
    "prof_visibility": ("Who can see my profile", "Siapa yang bisa melihat profilku", "誰能看我的檔案", "谁能看我的资料"),
    "prof_status": ("Status", "Status", "狀態", "状态"),
    "prof_status_text": ("Status message", "Pesan status", "狀態訊息", "状态消息"),
    "prof_about": ("About me", "Tentang aku", "關於我", "关于我"),
    "prof_bio_hint": ("Up to 300 characters.", "Maksimal 300 karakter.", "最多 300 字。", "最多 300 字。"),
    "prof_info": ("Info", "Info", "資訊", "信息"),
    "info_job": ("Job / team", "Pekerjaan / tim", "工作 / 部門", "工作 / 部门"),
    "info_location": ("Location", "Lokasi", "地點", "地点"),
    "info_hobbies": ("Hobbies", "Hobi", "興趣", "爱好"),
    "info_birthday": ("Birthday", "Ulang tahun", "生日", "生日"),
    "info_fav": ("Favourite thing", "Favorit", "最喜歡", "最喜欢"),
    "prof_save": ("Save profile", "Simpan profil", "儲存檔案", "保存资料"),
    "prof_saved": ("Profile saved ✓", "Profil disimpan ✓", "已儲存 ✓", "已保存 ✓"),
    "prof_preview": ("See my profile", "Lihat profilku", "預覽我的檔案", "预览我的资料"),
    "prof_edit": ("Edit my profile", "Ubah profilku", "編輯我的檔案", "编辑我的资料"),
    "prof_offline_note": ("Turn on Friends (Friends tab) to share your profile and see others.", "Aktifkan Teman (tab Teman) untuk membagikan profilmu dan melihat profil orang lain.", "開啟好友功能（好友分頁）才能分享檔案並查看別人的檔案。", "开启好友功能（好友标签）才能分享资料并查看别人的资料。"),
    "prof_private_title": ("This profile is private", "Profil ini pribadi", "這是私人檔案", "这是私密资料"),
    "prof_private_body": ("Send a friend request - once they accept, you can see their bio, info, badges and friends.", "Kirim permintaan pertemanan - setelah diterima, kamu bisa melihat bio, info, lencana dan teman mereka.", "送出好友邀請，對方接受後就能看到自我介紹、資訊、徽章和好友。", "发送好友申请，对方接受后就能看到简介、信息、徽章和好友。"),
    "prof_badges": ("Badges ({n})", "Lencana ({n})", "徽章 ({n})", "徽章 ({n})"),
    "prof_friends": ("Friends ({n})", "Teman ({n})", "好友 ({n})", "好友 ({n})"),
    "prof_since": ("On Pips since {date}", "Di Pips sejak {date}", "{date} 加入 Pips", "{date} 加入 Pips"),
    "prof_last_seen": ("last seen {time}", "terakhir terlihat {time}", "最後上線 {time}", "最后在线 {time}"),
    "prof_err_image": ("That picture could not be used - try a PNG or JPG.", "Gambar tidak bisa dipakai - coba PNG atau JPG.", "這張圖片無法使用，請改用 PNG 或 JPG。", "这张图片无法使用，请改用 PNG 或 JPG。"),
    "prof_err_pillow": ("Profile pictures need Pillow (pip install Pillow).", "Foto profil memerlukan Pillow (pip install Pillow).", "大頭貼需要 Pillow（pip install Pillow）。", "头像需要 Pillow（pip install Pillow）。"),
    # --- shop, coins, props & moves ---
    "fr_tab_shop": ("Shop", "Toko", "商店", "商店"),
    "p_shop": ("Shop\u2026", "Toko\u2026", "商店\u2026", "商店\u2026"),
    "p_tricks": ("Do a trick", "Lakukan trik", "表演招式", "表演招式"),
    "p_focus": ("Focus timer (Pomodoro)", "Timer fokus (Pomodoro)", "專注計時 (番茄鐘)", "专注计时 (番茄钟)"),
    "p_click_hub": ("Tickle + open Pips hub", "Gelitik + buka hub Pips", "搔癢 + 開啟 Pips 中心", "挠痒 + 打开 Pips 中心"),
    "click_hub_long": ("Tickle it and open the Pips hub (friends, chat, shop)",
                       "Gelitik dan buka hub Pips (teman, chat, toko)",
                       "搔癢並開啟 Pips 中心 (好友、聊天、商店)", "挠痒并打开 Pips 中心 (好友、聊天、商店)"),
    "shop_balance": ("{n} coins", "{n} koin", "{n} 金幣", "{n} 金币"),
    "shop_earned": ("Earned: pomodoros {pom} \u00b7 levels {lvl} \u00b7 badges {ach} \u00b7 daily visits {days} \u00b7 "
                    "friendships {fr} \u00b7 interactions {soc} \u00b7 welcome gift {gift}",
                    "Didapat: pomodoro {pom} \u00b7 level {lvl} \u00b7 lencana {ach} \u00b7 kunjungan harian {days} \u00b7 "
                    "pertemanan {fr} \u00b7 interaksi {soc} \u00b7 hadiah awal {gift}",
                    "獲得：番茄 {pom} \u00b7 等級 {lvl} \u00b7 徽章 {ach} \u00b7 每日登入 {days} \u00b7 友誼 {fr} \u00b7 互動 {soc} \u00b7 見面禮 {gift}",
                    "获得：番茄 {pom} \u00b7 等级 {lvl} \u00b7 徽章 {ach} \u00b7 每日登录 {days} \u00b7 友谊 {fr} \u00b7 互动 {soc} \u00b7 见面礼 {gift}"),
    "shop_how": ("Earn more: level up (+40), unlock badges (+25), finish pomodoros (+5), open Pips every day (+10), "
                 "grow friendships (+15 per affinity level) and wave / chat / visit friends (+2, up to 20 a day).",
                 "Dapatkan lagi: naik level (+40), buka lencana (+25), selesaikan pomodoro (+5), buka Pips tiap hari (+10), "
                 "tumbuhkan pertemanan (+15 per level afinitas) dan lambai / chat / kunjungi teman (+2, maks 20 sehari).",
                 "賺更多：升級 (+40)、解鎖徽章 (+25)、完成番茄 (+5)、每天打開 Pips (+10)、增進友誼 (每級親密度 +15)、"
                 "和朋友揮手 / 聊天 / 拜訪 (+2，每天最多 20)。",
                 "赚更多：升级 (+40)、解锁徽章 (+25)、完成番茄 (+5)、每天打开 Pips (+10)、增进友谊 (每级亲密度 +15)、"
                 "和朋友挥手 / 聊天 / 拜访 (+2，每天最多 20)。"),
    "shop_props": ("Props", "Aksesori", "配件", "配件"),
    "shop_moves": ("Moves", "Gerakan", "招式", "招式"),
    "shop_wear": ("Wear", "Pakai", "穿戴", "穿戴"),
    "shop_takeoff": ("Take off", "Lepas", "脫下", "脱下"),
    "shop_do": ("Do it!", "Lakukan!", "表演！", "表演！"),
    "shop_poor": ("Not enough coins yet - keep going!", "Koin belum cukup - terus semangat!", "金幣還不夠，繼續加油！",
                  "金币还不够，继续加油！"),
    "shop_bought": ("{item} - it's mine! Thank you!", "{item} - punyaku! Terima kasih!", "{item} 是我的了！謝謝！",
                    "{item} 是我的了！谢谢！"),
    "shop_coins_plus": (" (+{n} coins)", " (+{n} koin)", " (+{n} 金幣)", " (+{n} 金币)"),
    "shop_unavailable": ("The shop isn't available.", "Toko tidak tersedia.", "商店無法使用。", "商店无法使用。"),
    "pr_flower": ("Flower", "Bunga", "小花", "小花"),
    "pr_party_hat": ("Party hat", "Topi pesta", "派對帽", "派对帽"),
    "pr_cap": ("Cap", "Topi", "棒球帽", "棒球帽"),
    "pr_beanie": ("Beanie", "Kupluk", "毛線帽", "毛线帽"),
    "pr_headphones": ("Headphones", "Headphone", "耳機", "耳机"),
    "pr_wizard": ("Wizard hat", "Topi penyihir", "巫師帽", "巫师帽"),
    "pr_halo": ("Halo", "Lingkaran malaikat", "光環", "光环"),
    "pr_crown": ("Crown", "Mahkota", "皇冠", "皇冠"),
    "pr_shades": ("Shades", "Kacamata hitam", "墨鏡", "墨镜"),
    "pr_heart_glasses": ("Heart glasses", "Kacamata hati", "愛心眼鏡", "爱心眼镜"),
    "pr_monocle": ("Monocle", "Monokel", "單片眼鏡", "单片眼镜"),
    "pr_bowtie": ("Bow tie", "Dasi kupu-kupu", "領結", "领结"),
    "pr_bell": ("Bell collar", "Kalung lonceng", "鈴鐺項圈", "铃铛项圈"),
    "pr_scarf": ("Scarf", "Syal", "圍巾", "围巾"),
    "pr_medal": ("Gold medal", "Medali emas", "金牌", "金牌"),
    "pr_cape": ("Hero cape", "Jubah pahlawan", "英雄披風", "英雄披风"),
    "pr_wings": ("Angel wings", "Sayap malaikat", "天使翅膀", "天使翅膀"),
    "mv_spin": ("Spin: twirls around in sparkles", "Putar: berputar dengan kilauan", "轉圈：閃亮亮地轉圈圈",
                "转圈：闪亮亮地转圈圈"),
    "mv_dance": ("Dance: busts a groove with music notes", "Joget: berjoget dengan not musik", "跳舞：伴著音符跳舞",
                 "跳舞：伴着音符跳舞"),
    "mv_moonwalk": ("Moonwalk: slides backwards, smooth", "Moonwalk: meluncur mundur dengan mulus", "月球漫步：帥氣地往後滑",
                    "月球漫步：帅气地往后滑"),
    "mv_backflip": ("Backflip: a big flip - ta-da!", "Salto: lompatan salto besar - ta-da!", "後空翻：大大的空翻 - 噹噹！",
                    "后空翻：大大的空翻 - 当当！"),
    "mv_kungfu": ("Kung fu: punches, a flying kick - hi-ya!", "Kungfu: pukulan dan tendangan terbang - hiyaa!",
                  "功夫：出拳、飛踢 - 喝呀！", "功夫：出拳、飞踢 - 喝呀！"),
    "mv_spider": ("Spider swing: shoots a web and swings across your screen",
                  "Ayunan laba-laba: menembak jaring dan berayun di layarmu",
                  "蜘蛛擺盪：射出蛛絲在螢幕上擺盪", "蜘蛛摆荡：射出蛛丝在屏幕上摆荡"),
    "ach_visitor": ("Globetrotter: send your pet to visit a friend", "Penjelajah: kirim peliharaan berkunjung ke teman",
                    "環遊世界：派寵物去拜訪好友", "环游世界：派宠物去拜访好友"),

    # --- language picker ---
    "pick_title": ("Welcome to Pips!", "Selamat datang di Pips!", "歡迎使用 Pips!", "欢迎使用 Pips!"),
    "pick_sub": ("Choose your language", "Pilih bahasamu", "請選擇語言", "请选择语言"),
    "pick_hint": ("You can change it later from the right-click menu.",
                  "Kamu bisa menggantinya nanti lewat menu klik kanan.",
                  "之後可以從右鍵選單更改。", "之后可以从右键菜单更改。"),
    "pick_continue": ("Continue ›", "Lanjut ›", "繼續 ›", "继续 ›"),
}

# Random pet lines: key -> (en, id, zh_TW, zh_CN) lists
L = {
    "tickle": (
        ["hehe~!", "kyaa! that tickles!", "hehehe stop~", "eep! ♪", "teehee", "nooo not there hehe", "*giggles*"],
        ["hehe~!", "kyaa! geli!", "hehehe udahan~", "iih! ♪", "hihihi", "jangan di situ hehe", "*cekikikan*"],
        ["嘿嘿~!", "呀! 好癢!", "嘿嘿嘿 不要啦~", "咿! ♪", "嘻嘻", "不要搔那裡啦 嘿嘿", "*咯咯笑*"],
        ["嘿嘿~!", "呀! 好痒!", "嘿嘿嘿 不要啦~", "咿! ♪", "嘻嘻", "不要挠那里啦 嘿嘿", "*咯咯笑*"],
    ),
    "angry": (
        ["hmph! too much tickling!", "okay that's enough! >:(", "I'm pouting now.", "grr… give me a sec!"],
        ["hmph! kebanyakan gelitikin!", "oke, cukup! >:(", "aku ngambek nih.", "grr… kasih aku waktu!"],
        ["哼! 搔太多了啦!", "好了, 夠了! >:(", "我生氣了喔.", "嗚… 讓我冷靜一下!"],
        ["哼! 挠太多了啦!", "好了, 够了! >:(", "我生气了哦.", "呜… 让我冷静一下!"],
    ),
    "pet": (
        ["purrr~ ♥", "mmm that's nice…", "more pets please ♥", "*happy wiggle*", "♥♥♥"],
        ["purrr~ ♥", "mmm enak banget…", "elus lagi dong ♥", "*goyang senang*", "♥♥♥"],
        ["呼嚕嚕~ ♥", "嗯~ 好舒服…", "再摸摸我嘛 ♥", "*開心扭扭*", "♥♥♥"],
        ["呼噜噜~ ♥", "嗯~ 好舒服…", "再摸摸我嘛 ♥", "*开心扭扭*", "♥♥♥"],
    ),
    "wake": (
        ["huh? I'm up, I'm up!", "*yaaawn* morning?", "mm… hi there~"],
        ["hah? aku bangun, aku bangun!", "*hoaaam* udah pagi?", "mm… hai~"],
        ["嗯? 我醒了我醒了!", "*呵~欠* 早上了嗎?", "嗯… 嗨~"],
        ["嗯? 我醒了我醒了!", "*哈~欠* 早上了吗?", "嗯… 嗨~"],
    ),
    "grumpy_wake": (
        ["hey… I was sleeping…", "grr… so sleepy…", "five more minutes…"],
        ["hei… aku lagi tidur…", "grr… ngantuk banget…", "lima menit lagi…"],
        ["喂… 我在睡覺耶…", "嗚… 好睏…", "再五分鐘…"],
        ["喂… 我在睡觉耶…", "呜… 好困…", "再五分钟…"],
    ),
    "snack": (
        ["nom nom… cookie! ♥", "onigiri!! my favourite", "a strawberry? yay~", "fishy! ♥", "puddiiing~"],
        ["nyam nyam… kue! ♥", "onigiri!! favoritku", "stroberi? asyik~", "ikan! ♥", "pudiiing~"],
        ["嚼嚼… 餅乾! ♥", "飯糰!! 我的最愛", "草莓? 耶~", "魚魚! ♥", "布~丁~"],
        ["嚼嚼… 饼干! ♥", "饭团!! 我的最爱", "草莓? 耶~", "鱼鱼! ♥", "布~丁~"],
    ),
    "drag": (
        ["wheee~!", "where are we going?", "up we go!", "woah!"],
        ["wiii~!", "kita mau ke mana?", "terbang~!", "waduh!"],
        ["咻~!", "我們要去哪裡?", "飛起來囉!", "哇!"],
        ["咻~!", "我们要去哪里?", "飞起来咯!", "哇!"],
    ),
    "dizzy": (
        ["w-woah… the world is spinning…", "@_@ dizzy…", "stop shaking meee"],
        ["w-waduh… dunia berputar…", "@_@ pusing…", "jangan digoyang-goyang!"],
        ["哇… 天旋地轉…", "@_@ 好暈…", "不要再搖了啦"],
        ["哇… 天旋地转…", "@_@ 好晕…", "不要再摇了啦"],
    ),
    "back": (
        ["Welcome back! ♥", "you're back! I missed you~", "yay, you're here!"],
        ["Selamat datang kembali! ♥", "kamu balik! aku kangen~", "yay, kamu di sini!"],
        ["歡迎回來! ♥", "你回來了! 好想你~", "耶, 你在這裡!"],
        ["欢迎回来! ♥", "你回来了! 好想你~", "耶, 你在这里!"],
    ),
    "tired_sleep": (
        ["so sleepy… zzz", "I need a little nap…"],
        ["ngantuk… zzz", "aku butuh tidur sebentar…"],
        ["好睏… zzz", "我需要小睡一下…"],
        ["好困… zzz", "我需要小睡一下…"],
    ),
    "rested": (
        ["I'm full of energy! ✦", "what a good nap~"],
        ["energiku penuh! ✦", "tidur yang nyenyak~"],
        ["我充滿電了! ✦", "睡得好飽~"],
        ["我充满电了! ✦", "睡得好饱~"],
    ),
    "lonely": (
        ["psst… pet me? ♥", "hey… I'm still here~", "play with me a little? ♪"],
        ["psst… elus aku dong? ♥", "hei… aku masih di sini~", "main sama aku sebentar? ♪"],
        ["欸… 摸摸我好嗎? ♥", "嘿… 我還在這裡喔~", "陪我玩一下嘛? ♪"],
        ["欸… 摸摸我好吗? ♥", "嘿… 我还在这里哦~", "陪我玩一下嘛? ♪"],
    ),
    "tired_hint": (
        ["I'm getting tired… maybe you should rest too?", "*yawn* long day, huh?"],
        ["aku mulai capek… kamu juga istirahat ya?", "*hoaam* hari yang panjang, ya?"],
        ["我有點累了… 你也休息一下吧?", "*呵欠* 今天好漫長喔?"],
        ["我有点累了… 你也休息一下吧?", "*哈欠* 今天好漫长哦?"],
    ),
    "focus": (
        ["Let's focus! ✦", "You got this!", "Focus time~ I'll be quiet."],
        ["Ayo fokus! ✦", "Kamu pasti bisa!", "Waktunya fokus~ aku diam dulu."],
        ["一起專注吧! ✦", "你一定可以的!", "專注時間~ 我會安靜的."],
        ["一起专注吧! ✦", "你一定可以的!", "专注时间~ 我会安静的."],
    ),
    "oof": (
        ["oof!", "ouch… soft landing please?"],
        ["aduh!", "aw… mendaratnya pelan-pelan dong?"],
        ["哎唷!", "好痛… 輕一點放嘛?"],
        ["哎哟!", "好痛… 轻一点放嘛?"],
    ),
    "taskbar": (
        ["ooh, a road! ♪", "I'll take a walk here~", "nice view from down here!"],
        ["wah, ada jalan! ♪", "aku jalan-jalan di sini ya~", "pemandangannya bagus dari bawah sini!"],
        ["哇, 有條路! ♪", "我在這裡散散步~", "從這裡看風景真好!"],
        ["哇, 有条路! ♪", "我在这里散散步~", "从这里看风景真好!"],
    ),
}

# Built-in reminder tips (English text from reminders.py -> translations)
TIPS = {
    "Stand up and walk around for a couple of minutes.": (
        "Berdiri dan jalan-jalan sebentar beberapa menit.", "站起來走動幾分鐘。", "站起来走动几分钟。"),
    "Stretch your arms, neck and back.": (
        "Regangkan lengan, leher, dan punggungmu.", "伸展一下手臂、脖子和背部。", "伸展一下手臂、脖子和背部。"),
    "Drink a full glass of water.": ("Minum segelas penuh air.", "喝一整杯水。", "喝一整杯水。"),
    "Rest your eyes and look out of a window for 20 seconds.": (
        "Istirahatkan matamu dan lihat ke luar jendela selama 20 detik.", "讓眼睛休息, 看看窗外 20 秒。",
        "让眼睛休息, 看看窗外 20 秒。"),
    "Roll your shoulders slowly ten times.": (
        "Putar bahumu perlahan sepuluh kali.", "慢慢轉動肩膀十次。", "慢慢转动肩膀十次。"),
    "Take ten slow, deep breaths away from the screen.": (
        "Tarik napas dalam-dalam perlahan sepuluh kali, jauh dari layar.", "離開螢幕, 慢慢深呼吸十次。",
        "离开屏幕, 慢慢深呼吸十次。"),
    "Refill your water bottle.": ("Isi ulang botol minummu.", "把水壺裝滿。", "把水壶装满。"),
    "Do a quick calf and hamstring stretch.": (
        "Lakukan peregangan betis dan paha belakang sebentar.", "快速伸展小腿和大腿後側。", "快速伸展小腿和大腿后侧。"),
    "Time to drink some water.": ("Waktunya minum air.", "該喝水囉。", "该喝水咯。"),
    "Take a sip - hydration keeps your focus sharp.": (
        "Minum seteguk - cukup minum bikin fokus tetap tajam.", "喝一口吧 - 補充水分讓你保持專注。",
        "喝一口吧 - 补充水分让你保持专注。"),
    "Grab a glass of water and stretch your legs.": (
        "Ambil segelas air sambil meregangkan kaki.", "去倒杯水, 順便伸展雙腿。", "去倒杯水, 顺便伸展双腿。"),
    "Rest your eyes - focus on something far away for 20 seconds.": (
        "Istirahatkan matamu - lihat sesuatu yang jauh selama 20 detik.", "讓眼睛休息 - 注視遠方 20 秒。",
        "让眼睛休息 - 注视远方 20 秒。"),
    "Blink slowly and gaze into the distance for 20 seconds.": (
        "Kedip perlahan dan pandang ke kejauhan selama 20 detik.", "慢慢眨眼, 望向遠方 20 秒。",
        "慢慢眨眼, 望向远方 20 秒。"),
}

_REMINDER_TITLES = {"break": "rem_break", "eye": "rem_eye", "hydration": "rem_hydration"}


def t(key: str, lang: str | None = None, **kwargs) -> str:
    """Translate `key` into the current language, formatting {placeholders}."""
    idx = _INDEX.get(lang or _current, 0)
    entry = S.get(key)
    if entry is None:
        text = key
    else:
        text = entry[idx] if idx < len(entry) and entry[idx] else entry[0]
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            return text
    return text


def lines(key: str) -> list:
    entry = L.get(key)
    if not entry:
        return [key]
    idx = _INDEX.get(_current, 0)
    return entry[idx] or entry[0]


def translate_tip(text: str) -> str:
    if _current == "en" or not text:
        return text
    entry = TIPS.get(text.strip())
    if not entry:
        return text            # user-written tip: keep as is
    return entry[_INDEX[_current] - 1]


def translate_reminder(payload: dict) -> dict:
    """Return a copy of a reminders.py payload with title/tip in the current language."""
    out = dict(payload or {})
    key = _REMINDER_TITLES.get(out.get("kind", ""))
    if key:
        out["title"] = t(key)
    out["tip"] = translate_tip(out.get("tip", ""))
    return out


# -----------------------------------------------------------------------------
# First-run language picker
# -----------------------------------------------------------------------------

def pick_language(default: str | None = None, icon_path: str | None = None) -> str:
    """Show a small, friendly language chooser and return the chosen code.

    Closing the window keeps the highlighted (default / detected) language.
    """
    import tkinter as tk

    try:
        import pet as pet_mod
    except Exception:
        pet_mod = None

    choice = {"code": default if default in _INDEX else detect_system_language()}
    bg = "#faf8f3"
    ink = "#1a1a1a"
    muted = "#6b6b6b"
    accent = "#8b1a1a"

    root = tk.Tk()
    root.title("Pips")
    root.configure(bg=bg)
    root.resizable(False, False)
    root.attributes("-topmost", True)
    if icon_path:
        try:
            root.iconbitmap(icon_path)
        except tk.TclError:
            pass

    outer = tk.Frame(root, bg=bg)
    outer.pack(padx=26, pady=20)

    preview = tk.Canvas(outer, width=120, height=92, bg=bg, highlightthickness=0)
    preview.pack()
    title = tk.Label(outer, font=("Georgia", 16, "bold"), fg=ink, bg=bg)
    title.pack(pady=(4, 0))
    sub = tk.Label(outer, font=("Segoe UI", 10), fg=muted, bg=bg)
    sub.pack(pady=(2, 12))

    buttons = {}
    grid = tk.Frame(outer, bg=bg)
    grid.pack()

    def refresh(hover_code=None):
        shown = hover_code or choice["code"]
        title.config(text=t("pick_title", lang=shown))
        sub.config(text=t("pick_sub", lang=shown))
        hint.config(text=t("pick_hint", lang=shown))
        go.config(text=t("pick_continue", lang=choice["code"]))
        for code, (frame, name_lbl, hi_lbl) in buttons.items():
            selected = code == choice["code"]
            colour = "#fbe9e7" if selected else "#ffffff"
            border = accent if selected else "#e2ddd4"
            frame.config(bg=colour, highlightbackground=border, highlightcolor=border,
                         highlightthickness=2 if selected else 1)
            name_lbl.config(bg=colour, fg=accent if selected else ink)
            hi_lbl.config(bg=colour)

    def select(code):
        choice["code"] = code
        refresh()

    for i, (code, name, hello) in enumerate(LANGUAGES):
        frame = tk.Frame(grid, bg="#ffffff", highlightthickness=1, highlightbackground="#e2ddd4",
                         cursor="hand2", width=170, height=58)
        frame.grid(row=i // 2, column=i % 2, padx=6, pady=6)
        frame.pack_propagate(False)
        name_lbl = tk.Label(frame, text=name, font=("Segoe UI", 11, "bold"), bg="#ffffff", fg=ink, cursor="hand2")
        name_lbl.pack(pady=(8, 0))
        hi_lbl = tk.Label(frame, text=hello, font=("Segoe UI", 9), bg="#ffffff", fg=muted, cursor="hand2")
        hi_lbl.pack()
        buttons[code] = (frame, name_lbl, hi_lbl)
        for widget in (frame, name_lbl, hi_lbl):
            widget.bind("<Button-1>", lambda e, c=code: select(c))
            widget.bind("<Double-Button-1>", lambda e, c=code: (select(c), finish()))
            widget.bind("<Enter>", lambda e, c=code: refresh(hover_code=c))
            widget.bind("<Leave>", lambda e: refresh())

    hint = tk.Label(outer, font=("Segoe UI", 8), fg=muted, bg=bg)
    hint.pack(pady=(10, 8))

    def finish():
        root.destroy()

    go = tk.Button(outer, font=("Segoe UI", 10, "bold"), bg=accent, fg="#ffffff", activebackground="#6b1212",
                   activeforeground="#ffffff", relief=tk.FLAT, bd=0, padx=18, pady=5, cursor="hand2",
                   command=finish)
    go.pack()
    root.bind("<Return>", lambda e: finish())
    root.protocol("WM_DELETE_WINDOW", finish)

    # little animated pet waving hello
    def animate(step=[0]):
        if not pet_mod:
            return
        try:
            look = pet_mod.default_look(pet_mod.DEFAULT_PET_SETTINGS)
            phase = step[0] * 0.12
            look.update(t=phase, wag=math_sin(phase * 4) * 3, mouth="smile", blush=True,
                        hop=abs(math_sin(phase * 2.5)) * 3, squash=math_sin(phase * 2) * 0.03)
            if (step[0] // 25) % 4 == 3:
                look["eyes"] = "happy"
            preview.delete("all")
            pet_mod.draw_pet(preview, 60, 88, 64, look)
            step[0] += 1
            root.after(50, animate)
        except tk.TclError:
            pass

    refresh()
    root.update_idletasks()
    w, h = root.winfo_reqwidth(), root.winfo_reqheight()
    root.geometry("+%d+%d" % ((root.winfo_screenwidth() - w) // 2, (root.winfo_screenheight() - h) // 3))
    animate()
    root.focus_force()
    root.mainloop()
    return choice["code"]


def math_sin(x):
    import math
    return math.sin(x)
