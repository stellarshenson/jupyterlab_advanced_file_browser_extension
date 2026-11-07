# Defects - jupyterlab_advanced_file_browser_extension

Defects found against the acceptance criteria in `docs/acc-crit.md`.

## Authors

- `@kj` Konrad Jelen

## Current folder `FOLDER`

With unfolding on, the current folder (model.path) follows the selected row, and new items land there

- log: 2026-11-06T16:03:07Z @kj category created

- [x] `DEF-FOLDER-1-CRUMB-SHIFT` **rows move under the pointer mid-gesture** - MAJOR; with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; fix: breadcrumbs kept on one line; `style/base.css`
  - evidence: ui-tests/tests/unfold.spec.ts: ACC-UNFOLD-5-ENTER double-click on a nested folder enters it passed; ui-tests/tests/open-in-terminal.spec.ts: ACC-TERM-55-FOLDER folder rows show only the core item and ACC-TERM-59-SUBNAV empty area after entering a folder passed; suite 61 passed 2 skipped, log tmp/workflows/functional-v1/logs/repair-1.log
  - root-cause: 2026-11-06T16:03:19Z @kj the row mousedown calls setCurrentFolder, which emits refreshed; the stock BreadCrumbs re-render for the new model.path and wrap from one line (20px) to two (36px) or back, so the listing below moves 16px before the next mouseup, click or contextmenu of the same gesture
  - related: ACC-UNFOLD-5-ENTER, ACC-TERM-55-FOLDER, ACC-TERM-59-SUBNAV - the criteria whose tests fail on it
  - repro: unfolding on, 250px file browser, top folder with a long name holding a/b; unfold a, double-click row a/b: the top folder stays
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T16:03:07Z @kj added
  - log: 2026-11-06T16:18:19Z @kj attempted: breadcrumbs one line, clipped on the x axis - did NOT work, a long segment hid the path's end and ACC-UNFOLD-13-RETURN could not click it (log tmp/workflows/functional-v1/logs/repair-1-make-test.log run before, Galata 43 passed 1 failed)
  - log: 2026-11-06T16:18:19Z @kj closed: fixed: while rows carry the indent, the breadcrumbs keep one line (inline-flex) and a long segment ends in an ellipsis; height 20px in every state; style/base.css
  - log: 2026-11-06T16:18:24Z @kj correction: the failed attempt's Galata log was tmp/workflows/functional-v1/logs/repair-1.log, overwritten by the passing rerun; ACC-UNFOLD-13-RETURN failed there on Test timeout of 60000ms exceeded
  - log: 2026-11-06T16:18:31Z @kj amended text "with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; cause under investigation" -> "with unfolding on, a double-click on a folder row does not enter it and a right-click on a folder row opens the empty-area menu, when the row's folder wraps the breadcrumbs to a different line count; fix: breadcrumbs kept on one line; `style/base.css`"
- [x] `DEF-FOLDER-3-SCROLLBAR` **a press on the listing scrollbar resets the current folder** - MEDIUM; with unfolding on, a mousedown on the listing's vertical scrollbar clears the selection and makes the top folder current, so New File, New Folder, Upload and Paste no longer land in the clicked folder; fix: the empty area is the content node inside its client width; `src/listing.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-3-SCROLLBAR a press on the scrollbar keeps the folder and the selection passed, 37 of 37 in the three touched specs, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build, `tmp/workflows/review-v1/logs/r1-before.log`
  - related: ACC-FOLDER-31-CLICKEMPTY, ACC-FOLDER-29-CLICKDIR - the empty-area rule matches the scrollbar and undoes the folder the click chose
  - repro: unfolding on, a listing long enough to scroll; unfold a, click row a/b, press the scrollbar: the selection clears and model.path is the top folder
  - test-tags: FUNCTIONAL
  - root-cause: 2026-11-06T17:23:40Z @kj TreeDirListing._setCurrentFolder treats every press with no row hit and a target inside contentNode as the empty area; a press on the scrollbar targets contentNode itself, so contentNode.contains(target) is true, while stock _evtMousedown returns at hit index -1 and keeps the selection
  - log: 2026-11-06T17:23:40Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: only a press on contentNode inside its client width is the empty area; src/listing.ts
