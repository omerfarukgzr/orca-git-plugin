# Third-party notices

Hay Git for Orca includes the following material from other projects. Each keeps its own license.

| What | Where in this repository | From | License |
|---|---|---|---|
| Icons, and constants, label texts and the commit graph logic re-implemented from the source | `ui/orca-bundle.js` (the part `git/icons.js` and parts of the other `git/` parts), `hosts/orca/icons/` | [IntelliJ IDEA Community Edition](https://github.com/JetBrains/intellij-community), Copyright 2000-2026 JetBrains s.r.o. and contributors | Apache License 2.0: `ui/git/NOTICE.txt`, `ui/git/LICENSE-APACHE-2.0.txt` |
| Light-theme palettes: the IntelliJ Light UI theme and editor scheme values | `ui/css/orca-bundle.css` (the parts `css/tokens.css`, `git/git.css`, `git/git-diff.css`, `git/git-files.css`, `git/git-branches.css`, `git/git-merge.css`) | [IntelliJ IDEA Community Edition](https://github.com/JetBrains/intellij-community), `platform/platform-resources/src/themes/expUI/expUI_light.theme.json` and `expUI_lightScheme.xml`, commit `155a0145aff28f3dd200057c4f1d98e56b1bac6b`, Copyright 2000-2026 JetBrains s.r.o. and contributors | Apache License 2.0: `ui/git/NOTICE.txt`, `ui/git/LICENSE-APACHE-2.0.txt` |
| Light variants of the New UI icons (the `Git.ICONS_LIGHT` table) | `ui/orca-bundle.js` (the part `git/icons.js`) | [IntelliJ IDEA Community Edition](https://github.com/JetBrains/intellij-community), `platform/icons/src/expui/**` and `plugins/git4idea/backend/resources/icons/worktree.svg`, Copyright 2000-2026 JetBrains s.r.o. and contributors | Apache License 2.0: `ui/git/NOTICE.txt`, `ui/git/LICENSE-APACHE-2.0.txt` |
| highlight.js 11.9.0 | `ui/orca-bundle.js` (the part `vendor/highlight-11.9.0.min.js`, as its authors distribute it) | [highlight.js](https://github.com/highlightjs/highlight.js) | BSD 3-Clause: `ui/vendor/highlight-LICENSE.txt` |
| Orca's file icon tables (file name / extension → icon) and the rule order of its file and folder icons, re-implemented | `hosts/orca/look/file-icons-data.js`, `hosts/orca/look/file-icons.js` | [Orca](https://github.com/stablyai/orca) v1.4.259, Copyright (c) 2026 Lovecast Inc. | MIT: `hosts/orca/look/ORCA-LICENSE.txt` |
| Lucide icons (the shapes of the icons those tables name), lucide-static 0.577.0 | `hosts/orca/look/file-icons-data.js` | [Lucide](https://github.com/lucide-icons/lucide), Lucide Contributors; portions from Feather, Cole Bemis | ISC (portions MIT): `hosts/orca/look/LUCIDE-LICENSE.txt` |
| Geist variable font, as Orca bundles it | `hosts/orca/look/Geist-Variable.woff2` | [Geist](https://github.com/vercel/geist-font), The Geist Project Authors | SIL Open Font License 1.1: `hosts/orca/look/GEIST-OFL.txt` |

Details for each: `ui/vendor/NOTICE.txt`, `ui/git/NOTICE.txt` and `hosts/orca/look/NOTICE.txt`. Those texts name the
files as they are in the source tree (`ui/git/…`, `ui/vendor/…`); here they are parts of `ui/orca-bundle.js`, each
under a `/* ==== <file> ==== */` line. `ui/vendor/NOTICE.txt` also describes the Seti icon theme of the source tree;
this plugin does not carry it (under Orca the file icons are Orca's own).

"IntelliJ IDEA" and "JetBrains" are trademarks of JetBrains s.r.o. This plugin is not affiliated with or endorsed by
JetBrains. Nor is it affiliated with or endorsed by the authors of Orca.
