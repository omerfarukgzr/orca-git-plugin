/* Git Panel: the view of Orca's center tab (hosts/orca/README.md "A center tab for everything a panel opens").
   hosts/orca/panel.js loads it in the custom editor frame (panels/editor.html) when the document is the marker, before
   git/boot.js, and starts the UI as the single view `tab`. The view asks the worker for the repository's current opener
   (`tab.current` → { name, args, worktree? }, ui/git/openers.js) and runs it here: the first page of the tab, without
   Back (ui/git/pages.js, bare). An opener a panel forwards later (`tab`, relayed by the worker) replaces everything
   shown; what is opened from inside the tab runs here and stacks with Back. Without an opener: a quiet note. Orca
   re-creates this frame whenever the tab shows again, so every boot asks again.
   An opener of a panel that shows another worktree of the repository names it (`worktree`): the tab shows that
   worktree in place (ui/git/worktrees.js) and then runs the opener; an opener without one brings the tab back to the
   workspace's own folder. The opener is always filed under that folder (the home), whatever the tab shows. */
(function () {
  'use strict';
  const Git = window.Git;
  const h = Git.h, t = (...a) => Git.t(...a);
  Git.addTR({
    'Nothing to show yet': 'Henüz gösterilecek bir şey yok',
    'Double-click a changed file in the Git Log or Commit panel, or open a history or a comparison there, to see it here.':
      'Burada görmek için Git Log ya da Commit panelinde değişen bir dosyaya çift tıkla ya da oradan bir geçmiş veya karşılaştırma aç.',
  });
  Git.addZH({
    'Nothing to show yet': '暂无可显示的内容',
    'Double-click a changed file in the Git Log or Commit panel, or open a history or a comparison there, to see it here.':
      '要在此处查看，请在 Git 日志或提交面板中双击更改的文件，或在其中打开历史记录或比较。',
  });
  Git.views = Git.views || {};
  /** The folder the worker files this tab's opener under: the workspace's own, also while a worktree is shown. */
  const home = () => (Git.worktrees && Git.worktrees.home()) || Git.repo.root;
  const refused = new Set();   // worktrees that could not be shown: tried once, until a panel forwards again
  /** Shows `op` ({ name, args, worktree? }): everything shown before goes, the opener runs here. */
  function show(op) {
    if (!op || typeof op.name !== 'string' || Git.openers.names().indexOf(op.name) < 0) return;
    const want = typeof op.worktree === 'string' && op.worktree ? op.worktree : home();
    if (want && Git.repo.root !== want) {
      // Another folder than the one shown: show it first. That builds the view again (mount below), which asks for
      // the opener and comes back here with the folder in place, so nothing runs from this call.
      if (!Git.worktrees || refused.has(want)) return;
      refused.add(want);
      Promise.resolve(Git.worktrees.show(want)).then(() => { if (Git.repo.root === want) refused.delete(want); }, () => {});
      return;
    }
    if (Git.pages) Git.pages.closeAll();
    try { Git.openers.run(op.name, op.args || {}); } catch (e) { console.error(e); }
  }
  Git.views.tab = {
    mount(el) {
      Git.clear(el).appendChild(h('div.wb-tab-empty#wb-tab-empty', { role: 'status' },
        h('div.wb-tab-empty-title', t('Nothing to show yet')),
        h('div.wb-tab-empty-text', t('Double-click a changed file in the Git Log or Commit panel, or open a history or a comparison there, to see it here.'))));
      const shown = Git.repo.root;
      Git.orca.request('tab.current', { root: home() }).then((r) => { if (r && r.opener && Git.repo.root === shown) show(r.opener); }, () => { /* the note stays */ });
    },
  };
  Git.orca.onMessage('tab', (d) => {
    if (!d || !d.opener || !Git.repo.root || d.root !== home() || Git.workbench.view !== 'tab') return;
    refused.clear();
    show(d.opener);
  });
})();