- [x] `DEF-FOLDER-6-PASTE-INTOSELF` **Paste of a folder into its own subfolder copies it into itself** - MAJOR; with unfolding on, Copy a, click a/b, Paste: jupyter_server copies a into a/b recursively until the path is too long; stock paste() sends the copy, the server has no into-itself check; fix: paste() skips a folder pasted into itself or below itself; `src/listing.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-81-SELFPASTE a folder pasted inside itself stays passed, `tmp/workflows/review-v1/logs/o1-paste-after.log`; it failed on the build without the change, a copy request of a into a/b (`tmp/workflows/review-v1/logs/o1-paste-before.log`)
  - related: ACC-FOLDER-81-SELFPASTE
  - root-cause: 2026-11-06T20:05:43Z @kj stock DirListing.paste() copies or moves every clipboard path into model.path with no check that model.path is that path or lies below it; with unfolding on model.path can be a folder inside a copied folder, and jupyter_server 2.21.1 copy calls shutil.copytree with no into-itself check
  - repro: unfolding on; unfold a holding folder b, click a, Copy, click a/b, Paste: a/b/a/b/a... appears
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T19:29:04Z @kj added
  - log: 2026-11-06T19:29:08Z @kj Star Colonel decided 2026-11-06: fix (review round 1 deferral)
  - log: 2026-11-06T20:08:57Z @kj amended text "with unfolding on, Copy a, click a/b, Paste: jupyter_server copies a into a/b recursively until the path is too long; stock paste() sends the copy, the server has no into-itself check; the drop route is blocked since DEF-UNFOLD-5-INTOSELF" -> "with unfolding on, Copy a, click a/b, Paste: jupyter_server copies a into a/b recursively until the path is too long; stock paste() sends the copy, the server has no into-itself check; fix: paste() skips a folder pasted into itself or below itself; `src/listing.ts`"
  - log: 2026-11-06T20:08:57Z @kj closed: fixed: with unfolding on, paste() drops each clipboard path that model.path equals or lies below; src/listing.ts
- [x] `DEF-FOLDER-7-RESORT` **Change of current folder re-sorts the whole tree** - MINOR; each click that changes the current folder emits refreshed, which re-sorts and re-renders every row; with ACC-FOLDER-79-ARROWKEYS every Up or Down across a folder does it; fix: a current folder change made by the listing keeps the row order; `src/listing.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-7-RESORT a Down press into another folder keeps the row order passed, 11 of 11 in the spec; 2981 rows, median per Down press into another folder 291 ms before (`tmp/workflows/review-v1/logs/o1-resort-before.log`, kept order failed), 115 ms after (`tmp/workflows/review-v1/logs/o1-resort-after.log`); inside one folder 122 and 118 ms
  - root-cause: 2026-11-06T19:48:41Z @kj setCurrentFolder emits refreshed; stock DirListing._onModelRefreshed calls sort, which re-sorts all rows (stock sort, itemOrder, treeOrder) though no row changed; measured at 2981 rows: 291 ms median per Down press into another folder, 122 ms inside one folder
  - repro: unfolding on; unfold folders holding about 3000 rows in total, click a row, hold Down; measure the time per key press in a Chrome performance profile
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T19:29:04Z @kj added
  - log: 2026-11-06T19:29:08Z @kj Star Colonel decided 2026-11-06: fix (review round 1 deferral)
  - log: 2026-11-06T19:51:12Z @kj closed: fixed: a current folder change made by the listing keeps the row order; src/listing.ts
  - log: 2026-11-06T19:51:18Z @kj amended text "each click that changes the current folder emits refreshed, which re-sorts and re-renders every row; cause unknown whether it is slow, not measured; with ACC-FOLDER-79-ARROWKEYS every Up or Down across a folder does it; measure first" -> "MINOR; each click that changes the current folder emits refreshed, which re-sorts and re-renders every row; with ACC-FOLDER-79-ARROWKEYS every Up or Down across a folder does it; fix: a current folder change made by the listing keeps the row order; `src/listing.ts`"
- [x] `DEF-FOLDER-10-UPLOAD-PROMPT` **Upload asks to overwrite a file that is only in another folder** - MEDIUM; with unfolding on, uploading README.md into a/b asks to overwrite when README.md exists only in another unfolded folder; the stock check in FileBrowserModel.upload matches the name against every loaded row; the other file is not touched; fix: the stock upload sees the target folder's rows only; `src/model.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-83-OVERWRITE upload asks to overwrite only for a file in the target folder passed, with ACC-FOLDER-33-UPLOAD, `tmp/workflows/review-v1/logs/o1-upload-after.log`; it failed on the build without the change, the prompt opened for x.txt (`tmp/workflows/review-v1/logs/o1-upload-before.log`)
  - related: ACC-FOLDER-83-OVERWRITE
  - root-cause: 2026-11-06T20:12:23Z @kj stock FileBrowserModel.upload asks to overwrite when any row of its private _items has the file's name; with unfolding on _items holds the rows of every loaded folder, not only the target folder
  - repro: unfolding on; unfold a holding README.md and a/b, click a/b, upload a file named README.md: the overwrite dialog opens
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T19:29:04Z @kj added
  - log: 2026-11-06T19:29:08Z @kj Star Colonel decided 2026-11-06: fix (review round 1 deferral)
  - log: 2026-11-06T20:16:44Z @kj amended text "with unfolding on, uploading README.md into a/b asks to overwrite when README.md exists only in another unfolded folder; the stock check in FileBrowserModel.upload matches the name against every loaded row; the other file is not touched" -> "with unfolding on, uploading README.md into a/b asks to overwrite when README.md exists only in another unfolded folder; the stock check in FileBrowserModel.upload matches the name against every loaded row; the other file is not touched; fix: the stock upload sees the target folder's rows only; `src/model.ts`"
  - log: 2026-11-06T20:16:44Z @kj closed: fixed: with unfolding on, the stock upload runs on a view whose _items holds the target folder's rows only; src/model.ts
