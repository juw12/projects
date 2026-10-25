// Sweep Studio — spec score, spec-driven docs, task board, builder handoff,
// share links / cards and a remixable template gallery.
// Loaded after app.js and enhance.js. 100% local: no network calls, no AI.
(function () {
  'use strict';
  if (window.SweepStudio) return;

  const SHARE_PREFIX = '#share=';
  const PENDING_REMIX_KEY = 'sweep_pending_remix_v1';
  const STUDIO_TABS = ['board', 'spec', 'handoff', 'share'];
  const HOURS_BY_COMPLEXITY = { 1: 1, 2: 2.5, 3: 5, 4: 8, 5: 13 };
  const APP_URL = 'https://juwpegatron.github.io/projects/sweep/';

  const ui = {
    tab: 'board',
    specFile: 'specs/requirements.md',
    specMode: 'preview',
    promptDrafts: {},
    shareUrl: '',
    sharedPayload: null
  };

  // ---------- small helpers ----------

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function esc(value) {
    return escapeHtml(value == null ? '' : String(value));
  }

  function isDemo(project) {
    return !project || project.id === DEMO_PROJECT.id;
  }

  function inApp() {
    const gate = document.getElementById('section-gate');
    return !!(state.workspace && gate && gate.style.display === 'none');
  }

  function persist(project) {
    if (project && !isDemo(project)) saveState();
  }

  function slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  }

  function lowerFirst(text) {
    const value = String(text || '').trim();
    if (!value) return value;
    if (/^[A-Z]{2,}/.test(value)) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
  }

  function splitList(text) {
    return String(text || '')
      .split(/\n|;|,(?![^()]*\))/)
      .map(function (item) { return item.replace(/^[-*•\s]+/, '').trim(); })
      .filter(function (item) { return item.length > 1; });
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function downloadText(filename, text) {
    downloadBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));
  }

  function copyText(text, message) {
    const done = function () { showToast(message || 'Copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } else {
      legacyCopy(text);
      done();
    }
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch (error) {
      /* clipboard unavailable — the text stays visible for manual copy */
    }
    area.remove();
  }

  function openExternal(url) {
    window.open(url, '_blank', 'noopener');
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- spec score (brief lint) ----------

  const VAGUE_TERMS = {
    fast: 'state a number, e.g. “loads in under 1 s”',
    quick: 'state a number, e.g. “in under 10 seconds”',
    quickly: 'state a number, e.g. “in under 10 seconds”',
    easy: 'name the action and the max steps, e.g. “in 2 taps”',
    easily: 'name the action and the max steps, e.g. “in 2 taps”',
    simple: 'say what is left out instead (non-goals)',
    intuitive: 'describe the first action a new user can do unaided',
    'user-friendly': 'describe a concrete behaviour instead',
    seamless: 'name the steps that disappear',
    seamlessly: 'name the steps that disappear',
    robust: 'say what must not break, e.g. “survives a reload”',
    scalable: 'give a size, e.g. “500 items without lag”',
    modern: 'name the visual or technical choice',
    beautiful: 'name the visual choice (type, colour, layout)',
    powerful: 'name the capability',
    smart: 'say what it decides and from which data',
    efficient: 'give a measure (time, taps, cost)',
    better: 'better than what, by how much?',
    best: 'name the comparison',
    various: 'list them',
    etc: 'finish the list or cut it',
    lots: 'give a number',
    many: 'give a number'
  };

  const OBSERVABLE = /\d|file:\/\/|console|boot|load|open|creat|add|delet|remov|updat|edit|filter|search|sort|export|import|download|upload|persist|reload|sav|render|responsive|mobile|offline|sync|notif|remind|sign|log ?in|pay|checkout|share|streak|list|show|display|track|schedul|invite/i;
  const GENERIC_USERS = /^(users?|everyone|people|anyone|customers?|clients?|the public)$/i;

  const FIELD_LABELS = {
    'brief-app-name': 'App name',
    'brief-one-liner': 'One-liner',
    'brief-problem': 'Problem',
    'brief-target-user': 'Target user',
    'brief-jtbd': 'Job-to-be-done',
    'brief-non-goals': 'Non-goals',
    'brief-overlap': 'Overlap / competitors',
    'success-checks-container': 'Success checks'
  };

  function scoreSpec(project) {
    const issues = [];
    const strengths = [];
    const checks = (project.successChecks || []).filter(Boolean);

    // Clarity — vague words and an under-explained problem.
    let clarity = 25;
    const fields = [
      ['brief-one-liner', project.oneLiner],
      ['brief-problem', project.problem],
      ['brief-target-user', project.targetUser],
      ['brief-jtbd', project.jtbd]
    ];
    checks.forEach(function (check) {
      fields.push(['success-checks-container', check]);
    });
    const seen = {};
    fields.forEach(function (pair) {
      const words = String(pair[1] || '').toLowerCase().match(/[a-z][a-z-]*/g) || [];
      words.forEach(function (word) {
        if (VAGUE_TERMS[word] && !seen[word]) {
          seen[word] = true;
          clarity -= 4;
          issues.push({
            area: 'Clarity',
            field: pair[0],
            message: '“' + word + '” in ' + FIELD_LABELS[pair[0]] + ' is hard to test',
            fix: VAGUE_TERMS[word]
          });
        }
      });
    });
    const problemLength = String(project.problem || '').trim().length;
    if (problemLength < 40) {
      clarity -= 6;
      issues.push({
        area: 'Clarity',
        field: 'brief-problem',
        message: 'Problem statement is thin (' + problemLength + ' characters)',
        fix: 'say who hurts, when, and what they do today instead'
      });
    }
    clarity = Math.max(0, clarity);
    if (clarity >= 22) strengths.push('Clear, concrete wording');

    // Testability — enough success checks, each observable.
    const observable = checks.filter(function (check) { return OBSERVABLE.test(check); });
    let testability = Math.round((Math.min(checks.length, 4) / 4) * 15);
    if (checks.length) testability += Math.round((observable.length / checks.length) * 10);
    if (checks.length < 3) {
      issues.push({
        area: 'Testability',
        field: 'success-checks-container',
        message: 'Only ' + checks.length + ' success check' + (checks.length === 1 ? '' : 's'),
        fix: 'aim for 3–5 checks a stranger could verify in a minute'
      });
    }
    checks.forEach(function (check) {
      if (!OBSERVABLE.test(check)) {
        issues.push({
          area: 'Testability',
          field: 'success-checks-container',
          message: '“' + check + '” is not observable',
          fix: 'phrase it as an action + visible result, e.g. “Create a habit and see it in today’s list”'
        });
      }
    });
    if (testability >= 22) strengths.push('Success checks are testable');

    // Scope — non-goals and awareness of alternatives.
    const nonGoals = splitList(project.nonGoals);
    let scope = 0;
    if (nonGoals.length) scope += 12;
    if (nonGoals.length >= 2) scope += 5;
    if (String(project.overlap || '').trim().length > 10) scope += 8;
    if (!nonGoals.length) {
      issues.push({
        area: 'Scope',
        field: 'brief-non-goals',
        message: 'No non-goals — scope will creep',
        fix: 'list 2–3 things v1 deliberately will not do'
      });
    } else if (nonGoals.length < 2) {
      issues.push({
        area: 'Scope',
        field: 'brief-non-goals',
        message: 'Only one non-goal',
        fix: 'add one more explicit “not in v1” item'
      });
    }
    if (String(project.overlap || '').trim().length <= 10) {
      issues.push({
        area: 'Scope',
        field: 'brief-overlap',
        message: 'No competitors or alternatives named',
        fix: 'name what people use today and why yours is different'
      });
    }
    if (scope >= 22) strengths.push('Scope is fenced in');

    // User focus — a specific user, a real job, a tight one-liner.
    let focus = 0;
    const user = String(project.targetUser || '').trim();
    if (user && !GENERIC_USERS.test(user) && user.split(/\s+/).length >= 2) {
      focus += 10;
    } else {
      issues.push({
        area: 'User focus',
        field: 'brief-target-user',
        message: user ? '“' + user + '” is too broad' : 'No target user',
        fix: 'add a qualifier, e.g. “freelance designers with 5–20 clients”'
      });
    }
    if (/\bwhen\b/i.test(project.jtbd || '') && /\b(so|to)\b/i.test(project.jtbd || '')) {
      focus += 10;
    } else {
      issues.push({
        area: 'User focus',
        field: 'brief-jtbd',
        message: 'Job-to-be-done is not in “When …, I want …, so I can …” form',
        fix: 'name the trigger moment and the outcome'
      });
    }
    const linerLength = String(project.oneLiner || '').trim().length;
    if (linerLength >= 20 && linerLength <= 140) {
      focus += 5;
    } else {
      issues.push({
        area: 'User focus',
        field: 'brief-one-liner',
        message: linerLength < 20 ? 'One-liner is too short to pitch' : 'One-liner runs long (' + linerLength + ' chars)',
        fix: 'aim for 60–120 characters: who + what + why'
      });
    }
    if (focus >= 22) strengths.push('Sharp user focus');

    const total = Math.max(0, Math.min(100, clarity + testability + scope + focus));
    const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 55 ? 'C' : 'D';
    return {
      score: total,
      grade: grade,
      parts: [
        { label: 'Clarity', value: clarity },
        { label: 'Testability', value: testability },
        { label: 'Scope', value: scope },
        { label: 'User focus', value: focus }
      ],
      issues: issues,
      strengths: strengths
    };
  }

  // ---------- spec generation ----------

  function outcomeOf(project) {
    const jtbd = String(project.jtbd || '');
    const match = jtbd.match(/\bso (?:that )?(?:i|we|they)? ?(?:can )?(.+)$/i);
    if (match && match[1]) return lowerFirst(match[1].replace(/[.]+$/, ''));
    const problem = String(project.problem || '').replace(/[.]+$/, '');
    return problem ? 'I no longer have to deal with this: ' + lowerFirst(problem) : 'the job gets done';
  }

  function persona(project) {
    const user = String(project.targetUser || 'user').trim();
    const article = /^[aeiou]/i.test(user) ? 'an' : 'a';
    if (/s$/i.test(user.split(/\s+/)[0]) || /\bteams?\b|\bpeople\b/i.test(user)) return 'one of the ' + lowerFirst(user);
    return article + ' ' + lowerFirst(user);
  }

  function acceptanceFor(check) {
    const text = check.toLowerCase();
    const criteria = [];
    let infrastructure = false;
    if (/file:\/\/|boot|console error|0 console/.test(text)) {
      infrastructure = true;
      criteria.push('WHEN the app is opened from file:// or a static host THEN THE SYSTEM SHALL render the first screen with 0 console errors');
    }
    if (/responsive|mobile|layout|390/.test(text)) {
      infrastructure = true;
      criteria.push('WHEN the viewport is 390 px wide THEN THE SYSTEM SHALL render every screen without horizontal scrolling');
      criteria.push('WHEN the viewport is 1440 px wide THEN THE SYSTEM SHALL keep text columns readable (≤ ~80 characters per line)');
    }
    if (/persist|storage|offline|reload|saved?\b|locally/.test(text)) {
      criteria.push('WHEN the page is reloaded THEN THE SYSTEM SHALL restore the user’s previously saved data');
    }
    if (/crud|creat|\badd/.test(text)) {
      criteria.push('WHEN the user submits a valid new item THEN THE SYSTEM SHALL add it to the list and show confirmation');
      criteria.push('IF a required field is empty THEN THE SYSTEM SHALL keep the form open and highlight the field');
    }
    if (/crud|updat|edit/.test(text)) {
      criteria.push('WHEN the user edits an item and saves THEN THE SYSTEM SHALL show the updated values immediately');
    }
    if (/crud|delet|remov/.test(text)) {
      criteria.push('WHEN the user deletes an item THEN THE SYSTEM SHALL remove it and offer undo or confirmation');
    }
    if (/filter|search|sort/.test(text)) {
      criteria.push('WHEN the user applies a filter or search THEN THE SYSTEM SHALL show only matching items');
      criteria.push('IF nothing matches THEN THE SYSTEM SHALL show an empty state with a way to clear the filter');
    }
    if (/log ?in|auth|account|sign/.test(text)) {
      criteria.push('WHEN the user signs in with valid credentials THEN THE SYSTEM SHALL open their workspace');
      criteria.push('IF credentials are invalid THEN THE SYSTEM SHALL reject the attempt without revealing which field was wrong');
    }
    if (/export|download/.test(text)) {
      criteria.push('WHEN the user exports THEN THE SYSTEM SHALL download a file that re-imports without data loss');
    }
    if (/import|upload/.test(text)) {
      criteria.push('IF an imported file is malformed THEN THE SYSTEM SHALL reject it and leave existing data untouched');
    }
    if (/remind|notif/.test(text)) {
      criteria.push('WHEN a scheduled reminder time is reached THEN THE SYSTEM SHALL notify the user exactly once');
    }
    if (/streak/.test(text)) {
      criteria.push('WHEN the user completes an item on consecutive days THEN THE SYSTEM SHALL increase the streak by one per day');
      criteria.push('IF a day is missed THEN THE SYSTEM SHALL reset the streak to 0 and keep the best streak');
    }
    if (/pay|checkout|stripe|invoice/.test(text)) {
      criteria.push('WHEN a payment succeeds THEN THE SYSTEM SHALL record it and show a receipt');
      criteria.push('IF a payment fails THEN THE SYSTEM SHALL not mark the order as paid');
    }
    if (/share|invite|link/.test(text)) {
      criteria.push('WHEN the user shares THEN THE SYSTEM SHALL produce a link that opens the same content for the recipient');
    }
    if (!criteria.length) {
      criteria.push('WHEN the user performs “' + check + '” THEN THE SYSTEM SHALL complete it and show a visible result');
    }
    if (!infrastructure) {
      criteria.push('IF the action fails THEN THE SYSTEM SHALL show a clear, recoverable error message');
    }
    return criteria;
  }

  function complexityOf(text) {
    const value = String(text || '').toLowerCase();
    if (/\bai\b|llm|gpt|recommend|predict|machine learning/.test(value)) return 5;
    if (/sync|real-?time|collab|invite|multi-?user/.test(value)) return 4;
    if (/pay|checkout|stripe|subscription|invoice/.test(value)) return 4;
    if (/log ?in|auth|account|sign ?up/.test(value)) return 4;
    if (/crud|creat.*(updat|edit|delet)|calendar|schedul|remind|notif/.test(value)) return 3;
    if (/streak|chart|graph|report|import|export/.test(value)) return 3;
    if (/filter|search|sort|responsive|mobile|layout|persist|storage|offline/.test(value)) return 2;
    if (/file:\/\/|boot|console|load/.test(value)) return 1;
    return 2;
  }

  function buildTasks(project) {
    const matrix = project.capabilityMatrix || generateCapabilityMatrix(project);
    const tasks = [];
    const add = function (phase, title, complexity, deps, extra) {
      const task = Object.assign({
        id: 'T' + (tasks.length + 1),
        key: slug(phase + '-' + title),
        phase: phase,
        title: title,
        complexity: complexity,
        hours: HOURS_BY_COMPLEXITY[complexity],
        deps: deps || [],
        reqs: []
      }, extra || {});
      tasks.push(task);
      return task.id;
    };

    const shell = add('M1', 'Scaffold the static app shell (web/index.html, styles.css, app.js)', 1, []);
    const tokens = add('M1', 'Design tokens and responsive layout shell', 2, [shell]);
    const data = matrix.backend && matrix.backend.on
      ? add('M1', 'Data model and persistence API (server + storage)', 4, [shell])
      : add('M1', 'Data model and localStorage persistence layer', 2, [shell]);
    const foundation = [tokens, data];
    if (matrix.auth && matrix.auth.on) {
      foundation.push(add('M1', 'Authentication and session handling', 4, [data]));
    }

    const features = [];
    (project.successChecks || []).forEach(function (check, index) {
      if (/file:\/\/|0 console|console error/i.test(check) && check.length < 60) return;
      if (/^responsive|responsive (mobile )?layout/i.test(check) && check.length < 60) return;
      features.push(add('M1', 'Build: ' + check, complexityOf(check), foundation.slice(), { reqs: ['R' + (index + 1)] }));
    });
    const responsive = add('M2', 'Responsive pass at 390 px and 1440 px', 2, features.length ? features.slice() : foundation.slice(), {
      reqs: (project.successChecks || []).map(function (check, index) {
        return /responsive|mobile|layout/i.test(check) ? 'R' + (index + 1) : null;
      }).filter(Boolean)
    });
    const checksTask = add('M2', 'Automated checks for every acceptance criterion', 3, features.length ? features.slice() : foundation.slice(), {
      reqs: (project.successChecks || []).map(function (_, index) { return 'R' + (index + 1); })
    });
    const gates = add('M2', 'Run verification gates (smoke, visual, repo checks, secret scan)', 2, [responsive, checksTask]);
    add('M3', 'Deploy to GitHub Pages and write the memory note', 1, [gates]);

    // Spec Kit-style [P]: tasks in the same phase sharing identical deps can run in parallel.
    const signature = {};
    tasks.forEach(function (task) {
      const key = task.phase + ':' + task.deps.join(',');
      signature[key] = (signature[key] || 0) + 1;
    });
    tasks.forEach(function (task) {
      task.parallel = signature[task.phase + ':' + task.deps.join(',')] > 1;
    });
    return tasks;
  }

  function boardState(project) {
    if (!project.board) project.board = {};
    return project.board;
  }

  function taskStatus(project, task) {
    return (project.board && project.board[task.key]) || 'todo';
  }

  function boardSummary(project) {
    const tasks = buildTasks(project);
    const byId = {};
    tasks.forEach(function (task) {
      task.status = taskStatus(project, task);
      byId[task.id] = task;
    });
    tasks.forEach(function (task) {
      task.blocked = task.status !== 'done' && task.deps.some(function (dep) {
        return byId[dep] && byId[dep].status !== 'done';
      });
    });
    const done = tasks.filter(function (task) { return task.status === 'done'; });
    const hoursTotal = tasks.reduce(function (sum, task) { return sum + task.hours; }, 0);
    const hoursLeft = tasks.reduce(function (sum, task) { return sum + (task.status === 'done' ? 0 : task.hours); }, 0);
    const next = tasks.find(function (task) { return task.status === 'doing'; }) ||
      tasks.find(function (task) { return task.status === 'todo' && !task.blocked; }) || null;
    return {
      tasks: tasks,
      byId: byId,
      done: done.length,
      total: tasks.length,
      percent: tasks.length ? Math.round((done.length / tasks.length) * 100) : 0,
      hoursTotal: hoursTotal,
      hoursLeft: hoursLeft,
      next: next
    };
  }

  function formatHours(hours) {
    return '≈ ' + (Math.round(hours * 2) / 2) + ' h';
  }

  function guessEntity(project) {
    const text = [project.oneLiner, project.jtbd].concat(project.successChecks || []).join(' ').toLowerCase();
    const match = text.match(/\b(?:track|manage|create|add|log|plan|organi[sz]e|store|save|book|list|split|schedule)s?\s+(?:your\s+|their\s+|my\s+|new\s+|a\s+|an\s+|the\s+)?([a-z]{3,})/);
    let noun = match ? match[1] : 'item';
    if (/^(and|with|for|from|into|them|it|work|progress|everything|things)$/.test(noun)) noun = 'item';
    noun = noun.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
    return noun.charAt(0).toUpperCase() + noun.slice(1);
  }

  function entityFields(project) {
    const text = [project.oneLiner, project.problem, project.jtbd].concat(project.successChecks || []).join(' ').toLowerCase();
    const fields = [
      ['id', 'string', 'stable unique id'],
      ['title', 'string', 'what the user sees in lists'],
      ['status', 'enum', 'e.g. active / done / archived'],
      ['createdAt', 'ISO date', ''],
      ['updatedAt', 'ISO date', '']
    ];
    if (/streak|habit|daily/.test(text)) {
      fields.push(['streak', 'number', 'consecutive days completed']);
      fields.push(['lastDoneOn', 'ISO date', 'used to extend or reset the streak']);
    }
    if (/remind|notif|schedul|due/.test(text)) fields.push(['remindAt', 'ISO date-time', 'next reminder / due time']);
    if (/assign|team|owner/.test(text)) fields.push(['assignee', 'string', 'who owns it']);
    if (/price|invoice|pay|budget|expense|amount|split/.test(text)) fields.push(['amount', 'number (cents)', 'store money as integers']);
    if (/tag|categor|label/.test(text)) fields.push(['tags', 'string[]', '']);
    return fields;
  }

  function requirementsMarkdown(project) {
    const lines = [];
    lines.push('# Requirements — ' + project.name, '');
    lines.push('> ' + (project.oneLiner || ''), '');
    lines.push('## Introduction', '');
    lines.push(project.problem || '_No problem statement yet._', '');
    lines.push('- **Primary user:** ' + (project.targetUser || '—'));
    lines.push('- **Job to be done:** ' + (project.jtbd || '—'), '');
    lines.push('## Requirements', '');
    (project.successChecks || []).forEach(function (check, index) {
      lines.push('### Requirement ' + (index + 1) + ' — ' + check, '');
      lines.push('**User story:** As ' + persona(project) + ', I want to ' + lowerFirst(check).replace(/^to /, '') + ', so that ' + outcomeOf(project) + '.', '');
      lines.push('#### Acceptance criteria', '');
      acceptanceFor(check).forEach(function (criterion, i) {
        lines.push((i + 1) + '. ' + criterion);
      });
      lines.push('');
    });
    const nonGoals = splitList(project.nonGoals);
    lines.push('## Out of scope (v1)', '');
    if (nonGoals.length) {
      nonGoals.forEach(function (item) { lines.push('- ' + item); });
    } else {
      lines.push('- _Not defined yet — add non-goals to the brief._');
    }
    lines.push('');
    lines.push('---', '');
    lines.push('_Generated locally by Sweep from the brief (EARS-style “WHEN … THEN THE SYSTEM SHALL …”). Review and edit before building._');
    return lines.join('\n');
  }

  function designMarkdown(project) {
    const matrix = project.capabilityMatrix || generateCapabilityMatrix(project);
    const entity = guessEntity(project);
    const lines = [];
    lines.push('# Design — ' + project.name, '');
    lines.push('## Overview', '');
    lines.push((project.oneLiner || '') + ' Built for ' + lowerFirst(project.targetUser || 'its users') + '.', '');
    lines.push('## Architecture', '');
    lines.push('```mermaid', 'flowchart LR');
    lines.push('  U([' + (project.targetUser || 'User').replace(/[\[\]()]/g, '') + ']) --> UI[Web UI · index.html]');
    lines.push('  UI --> L[App logic · app.js]');
    if (matrix.backend && matrix.backend.on) {
      lines.push('  L --> API[API server]');
      lines.push('  API --> DB[(Database)]');
    } else {
      lines.push('  L --> S[(localStorage)]');
    }
    if (matrix.auth && matrix.auth.on) lines.push('  L -.-> A[Auth / session]');
    lines.push('```', '');
    lines.push('## Capability decisions', '');
    lines.push('| Capability | Decision | Why |');
    lines.push('| --- | --- | --- |');
    [['backend', 'Backend / persistence'], ['auth', 'Auth / login'], ['mobile', 'Mobile']].forEach(function (pair) {
      const entry = matrix[pair[0]] || { on: false, reason: '' };
      lines.push('| ' + pair[1] + ' | ' + (entry.on ? 'ON' : 'OFF') + ' | ' + String(entry.reason || '').replace(/\|/g, '/') + ' |');
    });
    lines.push('');
    lines.push('## Components', '');
    lines.push('- **Shell** — header, navigation and responsive layout (mobile-first, 390 px → 1440 px).');
    lines.push('- **' + entity + ' list** — the primary screen; empty, loading and error states.');
    lines.push('- **' + entity + ' editor** — create / edit form with inline validation.');
    lines.push('- **Store** — ' + (matrix.backend && matrix.backend.on ? 'API client with optimistic updates and retry.' : 'versioned localStorage wrapper (`load`, `save`, `migrate`).'));
    if (matrix.auth && matrix.auth.on) lines.push('- **Session** — sign-in, sign-out, session restore.');
    lines.push('');
    lines.push('## Data model — `' + entity + '`', '');
    lines.push('| Field | Type | Notes |');
    lines.push('| --- | --- | --- |');
    entityFields(project).forEach(function (field) {
      lines.push('| `' + field[0] + '` | ' + field[1] + ' | ' + field[2] + ' |');
    });
    lines.push('');
    lines.push('## Error handling', '');
    lines.push('- Every user action shows success or a recoverable error; never fail silently.');
    lines.push('- Corrupt or old stored data is migrated or reset with a notice — the app must still boot.');
    lines.push('');
    lines.push('## Testing strategy', '');
    lines.push('- Each acceptance criterion in `specs/requirements.md` maps to at least one automated check.');
    lines.push('- Verification gates: smoke (0 console errors), visual (1440×900 and 390×844), repo checks, secret scan.');
    lines.push('');
    lines.push('_Assumption: entity name and fields are inferred from the brief — rename to match your domain._');
    return lines.join('\n');
  }

  function tasksMarkdown(project) {
    const summary = boardSummary(project);
    const phaseNames = { M1: 'Build', M2: 'Verification', M3: 'Ship' };
    const lines = [];
    lines.push('# Tasks — ' + project.name, '');
    lines.push('Legend: `[P]` can run in parallel with siblings · `c1–c5` complexity · hours are rough single-developer estimates.', '');
    ['M1', 'M2', 'M3'].forEach(function (phase) {
      const phaseTasks = summary.tasks.filter(function (task) { return task.phase === phase; });
      if (!phaseTasks.length) return;
      lines.push('## ' + phase + ' — ' + phaseNames[phase], '');
      phaseTasks.forEach(function (task) {
        const box = task.status === 'done' ? '[x]' : '[ ]';
        const parts = [task.id + (task.parallel ? ' [P]' : ''), task.title, 'c' + task.complexity, '~' + task.hours + ' h'];
        if (task.deps.length) parts.push('after ' + task.deps.join(', '));
        if (task.reqs.length) parts.push('covers ' + task.reqs.join(', '));
        lines.push('- ' + box + ' ' + parts.join(' · '));
      });
      lines.push('');
    });
    lines.push('**Total:** ' + summary.total + ' tasks · ' + formatHours(summary.hoursTotal) + ' · ' + summary.done + ' done');
    return lines.join('\n');
  }

  function commonRules(project) {
    const nonGoals = splitList(project.nonGoals);
    const lines = [];
    lines.push('## Product', '');
    lines.push('- **What:** ' + (project.oneLiner || ''));
    lines.push('- **For:** ' + (project.targetUser || ''));
    lines.push('- **Job:** ' + (project.jtbd || ''), '');
    lines.push('## Definition of Done', '');
    (project.successChecks || []).forEach(function (check) { lines.push('- [ ] ' + check); });
    lines.push('');
    lines.push('## Do not build (v1 non-goals)', '');
    if (nonGoals.length) {
      nonGoals.forEach(function (item) { lines.push('- ' + item); });
    } else {
      lines.push('- Anything not needed for the Definition of Done.');
    }
    lines.push('');
    lines.push('## Working agreement', '');
    lines.push('- Read `specs/requirements.md`, `specs/design.md` and `specs/tasks.md` before coding.');
    lines.push('- Work through `specs/tasks.md` in order; respect “after” dependencies; tick tasks as you finish.');
    lines.push('- Each acceptance criterion (WHEN … THEN THE SYSTEM SHALL …) needs a check that proves it.');
    lines.push('- Keep it static-first: open `web/index.html` with 0 console errors before anything else.');
    lines.push('- Never commit secrets. Ask before adding dependencies or a backend.');
    return lines.join('\n');
  }

  function agentsMarkdown(project) {
    return '# AGENTS.md — ' + project.name + '\n\n' +
      'Instructions for AI coding agents (Codex, Cursor, Claude Code, Copilot, Jules…).\n\n' +
      commonRules(project) + '\n\n' +
      '## Commands\n\n' +
      '- Run: open `web/index.html` (or `python3 -m http.server` in `web/`)\n' +
      '- Checks: `python scripts/build_site.py && python scripts/check_site.py && python scripts/run_all_tests.py` (when present)\n';
  }

  function claudeMarkdown(project) {
    return '# CLAUDE.md — ' + project.name + '\n\n' +
      'Claude Code project memory. Full agent rules live in `AGENTS.md`.\n\n' +
      commonRules(project) + '\n';
  }

  function cursorRule(project) {
    return '---\n' +
      'description: Product spec and working agreement for ' + project.name + ' (generated by Sweep)\n' +
      'globs:\n' +
      'alwaysApply: true\n' +
      '---\n\n' +
      commonRules(project) + '\n';
  }

  function builderPrompt(project, target) {
    const matrix = project.capabilityMatrix || generateCapabilityMatrix(project);
    const nonGoals = splitList(project.nonGoals);
    const lines = [];
    lines.push('Build "' + project.name + '" — ' + (project.oneLiner || ''));
    lines.push('');
    lines.push('Who it is for: ' + (project.targetUser || ''));
    lines.push('Problem: ' + (project.problem || ''));
    lines.push('Job to be done: ' + (project.jtbd || ''));
    lines.push('');
    lines.push('Must have (each must visibly work):');
    (project.successChecks || []).forEach(function (check, index) {
      const criteria = acceptanceFor(check);
      lines.push((index + 1) + '. ' + check + ' — ' + criteria[0].replace(/^WHEN /, 'when ').replace(' THEN THE SYSTEM SHALL ', ', it should '));
    });
    if (nonGoals.length) {
      lines.push('');
      lines.push('Do NOT build: ' + nonGoals.join('; '));
    }
    lines.push('');
    lines.push('Tech: ' + (matrix.backend && matrix.backend.on ? 'needs persistence beyond the browser' : 'front-end only, save data in localStorage') +
      '; ' + (matrix.auth && matrix.auth.on ? 'simple email sign-in' : 'no login') + '; mobile-first responsive (390 px and 1440 px).');
    lines.push('Design: clean and calm, generous spacing, clear empty states, one obvious primary action per screen.');
    if (target === 'v0') lines.push('Use React + Tailwind + shadcn/ui components.');
    lines.push('');
    lines.push('Start with the main screen, then add the features in the order above.');
    return lines.join('\n');
  }

  function specFiles(project) {
    return {
      'specs/requirements.md': requirementsMarkdown(project),
      'specs/design.md': designMarkdown(project),
      'specs/tasks.md': tasksMarkdown(project),
      'AGENTS.md': agentsMarkdown(project),
      'CLAUDE.md': claudeMarkdown(project),
      '.cursor/rules/sweep.mdc': cursorRule(project),
      'PROMPT.md': '# Builder prompt — ' + project.name + '\n\nPaste into Lovable, Bolt, v0 or any AI builder.\n\n```\n' + builderPrompt(project, 'generic') + '\n```\n'
    };
  }

  // ---------- minimal ZIP writer (store, no compression) ----------

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    Object.keys(files).forEach(function (name) {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(files[name]);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 0, true);
      entry.setUint16(12, dosTime, true);
      entry.setUint16(14, dosDate, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    const centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  function downloadSpecPack(project) {
    const files = specFiles(project);
    const folder = toKebabCase(project.name) || 'sweep-spec';
    const prefixed = {};
    Object.keys(files).forEach(function (name) {
      prefixed[folder + '/' + name] = files[name];
    });
    downloadBlob(folder + '-spec-pack.zip', buildZip(prefixed));
    showToast('Spec pack downloaded — ' + Object.keys(files).length + ' files');
  }

  // ---------- tiny markdown renderer (for previews) ----------

  function inlineMarkdown(text) {
    let html = esc(text);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, '$1<em>$2</em>');
    html = html.replace(/\b(WHEN|THEN|IF|SHALL|THE SYSTEM)\b/g, '<span class="ears">$1</span>');
    return html;
  }

  function renderMarkdown(markdown, project) {
    const lines = String(markdown).split('\n');
    const out = [];
    let list = null;
    let table = null;
    let fence = null;
    const closeList = function () {
      if (list) {
        out.push('</' + list + '>');
        list = null;
      }
    };
    const closeTable = function () {
      if (table) {
        out.push('</tbody></table></div>');
        table = null;
      }
    };
    lines.forEach(function (line) {
      if (fence !== null) {
        if (/^```/.test(line)) {
          if (fence.lang === 'mermaid' && project) {
            out.push('<div class="md-diagram">' + architectureSvg(project) + '</div>');
          } else {
            out.push('<pre class="md-code"><code>' + esc(fence.lines.join('\n')) + '</code></pre>');
          }
          fence = null;
        } else {
          fence.lines.push(line);
        }
        return;
      }
      const fenceOpen = line.match(/^```(\w*)/);
      if (fenceOpen) {
        closeList();
        closeTable();
        fence = { lang: fenceOpen[1], lines: [] };
        return;
      }
      if (/^\|/.test(line)) {
        closeList();
        const cells = line.replace(/^\||\|$/g, '').split('|').map(function (cell) { return cell.trim(); });
        if (cells.every(function (cell) { return /^-+$/.test(cell); })) return;
        if (!table) {
          table = true;
          out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
            cells.map(function (cell) { return '<th>' + inlineMarkdown(cell) + '</th>'; }).join('') +
            '</tr></thead><tbody>');
        } else {
          out.push('<tr>' + cells.map(function (cell) { return '<td>' + inlineMarkdown(cell) + '</td>'; }).join('') + '</tr>');
        }
        return;
      }
      closeTable();
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        out.push('<h' + (level + 1) + ' class="md-h' + level + '">' + inlineMarkdown(heading[2]) + '</h' + (level + 1) + '>');
        return;
      }
      const task = line.match(/^- \[( |x)\] (.*)$/);
      const bullet = line.match(/^[-*] (.*)$/);
      const ordered = line.match(/^\d+\. (.*)$/);
      if (task || bullet) {
        if (list !== 'ul') {
          closeList();
          out.push('<ul class="md-list">');
          list = 'ul';
        }
        if (task) {
          out.push('<li class="md-task' + (task[1] === 'x' ? ' is-done' : '') + '"><span class="md-box" aria-hidden="true"></span>' + inlineMarkdown(task[2]) + '</li>');
        } else {
          out.push('<li>' + inlineMarkdown(bullet[1]) + '</li>');
        }
        return;
      }
      if (ordered) {
        if (list !== 'ol') {
          closeList();
          out.push('<ol class="md-list">');
          list = 'ol';
        }
        out.push('<li>' + inlineMarkdown(ordered[1]) + '</li>');
        return;
      }
      closeList();
      if (/^> /.test(line)) {
        out.push('<blockquote>' + inlineMarkdown(line.slice(2)) + '</blockquote>');
      } else if (/^---+$/.test(line)) {
        out.push('<hr>');
      } else if (line.trim()) {
        out.push('<p>' + inlineMarkdown(line) + '</p>');
      }
    });
    closeList();
    closeTable();
    return out.join('');
  }

  function shortLabel(value, limit) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit - 1);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-]+$/, '') + '\u2026';
  }

  function architectureSvg(project) {
    const matrix = project.capabilityMatrix || generateCapabilityMatrix(project);
    const nodes = [
      { label: 'User', sub: shortLabel(project.targetUser, 19), shape: 'pill' },
      { label: 'Web UI', sub: 'index.html', shape: 'box' },
      { label: 'App logic', sub: 'app.js', shape: 'box' }
    ];
    if (matrix.backend && matrix.backend.on) {
      nodes.push({ label: 'API', sub: 'server', shape: 'box' });
      nodes.push({ label: 'Database', sub: 'persistent', shape: 'db' });
    } else {
      nodes.push({ label: 'Storage', sub: 'localStorage', shape: 'db' });
    }
    const width = 150;
    const gap = 36;
    const total = nodes.length * width + (nodes.length - 1) * gap;
    const height = matrix.auth && matrix.auth.on ? 190 : 110;
    let svg = '<svg class="arch" viewBox="0 0 ' + total + ' ' + height + '" role="img" aria-label="Architecture diagram">';
    svg += '<defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>';
    nodes.forEach(function (node, index) {
      const x = index * (width + gap);
      const radius = node.shape === 'pill' ? 32 : node.shape === 'db' ? 18 : 10;
      svg += '<g class="arch-node arch-' + node.shape + '">' +
        '<rect x="' + (x + 1) + '" y="20" width="' + (width - 2) + '" height="64" rx="' + radius + '"/>' +
        '<text x="' + (x + width / 2) + '" y="48" class="arch-label">' + esc(node.label) + '</text>' +
        '<text x="' + (x + width / 2) + '" y="68" class="arch-sub">' + esc(node.sub) + '</text></g>';
      if (index < nodes.length - 1) {
        svg += '<line class="arch-edge" x1="' + (x + width + 4) + '" y1="52" x2="' + (x + width + gap - 4) + '" y2="52" marker-end="url(#arch-arrow)"/>';
      }
    });
    if (matrix.auth && matrix.auth.on) {
      const logicX = 2 * (width + gap);
      svg += '<line class="arch-edge dashed" x1="' + (logicX + width / 2) + '" y1="86" x2="' + (logicX + width / 2) + '" y2="118" marker-end="url(#arch-arrow)"/>' +
        '<g class="arch-node arch-box"><rect x="' + (logicX + 1) + '" y="120" width="' + (width - 2) + '" height="56" rx="10"/>' +
        '<text x="' + (logicX + width / 2) + '" y="145" class="arch-label">Auth</text>' +
        '<text x="' + (logicX + width / 2) + '" y="164" class="arch-sub">session</text></g>';
    }
    return svg + '</svg>';
  }

  // ---------- share links ----------

  function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const normal = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normal + '==='.slice((normal.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function sharePayload(project) {
    return {
      v: 1,
      n: project.name,
      o: project.oneLiner,
      p: project.problem,
      u: project.targetUser,
      j: project.jtbd,
      s: (project.successChecks || []).slice(0, 12),
      g: project.nonGoals,
      x: project.overlap
    };
  }

  function briefFromPayload(payload) {
    return {
      name: String(payload.n || 'Shared plan').slice(0, 80),
      oneLiner: String(payload.o || '').slice(0, 300),
      problem: String(payload.p || '').slice(0, 2000),
      targetUser: String(payload.u || '').slice(0, 300),
      jtbd: String(payload.j || '').slice(0, 600),
      successChecks: (Array.isArray(payload.s) ? payload.s : []).map(function (item) { return String(item).slice(0, 300); }).filter(Boolean).slice(0, 12),
      nonGoals: String(payload.g || '').slice(0, 1200),
      overlap: String(payload.x || '').slice(0, 1200)
    };
  }

  async function encodeShare(project) {
    const bytes = new TextEncoder().encode(JSON.stringify(sharePayload(project)));
    if (window.CompressionStream) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
        return 'z' + toBase64Url(compressed);
      } catch (error) {
        /* fall through to uncompressed */
      }
    }
    return 'j' + toBase64Url(bytes);
  }

  async function decodeShare(token) {
    const kind = token.charAt(0);
    const bytes = fromBase64Url(token.slice(1));
    let json;
    if (kind === 'z') {
      if (!window.DecompressionStream) throw new Error('This browser cannot open compressed share links');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      json = await new Response(stream).text();
    } else if (kind === 'j') {
      json = new TextDecoder().decode(bytes);
    } else {
      throw new Error('Unknown share link format');
    }
    const payload = JSON.parse(json);
    if (!payload || payload.v !== 1) throw new Error('Unsupported share link version');
    return briefFromPayload(payload);
  }

  async function shareUrlFor(project) {
    const token = await encodeShare(project);
    const base = location.href.split('#')[0];
    return base + SHARE_PREFIX + token;
  }

  // ---------- creating projects (templates, remix) ----------

  function createProjectFromBrief(brief, message) {
    const project = Object.assign({
      id: 'proj-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      status: 'draft',
      createdAt: new Date().toISOString(),
      verifyGates: {}
    }, brief);
    project.successChecks = (brief.successChecks || []).slice();
    project.capabilityMatrix = generateCapabilityMatrix(project);
    state.projects.push(project);
    saveState();
    openProject(project.id);
    showToast(message || ('Created “' + project.name + '”'));
    return project;
  }

  const TEMPLATES = [
    {
      tag: 'Habits',
      name: 'Streakly',
      oneLiner: 'A habit tracker with streaks and gentle reminders for people who keep dropping their routines.',
      problem: 'Busy people start habits on Monday and forget them by Thursday because nothing nudges them at the right moment.',
      targetUser: 'Busy professionals building 1–3 daily habits',
      jtbd: 'When I finish my workday, I want a 10-second check-in, so I can keep my streak alive without thinking.',
      successChecks: ['Create a habit and see it in today’s list', 'Mark a habit done and see the streak increase by 1', 'Get a reminder at the chosen time', 'Data persists after reload (localStorage)'],
      nonGoals: 'No social feed; no coaching content; no wearables integration',
      overlap: 'Like Streaks or Habitica, but no gamified avatars and no account required'
    },
    {
      tag: 'Business',
      name: 'Tiny CRM',
      oneLiner: 'A one-screen CRM for freelance designers to track leads, follow-ups and unpaid invoices.',
      problem: 'Freelancers lose work because follow-ups live in their head and invoices sit unpaid for weeks without a reminder.',
      targetUser: 'Freelance designers with 5–20 active clients',
      jtbd: 'When a lead goes quiet, I want to see who to nudge today, so I can win the project before someone else does.',
      successChecks: ['Create, edit and delete a lead', 'Filter leads by stage (new, talking, won, lost)', 'See overdue follow-ups at the top', 'Export all data to CSV'],
      nonGoals: 'No email sync; no team accounts; no pipeline analytics',
      overlap: 'Simpler than HubSpot or Pipedrive; closer to a smart spreadsheet'
    },
    {
      tag: 'Launch',
      name: 'Waitlist Rocket',
      oneLiner: 'A launch waitlist page with referral links that move people up the queue.',
      problem: 'Indie makers launch to silence because a plain email form gives early fans no reason to share.',
      targetUser: 'Indie makers pre-launching a SaaS product',
      jtbd: 'When I announce my product, I want every signup to bring a friend, so I can launch to a crowd instead of crickets.',
      successChecks: ['Sign up with an email and see my queue position', 'Share a personal referral link', 'Each referral moves the referrer up 5 places', 'Responsive layout at 390 px and 1440 px'],
      nonGoals: 'No payments; no email campaigns; no admin dashboard in v1',
      overlap: 'Like Viral Loops or GetWaitlist, but a free static page you own'
    },
    {
      tag: 'Home',
      name: 'Pantry Plan',
      oneLiner: 'A weekly meal planner that turns chosen recipes into one grouped grocery list.',
      problem: 'Families waste food and time because meal plans and shopping lists live in different apps and never match.',
      targetUser: 'Parents planning dinners for a family of 3–5',
      jtbd: 'When I plan the week on Sunday, I want the shopping list built for me, so I can shop once in under 30 minutes.',
      successChecks: ['Add a recipe with ingredients', 'Drag recipes onto a 7-day plan', 'Generate a grocery list grouped by aisle', 'Tick items off while shopping on mobile'],
      nonGoals: 'No recipe discovery; no nutrition tracking; no grocery delivery integration',
      overlap: 'Lighter than Paprika or Mealime; no recipe database to maintain'
    },
    {
      tag: 'Learning',
      name: 'Recall',
      oneLiner: 'A study timer with spaced-repetition flashcards for students cramming for exams.',
      problem: 'Students re-read notes for hours instead of testing themselves, and forget most of it before the exam.',
      targetUser: 'University students preparing for 2–4 exams per term',
      jtbd: 'When I sit down to study, I want the app to pick what I am about to forget, so I can study 25 minutes and remember it.',
      successChecks: ['Create a deck and add cards', 'Review due cards and rate each one (again, good, easy)', 'Cards rated “again” come back the same session', 'Start a 25-minute focus timer'],
      nonGoals: 'No shared decks marketplace; no AI card generation; no handwriting input',
      overlap: 'Like Anki but with a friendlier first run and a built-in focus timer'
    },
    {
      tag: 'Money',
      name: 'Split Fair',
      oneLiner: 'A shared-expenses splitter for roommates that shows who owes whom in one tap.',
      problem: 'Roommates argue about money because receipts pile up in group chats and nobody knows the real balance.',
      targetUser: 'Roommates sharing a flat of 2–5 people',
      jtbd: 'When someone pays for groceries, I want to log it in seconds, so I can settle up at month end without a spreadsheet.',
      successChecks: ['Add an expense with payer and amount', 'Split an expense equally or by custom amounts', 'Show who owes whom with the fewest transfers', 'Data persists after reload (localStorage)'],
      nonGoals: 'No bank connections; no in-app payments; no multi-currency in v1',
      overlap: 'Like Splitwise without accounts, ads or a premium tier'
    }
  ];

  // ---------- catalog: template gallery ----------

  function ensureTemplateGallery() {
    const section = document.getElementById('section-catalog');
    if (!section || document.getElementById('template-gallery')) return;
    const gallery = document.createElement('div');
    gallery.className = 'template-gallery';
    gallery.id = 'template-gallery';
    gallery.innerHTML =
      '<div class="template-gallery-head">' +
        '<div><span class="studio-kicker">Templates</span><h3>Start from a proven brief</h3></div>' +
        '<p>Each one scores A on Spec Score. Remix it, then make it yours.</p>' +
      '</div>' +
      '<div class="template-row" role="list">' +
        TEMPLATES.map(function (template, index) {
          const score = scoreSpec(template);
          return '<article class="template-card" role="listitem">' +
            '<div class="template-top"><span class="template-tag">' + esc(template.tag) + '</span>' +
            '<span class="template-grade grade-' + score.grade + '" title="Spec score">' + score.score + '</span></div>' +
            '<h4>' + esc(template.name) + '</h4>' +
            '<p>' + esc(template.oneLiner) + '</p>' +
            '<div class="template-meta">' + template.successChecks.length + ' checks · ' + buildTasks(template).length + ' tasks</div>' +
            '<button type="button" class="btn btn-secondary btn-sm template-remix" data-template="' + index + '">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>' +
              ' Remix</button>' +
          '</article>';
        }).join('') +
      '</div>';
    const actions = $('.catalog-actions', section);
    if (actions) {
      section.insertBefore(gallery, actions);
    } else {
      section.appendChild(gallery);
    }
    gallery.addEventListener('click', function (event) {
      const button = event.target.closest('[data-template]');
      if (!button) return;
      const template = TEMPLATES[Number(button.getAttribute('data-template'))];
      if (!template) return;
      const brief = Object.assign({}, template);
      delete brief.tag;
      createProjectFromBrief(brief, 'Remixed “' + template.name + '” — edit the brief to make it yours');
    });
  }

  // ---------- plan view: studio strip ----------

  function scoreRing(score, size, grade) {
    const radius = (size / 2) - 5;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - score / 100);
    return '<svg class="score-ring grade-' + grade + '" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle class="score-ring-track" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + radius + '"/>' +
      '<circle class="score-ring-value" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + radius + '" stroke-dasharray="' + circumference.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
      '</svg>';
  }

  function ensurePlanStudio(project) {
    const section = document.getElementById('section-plan');
    if (!section || !project) return;
    const actions = $('.section-actions', section);
    if (actions && !document.getElementById('plan-studio-btn')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'plan-studio-btn';
      button.className = 'btn btn-secondary btn-sm';
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 17l.7 2.1L22 20l-2.3.9L19 23l-.7-2.1L16 20l2.3-.9z"/></svg> Studio';
      button.addEventListener('click', function () { navigateTo('studio'); });
      const verifyButton = $all('button', actions).find(function (el) { return /Verify/.test(el.textContent); });
      actions.insertBefore(button, verifyButton || null);
    }

    let strip = document.getElementById('plan-studio-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'plan-studio-strip';
      strip.className = 'studio-strip';
      const anchor = document.getElementById('plan-progress') || $('.plan-header', section);
      if (anchor) anchor.insertAdjacentElement('afterend', strip);
      strip.addEventListener('click', function (event) {
        const target = event.target.closest('[data-strip]');
        if (!target) return;
        const action = target.getAttribute('data-strip');
        if (action === 'studio') navigateTo('studio');
        if (action === 'spec') {
          ui.tab = 'spec';
          navigateTo('studio');
        }
        if (action === 'lovable') handoff(state.currentProject, 'lovable');
      });
    }
    const score = scoreSpec(project);
    const board = boardSummary(project);
    strip.innerHTML =
      '<button type="button" class="strip-score" data-strip="spec" title="Open the spec">' +
        '<span class="strip-ring">' + scoreRing(score.score, 52, score.grade) + '<b>' + score.score + '</b></span>' +
        '<span class="strip-text"><span class="strip-label">Spec score · ' + score.grade + '</span>' +
        '<span class="strip-value">' + (score.issues.length ? score.issues.length + ' suggestion' + (score.issues.length === 1 ? '' : 's') : 'Ready to build') + '</span></span>' +
      '</button>' +
      '<button type="button" class="strip-board" data-strip="studio" title="Open the task board">' +
        '<span class="strip-label">Build board</span>' +
        '<span class="strip-value">' + board.done + '/' + board.total + ' tasks · ' + formatHours(board.hoursLeft) + ' left</span>' +
        '<span class="strip-next">' + (board.next ? 'Next: ' + esc(board.next.id + ' ' + board.next.title) : 'All tasks done') + '</span>' +
      '</button>' +
      '<div class="strip-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-strip="studio">Open Studio</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-strip="lovable" title="Open this plan as a prompt in Lovable">Build in Lovable ↗</button>' +
      '</div>';
  }

  // ---------- studio section ----------

  function ensureStudioSection() {
    if (document.getElementById('section-studio')) return;
    const planSection = document.getElementById('section-plan');
    if (!planSection) return;
    const section = document.createElement('section');
    section.id = 'section-studio';
    section.className = 'section';
    section.style.display = 'none';
    section.innerHTML =
      '<div class="section-header">' +
        '<button class="btn btn-sm btn-text" type="button" data-studio="back">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back to plan</button>' +
        '<div class="section-actions">' +
          '<button class="btn btn-secondary btn-sm" type="button" data-studio="pack">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Spec pack .zip</button>' +
          '<button class="btn btn-primary btn-sm" type="button" data-studio="share">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg> Share</button>' +
        '</div>' +
      '</div>' +
      '<div class="studio-hero">' +
        '<span class="studio-kicker">Studio</span>' +
        '<h2 class="studio-title" id="studio-title"></h2>' +
        '<p class="studio-sub" id="studio-sub"></p>' +
      '</div>' +
      '<div class="studio-summary" id="studio-summary"></div>' +
      '<div class="studio-tabs" role="tablist" id="studio-tabs">' +
        '<button type="button" role="tab" data-tab="board">Board</button>' +
        '<button type="button" role="tab" data-tab="spec">Spec</button>' +
        '<button type="button" role="tab" data-tab="handoff">Handoff</button>' +
        '<button type="button" role="tab" data-tab="share">Share</button>' +
      '</div>' +
      '<div class="studio-panel" id="studio-panel" role="tabpanel"></div>';
    planSection.insertAdjacentElement('afterend', section);

    section.addEventListener('click', onStudioClick);
    section.addEventListener('input', function (event) {
      if (event.target.id === 'handoff-prompt' && state.currentProject) {
        ui.promptDrafts[state.currentProject.id] = event.target.value;
      }
    });
    attachBoardDrag(section);

    const nav = document.getElementById('main-nav');
    const planLink = document.getElementById('nav-plan');
    if (nav && planLink && !document.getElementById('nav-studio')) {
      const link = document.createElement('a');
      link.href = '#studio';
      link.className = 'nav-item';
      link.id = 'nav-studio';
      link.setAttribute('data-section', 'studio');
      link.textContent = 'Studio';
      link.style.display = planLink.style.display;
      link.addEventListener('click', function (event) {
        event.preventDefault();
        if (state.currentProject) navigateTo('studio');
      });
      planLink.insertAdjacentElement('afterend', link);
    }
  }

  function renderStudio(project) {
    ensureStudioSection();
    if (!project) return;
    document.getElementById('studio-title').textContent = project.name;
    document.getElementById('studio-sub').textContent = project.oneLiner || '';
    renderStudioSummary(project);
    $all('#studio-tabs [data-tab]').forEach(function (button) {
      const active = button.getAttribute('data-tab') === ui.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const panel = document.getElementById('studio-panel');
    if (ui.tab === 'board') panel.innerHTML = boardHtml(project);
    if (ui.tab === 'spec') panel.innerHTML = specHtml(project);
    if (ui.tab === 'handoff') panel.innerHTML = handoffHtml(project);
    if (ui.tab === 'share') {
      panel.innerHTML = shareHtml(project);
      drawShareCard(project);
      shareUrlFor(project).then(function (url) {
        ui.shareUrl = url;
        const field = document.getElementById('share-url');
        if (field) field.value = url;
        const length = document.getElementById('share-url-length');
        if (length) length.textContent = url.length.toLocaleString() + ' characters · works offline, no server';
      });
    }
  }

  function renderStudioSummary(project) {
    const score = scoreSpec(project);
    const board = boardSummary(project);
    const summary = document.getElementById('studio-summary');
    const topIssues = score.issues.slice(0, 3);
    summary.innerHTML =
      '<div class="studio-card score-card">' +
        '<div class="score-head">' +
          '<span class="score-ring-wrap">' + scoreRing(score.score, 96, score.grade) +
            '<span class="score-number"><b>' + score.score + '</b><small>/100</small></span></span>' +
          '<div><span class="studio-kicker">Spec score</span><h3>Grade ' + score.grade + '</h3>' +
          '<p>' + (score.strengths.length ? esc(score.strengths.join(' · ')) : 'Tighten the brief to raise it.') + '</p></div>' +
        '</div>' +
        '<div class="score-parts">' +
          score.parts.map(function (part) {
            return '<div class="score-part"><span>' + part.label + '</span><span class="score-bar"><i style="width:' + (part.value * 4) + '%"></i></span><b>' + part.value + '</b></div>';
          }).join('') +
        '</div>' +
        (topIssues.length
          ? '<ul class="score-issues">' + topIssues.map(function (issue, index) {
              return '<li><span class="issue-area">' + esc(issue.area) + '</span><span class="issue-text">' + esc(issue.message) + ' — <em>' + esc(issue.fix) + '</em></span>' +
                '<button type="button" class="btn btn-text btn-sm" data-studio="fix" data-issue="' + index + '">Fix</button></li>';
            }).join('') + '</ul>' +
            (score.issues.length > 3 ? '<button type="button" class="btn btn-text btn-sm score-more" data-studio="all-issues">+' + (score.issues.length - 3) + ' more suggestions</button>' : '')
          : '<p class="score-clean">No suggestions — this brief is ready to hand to a builder.</p>') +
      '</div>' +
      '<div class="studio-card estimate-card">' +
        '<span class="studio-kicker">Build estimate</span>' +
        '<div class="estimate-big"><b>' + board.total + '</b> tasks <span>· ' + formatHours(board.hoursTotal) + '</span></div>' +
        '<div class="estimate-progress"><i style="width:' + board.percent + '%"></i></div>' +
        '<p class="estimate-line">' + board.done + ' done · ' + formatHours(board.hoursLeft) + ' left (rough, single developer)</p>' +
        (board.next
          ? '<div class="estimate-next"><span class="studio-kicker">Next up</span><b>' + esc(board.next.id) + '</b> ' + esc(board.next.title) +
            '<button type="button" class="btn btn-secondary btn-sm" data-studio="start-next">' + (board.next.status === 'doing' ? 'Mark done' : 'Start') + '</button></div>'
          : '<div class="estimate-next done"><b>All tasks done.</b> Run the verification gates.</div>') +
      '</div>' +
      '<div class="studio-card quick-card">' +
        '<span class="studio-kicker">Hand off in one click</span>' +
        '<button type="button" class="handoff-quick" data-handoff="lovable"><span class="tool-mark lovable">L</span>Build in Lovable<span class="arrow">↗</span></button>' +
        '<button type="button" class="handoff-quick" data-handoff="v0"><span class="tool-mark v0">v0</span>Open in v0<span class="arrow">↗</span></button>' +
        '<button type="button" class="handoff-quick" data-handoff="bolt"><span class="tool-mark bolt">B</span>Copy prompt · open Bolt<span class="arrow">↗</span></button>' +
        '<button type="button" class="handoff-quick" data-studio="pack"><span class="tool-mark pack">.zip</span>Spec pack for Cursor / Claude Code</button>' +
      '</div>';
  }

  function boardHtml(project) {
    const board = boardSummary(project);
    const columns = [
      { key: 'todo', label: 'To do' },
      { key: 'doing', label: 'Doing' },
      { key: 'done', label: 'Done' }
    ];
    const demoNote = isDemo(project)
      ? '<p class="studio-note">This is the demo — moves are not saved. <button type="button" class="btn btn-text btn-sm" data-studio="copy-demo">Copy to my projects</button></p>'
      : '';
    return demoNote + '<div class="board" id="studio-board">' + columns.map(function (column) {
      const tasks = board.tasks.filter(function (task) { return task.status === column.key; });
      const hours = tasks.reduce(function (sum, task) { return sum + task.hours; }, 0);
      return '<div class="board-col" data-col="' + column.key + '">' +
        '<div class="board-col-head"><span>' + column.label + '</span><span class="board-count">' + tasks.length + ' · ' + formatHours(hours) + '</span></div>' +
        '<div class="board-cards">' +
          (tasks.length ? tasks.map(function (task) { return taskCardHtml(task, board); }).join('') : '<div class="board-empty">Drop tasks here</div>') +
        '</div></div>';
    }).join('') + '</div>' +
    '<p class="studio-foot">Drag cards between columns, or use the arrows. Tasks unlock when the tasks they depend on are done.</p>';
  }

  function taskCardHtml(task, board) {
    const dots = '<span class="cx" title="Complexity ' + task.complexity + ' of 5">' +
      [1, 2, 3, 4, 5].map(function (n) { return '<i class="' + (n <= task.complexity ? 'on' : '') + '"></i>'; }).join('') + '</span>';
    const isNext = board.next && board.next.id === task.id;
    const deps = task.deps.length
      ? '<span class="task-deps" title="Depends on">after ' + task.deps.map(function (dep) {
          const depTask = board.byId[dep];
          return '<b class="' + (depTask && depTask.status === 'done' ? 'met' : '') + '">' + dep + '</b>';
        }).join(' ') + '</span>'
      : '';
    return '<article class="task-card' + (task.blocked ? ' is-blocked' : '') + (isNext ? ' is-next' : '') + (task.status === 'done' ? ' is-done' : '') + '" draggable="true" data-task="' + task.key + '">' +
      '<div class="task-top"><span class="task-id">' + task.id + '</span>' +
        '<span class="task-phase">' + task.phase + '</span>' +
        (task.parallel ? '<span class="task-p" title="Can run in parallel">P</span>' : '') +
        (isNext ? '<span class="task-flag">Next</span>' : '') +
        (task.blocked ? '<span class="task-flag blocked">Blocked</span>' : '') +
      '</div>' +
      '<p class="task-title">' + esc(task.title) + '</p>' +
      '<div class="task-foot">' + dots + '<span class="task-hours">~' + task.hours + ' h</span>' + deps + '</div>' +
      '<div class="task-move">' +
        (task.status !== 'todo' ? '<button type="button" data-move="back" aria-label="Move ' + task.id + ' back">←</button>' : '') +
        (task.status !== 'done' ? '<button type="button" data-move="forward" aria-label="Move ' + task.id + ' forward">→</button>' : '') +
      '</div>' +
    '</article>';
  }

  const SPEC_FILE_ORDER = ['specs/requirements.md', 'specs/design.md', 'specs/tasks.md', 'AGENTS.md', 'CLAUDE.md', '.cursor/rules/sweep.mdc', 'PROMPT.md'];

  function specHtml(project) {
    const files = specFiles(project);
    if (!files[ui.specFile]) ui.specFile = SPEC_FILE_ORDER[0];
    const content = files[ui.specFile];
    const isMarkdown = /\.md$/.test(ui.specFile);
    const body = ui.specMode === 'preview' && isMarkdown
      ? '<div class="md-body">' + renderMarkdown(content, project) + '</div>'
      : '<pre class="md-raw"><code>' + esc(content) + '</code></pre>';
    return '<div class="spec-layout">' +
      '<nav class="spec-files" aria-label="Spec files">' +
        SPEC_FILE_ORDER.map(function (name) {
          const lines = files[name].split('\n').length;
          return '<button type="button" class="spec-file' + (name === ui.specFile ? ' active' : '') + '" data-spec-file="' + name + '">' +
            '<span class="spec-file-name">' + esc(name) + '</span><span class="spec-file-meta">' + lines + ' lines</span></button>';
        }).join('') +
        '<p class="spec-compat">Compatible with Kiro and GitHub Spec Kit layouts (requirements → design → tasks).</p>' +
      '</nav>' +
      '<div class="spec-viewer">' +
        '<div class="spec-toolbar">' +
          '<span class="spec-path">' + esc(ui.specFile) + '</span>' +
          '<div class="spec-tools">' +
            (isMarkdown
              ? '<div class="seg"><button type="button" data-spec-mode="preview" class="' + (ui.specMode === 'preview' ? 'active' : '') + '">Preview</button>' +
                '<button type="button" data-spec-mode="raw" class="' + (ui.specMode === 'raw' ? 'active' : '') + '">Markdown</button></div>'
              : '') +
            '<button type="button" class="btn btn-secondary btn-sm" data-studio="copy-spec">Copy</button>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-studio="download-spec">Download</button>' +
          '</div>' +
        '</div>' +
        body +
      '</div>' +
    '</div>';
  }

  const HANDOFF_TOOLS = [
    { id: 'lovable', mark: 'L', name: 'Lovable', blurb: 'Opens Lovable with your full plan as the first prompt.', action: 'Build in Lovable ↗' },
    { id: 'v0', mark: 'v0', name: 'v0 by Vercel', blurb: 'Opens a v0 chat pre-filled with a React + shadcn prompt.', action: 'Open in v0 ↗' },
    { id: 'bolt', mark: 'B', name: 'Bolt.new', blurb: 'Copies the prompt and opens Bolt — paste and go.', action: 'Copy & open Bolt ↗' },
    { id: 'cursor', mark: 'C', name: 'Cursor', blurb: 'Project rule with the product, Definition of Done and non-goals.', action: 'Download sweep.mdc' },
    { id: 'claude', mark: 'CC', name: 'Claude Code', blurb: 'CLAUDE.md memory file — drop it in the repo root.', action: 'Download CLAUDE.md' },
    { id: 'agents', mark: 'A', name: 'Any agent', blurb: 'AGENTS.md for Codex, Copilot, Jules, Windsurf and others.', action: 'Download AGENTS.md' }
  ];

  function currentPrompt(project) {
    const draft = ui.promptDrafts[project.id];
    return draft != null ? draft : builderPrompt(project, 'generic');
  }

  function handoffHtml(project) {
    const prompt = currentPrompt(project);
    return '<div class="handoff-grid">' +
      HANDOFF_TOOLS.map(function (tool) {
        return '<article class="handoff-card">' +
          '<span class="tool-mark ' + tool.id + '">' + tool.mark + '</span>' +
          '<div><h4>' + tool.name + '</h4><p>' + tool.blurb + '</p></div>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-handoff="' + tool.id + '">' + tool.action + '</button>' +
        '</article>';
      }).join('') +
    '</div>' +
    '<div class="prompt-editor">' +
      '<div class="prompt-head"><div><span class="studio-kicker">Builder prompt</span><h4>Edit before you send</h4></div>' +
        '<div class="prompt-tools"><span class="prompt-count" id="prompt-count">' + prompt.length.toLocaleString() + ' chars</span>' +
        '<button type="button" class="btn btn-text btn-sm" data-studio="reset-prompt">Reset</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-studio="copy-prompt">Copy</button></div></div>' +
      '<textarea id="handoff-prompt" spellcheck="false" rows="14">' + esc(prompt) + '</textarea>' +
      '<p class="studio-foot">Lovable and v0 open in a new tab with this prompt. Nothing is sent until you press send there.</p>' +
    '</div>';
  }

  function handoff(project, toolId) {
    if (!project) return;
    const prompt = toolId === 'v0' && ui.promptDrafts[project.id] == null ? builderPrompt(project, 'v0') : currentPrompt(project);
    if (toolId === 'lovable') {
      openExternal('https://lovable.dev/?autosubmit=true#prompt=' + encodeURIComponent(prompt.slice(0, 50000)));
      showToast('Opening Lovable with your plan…');
    } else if (toolId === 'v0') {
      openExternal('https://v0.app/chat?q=' + encodeURIComponent(prompt.slice(0, 6000)));
      showToast('Opening v0 with your plan…');
    } else if (toolId === 'bolt') {
      copyText(prompt, 'Prompt copied — paste it into Bolt');
      openExternal('https://bolt.new/');
    } else if (toolId === 'cursor') {
      downloadText('sweep.mdc', cursorRule(project));
      showToast('Saved sweep.mdc — put it in .cursor/rules/');
    } else if (toolId === 'claude') {
      downloadText('CLAUDE.md', claudeMarkdown(project));
      showToast('Saved CLAUDE.md — put it in your repo root');
    } else if (toolId === 'agents') {
      downloadText('AGENTS.md', agentsMarkdown(project));
      showToast('Saved AGENTS.md — put it in your repo root');
    }
  }

  function shareHtml(project) {
    const badge = '[![Planned with Sweep](' + APP_URL + 'badge.svg)](' + APP_URL + ')';
    return '<div class="share-layout">' +
      '<div class="share-card-wrap">' +
        '<canvas id="share-canvas" width="1200" height="630" aria-label="Share card preview"></canvas>' +
        '<div class="share-card-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-studio="download-card">Download PNG</button>' +
          (navigator.share ? '<button type="button" class="btn btn-secondary btn-sm" data-studio="native-share">Share…</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="share-side">' +
        '<div class="studio-card">' +
          '<span class="studio-kicker">Remix link</span>' +
          '<h4>Anyone with the link can open and remix this plan</h4>' +
          '<div class="share-url-row"><input id="share-url" readonly value="Building link…" aria-label="Share link">' +
          '<button type="button" class="btn btn-primary btn-sm" data-studio="copy-link">Copy</button></div>' +
          '<p class="studio-foot" id="share-url-length">The whole brief lives inside the link.</p>' +
          '<p class="studio-foot">Includes the brief only — never your progress, notes or Operator data.</p>' +
        '</div>' +
        '<div class="studio-card">' +
          '<span class="studio-kicker">README badge</span>' +
          '<h4>Show where the plan came from</h4>' +
          '<img class="badge-preview" src="badge.svg" alt="Planned with Sweep badge" width="168" height="28">' +
          '<pre class="md-raw small"><code id="badge-md">' + esc(badge) + '</code></pre>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-studio="copy-badge">Copy markdown</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function wrapLines(context, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const test = line ? line + ' ' + word : word;
      if (context.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (context.measureText(last + '…').width > maxWidth && last.length) last = last.slice(0, -1);
      kept[maxLines - 1] = last.replace(/\s+$/, '') + '…';
      return kept;
    }
    return lines;
  }

  function drawShareCard(project) {
    const canvas = document.getElementById('share-canvas');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const accent = cssVar('--color-accent', '#8b1a1a');
    const ok = cssVar('--color-productive', '#1a7f37');
    const score = scoreSpec(project);
    const board = boardSummary(project);
    const serif = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
    const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

    const background = context.createLinearGradient(0, 0, 1200, 630);
    background.addColorStop(0, '#fbf8f2');
    background.addColorStop(1, '#efe6d7');
    context.fillStyle = background;
    context.fillRect(0, 0, 1200, 630);
    context.fillStyle = accent;
    context.fillRect(0, 0, 14, 630);

    context.fillStyle = accent;
    roundRect(context, 70, 58, 44, 44, 11);
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 3.4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(82, 90);
    context.lineTo(102, 70);
    context.stroke();
    context.fillStyle = accent;
    context.font = '700 24px ' + serif;
    context.fillText('S W E E P', 128, 88);
    context.fillStyle = '#7a746a';
    context.font = '600 15px ' + sans;
    context.fillText('PLANNED WITH SWEEP', 900, 88);

    context.fillStyle = '#1a1a1a';
    context.font = '700 68px ' + serif;
    const titleLines = wrapLines(context, project.name, 700, 2);
    titleLines.forEach(function (line, index) {
      context.fillText(line, 70, 200 + index * 76);
    });
    const afterTitle = 200 + titleLines.length * 76;
    context.fillStyle = '#4d4943';
    context.font = 'italic 30px ' + serif;
    wrapLines(context, project.oneLiner, 700, 3).forEach(function (line, index) {
      context.fillText(line, 70, afterTitle + 6 + index * 40);
    });

    // Spec score ring.
    const cx = 990;
    const cy = 268;
    context.lineWidth = 18;
    context.strokeStyle = 'rgba(0,0,0,0.08)';
    context.beginPath();
    context.arc(cx, cy, 108, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = score.score >= 75 ? ok : accent;
    context.beginPath();
    context.arc(cx, cy, 108, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (score.score / 100));
    context.stroke();
    context.fillStyle = '#1a1a1a';
    context.textAlign = 'center';
    context.font = '700 64px ' + serif;
    context.fillText(String(score.score), cx, cy + 14);
    context.fillStyle = '#7a746a';
    context.font = '600 16px ' + sans;
    context.fillText('SPEC SCORE · ' + score.grade, cx, cy + 46);
    context.textAlign = 'left';

    // Stat chips.
    const stats = [
      (project.successChecks || []).length + ' success checks',
      board.total + ' tasks · ' + formatHours(board.hoursTotal),
      board.percent + '% built'
    ];
    let x = 70;
    context.font = '600 21px ' + sans;
    stats.forEach(function (label) {
      const width = context.measureText(label).width + 40;
      context.fillStyle = '#ffffff';
      roundRect(context, x, 478, width, 50, 25);
      context.fill();
      context.strokeStyle = 'rgba(0,0,0,0.08)';
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = '#1a1a1a';
      context.fillText(label, x + 20, 510);
      x += width + 14;
    });

    context.fillStyle = '#7a746a';
    context.font = '500 18px ' + sans;
    context.fillText('Free, offline idea → spec → build plan  ·  juwpegatron.github.io/projects/sweep', 70, 586);
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  // ---------- studio interactions ----------

  function moveTask(project, key, direction) {
    const order = ['todo', 'doing', 'done'];
    const board = boardState(project);
    const current = board[key] || 'todo';
    let index = order.indexOf(current) + (direction === 'forward' ? 1 : -1);
    index = Math.max(0, Math.min(order.length - 1, index));
    setTaskStatus(project, key, order[index]);
  }

  function setTaskStatus(project, key, status) {
    const board = boardState(project);
    const before = boardSummary(project);
    const moving = before.tasks.find(function (task) { return task.key === key; });
    if (moving && moving.blocked && status !== 'todo') {
      const open = moving.deps.filter(function (dep) {
        return before.byId[dep] && before.byId[dep].status !== 'done';
      });
      showToast('Heads-up: ' + moving.id + ' depends on ' + open.join(', ') + ', which ' + (open.length === 1 ? 'is' : 'are') + ' not done yet');
    }
    if (status === 'todo') {
      delete board[key];
    } else {
      board[key] = status;
    }
    persist(project);
    const after = boardSummary(project);
    renderStudio(project);
    if (status === 'done') {
      const card = document.querySelector('.task-card[data-task="' + key + '"]');
      burst(card);
      if (after.done === after.total && before.done !== before.total) {
        showToast('Every task is done — time to run the verification gates');
      }
    }
  }

  function burst(anchor) {
    if (!anchor || prefersReducedMotion()) return;
    anchor.classList.add('just-done');
    setTimeout(function () { anchor.classList.remove('just-done'); }, 700);
  }

  function attachBoardDrag(section) {
    let draggingKey = null;
    section.addEventListener('dragstart', function (event) {
      const card = event.target.closest && event.target.closest('.task-card');
      if (!card) return;
      draggingKey = card.getAttribute('data-task');
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingKey);
    });
    section.addEventListener('dragend', function (event) {
      const card = event.target.closest && event.target.closest('.task-card');
      if (card) card.classList.remove('is-dragging');
      $all('.board-col.is-over', section).forEach(function (col) { col.classList.remove('is-over'); });
      draggingKey = null;
    });
    section.addEventListener('dragover', function (event) {
      const column = event.target.closest && event.target.closest('.board-col');
      if (!column || !draggingKey) return;
      event.preventDefault();
      $all('.board-col.is-over', section).forEach(function (col) {
        if (col !== column) col.classList.remove('is-over');
      });
      column.classList.add('is-over');
    });
    section.addEventListener('drop', function (event) {
      const column = event.target.closest && event.target.closest('.board-col');
      if (!column || !draggingKey || !state.currentProject) return;
      event.preventDefault();
      setTaskStatus(state.currentProject, draggingKey, column.getAttribute('data-col'));
    });
  }

  function onStudioClick(event) {
    const project = state.currentProject;
    if (!project) return;
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      ui.tab = tab.getAttribute('data-tab');
      renderStudio(project);
      return;
    }
    const move = event.target.closest('[data-move]');
    if (move) {
      const card = move.closest('.task-card');
      moveTask(project, card.getAttribute('data-task'), move.getAttribute('data-move'));
      return;
    }
    const specFile = event.target.closest('[data-spec-file]');
    if (specFile) {
      ui.specFile = specFile.getAttribute('data-spec-file');
      ui.specMode = /\.md$/.test(ui.specFile) ? ui.specMode : 'raw';
      renderStudio(project);
      return;
    }
    const specMode = event.target.closest('[data-spec-mode]');
    if (specMode) {
      ui.specMode = specMode.getAttribute('data-spec-mode');
      renderStudio(project);
      return;
    }
    const tool = event.target.closest('[data-handoff]');
    if (tool) {
      handoff(project, tool.getAttribute('data-handoff'));
      return;
    }
    const action = event.target.closest('[data-studio]');
    if (!action) return;
    const name = action.getAttribute('data-studio');
    if (name === 'back') navigateTo('plan');
    if (name === 'pack') downloadSpecPack(project);
    if (name === 'share') {
      ui.tab = 'share';
      renderStudio(project);
    }
    if (name === 'fix') fixIssue(project, scoreSpec(project).issues[Number(action.getAttribute('data-issue'))]);
    if (name === 'all-issues') showAllIssues(project);
    if (name === 'start-next') {
      const next = boardSummary(project).next;
      if (next) setTaskStatus(project, next.key, next.status === 'doing' ? 'done' : 'doing');
    }
    if (name === 'copy-demo') {
      const copy = window.SweepEnhance.duplicateProject(project, { name: project.name, quiet: true });
      openProject(copy.id);
      navigateTo('studio');
      showToast('Demo copied to your projects');
    }
    if (name === 'copy-spec') copyText(specFiles(project)[ui.specFile], 'Copied ' + ui.specFile);
    if (name === 'download-spec') downloadText(ui.specFile.split('/').pop(), specFiles(project)[ui.specFile]);
    if (name === 'copy-prompt') copyText(currentPrompt(project), 'Prompt copied');
    if (name === 'reset-prompt') {
      delete ui.promptDrafts[project.id];
      renderStudio(project);
    }
    if (name === 'copy-link') copyText(ui.shareUrl || '', 'Remix link copied');
    if (name === 'copy-badge') copyText(document.getElementById('badge-md').textContent, 'Badge markdown copied');
    if (name === 'download-card') {
      const canvas = document.getElementById('share-canvas');
      canvas.toBlob(function (blob) {
        if (blob) downloadBlob(toKebabCase(project.name) + '-sweep-card.png', blob);
      }, 'image/png');
    }
    if (name === 'native-share') nativeShare(project);
  }

  function nativeShare(project) {
    const canvas = document.getElementById('share-canvas');
    const text = project.name + ' — ' + (project.oneLiner || '') + ' (planned with Sweep)';
    canvas.toBlob(function (blob) {
      const data = { title: project.name, text: text, url: ui.shareUrl };
      if (blob && window.File && navigator.canShare) {
        const file = new File([blob], toKebabCase(project.name) + '-sweep-card.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) data.files = [file];
      }
      navigator.share(data).catch(function () { /* user cancelled */ });
    }, 'image/png');
  }

  function fixIssue(project, issue) {
    if (!issue) return;
    let target = project;
    if (isDemo(project)) {
      target = window.SweepEnhance.duplicateProject(project, { name: project.name, quiet: true });
      showToast('Demo copied to your projects — editing your copy');
    }
    window.startEditProject(target.id);
    setTimeout(function () {
      let field = document.getElementById(issue.field);
      if (issue.field === 'success-checks-container') {
        const inputs = $all('.success-check-input');
        field = inputs.find(function (input) { return !OBSERVABLE.test(input.value); }) || inputs[inputs.length - 1];
      }
      if (field) {
        field.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        field.focus();
        field.classList.add('studio-focus');
        setTimeout(function () { field.classList.remove('studio-focus'); }, 1800);
      }
      showToast('Tip: ' + issue.fix);
    }, 320);
  }

  function showAllIssues(project) {
    const list = document.querySelector('#studio-summary .score-issues');
    if (!list) return;
    const issues = scoreSpec(project).issues;
    list.innerHTML = issues.map(function (issue, index) {
      return '<li><span class="issue-area">' + esc(issue.area) + '</span><span class="issue-text">' + esc(issue.message) + ' — <em>' + esc(issue.fix) + '</em></span>' +
        '<button type="button" class="btn btn-text btn-sm" data-studio="fix" data-issue="' + index + '">Fix</button></li>';
    }).join('');
    const more = document.querySelector('#studio-summary .score-more');
    if (more) more.remove();
  }

  // ---------- shared-link viewer ----------

  function closeSharedModal() {
    const modal = document.getElementById('shared-modal');
    if (modal) modal.remove();
    document.body.classList.remove('studio-modal-open');
  }

  function remixShared(brief) {
    closeSharedModal();
    if (inApp()) {
      createProjectFromBrief(brief, 'Remixed “' + brief.name + '” into your workspace');
    } else {
      try {
        sessionStorage.setItem(PENDING_REMIX_KEY, JSON.stringify(brief));
      } catch (error) {
        /* storage unavailable — remix is lost, but nothing breaks */
      }
      showToast('Continue as guest or open a workspace — your remix will be waiting');
    }
  }

  function showSharedModal(brief) {
    closeSharedModal();
    const score = scoreSpec(brief);
    const taskCount = buildTasks(Object.assign({ capabilityMatrix: generateCapabilityMatrix(brief) }, brief)).length;
    const modal = document.createElement('div');
    modal.id = 'shared-modal';
    modal.className = 'studio-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'shared-title');
    modal.innerHTML =
      '<div class="studio-modal-card">' +
        '<button type="button" class="studio-modal-close" aria-label="Close" data-shared="close">×</button>' +
        '<span class="studio-kicker">Shared plan</span>' +
        '<div class="shared-head">' +
          '<div><h2 id="shared-title">' + esc(brief.name) + '</h2><p class="shared-liner">' + esc(brief.oneLiner) + '</p></div>' +
          '<span class="score-ring-wrap small">' + scoreRing(score.score, 76, score.grade) + '<span class="score-number"><b>' + score.score + '</b><small>' + score.grade + '</small></span></span>' +
        '</div>' +
        '<dl class="shared-facts">' +
          '<div><dt>For</dt><dd>' + esc(brief.targetUser || '—') + '</dd></div>' +
          '<div><dt>Problem</dt><dd>' + esc(brief.problem || '—') + '</dd></div>' +
          '<div><dt>Job</dt><dd>' + esc(brief.jtbd || '—') + '</dd></div>' +
        '</dl>' +
        '<h3>Definition of Done</h3>' +
        '<ul class="shared-checks">' + brief.successChecks.map(function (check) { return '<li>' + esc(check) + '</li>'; }).join('') + '</ul>' +
        (brief.nonGoals ? '<p class="shared-nongoals"><b>Not in v1:</b> ' + esc(brief.nonGoals) + '</p>' : '') +
        '<div class="shared-actions">' +
          '<button type="button" class="btn btn-primary" data-shared="remix">Remix into my workspace</button>' +
          '<button type="button" class="btn btn-secondary" data-shared="close">Just looking</button>' +
        '</div>' +
        '<p class="studio-foot">Remixing gives you ' + taskCount + ' tasks, Kiro-style specs and one-click handoff to Lovable, v0 or Cursor. Free, offline, no sign-up.</p>' +
      '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('studio-modal-open');
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeSharedModal();
      const button = event.target.closest('[data-shared]');
      if (!button) return;
      if (button.getAttribute('data-shared') === 'remix') remixShared(brief);
      if (button.getAttribute('data-shared') === 'close') closeSharedModal();
    });
    modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeSharedModal();
    });
    const primary = modal.querySelector('[data-shared="remix"]');
    if (primary) primary.focus();
  }

  function checkShareHash() {
    if (location.hash.indexOf(SHARE_PREFIX) !== 0) return;
    const token = location.hash.slice(SHARE_PREFIX.length);
    history.replaceState(null, '', location.href.split('#')[0]);
    decodeShare(token).then(function (brief) {
      ui.sharedPayload = brief;
      showSharedModal(brief);
    }).catch(function (error) {
      showToast('Could not open that share link: ' + error.message);
    });
  }

  function consumePendingRemix() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(PENDING_REMIX_KEY);
      sessionStorage.removeItem(PENDING_REMIX_KEY);
    } catch (error) {
      return;
    }
    if (!raw) return;
    try {
      const brief = briefFromPayload(sharePayload(JSON.parse(raw)));
      setTimeout(function () {
        createProjectFromBrief(brief, 'Remixed “' + brief.name + '” into your workspace');
      }, 60);
    } catch (error) {
      /* corrupt pending remix — ignore */
    }
  }

  // ---------- hooks into the existing app ----------

  function wrapAfter(name, after) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function () {
      const result = original.apply(this, arguments);
      try {
        after.apply(this, arguments);
      } catch (error) {
        console.warn('[studio] ' + name + ' hook failed', error);
      }
      return result;
    };
  }

  const originalGenerateFiles = window.generateProjectFiles;
  if (typeof originalGenerateFiles === 'function') {
    window.generateProjectFiles = function (project) {
      const files = originalGenerateFiles.apply(this, arguments);
      try {
        Object.assign(files, specFiles(project));
      } catch (error) {
        console.warn('[studio] spec files skipped', error);
      }
      return files;
    };
  }

  wrapAfter('renderPlanView', function (project) {
    ensurePlanStudio(project);
  });

  wrapAfter('navigateTo', function (section) {
    const studioLink = document.getElementById('nav-studio');
    if (studioLink) studioLink.classList.toggle('active', section === 'studio');
    if (section === 'studio') {
      if (!state.currentProject) {
        navigateTo('catalog');
        return;
      }
      renderStudio(state.currentProject);
    }
    if (section === 'catalog') ensureTemplateGallery();
  });

  wrapAfter('updateNavForProject', function (project) {
    const link = document.getElementById('nav-studio');
    if (link) link.style.display = project && !isDemo(project) ? 'inline-flex' : 'none';
  });

  wrapAfter('enterApp', function () {
    ensureTemplateGallery();
    consumePendingRemix();
  });

  wrapAfter('signOut', closeSharedModal);

  window.addEventListener('hashchange', checkShareHash);

  // ---------- boot ----------

  ensureStudioSection();
  ensureTemplateGallery();
  if (state.currentProject) {
    const planSection = document.getElementById('section-plan');
    if (planSection && planSection.classList.contains('active')) ensurePlanStudio(state.currentProject);
  }
  checkShareHash();

  window.SweepStudio = {
    scoreSpec: scoreSpec,
    buildTasks: buildTasks,
    boardSummary: boardSummary,
    specFiles: specFiles,
    builderPrompt: builderPrompt,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    templates: TEMPLATES,
    open: function (tab) {
      if (tab && STUDIO_TABS.indexOf(tab) !== -1) ui.tab = tab;
      navigateTo('studio');
    },
    paletteCommands: function () {
      const commands = [];
      const current = state.currentProject;
      if (current) {
        commands.push({ group: 'Go to', label: 'Studio · ' + current.name, hint: 'Board, spec, handoff', run: function () { window.SweepStudio.open('board'); } });
        commands.push({ group: 'Actions', label: 'Download spec pack (.zip) · ' + current.name, hint: '', run: function () { downloadSpecPack(current); } });
        commands.push({ group: 'Actions', label: 'Build in Lovable · ' + current.name, hint: '↗', run: function () { handoff(current, 'lovable'); } });
        commands.push({ group: 'Actions', label: 'Open in v0 · ' + current.name, hint: '↗', run: function () { handoff(current, 'v0'); } });
        commands.push({ group: 'Actions', label: 'Share / remix link · ' + current.name, hint: '', run: function () { window.SweepStudio.open('share'); } });
      }
      TEMPLATES.forEach(function (template) {
        commands.push({
          group: 'Templates',
          label: 'Remix template · ' + template.name,
          hint: template.tag,
          run: function () {
            const brief = Object.assign({}, template);
            delete brief.tag;
            createProjectFromBrief(brief, 'Remixed “' + template.name + '”');
          }
        });
      });
      return commands;
    }
  };
})();
