import './in-app-editor.js';

const editor = globalThis.InAppEditor;
export const mountEditor = (options) => editor.mount(options);
export const destroyEditor = () => editor.destroy();
export default editor;