- [x] `DEF-FOLDER-11-SELFPASTE-SILENT` **Copy and Paste on the selected folder does nothing and shows no message** - MINOR; with unfolding on, the selected folder is the current folder, so the paste override drops it as a paste into itself (ACC-FOLDER-81-SELFPASTE); no request, no message, the clipboard is emptied; stock and VS Code create a-Copy1 beside it; open question for the owner: skip, paste beside, or a message
  - evidence: `ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-81-SELFPASTE a folder pasted inside itself stays passed, with ACC-FOLDER-34-PASTE, `tmp/workflows/review-v1/logs/o2-selfpaste-after.log`; it failed on the build without the change, no copy request of a after Copy and Paste on the current folder a (`tmp/workflows/review-v1/logs/o2-selfpaste-before.log`)
  - root-cause: 2026-11-06T21:27:53Z @kj with unfolding on, a click on folder a makes a the current folder, so model.path is a; the paste override of ACC-FOLDER-81-SELFPASTE drops every clipboard path equal to model.path, the clipboard is left empty and the stock paste returns at its empty-clipboard check without a request or a message
  - repro: unfolding on; click folder a, Copy, Paste: nothing happens; with unfolding off the same keys create a-Copy1
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T21:14:30Z @kj added
  - log: 2026-11-06T21:14:30Z @kj found by review round 2 (ux-designer), deferred by the adjudicator to the owner; caused by the DEF-FOLDER-6-PASTE-INTOSELF fix
  - log: 2026-11-06T21:23:08Z @kj Star Colonel decided 2026-11-06: paste beside it; a copied folder equal to the current folder pastes into its parent as a-Copy1, as stock; below it and Cut onto itself stay skipped
  - log: 2026-11-06T21:30:38Z @kj closed: fixed: with unfolding on, a copied folder equal to the current folder is pasted into its parent folder as a-Copy1; `src/listing.ts` paste()
- [x] `DEF-FOLDER-13-CUT-DIMMED` **Cut folder row stays dimmed after Paste onto itself** - MINOR; with unfolding on, Cut on the selected folder then Paste: the paste override empties the clipboard, stock paste returns early without update(), so row a keeps jp-mod-cut until the next render
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-13-CUT-DIMMED a cut folder pasted onto itself loses the cut style passed, with ACC-FOLDER-34-PASTE and ACC-FOLDER-81-SELFPASTE, `tmp/workflows/review-v1/logs/o2-cutdim-after.log`; it failed on the build without the change, row a kept jp-mod-cut (`tmp/workflows/review-v1/logs/o2-cutdim-before.log`)
  - root-cause: 2026-11-06T21:32:19Z @kj the paste override drops the cut folder a, which is model.path, and leaves the clipboard empty; the stock paste returns at its empty-clipboard check, which sets _isCut to false before the loop that removes jp-mod-cut and requests no render, so row a stays dimmed
  - repro: unfolding on; click folder a, Cut, Paste: row a stays dimmed although the clipboard is empty
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T21:23:08Z @kj added
  - log: 2026-11-06T21:23:08Z @kj found by review round 2; Star Colonel decided 2026-11-06: fix
  - log: 2026-11-06T21:33:38Z @kj closed: fixed: with unfolding on, paste() requests a render, so the row of a folder cut and pasted onto itself loses jp-mod-cut; `src/listing.ts`
- [x] `DEF-FOLDER-14-OVERLAY-SCROLLBAR` **Press on an overlay scrollbar may reset the current folder** - MINOR; with unfolding on, a press on an overlay scrollbar, which takes no width, that hits no row (the 3 px gap below each row) passes the empty-area rule offsetX < contentNode.clientWidth and resets the current folder; fix: the rightmost 16 px of a scrolling listing are not empty area; `src/listing.ts`
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-14-OVERLAY-SCROLLBAR a press on an overlay scrollbar keeps the folder and the selection passed, 15 of 15 in the spec, `tmp/workflows/review-v1/logs/o3-overlay-after.log`; it failed on the build without the change, model.path reset to the top folder (`tmp/workflows/review-v1/logs/o3-overlay-before.log`)
  - related: ACC-FOLDER-31-CLICKEMPTY
  - root-cause: 2026-11-06T22:18:16Z @kj TreeDirListing._setCurrentFolder counts a press on contentNode as the empty area when offsetX < contentNode.clientWidth; that test sees only a scrollbar that takes layout width; an overlay scrollbar takes none, so a press on it that reaches contentNode clears the selection and makes the top folder current
  - repro: unfolding on; scrollbars that take no width (headless Chromium hides them); 40 files in unfolded a make the listing scroll; click a/b, press 8 px left of the listing's right edge in the 3 px gap below the first row: model.path resets to the top folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T21:23:08Z @kj added
  - log: 2026-11-06T21:23:08Z @kj found by review round 2; Star Colonel decided 2026-11-06: fix
  - log: 2026-11-06T21:36:57Z @kj reproduction attempt: Galata spec with launchOptions --enable-features=OverlayScrollbar and --enable-blink-features=OverlayScrollbars, --hide-scrollbars removed; in HeadlessChrome 158 (headless shell) and Chromium 156 the listing and a plain overflow:scroll div kept a 15 px classic scrollbar, so no overlay scrollbar existed
  - log: 2026-11-06T21:36:58Z @kj reproduction result: 40 rows in unfolded a, click a/b, press on the scrollbar thumb and drag 80 px: scrollTop 0 to 156, the mousedown reached contentNode with offsetX 246 past clientWidth 235, model.path stayed a/b, a/b stayed selected; logs `tmp/workflows/review-v1/logs/o2-overlay-probe-1.log` to `o2-overlay-probe-4.log`; spec removed
  - log: 2026-11-06T21:36:58Z @kj rejected: not reproduced: Chromium OverlayScrollbar, a Galata press and drag on the listing scrollbar in headless Chromium 158 and 156 with --enable-features=OverlayScrollbar met a 15 px classic scrollbar, not an overlay one, and kept the current folder; Star Colonel decided 2026-11-06: fix if it reproduces
  - log: 2026-11-06T22:15:44Z @kj reopened
  - log: 2026-11-06T22:15:44Z @kj Star Colonel decided 2026-11-06: fix without a repro; a press in the rightmost 16 px of a scrolling listing counts as a scrollbar press and keeps the current folder
  - log: 2026-11-06T22:25:29Z @kj amended text "likely cause: the empty-area rule offsetX < contentNode.clientWidth cannot see an overlay scrollbar, which takes no width (Chrome on macOS with a trackpad); a press on it may count as the empty area and reset the current folder; not reproduced yet" -> "with unfolding on, a press on an overlay scrollbar, which takes no width, that hits no row (the 3 px gap below each row) passes the empty-area rule offsetX < contentNode.clientWidth and resets the current folder; fix: the rightmost 16 px of a scrolling listing are not empty area; `src/listing.ts`"
  - log: 2026-11-06T22:25:29Z @kj closed: fixed: in a listing that scrolls vertically, a press in the rightmost 16 px of contentNode is not the empty area; src/listing.ts
  - log: 2026-11-06T22:25:36Z @kj edited repro "unfolding on; Chromium with --enable-features=OverlayScrollbar; unfold enough rows to scroll, click a nested folder, press on the scrollbar: check whether model.path resets" -> "unfolding on; scrollbars that take no width (headless Chromium hides them); 40 files in unfolded a make the listing scroll; click a/b, press 8 px left of the listing's right edge in the 3 px gap below the first row: model.path resets to the top folder"
  - log: 2026-11-06T22:54:57Z @kj fix replaced by DEF-FOLDER-16-ROW-GAP: the empty area is the area below the last row, so the rightmost 16 px rule and OVERLAY_SCROLLBAR_WIDTH are removed; the DEF-FOLDER-14 test presses beside the rows and keeps its assertions
- [x] `DEF-FOLDER-15-PATH-HELD` **Paste beside holds the current folder on the parent during the copy** - MAJOR; with unfolding on, Copy and Paste on the current folder a holds model.path on the parent folder until the server copy ends; a click on another folder during the copy does not change model.path, so New File, New Folder, Upload and a second Paste land in the parent folder
  - evidence: `src/__tests__/tree-model.spec.ts`: DEF-FOLDER-15-PATH-HELD Paste beside leaves the current folder free during the copy passed, 23 of 23 Jest, `tmp/workflows/review-v1/logs/r3-pathheld-after.log`; it failed without the change, model.path read "" (`tmp/workflows/review-v1/logs/r3-pathheld-before.log`)
  - root-cause: 2026-11-06T22:50:01Z @kj TreeDirListing.paste (beside branch) runs super.paste() inside model.withPath(PathExt.dirname(base)); withPath clears _pathOverride only after its function resolves, and the stock paste awaits the server copy, so model.path returns the parent folder until the copy ends; the stock paste reads model.path once, before its first await
  - related: ACC-FOLDER-81-SELFPASTE, ACC-FOLDER-29-CLICKDIR, ACC-FOLDER-34-PASTE - the held path undoes the folder the click chose
  - repro: unfolding on; click folder a, Copy, Paste; while the copy of a runs, click folder b and Paste again: model.path is still the parent of a and the second paste lands there
  - test-tags: UNIT
  - log: 2026-11-06T22:50:01Z @kj added
  - log: 2026-11-06T22:50:01Z @kj found by review round 3 (bug-hunter, ponytail, architect); adjudicator round 3: fix with the direct manager.copy that duplicate() uses
  - log: 2026-11-06T22:50:31Z @kj correction to the log line above: found by the bug-hunter, ux-designer and architect lenses; ponytail did not report it
  - log: 2026-11-06T22:52:46Z @kj closed: fixed: with unfolding on, the beside copy of a copied current folder is a direct manager.copy into its parent folder, and model.path stays on the current folder; `src/listing.ts` paste()
- [x] `DEF-FOLDER-16-ROW-GAP` **Press between two rows resets the current folder** - MINOR; with unfolding on, a press in the 3 px line gap between two rows hits no row and passes the empty-area rule, so it clears the selection and makes the top folder current; stock ignores a press that hits no row
  - evidence: `ui-tests/tests/current-folder.spec.ts`: DEF-FOLDER-16-ROW-GAP a press between two rows keeps the folder and the selection passed, with ACC-FOLDER-31-CLICKEMPTY, DEF-FOLDER-3-SCROLLBAR and DEF-FOLDER-14-OVERLAY-SCROLLBAR, 26 of 26 in current-folder and open-in-terminal specs, `tmp/workflows/review-v1/logs/r3-galata.log`; it failed on the build without the change, model.path reset to the top folder (`tmp/workflows/review-v1/logs/r3-rowgap-before.log`)
  - root-cause: 2026-11-06T22:53:28Z @kj rows are display: inline-grid, so a 3 px line gap lies below each row; TreeDirListing._setCurrentFolder counts every press on contentNode inside its client width as the empty area, the gaps between rows included
  - related: ACC-FOLDER-31-CLICKEMPTY, DEF-FOLDER-14-OVERLAY-SCROLLBAR - the empty area is the area below the rows
  - repro: unfolding on; unfold a, click a/b, press in the gap between the first two rows at the middle of the listing's width: the selection clears and model.path is the top folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T22:53:28Z @kj added
  - log: 2026-11-06T22:53:28Z @kj found by review round 3 (ux-designer lens); adjudicator round 3: the empty area is the area below the last row, as ACC-FOLDER-31-CLICKEMPTY states
  - log: 2026-11-06T22:58:12Z @kj closed: fixed: with unfolding on, the empty area is the area below the last row; a press in a gap between rows or on a scrollbar beside them changes nothing, as in stock; `src/listing.ts` _setCurrentFolder
- [x] `DEF-FOLDER-19-CLIPBOARD-RETRY` **Failed beside copy does not put the folder back on the clipboard** - MINOR; with unfolding on, when the server copy of a copied current folder into its parent fails, the folder is not put back on the clipboard, so a second Paste does nothing; stock paste puts failed paths back unless a newer Copy or Cut ran (_clipboardRevision)
  - evidence: `src/__tests__/tree-model.spec.ts`: DEF-FOLDER-19-CLIPBOARD-RETRY a failed Paste beside puts the folder back on the clipboard passed, make test Jest 24 of 24, `tmp/workflows/review-v1/logs/o4-clipretry-after.log`; it failed without the change, the clipboard was empty (`tmp/workflows/review-v1/logs/o4-clipretry-before.log`)
  - root-cause: 2026-11-07T07:39:23Z @kj TreeDirListing.paste removes base from _clipboard before the stock paste, then copies it with a direct manager.copy; the rejection handler only shows Paste Error, so base never returns to the clipboard, where the stock paste puts every failed path back unless _clipboardRevision moved
  - repro: unfolding on; click folder a, Copy, Paste with the parent not writable: Paste Error; Paste again: nothing happens
  - test-tags: UNIT
  - log: 2026-11-07T07:30:53Z @kj added
  - log: 2026-11-07T07:30:53Z @kj found by review round 5; Star Colonel decided 2026-11-07: fix
  - log: 2026-11-07T07:40:46Z @kj closed: fixed: with unfolding on, a failed beside copy puts the folder back on the clipboard after the stock paste ends, unless a Copy or Cut ran since, the stock _clipboardRevision rule; `src/listing.ts` paste()
- [x] `DEF-FOLDER-20-STOCK-INTOSELF` **With unfolding off, stock Paste copies a folder into its own subfolder** - MAJOR; with unfolding off the extension leaves the stock paste; Copy a, enter a/b, Paste: stock paste sends a copy of a into a/b and jupyter_server 2.21.1 copytree has no into-itself check, so it recurses until the path is too long; with unfolding on DEF-FOLDER-6-PASTE-INTOSELF blocks it
  - evidence: `ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-86-STOCKPASTE unfolding off: a folder pasted inside itself stays passed, `tmp/workflows/review-v1/logs/o5-stockpaste-after.log`; it failed on the build without the change, `tmp/workflows/review-v1/logs/o5-stockpaste-before.log`
  - related: ACC-FOLDER-86-STOCKPASTE
  - root-cause: 2026-11-07T12:43:30Z @kj with unfolding off TreeDirListing.paste ran the stock paste at once; stock DirListing.paste copies each clipboard path into model.path with no check that model.path is that path or below it, and jupyter_server 2.21.1 copytree has no into-itself check, so it copies the new copy again until the path is too long
  - repro: unfolding off; select folder a, Copy, double-click a, double-click b, Paste: a/b/a/b/a... appears
  - test-tags: FUNCTIONAL
  - log: 2026-11-07T12:06:09Z @kj added
  - log: 2026-11-07T12:06:09Z @kj deferred by the review adjudicator in rounds 1, 5 and 6 as an upstream jupyter_server matter; not put to the Star Colonel until now
  - log: 2026-11-07T12:40:54Z @kj Star Colonel decided 2026-11-07: fix in this extension, an exception to unfolding off = stock
  - log: 2026-11-07T12:47:57Z @kj edited test-tags "MANUAL" -> "FUNCTIONAL"
  - log: 2026-11-07T12:47:58Z @kj closed: fixed: TreeDirListing.paste drops from the stock clipboard each path that model.path equals or lies below in both modes, then with unfolding off runs the stock paste; `src/listing.ts`
