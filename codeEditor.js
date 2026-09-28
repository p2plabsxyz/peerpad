import { $, loadingSpinner, backdrop, iframe } from './common.js'; // Import common functions

// Language mode per pane. htmlmixed keeps inline <script> and <style> coloured
// the same way the published file will read.
const EDITOR_MODES = {
    '#htmlCode': 'htmlmixed',
    '#javascriptCode': 'javascript',
    '#cssCode': 'css'
};

// Turn a plain textarea into a CodeMirror editor with line numbers and syntax
// colours, without any of the surrounding code having to know about it: the
// rest of the app talks to these panes through `textarea.value` and `input`
// events (drafts, fetched projects, AI output), so both keep working below.
function createEditor(selector, mode) {
    const textarea = $(selector);
    const editor = CodeMirror.fromTextArea(textarea, {
        mode,
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        autoCloseBrackets: true,
        autoCloseTags: mode === 'htmlmixed',
        indentUnit: 2,
        tabSize: 2,
        placeholder: textarea.placeholder,
        theme: 'peerpad'
    });

    // Point textarea.value at the editor's document. fromTextArea only syncs
    // the two on save, which is too late for code that reads a pane mid-edit.
    Object.defineProperty(textarea, 'value', {
        configurable: true,
        get: () => editor.getValue(),
        set: (next) => {
            const text = next == null ? '' : String(next);
            if (text === editor.getValue()) {
                return;
            }
            editor.setValue(text);
        }
    });

    // Replay edits as an `input` event so the listeners already bound to the
    // textareas -- live preview here, draft autosave in dweb.js -- still fire.
    editor.on('change', () => {
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    return editor;
}

// A published copy of PeerPad can end up served without its lib/ folder. Leave
// the plain textareas in place in that case instead of taking the whole editor
// down with a ReferenceError.
const hasCodeMirror = typeof CodeMirror !== 'undefined';

export const editors = hasCodeMirror
    ? Object.fromEntries(
        Object.entries(EDITOR_MODES).map(([selector, mode]) => [selector, createEditor(selector, mode)])
    )
    : {};

// CodeMirror ships one palette per theme, but Peersky restyles the page under
// us. Pick the palette from how light the resolved text colour is, which reads
// correctly on every browser theme including the transparent one.
function syncEditorContrast() {
    const color = getComputedStyle(document.body).color;
    const channels = color.match(/[\d.]+/g);
    if (!channels) {
        return;
    }
    const [r, g, b] = channels.slice(0, 3).map(Number);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    document.documentElement.dataset.cmContrast = luminance > 0.5 ? 'dark' : 'light';
}

if (hasCodeMirror) {
    syncEditorContrast();
    new MutationObserver(syncEditorContrast).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
} else {
    console.warn('[codeEditor] CodeMirror did not load; falling back to plain textareas.');
}

// Attach event listeners directly using the $ selector function
[$('#htmlCode'), $('#javascriptCode'), $('#cssCode')].forEach(element => {
    element.addEventListener('input', () => update());
});

// CSS for published files: default white background, black text
export let basicCSS = `
    body {
        font-size: 1.2rem;
        margin: 0;
        padding: 0;
        background: #FFFFFF;
        color: #000000;
    }
`;

// CSS for iframe preview: Use current theme colors
function getPreviewCSS() {
    const computedStyle = getComputedStyle(document.documentElement);
    const bgColor = computedStyle.getPropertyValue('--browser-theme-background').trim();
    const textColor = computedStyle.getPropertyValue('--browser-theme-text-color').trim();
    
    return `
        :root {
            --browser-theme-background: ${bgColor};
            --browser-theme-text-color: ${textColor};
        }
        body {
            font-size: 1.2rem;
            margin: 0;
            padding: 0;
            background: var(--browser-theme-background);
            color: var(--browser-theme-text-color);
        }
    `;
}

// Function for live rendering
export function update() {
    let htmlCode = $('#htmlCode').value;
    console.log('HTML Code:', htmlCode);
    let cssCode = $('#cssCode').value;
    console.log('CSS Code:', cssCode);
    let javascriptCode = $('#javascriptCode').value;
    console.log('JavaScript Code:', javascriptCode);
    // Assemble all elements for the iframe preview, using dynamic theme CSS
    let iframeContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <style>${getPreviewCSS()}</style>
        <style>${cssCode}</style>
    </head>
    <body>
        ${htmlCode}
        <script>${javascriptCode}</script>
    </body>
    </html>
    `;
    
    let iframeDoc = iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(iframeContent);
    iframeDoc.close();
}

// Show or hide the loading spinner
export function showSpinner(show) {
    backdrop.style.display = show ? 'block' : 'none';
    loadingSpinner.style.display = show ? 'block' : 'none';
}