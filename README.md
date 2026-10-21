# In-App Editor

Add an **EDIT** button to an existing website. Pick text, buttons, images or boxes, then change them on the page.

- Type new words, pick a font, and change text size or color.
- Drag to resize. Change space, fills, borders, corners and layout.
- Pick a parent box to edit a whole section.
- Undo, redo, or reset. Changes stay saved in this browser for each page.
- Copy a change list into Codex so it can write the edits into your site’s files.

No packages to load. No account. The editor makes no network calls. Its controls sit in a shadow root so the site’s styles do not change them.

## Try it

```sh
npm start
```

Open [localhost:4317](http://localhost:4317). Click **EDIT** in the bottom right. Click an item to pick it. Double-click plain text to type. Use **Parent** to pick its outer box. **Esc** ends text edits, then leaves edit mode. Use **⌘/Ctrl Z** to undo, and **⌘/Ctrl Shift Z** to redo.

## Add it to a site

Copy `in-app-editor.js` into the site’s public folder and add this near the end of the page:

```html
<script src="/in-app-editor.js" defer></script>
```

That is enough for a plain HTML site. It adds the button on its own.

For an app with imports, copy this folder into your project and call this once in the browser after the app mounts:

```js
import { mountEditor } from './in-app-editor/index.js';

mountEditor();
```

For example, in a React app, call it in a top-level `useEffect`. Return `() => editor.destroy()` from that effect. Keep the import in the browser part of a server-rendered app. When using imports, the editor waits for `mountEditor()` before adding the button.

Show it only where you want editing, such as a local build or a private preview. The editor pauses clicks and form submits while edit mode is on so users can pick links and buttons. When edit mode is off, they work as usual. Site code that acts before the editor’s event handler may still run; mount the editor early when that matters.

You can also load the file without starting it:

```html
<script src="/in-app-editor.js" data-auto="false"></script>
<script>
  InAppEditor.mount({ open: true, persist: false });
</script>
```

Options: `open` starts in edit mode; `persist: false` turns off browser storage; `storageKey` sets a custom draft name; `onChange(changes)` runs after each change.

## Keep your changes

Edits change the page in the browser. They do **not** write to your source files. Click **Copy changes**, paste into Codex in your site’s project, and ask it to apply them. The copied text has each item’s selector, old and new words, style values, and changed image or link addresses. **Export** saves the same changes as a JSON file.

Drafts stay in this browser’s storage for this page path. Other users do not see them. The editor tries to reapply drafts if the app redraws an item. IDs or `data-edit-id` values help it find the same item after a code change. If your page structure changes, reset the draft and start again.

Double-click plain text to type on the page. If a line has child items, such as bold words or a line break, use its separate Text part fields. Each field keeps the child items in place. New words stay plain text. Use the ↔ button to move the controls to the other side of the page.

The editor handles normal page elements. It cannot reach inside a closed shadow root or a frame, or edit words drawn inside an image or canvas. Some style changes depend on the page’s layout rules. Use **Any style** to set a CSS value the other fields do not cover. Apps may need extra work if they depend on direct changes to the page, redraw it often, or use strict content rules that block added styles.

## Use from code

```js
InAppEditor.open();
InAppEditor.select(document.querySelector('h1'));
InAppEditor.setStyle('font-size', '72px');
InAppEditor.setText('A new headline');
InAppEditor.getChanges();
InAppEditor.exportChanges();       // A prompt for Codex
InAppEditor.exportChanges('json'); // A change list
InAppEditor.exportChanges('css');  // Styles only
InAppEditor.undo();
InAppEditor.redo();
InAppEditor.reset();
InAppEditor.close();
InAppEditor.destroy();            // Remove the editor, keep the edits
InAppEditor.destroy({ revert: true }); // Remove it and undo its edits
```

`setStyle`, `setText` and `setAttribute` can take an element as their last argument. `setAttribute` supports `src`, `alt`, `href` and `title`. The editor rejects script addresses.

## Share on GitHub

The project has no build step. Push it to a GitHub repo. To host the demo with GitHub Pages, open **Settings → Pages**, pick **GitHub Actions** as the source, then run the **Publish demo** workflow. It copies only the demo, the editor, and the two guide files. It runs only when started by hand.

[PROMPT.md](./PROMPT.md) has the prompt to paste into Codex. Replace its repo address if you use a different owner or name.

## Check it

```sh
npm run check
npm test
```

The tests launch Chrome in a fresh, hidden window and check text and style edits, undo/redo, reset, stored drafts, app redraws, safe text, event handling, and cleanup. Set `CHROME_PATH` if Chrome lives elsewhere. The tests need no npm packages.