- [x] `DEF-FOLDER-21-SILENT-SKIP` **Paste skipped as into-itself shows no message** - MINOR; a copied or cut folder dropped from Paste by the into-itself filter (ACC-FOLDER-81-SELFPASTE, ACC-FOLDER-86-STOCKPASTE) gives no feedback: nothing happens and the clipboard is empty; with unfolding off the stock browser showed Paste Error for the cut case; mixed clipboards paste the other items with no word on the skipped folder
  - evidence: `ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-87-SKIPMSG, ACC-FOLDER-81-SELFPASTE and ACC-FOLDER-86-STOCKPASTE passed with one Paste Error naming the skipped folder a, also for Cut a, enter a, Paste with unfolding off and on, spec 18 of 18 (`tmp/workflows/review-v1/logs/o6-complete-4-after.log`); no dialog without the change (`tmp/workflows/review-v1/logs/o6-skipmsg-before.log`, `tmp/workflows/review-v1/logs/o6-complete-3-before.log`, `tmp/workflows/review-v1/logs/o6-complete-4-before.log`)
  - root-cause: 2026-11-07T13:04:13Z @kj TreeDirListing.paste drops from the clipboard each path that model.path equals or lies below before the stock paste runs (DEF-FOLDER-6-PASTE-INTOSELF, DEF-FOLDER-20-STOCK-INTOSELF); the stock paste reports only a request that fails, so a dropped folder sends no request, nothing fails and nothing reports the skip
  - repro: unfolding off; select folder a, Cut, enter a/b, Paste: nothing happens, no dialog
  - test-tags: FUNCTIONAL
  - log: 2026-11-07T12:59:46Z @kj added
  - log: 2026-11-07T12:59:46Z @kj found by review round 7 (ux-designer, material MINOR); caused by the DEF-FOLDER-20 and DEF-FOLDER-6 filters
  - log: 2026-11-07T12:59:55Z @kj edited text "a copied or cut folder dropped from Paste by the into-itself filter (ACC-FOLDER-81, ACC-FOLDER-86) gives no feedback: nothing happens and the clipboard is empty; with unfolding off the stock browser showed Paste Error for the cut case; mixed clipboards paste the other items with no word on the skipped folder" -> "a copied or cut folder dropped from Paste by the into-itself filter (ACC-FOLDER-81-SELFPASTE, ACC-FOLDER-86-STOCKPASTE) gives no feedback: nothing happens and the clipboard is empty; with unfolding off the stock browser showed Paste Error for the cut case; mixed clipboards paste the other items with no word on the skipped folder"
  - log: 2026-11-07T13:01:43Z @kj Star Colonel decided 2026-11-07: show the stock Paste Error once, naming the folder
  - log: 2026-11-07T13:15:36Z @kj closed: ACC-FOLDER-87-SKIPMSG a folder skipped from Paste is reported passed
  - log: 2026-11-07T13:44:03Z @kj edited evidence "`ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-87-SKIPMSG, ACC-FOLDER-81-SELFPASTE and ACC-FOLDER-86-STOCKPASTE passed with the Paste Error dialog naming the skipped folder a, current-folder spec 18 of 18, `tmp/workflows/review-v1/logs/o6-skipmsg-after.log`; all three failed on the build without the change, no dialog opened (`tmp/workflows/review-v1/logs/o6-skipmsg-before.log`)" -> "`ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-87-SKIPMSG, ACC-FOLDER-81-SELFPASTE and ACC-FOLDER-86-STOCKPASTE passed with one Paste Error naming the skipped folder a, also for Cut a, enter a, Paste with unfolding off, spec 18 of 18 (`tmp/workflows/review-v1/logs/o6-complete-3-after.log`); no dialog without the change (`tmp/workflows/review-v1/logs/o6-skipmsg-before.log`, `tmp/workflows/review-v1/logs/o6-complete-3-before.log`)"
  - log: 2026-11-07T13:58:28Z @kj edited evidence "`ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-87-SKIPMSG, ACC-FOLDER-81-SELFPASTE and ACC-FOLDER-86-STOCKPASTE passed with one Paste Error naming the skipped folder a, also for Cut a, enter a, Paste with unfolding off, spec 18 of 18 (`tmp/workflows/review-v1/logs/o6-complete-3-after.log`); no dialog without the change (`tmp/workflows/review-v1/logs/o6-skipmsg-before.log`, `tmp/workflows/review-v1/logs/o6-complete-3-before.log`)" -> "`ui-tests/tests/current-folder.spec.ts`: ACC-FOLDER-87-SKIPMSG, ACC-FOLDER-81-SELFPASTE and ACC-FOLDER-86-STOCKPASTE passed with one Paste Error naming the skipped folder a, also for Cut a, enter a, Paste with unfolding off and on, spec 18 of 18 (`tmp/workflows/review-v1/logs/o6-complete-4-after.log`); no dialog without the change (`tmp/workflows/review-v1/logs/o6-skipmsg-before.log`, `tmp/workflows/review-v1/logs/o6-complete-3-before.log`, `tmp/workflows/review-v1/logs/o6-complete-4-before.log`)"; reason: check-o6-3: add the unfolding-on Cut a, enter a, Paste step

