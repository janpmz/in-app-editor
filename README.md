# In-App Editor

Edit your website visually.

## How to add this right now

Paste this into Codex or Claude to edit your website:

```text
I want to edit my website visually.
Add the edit widget from https://github.com/janpmz/in-app-editor so I can edit the page in place.
Read and follow instructions.md in that repo.
```

---

## Use the editor

Add an EDIT button to a website. Edit a separate copy of the page. The source page stays unchanged. All items get canvas coordinates when edit mode starts.

The editor runs in the browser. It needs no separate server. Your site keeps its current setup.

1. Click **EDIT**.
2. Click an item.
3. Drag the item to move it. Drag the bottom-right handle to scale it. Drag a side handle to resize it.

Edit mode opens at 80%. Double-click text to type. Drag the handle above a selection to move it in any mode.

Click **−** in the sidebar header to hide the bar. Click **Edit** to bring it back.

The sidebar has color pickers, opacity sliders, size sliders, plus/minus buttons, and font lists. Color comes first, then text, Border, and Font. Position and box size appear last. The color fields also accept pasted values.

Hold **⌘/Ctrl** and scroll to zoom. Scroll to pan. Use **Select** to draw a selection box. The box only needs to touch an item. A box inside a card skips that card. Cross its edge to select it too.

Drag any selected text or control to move the whole selection. Use **Move** to drag cards. Use **Pan** to move the view.

Right-click for **Group**, **Ungroup**, and **Delete**. Use **Shift + click** to add or remove items from the selection.

The right-click menu also has **Select**, **Move**, **Pan**, and **Fit box to content**. Fit shrinks text and button boxes while keeping the text in place.

Click **Add** beside the zoom controls to open the left sidebar. Add text, icons, buttons, boxes, rectangles, arrows, text boxes, or dividers. Search icons by name and choose a style.

## Add to a site

Follow [instructions.md](./instructions.md) for setup.

Copy `in-app-editor.js` into the public folder. Load it once:

```html
<script src="/in-app-editor.js" defer></script>
```

For an app with imports, copy `index.js` and `in-app-editor.js` into one folder. Call `mountEditor()` in the browser after the app mounts:

```js
import { mountEditor } from './in-app-editor/index.js';
mountEditor();
```

Call `InAppEditor.destroy()` when the app removes the editor.

Options: `open`, `persist`, `storageKey`, `initialZoom`, and `onChange(changes)`. `initialZoom` defaults to `0.8`. Each edit session starts from the current page. Set `persist: true` to save and restore drafts. For a script tag, use `data-persist="true"`.

## Save

**copy change instructions** copies a prompt for Codex. Paste it into the website project to apply the edits to its files.

The prompt treats canvas coordinates as the visual target. It asks Codex to match the edits through the real page layout. It also asks for checks on wide and narrow screens.

**Reset** asks twice before it removes the edits and copies the current page again.

New items appear in the saved changes with their type, HTML, and position. Undo, redo, groups, and delete also work on new items.

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
InAppEditor.addItem('button');
InAppEditor.addItem('icon', { icon: 'heart-outline' });
await InAppEditor.fitToContent();
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

## Demo

To try the demo in this repo:

```sh
npm start
```

Open [localhost:4317](http://localhost:4317). This command starts a local server for the demo only.

## Checks

```sh
npm run check
npm test
```

Tests need Chrome. Set `CHROME_PATH` if Chrome uses another path.

[PROMPT.md](./PROMPT.md) contains the setup prompt. The **Publish demo** GitHub workflow publishes the demo when you start it.

The editor includes the [Ionicons](https://github.com/ionic-team/ionicons) set from the UI design editor. Its license stays in `in-app-editor.js`.
