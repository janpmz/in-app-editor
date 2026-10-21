# Add the editor to a website

Follow these steps in the website project.

1. Read [README.md](./README.md). Use the latest `main` branch of this repo.
2. Copy `in-app-editor.js` and `LICENSE` into the website project. Include `index.js` if you use imports.
3. Load the editor once in the browser after the page is ready. Use the site's current setup.
4. Show the **EDIT** button in local builds and private previews only.
5. Keep the site's design and behavior unchanged outside edit mode.
6. Use the editor's separate page copy for free movement and visual edits. Keep the source page unchanged.
7. Keep draft storage off. Each edit session must start from the current page.
8. Check selection, movement, corner scaling, side resizing, text edits, undo, and exit.

The editor runs in the browser. It needs no separate server. Do not copy this repo's demo page or `server.mjs` into the website.

See the README for script and import examples. Load imports only in the browser. Call `InAppEditor.destroy()` when the app removes the editor.

After editing, the user clicks **copy change instructions** and pastes the result into Codex in the website project.

Those instructions describe the visual target from the canvas. Apply the changes through the real page layout. Do not copy canvas coordinates into absolute positions just to match the canvas.
