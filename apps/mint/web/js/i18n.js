/* Mint language layer — English source, Bahasa Indonesia translation.
 *
 * The app renders English HTML strings. This file translates the rendered UI text in place
 * (text nodes plus placeholder / title / aria-label) and keeps the English original on every
 * node, so switching back is instant and nothing is lost. User content is never touched:
 * anything inside [translate="no"], inputs, textareas, <code> and the sheet previews stays as is.
 * Strings that are not in the dictionary simply stay in English.
 */
(function (root) {
  "use strict";

  // One language for all of Mint (en / id / zh / es), chosen on the first visit (js/locale.js).
  // Templates is translated into Indonesian; Chinese and Spanish show it in English.
  var KEY = "mint.lang";
  var LANGS = { en: "English", id: "Bahasa Indonesia" };

  // ---------------------------------------------------------------- exact phrases
  var ID = {
    // header, nav, footer
    "Budget": "Anggaran",
    "Your shared budgets": "Anggaran bersamamu",
    "Create": "Buat",
    "Market": "Pasar",
    "Library": "Koleksi",
    "Sell": "Jual",
    "Affiliate": "Afiliasi",
    "Guides": "Panduan",
    "Log in": "Masuk",
    "Log out": "Keluar",
    "Account": "Akun",
    "Skip to content": "Langsung ke konten",
    "Light / dark": "Terang / gelap",
    "Toggle light or dark interface": "Ganti tampilan terang atau gelap",
    "Loading Mint…": "Memuat Mint…",
    "Loading…": "Memuat…",
    "Mint · buyers pay sellers directly ·": "Mint · pembeli membayar penjual langsung ·",
    "Get the app": "Dapatkan aplikasinya",
    "Privacy": "Privasi",
    "Terms": "Ketentuan",
    "· made by": "· dibuat oleh",
    "Main": "Utama",
    "Live": "Live",
    "Offline": "Offline",
    "Language": "Bahasa",

    // home
    "Prompt a spreadsheet template.": "Ketik, jadilah template spreadsheet.",
    "Tweak it. Sell it.": "Ubah sesukamu. Jual.",
    "Describe what you need in English or Bahasa Indonesia. Mint builds a themed Excel / Google Sheets template with live formulas, dropdowns and a dashboard — then publish it to the market, or let affiliates sell it for you.":
      "Tulis kebutuhanmu dalam Bahasa Indonesia atau Inggris. Mint membuat template Excel / Google Sheets bertema lengkap dengan rumus aktif, dropdown, dan dashboard — lalu jual di pasar, atau biarkan afiliasi menjualkannya untukmu.",
    "Prompt": "Ketik",
    "“Inventory for my online shop, green” → a working template in a second.": "“Stok untuk toko online-ku, hijau” → template siap pakai dalam sedetik.",
    "Tweak": "Ubah",
    "Edit with words (“add column Supplier”) or by hand. Pick a theme.": "Ubah dengan kata-kata (“tambah kolom Pemasok”) atau manual. Pilih tema.",
    "Publish with a price and affiliate %, get a content kit, track sales.": "Terbitkan dengan harga dan % afiliasi, dapatkan kit konten, pantau penjualan.",
    "Fresh in the market": "Baru di pasar",
    "Browse all →": "Lihat semua →",
    "Creator guides": "Panduan kreator",
    "All guides →": "Semua panduan →",
    "← All guides": "← Semua panduan",
    "Earn without making templates": "Dapat penghasilan tanpa membuat template",
    "Join the affiliate program: share any listing with an “Earn %” badge and get paid commission on every sale you refer.":
      "Ikut program afiliasi: bagikan listing dengan lencana “Earn %” dan dapatkan komisi dari setiap penjualan yang kamu bawa.",
    "How it works": "Cara kerjanya",
    "How it works →": "Cara kerjanya →",
    "No listings yet.": "Belum ada listing.",
    "Make, theme, price, promote and sell spreadsheet templates.": "Buat, beri tema, tentukan harga, promosikan, dan jual template spreadsheet.",

    // create / studio
    "Create a template": "Buat template",
    "Describe your template": "Jelaskan template yang kamu mau",
    "e.g. Freelance invoice tracker in rupiah with notes, ocean theme": "mis. Pelacak invoice freelance dalam rupiah dengan catatan, tema ocean",
    "Use my AI": "Pakai AI-ku",
    "Designed by an AI model; the quick generator is used if AI is busy": "Dirancang oleh model AI; generator cepat dipakai jika AI sedang sibuk",
    "Mint AI": "Mint AI",
    "✨ Generate": "✨ Buat",
    "Generating…": "Membuat…",
    "…or start from a blueprint": "…atau mulai dari cetak biru",
    "Freelance invoice tracker with notes": "Pelacak invoice freelance dengan catatan",
    "Monthly budget in rupiah, pastel pink": "Anggaran bulanan dalam rupiah, pink pastel",
    "Inventory for my online shop, green": "Stok untuk toko online-ku, hijau",
    "Content calendar for TikTok and Instagram": "Kalender konten untuk TikTok dan Instagram",
    "Airbnb host profit tracker": "Pelacak profit tuan rumah Airbnb",
    "Describe the template you want first": "Jelaskan dulu template yang kamu mau",
    "Designed by Mint AI. Tweak anything below — or ask in words.": "Dirancang oleh Mint AI. Ubah apa saja di bawah — atau minta dengan kata-kata.",
    "AI returned too few columns": "AI mengembalikan terlalu sedikit kolom",
    "Tweak with words": "Ubah dengan kata-kata",
    "Type a change and press Apply.": "Ketik perubahan lalu tekan Terapkan.",
    "Apply": "Terapkan",
    "Theme": "Tema",
    "Details": "Detail",
    "Title": "Judul",
    "Description": "Deskripsi",
    "Category": "Kategori",
    "Currency": "Mata uang",
    "💾 Save draft": "💾 Simpan draf",
    "🚀 Publish to market": "🚀 Terbitkan ke pasar",
    "＋ New template": "＋ Template baru",
    "Saved draft": "Draf tersimpan",
    "Unsaved": "Belum disimpan",
    "· changes auto-save on this device": "· perubahan tersimpan otomatis di perangkat ini",
    "＋ Add row": "＋ Tambah baris",
    "Columns": "Kolom",
    "Dashboard cards": "Kartu dashboard",
    "Colour rules": "Aturan warna",
    "Name": "Nama",
    "Type": "Tipe",
    "Options / formula": "Opsi / rumus",
    "Use [Column Name]": "Pakai [Nama Kolom]",
    "Result format": "Format hasil",
    "Column name": "Nama kolom",
    "Column type": "Tipe kolom",
    "Move left": "Geser ke kiri",
    "Move right": "Geser ke kanan",
    "Delete column": "Hapus kolom",
    "New column name": "Nama kolom baru",
    "Add column": "Tambah kolom",
    "Card label": "Label kartu",
    "Count when equal to": "Hitung jika sama dengan",
    "equals": "sama dengan",
    "Remove card": "Hapus kartu",
    "＋ Add card": "＋ Tambah kartu",
    "Value": "Nilai",
    "Remove rule": "Hapus aturan",
    "＋ Add rule": "＋ Tambah aturan",
    "Formula:": "Rumus:",
    "Formula problems:": "Masalah rumus:",
    "Formula included in the full template": "Rumus disertakan di template lengkap",
    "Delete row": "Hapus baris",
    "Draft saved to your account": "Draf tersimpan di akunmu",
    "Start a new template? Unsaved changes to this one stay only if you saved the draft.": "Mulai template baru? Perubahan yang belum disimpan hanya tetap ada jika draf sudah kamu simpan.",
    "Log in to save drafts and publish": "Masuk untuk menyimpan draf dan menerbitkan",
    "Downloaded .xlsx — opens in Excel and Google Sheets": "File .xlsx terunduh — bisa dibuka di Excel dan Google Sheets",
    "Copied": "Disalin",
    "Something went wrong": "Terjadi kesalahan",
    "Save or open": "Simpan atau buka",
    "Yes": "Ya",
    "No": "Tidak",

    // market
    "Template market": "Pasar template",
    "Search templates…": "Cari template…",
    "Search": "Cari",
    "All categories": "Semua kategori",
    "Sort": "Urutkan",
    "Newest": "Terbaru",
    "Best selling": "Terlaris",
    "Top rated": "Rating tertinggi",
    "Price: low to high": "Harga: rendah ke tinggi",
    "Price: high to low": "Harga: tinggi ke rendah",
    "Free only": "Hanya gratis",
    "No templates match.": "Tidak ada template yang cocok.",
    "Create the first one": "Buat yang pertama",
    "Free": "Gratis",
    "New": "Baru",
    "Earn": "Dapat",
    "Earn %": "Earn %",
    "No ratings yet": "Belum ada rating",

    // item page
    "← Market": "← Pasar",
    "by": "oleh",
    "Live preview": "Pratinjau langsung",
    "🔒 Preview — columns marked 🔒 show sample results only. The formulas, dropdown logic and dashboard come with the file after purchase.":
      "🔒 Pratinjau — kolom bertanda 🔒 hanya menampilkan contoh hasil. Rumus, logika dropdown, dan dashboard ada di file setelah pembelian.",
    "Reviews": "Ulasan",
    "No reviews yet.": "Belum ada ulasan.",
    "Rating": "Rating",
    "Rate this template": "Beri rating template ini",
    "What did it help with?": "Template ini membantu untuk apa?",
    "Post review": "Kirim ulasan",
    "Reported — thanks, we’ll take a look": "Dilaporkan — terima kasih, akan kami periksa",
    "⚠ Report this template": "⚠ Laporkan template ini",
    "This is your listing.": "Ini listing milikmu.",
    "📣 Content kit": "📣 Kit konten",
    "Content kit": "Kit konten",
    "✔ In your library": "✔ Ada di koleksimu",
    "⬇ Download .xlsx": "⬇ Unduh .xlsx",
    "Download .xlsx": "Unduh .xlsx",
    "— waiting for payment": "— menunggu pembayaran",
    "Pay now ↗": "Bayar sekarang ↗",
    "I’ve paid — check now": "Sudah bayar — cek sekarang",
    "Cancel order": "Batalkan pesanan",
    "Got a coupon? Re-order at the lower price": "Punya kupon? Pesan ulang dengan harga lebih murah",
    "Have a coupon?": "Punya kupon?",
    "Coupon code": "Kode kupon",
    "Put": "Tulis",
    "in the payment note.": "di catatan pembayaran.",
    "The seller confirms → it unlocks in your library.": "Penjual mengonfirmasi → template terbuka di koleksimu.",
    "seller’s checkout": "checkout penjual",
    "Get it free": "Ambil gratis",
    "You’ll pay on": "Kamu akan membayar di",
    "You pay the seller directly on their checkout (QRIS, e-wallet, card…). Your order reference unlocks the template once the seller confirms. Your name and email are shared with the seller for this order.":
      "Kamu membayar penjual langsung di checkout mereka (QRIS, e-wallet, kartu…). Kode pesananmu membuka template setelah penjual mengonfirmasi. Nama dan email kamu dibagikan ke penjual untuk pesanan ini.",
    "Offline — connect to buy.": "Offline — sambungkan internet untuk membeli.",
    "Get affiliate link": "Dapatkan link afiliasi",
    "Your affiliate link": "Link afiliasimu",
    "Copy link": "Salin link",
    "Copy code": "Salin kode",
    "Log in to get this template": "Masuk untuk mendapatkan template ini",
    "Already in your library": "Sudah ada di koleksimu",
    "Added to your library 🎉": "Ditambahkan ke koleksimu 🎉",
    "Checking…": "Memeriksa…",
    "Payment confirmed — it’s in your library 🎉": "Pembayaran terkonfirmasi — sudah ada di koleksimu 🎉",
    "Not paid yet — finish on the checkout page, then check again": "Belum dibayar — selesaikan di halaman checkout, lalu cek lagi",
    "Log in to report a template": "Masuk untuk melaporkan template",
    "What’s wrong with this template? (copied, misleading, broken, spam, offensive…)": "Ada masalah apa dengan template ini? (jiplakan, menyesatkan, rusak, spam, menyinggung…)",
    "Thanks — report sent": "Terima kasih — laporan terkirim",
    "Cancel this order? Only do this if you haven’t paid.": "Batalkan pesanan ini? Lakukan hanya jika kamu belum membayar.",
    "Order cancelled": "Pesanan dibatalkan",
    "Log in to become an affiliate": "Masuk untuk menjadi afiliasi",
    "Thanks for the review": "Terima kasih atas ulasannya",
    "Not found": "Tidak ditemukan",
    "Back to market": "Kembali ke pasar",
    "Log in to use a coupon": "Masuk untuk memakai kupon",

    // library
    "Your library": "Koleksimu",
    "Templates you buy or claim appear here.": "Template yang kamu beli atau ambil muncul di sini.",
    "Orders": "Pesanan",
    "waiting for seller": "menunggu penjual",
    "Pay ↗": "Bayar ↗",
    "Check payment": "Cek pembayaran",
    "View": "Lihat",
    "Paid already? Instant-checkout orders unlock automatically (or tap Check payment); for payment-link orders the seller confirms using the reference.":
      "Sudah bayar? Pesanan checkout instan terbuka otomatis (atau ketuk Cek pembayaran); untuk pesanan lewat link pembayaran, penjual mengonfirmasi dengan kode referensi.",
    "Nothing here yet.": "Belum ada apa-apa.",
    "Browse the market": "Jelajahi pasar",
    "Copy into the Studio for personal edits": "Salin ke Studio untuk diedit sendiri",
    "Customize": "Sesuaikan",
    "Purchased templates are licensed for your own use. Re-selling someone else’s template is not allowed.":
      "Template yang dibeli berlisensi untuk dipakai sendiri. Menjual ulang template milik orang lain tidak diperbolehkan.",
    "Payment confirmed 🎉": "Pembayaran terkonfirmasi 🎉",
    "Not paid yet": "Belum dibayar",

    // sell dashboard
    "Sell templates": "Jual template",
    "Log in to save drafts, publish and track sales.": "Masuk untuk menyimpan draf, menerbitkan, dan memantau penjualan.",
    "Seller dashboard": "Dashboard penjual",
    "Gross": "Bruto",
    "Affiliate payouts": "Pembayaran afiliasi",
    "Your earnings": "Penghasilanmu",
    "Sales": "Penjualan",
    "Orders to confirm": "Pesanan untuk dikonfirmasi",
    "Check your payment app for the reference in the payment note, then confirm. Confirmed buyers can download immediately.":
      "Cek aplikasi pembayaranmu untuk kode referensi di catatan pembayaran, lalu konfirmasi. Pembeli yang dikonfirmasi bisa langsung mengunduh.",
    "Payment received": "Pembayaran diterima",
    "Not paid": "Belum dibayar",
    "Last 30 days": "30 hari terakhir",
    "views count once per visitor per hour": "tampilan dihitung sekali per pengunjung per jam",
    "Views": "Tampilan",
    "Conversion": "Konversi",
    "Earned": "Pendapatan",
    "Coupons": "Kupon",
    "Discount codes for launches, followers or bundles. Buyers type the code or open your coupon link; affiliate commission is paid on the discounted price.":
      "Kode diskon untuk peluncuran, pengikut, atau paket. Pembeli mengetik kode atau membuka link kuponmu; komisi afiliasi dihitung dari harga setelah diskon.",
    "All your templates": "Semua templatemu",
    "Pause": "Jeda",
    "Resume": "Lanjutkan",
    "Delete": "Hapus",
    "New coupon": "Kupon baru",
    "Code": "Kode",
    "Discount %": "Diskon %",
    "Applies to": "Berlaku untuk",
    "All my paid templates": "Semua template berbayarku",
    "Max uses (0 = unlimited)": "Maks. pemakaian (0 = tanpa batas)",
    "Expires after days (0 = never)": "Kedaluwarsa setelah (hari, 0 = tidak pernah)",
    "Create coupon": "Buat kupon",
    "Coupons work on paid templates — publish one first.": "Kupon berlaku untuk template berbayar — terbitkan satu dulu.",
    "Affiliate commissions": "Komisi afiliasi",
    "Pay affiliates to the details they gave, then mark it paid.": "Bayar afiliasi ke rekening yang mereka berikan, lalu tandai sudah dibayar.",
    "affiliate hasn’t added payout details yet": "afiliasi belum menambahkan detail pembayaran",
    "Mark paid": "Tandai lunas",
    "Listings": "Listing",
    "Unpublish": "Sembunyikan",
    "Republish": "Terbitkan lagi",
    "Save": "Simpan",
    "No listings yet — publish a draft below.": "Belum ada listing — terbitkan draf di bawah.",
    "Drafts": "Draf",
    "Publish": "Terbitkan",
    "No saved drafts.": "Belum ada draf tersimpan.",
    "Recent sales": "Penjualan terbaru",
    "No sales yet. Share your listing with the content kit.": "Belum ada penjualan. Bagikan listingmu dengan kit konten.",
    "Turn off automatic payments? Listings without a payment link stop accepting new orders.": "Matikan pembayaran otomatis? Listing tanpa link pembayaran berhenti menerima pesanan baru.",
    "Automatic payments turned off": "Pembayaran otomatis dimatikan",
    "Delete this coupon? Orders that used it keep their price.": "Hapus kupon ini? Pesanan yang sudah memakainya tetap dengan harganya.",
    "Coupon deleted": "Kupon dihapus",
    "Coupon updated": "Kupon diperbarui",
    "Mark this order as not paid? The buyer can order again.": "Tandai pesanan ini belum dibayar? Pembeli bisa memesan lagi.",
    "Confirmed — the buyer can download now": "Terkonfirmasi — pembeli bisa mengunduh sekarang",
    "Order rejected": "Pesanan ditolak",
    "Commission marked paid": "Komisi ditandai lunas",
    "Delete this draft?": "Hapus draf ini?",
    "Checking the key…": "Memeriksa kunci…",
    "Connect": "Hubungkan",
    "Listing updated": "Listing diperbarui",
    "test mode": "mode uji",
    "Disconnect": "Putuskan",
    "⚡ Get paid automatically": "⚡ Dibayar otomatis",
    "— QRIS, e-wallets, VA and cards; files unlock the moment buyers pay": "— QRIS, e-wallet, VA, dan kartu; file terbuka begitu pembeli membayar",
    "Connect your own payment account. Buyers pay on its secure checkout, Mint confirms the payment directly with the provider and unlocks the template instantly. The money goes to you, not to Mint.":
      "Hubungkan akun pembayaranmu sendiri. Pembeli membayar di checkout amannya, Mint mengonfirmasi pembayaran langsung ke penyedia dan membuka template seketika. Uangnya masuk ke kamu, bukan ke Mint.",
    "Provider": "Penyedia",
    "(most currencies)": "(sebagian besar mata uang)",
    "Try it first with a sandbox / test key — Mint shows “test mode” until you switch to a live key.": "Coba dulu dengan kunci sandbox / test — Mint menampilkan “mode uji” sampai kamu beralih ke kunci live.",
    "and unlocks the file instantly — nothing to confirm by hand. Money goes straight to your account.": "dan membuka file seketika — tidak perlu konfirmasi manual. Uang langsung masuk ke rekeningmu.",
    "; other listings keep using your payment link.": "; listing lain tetap memakai link pembayaranmu.",
    "· stored encrypted, used only to create checkouts and read their status.": "· disimpan terenkripsi, hanya dipakai untuk membuat checkout dan membaca statusnya.",
    "live": "tayang",
    "hidden": "tersembunyi",
    "flagged": "ditandai",
    "removed": "dihapus",
    "active": "aktif",
    "paused": "dijeda",
    "expired": "kedaluwarsa",
    "owed": "terutang",
    "paid": "lunas",

    // publish
    "Log in to publish templates.": "Masuk untuk menerbitkan template.",
    "Draft not found.": "Draf tidak ditemukan.",
    "Tags (comma separated)": "Tag (pisahkan dengan koma)",
    "Your payment link": "Link pembayaranmu",
    "(required for paid templates — or turn on automatic payments under Sell)": "(wajib untuk template berbayar — atau aktifkan pembayaran otomatis di Jual)",
    "Buyers pay you directly there and add their order reference; you confirm in your dashboard and they get the file. Mint never holds your money.":
      "Pembeli membayarmu langsung di sana dan menambahkan kode pesanan; kamu konfirmasi di dashboard dan mereka mendapat filenya. Mint tidak pernah memegang uangmu.",
    "Platform fee": "Biaya platform",
    "Buyer preview": "Pratinjau pembeli",
    "Published! 🎉": "Terbit! 🎉",

    // affiliate
    "Affiliate program": "Program afiliasi",
    "Log in, open any listing with an “Earn %” badge and get your link.": "Masuk, buka listing dengan lencana “Earn %”, lalu dapatkan link-mu.",
    "Affiliate dashboard": "Dashboard afiliasi",
    "Where should sellers pay you?": "Penjual harus membayarmu ke mana?",
    "Shown only to sellers who owe you commission. E.g. “BCA 1234567 a.n. Your Name”, “GoPay 0812…” or a PayPal email.":
      "Hanya ditampilkan ke penjual yang berutang komisi kepadamu. Mis. “BCA 1234567 a.n. Nama Kamu”, “GoPay 0812…”, atau email PayPal.",
    "Bank / e-wallet / PayPal": "Bank / e-wallet / PayPal",
    "Save payout details": "Simpan detail pembayaran",
    "Links": "Link",
    "Clicks": "Klik",
    "Referred sales": "Penjualan dari referal",
    "No links yet. Find templates with an": "Belum ada link. Cari template dengan lencana",
    "Find templates to promote": "Cari template untuk dipromosikan",
    "Payout details saved": "Detail pembayaran tersimpan",

    // content kit
    "Ready-to-post copy with": "Teks siap posting dengan",
    "your affiliate link": "link afiliasimu",
    "the listing link": "link listing",
    "and a themed share card. Disclose affiliate links where required.": "dan kartu berbagi bertema. Cantumkan bahwa itu link afiliasi jika diwajibkan.",
    "Promo copy": "Teks promosi",
    "Copy text": "Salin teks",
    "Share card preview": "Pratinjau kartu berbagi",
    "⬇ Download share card (PNG)": "⬇ Unduh kartu berbagi (PNG)",
    "TikTok / Reels script": "Naskah TikTok / Reels",
    "Blog outline (SEO)": "Kerangka blog (SEO)",

    // auth + account
    "Email": "Email",
    "Password": "Kata sandi",
    "Forgot password?": "Lupa kata sandi?",
    "Create account": "Buat akun",
    "Password (8+ characters)": "Kata sandi (8+ karakter)",
    "Mint is offline right now — this account only lives in this browser until the connection is back.": "Mint sedang offline — akun ini hanya ada di browser ini sampai koneksi kembali.",
    "Your account works on every device. Passwords are hashed; we never see them.": "Akunmu bisa dipakai di semua perangkat. Kata sandi di-hash; kami tidak pernah melihatnya.",
    "Reset password": "Atur ulang kata sandi",
    "Use the recovery code you saved when you created your account (MINT-XXXX-XXXX-XXXX). Without it the account can’t be recovered — Mint stores no other way to prove it’s you.":
      "Pakai kode pemulihan yang kamu simpan saat membuat akun (MINT-XXXX-XXXX-XXXX). Tanpa kode itu akun tidak bisa dipulihkan — Mint tidak menyimpan cara lain untuk membuktikan itu kamu.",
    "Recovery code": "Kode pemulihan",
    "New password (8+ characters)": "Kata sandi baru (8+ karakter)",
    "Reset and log in": "Atur ulang dan masuk",
    "Back to log in": "Kembali ke halaman masuk",
    "Your recovery code": "Kode pemulihanmu",
    "🔑 Save your recovery code": "🔑 Simpan kode pemulihanmu",
    "Copy": "Salin",
    "Save as file": "Simpan sebagai file",
    "I saved it somewhere safe": "Sudah kusimpan di tempat aman",
    "Done": "Selesai",
    "If you ever forget your password, this code is the only way back into your account. Keep it in your notes or password manager.":
      "Kalau kamu lupa kata sandi, kode ini satu-satunya cara masuk kembali ke akunmu. Simpan di catatan atau pengelola kata sandi.",
    "Password changed and other devices signed out. Your old recovery code is used up — here is the new one.": "Kata sandi diganti dan perangkat lain dikeluarkan. Kode pemulihan lama sudah terpakai — ini kode barunya.",
    "Close": "Tutup",
    "Log in or create an account to buy, sell and earn as an affiliate.": "Masuk atau buat akun untuk membeli, menjual, dan dapat komisi sebagai afiliasi.",
    "Offline — changes stay in this browser": "Offline — perubahan tersimpan di browser ini",
    "Clear offline data": "Hapus data offline",
    "Profile & payouts": "Profil & pembayaran",
    "Display name": "Nama tampilan",
    "Affiliate payout details": "Detail pembayaran afiliasi",
    "📲 Mint on your phone": "📲 Mint di ponselmu",
    "Android app, iPhone home-screen app, or install from your browser.": "Aplikasi Android, aplikasi layar utama iPhone, atau pasang dari browser.",
    "Advanced: your own AI model": "Lanjutan: model AI milikmu",
    "Mint AI is built in. If you prefer your own OpenAI-compatible model, add it here — the key stays in this browser and is sent only to that endpoint.":
      "Mint AI sudah tersedia. Jika kamu lebih suka model sendiri yang kompatibel dengan OpenAI, tambahkan di sini — kuncinya tetap di browser ini dan hanya dikirim ke endpoint tersebut.",
    "Save AI settings": "Simpan pengaturan AI",
    "AI settings saved": "Pengaturan AI tersimpan",
    "Saved": "Tersimpan",
    "Erase the offline data stored in this browser?": "Hapus data offline yang tersimpan di browser ini?",
    "🔔 Notifications": "🔔 Notifikasi",
    "New orders to confirm, payments received, templates unlocked and commissions paid.": "Pesanan baru untuk dikonfirmasi, pembayaran diterima, template terbuka, dan komisi dibayar.",
    "Checking this device…": "Memeriksa perangkat ini…",
    "Email me about orders, payments and commissions": "Kirimi aku email tentang pesanan, pembayaran, dan komisi",
    "Email notifications will appear here once Mint’s email sender is set up.": "Notifikasi email akan muncul di sini setelah pengirim email Mint disiapkan.",
    "Notifications are blocked for Mint in this browser’s site settings.": "Notifikasi untuk Mint diblokir di pengaturan situs browser ini.",
    "✔ On for this device.": "✔ Aktif untuk perangkat ini.",
    "Turn off": "Matikan",
    "Turn on notifications on this device": "Aktifkan notifikasi di perangkat ini",
    "Notifications were not allowed": "Notifikasi tidak diizinkan",
    "Notifications on — a test notification is on its way": "Notifikasi aktif — notifikasi uji sedang dikirim",
    "Notifications off for this device": "Notifikasi dimatikan untuk perangkat ini",
    "Email notifications on": "Notifikasi email aktif",
    "Email notifications off": "Notifikasi email mati",
    "Phone notifications aren’t available inside the Android app yet. Open Mint in Chrome (or install it from Chrome) and switch them on there.":
      "Notifikasi ponsel belum tersedia di dalam aplikasi Android. Buka Mint di Chrome (atau pasang dari Chrome) lalu aktifkan di sana.",
    "Push notifications aren’t switched on for this Mint server yet.": "Notifikasi push belum diaktifkan untuk server Mint ini.",
    "This browser can’t show notifications. On iPhone, add Mint to your Home Screen first (iOS 16.4+), then turn them on from the Home Screen app.":
      "Browser ini tidak bisa menampilkan notifikasi. Di iPhone, tambahkan Mint ke Layar Utama dulu (iOS 16.4+), lalu aktifkan dari aplikasi di Layar Utama.",
    "You have a recovery code. Lost it? Make a new one — the old one stops working.": "Kamu punya kode pemulihan. Hilang? Buat yang baru — kode lama tidak berlaku lagi.",
    "You don’t have a recovery code yet. Make one now so you can reset a forgotten password.": "Kamu belum punya kode pemulihan. Buat sekarang agar bisa mengatur ulang kata sandi yang terlupa.",
    "Change password": "Ganti kata sandi",
    "Current password": "Kata sandi saat ini",
    "Your other devices are signed out.": "Perangkatmu yang lain dikeluarkan.",
    "New recovery code": "Kode pemulihan baru",
    "Delete account": "Hapus akun",
    "Removes your login, drafts, affiliate links and payout details and takes your listings off the market.": "Menghapus akun masuk, draf, link afiliasi, dan detail pembayaranmu serta menurunkan listingmu dari pasar.",
    "Buyers keep templates they already paid for and order records stay for their bookkeeping. This can’t be undone.": "Pembeli tetap memiliki template yang sudah dibayar dan catatan pesanan tetap ada untuk pembukuan mereka. Ini tidak bisa dibatalkan.",
    "Type DELETE to confirm": "Ketik DELETE untuk konfirmasi",
    "Delete my account": "Hapus akunku",
    "Password changed — other devices signed out": "Kata sandi diganti — perangkat lain dikeluarkan",
    "Your previous recovery code no longer works. Save this new one.": "Kode pemulihan sebelumnya tidak berlaku lagi. Simpan kode baru ini.",
    "Your account was deleted": "Akunmu sudah dihapus",
    "Connected to Mint": "Terhubung ke Mint",
    "Finance": "Keuangan",
    "Business": "Bisnis",
    "Productivity": "Produktivitas",
    "Lifestyle": "Gaya hidup",
    "Creator": "Kreator",
    "Health": "Kesehatan",
    "Education": "Pendidikan",
    "Events": "Acara",
    "Other": "Lainnya",
    "Install Mint": "Pasang Mint",
    "badge.": ".",
    "Edit": "Ubah",
    "Secret / server key": "Kunci rahasia / server key",
    "API key": "Kunci API",
    "Midtrans — QRIS, GoPay, ShopeePay, OVO, bank transfer (VA), cards": "Midtrans — QRIS, GoPay, ShopeePay, OVO, transfer bank (VA), kartu",
    "Xendit — QRIS, e-wallets, bank transfer (VA), retail outlets, cards": "Xendit — QRIS, e-wallet, transfer bank (VA), gerai ritel, kartu",
    "Stripe — cards, Apple Pay, Google Pay, local methods Stripe enables for you": "Stripe — kartu, Apple Pay, Google Pay, metode lokal yang diaktifkan Stripe untukmu",
    "Views per day for the last 30 days, dots mark days with sales": "Tampilan per hari selama 30 hari terakhir, titik menandai hari dengan penjualan",
    "BCA 1234567 a.n. Name · GoPay 0812… · PayPal email": "BCA 1234567 a.n. Nama · GoPay 0812… · email PayPal",
    "download": "unduh",
    "Can’t reach Mint — working offline in this browser": "Tidak bisa terhubung ke Mint — bekerja offline di browser ini",

    // install
    "📲 You’re using the Mint app": "📲 Kamu sedang memakai aplikasi Mint",
    "It always loads the latest version of Mint, so there’s nothing to update by hand.": "Aplikasi selalu memuat versi Mint terbaru, jadi tidak perlu diperbarui manual.",
    "Back to Mint": "Kembali ke Mint",
    "📲 Get the Mint app": "📲 Dapatkan aplikasi Mint",
    "One account everywhere: web, Android and iPhone. The apps load the live Mint, so new features arrive without updating.": "Satu akun di mana saja: web, Android, dan iPhone. Aplikasinya memuat Mint versi live, jadi fitur baru datang tanpa perlu update.",
    "⬇ Download the Android app (APK)": "⬇ Unduh aplikasi Android (APK)",
    "Open the downloaded": "Buka file yang terunduh",
    "Allow installs from your browser when Android asks (one time).": "Izinkan pemasangan dari browser saat Android bertanya (sekali saja).",
    "Open Mint from your home screen. Same account and templates as the website.": "Buka Mint dari layar utama. Akun dan template sama dengan di situs web.",
    "Or install straight from Chrome:": "Atau pasang langsung dari Chrome:",
    "Install from Chrome": "Pasang dari Chrome",
    "Prefer no APK? In Chrome open the ⋮ menu →": "Tidak mau APK? Di Chrome buka menu ⋮ →",
    "Install app": "Instal aplikasi",
    "Add to Home screen": "Tambahkan ke Layar utama",
    "Open": "Buka",
    "Tap": "Ketuk",
    "Share": "Bagikan",
    "(the square with the arrow) →": "(kotak dengan panah) →",
    "Add to Home Screen": "Tambahkan ke Layar Utama",
    "Add": "Tambah",
    "Open Mint from the home screen — it runs full-screen with its own icon.": "Buka Mint dari layar utama — berjalan layar penuh dengan ikonnya sendiri.",
    "Not in the App Store yet (that needs an Apple developer account). The home-screen app is the same Mint with the same account.": "Belum ada di App Store (perlu akun developer Apple). Aplikasi layar utama adalah Mint yang sama dengan akun yang sama.",
    "💻 Computer": "💻 Komputer",
    "Chrome or Edge: click the install icon in the address bar (or menu →": "Chrome atau Edge: klik ikon instal di bilah alamat (atau menu →",
    "). Everything also works right here in the browser.": "). Semuanya juga berfungsi langsung di browser ini.",
    "Installed 🎉": "Terpasang 🎉",

    // store / API errors
    "Can’t reach Mint right now — check your connection": "Tidak bisa terhubung ke Mint sekarang — periksa koneksimu",
    "Please log in": "Silakan masuk",
    "Log in first": "Masuk dulu",
    "Enter a valid email": "Masukkan email yang valid",
    "Name is required": "Nama wajib diisi",
    "Password must be at least 8 characters": "Kata sandi minimal 8 karakter",
    "An account with this email already exists": "Sudah ada akun dengan email ini",
    "Wrong email or password": "Email atau kata sandi salah",
    "Password is wrong": "Kata sandi salah",
    "Listing not found": "Listing tidak ditemukan",
    "Title is required": "Judul wajib diisi",
    "Description is required": "Deskripsi wajib diisi",
    "Price must be 0 or more": "Harga harus 0 atau lebih",
    "Affiliate commission must be 0–50%": "Komisi afiliasi harus 0–50%",
    "Payment link must start with https://": "Link pembayaran harus diawali https://",
    "You can’t buy your own template": "Kamu tidak bisa membeli template milikmu sendiri",
    "Only buyers can review": "Hanya pembeli yang bisa memberi ulasan",
    "Rating must be 1–5": "Rating harus 1–5",
    "This seller doesn’t offer affiliate commission": "Penjual ini tidak menawarkan komisi afiliasi",
    "This template doesn’t offer affiliate commission": "Template ini tidak menawarkan komisi afiliasi",
    "This seller hasn’t set up payments yet": "Penjual ini belum mengatur pembayaran",
    "Coupons need a connection to Mint": "Kupon butuh koneksi ke Mint",
    "Orders need a connection to Mint": "Pesanan butuh koneksi ke Mint",
    "Editing listings needs a connection to Mint": "Mengedit listing butuh koneksi ke Mint",
    "Mint AI needs a connection": "Mint AI butuh koneksi",
    "Mint is offline right now — try again when it shows Live": "Mint sedang offline — coba lagi saat muncul Live",
    "That coupon code isn’t valid for this template": "Kode kupon itu tidak berlaku untuk template ini",
    "That coupon has expired": "Kupon itu sudah kedaluwarsa",
    "That coupon has been fully used": "Kupon itu sudah habis dipakai",
    "Enter a coupon code": "Masukkan kode kupon",
    "This template is already free": "Template ini sudah gratis",
    "Too many coupon attempts — wait a few minutes": "Terlalu banyak percobaan kupon — tunggu beberapa menit",
    "Discount must be 5–90%": "Diskon harus 5–90%",
    "Too many requests — try again later": "Terlalu banyak permintaan — coba lagi nanti",
    "Too many orders — try again later": "Terlalu banyak pesanan — coba lagi nanti",

    // guides — titles and summaries
    "Create a template in 2 minutes": "Buat template dalam 2 menit",
    "Describe it, tweak it with words, check the preview, export.": "Jelaskan, ubah dengan kata-kata, cek pratinjau, ekspor.",
    "Themes & branding": "Tema & branding",
    "Look consistent across every template you sell.": "Tampil konsisten di setiap template yang kamu jual.",
    "Pricing that sells": "Harga yang laku",
    "Free lead magnets, paid niche systems, bundles.": "Template gratis untuk menarik pembeli, sistem niche berbayar, paket.",
    "How the affiliate program works": "Cara kerja program afiliasi",
    "Anyone can promote any template and earn commission.": "Siapa pun bisa mempromosikan template mana pun dan mendapat komisi.",
    "Content marketing playbook": "Panduan pemasaran konten",
    "Turn one template into a week of posts.": "Ubah satu template jadi postingan seminggu.",
    "How payments work": "Cara kerja pembayaran",
    "How buying works on Mint, and how you get paid.": "Cara membeli di Mint, dan cara kamu dibayar.",
    "Install Mint on your phone": "Pasang Mint di ponselmu",
    "Android app, iPhone home-screen app, same account everywhere.": "Aplikasi Android, aplikasi layar utama iPhone, satu akun di mana saja.",

    // guides — bodies
    "1. Describe the job, not the spreadsheet.": "1. Jelaskan pekerjaannya, bukan spreadsheet-nya.",
    "“Invoice tracker for freelancers in rupiah, with notes” works better than “a table with 6 columns”. Mint picks the closest blueprint, then applies your currency, theme words (pastel, dark, minimal, green…) and extra columns (priority, owner, notes, deadline, status).":
      "“Pelacak invoice untuk freelancer dalam rupiah, dengan catatan” lebih baik daripada “tabel dengan 6 kolom”. Mint memilih cetak biru terdekat, lalu menerapkan mata uang, kata tema (pastel, gelap, minimal, hijau…) dan kolom tambahan (prioritas, pemilik, catatan, tenggat, status).",
    "2. Tweak with plain commands": "2. Ubah dengan perintah sederhana",
    "— one per line, English or Bahasa Indonesia:": "— satu per baris, Bahasa Indonesia atau Inggris:",
    "(formulas use [Column Name])": "(rumus memakai [Nama Kolom])",
    "3. Fine-tune by hand.": "3. Sempurnakan secara manual.",
    "Every cell, column type, dropdown option, formula, dashboard card and colour rule is editable in the Studio.": "Setiap sel, tipe kolom, opsi dropdown, rumus, kartu dashboard, dan aturan warna bisa diedit di Studio.",
    "4. Export.": "4. Ekspor.",
    "The .xlsx has live formulas, dropdowns, colour rules, a frozen header, 200 ready rows and a Dashboard tab. It opens in Excel and in Google Sheets (File › Import).":
      "File .xlsx berisi rumus aktif, dropdown, aturan warna, header yang dibekukan, 200 baris siap pakai, dan tab Dashboard. Bisa dibuka di Excel dan Google Sheets (File › Impor).",
    "Buyers judge templates by the thumbnail. Pick": "Pembeli menilai template dari thumbnail-nya. Pilih",
    "one signature theme": "satu tema khas",
    "for your shop (for example Blush for a lifestyle brand, Midnight for tech, Mono for business) and use it on every listing so your products are recognisable in the market grid.":
      "untuk tokomu (misalnya Blush untuk brand gaya hidup, Midnight untuk teknologi, Mono untuk bisnis) dan pakai di setiap listing agar produkmu mudah dikenali di pasar.",
    "Light themes": "Tema terang",
    "(Mint, Ocean, Sunset, Lavender, Blush, Forest, Mono) print well and suit business buyers.": "(Mint, Ocean, Sunset, Lavender, Blush, Forest, Mono) bagus saat dicetak dan cocok untuk pembeli bisnis.",
    "is a full dark sheet — popular with students and creators, less so for printing.": "adalah sheet gelap penuh — populer di kalangan pelajar dan kreator, kurang cocok untuk dicetak.",
    "Keep column names short (1–2 words) so headers stay readable on phones.": "Buat nama kolom singkat (1–2 kata) agar header tetap terbaca di ponsel.",
    "Put 4–6 realistic sample rows in every template: an empty sheet does not sell.": "Isi 4–6 baris contoh yang realistis di setiap template: sheet kosong tidak laku.",
    "The share card in": "Kartu berbagi di",
    "Affiliate › Content kit": "Afiliasi › Kit konten",
    "uses the listing’s theme automatically, so your social posts match your products.": "otomatis memakai tema listing, jadi postingan media sosialmu serasi dengan produkmu.",
    "Generic templates (basic budget, to-do list) compete with free versions everywhere. Charge for": "Template umum (anggaran dasar, daftar tugas) bersaing dengan versi gratis di mana-mana. Pasang harga untuk",
    "specific systems": "sistem yang spesifik",
    "that save a professional real time.": "yang benar-benar menghemat waktu seorang profesional.",
    "Free:": "Gratis:",
    "one simple, useful template to build your audience and reviews.": "satu template sederhana dan berguna untuk membangun audiens dan ulasan.",
    "Entry ($3–$7):": "Pemula ($3–$7):",
    "personal-life systems — habits, meals, travel, study.": "sistem kehidupan pribadi — kebiasaan, menu makan, perjalanan, belajar.",
    "Pro ($9–$19):": "Pro ($9–$19):",
    "business systems — invoices, inventory, CRM, rental P&L, pricing calculators.": "sistem bisnis — invoice, stok, CRM, laba rugi sewa, kalkulator harga.",
    "Bundles:": "Paket:",
    "list a bundle at roughly the price of 2 items to lift the average order.": "jual paket kira-kira seharga 2 item untuk menaikkan rata-rata nilai pesanan.",
    "Local pricing:": "Harga lokal:",
    "list in the buyer’s currency. In Indonesia, round, familiar prices (Rp 29.000, Rp 49.000, Rp 99.000) read better than converted dollar amounts.":
      "pasang harga dalam mata uang pembeli. Di Indonesia, harga bulat yang familier (Rp 29.000, Rp 49.000, Rp 99.000) lebih menarik daripada konversi dolar.",
    "Mint keeps a platform fee (shown in your Sell dashboard) and pays affiliates the commission you choose, only on sales they actually referred.":
      "Mint mengambil biaya platform (terlihat di dashboard Jual) dan afiliasi mendapat komisi yang kamu tentukan, hanya dari penjualan yang benar-benar mereka bawa.",
    "Sellers choose a commission (0–50%) when publishing. 0% means no affiliates.": "Penjual memilih komisi (0–50%) saat menerbitkan. 0% berarti tanpa afiliasi.",
    "Any logged-in user opens a listing and taps": "Pengguna yang sudah masuk membuka listing dan mengetuk",
    ". The link looks like": ". Link-nya seperti",
    "When a visitor arrives through the link, the referral is remembered on their device for": "Saat pengunjung datang lewat link itu, referalnya diingat di perangkat mereka selama",
    "30 days": "30 hari",
    "and the click is counted.": "dan kliknya dihitung.",
    "If they buy, the affiliate earns": "Jika mereka membeli, afiliasi mendapat",
    "price × commission": "harga × komisi",
    ". Self-referrals and seller-referrals earn nothing.": ". Referal ke diri sendiri dan dari penjual tidak mendapat apa-apa.",
    "Clicks, attributed sales and earnings appear in your Affiliate dashboard; the seller sees the same sale with the commission deducted.":
      "Klik, penjualan yang tercatat, dan penghasilan muncul di dashboard Afiliasi; penjual melihat penjualan yang sama dengan komisi yang sudah dipotong.",
    "Tip for sellers:": "Tips untuk penjual:",
    "25–35% gives creators a reason to make content about your template. You still keep the sale you would not otherwise have had.":
      "25–35% memberi kreator alasan untuk membuat konten tentang templatemu. Kamu tetap mendapat penjualan yang tadinya tidak akan terjadi.",
    "Templates sell when people": "Template laku saat orang",
    "see the result": "melihat hasilnya",
    ". Use the Content kit on any listing to get ready-made copy plus a themed share card, then post on this cadence:": ". Pakai Kit konten di listing mana pun untuk mendapat teks siap pakai dan kartu berbagi bertema, lalu posting dengan jadwal ini:",
    "Day 1 — short video (TikTok / Reels / Shorts):": "Hari 1 — video pendek (TikTok / Reels / Shorts):",
    "hook (“stop rebuilding this every month”), 8-second screen recording of totals updating, CTA.": "hook (“berhenti bikin ulang ini tiap bulan”), rekaman layar 8 detik saat total berubah, ajakan bertindak.",
    "Day 2 — carousel or LinkedIn post:": "Hari 2 — carousel atau postingan LinkedIn:",
    "the problem, 3 bullets of what the sheet does, link.": "masalahnya, 3 poin tentang fungsi sheet-nya, link.",
    "Day 3 — Pinterest pin:": "Hari 3 — pin Pinterest:",
    "share card + keyword-rich title (“freelance invoice tracker google sheets”).": "kartu berbagi + judul kaya kata kunci (“pelacak invoice freelance google sheets”).",
    "Day 5 — blog / SEO post:": "Hari 5 — artikel blog / SEO:",
    "use the outline from the kit; answer the question people search for.": "pakai kerangka dari kit; jawab pertanyaan yang dicari orang.",
    "Day 7 — WhatsApp / community share:": "Hari 7 — bagikan di WhatsApp / komunitas:",
    "personal recommendation with your affiliate link.": "rekomendasi pribadi dengan link afiliasimu.",
    "Always disclose affiliate links where required (for example “#affiliate” or “I earn a commission”). Track which channel works in your Affiliate dashboard and double down.":
      "Selalu cantumkan link afiliasi jika diwajibkan (misalnya “#afiliasi” atau “aku dapat komisi”). Pantau saluran mana yang berhasil di dashboard Afiliasi lalu fokus ke sana.",
    "Mint is live.": "Mint sudah live.",
    "Accounts, listings, orders and affiliate links are stored on Mint’s servers, so they work on every device. Mint never holds your money.":
      "Akun, listing, pesanan, dan link afiliasi disimpan di server Mint, jadi bisa dipakai di semua perangkat. Mint tidak pernah memegang uangmu.",
    "Option 1 — automatic (recommended).": "Opsi 1 — otomatis (disarankan).",
    "Under": "Di",
    "Sell → Get paid automatically": "Jual → Dibayar otomatis",
    ", connect your own Midtrans, Xendit or Stripe account with its secret key. Buyers then pay on that secure checkout (QRIS, e-wallets, bank transfer, cards); Mint confirms the payment directly with the provider and the file unlocks in seconds. Nothing to confirm by hand, and the money lands in your account. Try it first with a sandbox / test key.":
      ", hubungkan akun Midtrans, Xendit, atau Stripe milikmu dengan secret key-nya. Pembeli lalu membayar di checkout aman itu (QRIS, e-wallet, transfer bank, kartu); Mint mengonfirmasi pembayaran langsung ke penyedia dan file terbuka dalam hitungan detik. Tidak perlu konfirmasi manual, dan uangnya masuk ke rekeningmu. Coba dulu dengan kunci sandbox / test.",
    "Option 2 — payment link.": "Opsi 2 — link pembayaran.",
    "Add your own link when you publish (Lynk.id, Saweria, Trakteer, PayPal, Gumroad…):": "Tambahkan link-mu sendiri saat menerbitkan (Lynk.id, Saweria, Trakteer, PayPal, Gumroad…):",
    "A buyer clicks": "Pembeli mengklik",
    "Buy": "Beli",
    ", gets an order reference like": ", mendapat kode pesanan seperti",
    "and pays you on your link with that reference in the note.": "dan membayarmu lewat link-mu dengan kode itu di catatan.",
    "You get a notification and see the order under": "Kamu mendapat notifikasi dan melihat pesanannya di",
    "Sell → Orders to confirm": "Jual → Pesanan untuk dikonfirmasi",
    ". Tap": ". Ketuk",
    "and the buyer can download right away.": "dan pembeli bisa langsung mengunduh.",
    "Affiliates:": "Afiliasi:",
    "if an affiliate referred the sale, Mint shows the commission you owe and their payout details. Pay them, then tap": "jika penjualan berasal dari afiliasi, Mint menampilkan komisi yang harus kamu bayar dan detail rekening mereka. Bayar, lalu ketuk",
    "— they get notified.": "— mereka akan diberi tahu.",
    "Notifications:": "Notifikasi:",
    "switch them on under": "aktifkan di",
    "Account → Notifications": "Akun → Notifikasi",
    "(Chrome, Edge, Firefox, Android, and iPhone home-screen apps on iOS 16.4+). Free templates unlock instantly.": "(Chrome, Edge, Firefox, Android, dan aplikasi layar utama iPhone di iOS 16.4+). Template gratis langsung terbuka.",
    "Android:": "Android:",
    ", open it and allow installs from your browser (Android asks once). Or in Chrome tap ⋮ →": ", buka dan izinkan pemasangan dari browser (Android bertanya sekali). Atau di Chrome ketuk ⋮ →",
    "iPhone / iPad:": "iPhone / iPad:",
    "open Mint in": "buka Mint di",
    ", tap": ", ketuk",
    ". It opens full-screen with its own icon. (An App Store version needs an Apple developer account, so it isn’t there yet.)": ". Mint terbuka layar penuh dengan ikonnya sendiri. (Versi App Store perlu akun developer Apple, jadi belum tersedia.)",
    "Same Mint, same account.": "Mint yang sama, akun yang sama.",
    "The apps load the live site, so new features arrive without updating, and your drafts, library, sales and affiliate links follow you between phone and computer.":
      "Aplikasinya memuat situs live, jadi fitur baru datang tanpa update, dan draf, koleksi, penjualan, serta link afiliasimu ikut berpindah antara ponsel dan komputer.",
    "Downloads on the phone:": "Unduhan di ponsel:",
    "in the Android app,": "di aplikasi Android,",
    "opens the share sheet — save to Files or Drive, or open it straight in Excel or Google Sheets.": "membuka menu berbagi — simpan ke Files atau Drive, atau buka langsung di Excel atau Google Sheets.",
    "Badges:": "Lencana:",
    "a red number on": "angka merah di",
    "means orders to confirm or commissions to pay; on": "berarti ada pesanan untuk dikonfirmasi atau komisi untuk dibayar; di",
    "it means an order still waiting for your payment.": "berarti ada pesanan yang masih menunggu pembayaranmu."
  };

  // ---------------------------------------------------------------- whole-text patterns
  function tr(text) {
    return ID[text] || text;
  }

  var RULES = [
    [/^Buy — (.+)$/, "Beli — $1"],
    [/^Order (M-[A-Z0-9]{6})$/, "Pesanan $1"],
    [/^Order (M-[A-Z0-9]{6}) created — finish paying on the checkout; it unlocks automatically$/, "Pesanan $1 dibuat — selesaikan pembayaran di checkout; template terbuka otomatis"],
    [/^Order (M-[A-Z0-9]{6}) created — pay on the seller’s checkout and add the reference$/, "Pesanan $1 dibuat — bayar di checkout penjual dan tambahkan kode referensinya"],
    [/^New order (M-[A-Z0-9]{6}) at the coupon price$/, "Pesanan baru $1 dengan harga kupon"],
    [/^Pay (.+?) on the seller’s secure checkout\. The template unlocks automatically a few seconds after you pay\.$/, "Bayar $1 di checkout aman penjual. Template terbuka otomatis beberapa detik setelah kamu membayar."],
    [/^Pay (.+?) on the seller’s checkout\.$/, "Bayar $1 di checkout penjual."],
    [/^Pay on (.+) ↗$/, "Bayar di $1 ↗"],
    [/^Copy reference (.+)$/, "Salin kode $1"],
    [/^Earn (\d+)% promoting this$/, "Dapat $1% dengan mempromosikan ini"],
    [/^(.+) per sale you refer \(30-day attribution\)\.$/, "$1 per penjualan yang kamu bawa (atribusi 30 hari)."],
    [/^Includes (\d+) columns, (\d+) dashboard cards, (\d+) colour rules, dropdowns and 200 ready rows\. Works in Excel & Google Sheets\.$/,
      "Berisi $1 kolom, $2 kartu dashboard, $3 aturan warna, dropdown, dan 200 baris siap pakai. Bisa dipakai di Excel & Google Sheets."],
    [/^✔ (\S+): (\d+)% off — (.+) instead of (.+)$/, "✔ $1: diskon $2% — $3, bukan $4"],
    [/^✔ Coupon (.+)$/, "✔ Kupon $1"],
    [/^Coupon (\S+) created$/, "Kupon $1 dibuat"],
    [/^Replace your unpaid order with one at (.+)\? Only do this if you haven’t paid yet\.$/, "Ganti pesanan yang belum dibayar dengan harga $1? Lakukan hanya jika kamu belum membayar."],
    [/^Sales \((\w+)\)$/, "Penjualan ($1)"],
    [/^Earned \((\w+)\)$/, "Pendapatan ($1)"],
    [/^Platform fee \((.+)\)$/, "Biaya platform ($1)"],
    [/^Price \((\w+)\)$/, "Harga ($1)"],
    [/^Welcome, (.+)$/, "Selamat datang, $1"],
    [/^(\d+) AI generations left today\.$/, "Sisa $1 pembuatan AI hari ini."],
    [/^Publish “(.+)”$/, "Terbitkan “$1”"],
    [/^Opened draft “(.+)”\.?$/, "Draf “$1” dibuka."],
    [/^Started from the “(.+)” blueprint\.$/, "Dimulai dari cetak biru “$1”."],
    [/^Added formula column “(.+)” — edit its formula below\.$/, "Kolom rumus “$1” ditambahkan — edit rumusnya di bawah."],
    // Studio replies (core.js)
    [/^Added column “(.+)” \((\w+)\)\.$/, "Kolom “$1” ($2) ditambahkan."],
    [/^Added a “(.+)” column\.$/, "Kolom “$1” ditambahkan."],
    [/^Added (\d+) rows\.$/, "$1 baris ditambahkan."],
    [/^Removed “(.+)”\.$/, "“$1” dihapus."],
    [/^Renamed the template to “(.+)”\.$/, "Template diganti nama menjadi “$1”."],
    [/^Renamed “(.+)” to “(.+)”\.$/, "“$1” diganti nama menjadi “$2”."],
    [/^Currency changed to (.+)\.$/, "Mata uang diganti ke $1."],
    [/^Theme set to (.+)\.$/, "Tema diatur ke $1."],
    [/^Added a (\w+) card for “(.+)”\.$/, "Kartu $1 untuk “$2” ditambahkan."],
    [/^Highlight rule added on “(.+)”\.$/, "Aturan sorotan ditambahkan pada “$1”."],
    [/^Didn’t understand “(.+)”\. Try: (.+)$/, "Tidak paham “$1”. Coba: $2"],
    [/^(.+) connected — orders now unlock automatically$/, "$1 terhubung — pesanan kini terbuka otomatis"]
  ];

  // ---------------------------------------------------------------- in-text substitutions
  var CATEGORY_ID = {
    Finance: "Keuangan",
    Business: "Bisnis",
    Productivity: "Produktivitas",
    Lifestyle: "Gaya hidup",
    Creator: "Kreator",
    Health: "Kesehatan",
    Education: "Pendidikan",
    Events: "Acara",
    Other: "Lainnya"
  };

  var INLINE = [
    [/\b(\d+) sold\b/g, "$1 terjual"],
    [/\b(\d+) views\b/g, "$1 tampilan"],
    [/([\d.]+)% conversion\b/g, "konversi $1%"],
    [/\b(\d+)% off\b/g, "diskon $1%"],
    [/\b(\d+) columns\b/g, "$1 kolom"],
    [/\b(\d+) clicks\b/g, "$1 klik"],
    [/ · edited /g, " · diedit "],
    [/ · affiliate (\d+)%/g, " · afiliasi $1%"],
    [/ · net /g, " · bersih "],
    [/ · via affiliate\b/g, " · lewat afiliasi"],
    [/ · coupon /g, " · kupon "],
    [/ · used (\d+)/g, " · dipakai $1"],
    [/\((\d+) paid\)/g, "($1 lunas)"],
    [/ · until /g, " · sampai "],
    [/ · ended /g, " · berakhir "],
    [/ · pay to: /g, " · bayar ke: "],
    [/ · earned /g, " · didapat "],
    [/ · paid out /g, " · dibayarkan "],
    [/\bawaiting payment\)/g, "menunggu pembayaran)"],
    [/^All your templates/, "Semua templatemu"],
    [/\bConnected to Mint · platform fee\b/g, "Terhubung ke Mint · biaya platform"],
    [/ · Mint AI on\b/g, " · Mint AI aktif"],
    [/\(sandbox keys start with ([^)]+)\)/g, "(kunci sandbox diawali $1)"],
    [/secret key with Money-in write permission/g, "secret key dengan izin tulis Money-in"],
    [/(^|· )(Finance|Business|Productivity|Lifestyle|Creator|Health|Education|Events|Other)\b(?= ·|$)/g, function (all, lead, cat) {
      return lead + CATEGORY_ID[cat];
    }]
  ];

  var FRAGMENTS = Object.keys(ID).filter(function (k) {
    return k.indexOf(" ") !== -1 && k.length >= 12;
  }).sort(function (a, b) {
    return b.length - a.length;
  });

  // ---------------------------------------------------------------- state
  function detect() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved) {
        return saved === "id" ? "id" : "en";
      }
    } catch (err) {
      /* storage blocked */
    }
    var nav = (root.navigator && (root.navigator.language || "")) || "";
    return /^(id|ms)\b/i.test(nav) ? "id" : "en";
  }

  var current = detect();

  function translate(text) {
    if (current === "en" || !text) {
      return text;
    }
    var lead = text.match(/^\s*/)[0];
    var trail = text.match(/\s*$/)[0];
    var core = text.trim().replace(/\s+/g, " ");
    if (!core || !/[A-Za-z]/.test(core)) {
      return text;
    }
    if (ID[core]) {
      return lead + ID[core] + trail;
    }
    for (var i = 0; i < RULES.length; i += 1) {
      if (RULES[i][0].test(core)) {
        return lead + core.replace(RULES[i][0], RULES[i][1]) + trail;
      }
    }
    var out = core;
    for (var f = 0; f < FRAGMENTS.length; f += 1) {
      if (out.indexOf(FRAGMENTS[f]) !== -1) {
        out = out.split(FRAGMENTS[f]).join(ID[FRAGMENTS[f]]);
      }
    }
    for (var j = 0; j < INLINE.length; j += 1) {
      out = out.replace(INLINE[j][0], INLINE[j][1]);
    }
    return lead + out + trail;
  }

  // ---------------------------------------------------------------- DOM
  var ATTRS = ["placeholder", "title", "aria-label"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };

  function skipped(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentNode) {
      if (SKIP_TAGS[node.tagName] || node.getAttribute("translate") === "no" || node.isContentEditable) {
        return true;
      }
    }
    return false;
  }

  function doText(node) {
    var parent = node.parentNode;
    if (!parent || parent.nodeType !== 1 || skipped(parent)) {
      return;
    }
    if (node.__mintSet === undefined || node.nodeValue !== node.__mintSet) {
      node.__mintOrig = node.nodeValue;
    }
    var next = translate(node.__mintOrig);
    // <option>Finance</option> submits its text as the value; pin the English value before translating.
    if (next !== node.__mintOrig && parent.tagName === "OPTION" && !parent.hasAttribute("value")) {
      parent.setAttribute("value", node.__mintOrig.replace(/\s+/g, " ").trim());
    }
    if (node.nodeValue !== next) {
      node.nodeValue = next;
    }
    node.__mintSet = next;
  }

  function doAttrs(el) {
    // A textarea's typed content is never touched, but its placeholder/title still translate.
    var parentEl = el.parentNode;
    if (el.getAttribute("translate") === "no" || (parentEl && parentEl.nodeType === 1 && skipped(parentEl))) {
      return;
    }
    el.__mintAttrs = el.__mintAttrs || {};
    for (var i = 0; i < ATTRS.length; i += 1) {
      var name = ATTRS[i];
      var value = el.getAttribute(name);
      if (value === null) {
        continue;
      }
      var known = el.__mintAttrs[name];
      if (!known || (value !== known.set)) {
        known = { orig: value };
      }
      known.set = translate(known.orig);
      el.__mintAttrs[name] = known;
      if (value !== known.set) {
        el.setAttribute(name, known.set);
      }
    }
  }

  function walk(rootNode) {
    if (!rootNode) {
      return;
    }
    if (rootNode.nodeType === 3) {
      doText(rootNode);
      return;
    }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) {
      return;
    }
    if (rootNode.nodeType === 1) {
      doAttrs(rootNode);
      if (skipped(rootNode)) {
        return;
      }
    }
    var walker = document.createTreeWalker(rootNode, 5 /* elements + text */, null);
    var node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) {
        doText(node);
      } else if (node.hasAttribute && (node.hasAttribute("placeholder") || node.hasAttribute("title") || node.hasAttribute("aria-label"))) {
        doAttrs(node);
      }
      node = walker.nextNode();
    }
  }

  var observer = null;

  function observe() {
    if (observer || !root.MutationObserver) {
      return;
    }
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        var m = mutations[i];
        if (m.type === "characterData") {
          if (m.target.nodeValue !== m.target.__mintSet) {
            doText(m.target);
          }
        } else if (m.type === "attributes") {
          var known = m.target.__mintAttrs && m.target.__mintAttrs[m.attributeName];
          if (!known || m.target.getAttribute(m.attributeName) !== known.set) {
            doAttrs(m.target);
          }
        } else {
          for (var k = 0; k < m.addedNodes.length; k += 1) {
            walk(m.addedNodes[k]);
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  // ---------------------------------------------------------------- dialogs
  ["alert", "confirm", "prompt"].forEach(function (name) {
    var native = root[name];
    if (typeof native !== "function") {
      return;
    }
    root[name] = function (message) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = translate(String(message === undefined ? "" : message));
      return native.apply(root, args);
    };
  });

  // ---------------------------------------------------------------- switcher
  function button() {
    var host = document.querySelector(".topright");
    if (!host || document.getElementById("langBtn")) {
      return;
    }
    var b = document.createElement("button");
    b.id = "langBtn";
    b.type = "button";
    b.className = "icon lang";
    b.setAttribute("translate", "no");
    host.insertBefore(b, host.firstChild.nextSibling);
    b.addEventListener("click", function () {
      setLang(current === "id" ? "en" : "id");
    });
    label();
  }

  function label() {
    var b = document.getElementById("langBtn");
    if (b) {
      b.textContent = current === "id" ? "ID" : "EN";
      var hint = current === "id" ? "Ganti bahasa ke English" : "Switch language to Bahasa Indonesia";
      b.title = hint;
      b.setAttribute("aria-label", hint);
    }
  }

  function setLang(lang) {
    if (!LANGS[lang]) {
      return;
    }
    current = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch (err) {
      /* storage blocked */
    }
    document.documentElement.lang = lang;
    walk(document.body);
    label();
    try {
      root.dispatchEvent(new CustomEvent("mint:lang", { detail: { lang: lang } }));
    } catch (err) {
      /* old browsers */
    }
  }

  function start() {
    document.documentElement.lang = current;
    button();
    walk(document.body);
    observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  root.MintI18n = {
    t: translate,
    lang: function () {
      return current;
    },
    setLang: setLang,
    languages: LANGS,
    _dict: ID
  };
})(typeof window !== "undefined" ? window : this);