## Open in Terminal `TERM`

Migrated from jupyterlab_open_in_terminal_extension: Open in Terminal on a file and on the empty area; core keeps the folder item

- log: 2026-11-06T16:03:07Z @kj category created

- [x] `DEF-TERM-2-ROOT-CWD` **terminal at the server root opens in the process folder** - MEDIUM; Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; fix: absolute root from the server extension; `src/openInTerminal.ts`
  - evidence: ui-tests/tests/open-in-terminal.spec.ts: ACC-TERM-60-ROOT file at the server root opens at the root passed; suite 61 passed 2 skipped, log tmp/workflows/functional-v1/logs/repair-1.log
  - root-cause: 2026-11-06T16:03:19Z @kj the command passes cwd '' (model.path); core terminal:create-new turns an empty cwd into none, and jupyter_server_terminals then starts the shell in the server's process folder; a non-empty cwd goes through contents.localPath, which strips a leading slash, so no cwd through that command names the root
  - related: ACC-TERM-60-ROOT - the criterion whose test fails on it
  - repro: start the server outside its root_dir, file browser at the root, Open in Terminal on a file, run pwd: the process folder
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T16:03:07Z @kj added
  - log: 2026-11-06T16:18:19Z @kj closed: fixed: at the root the command starts the terminal with the absolute root_dir, given by the server extension as page config advancedFileBrowserServerRoot, then runs terminal:open; src/openInTerminal.ts, `jupyterlab_advanced_file_browser_extension/__init__.py`
  - log: 2026-11-06T16:18:31Z @kj amended text "Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; cause under investigation" -> "Open in Terminal on a file at the server root, or on the empty area there, starts the terminal in the server's process folder instead of the server root, when the server starts outside its root_dir; fix: absolute root from the server extension; `src/openInTerminal.ts`"
