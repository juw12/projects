/* Sweep i18n — interface languages (English, 简体中文, Bahasa Indonesia).
 *
 * The core app renders English strings from several files, so translation works on the
 * rendered DOM: exact-match text nodes and placeholder / aria-label / title attributes are
 * swapped for their translation, and a MutationObserver keeps new UI translated.
 * User content (briefs, plans, specs, code) is never touched: it is not in the dictionary,
 * and spec previews, code blocks, inputs and textareas are skipped entirely.
 * New modules call SweepI18n.t('English text', { vars }) directly.
 */
(function () {
  'use strict';

  const LANG_KEY = 'sweep_lang_v1';
  const LANGUAGES = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'zh', label: '简体中文', short: '中文' },
    { code: 'id', label: 'Bahasa Indonesia', short: 'ID' }
  ];
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, INPUT: 1, SELECT: 0, NOSCRIPT: 1, SVG: 1 };
  const SKIP_SELECTOR = '[data-no-i18n], .md-preview, .md-raw, .md-code, .generate-code-block, #generate-code, .file-list, [contenteditable="true"], .shared-checks, .shared-facts dd, .arch';

  // ---------- dictionaries (English source → translation) ----------
  const ZH = {
    // masthead & navigation
    'From idea to checkable plan': '从想法到可验收的计划',
    'Jump to…': '跳转到…',
    'Workspace': '工作区',
    'Catalog': '项目库',
    'New Brief': '新建简报',
    'Operator': '运营助手',
    'Guide': '指南',
    'Plan': '计划',
    'Studio': '工作室',
    'Verify': '验证',
    'Generate': '生成',
    'Guest': '访客',
    'Sign out': '退出',
    'Settings': '设置',
    // gate
    'Offline · Encrypted · No AI calls': '离线 · 加密 · 默认不调用 AI',
    'Turn a rough idea into a plan you can': '把粗略的想法变成你可以',
    'check off': '逐项打勾的计划',
    'Step 1': '第 1 步',
    'Step 2': '第 2 步',
    'Step 3': '第 3 步',
    'Idea': '想法',
    'Smoke gate': '冒烟测试关',
    'Mobile layout': '移动端布局',
    'Ship it': '发布上线',
    'Capability matrix & Definition of Done': '能力矩阵与完成标准',
    'Spec Score grades your brief A–D with fixes': '规格评分为简报打 A–D 分并给出修改建议',
    'Kiro-style requirements, design & task board': 'Kiro 风格的需求、设计与任务看板',
    'One-click handoff to Lovable, v0, Cursor, Claude Code': '一键交给 Lovable、v0、Cursor、Claude Code',
    'Welcome to Sweep': '欢迎使用 Sweep',
    'Turn rough app ideas into checkable plans. Local-first, offline, encrypted.': '把粗略的应用想法变成可验收的计划。本地优先、离线、加密。',
    'Unlock Workspace': '解锁工作区',
    'Create New': '新建',
    'Workspace name': '工作区名称',
    'Passphrase': '密码短语',
    'Unlock': '解锁',
    'Confirm passphrase': '确认密码短语',
    'Create Workspace': '创建工作区',
    'Data is encrypted at rest in your browser using WebCrypto. No server. No network.': '数据通过 WebCrypto 加密保存在你的浏览器中。无服务器，无网络。',
    'or': '或',
    'Continue as guest →': '以访客身份继续 →',
    'Try it without a passphrase — stored unencrypted in this browser.': '无需密码直接试用——数据以未加密方式保存在此浏览器。',
    // catalog
    'Project Catalog': '项目库',
    "Your workspace's projects": '你的工作区项目',
    'Demo': '演示',
    'Demo project': '演示项目',
    'Example': '示例',
    'No projects yet': '还没有项目',
    'Create your first project brief to get started.': '创建你的第一个项目简报即可开始。',
    'New Project': '新建项目',
    'New project': '新建项目',
    'Describe your first idea in plain words — Sweep drafts the brief offline': '用大白话描述你的第一个想法——Sweep 会离线起草简报',
    'Projects': '项目',
    'Verified': '已验证',
    'Avg. progress': '平均进度',
    'All': '全部',
    'Draft': '草稿',
    'Spec complete': '规格已完成',
    '● Spec complete': '● 规格已完成',
    'Newest': '最新',
    'Oldest': '最早',
    'Name A–Z': '名称 A–Z',
    'Most progress': '进度最多',
    'Import': '导入',
    'Clear filters': '清除筛选',
    'Search projects': '搜索项目',
    'Filter by status': '按状态筛选',
    'Sort projects': '项目排序',
    'Import a project JSON exported from Sweep': '导入从 Sweep 导出的项目 JSON',
    'Templates': '模板',
    'Start from a proven brief': '从经过验证的简报开始',
    'Each one scores A on Spec Score. Remix it, then make it yours.': '每个模板的规格评分都是 A。先复刻，再改成你自己的。',
    'Remix': '复刻',
    'Habits': '习惯',
    'Business': '商务',
    'Launch': '发布',
    'Home': '家庭',
    'Learning': '学习',
    'Money': '财务',
    // brief
    'Idea Brief': '想法简报',
    'Describe your app idea': '描述你的应用想法',
    'Brief readiness': '简报完整度',
    'Still needed:': '还缺：',
    'App name': '应用名称',
    'App Name': '应用名称',
    'One-liner': '一句话介绍',
    'Problem': '问题',
    'Target user': '目标用户',
    'Job-to-be-done': '待完成任务',
    'Non-goals': '非目标',
    'At least 2 success checks': '至少 2 条成功标准',
    'Guided Intake': '引导式输入',
    'Type it in plain words. Sweep drafts the brief locally — no AI, no network.': '用大白话输入。Sweep 在本地起草简报——无需 AI，无需网络。',
    'Describe your idea': '描述你的想法',
    'Tip: press Ctrl/⌘ + Enter to draft.': '提示：按 Ctrl/⌘ + Enter 起草。',
    'Try:': '试试：',
    'Draft my brief': '起草我的简报',
    'Core Idea': '核心想法',
    'Success Criteria': '成功标准',
    'Define 2–4 checkable success criteria. These become your Definition of Done.': '定义 2–4 条可验收的成功标准，它们会成为你的完成标准。',
    'Add success check': '添加成功标准',
    'Boundaries': '边界',
    'Non-goals (what this is NOT)': '非目标（它不是什么）',
    'Overlap note (any similar apps in workspace?)': '重叠说明（工作区里有类似的应用吗？）',
    'Cancel': '取消',
    'Generate Plan': '生成计划',
    'Back to catalog': '返回项目库',
    'Remove': '删除',
    'What is it in one sentence?': '一句话说明它是什么？',
    'What problem does this solve?': '它解决什么问题？',
    'Who is this for?': '它是给谁用的？',
    'When I want to X, so I can Y': '当我想做 X 时，以便我能 Y',
    // plan
    'One-liner goes here': '一句话介绍写在这里',
    'Build → Grow → Earn': '构建 → 增长 → 变现',
    'Capability Matrix': '能力矩阵',
    'Definition of Done': '完成标准',
    'Development Phases': '开发阶段',
    'Specification': '规格说明',
    'Brief, capability matrix, Definition of Done': '简报、能力矩阵、完成标准',
    'Scaffold + Design System': '脚手架 + 设计系统',
    'File tree, tokens, components, responsive layout': '文件树、设计令牌、组件、响应式布局',
    'Verification': '验证',
    'Smoke tests, visual checks, acceptance criteria': '冒烟测试、视觉检查、验收标准',
    'Memory + Deploy': '记录 + 部署',
    'Obsidian note, GitHub Pages deploy, catalog entry': 'Obsidian 笔记、GitHub Pages 部署、项目库条目',
    'Build': '构建',
    'Grow': '增长',
    'Earn': '变现',
    'Scaffold Preview': '脚手架预览',
    'Export JSON': '导出 JSON',
    'Save to Catalog': '保存到项目库',
    'Edit brief': '编辑简报',
    'Next up': '下一步',
    'Ready to build': '可以开始构建',
    'Build board': '构建看板',
    'Open Studio': '打开工作室',
    'Build in Lovable ↗': '在 Lovable 中构建 ↗',
    'Backend / Persistence': '后端 / 持久化',
    'Auth / Login': '认证 / 登录',
    'Mobile': '移动端',
    'Open the spec': '打开规格',
    'Open the task board': '打开任务看板',
    'Open this plan as a prompt in Lovable': '在 Lovable 中以提示词打开此计划',
    // verify & generate
    'Verification Gates': '验证关卡',
    'Check off each gate as you complete it. All gates must pass to mark the project as verified.': '完成一个关卡就勾选一个。所有关卡通过后才能标记为已验证。',
    'Commands to run': '要运行的命令',
    'Copy': '复制',
    'Mark as Verified': '标记为已验证',
    'Visual gate': '视觉关',
    'Repo-checks gate': '仓库检查关',
    'Secret-scan gate': '密钥扫描关',
    'Generate Scaffold': '生成脚手架',
    'Files': '文件',
    'Select a file': '选择文件',
    'Download': '下载',
    'Obsidian Memory Note': 'Obsidian 记录笔记',
    'Copy Note': '复制笔记',
    'Download Bundle (JSON)': '下载打包文件 (JSON)',
    // guide
    'How to use Sweep': '如何使用 Sweep',
    'Create or unlock your workspace': '创建或解锁你的工作区',
    'Use guided intake or write a brief': '使用引导式输入或手写简报',
    'Review the Build → Grow → Earn plan': '查看构建 → 增长 → 变现计划',
    'Verify the implementation': '验证实现',
    'Generate scaffold files': '生成脚手架文件',
    'Save to catalog': '保存到项目库',
    'Use Operator (Otto) to create content': '使用运营助手 (Otto) 创作内容',
    'Core principles': '核心原则',
    'Verification-first:': '验证优先：',
    'Ownership:': '所有权：',
    'Memory + catalog:': '记录 + 项目库：',
    'Static-first:': '静态优先：',
    // operator
    'Operator — Otto': '运营助手 — Otto',
    'Your local AI operator (offline, deterministic)': '你的本地 AI 运营助手（离线、确定性）',
    'No project selected': '未选择项目',
    'Open a project or create a new brief to start using Otto.': '打开一个项目或新建简报，即可开始使用 Otto。',
    'Open demo project': '打开演示项目',
    'New brief': '新建简报',
    'Ask first': '先询问',
    'On its own': '自动执行',
    'Light touch': '轻度',
    'Steady clip': '稳定',
    'Big swing': '大动作',
    'Full send': '全力',
    'Run a pass': '运行一轮',
    'Undo': '撤销',
    'Otto is operating on': 'Otto 正在处理',
    'Switch project': '切换项目',
    'Credits': '额度',
    'Pending': '待处理',
    'Held': '已暂缓',
    'Passes': '轮次',
    'Revenue': '收入',
    'Run Settings': '运行设置',
    'Current mode': '当前模式',
    'Standard': '标准',
    'Current power': '当前力度',
    'Effective cost': '实际消耗',
    'Run history': '运行历史',
    'Publish posts': '发布帖子',
    'Reply to audience': '回复受众',
    'Send outreach': '发送拓展消息',
    'Send newsletters': '发送通讯',
    'Approval mode': '审批模式',
    'Skip': '跳过',
    'Daily': '每天',
    'Weekly': '每周',
    'Chat with Otto': '与 Otto 聊天',
    'Brand kit': '品牌套件',
    'Brand Kit': '品牌套件',
    'LinkedIn post': 'LinkedIn 帖子',
    'Email': '邮件',
    'Research': '调研',
    'Run Log': '运行日志',
    'Outbox': '发件箱',
    'Pending:': '待处理：',
    'Approved:': '已批准：',
    'View all': '查看全部',
    'Export MD': '导出 MD',
    'Type a message...': '输入消息…',
    'Send message': '发送消息',
    'Run mode': '运行模式',
    'Run power': '运行力度',
    'Operator sections': '运营助手分区',
    'Overview': '概览',
    'Create': '创作',
    'Library': '资料库',
    'Data': '数据',
    // studio
    'Back to plan': '返回计划',
    'Spec pack .zip': '规格包 .zip',
    'Share': '分享',
    'Board': '看板',
    'Spec': '规格',
    'Handoff': '交付',
    'Spec score': '规格评分',
    'Spec Score': '规格评分',
    'Clarity': '清晰度',
    'Testability': '可测试性',
    'Scope': '范围',
    'User focus': '用户聚焦',
    'No suggestions — this brief is ready to hand to a builder.': '没有建议——这份简报可以直接交给开发者。',
    'Build estimate': '构建估算',
    'tasks': '个任务',
    'Start': '开始',
    'Mark done': '标记完成',
    'Fix': '修复',
    'Hand off in one click': '一键交付',
    'Build in Lovable': '在 Lovable 中构建',
    'Open in v0': '在 v0 中打开',
    'Copy prompt · open Bolt': '复制提示词 · 打开 Bolt',
    'Spec pack for Cursor / Claude Code': '给 Cursor / Claude Code 的规格包',
    'To do': '待办',
    'Doing': '进行中',
    'Done': '已完成',
    'Next': '下一个',
    'Blocked': '受阻',
    'after': '依赖',
    'Drop tasks here': '把任务拖到这里',
    'Drag cards between columns, or use the arrows. Tasks unlock when the tasks they depend on are done.': '在列之间拖动卡片，或使用箭头。依赖的任务完成后，任务才会解锁。',
    'Can run in parallel': '可并行',
    'Depends on': '依赖于',
    'Compatible with Kiro and GitHub Spec Kit layouts (requirements → design → tasks).': '兼容 Kiro 和 GitHub Spec Kit 的结构（需求 → 设计 → 任务）。',
    'Preview': '预览',
    'Markdown': 'Markdown',
    'Spec files': '规格文件',
    'Opens Lovable with your full plan as the first prompt.': '用你的完整计划作为第一条提示词打开 Lovable。',
    'Opens a v0 chat pre-filled with a React + shadcn prompt.': '打开预填 React + shadcn 提示词的 v0 对话。',
    'Open in v0 ↗': '在 v0 中打开 ↗',
    'Copies the prompt and opens Bolt — paste and go.': '复制提示词并打开 Bolt——粘贴即可。',
    'Copy & open Bolt ↗': '复制并打开 Bolt ↗',
    'Project rule with the product, Definition of Done and non-goals.': '包含产品、完成标准和非目标的项目规则。',
    'CLAUDE.md memory file — drop it in the repo root.': 'CLAUDE.md 记忆文件——放到仓库根目录。',
    'Any agent': '任意智能体',
    'AGENTS.md for Codex, Copilot, Jules, Windsurf and others.': '适用于 Codex、Copilot、Jules、Windsurf 等的 AGENTS.md。',
    'Builder prompt': '构建提示词',
    'Edit before you send': '发送前可编辑',
    'Reset': '重置',
    'Lovable and v0 open in a new tab with this prompt. Nothing is sent until you press send there.': 'Lovable 和 v0 会在新标签页中带着这条提示词打开。你在那里点击发送之前不会发送任何内容。',
    'Download PNG': '下载 PNG',
    'Share…': '分享…',
    'Remix link': '复刻链接',
    'Anyone with the link can open and remix this plan': '任何拿到链接的人都可以打开并复刻此计划',
    'Includes the brief only — never your progress, notes or Operator data.': '只包含简报——不会包含你的进度、笔记或运营数据。',
    'README badge': 'README 徽章',
    'Show where the plan came from': '标明计划来源',
    'Copy markdown': '复制 Markdown',
    'Share card preview': '分享卡片预览',
    'Share link': '分享链接',
    'Shared plan': '分享的计划',
    'Remix into my workspace': '复刻到我的工作区',
    'Just looking': '只是看看',
    'This is the demo — moves are not saved.': '这是演示——移动不会被保存。',
    'Copy to my projects': '复制到我的项目',
    // palette
    'Esc': 'Esc',
    'Go to': '前往',
    'Actions': '操作',
    'Toggle Night Edition (dark mode)': '切换夜间版（深色模式）',
    'Import project from JSON…': '从 JSON 导入项目…',
    'Keyboard shortcuts': '键盘快捷键',
    'Board, spec, handoff': '看板、规格、交付',
    'move': '移动',
    'run': '执行',
    'shortcuts': '快捷键',
    'Command palette': '命令面板',
    'Open command palette': '打开命令面板',
    'Command palette (Ctrl/⌘ K)': '命令面板 (Ctrl/⌘ K)',
    'Jump to a project, page or action…': '跳转到项目、页面或操作…',
    'Toggle dark mode': '切换深色模式',
    'Toggle Night Edition': '切换夜间版',
    // toasts
    'Every task is done — time to run the verification gates': '所有任务都完成了——该运行验证关卡了',
    'Spec pack downloaded': '规格包已下载',
    'Link copied': '链接已复制',
    'Copied': '已复制',
    // settings, language
    'Language': '语言',
    'Interface language': '界面语言',
    'Your briefs, plans and specs stay in the language you write them in.': '你的简报、计划和规格保持你书写时的语言。',
    'Close': '关闭',
    'Save': '保存',
    // AI
    'AI assist': 'AI 助手',
    'AI is optional. Sweep works fully offline without it.': 'AI 是可选的。没有它，Sweep 也能完全离线工作。',
    'Provider': '服务商',
    'Free (no key, shared & rate-limited)': '免费（无需密钥，共享且有速率限制）',
    'Custom (OpenAI-compatible)': '自定义（兼容 OpenAI）',
    'API key': 'API 密钥',
    'Model': '模型',
    'Base URL': '基础 URL',
    'Remember the key on this device': '在此设备上记住密钥',
    'Off: the key is kept only until you close this tab.': '关闭时：密钥只保留到你关闭此标签页。',
    'Test connection': '测试连接',
    'Testing…': '测试中…',
    'Connected': '已连接',
    'Your key is sent only to the provider you pick, straight from your browser. Sweep has no server.': '你的密钥只会从浏览器直接发送给你选择的服务商。Sweep 没有服务器。',
    'Sharpen with AI': '用 AI 优化',
    'Improve with AI': '用 AI 改进',
    'Thinking…': '思考中…',
    'AI suggestions for your brief': 'AI 对你简报的建议',
    'Review each change, then apply.': '检查每处修改，然后应用。',
    'Apply changes': '应用修改',
    'Current': '当前',
    'Suggested': '建议',
    'Brief updated with AI suggestions': '已用 AI 建议更新简报',
    'AI-edited': 'AI 已编辑',
    'Revert to generated': '恢复为自动生成',
    'Reverted to the generated version': '已恢复为自动生成的版本',
    'AI could not answer': 'AI 无法回答',
    'Set up AI in Settings first': '请先在设置中配置 AI',
    // sync
    'Sync': '同步',
    'Sync across devices': '跨设备同步',
    'Your workspace is encrypted with your sync passphrase, then saved to a private GitHub Gist you own. Use the same token and passphrase on another device to sync.': '你的工作区会用同步密码加密，然后保存到你自己的私有 GitHub Gist。在另一台设备上使用相同的令牌和密码即可同步。',
    'GitHub token': 'GitHub 令牌',
    'Create a token with only the “Gists” permission.': '创建一个只有 “Gists” 权限的令牌。',
    'Sync passphrase': '同步密码',
    'Never leaves this device. Without it the gist is unreadable.': '不会离开此设备。没有它，Gist 内容无法读取。',
    'Sync automatically': '自动同步',
    'Sync now': '立即同步',
    'Syncing…': '同步中…',
    'Never synced': '尚未同步',
    'Disconnect': '断开连接',
    'Wrong sync passphrase for this gist': '此 Gist 的同步密码不正确',
    // time tracking
    'Time': '时间',
    'Tracked': '已记录',
    'Your pace': '你的节奏',
    'estimate': '估算',
    'actual': '实际',
    'Pause timer': '暂停计时',
    'Resume timer': '继续计时',
    'Log time': '记录时间',
    'Hours spent': '已用小时',
    'Time tracking': '时间记录',
    'Timers run while a task is in Doing. Sessions longer than 6 h are capped — edit the hours if needed.': '任务处于“进行中”时计时器运行。超过 6 小时的单次计时会被截断——如有需要可编辑小时数。',
    'Task': '任务',
    'Estimate': '估算',
    'Actual': '实际',
    'Difference': '差异',
    'No tracked tasks yet. Move a task to Doing to start its timer.': '还没有记录的任务。把任务移到“进行中”即可开始计时。',
    'Clear, concrete wording': '措辞清晰具体',
    'Success checks are testable': '成功标准可测试',
    'Scope is fenced in': '范围边界明确',
    'Sharp user focus': '用户聚焦清晰',
    'Tighten the brief to raise it.': '收紧简报即可提高分数。',
    'all projects': '所有项目'
  };

  const ID = {
    'From idea to checkable plan': 'Dari ide ke rencana yang bisa dicentang',
    'Jump to…': 'Lompat ke…',
    'Workspace': 'Ruang kerja',
    'Catalog': 'Katalog',
    'New Brief': 'Brief Baru',
    'Operator': 'Operator',
    'Guide': 'Panduan',
    'Plan': 'Rencana',
    'Studio': 'Studio',
    'Verify': 'Verifikasi',
    'Generate': 'Buat',
    'Guest': 'Tamu',
    'Sign out': 'Keluar',
    'Settings': 'Pengaturan',
    'Offline · Encrypted · No AI calls': 'Offline · Terenkripsi · Tanpa AI secara bawaan',
    'Turn a rough idea into a plan you can': 'Ubah ide kasar menjadi rencana yang bisa kamu',
    'check off': 'centang satu per satu',
    'Step 1': 'Langkah 1',
    'Step 2': 'Langkah 2',
    'Step 3': 'Langkah 3',
    'Idea': 'Ide',
    'Smoke gate': 'Gerbang smoke test',
    'Mobile layout': 'Tata letak seluler',
    'Ship it': 'Rilis',
    'Capability matrix & Definition of Done': 'Matriks kemampuan & Definisi Selesai',
    'Spec Score grades your brief A–D with fixes': 'Spec Score menilai brief A–D beserta perbaikannya',
    'Kiro-style requirements, design & task board': 'Kebutuhan, desain & papan tugas gaya Kiro',
    'One-click handoff to Lovable, v0, Cursor, Claude Code': 'Serahkan sekali klik ke Lovable, v0, Cursor, Claude Code',
    'Welcome to Sweep': 'Selamat datang di Sweep',
    'Turn rough app ideas into checkable plans. Local-first, offline, encrypted.': 'Ubah ide aplikasi kasar menjadi rencana yang bisa dicek. Lokal, offline, terenkripsi.',
    'Unlock Workspace': 'Buka Ruang Kerja',
    'Create New': 'Buat Baru',
    'Workspace name': 'Nama ruang kerja',
    'Passphrase': 'Frasa sandi',
    'Unlock': 'Buka',
    'Confirm passphrase': 'Konfirmasi frasa sandi',
    'Create Workspace': 'Buat Ruang Kerja',
    'Data is encrypted at rest in your browser using WebCrypto. No server. No network.': 'Data dienkripsi di browser kamu dengan WebCrypto. Tanpa server. Tanpa jaringan.',
    'or': 'atau',
    'Continue as guest →': 'Lanjut sebagai tamu →',
    'Try it without a passphrase — stored unencrypted in this browser.': 'Coba tanpa frasa sandi — disimpan tanpa enkripsi di browser ini.',
    'Project Catalog': 'Katalog Proyek',
    "Your workspace's projects": 'Proyek di ruang kerjamu',
    'Demo': 'Demo',
    'Demo project': 'Proyek demo',
    'Example': 'Contoh',
    'No projects yet': 'Belum ada proyek',
    'Create your first project brief to get started.': 'Buat brief proyek pertamamu untuk memulai.',
    'New Project': 'Proyek Baru',
    'New project': 'Proyek baru',
    'Describe your first idea in plain words — Sweep drafts the brief offline': 'Jelaskan ide pertamamu dengan kata-kata biasa — Sweep menyusun brief secara offline',
    'Projects': 'Proyek',
    'Verified': 'Terverifikasi',
    'Avg. progress': 'Rata-rata progres',
    'All': 'Semua',
    'Draft': 'Draf',
    'Spec complete': 'Spesifikasi lengkap',
    '● Spec complete': '● Spesifikasi lengkap',
    'Newest': 'Terbaru',
    'Oldest': 'Terlama',
    'Name A–Z': 'Nama A–Z',
    'Most progress': 'Progres terbanyak',
    'Import': 'Impor',
    'Clear filters': 'Hapus filter',
    'Search projects': 'Cari proyek',
    'Filter by status': 'Filter menurut status',
    'Sort projects': 'Urutkan proyek',
    'Import a project JSON exported from Sweep': 'Impor JSON proyek yang diekspor dari Sweep',
    'Templates': 'Templat',
    'Start from a proven brief': 'Mulai dari brief yang sudah teruji',
    'Each one scores A on Spec Score. Remix it, then make it yours.': 'Semuanya bernilai A di Spec Score. Remix, lalu sesuaikan.',
    'Remix': 'Remix',
    'Habits': 'Kebiasaan',
    'Business': 'Bisnis',
    'Launch': 'Peluncuran',
    'Home': 'Rumah',
    'Learning': 'Belajar',
    'Money': 'Keuangan',
    'Idea Brief': 'Brief Ide',
    'Describe your app idea': 'Jelaskan ide aplikasimu',
    'Brief readiness': 'Kesiapan brief',
    'Still needed:': 'Masih diperlukan:',
    'App name': 'Nama aplikasi',
    'App Name': 'Nama Aplikasi',
    'One-liner': 'Ringkasan satu kalimat',
    'Problem': 'Masalah',
    'Target user': 'Pengguna sasaran',
    'Job-to-be-done': 'Pekerjaan yang ingin diselesaikan',
    'Non-goals': 'Di luar cakupan',
    'At least 2 success checks': 'Minimal 2 kriteria sukses',
    'Guided Intake': 'Masukan Terpandu',
    'Type it in plain words. Sweep drafts the brief locally — no AI, no network.': 'Ketik dengan kata-kata biasa. Sweep menyusun brief secara lokal — tanpa AI, tanpa jaringan.',
    'Describe your idea': 'Jelaskan idemu',
    'Tip: press Ctrl/⌘ + Enter to draft.': 'Tips: tekan Ctrl/⌘ + Enter untuk menyusun.',
    'Try:': 'Coba:',
    'Draft my brief': 'Susun brief saya',
    'Core Idea': 'Ide Inti',
    'Success Criteria': 'Kriteria Sukses',
    'Define 2–4 checkable success criteria. These become your Definition of Done.': 'Tentukan 2–4 kriteria sukses yang bisa dicek. Ini menjadi Definisi Selesai.',
    'Add success check': 'Tambah kriteria sukses',
    'Boundaries': 'Batasan',
    'Non-goals (what this is NOT)': 'Di luar cakupan (apa yang BUKAN)',
    'Overlap note (any similar apps in workspace?)': 'Catatan tumpang tindih (ada aplikasi serupa?)',
    'Cancel': 'Batal',
    'Generate Plan': 'Buat Rencana',
    'Back to catalog': 'Kembali ke katalog',
    'Remove': 'Hapus',
    'What is it in one sentence?': 'Apa ini dalam satu kalimat?',
    'What problem does this solve?': 'Masalah apa yang diselesaikan?',
    'Who is this for?': 'Untuk siapa ini?',
    'When I want to X, so I can Y': 'Saat saya ingin X, agar saya bisa Y',
    'One-liner goes here': 'Ringkasan satu kalimat di sini',
    'Build → Grow → Earn': 'Bangun → Kembangkan → Hasilkan',
    'Capability Matrix': 'Matriks Kemampuan',
    'Definition of Done': 'Definisi Selesai',
    'Development Phases': 'Fase Pengembangan',
    'Specification': 'Spesifikasi',
    'Brief, capability matrix, Definition of Done': 'Brief, matriks kemampuan, Definisi Selesai',
    'Scaffold + Design System': 'Kerangka + Sistem Desain',
    'File tree, tokens, components, responsive layout': 'Struktur file, token, komponen, tata letak responsif',
    'Verification': 'Verifikasi',
    'Smoke tests, visual checks, acceptance criteria': 'Smoke test, cek visual, kriteria penerimaan',
    'Memory + Deploy': 'Catatan + Deploy',
    'Obsidian note, GitHub Pages deploy, catalog entry': 'Catatan Obsidian, deploy GitHub Pages, entri katalog',
    'Build': 'Bangun',
    'Grow': 'Kembangkan',
    'Earn': 'Hasilkan',
    'Scaffold Preview': 'Pratinjau Kerangka',
    'Export JSON': 'Ekspor JSON',
    'Save to Catalog': 'Simpan ke Katalog',
    'Edit brief': 'Edit brief',
    'Next up': 'Berikutnya',
    'Ready to build': 'Siap dibangun',
    'Build board': 'Papan pembangunan',
    'Open Studio': 'Buka Studio',
    'Build in Lovable ↗': 'Bangun di Lovable ↗',
    'Backend / Persistence': 'Backend / Penyimpanan',
    'Auth / Login': 'Autentikasi / Login',
    'Mobile': 'Seluler',
    'Open the spec': 'Buka spesifikasi',
    'Open the task board': 'Buka papan tugas',
    'Open this plan as a prompt in Lovable': 'Buka rencana ini sebagai prompt di Lovable',
    'Verification Gates': 'Gerbang Verifikasi',
    'Check off each gate as you complete it. All gates must pass to mark the project as verified.': 'Centang tiap gerbang saat selesai. Semua gerbang harus lulus agar proyek terverifikasi.',
    'Commands to run': 'Perintah yang dijalankan',
    'Copy': 'Salin',
    'Mark as Verified': 'Tandai Terverifikasi',
    'Visual gate': 'Gerbang visual',
    'Repo-checks gate': 'Gerbang cek repo',
    'Secret-scan gate': 'Gerbang pindai rahasia',
    'Generate Scaffold': 'Buat Kerangka',
    'Files': 'File',
    'Select a file': 'Pilih file',
    'Download': 'Unduh',
    'Obsidian Memory Note': 'Catatan Memori Obsidian',
    'Copy Note': 'Salin Catatan',
    'Download Bundle (JSON)': 'Unduh Paket (JSON)',
    'How to use Sweep': 'Cara memakai Sweep',
    'Create or unlock your workspace': 'Buat atau buka ruang kerjamu',
    'Use guided intake or write a brief': 'Pakai masukan terpandu atau tulis brief',
    'Review the Build → Grow → Earn plan': 'Tinjau rencana Bangun → Kembangkan → Hasilkan',
    'Verify the implementation': 'Verifikasi implementasi',
    'Generate scaffold files': 'Buat file kerangka',
    'Save to catalog': 'Simpan ke katalog',
    'Use Operator (Otto) to create content': 'Pakai Operator (Otto) untuk membuat konten',
    'Core principles': 'Prinsip inti',
    'Verification-first:': 'Verifikasi dulu:',
    'Ownership:': 'Kepemilikan:',
    'Memory + catalog:': 'Catatan + katalog:',
    'Static-first:': 'Statis dulu:',
    'Operator — Otto': 'Operator — Otto',
    'Your local AI operator (offline, deterministic)': 'Operator AI lokalmu (offline, deterministik)',
    'No project selected': 'Belum ada proyek dipilih',
    'Open a project or create a new brief to start using Otto.': 'Buka proyek atau buat brief baru untuk mulai memakai Otto.',
    'Open demo project': 'Buka proyek demo',
    'New brief': 'Brief baru',
    'Ask first': 'Tanya dulu',
    'On its own': 'Otomatis',
    'Light touch': 'Ringan',
    'Steady clip': 'Stabil',
    'Big swing': 'Besar',
    'Full send': 'Maksimal',
    'Run a pass': 'Jalankan satu putaran',
    'Undo': 'Urungkan',
    'Otto is operating on': 'Otto sedang mengerjakan',
    'Switch project': 'Ganti proyek',
    'Credits': 'Kredit',
    'Pending': 'Menunggu',
    'Held': 'Ditahan',
    'Passes': 'Putaran',
    'Revenue': 'Pendapatan',
    'Run Settings': 'Pengaturan Putaran',
    'Current mode': 'Mode saat ini',
    'Standard': 'Standar',
    'Current power': 'Kekuatan saat ini',
    'Effective cost': 'Biaya efektif',
    'Run history': 'Riwayat putaran',
    'Publish posts': 'Terbitkan postingan',
    'Reply to audience': 'Balas audiens',
    'Send outreach': 'Kirim penjangkauan',
    'Send newsletters': 'Kirim buletin',
    'Approval mode': 'Mode persetujuan',
    'Skip': 'Lewati',
    'Daily': 'Harian',
    'Weekly': 'Mingguan',
    'Chat with Otto': 'Ngobrol dengan Otto',
    'Brand kit': 'Kit merek',
    'Brand Kit': 'Kit Merek',
    'LinkedIn post': 'Postingan LinkedIn',
    'Email': 'Email',
    'Research': 'Riset',
    'Run Log': 'Log Putaran',
    'Outbox': 'Kotak keluar',
    'Pending:': 'Menunggu:',
    'Approved:': 'Disetujui:',
    'View all': 'Lihat semua',
    'Export MD': 'Ekspor MD',
    'Type a message...': 'Ketik pesan…',
    'Send message': 'Kirim pesan',
    'Run mode': 'Mode putaran',
    'Run power': 'Kekuatan putaran',
    'Operator sections': 'Bagian operator',
    'Overview': 'Ringkasan',
    'Create': 'Buat',
    'Library': 'Pustaka',
    'Data': 'Data',
    'Back to plan': 'Kembali ke rencana',
    'Spec pack .zip': 'Paket spesifikasi .zip',
    'Share': 'Bagikan',
    'Board': 'Papan',
    'Spec': 'Spesifikasi',
    'Handoff': 'Serah terima',
    'Spec score': 'Spec score',
    'Spec Score': 'Spec Score',
    'Clarity': 'Kejelasan',
    'Testability': 'Bisa diuji',
    'Scope': 'Cakupan',
    'User focus': 'Fokus pengguna',
    'No suggestions — this brief is ready to hand to a builder.': 'Tidak ada saran — brief ini siap diserahkan ke pembuat.',
    'Build estimate': 'Estimasi pembangunan',
    'tasks': 'tugas',
    'Start': 'Mulai',
    'Mark done': 'Tandai selesai',
    'Fix': 'Perbaiki',
    'Hand off in one click': 'Serahkan sekali klik',
    'Build in Lovable': 'Bangun di Lovable',
    'Open in v0': 'Buka di v0',
    'Copy prompt · open Bolt': 'Salin prompt · buka Bolt',
    'Spec pack for Cursor / Claude Code': 'Paket spesifikasi untuk Cursor / Claude Code',
    'To do': 'Akan dikerjakan',
    'Doing': 'Dikerjakan',
    'Done': 'Selesai',
    'Next': 'Berikutnya',
    'Blocked': 'Terhambat',
    'after': 'setelah',
    'Drop tasks here': 'Letakkan tugas di sini',
    'Drag cards between columns, or use the arrows. Tasks unlock when the tasks they depend on are done.': 'Seret kartu antar kolom, atau pakai panah. Tugas terbuka setelah tugas yang jadi syaratnya selesai.',
    'Can run in parallel': 'Bisa paralel',
    'Depends on': 'Bergantung pada',
    'Compatible with Kiro and GitHub Spec Kit layouts (requirements → design → tasks).': 'Kompatibel dengan struktur Kiro dan GitHub Spec Kit (kebutuhan → desain → tugas).',
    'Preview': 'Pratinjau',
    'Markdown': 'Markdown',
    'Spec files': 'File spesifikasi',
    'Opens Lovable with your full plan as the first prompt.': 'Membuka Lovable dengan seluruh rencanamu sebagai prompt pertama.',
    'Opens a v0 chat pre-filled with a React + shadcn prompt.': 'Membuka chat v0 berisi prompt React + shadcn.',
    'Open in v0 ↗': 'Buka di v0 ↗',
    'Copies the prompt and opens Bolt — paste and go.': 'Menyalin prompt dan membuka Bolt — tempel dan jalan.',
    'Copy & open Bolt ↗': 'Salin & buka Bolt ↗',
    'Project rule with the product, Definition of Done and non-goals.': 'Aturan proyek berisi produk, Definisi Selesai, dan batasan.',
    'CLAUDE.md memory file — drop it in the repo root.': 'File memori CLAUDE.md — taruh di root repo.',
    'Any agent': 'Agen apa pun',
    'AGENTS.md for Codex, Copilot, Jules, Windsurf and others.': 'AGENTS.md untuk Codex, Copilot, Jules, Windsurf, dan lainnya.',
    'Builder prompt': 'Prompt pembuat',
    'Edit before you send': 'Edit sebelum dikirim',
    'Reset': 'Atur ulang',
    'Lovable and v0 open in a new tab with this prompt. Nothing is sent until you press send there.': 'Lovable dan v0 terbuka di tab baru dengan prompt ini. Tidak ada yang terkirim sebelum kamu menekan kirim di sana.',
    'Download PNG': 'Unduh PNG',
    'Share…': 'Bagikan…',
    'Remix link': 'Tautan remix',
    'Anyone with the link can open and remix this plan': 'Siapa pun yang punya tautan bisa membuka dan me-remix rencana ini',
    'Includes the brief only — never your progress, notes or Operator data.': 'Hanya berisi brief — tidak termasuk progres, catatan, atau data Operator.',
    'README badge': 'Lencana README',
    'Show where the plan came from': 'Tunjukkan asal rencana',
    'Copy markdown': 'Salin markdown',
    'Share card preview': 'Pratinjau kartu berbagi',
    'Share link': 'Tautan berbagi',
    'Shared plan': 'Rencana yang dibagikan',
    'Remix into my workspace': 'Remix ke ruang kerjaku',
    'Just looking': 'Lihat saja',
    'This is the demo — moves are not saved.': 'Ini demo — perpindahan tidak disimpan.',
    'Copy to my projects': 'Salin ke proyekku',
    'Esc': 'Esc',
    'Go to': 'Buka',
    'Actions': 'Aksi',
    'Toggle Night Edition (dark mode)': 'Ganti Edisi Malam (mode gelap)',
    'Import project from JSON…': 'Impor proyek dari JSON…',
    'Keyboard shortcuts': 'Pintasan keyboard',
    'Board, spec, handoff': 'Papan, spesifikasi, serah terima',
    'move': 'pindah',
    'run': 'jalankan',
    'shortcuts': 'pintasan',
    'Command palette': 'Palet perintah',
    'Open command palette': 'Buka palet perintah',
    'Command palette (Ctrl/⌘ K)': 'Palet perintah (Ctrl/⌘ K)',
    'Jump to a project, page or action…': 'Lompat ke proyek, halaman, atau aksi…',
    'Toggle dark mode': 'Ganti mode gelap',
    'Toggle Night Edition': 'Ganti Edisi Malam',
    'Every task is done — time to run the verification gates': 'Semua tugas selesai — saatnya menjalankan gerbang verifikasi',
    'Spec pack downloaded': 'Paket spesifikasi diunduh',
    'Link copied': 'Tautan disalin',
    'Copied': 'Disalin',
    'Language': 'Bahasa',
    'Interface language': 'Bahasa antarmuka',
    'Your briefs, plans and specs stay in the language you write them in.': 'Brief, rencana, dan spesifikasimu tetap dalam bahasa yang kamu tulis.',
    'Close': 'Tutup',
    'Save': 'Simpan',
    'AI assist': 'Bantuan AI',
    'AI is optional. Sweep works fully offline without it.': 'AI bersifat opsional. Sweep tetap berfungsi penuh secara offline tanpanya.',
    'Provider': 'Penyedia',
    'Free (no key, shared & rate-limited)': 'Gratis (tanpa kunci, bersama & dibatasi)',
    'Custom (OpenAI-compatible)': 'Kustom (kompatibel OpenAI)',
    'API key': 'Kunci API',
    'Model': 'Model',
    'Base URL': 'URL dasar',
    'Remember the key on this device': 'Ingat kunci di perangkat ini',
    'Off: the key is kept only until you close this tab.': 'Mati: kunci hanya disimpan sampai tab ini ditutup.',
    'Test connection': 'Uji koneksi',
    'Testing…': 'Menguji…',
    'Connected': 'Terhubung',
    'Your key is sent only to the provider you pick, straight from your browser. Sweep has no server.': 'Kuncimu hanya dikirim ke penyedia yang kamu pilih, langsung dari browser. Sweep tidak punya server.',
    'Sharpen with AI': 'Pertajam dengan AI',
    'Improve with AI': 'Perbaiki dengan AI',
    'Thinking…': 'Berpikir…',
    'AI suggestions for your brief': 'Saran AI untuk brief-mu',
    'Review each change, then apply.': 'Tinjau tiap perubahan, lalu terapkan.',
    'Apply changes': 'Terapkan perubahan',
    'Current': 'Saat ini',
    'Suggested': 'Saran',
    'Brief updated with AI suggestions': 'Brief diperbarui dengan saran AI',
    'AI-edited': 'Diedit AI',
    'Revert to generated': 'Kembalikan ke versi otomatis',
    'Reverted to the generated version': 'Dikembalikan ke versi otomatis',
    'AI could not answer': 'AI tidak bisa menjawab',
    'Set up AI in Settings first': 'Atur AI di Pengaturan dulu',
    'Sync': 'Sinkron',
    'Sync across devices': 'Sinkron antar perangkat',
    'Your workspace is encrypted with your sync passphrase, then saved to a private GitHub Gist you own. Use the same token and passphrase on another device to sync.': 'Ruang kerjamu dienkripsi dengan frasa sandi sinkron, lalu disimpan ke GitHub Gist pribadi milikmu. Pakai token dan frasa sandi yang sama di perangkat lain untuk sinkron.',
    'GitHub token': 'Token GitHub',
    'Create a token with only the “Gists” permission.': 'Buat token dengan izin “Gists” saja.',
    'Sync passphrase': 'Frasa sandi sinkron',
    'Never leaves this device. Without it the gist is unreadable.': 'Tidak pernah keluar dari perangkat ini. Tanpanya gist tidak bisa dibaca.',
    'Sync automatically': 'Sinkron otomatis',
    'Sync now': 'Sinkron sekarang',
    'Syncing…': 'Menyinkronkan…',
    'Never synced': 'Belum pernah sinkron',
    'Disconnect': 'Putuskan',
    'Wrong sync passphrase for this gist': 'Frasa sandi sinkron salah untuk gist ini',
    'Time': 'Waktu',
    'Tracked': 'Tercatat',
    'Your pace': 'Kecepatanmu',
    'estimate': 'estimasi',
    'actual': 'aktual',
    'Pause timer': 'Jeda timer',
    'Resume timer': 'Lanjutkan timer',
    'Log time': 'Catat waktu',
    'Hours spent': 'Jam terpakai',
    'Time tracking': 'Pencatatan waktu',
    'Timers run while a task is in Doing. Sessions longer than 6 h are capped — edit the hours if needed.': 'Timer berjalan saat tugas ada di Dikerjakan. Sesi lebih dari 6 jam dibatasi — edit jamnya bila perlu.',
    'Task': 'Tugas',
    'Estimate': 'Estimasi',
    'Actual': 'Aktual',
    'Difference': 'Selisih',
    'No tracked tasks yet. Move a task to Doing to start its timer.': 'Belum ada tugas tercatat. Pindahkan tugas ke Dikerjakan untuk memulai timer.',
    'Clear, concrete wording': 'Kata-kata jelas dan konkret',
    'Success checks are testable': 'Kriteria sukses dapat diuji',
    'Scope is fenced in': 'Cakupan dibatasi dengan jelas',
    'Sharp user focus': 'Fokus pengguna tajam',
    'Tighten the brief to raise it.': 'Perketat brief untuk menaikkannya.',
    'all projects': 'semua proyek'
  };

  // ----- round 3: sync merge review, device linking, free-AI fallback, spec translations -----
  Object.assign(ZH, {
    '(empty)': '（空）',
    'Name': '名称',
    'Job to be done': '待完成的任务',
    'Overlap': '同类产品',
    'Status': '状态',
    'Success checks': '成功标准',
    'Tasks': '任务',
    'Title': '标题',
    'Notes': '备注',
    'All free AI services are busy right now. Try again in a minute, or add your own free key (Groq or OpenRouter) in Settings → AI.': '所有免费 AI 服务现在都很忙。请一分钟后再试，或在“设置 → AI 助手”中添加你自己的免费密钥（Groq 或 OpenRouter）。',
    'Both devices changed these fields. Everything else was merged automatically. The newer edit is selected — pick the version to keep.': '两台设备都改动了下面这些字段，其余内容已自动合并。已默认选中较新的修改——请选择要保留的版本。',
    'Copy link': '复制链接',
    'Could not reach the AI service. Check your connection.': '无法连接 AI 服务，请检查网络。',
    'Create a token — the link pre-fills everything (only the “Gists” permission). Click “Generate token” on GitHub and copy it.': '创建令牌——链接已自动填好所有选项（只有“Gists”权限）。在 GitHub 上点击“Generate token”并复制。',
    'Creating a secure link…': '正在创建安全链接…',
    'Enter the one-time code shown on your other device to turn on sync here.': '输入另一台设备上显示的一次性验证码，即可在这台设备上开启同步。',
    'Expires in 15 minutes. Never send the link and the code in the same message.': '15 分钟后失效。切勿把链接和验证码放在同一条消息里发送。',
    'Keep selected versions': '保留所选版本',
    'Kept the newer versions': '已保留较新的版本',
    'Kept your picks — syncing them now': '已按你的选择保留，正在同步',
    'Last synced {when}': '上次同步：{when}',
    'Link another device': '关联其他设备',
    'Link device': '关联设备',
    'Link this device': '关联这台设备',
    'Linking…': '正在关联…',
    'Main free AI was busy — answered by {name} instead': '主免费 AI 正忙，已改由 {name} 回答',
    'Merged edits to “{name}” from two devices': '已合并两台设备对“{name}”的修改',
    'On a computer: open the link instead.': '在电脑上：直接打开链接。',
    'On your other devices, use “Link another device” — no typing needed.': '在其他设备上，使用“关联其他设备”即可，无需手动输入。',
    'On your phone: scan this code.': '在手机上：扫描此二维码。',
    'One-time code': '一次性验证码',
    'Other device': '另一台设备',
    'Paste it below, press “Generate” for a strong passphrase, then “Sync now”.': '把令牌粘贴到下方，点“生成”得到一个高强度口令，然后点“立即同步”。',
    'Project': '项目',
    'QR code to link another device': '用于关联其他设备的二维码',
    'Review': '查看',
    'Review sync clashes': '查看同步冲突',
    'Spec language': '规格文档语言',
    'Spotted an awkward translation?': '发现翻译不通顺？',
    'Strong passphrase created — it is saved on this device.': '已生成高强度口令，并保存在这台设备上。',
    'Suggest a better wording': '提出更好的译法',
    'Sync merged edits from two devices — {count} change(s) clashed and need a quick look.': '同步已合并两台设备的修改——有 {count} 处冲突需要你看一下。',
    'That code does not match. Check the code on the other device.': '验证码不匹配，请核对另一台设备上的验证码。',
    'The brief changed since this translation — translate again to update it.': '简报在翻译之后有改动——请重新翻译以更新。',
    'The model returned an empty answer.': '模型返回了空回答。',
    'Then type this one-time code:': '然后输入这个一次性验证码：',
    'This device': '这台设备',
    'This device is linked — syncing now': '这台设备已关联，正在同步',
    'This file is not translated to {lang} yet. Showing the English original.': '此文件尚未翻译成{lang}，当前显示英文原文。',
    'This link has expired. Create a new one on the other device.': '此链接已过期，请在另一台设备上重新创建。',
    'This link is damaged. Create a new one on the other device.': '此链接已损坏，请在另一台设备上重新创建。',
    'Translate all {count} files': '翻译全部 {count} 个文件',
    'Translate this file': '翻译此文件',
    'Translated to {lang} for reading. Give AI builders the English original for the most reliable results.': '已翻译成{lang}，方便阅读。交给 AI 构建工具时请使用英文原文，效果最可靠。',
    'Translated {count} file(s)': '已翻译 {count} 个文件',
    'Translating {done}/{total}…': '正在翻译 {done}/{total}…',
    'create (pre-filled)': '创建（已预填）'
  });
  Object.assign(ID, {
    '(empty)': '(kosong)',
    'Name': 'Nama',
    'Job to be done': 'Pekerjaan yang ingin diselesaikan',
    'Overlap': 'Produk serupa',
    'Status': 'Status',
    'Success checks': 'Kriteria sukses',
    'Tasks': 'Tugas',
    'Title': 'Judul',
    'Notes': 'Catatan',
    'All free AI services are busy right now. Try again in a minute, or add your own free key (Groq or OpenRouter) in Settings → AI.': 'Semua layanan AI gratis sedang sibuk. Coba lagi sebentar lagi, atau tambahkan kunci gratis Anda sendiri (Groq atau OpenRouter) di Pengaturan → AI.',
    'Both devices changed these fields. Everything else was merged automatically. The newer edit is selected — pick the version to keep.': 'Kedua perangkat mengubah kolom ini. Sisanya sudah digabung otomatis. Perubahan terbaru sudah dipilih — pilih versi yang ingin disimpan.',
    'Copy link': 'Salin tautan',
    'Could not reach the AI service. Check your connection.': 'Tidak dapat menghubungi layanan AI. Periksa koneksi Anda.',
    'Create a token — the link pre-fills everything (only the “Gists” permission). Click “Generate token” on GitHub and copy it.': 'Buat token — tautan ini sudah mengisi semuanya (hanya izin “Gists”). Klik “Generate token” di GitHub lalu salin.',
    'Creating a secure link…': 'Membuat tautan aman…',
    'Enter the one-time code shown on your other device to turn on sync here.': 'Masukkan kode sekali pakai yang tampil di perangkat Anda yang lain untuk menyalakan sinkronisasi di sini.',
    'Expires in 15 minutes. Never send the link and the code in the same message.': 'Kedaluwarsa dalam 15 menit. Jangan kirim tautan dan kode dalam pesan yang sama.',
    'Keep selected versions': 'Simpan versi yang dipilih',
    'Kept the newer versions': 'Versi terbaru disimpan',
    'Kept your picks — syncing them now': 'Pilihan Anda disimpan — sedang disinkronkan',
    'Last synced {when}': 'Terakhir disinkronkan {when}',
    'Link another device': 'Tautkan perangkat lain',
    'Link device': 'Tautkan perangkat',
    'Link this device': 'Tautkan perangkat ini',
    'Linking…': 'Menautkan…',
    'Main free AI was busy — answered by {name} instead': 'AI gratis utama sedang sibuk — dijawab oleh {name}',
    'Merged edits to “{name}” from two devices': 'Perubahan pada “{name}” dari dua perangkat sudah digabung',
    'Model': 'Model',
    'On a computer: open the link instead.': 'Di komputer: buka tautannya saja.',
    'On your other devices, use “Link another device” — no typing needed.': 'Di perangkat lain, gunakan “Tautkan perangkat lain” — tanpa perlu mengetik.',
    'On your phone: scan this code.': 'Di ponsel: pindai kode ini.',
    'One-time code': 'Kode sekali pakai',
    'Other device': 'Perangkat lain',
    'Paste it below, press “Generate” for a strong passphrase, then “Sync now”.': 'Tempel di bawah, tekan “Buat” untuk frasa sandi yang kuat, lalu “Sinkron sekarang”.',
    'Project': 'Proyek',
    'QR code to link another device': 'Kode QR untuk menautkan perangkat lain',
    'Review': 'Tinjau',
    'Review sync clashes': 'Tinjau bentrokan sinkronisasi',
    'Spec Score': 'Skor Spesifikasi',
    'Spec language': 'Bahasa spesifikasi',
    'Spotted an awkward translation?': 'Menemukan terjemahan yang janggal?',
    'Strong passphrase created — it is saved on this device.': 'Frasa sandi kuat sudah dibuat — tersimpan di perangkat ini.',
    'Suggest a better wording': 'Usulkan kata yang lebih baik',
    'Sync merged edits from two devices — {count} change(s) clashed and need a quick look.': 'Sinkronisasi menggabungkan perubahan dari dua perangkat — {count} perubahan bentrok dan perlu dicek sebentar.',
    'That code does not match. Check the code on the other device.': 'Kode tidak cocok. Periksa kode di perangkat lain.',
    'The brief changed since this translation — translate again to update it.': 'Brief berubah sejak diterjemahkan — terjemahkan lagi untuk memperbaruinya.',
    'The model returned an empty answer.': 'Model mengembalikan jawaban kosong.',
    'Then type this one-time code:': 'Lalu ketik kode sekali pakai ini:',
    'This device': 'Perangkat ini',
    'This device is linked — syncing now': 'Perangkat ini sudah tertaut — sedang menyinkronkan',
    'This file is not translated to {lang} yet. Showing the English original.': 'File ini belum diterjemahkan ke {lang}. Menampilkan versi asli bahasa Inggris.',
    'This link has expired. Create a new one on the other device.': 'Tautan ini sudah kedaluwarsa. Buat yang baru di perangkat lain.',
    'This link is damaged. Create a new one on the other device.': 'Tautan ini rusak. Buat yang baru di perangkat lain.',
    'Translate all {count} files': 'Terjemahkan semua {count} file',
    'Translate this file': 'Terjemahkan file ini',
    'Translated to {lang} for reading. Give AI builders the English original for the most reliable results.': 'Diterjemahkan ke {lang} untuk dibaca. Berikan versi asli bahasa Inggris ke AI builder agar hasilnya paling andal.',
    'Translated {count} file(s)': '{count} file diterjemahkan',
    'Translating {done}/{total}…': 'Menerjemahkan {done}/{total}…',
    'create (pre-filled)': 'buat (sudah terisi)'
  });

  // ----- round 4: no-account sync, translation editor + glossary -----
  Object.assign(ZH, {
    'Could not start direct sync on this browser.': '此浏览器无法启动直连同步。',
    'Show bigger QR': '放大二维码',
    'Show smaller QR': '缩小二维码',
    'That file is not a Sweep sync file.': '这不是 Sweep 同步文件。',
    'Could not reach the direct sync service. Check your connection.': '无法连接直连同步服务，请检查网络。',
    'Direct sync stopped after 10 minutes. Start again when both devices are ready.': '直连同步已在 10 分钟后停止。两台设备都准备好后再重新开始。',
    'Other device connected — merging…': '另一台设备已连接，正在合并…',
    'Synced with your other device · {count} project(s)': '已与另一台设备同步 · {count} 个项目',
    'Synced with your other device': '已与另一台设备同步',
    'The other device did not answer. Keep its Sync screen open and try again.': '另一台设备没有响应。请保持它的同步界面打开后重试。',
    'The other device is no longer waiting. Start direct sync there again.': '另一台设备已不再等待。请在那台设备上重新开始直连同步。',
    'Could not connect to the other device.': '无法连接到另一台设备。',
    'Starting direct sync…': '正在启动直连同步…',
    'QR code to sync another device directly': '用于直连同步另一台设备的二维码',
    'Scan this with your other device': '用另一台设备扫描此码',
    '(or open the link there). Keep this screen open until it says synced.': '（或在那台设备上打开链接）。请保持此界面打开，直到显示已同步。',
    'Stop': '停止',
    'Waiting for your other device…': '正在等待另一台设备…',
    'Works while both devices are online. Your projects travel encrypted, device to device.': '两台设备都在线时可用。项目在设备之间加密传输。',
    'Sync with your other device?': '要与另一台设备同步吗？',
    'Your projects on both devices will be merged. Nothing is deleted unless you deleted it on one of them.': '两台设备上的项目会被合并。除非你在其中一台上删除过，否则不会删除任何内容。',
    'Connecting…': '正在连接…',
    'Use a file passphrase of at least 6 characters.': '文件口令至少需要 6 个字符。',
    'Choose a sync file first.': '请先选择同步文件。',
    'Enter the passphrase the file was saved with.': '请输入保存该文件时使用的口令。',
    'Wrong passphrase for this file.': '此文件的口令不正确。',
    'No GitHub account?': '没有 GitHub 账号？',
    'Sync two devices directly while both are open, or move an encrypted sync file (AirDrop, USB, email, a cloud drive). Same encryption and merge as above.': '在两台设备都打开时直接同步，或者传送加密的同步文件（AirDrop、U 盘、邮件、网盘均可）。加密和合并方式与上面相同。',
    'Sync with another device now': '立即与另一台设备同步',
    'Sync file passphrase': '同步文件口令',
    'Download sync file': '下载同步文件',
    'Open sync file': '打开同步文件',
    'Saved {file} — open it on your other device with the same passphrase.': '已保存 {file}——在另一台设备上用相同口令打开即可。',
    'Merging…': '正在合并…',
    'Merged the sync file · {count} project(s)': '已合并同步文件 · {count} 个项目',
    'Edit translation': '编辑译文',
    'Glossary': '术语表',
    'Edited by you': '已由你修改',
    'Check this translation — {count} possible issue(s)': '请检查此译文——可能有 {count} 处问题',
    'Your terms for {lang} (one per line: term = translation)': '你的{lang}术语（每行一个：原词 = 译法）',
    'Save terms': '保存术语',
    'Used for every translation in this project. Re-translate to apply.': '用于此项目的所有翻译。重新翻译后生效。',
    'Save translation': '保存译文',
    'Translation saved': '译文已保存',
    'Terms saved': '术语已保存'
  });
  Object.assign(ID, {
    'Could not start direct sync on this browser.': 'Sinkronisasi langsung tidak dapat dimulai di browser ini.',
    'That file is not a Sweep sync file.': 'File itu bukan file sinkronisasi Sweep.',
    'Could not reach the direct sync service. Check your connection.': 'Tidak dapat menghubungi layanan sinkronisasi langsung. Periksa koneksi Anda.',
    'Direct sync stopped after 10 minutes. Start again when both devices are ready.': 'Sinkronisasi langsung berhenti setelah 10 menit. Mulai lagi saat kedua perangkat siap.',
    'Other device connected — merging…': 'Perangkat lain terhubung — sedang menggabungkan…',
    'Synced with your other device · {count} project(s)': 'Tersinkron dengan perangkat lain · {count} proyek',
    'Synced with your other device': 'Tersinkron dengan perangkat lain',
    'The other device did not answer. Keep its Sync screen open and try again.': 'Perangkat lain tidak menjawab. Biarkan layar Sinkronisasinya terbuka lalu coba lagi.',
    'The other device is no longer waiting. Start direct sync there again.': 'Perangkat lain sudah tidak menunggu. Mulai sinkronisasi langsung lagi di sana.',
    'Could not connect to the other device.': 'Tidak dapat terhubung ke perangkat lain.',
    'Starting direct sync…': 'Memulai sinkronisasi langsung…',
    'QR code to sync another device directly': 'Kode QR untuk menyinkronkan perangkat lain secara langsung',
    'Scan this with your other device': 'Pindai ini dengan perangkat Anda yang lain',
    '(or open the link there). Keep this screen open until it says synced.': '(atau buka tautannya di sana). Biarkan layar ini terbuka sampai tertulis tersinkron.',
    'Stop': 'Berhenti',
    'Waiting for your other device…': 'Menunggu perangkat Anda yang lain…',
    'Works while both devices are online. Your projects travel encrypted, device to device.': 'Berfungsi saat kedua perangkat online. Proyek Anda dikirim terenkripsi, langsung antarperangkat.',
    'Sync with your other device?': 'Sinkronkan dengan perangkat Anda yang lain?',
    'Your projects on both devices will be merged. Nothing is deleted unless you deleted it on one of them.': 'Proyek di kedua perangkat akan digabung. Tidak ada yang dihapus kecuali Anda menghapusnya di salah satu perangkat.',
    'Connecting…': 'Menghubungkan…',
    'Use a file passphrase of at least 6 characters.': 'Gunakan frasa sandi file minimal 6 karakter.',
    'Choose a sync file first.': 'Pilih file sinkronisasi terlebih dahulu.',
    'Enter the passphrase the file was saved with.': 'Masukkan frasa sandi yang dipakai saat file disimpan.',
    'Wrong passphrase for this file.': 'Frasa sandi untuk file ini salah.',
    'No GitHub account?': 'Tidak punya akun GitHub?',
    'Sync two devices directly while both are open, or move an encrypted sync file (AirDrop, USB, email, a cloud drive). Same encryption and merge as above.': 'Sinkronkan dua perangkat secara langsung saat keduanya terbuka, atau pindahkan file sinkronisasi terenkripsi (AirDrop, USB, email, cloud drive). Enkripsi dan penggabungannya sama seperti di atas.',
    'Sync with another device now': 'Sinkronkan dengan perangkat lain sekarang',
    'Sync file passphrase': 'Frasa sandi file sinkronisasi',
    'Download sync file': 'Unduh file sinkronisasi',
    'Open sync file': 'Buka file sinkronisasi',
    'Saved {file} — open it on your other device with the same passphrase.': '{file} disimpan — buka di perangkat lain dengan frasa sandi yang sama.',
    'Merging…': 'Menggabungkan…',
    'Merged the sync file · {count} project(s)': 'File sinkronisasi digabung · {count} proyek',
    'Edit translation': 'Edit terjemahan',
    'Glossary': 'Glosarium',
    'Edited by you': 'Diedit oleh Anda',
    'Check this translation — {count} possible issue(s)': 'Periksa terjemahan ini — {count} kemungkinan masalah',
    'Your terms for {lang} (one per line: term = translation)': 'Istilah Anda untuk {lang} (satu per baris: istilah = terjemahan)',
    'Save terms': 'Simpan istilah',
    'Used for every translation in this project. Re-translate to apply.': 'Dipakai untuk semua terjemahan di proyek ini. Terjemahkan ulang untuk menerapkan.',
    'Save translation': 'Simpan terjemahan',
    'Translation saved': 'Terjemahan disimpan',
    'Terms saved': 'Istilah disimpan'
  });

  const DICTS = { zh: ZH, id: ID };

  // Dynamic strings: [pattern, { zh: replacement, id: replacement }]. "$n" refers to capture groups.
  const PREFIX_LABELS = [
    'Plan', 'Verify', 'Generate', 'Studio', 'Edit brief', 'Duplicate', 'Export JSON',
    'Download spec pack (.zip)', 'Build in Lovable', 'Open in v0', 'Share / remix link', 'Remix template'
  ];
  const PATTERNS = [
    [/^(\d+) done · ≈ ([\d.]+) h left \(rough, single developer\)$/, { zh: '已完成 $1 · 剩余约 $2 小时（粗略，单人开发）', id: '$1 selesai · sisa ≈ $2 jam (kasar, 1 developer)' }],
    [/^(\d+)\/(\d+) tasks · ≈ ([\d.]+) h left$/, { zh: '$1/$2 个任务 · 剩余约 $3 小时', id: '$1/$2 tugas · sisa ≈ $3 jam' }],
    [/^Next: (T\d+) (.+)$/, { zh: '下一步：$1 $2', id: 'Berikutnya: $1 $2' }],
    [/^Spec score · ([A-D])$/, { zh: '规格评分 · $1', id: 'Spec score · $1' }],
    [/^Grade ([A-D])$/, { zh: '等级 $1', id: 'Nilai $1' }],
    [/^Move (T\d+) forward$/, { zh: '将 $1 向前移动', id: 'Pindahkan $1 maju' }],
    [/^Move (T\d+) back$/, { zh: '将 $1 向后移动', id: 'Pindahkan $1 mundur' }],
    [/^Complexity (\d) of 5$/, { zh: '复杂度 $1/5', id: 'Kompleksitas $1 dari 5' }],
    [/^(\d+) \/ (\d+) gates passed$/, { zh: '已通过 $1 / $2 个关卡', id: '$1 / $2 gerbang lulus' }],
    [/^(\d+) checks · (\d+) tasks$/, { zh: '$1 条标准 · $2 个任务', id: '$1 kriteria · $2 tugas' }],
    [/^(\d+) lines$/, { zh: '$1 行', id: '$1 baris' }],
    [/^([\d,]+) chars$/, { zh: '$1 字符', id: '$1 karakter' }],
    [/^(\d+) characters · works offline, no server$/, { zh: '$1 个字符 · 离线可用，无需服务器', id: '$1 karakter · bisa offline, tanpa server' }],
    [/^(\d+) credits$/, { zh: '$1 额度', id: '$1 kredit' }],
    [/^≈ ([\d.]+) h$/, { zh: '≈ $1 小时', id: '≈ $1 jam' }],
    [/^~([\d.]+) h$/, { zh: '~$1 小时', id: '~$1 jam' }],
    [/^\+(\d+) more suggestions$/, { zh: '还有 $1 条建议', id: '+$1 saran lagi' }],
    [/^Remixed “(.+)” — edit the brief to make it yours$/, { zh: '已复刻“$1”——编辑简报，把它变成你的', id: '“$1” di-remix — edit brief agar jadi milikmu' }],
    [/^Last synced (.+)$/, { zh: '上次同步：$1', id: 'Terakhir sinkron: $1' }]
  ];

  // ---------- coverage pass 2: operator, guide, verify, plan, catalog, palette ----------
  Object.assign(ZH, {
    "Describe your app in plain words. Sweep drafts the brief, builds a Build → Grow → Earn plan and the gates that prove it is done — all in your browser.": "用大白话描述你的应用。Sweep 会起草简报，生成“构建 → 增长 → 变现”计划，以及证明它已完成的验收关卡——全部在你的浏览器中完成。",
    "“a habit tracker with streaks for busy people”": "“一个帮忙碌人士保持连续打卡的习惯追踪器”",
    "e.g., my-sandbox": "例如：my-sandbox",
    "Lowercase letters, numbers, and hyphens only": "仅限小写字母、数字和连字符",
    "Choose a strong passphrase": "设置一个强密码短语",
    "Re-enter passphrase": "再次输入密码短语",
    "e.g., a habit tracker with streaks and reminders for busy people": "例如：一个带连续打卡和提醒、面向忙碌人士的习惯追踪器",
    "e.g., TaskFlow": "例如：TaskFlow",
    "e.g., Boots from file:// with 0 console errors": "例如：从 file:// 启动且控制台 0 错误",
    "e.g., No real-time collaboration, no mobile app": "例如：不做实时协作，不做移动 App",
    "e.g., Similar to desk-verdict but for planning": "例如：类似 desk-verdict，但用于规划",
    "Turn another idea into a checkable plan": "把另一个想法变成可验收的计划",
    "● Draft": "● 草稿",
    "Draft": "草稿",
    "Duplicate": "复制",
    "Delete": "删除",
    "OFF": "关",
    "ON": "开",
    "Static GitHub Pages deploy; localStorage for persistence": "静态 GitHub Pages 部署；用 localStorage 持久化",
    "No user accounts mentioned; local workspace only": "未提到用户账号；仅本地工作区",
    "Responsive layout for desktop + mobile": "适配桌面端 + 移动端的响应式布局",
    "Focus on depth over breadth": "重深度，不求广度",
    "Lead with the problem you solve": "开头先讲你解决的问题",
    "List 10 target people to reach out to": "列出 10 位要联系的目标用户",
    "Friends, colleagues, or community members": "朋友、同事或社区成员",
    "Draft your first outreach message": "起草第一条联系消息",
    "Keep it personal and specific": "写得私人、具体",
    "Define a success signal to watch": "定义一个要观察的成功信号",
    "e.g., 5 signups, 1 paying customer": "例如：5 个注册，1 个付费用户",
    "What they get + what it costs": "他们得到什么 + 花多少钱",
    "Pick a first price hypothesis": "选一个初始价格假设",
    "Start higher than comfortable": "定价比你舒服的价位高一点",
    "Define the first paid ask/CTA": "定义第一个付费请求/行动号召",
    "Clear, direct, low-friction": "清晰、直接、低门槛",
    "Decide the payment path": "确定收款方式",
    "Stripe, PayPal, Gumroad, or manual": "Stripe、PayPal、Gumroad 或手动",
    "Set a simple sell-through check": "设定一个简单的成交检验",
    "e.g., 3/10 prospects say yes": "例如：10 个潜在客户中有 3 个同意",
    "Open": "打开",
    "from": "来源",
    "→ expect 0 console errors": "→ 预期控制台 0 错误",
    "Playwright screenshots at 1440×900 and 390×844:": "Playwright 截图（1440×900 和 390×844）：",
    "Run": "运行",
    "→ all exit 0 (when present)": "→ 全部退出码为 0（若存在）",
    "No secrets/internal endpoints committed:": "未提交任何密钥/内部端点：",
    "This static page can't execute verification. Run these commands locally, then check the gates above.": "这个静态页面无法执行验证。请在本地运行这些命令，然后勾选上面的关卡。",
    "Generated file contents based on your capability matrix. Copy or download individual files, or download the complete bundle.": "根据你的能力矩阵生成的文件内容。可复制或下载单个文件，也可下载完整打包。",
    "Sweep turns rough app ideas into checkable plans. Follow the flow: guided intake → brief → plan (Build/Grow/Earn) → verify → generate → sync.": "Sweep 把粗糙的应用想法变成可验收的计划。按这个流程走：引导输入 → 简报 → 计划（构建/增长/变现）→ 验证 → 生成 → 同步。",
    "Choose a workspace name and a strong passphrase. Your data is encrypted at rest in your browser using WebCrypto (PBKDF2 → AES-GCM). No server, no network—everything stays local.": "选择工作区名称和强密码短语。你的数据会在浏览器中用 WebCrypto（PBKDF2 → AES-GCM）加密保存。无服务器、无网络——一切留在本地。",
    "Type your idea in plain words. Sweep drafts the brief locally — no AI, no network. Or fill the brief fields manually: problem, target user, job-to-be-done, and 2–4 success checks.": "用大白话输入你的想法。Sweep 在本地起草简报——无需 AI，无需网络。也可以手动填写简报：问题、目标用户、待完成的任务，以及 2–4 条成功标准。",
    "Sweep produces a capability matrix, Definition of Done, phased roadmap (M0→M3), plus Grow (launch/reach) and Earn (offer/pricing) checklists. All generated locally from your brief.": "Sweep 会生成能力矩阵、完成定义、分阶段路线图（M0→M3），以及增长（发布/触达）和变现（报价/定价）清单。全部根据你的简报在本地生成。",
    "Complete verification gates: smoke tests, visual checks at desktop + mobile sizes, acceptance criteria from your brief, repo checks (build/test scripts), and secret scanning. Mark as verified when all gates pass.": "完成验证关卡：冒烟测试、桌面端和移动端尺寸的视觉检查、来自简报的验收标准、仓库检查（构建/测试脚本）以及密钥扫描。所有关卡通过后标记为已验证。",
    "Get ready-to-use file contents for your project: web/index.html, styles.css, app.js, optional server/server.py, tests, docs, README, .gitignore, and an Obsidian memory note. Copy or download individual files or the complete bundle.": "获取可直接使用的项目文件内容：web/index.html、styles.css、app.js、可选的 server/server.py、测试、文档、README、.gitignore 和一条 Obsidian 记忆笔记。可复制或下载单个文件或完整打包。",
    "Save the project to your workspace catalog. Export as JSON anytime. The demo project is always visible so the catalog is never empty.": "把项目保存到工作区项目库。随时导出为 JSON。演示项目始终可见，所以项目库不会是空的。",
    "Prove the app runs before saying \"done\"": "先证明应用能运行，再说“完成”",
    "You own the code, tests, docs—no lock-in": "代码、测试、文档都归你——不被绑定",
    "A longitudinal system, not one-off chat→code": "一个长期积累的系统，而不是一次性的聊天→代码",
    "GitHub Pages deployable, zero dependencies": "可部署到 GitHub Pages，零依赖",
    "Mode": "模式",
    "Power": "力度",
    "Decisions": "决策",
    "Work quality": "工作质量",
    "Permissions": "权限",
    "Ask first (pending approval)": "先询问（待批准）",
    "Steady clip (6 artifacts)": "稳步推进（6 个产出）",
    "Permissions — What Otto is allowed to do": "权限——Otto 可以做什么",
    "Toggle permissions to control what Otto can do automatically. When a channel is OFF, artifacts are marked \"held\".": "切换权限来控制 Otto 能自动做什么。渠道关闭时，产出会被标记为“搁置”。",
    "Otto will wait for your approval before creating artifacts": "Otto 会等你批准后再创建产出",
    "Decisions — Otto needs you": "决策——Otto 需要你",
    "Answer these questions to guide Otto's work. Your choices are used in subsequent generation.": "回答这些问题来指导 Otto 的工作。你的选择会用于之后的生成。",
    "Which price point?": "哪个价位？",
    "Which launch channel?": "哪个发布渠道？",
    "Posting cadence?": "发布频率？",
    "3x/week": "每周 3 次",
    "Start a conversation with Otto...": "开始和 Otto 对话…",
    "Heading:": "标题：",
    "Body:": "正文：",
    "No actions yet": "还没有操作",
    "Type: brand, post, email, outreach, research, deck, site, newsletter...": "输入：品牌、帖子、邮件、外联、调研、演示文稿、网站、简报…",
    "Create Content": "创作内容",
    "All content is generated locally and deterministically from your project brief. Use the command bar above, or pick a quick action.": "所有内容都根据你的项目简报在本地、确定性地生成。使用上方的命令栏，或选择一个快捷操作。",
    "Twitter Post": "Twitter 帖子",
    "Email Draft": "邮件草稿",
    "Outreach List": "外联名单",
    "Market Research": "市场调研",
    "Pitch Deck": "路演文稿",
    "Landing Site": "落地页",
    "Newsletter": "简报邮件",
    "Multi-page Site": "多页网站",
    "Generate a 4-page site (index, about, pricing, contact) with shared styles and navigation.": "生成一个 4 页网站（首页、关于、定价、联系），共享样式和导航。",
    "Generate Site": "生成网站",
    "No pending artifacts": "没有待处理的产出",
    "All generated artifacts. Group by content type.": "所有已生成的产出。按内容类型分组。",
    "Social": "社交",
    "Export (MD)": "导出（MD）",
    "No artifacts match your filters": "没有符合筛选条件的产出",
    "Search...": "搜索…",
    "Content Calendar": "内容日历",
    "Schedule posts locally — no network sync. Simulated for planning.": "在本地排期帖子——不进行网络同步。仅用于规划的模拟。",
    "No posts": "没有帖子",
    "+ Schedule": "+ 排期",
    "Mon": "周一",
    "Tue": "周二",
    "Wed": "周三",
    "Thu": "周四",
    "Fri": "周五",
    "Sat": "周六",
    "Sun": "周日",
    "Unified Inbox": "统一收件箱",
    "Simulated locally — no network. Replies generated from outreach.": "本地模拟——无网络。回复由外联内容生成。",
    "No messages yet. Generate outreach to receive simulated replies.": "还没有消息。生成外联内容即可收到模拟回复。",
    "Insights": "洞察",
    "Visitors": "访客",
    "Conversion": "转化率",
    "Orders": "订单",
    "Best channel:": "最佳渠道：",
    "Direct outreach": "直接外联",
    "Projection based on ledger data (local simulation — no network)": "基于账本数据的预测（本地模拟——无网络）",
    "Ledger": "账本",
    "Sales": "销售",
    "Stock": "库存",
    "Costs": "成本",
    "No entries in sales sheet.": "销售表中没有记录。",
    "Add first row": "添加第一行",
    "Payments": "收款",
    "Free": "免费",
    "/mo": "/月",
    "Basic features": "基础功能",
    "Community support": "社区支持",
    "1 project": "1 个项目",
    "All features": "全部功能",
    "Priority support": "优先支持",
    "Unlimited projects": "无限项目",
    "Analytics": "数据分析",
    "Everything in Pro": "包含 Pro 的全部内容",
    "Dedicated support": "专属支持",
    "Custom integrations": "定制集成",
    "Products": "产品",
    "Define your product offerings. Each product can have its own price point.": "定义你的产品。每个产品都可以有自己的价位。",
    "Add product": "添加产品",
    "Test Mode": "测试模式",
    "Enable test mode to use Stripe test keys and show test card hints.": "开启测试模式即可使用 Stripe 测试密钥并显示测试卡提示。",
    "Test mode OFF": "测试模式：关",
    "Test mode ON": "测试模式：开",
    "Active plan": "当前方案",
    "Price": "价格",
    "Currency": "货币",
    "Stripe snippet": "Stripe 代码片段",
    "Sweep: no fee, you own the Stripe account": "Sweep：不抽成，Stripe 账户归你所有",
    "Stripe test mode": "Stripe 测试模式",
    "Scheduled Tasks": "定时任务",
    "Local recurring tasks — runs when app is open. No network required.": "本地周期任务——应用打开时运行。无需网络。",
    "Weekly newsletter": "每周简报邮件",
    "Daily post": "每日帖子",
    "Run now": "立即运行",
    "Pause": "暂停",
    "Resume": "继续",
    "Add task": "添加任务",
    "Global Search": "全局搜索",
    "Search your outbox, chat history, and research locally.": "在本地搜索你的发件箱、聊天记录和调研。",
    "Data & Privacy": "数据与隐私",
    "Your data is stored locally in browser storage. It is never sent to any server or used for training.": "你的数据保存在浏览器本地存储中。它不会被发送到任何服务器，也不会用于训练。",
    "Export All (JSON)": "全部导出（JSON）",
    "Export Markdown": "导出 Markdown",
    "Copy Workspace JSON": "复制工作区 JSON",
    "Wipe Operator Data": "清除运营助手数据",
    "Wiping resets Otto's data (chat, outbox, ledger, inbox, schedule) to defaults. Your project brief remains unchanged.": "清除会把 Otto 的数据（聊天、发件箱、账本、收件箱、排期）重置为默认值。你的项目简报不受影响。",
    "Search artifacts, chat, research...": "搜索产出、聊天、调研…",
    "Scaffold the static app shell (web/index.html, styles.css, app.js)": "搭建静态应用骨架（web/index.html、styles.css、app.js）",
    "Design tokens and responsive layout shell": "设计令牌与响应式布局骨架",
    "Data model and localStorage persistence layer": "数据模型与 localStorage 持久化层",
    "Responsive pass at 390 px and 1440 px": "在 390 px 和 1440 px 下做响应式检查",
    "Automated checks for every acceptance criterion": "为每条验收标准写自动化检查",
    "Run verification gates (smoke, visual, repo checks, secret scan)": "运行验证关卡（冒烟、视觉、仓库检查、密钥扫描）",
    "Deploy to GitHub Pages and write the memory note": "部署到 GitHub Pages 并写记忆笔记",
    "Download sweep.mdc": "下载 sweep.mdc",
    "Download CLAUDE.md": "下载 CLAUDE.md",
    "Download AGENTS.md": "下载 AGENTS.md",
    "create ↗": "创建 ↗",
    "Command": "命令",
    "Team Task Board (demo)": "Team Task Board（演示）",
    "● Spec complete": "● 规格已完成",
    "● Building": "● 构建中",
    "Building": "构建中",
    "● Verified": "● 已验证",
    "● Shipped": "● 已发布",
    "Shipped": "已发布"
  });
  Object.assign(ID, {
    "Describe your app in plain words. Sweep drafts the brief, builds a Build → Grow → Earn plan and the gates that prove it is done — all in your browser.": "Jelaskan aplikasimu dengan kata-kata sederhana. Sweep menyusun brief, membuat rencana Bangun → Tumbuh → Hasilkan, dan gerbang yang membuktikan semuanya selesai — semuanya di browsermu.",
    "“a habit tracker with streaks for busy people”": "“pelacak kebiasaan dengan streak untuk orang sibuk”",
    "e.g., my-sandbox": "mis., my-sandbox",
    "Lowercase letters, numbers, and hyphens only": "Hanya huruf kecil, angka, dan tanda hubung",
    "Choose a strong passphrase": "Pilih frasa sandi yang kuat",
    "Re-enter passphrase": "Masukkan ulang frasa sandi",
    "e.g., a habit tracker with streaks and reminders for busy people": "mis., pelacak kebiasaan dengan streak dan pengingat untuk orang sibuk",
    "e.g., TaskFlow": "mis., TaskFlow",
    "e.g., Boots from file:// with 0 console errors": "mis., Berjalan dari file:// dengan 0 error konsol",
    "e.g., No real-time collaboration, no mobile app": "mis., Tanpa kolaborasi real-time, tanpa aplikasi seluler",
    "e.g., Similar to desk-verdict but for planning": "mis., Mirip desk-verdict tapi untuk perencanaan",
    "Turn another idea into a checkable plan": "Ubah ide lain jadi rencana yang bisa dicentang",
    "● Draft": "● Draf",
    "Draft": "Draf",
    "Duplicate": "Duplikat",
    "Delete": "Hapus",
    "OFF": "MATI",
    "ON": "NYALA",
    "Static GitHub Pages deploy; localStorage for persistence": "Deploy statis ke GitHub Pages; localStorage untuk penyimpanan",
    "No user accounts mentioned; local workspace only": "Tidak ada akun pengguna; hanya workspace lokal",
    "Responsive layout for desktop + mobile": "Tata letak responsif untuk desktop + seluler",
    "Focus on depth over breadth": "Fokus pada kedalaman, bukan keluasan",
    "Lead with the problem you solve": "Awali dengan masalah yang kamu selesaikan",
    "List 10 target people to reach out to": "Daftar 10 orang target untuk dihubungi",
    "Friends, colleagues, or community members": "Teman, rekan kerja, atau anggota komunitas",
    "Draft your first outreach message": "Tulis draf pesan penjangkauan pertamamu",
    "Keep it personal and specific": "Buat personal dan spesifik",
    "Define a success signal to watch": "Tentukan sinyal sukses yang dipantau",
    "e.g., 5 signups, 1 paying customer": "mis., 5 pendaftar, 1 pelanggan berbayar",
    "What they get + what it costs": "Apa yang mereka dapat + berapa biayanya",
    "Pick a first price hypothesis": "Pilih hipotesis harga pertama",
    "Start higher than comfortable": "Mulai lebih tinggi dari yang nyaman",
    "Define the first paid ask/CTA": "Tentukan ajakan berbayar/CTA pertama",
    "Clear, direct, low-friction": "Jelas, langsung, minim hambatan",
    "Decide the payment path": "Tentukan jalur pembayaran",
    "Stripe, PayPal, Gumroad, or manual": "Stripe, PayPal, Gumroad, atau manual",
    "Set a simple sell-through check": "Tetapkan cek penjualan sederhana",
    "e.g., 3/10 prospects say yes": "mis., 3/10 prospek bilang ya",
    "Open": "Buka",
    "from": "dari",
    "→ expect 0 console errors": "→ harapkan 0 error konsol",
    "Playwright screenshots at 1440×900 and 390×844:": "Tangkapan layar Playwright di 1440×900 dan 390×844:",
    "Run": "Jalankan",
    "→ all exit 0 (when present)": "→ semua keluar dengan 0 (jika ada)",
    "No secrets/internal endpoints committed:": "Tidak ada rahasia/endpoint internal yang di-commit:",
    "This static page can't execute verification. Run these commands locally, then check the gates above.": "Halaman statis ini tidak bisa menjalankan verifikasi. Jalankan perintah ini secara lokal, lalu centang gerbang di atas.",
    "Generated file contents based on your capability matrix. Copy or download individual files, or download the complete bundle.": "Isi file yang dibuat dari matriks kapabilitasmu. Salin atau unduh file satu per satu, atau unduh paket lengkapnya.",
    "Sweep turns rough app ideas into checkable plans. Follow the flow: guided intake → brief → plan (Build/Grow/Earn) → verify → generate → sync.": "Sweep mengubah ide aplikasi kasar menjadi rencana yang bisa dicentang. Ikuti alurnya: intake terpandu → brief → rencana (Bangun/Tumbuh/Hasilkan) → verifikasi → buat → sinkron.",
    "Choose a workspace name and a strong passphrase. Your data is encrypted at rest in your browser using WebCrypto (PBKDF2 → AES-GCM). No server, no network—everything stays local.": "Pilih nama workspace dan frasa sandi yang kuat. Datamu dienkripsi di browser dengan WebCrypto (PBKDF2 → AES-GCM). Tanpa server, tanpa jaringan — semuanya tetap lokal.",
    "Type your idea in plain words. Sweep drafts the brief locally — no AI, no network. Or fill the brief fields manually: problem, target user, job-to-be-done, and 2–4 success checks.": "Ketik idemu dengan kata-kata sederhana. Sweep menyusun brief secara lokal — tanpa AI, tanpa jaringan. Atau isi kolom brief manual: masalah, pengguna target, job-to-be-done, dan 2–4 kriteria sukses.",
    "Sweep produces a capability matrix, Definition of Done, phased roadmap (M0→M3), plus Grow (launch/reach) and Earn (offer/pricing) checklists. All generated locally from your brief.": "Sweep membuat matriks kapabilitas, Definition of Done, roadmap bertahap (M0→M3), plus daftar Tumbuh (peluncuran/jangkauan) dan Hasilkan (penawaran/harga). Semuanya dibuat lokal dari brief-mu.",
    "Complete verification gates: smoke tests, visual checks at desktop + mobile sizes, acceptance criteria from your brief, repo checks (build/test scripts), and secret scanning. Mark as verified when all gates pass.": "Selesaikan gerbang verifikasi: smoke test, cek visual di ukuran desktop + seluler, kriteria penerimaan dari brief, cek repo (skrip build/test), dan pemindaian rahasia. Tandai terverifikasi saat semua gerbang lolos.",
    "Get ready-to-use file contents for your project: web/index.html, styles.css, app.js, optional server/server.py, tests, docs, README, .gitignore, and an Obsidian memory note. Copy or download individual files or the complete bundle.": "Dapatkan isi file siap pakai untuk proyekmu: web/index.html, styles.css, app.js, server/server.py opsional, tes, dokumen, README, .gitignore, dan catatan memori Obsidian. Salin atau unduh per file atau paket lengkap.",
    "Save the project to your workspace catalog. Export as JSON anytime. The demo project is always visible so the catalog is never empty.": "Simpan proyek ke katalog workspace. Ekspor sebagai JSON kapan saja. Proyek demo selalu terlihat agar katalog tidak pernah kosong.",
    "Prove the app runs before saying \"done\"": "Buktikan aplikasi berjalan sebelum bilang \"selesai\"",
    "You own the code, tests, docs—no lock-in": "Kode, tes, dokumen milikmu — tanpa ketergantungan",
    "A longitudinal system, not one-off chat→code": "Sistem jangka panjang, bukan chat→kode sekali jalan",
    "GitHub Pages deployable, zero dependencies": "Bisa di-deploy ke GitHub Pages, tanpa dependensi",
    "Mode": "Mode",
    "Power": "Daya",
    "Decisions": "Keputusan",
    "Work quality": "Kualitas kerja",
    "Permissions": "Izin",
    "Ask first (pending approval)": "Tanya dulu (menunggu persetujuan)",
    "Steady clip (6 artifacts)": "Laju stabil (6 artefak)",
    "Permissions — What Otto is allowed to do": "Izin — Apa yang boleh dilakukan Otto",
    "Toggle permissions to control what Otto can do automatically. When a channel is OFF, artifacts are marked \"held\".": "Atur izin untuk mengontrol apa yang bisa Otto lakukan otomatis. Saat kanal MATI, artefak ditandai \"ditahan\".",
    "Otto will wait for your approval before creating artifacts": "Otto akan menunggu persetujuanmu sebelum membuat artefak",
    "Decisions — Otto needs you": "Keputusan — Otto butuh kamu",
    "Answer these questions to guide Otto's work. Your choices are used in subsequent generation.": "Jawab pertanyaan ini untuk mengarahkan kerja Otto. Pilihanmu dipakai di pembuatan berikutnya.",
    "Which price point?": "Titik harga mana?",
    "Which launch channel?": "Kanal peluncuran mana?",
    "Posting cadence?": "Frekuensi posting?",
    "3x/week": "3x/minggu",
    "Start a conversation with Otto...": "Mulai percakapan dengan Otto...",
    "Heading:": "Judul:",
    "Body:": "Isi:",
    "No actions yet": "Belum ada tindakan",
    "Type: brand, post, email, outreach, research, deck, site, newsletter...": "Ketik: brand, post, email, outreach, riset, deck, situs, newsletter...",
    "Create Content": "Buat Konten",
    "All content is generated locally and deterministically from your project brief. Use the command bar above, or pick a quick action.": "Semua konten dibuat lokal dan deterministik dari brief proyekmu. Pakai bilah perintah di atas, atau pilih aksi cepat.",
    "Twitter Post": "Post Twitter",
    "Email Draft": "Draf Email",
    "Outreach List": "Daftar Outreach",
    "Market Research": "Riset Pasar",
    "Pitch Deck": "Pitch Deck",
    "Landing Site": "Situs Landing",
    "Newsletter": "Newsletter",
    "Multi-page Site": "Situs Multi-halaman",
    "Generate a 4-page site (index, about, pricing, contact) with shared styles and navigation.": "Buat situs 4 halaman (index, about, pricing, contact) dengan gaya dan navigasi bersama.",
    "Generate Site": "Buat Situs",
    "No pending artifacts": "Tidak ada artefak tertunda",
    "All generated artifacts. Group by content type.": "Semua artefak yang dibuat. Kelompokkan per jenis konten.",
    "Social": "Sosial",
    "Export (MD)": "Ekspor (MD)",
    "No artifacts match your filters": "Tidak ada artefak yang cocok dengan filter",
    "Search...": "Cari...",
    "Content Calendar": "Kalender Konten",
    "Schedule posts locally — no network sync. Simulated for planning.": "Jadwalkan posting secara lokal — tanpa sinkron jaringan. Simulasi untuk perencanaan.",
    "No posts": "Tidak ada posting",
    "+ Schedule": "+ Jadwalkan",
    "Mon": "Sen",
    "Tue": "Sel",
    "Wed": "Rab",
    "Thu": "Kam",
    "Fri": "Jum",
    "Sat": "Sab",
    "Sun": "Min",
    "Unified Inbox": "Kotak Masuk Terpadu",
    "Simulated locally — no network. Replies generated from outreach.": "Simulasi lokal — tanpa jaringan. Balasan dibuat dari outreach.",
    "No messages yet. Generate outreach to receive simulated replies.": "Belum ada pesan. Buat outreach untuk menerima balasan simulasi.",
    "Insights": "Wawasan",
    "Visitors": "Pengunjung",
    "Conversion": "Konversi",
    "Orders": "Pesanan",
    "Best channel:": "Kanal terbaik:",
    "Direct outreach": "Outreach langsung",
    "Projection based on ledger data (local simulation — no network)": "Proyeksi berdasarkan data buku besar (simulasi lokal — tanpa jaringan)",
    "Ledger": "Buku Besar",
    "Sales": "Penjualan",
    "Stock": "Stok",
    "Costs": "Biaya",
    "No entries in sales sheet.": "Belum ada entri di lembar penjualan.",
    "Add first row": "Tambah baris pertama",
    "Payments": "Pembayaran",
    "Free": "Gratis",
    "/mo": "/bln",
    "Basic features": "Fitur dasar",
    "Community support": "Dukungan komunitas",
    "1 project": "1 proyek",
    "All features": "Semua fitur",
    "Priority support": "Dukungan prioritas",
    "Unlimited projects": "Proyek tanpa batas",
    "Analytics": "Analitik",
    "Everything in Pro": "Semua yang ada di Pro",
    "Dedicated support": "Dukungan khusus",
    "Custom integrations": "Integrasi kustom",
    "Products": "Produk",
    "Define your product offerings. Each product can have its own price point.": "Tentukan produkmu. Setiap produk bisa punya harganya sendiri.",
    "Add product": "Tambah produk",
    "Test Mode": "Mode Uji",
    "Enable test mode to use Stripe test keys and show test card hints.": "Aktifkan mode uji untuk memakai kunci uji Stripe dan menampilkan petunjuk kartu uji.",
    "Test mode OFF": "Mode uji MATI",
    "Test mode ON": "Mode uji NYALA",
    "Active plan": "Paket aktif",
    "Price": "Harga",
    "Currency": "Mata uang",
    "Stripe snippet": "Cuplikan Stripe",
    "Sweep: no fee, you own the Stripe account": "Sweep: tanpa biaya, akun Stripe milikmu",
    "Stripe test mode": "Mode uji Stripe",
    "Scheduled Tasks": "Tugas Terjadwal",
    "Local recurring tasks — runs when app is open. No network required.": "Tugas berulang lokal — berjalan saat aplikasi terbuka. Tanpa jaringan.",
    "Weekly newsletter": "Newsletter mingguan",
    "Daily post": "Posting harian",
    "Run now": "Jalankan sekarang",
    "Pause": "Jeda",
    "Resume": "Lanjutkan",
    "Add task": "Tambah tugas",
    "Global Search": "Pencarian Global",
    "Search your outbox, chat history, and research locally.": "Cari outbox, riwayat chat, dan riset secara lokal.",
    "Data & Privacy": "Data & Privasi",
    "Your data is stored locally in browser storage. It is never sent to any server or used for training.": "Datamu disimpan lokal di penyimpanan browser. Tidak pernah dikirim ke server mana pun atau dipakai untuk pelatihan.",
    "Export All (JSON)": "Ekspor Semua (JSON)",
    "Export Markdown": "Ekspor Markdown",
    "Copy Workspace JSON": "Salin JSON Workspace",
    "Wipe Operator Data": "Hapus Data Operator",
    "Wiping resets Otto's data (chat, outbox, ledger, inbox, schedule) to defaults. Your project brief remains unchanged.": "Menghapus akan mengembalikan data Otto (chat, outbox, buku besar, kotak masuk, jadwal) ke bawaan. Brief proyekmu tidak berubah.",
    "Search artifacts, chat, research...": "Cari artefak, chat, riset...",
    "Scaffold the static app shell (web/index.html, styles.css, app.js)": "Siapkan kerangka aplikasi statis (web/index.html, styles.css, app.js)",
    "Design tokens and responsive layout shell": "Design token dan kerangka tata letak responsif",
    "Data model and localStorage persistence layer": "Model data dan lapisan penyimpanan localStorage",
    "Responsive pass at 390 px and 1440 px": "Penyesuaian responsif di 390 px dan 1440 px",
    "Automated checks for every acceptance criterion": "Cek otomatis untuk setiap kriteria penerimaan",
    "Run verification gates (smoke, visual, repo checks, secret scan)": "Jalankan gerbang verifikasi (smoke, visual, cek repo, pindai rahasia)",
    "Deploy to GitHub Pages and write the memory note": "Deploy ke GitHub Pages dan tulis catatan memori",
    "Download sweep.mdc": "Unduh sweep.mdc",
    "Download CLAUDE.md": "Unduh CLAUDE.md",
    "Download AGENTS.md": "Unduh AGENTS.md",
    "create ↗": "buat ↗",
    "Command": "Perintah",
    "Team Task Board (demo)": "Team Task Board (demo)",
    "● Spec complete": "● Spesifikasi lengkap",
    "● Building": "● Sedang dibangun",
    "Building": "Sedang dibangun",
    "● Verified": "● Terverifikasi",
    "● Shipped": "● Sudah rilis",
    "Shipped": "Sudah rilis"
  });
  PATTERNS.push(
    [/^Example: (.+)$/, { zh: "示例：$1", id: "Contoh: $1" }],
    [/^· next: (.+)$/, { zh: "· 下一步：$1", id: "· berikutnya: $1" }],
    [/^Open (.+), (\d+)% complete$/, { zh: "打开 $1，已完成 $2%", id: "Buka $1, $2% selesai" }],
    [/^(\d+)% of the plan complete$/, { zh: "计划已完成 $1%", id: "$1% rencana selesai" }],
    [/^Click to mark (M\d) as done$/, { zh: "点击将 $1 标记为完成", id: "Klik untuk menandai $1 selesai" }],
    [/^Click to mark (M\d) as not done$/, { zh: "点击将 $1 标记为未完成", id: "Klik untuk menandai $1 belum selesai" }],
    [/^Acceptance #(\d+)$/, { zh: "验收 #$1", id: "Penerimaan #$1" }],
    [/^(\d+) lines · (.+)$/, { zh: "$1 行 · $2", id: "$1 baris · $2" }],
    [/^Pick 1-2 launch channels where (.+) already hang out$/, { zh: "选择 1–2 个$1已经聚集的发布渠道", id: "Pilih 1–2 kanal peluncuran tempat $1 sudah berkumpul" }],
    [/^Write a one-paragraph launch post for (.+)$/, { zh: "为 $1 写一段发布帖", id: "Tulis posting peluncuran satu paragraf untuk $1" }],
    [/^Write the one-sentence offer for (.+)$/, { zh: "为 $1 写一句话卖点", id: "Tulis penawaran satu kalimat untuk $1" }],
    [/^Build: (.+)$/, { zh: "构建：$1", id: "Bangun: $1" }],
    [/^(\d+)% · Draft$/, { zh: "$1% · 草稿", id: "$1% · Draf" }],
    [/^Pending \((\d+)\)$/, { zh: "待处理（$1）", id: "Tertunda ($1)" }],
    [/^Approved \((\d+)\)$/, { zh: "已批准（$1）", id: "Disetujui ($1)" }],
    [/^Rejected \((\d+)\)$/, { zh: "已拒绝（$1）", id: "Ditolak ($1)" }],
    [/^(\d+) artifacts · (\d+) credits$/, { zh: "$1 个产出 · $2 积分", id: "$1 artefak · $2 kredit" }],
    [/^Ask · (.+) · standard$/, { zh: "询问 · $1 · 标准", id: "Tanya · $1 · standar" }],
    [/^weekly · Next: (.+)$/, { zh: "每周 · 下次：$1", id: "mingguan · Berikutnya: $1" }],
    [/^daily · Next: (.+)$/, { zh: "每天 · 下次：$1", id: "harian · Berikutnya: $1" }],
    [/^≈ ([\d.]+) h$/, { zh: "≈ $1 小时", id: "≈ $1 jam" }]
  );

  Object.assign(ZH, {
    "Cancel": "取消",
    "Cancelled": "已取消",
    "The AI request timed out.": "AI 请求超时。",
    "conflict copy": "冲突副本",
    "Untitled": "未命名",
    "“{name}” was edited on two devices — kept both versions": "“{name}”在两台设备上都被编辑过——已保留两个版本",
    "A new version of Sweep is ready.": "Sweep 有新版本可用。",
    "Reload": "重新加载",
    "Later": "稍后"
  });
  Object.assign(ID, {
    "Cancel": "Batal",
    "Cancelled": "Dibatalkan",
    "The AI request timed out.": "Permintaan AI habis waktu.",
    "conflict copy": "salinan konflik",
    "Untitled": "Tanpa judul",
    "“{name}” was edited on two devices — kept both versions": "“{name}” diedit di dua perangkat — kedua versi disimpan",
    "A new version of Sweep is ready.": "Versi baru Sweep sudah siap.",
    "Reload": "Muat ulang",
    "Later": "Nanti"
  });

  Object.assign(ZH, {
    "Download spec pack (.zip)": "下载规格包 (.zip)",
    "Share / remix link": "分享 / 复刻链接",
    "Remix template": "复刻模板",
    "LinkedIn Post": "LinkedIn 帖子"
  });
  Object.assign(ID, {
    'Show bigger QR': 'Perbesar kode QR',
    'Show smaller QR': 'Perkecil kode QR',
    "Download spec pack (.zip)": "Unduh paket spesifikasi (.zip)",
    "Share / remix link": "Tautan bagikan / remix",
    "Remix template": "Remix templat",
    "LinkedIn Post": "Post LinkedIn"
  });

  // Whole-paragraph translations for blocks that mix text with inline markup (<strong> etc.).
  // Key: the block's English text with whitespace collapsed. Value: translated HTML.
  const BLOCKS = {
    "Open the Operator tab to access Otto, your local AI operator. Chat with Otto to generate brand kits, social posts, emails, outreach lists, research, pitch decks, landing sites, or newsletters. The 6 tabs provide: Overview (chat + stats + run panel + Permissions + Decisions), Create (generate + multi-page site), Library (all artifacts with grouping and filtering), Grow (calendar + inbox), Money (insights + ledger + payments), and Data (search + scheduled tasks + privacy). Use the Mode selector to choose \"Ask first\" (pending approval) or \"On its own\" (auto-approve). Use the Power selector to choose how many artifacts to generate: Light touch (3), Steady clip (6), Big swing (10), or Full send (16). Select Work quality (Standard or Premium ×2 credits) for richer outputs. The Permissions panel controls what Otto can do; disabled channels mark artifacts as \"held\". Answer Decisions to guide Otto's work. Run a pass with Pause/Stop controls and view the Run summary modal afterward.": { zh: "打开“运营助手”标签页即可使用本地 AI 运营助手 Otto。和 Otto 聊天，生成品牌套件、社交帖子、邮件、外联名单、调研、路演文稿、落地页或简报邮件。6 个标签页分别是：<strong>概览</strong>（聊天 + 统计 + 运行面板 + 权限 + 决策）、<strong>创作</strong>（生成 + 多页网站）、<strong>内容库</strong>（所有产出，可分组和筛选）、<strong>增长</strong>（日历 + 收件箱）、<strong>收入</strong>（洞察 + 账本 + 收款）和<strong>数据</strong>（搜索 + 定时任务 + 隐私）。用<strong>模式</strong>选择“先询问”（待批准）或“自主执行”（自动批准）。用<strong>力度</strong>选择生成多少产出：轻触（3）、稳步推进（6）、大动作（10）或全力以赴（16）。选择<strong>工作质量</strong>（标准，或高级 ×2 积分）以获得更丰富的输出。<strong>权限</strong>面板控制 Otto 能做什么；被禁用的渠道会把产出标记为“搁置”。回答<strong>决策</strong>来指导 Otto 的工作。运行时可暂停/停止，结束后查看运行摘要。", id: "Buka tab Operator untuk memakai Otto, operator AI lokalmu. Ngobrol dengan Otto untuk membuat brand kit, posting sosial, email, daftar outreach, riset, pitch deck, situs landing, atau newsletter. 6 tab berisi: <strong>Ringkasan</strong> (chat + statistik + panel jalankan + Izin + Keputusan), <strong>Buat</strong> (pembuatan + situs multi-halaman), <strong>Pustaka</strong> (semua artefak dengan pengelompokan dan filter), <strong>Tumbuh</strong> (kalender + kotak masuk), <strong>Uang</strong> (wawasan + buku besar + pembayaran), dan <strong>Data</strong> (pencarian + tugas terjadwal + privasi). Pakai pemilih <strong>Mode</strong> untuk memilih \"Tanya dulu\" (menunggu persetujuan) atau \"Sendiri\" (setujui otomatis). Pakai pemilih <strong>Daya</strong> untuk memilih jumlah artefak: Sentuhan ringan (3), Laju stabil (6), Ayunan besar (10), atau Habis-habisan (16). Pilih <strong>Kualitas kerja</strong> (Standar atau Premium ×2 kredit) untuk hasil lebih kaya. Panel <strong>Izin</strong> mengatur apa yang bisa Otto lakukan; kanal yang dimatikan menandai artefak sebagai \"ditahan\". Jawab <strong>Keputusan</strong> untuk mengarahkan kerja Otto. Jalankan dengan kontrol Jeda/Berhenti dan lihat ringkasan hasil sesudahnya." }
  };

  // ---------- engine ----------
  function detectLanguage() {
    const preferred = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    const code = String(preferred).toLowerCase();
    if (code.indexOf('zh') === 0) return 'zh';
    if (code.indexOf('id') === 0 || code.indexOf('ms') === 0) return 'id';
    return 'en';
  }

  function storedLanguage() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && DICTS[saved] || saved === 'en') return saved;
    } catch (error) {
      /* storage unavailable */
    }
    return detectLanguage();
  }

  let lang = storedLanguage();
  const records = new WeakMap();

  function translatePlain(english) {
    if (lang === 'en' || !english) return null;
    const dict = DICTS[lang];
    if (Object.prototype.hasOwnProperty.call(dict, english)) return dict[english];
    for (let i = 0; i < PATTERNS.length; i++) {
      const pattern = PATTERNS[i][0];
      if (pattern.test(english)) return english.replace(pattern, PATTERNS[i][1][lang]);
    }
    const prefix = english.match(/^(.+?) · (.+)$/);
    if (prefix && PREFIX_LABELS.indexOf(prefix[1]) !== -1 && dict[prefix[1]]) {
      return dict[prefix[1]] + ' · ' + prefix[2];
    }
    return null;
  }

  // Translate a full string, keeping its surrounding whitespace.
  function translateText(value) {
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = match[2].replace(/\s+/g, ' ');
    const translated = translatePlain(core);
    return translated === null ? null : match[1] + translated + match[3];
  }

  function t(english, vars) {
    let out = lang === 'en' ? english : (DICTS[lang][english] || english);
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        out = out.split('{' + name + '}').join(String(vars[name]));
      });
    }
    return out;
  }

  function skipped(element) {
    if (!element) return true;
    if (SKIP_TAGS[element.tagName]) return true;
    return !!(element.closest && element.closest(SKIP_SELECTOR));
  }

  function processTextNode(node) {
    const parent = node.parentElement;
    if (skipped(parent)) return;
    let record = records.get(node);
    const current = node.nodeValue;
    if (record && current === record.shown) {
      // Already ours: re-render from the English source in the current language.
      const wanted = lang === 'en' ? record.en : (translateText(record.en) || record.en);
      if (wanted !== record.shown) {
        record.shown = wanted;
        node.nodeValue = wanted;
      }
      return;
    }
    // The app wrote new text (or first visit): treat it as the English source.
    record = { en: current, shown: current };
    records.set(node, record);
    if (lang === 'en') return;
    const translated = translateText(current);
    if (translated !== null && translated !== current) {
      record.shown = translated;
      node.nodeValue = translated;
    }
  }

  function processAttributes(element) {
    if (!element.getAttribute || skipped(element) && element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') return;
    if (element.closest && element.closest(SKIP_SELECTOR)) return;
    let store = records.get(element);
    if (!store) {
      store = {};
      records.set(element, store);
    }
    ATTRS.forEach(function (attr) {
      if (!element.hasAttribute(attr)) return;
      const current = element.getAttribute(attr);
      const record = store[attr];
      if (record && current === record.shown) {
        const wanted = lang === 'en' ? record.en : (translateText(record.en) || record.en);
        if (wanted !== record.shown) {
          record.shown = wanted;
          element.setAttribute(attr, wanted);
        }
        return;
      }
      const fresh = { en: current, shown: current };
      store[attr] = fresh;
      if (lang === 'en') return;
      const translated = translateText(current);
      if (translated !== null && translated !== current) {
        fresh.shown = translated;
        element.setAttribute(attr, translated);
      }
    });
  }

  const blockRecords = new WeakMap();

  function collapse(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function processBlocks(root) {
    if (!root || root.nodeType !== 1 || !root.querySelectorAll) return;
    const candidates = root.matches('p, li') ? [root] : [];
    root.querySelectorAll('p, li').forEach(function (element) {
      candidates.push(element);
    });
    candidates.forEach(function (element) {
      let record = blockRecords.get(element);
      if (!record && !element.children.length) return;
      if (skipped(element)) return;
      if (record && element.innerHTML !== record.shown) record = null;
      if (!record) {
        const key = collapse(element.textContent);
        if (!Object.prototype.hasOwnProperty.call(BLOCKS, key)) return;
        record = { en: element.innerHTML, key: key, shown: element.innerHTML };
        blockRecords.set(element, record);
      }
      const wanted = lang === 'en' ? record.en : (BLOCKS[record.key][lang] || record.en);
      if (wanted !== record.shown) {
        element.innerHTML = wanted;
        record.shown = element.innerHTML;
      }
    });
  }

  function processTree(root) {
    if (!root) return;
    if (root.nodeType === 1) processBlocks(root);
    if (root.nodeType === 3) {
      processTextNode(root);
      return;
    }
    if (root.nodeType !== 1) return;
    processAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1 && skipped(node) && node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) {
        if (/\S/.test(node.nodeValue)) processTextNode(node);
      } else {
        processAttributes(node);
      }
      node = walker.nextNode();
    }
  }

  let pending = new Set();
  let scheduled = false;
  function schedule(node) {
    pending.add(node);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }
  function flush() {
    scheduled = false;
    const batch = pending;
    pending = new Set();
    batch.forEach(function (node) {
      if (node.isConnected) processTree(node);
    });
  }

  function startObserver() {
    const observer = new MutationObserver(function (mutations) {
      if (lang === 'en' && !anyTranslated) return;
      mutations.forEach(function (mutation) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(schedule);
        } else if (mutation.type === 'characterData') {
          schedule(mutation.target);
        } else if (mutation.type === 'attributes') {
          schedule(mutation.target);
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  let anyTranslated = lang !== 'en';
  const listeners = [];

  function setLanguage(code) {
    if (code !== 'en' && !DICTS[code]) return;
    lang = code;
    if (code !== 'en') anyTranslated = true;
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch (error) {
      /* storage unavailable */
    }
    document.documentElement.lang = code === 'zh' ? 'zh-Hans' : code;
    processTree(document.body);
    listeners.forEach(function (listener) {
      try {
        listener(code);
      } catch (error) {
        /* listener failed */
      }
    });
  }

  function init() {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
    if (lang !== 'en') processTree(document.body);
    startObserver();
  }

  window.SweepI18n = {
    t: t,
    translate: function (value) {
      const out = translateText(value);
      return out === null ? value : out;
    },
    getLanguage: function () { return lang; },
    setLanguage: setLanguage,
    onChange: function (listener) { listeners.push(listener); },
    languages: LANGUAGES,
    refresh: function () { processTree(document.body); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
