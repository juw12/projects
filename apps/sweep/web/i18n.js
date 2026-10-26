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

  function processTree(root) {
    if (!root) return;
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