- [x] `DEF-TERM-17-GAP-COMMENT` **Open in Terminal comment says the empty area always resets the folder** - MINOR; openInTerminal.ts execute comment says the right-click mousedown made the top folder current on the empty area; since DEF-FOLDER-16-ROW-GAP a right-click in the 3 px gap between rows keeps the current folder, so the terminal opens there; the comment is false, the behaviour stays
  - evidence: comment corrected, `tmp/workflows/review-v1/patches/o4-TERMCOMMENT.patch`
  - root-cause: 2026-11-07T07:40:53Z @kj the execute comment in `src/openInTerminal.ts` predates DEF-FOLDER-16-ROW-GAP, which narrowed the empty area of TreeDirListing._setCurrentFolder to a press below the last row; the comment still says every press outside a row makes the top folder current
  - repro: read src/openInTerminal.ts execute comment against TreeDirListing._setCurrentFolder: a gap press is not the empty area
  - test-tags: MANUAL
  - log: 2026-11-07T07:30:53Z @kj added
  - log: 2026-11-07T07:30:53Z @kj found by review round 5; Star Colonel decided 2026-11-07: fix
  - log: 2026-11-07T07:41:02Z @kj closed: fixed: the execute comment in `src/openInTerminal.ts` names the gap between rows, which keeps the current folder; no behaviour change

