# In-App Editor

Add an EDIT button to a website. Edit a separate copy of the page. The source page stays unchanged. All items get canvas coordinates when edit mode starts.

```sh
npm start
```

Open [localhost:4317](http://localhost:4317).

1. Click **EDIT**.
2. Click an item.
3. Drag the item to move it. Drag the bottom-right handle to scale it. Drag a side handle to resize it.

Double-click text to type. The sidebar starts with text, background, and border colors. Text and font controls follow. Position and box size appear last.

Hold **⌘/Ctrl** and scroll to zoom. Scroll to pan. Drag across empty space to select items. The rectangle only needs to touch them. Drag any selected item to move the whole selection.

Right-click for **Group**, **Ungroup**, and **Delete**. Use **Shift + click** to add or remove items from the selection.

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

Options: `open`, `persist`, `storageKey`, and `onChange(changes)`. Each edit session starts from the current page. Set `persist: true` to save and restore drafts. For a script tag, use `data-persist="true"`.

## Save

**Copy changes** copies a prompt for Codex. Paste it into the website project to apply the edits to its files.

**Export** saves a JSON file. Reset removes the current edits. Undo restores them.

The canvas copies the page when edit mode starts. Each item moves on its own. Moving a card leaves its text and buttons in place. Their order stays the same. Select them together or make a group to move them together. The copy does not run the page’s scripts. Exit edit mode to use the source page.

The editor cannot copy content inside closed shadow roots or frames. Video, custom components, and complex transforms can differ in the copy.

## Keys

| Key | Action |
| --- | --- |
| Drag empty space | Select items |
| Drag selected items | Move |
| Shift + click | Add or remove items |
| Shift + drag | Move along one axis |
| ⌘/Ctrl + scroll | Zoom at the pointer |
| Scroll | Pan |
| Space + drag | Pan |
| Arrow | Move 1 px |
| Shift + arrow | Move 10 px |
| ⌘/Ctrl + G | Group |
| ⌘/Ctrl + Shift + G | Ungroup |
| Delete / Backspace | Delete selected items |
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
