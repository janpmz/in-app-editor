# In-App Editor

Add an EDIT button to a website. Edit a separate copy of the page. The source page stays unchanged.

```sh
npm start
```

Open [localhost:4317](http://localhost:4317).

1. Click **EDIT**.
2. Click an item.
3. Drag the item to move it. Drag the bottom-right handle to scale it. Drag a side handle to resize it.

Double-click text to type. Use the fields for fonts, colors, borders, and spacing. Use **Esc** to exit.

## Add to a site

Copy `in-app-editor.js` into the public folder. Load it once:

```html
<script src="/in-app-editor.js" defer></script>
```

For an app with imports, copy this folder. Call `mountEditor()` in the browser after the app mounts:

```js
import { mountEditor } from './in-app-editor/index.js';
mountEditor();
```

Call `InAppEditor.destroy()` when the app removes the editor.

Options: `open`, `persist`, `storageKey`, and `onChange(changes)`. Set `persist: false` to disable browser storage.

## Save

**Copy changes** copies a prompt for Codex. Paste it into the website project to apply the edits to its files.

**Export** saves a JSON file. Browser storage keeps drafts for each page path. Reset removes the current draft. Undo restores it.

The copy captures the page when edit mode starts. It does not run the page’s scripts. Exit edit mode to use the source page.

The editor cannot copy content inside closed shadow roots or frames. Video, custom components, and complex transforms can differ in the copy.

## Keys

| Key | Action |
| --- | --- |
| Drag | Move |
| Shift + drag | Move along one axis |
| Arrow | Move 1 px |
| Shift + arrow | Move 10 px |
| Alt + click | Select a child |
| Alt + up | Select the parent |
| ⌘/Ctrl + Z | Undo |
| ⌘/Ctrl + Shift + Z | Redo |
| Esc | Finish text edits, cancel a drag, or exit |

## Code

```js
InAppEditor.open();
InAppEditor.select(document.querySelector('h1'));
InAppEditor.moveTo(100, 200);
InAppEditor.setText('Title');
InAppEditor.setStyle('font-size', '48px');
InAppEditor.getChanges();
InAppEditor.exportChanges();
InAppEditor.exportChanges('json');
InAppEditor.undo();
InAppEditor.redo();
InAppEditor.reset();
InAppEditor.close();
InAppEditor.destroy();
```

`select()` accepts a source element. The editor changes its copy.

## Checks

```sh
npm run check
npm test
```

Tests need Chrome. Set `CHROME_PATH` if Chrome uses another path.

[PROMPT.md](./PROMPT.md) contains the setup prompt. The **Publish demo** GitHub workflow publishes the demo when you start it.