## Actions on nested rows `NESTED`

File browser actions on rows inside unfolded folders act on the item's own path

- log: 2026-11-06T17:25:19Z @kj category created

- [x] `DEF-NESTED-4-TWICE` **a folder selected with its own rows is copied, moved or deleted twice** - MAJOR; with unfolding on, Copy, Cut, Delete or a drop on a selection that holds a folder and rows inside it act on each row as well, in parallel: Paste puts the rows a second time beside the folder copy, and Delete may report Delete Failed; `src/listing.ts`
  - evidence: `ui-tests/tests/nested-actions.spec.ts`: ACC-NESTED-77-OUTERMOST a folder selected with its own rows acts once passed, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build with b/x.txt present, `tmp/workflows/review-v1/logs/r1-before.log`; `src/__tests__/tree-model.spec.ts` outermost case passed, make test Jest 21 of 21, `tmp/workflows/review-v1/logs/r1-make-test.log`
  - related: ACC-NESTED-37-DELETE, ACC-FOLDER-34-PASTE, ACC-UNFOLD-16-DROP - each acts on a nested row a second time when its folder is selected too
  - repro: unfolding on; unfold a holding x.txt, click a, Ctrl-click a/x.txt, Copy, click folder b, Paste: both b/a/x.txt and b/x.txt appear
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-11-06T17:25:19Z @kj stock copy (_copy over selectedItems), delete (_sortedItems filtered by the selection) and the tree evtDrop (the dragged selection keys) take every selected path; with unfolding on a selection can hold a folder and its own rows, and each path becomes its own request, sent in parallel
  - log: 2026-11-06T17:25:19Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: copy, cut, delete and the tree drop act on the outermost selected paths; src/listing.ts, src/model.ts
- [x] `DEF-NESTED-8-DUPLICATE` **Duplicate puts copies of rows from other folders into the current folder** - MINOR; with unfolding on, Duplicate on rows from several folders copies each into model.path, the current folder, not beside its original; stock duplicate() copies into model.path; fix: duplicate() copies each file into its own folder; `src/listing.ts`
  - evidence: `ui-tests/tests/nested-actions.spec.ts`: ACC-NESTED-82-DUPLICATE Duplicate puts each copy beside its original passed, with ACC-NESTED-38-MULTI, `tmp/workflows/review-v1/logs/o1-duplicate-after.log`; it failed on the build without the change, a/x-Copy1.txt missing (`tmp/workflows/review-v1/logs/o1-duplicate-before.log`)
  - related: ACC-NESTED-82-DUPLICATE
  - root-cause: 2026-11-06T20:09:47Z @kj stock DirListing.duplicate() copies every selected file into model.path; with unfolding on a selection can hold files of several folders, and model.path is the folder of the last clicked row
  - repro: unfolding on; unfold a and b, click a/x.txt, Ctrl-click b/y.txt, Duplicate: both copies appear in folder b
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T19:29:04Z @kj added
  - log: 2026-11-06T19:29:08Z @kj Star Colonel decided 2026-11-06: fix (review round 1 deferral)
  - log: 2026-11-06T20:11:25Z @kj amended text "with unfolding on, Duplicate on rows from several folders copies each into model.path, the current folder, not beside its original; stock duplicate() copies into model.path" -> "with unfolding on, Duplicate on rows from several folders copies each into model.path, the current folder, not beside its original; stock duplicate() copies into model.path; fix: duplicate() copies each file into its own folder; `src/listing.ts`"
  - log: 2026-11-06T20:11:25Z @kj closed: fixed: with unfolding on, duplicate() copies each selected file into its own folder; src/listing.ts
- [x] `DEF-NESTED-12-SELECTION-SIGNAL` **Dropping nested rows from the selection emits no selectionChanged** - MINOR; _selectOutermost, run by copy, cut and delete with unfolding on, deletes selection entries and calls update() but never emits the listing's public selectionChanged signal, which every stock selection change emits and FileBrowser re-emits; no listener exists today
  - evidence: `src/__tests__/tree-model.spec.ts`: DEF-NESTED-12-SELECTION-SIGNAL copy emits selectionChanged when it drops nested rows passed in `make test`, 22 of 22 Jest tests, `tmp/workflows/review-v1/logs/o2-signal-after.log`; it failed without the change, 0 signals instead of 1 (`tmp/workflows/review-v1/logs/o2-signal-before.log`)
  - root-cause: 2026-11-06T21:30:47Z @kj _selectOutermost (`src/listing.ts`) removes entries from the stock selection object directly and only calls update(); the private stock _selectionChanged signal is emitted by the stock selection methods only, so this change of the selection reaches no selectionChanged listener
  - repro: unfolding on; connect to filebrowser.selectionChanged; select a and a/x.txt, Copy: the selection loses a/x.txt and no signal fires
  - test-tags: UNIT
  - log: 2026-11-06T21:23:08Z @kj added
  - log: 2026-11-06T21:23:08Z @kj found by review round 2; Star Colonel decided 2026-11-06: fix
  - log: 2026-11-06T21:31:56Z @kj closed: fixed: _selectOutermost emits the listing selectionChanged when it drops a nested path; `src/listing.ts`

## Folder unfolding `UNFOLD`

A triangle on each folder row folds or unfolds the folder in place as a tree; ported from jupyterlab-unfold

