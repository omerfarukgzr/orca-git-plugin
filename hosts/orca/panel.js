/* The page of an Orca panel (hosts/orca/panels/*.html; hosts/orca/README.md).
   <script src="../ui-files.js"></script><script src="../panel.js" data-view="commit|log|branches|" data-ui="../../../ui/">
   1. adds ui/index.html's stylesheets and scripts (hosts/orca/ui-files.js, generated from it) with ui/host/orca.js in
      place of the standalone host, in order, git/boot.js held back;
   2. connects to the worker and asks it for the focused workspace (a local folder, or why there is none);
   3. starts the UI the way ui/index.html?view=…&repo=… does, then follows Orca's `workspace.changed`.
   No repository (nothing focused, a remote workspace, no match) is the picker page with a message saying why;
   a folder that is not a repository is the picker's own "Not a Git repository" state. Another path is never tried. */
(function () {
  'use strict';
  // The product name a user reads under Orca and the prefix of the panels' localStorage keys (hosts/orca/README.md
  // "Identity"; the worker's are in product.mjs). Handed to the UI before it loads (ui/host/product.js lists the fields).
  const PRODUCT = 'Hay Git';
  const STORAGE_PREFIX = 'git-panel:';
  // where a problem report goes: the new-issue page of the plugin's public repository (orca-plugin.json `repository`)
  const ISSUES = 'https://github.com/omerfarukgzr/orca-git-plugin/issues/new';
  // (ui/git/report.js fills that page from `title` and `body`: how the link is spelled and how long it may be is there)
  const pre = (window.Git = window.Git || {});
  pre.host = Object.assign(pre.host || {}, { product: PRODUCT, storagePrefix: STORAGE_PREFIX });
  const me = document.currentScript;
  // `editor`: the custom editor frame (panels/editor.html); its document says which view it is (see start())
  let view = (me && me.dataset.view) || '';
  const editor = view === 'editor';
  if (editor) view = '';
  const ui = (me && me.dataset.ui) || '../../../ui/';
  // This folder, named from the UI folder. Not from `me.src`: in the running Orca (1.4.255) a frame's script `src`
  // reads as a path from the plugin root ("hosts/orca/panel.js"), which does not resolve from the page.
  const here = '../hosts/orca/';
  const files = window.OrcaPanelFiles;
  const app = document.getElementById('app');
  const say = (text) => { if (app) { app.textContent = text; app.className = 'orca-note'; } };
  if (!files) { say(PRODUCT + ': hosts/orca/ui-files.js is missing'); return; }
  if (document.body) document.body.classList.add('g-root');

  // Orca's frame refuses part of a big burst of file requests (seen in the real app: one of ~80 scripts fired `error`
  // while the same URL answered 200 a moment later). So an assembled plugin (tools/orca-paket.mjs) carries one
  // stylesheet and one script (`files.bundle`); without a bundle the files are asked for one after another. A load that
  // fails is tried again before it counts.
  const bundle = files.bundle || null;
  // The host's own look (hosts/orca/look/): Orca's interface font (Geist) and its explorer's file icons, which Orca
  // gives plugins no API for. The icons' script comes before the UI so Git.host.fileIcon is the host's.
  const LOOK = { css: here + 'look/look.css', scripts: [here + 'look/file-icons-data.js', here + 'look/file-icons.js'] };
  (bundle ? [bundle.css] : files.css).concat(LOOK.css).forEach((href) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = ui + href;
    document.head.appendChild(l);
  });
  const once = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = /^[a-z]+:/i.test(src) ? src : ui + src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('cannot load ' + src)); };
    document.body.appendChild(s);
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const load = (src) => once(src).catch(() => wait(150).then(() => once(src))).catch(() => wait(600).then(() => once(src)));
  const scripts = LOOK.scripts.concat(bundle ? [bundle.js] : ['host/orca.js'].concat(files.scripts.filter((s) => s !== 'git/boot.js')));
  // A script that still does not load: say what Orca answers for it (a changed file, a limit), so the message is
  // useful without DevTools.
  const why = (src) => fetch(ui + src).then((r) => r.text().then((t) => ' [' + r.status + ' ' + r.statusText + '] ' + t.slice(0, 200)), (e) => ' [' + (e && e.message) + ']');
  scripts.reduce((p, src) => p.then(() => load(src)), Promise.resolve()).then(start, (e) => {
    say(PRODUCT + ': ' + e.message);
    const m = /^cannot load (.+)$/.exec(e.message);
    if (m) why(m[1]).then((t) => say(PRODUCT + ': ' + e.message + t));
  });

  /** The editor frame's document: the diff marker ({"view":"diff"}) → 'diff'; empty or anything else → 'git'. */
  function documentKind() {
    let doc = null;
    try { doc = window.orca && window.orca.document; } catch (e) { doc = null; }
    if (!doc || typeof doc.get !== 'function') return Promise.resolve('git');
    const read = Promise.resolve().then(() => doc.get()).then((d) => {
      const text = d && d.content && typeof d.content.text === 'string' ? d.content.text.trim() : '';
      if (!text) return 'git';
      try { const v = JSON.parse(text); return v && v.view === 'diff' ? 'diff' : 'git'; } catch (e) { return 'git'; }
    }, () => 'git');
    return Promise.race([read, new Promise((r) => setTimeout(() => r('git'), 4000))]);
  }

  const MARK = 'orca:no-repository';
  let search = null;                      // the query the UI must see when the frame refuses to change its URL

  function setQuery(repo) {
    const q = new URLSearchParams();
    if (view) q.set('view', view);
    q.set('repo', repo);
    const want = '?' + q.toString();
    try { history.replaceState(history.state, '', location.pathname + want); } catch (e) { /* Orca's frame may refuse */ }
    if (location.search === want) { search = null; return; }
    if (search === null && !window.URLSearchParams.__gitPanel) {
      // workbench.js reads view and repo with `new URLSearchParams(location.search)`; answer with ours.
      const Real = window.URLSearchParams;
      const Params = class extends Real { constructor(init) { super(search !== null && init === location.search ? search : init); } };
      Params.__gitPanel = true;
      window.URLSearchParams = Params;
    }
    search = want;
  }

  async function start() {
    const Git = window.Git;
    Git.host.product = PRODUCT;
    if (editor) view = (await documentKind()) === 'diff' ? 'tab' : '';
    Git.addTR({
      'No workspace is focused in Orca.': 'Orca\'da odaklanmış bir çalışma alanı yok.',
      'The workspace {0} is on another host ({1}). {2} opens local repositories only.': '{0} çalışma alanı başka bir makinede ({1}). {2} yalnız yerel depoları açar.',
      'Orca does not list the folder of the workspace {0}.': '{0} çalışma alanının klasörü Orca\'nın listesinde yok.',
      'Several workspaces are called {0}; {1} cannot tell which folder is meant.': 'Birden çok çalışma alanının adı {0}; hangi klasör olduğu anlaşılamıyor.',
      'Orca did not tell which workspace is focused ({0}).': 'Orca odaklanmış çalışma alanını söylemedi ({0}).',
      'Cannot reach the {0} worker of Orca.': 'Orca\'daki {0} işçisine ulaşılamıyor.',
      'Which project are you in?': 'Hangi projedesin?',
      'Orca has {1} workspaces called "{0}" and does not tell plugins which one is open. Pick the project you are working in now. It is remembered; the project name at the top of the panel changes it.':
        'Orca\'da adı "{0}" olan {1} çalışma alanı var ve Orca, hangisinin açık olduğunu eklentilere bildirmiyor. Şu an çalıştığın projeyi seç. Seçimin hatırlanır; panelin üstündeki proje adına tıklayıp değiştirebilirsin.',
      'Shown project. Click to pick another one.': 'Gösterilen proje. Başkasını seçmek için tıkla.',
      '{0} opened': '{0} açıldı',
      'Orca has {1} workspaces called {0} and does not tell which one is focused. The one picked last time was opened.':
        'Orca\'da adı {0} olan {1} çalışma alanı var ve Orca hangisinin açık olduğunu söylemiyor. Geçen sefer seçilen açıldı.',
      'Change…': 'Değiştir…',
      'Orca asks first: choose Open.': 'Önce Orca sorar: Open\'ı seç.',
      'In Orca, open Settings → Plugins, choose ⋯ → Refresh catalogs, then press Update on {0}.':
        'Orca\'da Settings → Plugins sayfasını aç, ⋯ → Refresh catalogs\'u seç, sonra {0} satırında Update\'e bas.',
    });
    Git.addZH({
      'No workspace is focused in Orca.': 'Orca 中没有聚焦的工作区。',
      'The workspace {0} is on another host ({1}). {2} opens local repositories only.': '工作区 {0} 位于另一台主机（{1}）上。{2} 仅打开本地仓库。',
      'Orca does not list the folder of the workspace {0}.': 'Orca 的列表中没有工作区 {0} 的文件夹。',
      'Several workspaces are called {0}; {1} cannot tell which folder is meant.': '有多个工作区名为 {0}；{1} 无法判断指的是哪个文件夹。',
      'Orca did not tell which workspace is focused ({0}).': 'Orca 未告知哪个工作区处于聚焦状态（{0}）。',
      'Cannot reach the {0} worker of Orca.': '无法连接到 Orca 的 {0} 工作进程。',
      'Which project are you in?': '你在哪个项目中？',
      'Orca has {1} workspaces called "{0}" and does not tell plugins which one is open. Pick the project you are working in now. It is remembered; the project name at the top of the panel changes it.':
        'Orca 中有 {1} 个名为“{0}”的工作区，且不会告诉插件当前打开的是哪一个。请选择你现在正在处理的项目。选择会被记住；点击面板顶部的项目名称可更改。',
      'Shown project. Click to pick another one.': '当前显示的项目。点击以选择其他项目。',
      '{0} opened': '已打开 {0}',
      'Orca has {1} workspaces called {0} and does not tell which one is focused. The one picked last time was opened.':
        'Orca 中有 {1} 个名为 {0} 的工作区，且不会告知哪个处于聚焦状态。已打开上次选择的工作区。',
      'Change…': '更改…',
      'Orca asks first: choose Open.': 'Orca 会先询问：请选择“打开”。',
      'In Orca, open Settings → Plugins, choose ⋯ → Refresh catalogs, then press Update on {0}.':
        '在 Orca 中打开“设置 → 插件”，选择 ⋯ → 刷新目录，然后在 {0} 一行点击“更新”。',
    });
    const t = (...a) => Git.t(...a);
    let pictures = false;
    try {
      const hello = await Git.orca.start(view);
      // the plugin's version, for the Options menu's last row (ui/git/options.js)
      if (hello && hello.about && typeof hello.about.version === 'string') Git.host.version = hello.about.version.slice(0, 40);
      // With no explicit choice, use the plugin's language that matches Orca's interface language.
      if (Git.applyLocaleDefault) { try { Git.applyLocaleDefault(window.orca && window.orca.locale); } catch (e) { /* keep default */ } }
      // the worker can put a report's screenshot on the clipboard (hosts/orca/picture.mjs: macOS)
      pictures = !!(hello && hello.about && hello.about.pictures === true);
    } catch (e) { say(t('Cannot reach the {0} worker of Orca.', PRODUCT)); return; }

    // Updates (ui/git/update.js; the worker reads the channel, hosts/orca/update.mjs): a newer release is a dot on the
    // Options button and a row in its menu; below the channel's minimum the dialog also opens by itself, once a day.
    // Nothing is ever locked. A worker that does not answer (or could not read the channel) says nothing, and nothing
    // is shown. "Update Now" asks the worker to run Orca's own `plugin update` (update.mjs updateArgs); the sentence says
    // the way by hand. "Check for Updates…" (always in the Options menu) reads the channel now.
    const readUpdate = () => Git.orca.request('update.state', {}, { retries: 0, timeoutMs: 4000 }).then((r) => r || null, () => null);
    Git.host.update = {
      steps: () => t('In Orca, open Settings → Plugins, choose ⋯ → Refresh catalogs, then press Update on {0}.', PRODUCT),
      check: readUpdate,
      // "Check for Updates…": the worker reads the channel now
      checkNow: () => Git.orca.request('update.check', {}, { retries: 0, timeoutMs: 12000 }),
      run: () => Git.orca.request('update.run', {}, { retries: 0, timeoutMs: 250000 }),
    };
    const updating = readUpdate();     // asked now, looked at before the UI starts

    // The panel asks Orca itself which workspace it belongs to: in the running app the context a panel reads carries
    // the workspace's id (the one a worker reads on its own does not), so the worker can look the folder up exactly.
    // Without that (older Orca, a refused call) the worker falls back to matching the name.
    const frameContext = () => {
      try {
        const o = window.orca;
        if (o && o.host && typeof o.host.call === 'function') {
          return Promise.resolve(o.host.call('workspace.readContext', {})).then((c) => ({ context: c === undefined ? null : c }), () => ({}));
        }
      } catch (e) { /* no host API in this frame */ }
      return Promise.resolve({});
    };
    // Report a Problem (ui/git/report.js): the worker's facts about the focus (hosts/orca/diagnostics.mjs: kinds and
    // counts, never a path or a name) with this frame's own API level, and the public repository's new-issue page,
    // which Orca opens in the browser on the person's click (it asks once before it opens that site for a plugin).
    // Without `orca.shell` (a browser client) there is no page to open: the dialog then only copies.
    const apiOf = () => { try { const a = window.orca && window.orca.api; return a && typeof a.major === 'number' ? a.major + '.' + a.minor : 'unknown'; } catch (e) { return 'unknown'; } };
    const canOpen = () => { try { return !!(window.orca && window.orca.shell && typeof window.orca.shell.openExternal === 'function'); } catch (e) { return false; } };
    Git.host.report = Object.assign({
      open: true,                                    // issues of the public repository can be read by anyone
      // Orca asks the person before a plugin opens a site for the first time (a dialog with the link's beginning): say so
      asks: () => t('Orca asks first: choose Open.'),
      diagnostics: () => frameContext().then((input) => Git.orca.request('diagnostics', input, { retries: 1, timeoutMs: 15000 }))
        .then((r) => ({ environment: r && Array.isArray(r.environment) ? r.environment : [], lines: r && Array.isArray(r.lines) ? r.lines : [], detail: (r && r.detail) || null }),
          () => ({ environment: [], lines: ['worker: no answer'], detail: null }))
        .then((d) => ({ environment: d.environment, detail: d.detail, lines: d.lines.concat('panel: host api ' + apiOf() + ', can open links ' + (canOpen() ? 'yes' : 'no')) })),
      // The link carries the whole report as the issue's text (the owner, 17 Nov 2026: an issue must bring the plugin's
      // detailed log with it, readable): the person's words, the Environment, the diagnostics and as much of the
      // detailed log as the link has room for (ui/git/report.js `github`). No issue form: a page that is filled in
      // from `title` and `body` works in every repository, and was seen to.
    }, canOpen() ? { github: ISSUES } : {},
    // A screenshot given to the dialog: a link cannot carry it and a frame may not write the clipboard, so it goes to
    // the worker in pieces (a host call takes 64 KiB) and the worker puts it on the clipboard when the page opens.
    canOpen() && pictures ? { picture: {
      async set(base64) {
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), PIECE = 36 * 1024;
        for (let at = 0, seq = 0; at < base64.length || seq === 0; at += PIECE, seq++) {
          const r = await Git.orca.request('report.picture.put', { id, seq, last: at + PIECE >= base64.length, data: base64.slice(at, at + PIECE) }, { retries: 2, timeoutMs: 20000 });
          if (!r || r.ok !== true) return false;
        }
        return true;
      },
      clear: () => Git.orca.request('report.picture.clear', {}, { retries: 1, timeoutMs: 8000 }).then(() => true, () => false),
      copy: () => Git.orca.request('report.picture.copy', {}, { retries: 0, timeoutMs: 10000 }).then((r) => !!(r && r.ok === true), () => false),
    } } : {});
    const resolve = () => frameContext().then((input) => Git.orca.request('workspace', input))
      .then((w) => w || { status: 'error', code: 'empty' }, (e) => ({ status: 'error', code: (e && e.code) || 'action_failed' }));
    const keyOf = (w) => w.status + '|' + (w.path || w.name || '') + '|' + (w.workspaceId || '');
    function why(w) {
      if (w.status === 'none') return t('No workspace is focused in Orca.');
      if (w.status === 'remote') return t('The workspace {0} is on another host ({1}). {2} opens local repositories only.', w.name, w.hostId, PRODUCT);
      if (w.status === 'unmatched') return t('Orca does not list the folder of the workspace {0}.', w.name);
      if (w.status === 'ambiguous') return t('Several workspaces are called {0}; {1} cannot tell which folder is meant.', w.name, PRODUCT);
      return t('Orca did not tell which workspace is focused ({0}).', w.code || w.status);
    }
    const folderName = (p) => String(p).replace(/\/+$/, '').split('/').pop();
    const short = (p) => String(p).replace(/^\/Users\/[^/]+\//, '~/');
    // Orca names the main worktree of every project `main` and its context carries no id: several folders can fit the
    // focused name. That is not an error, it is one question: which project. The page asks only that (picker.js
    // `ask`), and the worker remembers the answer for that name.
    function askWhich(name, cands) {
      Git.workbench.picker({ path: '', ask: {
        title: t('Which project are you in?'),
        text: t('Orca has {1} workspaces called "{0}" and does not tell plugins which one is open. Pick the project you are working in now. It is remembered; the project name at the top of the panel changes it.', name, cands.length),
        items: cands.map((c) => ({ root: c.path, name: folderName(c.path), hint: short(c.path) })),
        onPick: choose,
      } });
    }
    function noRepo(w) {
      const cands = w.status === 'ambiguous' ? w.candidates || [] : [];
      if (cands.length) { askWhich(w.name, cands); return; }
      Git.workbench.picker({ error: Git.GitError('orca_workspace', why(w), { status: w.status }), errorText: why(w), path: '' });
      const box = document.getElementById('wp-error');
      if (box) box.dataset.orca = w.status;
    }
    // The single views name the project they show; with several workspaces of one name the name is the switch.
    Git.host.repoChip = function () {
      if (!Git.repo.root) return null;
      const w = Git.orca.workspace || {}, cands = w.candidates || [];
      const many = cands.length > 1;
      return Git.h('button.wb-repo', { type: 'button', id: 'wb-repo', title: many ? t('Shown project. Click to pick another one.') : Git.repo.root,
        onclick: (e) => { if (many) Git.menu(e.currentTarget, cands.map((c) => ({ label: folderName(c.path), checked: c.path === Git.repo.root, action: () => { if (c.path !== Git.repo.root) choose(c.path); } }))); } },
      Git.icon('nodes/module'), Git.h('span.wb-repo-name', Git.repo.name || folderName(Git.repo.root)), many ? Git.icon('chevronDownSmall', 12) : null);
    };
    function choose(folder) {
      frameContext().then((input) => Git.orca.request('workspace.choose', Object.assign({ path: folder }, input)))
        .then((next) => apply(next && next.status ? next : { status: 'error', code: 'empty' }), (e) => apply({ status: 'error', code: (e && e.code) || 'action_failed' }));
    }
    // A remembered answer may be the wrong one today (the context cannot tell): say which folder was opened, once per
    // folder and panel, with the way to the other ones.
    const told = new Set();
    function tell(w) {
      const cands = w.candidates || [];
      if (!w.chosen || cands.length < 2 || told.has(w.name + '\n' + w.path)) return;
      told.add(w.name + '\n' + w.path);
      Git.notify({ kind: 'info', title: t('{0} opened', folderName(w.path)),
        text: t('Orca has {1} workspaces called {0} and does not tell which one is focused. The one picked last time was opened.', w.name, cands.length),
        actions: [{ label: t('Change…'), run: () => { key = ''; setQuery(MARK); Git.store.close(); askWhich(w.name, cands); } }] });
    }

    // Diagnostics (`orca plugin logs`): one line in the worker's log whenever this page opens or re-opens a repository:
    // "boot" or the previous workspace → the next one, and the view. Only the status and the folder name go out.
    const label = (w) => (w ? w.status + (w.path ? ':' + folderName(w.path) : w.name ? ':' + w.name : '') : 'none');
    const note = (from, to) => { try { Git.orca.request('note', { view: view || 'git', from, to }).catch(() => {}); } catch (e) { /* no worker */ } };

    let ws = await resolve();
    Git.orca.workspace = ws;
    // "boot #n": how often this view's page has booted with the same sessionStorage. It tells whether Orca keeps a
    // panel's storage when it re-creates the frame (the Log remembers its place there, ui/git/log-place.js).
    // The second number counts the same in localStorage (kept across frames when the host gives panels one origin).
    const count = (store) => {
      try {
        const k = STORAGE_PREFIX + 'boots.' + (view || 'git'), n = (Number(store.getItem(k)) || 0) + 1;
        store.setItem(k, String(n));
        return n;
      } catch (e) { return 0; /* no storage in this frame */ }
    };
    let boots = 0, bootsLocal = 0;
    try { boots = count(window.sessionStorage); } catch (e) { /* refused */ }
    try { bootsLocal = count(window.localStorage); } catch (e) { /* refused */ }
    note('boot #' + boots + '/' + bootsLocal, label(ws));
    setQuery(ws.status === 'local' ? ws.path : MARK);
    const W = Git.workbench, open = W.open;
    W.open = function (p) {
      W.open = open;
      if (p === MARK) return noRepo(ws);
      return open.call(W, p);
    };
    // Everything a side panel opens (ui/git/openers.js: a diff, a file, File History, a comparison…) goes to Orca's center
    // area when the worker can put it there (hosts/orca/tab.mjs); "not taken" (a workspace that is a linked worktree,
    // editor.open refused…) runs it here as before. The editor frames (the center tab, "+ ▸ Git") never forward.
    if (!editor) {
      Git.host.forward = function (name, args) {
        const w = Git.orca.workspace, root = Git.repo && Git.repo.root;
        if (!w || w.status !== 'local' || !w.workspaceId || !root) return false;
        // Another worktree picked in this panel (ui/git/worktrees.js): the tab belongs to the workspace's own folder (the
        // worker addresses its note file by it), so the opener goes there with the worktree it is about, and the tab
        // shows that worktree (hosts/orca/editor.js).
        const WT = Git.worktrees, away = !!(WT && WT.away() && WT.home());
        const opener = away ? { name, args, worktree: root } : { name, args };
        return Git.orca.request('tab.open', { workspaceId: w.workspaceId, root: away ? WT.home() : root, opener }, { retries: 2, timeoutMs: 20000 })
          .then((r) => !!(r && r.taken), () => false);
      };
    }
    // Centre presence (ui/git/centre.js): Orca tells nothing when the center tab closes or hides, so the tab's frame
    // reports itself to the worker while it renders and the panels ask the worker (hosts/orca/tab.mjs). The panels and
    // the editor frame may not share a storage, so the base's localStorage default is not used here.
    if (!editor) {
      Git.host.centreShown = (root) => Git.orca.request('centre.state', { root }, { retries: 2, timeoutMs: 3000 }).then((r) => !!(r && r.shown), () => false);
    } else if (view === 'tab') {
      Git.host.centreReport = (s) => Git.orca.request('centre.beat', s, { retries: 0, timeoutMs: 3000 });
    }
    // the view of the center tab's frame (hosts/orca/editor.js)
    if (view === 'tab') await load(here + 'editor.js');
    await load('git/boot.js');
    if (ws.status === 'local') tell(ws);
    // what the update channel says (asked above): the mark on the Options button, and below the minimum the dialog,
    // once a day. The page is up either way; a slow or silent worker holds nothing back.
    const updated = () => { try { if (Git.update) Git.update.remind(); } catch (e) { /* the dialog is a courtesy */ } };
    if (Git.update) updating.then((u) => { Git.update.apply(u); updated(); });

    // follow the focused workspace
    let key = keyOf(ws), timer = null;
    function apply(next) {
      const k = keyOf(next);
      if (k === key) return;
      key = k;
      // The same folder as the one open (another workspace id or status text for it, a choice that picked it again):
      // the page stays as it is, only what Orca said is updated.
      const showing = Git.repo.root || Git.store.status === 'loading';
      if (showing && ws.status === 'local' && next.status === 'local' && next.path === ws.path) { ws = next; Git.orca.workspace = next; return; }
      note(label(ws), label(next));
      ws = next;
      Git.orca.workspace = next;
      if (next.status === 'local') { setQuery(next.path); Git.workbench.open(next.path); tell(next); }
      else { setQuery(MARK); Git.store.close(); noRepo(next); }
    }
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { apply(await resolve()); }, 120);
    };
    try { if (window.orca && window.orca.on) window.orca.on('workspace.changed', check); } catch (e) { /* no workspace events */ }
    // a page that comes back also asks again what the update channel says (the worker reads it now and then)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { check(); if (Git.update) Git.update.refresh().then(updated); } });
    Git.orca.check = check;
  }
})();
