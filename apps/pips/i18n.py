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
    "p_open": ("Open Pips", "Buka Pips", "開啟 Pips", "打开 Pips"),
    "p_hide_window": ("Hide Pips window", "Sembunyikan jendela Pips", "隱藏 Pips 視窗", "隐藏 Pips 窗口"),
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
    "p_click_open": ("Tickle + open Pips", "Gelitik + buka Pips", "搔癢 + 開啟 Pips", "挠痒 + 打开 Pips"),
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
    "click_open_long": ("Tickle it and open the Pips window", "Gelitik dan buka jendela Pips",
                        "搔癢並開啟 Pips 視窗", "挠痒并打开 Pips 窗口"),
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
    "tour_card": ("Step 2/6 \u00b7 Hehe, that tickles! Clicking me opens Pips.\nClick the ring to start a 25-minute focus session. The \u2013 or \u2715 button hides it back to me.",
                  "Langkah 2/6 \u00b7 Hehe, geli! Klik aku juga membuka Pips.\nKlik lingkaran untuk mulai fokus 25 menit. Tombol \u2013 atau \u2715 menyembunyikannya lagi ke aku.",
                  "步驟 2/6 \u00b7 嘿嘿, 好癢! 點我也會開啟 Pips。\n點圓環開始 25 分鐘專注。按 \u2013 或 \u2715 會把它收回我這裡。",
                  "步骤 2/6 \u00b7 嘿嘿, 好痒! 点我也会打开 Pips。\n点圆环开始 25 分钟专注。按 \u2013 或 \u2715 会把它收回我这里。"),
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
    "about_text": ("Pips {v} \u00b7 desktop pet + Pomodoro focus widget\nOwner: {owner}\njuw12.github.io/projects/pips",
                   "Pips {v} \u00b7 peliharaan desktop + widget fokus Pomodoro\nPemilik: {owner}\njuw12.github.io/projects/pips",
                   "Pips {v} \u00b7 桌面寵物 + 番茄鐘專注小工具\n擁有者：{owner}\njuw12.github.io/projects/pips",
                   "Pips {v} \u00b7 桌面宠物 + 番茄钟专注小工具\n所有者：{owner}\njuw12.github.io/projects/pips"),
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