- log: 2026-11-06T17:26:40Z @kj category created

- [x] `DEF-UNFOLD-5-INTOSELF` **a folder Ctrl-dropped inside itself is copied into itself without end** - MAJOR; with unfolding on, a Ctrl-drop of a folder onto its own row or a row inside it asks the server to copy the folder into itself; copytree then recurses about 500 levels, writes about 250 times the folder's size and blocks the server; `src/listing.ts`
  - evidence: `ui-tests/tests/unfold.spec.ts`: ACC-UNFOLD-78-SELFDROP a folder Ctrl-dropped on its own row stays passed, `tmp/workflows/review-v1/logs/r1-galata.log`; it failed on the pre-change build with a POST copy to a/b, `tmp/workflows/review-v1/logs/r1-before.log`
  - related: ACC-UNFOLD-16-DROP - the drop on a nested row reaches the folder's own rows
  - repro: unfolding on; unfold a holding folder b, press row a, Ctrl-drag it onto row a/b and release: a/b/a/b/a appears, then Error while copying/moving files
  - test-tags: FUNCTIONAL
  - root-cause: 2026-11-06T17:26:40Z @kj TreeDirListing.evtDrop skips a path only when the new path equals the old one; stock evtDragOver marks any row under the pointer as the drop target, and jupyter_server 2.21.1 copy calls shutil.copytree with no check that the target lies inside the source
  - log: 2026-11-06T17:26:40Z @kj added
  - log: 2026-11-06T17:31:07Z @kj closed: fixed: evtDrop skips a folder dropped onto itself or below itself; src/listing.ts
- [x] `DEF-UNFOLD-9-HITAREA` **Triangle reacts only on 16x13 px of a 24-27 px row** - MINOR; a click just above or below the triangle selects the folder, and a double-click there enters it, instead of folding or unfolding it; fix: the triangle spans the row's height; `style/base.css`
  - evidence: `ui-tests/tests/unfold.spec.ts`: ACC-UNFOLD-84-HITAREA triangle reacts on the full row height passed, `tmp/workflows/review-v1/logs/o1-hitarea-after.log`; it failed on the build without the change, a selected and not unfolded (`tmp/workflows/review-v1/logs/o1-hitarea-before.log`)
  - related: ACC-UNFOLD-84-HITAREA
  - root-cause: 2026-11-06T20:28:50Z @kj the triangle span is its 13 px glyph box, centred in the 16 px name cell of a 24 px row; handleEvent tests event.target.closest on the triangle class, so a press 5.5 px above or below the glyph reaches the stock row handler, which selects, and on a double-click enters
  - repro: unfolding on; click 2 px below the top edge of folder a's row, in the triangle's column: a is selected and not unfolded; a click 4 px above the triangle's centre still lands on the 13 px glyph box
  - test-tags: FUNCTIONAL
  - log: 2026-11-06T19:29:04Z @kj added
  - log: 2026-11-06T19:29:08Z @kj Star Colonel decided 2026-11-06: fix (review round 1 deferral)
  - log: 2026-11-06T20:28:54Z @kj edited repro "unfolding on; click 4 px above the centre of the triangle on folder a: a is selected and not unfolded" -> "unfolding on; click 2 px below the top edge of folder a's row, in the triangle's column: a is selected and not unfolded; a click 4 px above the triangle's centre still lands on the 13 px glyph box"
  - log: 2026-11-06T20:33:16Z @kj amended text "a click just above or below the triangle selects the folder, and a double-click there enters it, instead of folding or unfolding it" -> "a click just above or below the triangle selects the folder, and a double-click there enters it, instead of folding or unfolding it; fix: the triangle spans the row's height; `style/base.css`"
  - log: 2026-11-06T20:33:16Z @kj closed: fixed: the triangle stretches to the row's full height; style/base.css
- [x] `DEF-UNFOLD-18-DROP-HIGHLIGHT` **Own subfolder lights up as a drop target, then the drop does nothing** - MINOR; with unfolding on, dragging folder a over its own subfolder a/b highlights a/b and shows a move cursor; the drop is skipped by the DEF-UNFOLD-5-INTOSELF guard with no message; stock never shows a dragged folder's children
  - evidence: `ui-tests/tests/unfold.spec.ts`: DEF-UNFOLD-18-DROP-HIGHLIGHT a dragged folder does not highlight its own subfolder passed with ACC-UNFOLD-16-DROP and ACC-UNFOLD-78-SELFDROP, 3 of 3, `tmp/workflows/review-v1/logs/o4-drophl-after.log`; it failed on the build without the change, a/b carried jp-mod-dropTarget (`tmp/workflows/review-v1/logs/o4-drophl-before.log`)
  - root-cause: 2026-11-07T07:36:50Z @kj stock evtDragEnter refuses only file rows and selected rows, so an unfolded row of a dragged folder, or its own row after a Ctrl press deselects it, accepts the drag and gets jp-mod-dropTarget; the TreeDirListing evtDrop loop then skips a path dropped into itself, so the accepted drop does nothing
  - repro: unfolding on; unfold a holding folder b, drag a over a/b: a/b is highlighted; release: nothing happens
  - test-tags: FUNCTIONAL
  - log: 2026-11-07T07:30:53Z @kj added
  - log: 2026-11-07T07:30:53Z @kj found by review round 5; Star Colonel decided 2026-11-07: fix
  - log: 2026-11-07T07:39:15Z @kj closed: fixed: with unfolding on, a row whose path is a dragged path or lies below one refuses the drag at lm-dragenter, so it shows no drop highlight and takes no drop; `src/listing.ts` evtDragEnter
