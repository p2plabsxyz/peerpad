import { update, showSpinner, basicCSS } from './codeEditor.js';
import { $, uploadButton, protocolSelect, fetchButton, fetchCidInput } from './common.js';

// Safe localStorage access helpers
function safeLocalStorageGet(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn(`[safeLocalStorageGet] localStorage not available:`, e);
        return null;
    }
}
function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn(`[safeLocalStorageSet] localStorage not available:`, e);
    }
}

const DRIVE_NAME = 'p2p-editor';
const DRAFT_DRIVE_NAME = 'p2p-editor-drafts';
const DRAFT_FILE = 'draft.json';
const DRIVE_LOOKUP_TIMEOUT_MS = 4000;
const DRAFT_DRIVE_LOOKUP_TIMEOUT_MS = 2000;
const DRIVE_LOOKUP_ATTEMPTS = 3;
const DRIVE_LOOKUP_RETRY_DELAY_MS = 250;
let draftDriveUrl = null;
let draftDrivePending = null;
let saveTimer = null;
let lastDraftPayload = null;
const saveDelay = 400;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Without a timeout a silent hyper node leaves the caller waiting forever,
// which is how the publish spinner ends up spinning with nothing behind it.
async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Resolving a named drive is the first thing that touches the hyper node, and
// the very first POST for a name it has never opened can hang or come back 500
// while the SDK is still warming up. A later POST for the same name answers
// immediately, so abandon a stalled attempt and ask again instead of failing
// the whole publish on one cold call.
async function resolveDriveUrl(name, timeoutMs) {
    let lastError;
    for (let attempt = 1; attempt <= DRIVE_LOOKUP_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetchWithTimeout(
                `hyper://localhost/?key=${encodeURIComponent(name)}`,
                { method: 'POST' },
                timeoutMs
            );
            if (!response.ok) {
                throw new Error(`Failed to generate Hyperdrive key: ${response.statusText}`);
            }
            const url = (await response.text()).trim();
            if (!url.startsWith('hyper://')) {
                throw new Error(`Invalid Hyperdrive URL received: ${url}`);
            }
            return url;
        } catch (error) {
            lastError = error;
            console.warn(`[resolveDriveUrl] Attempt ${attempt}/${DRIVE_LOOKUP_ATTEMPTS} for "${name}" failed:`, error);
            if (attempt < DRIVE_LOOKUP_ATTEMPTS) {
                await delay(DRIVE_LOOKUP_RETRY_DELAY_MS);
            }
        }
    }
    throw lastError;
}

const htmlCodeArea = $('#htmlCode');
const cssCodeArea = $('#cssCode');
const javascriptCodeArea = $('#javascriptCode');
const titleInput = $('#titleInput');
const clearDraftButton = $('#clearDraftButton');

// Read protocol from URL param or localStorage, default to 'ipfs'
const urlParams = new URLSearchParams(window.location.search);
const paramProtocol = urlParams.get('protocol');
const storedProtocol = safeLocalStorageGet('lastProtocol');
const initialProtocol = paramProtocol || storedProtocol || 'hyper';
protocolSelect.value = initialProtocol;

// Toggle title input visibility based on protocol
function toggleTitleInput() {
    if (protocolSelect.value === 'hyper') {
        titleInput.classList.remove('hidden');
        titleInput.setAttribute('required', '');
    } else {
        titleInput.classList.add('hidden');
        titleInput.removeAttribute('required');
    }
}

async function getDraftDriveUrl() {
    if (draftDriveUrl) {
        return draftDriveUrl;
    }
    // loadDraft and the first autosave both reach for the drive on startup;
    // share one lookup so they do not open the same drive twice.
    if (!draftDrivePending) {
        draftDrivePending = resolveDriveUrl(DRAFT_DRIVE_NAME, DRAFT_DRIVE_LOOKUP_TIMEOUT_MS)
            .then((url) => {
                draftDriveUrl = url;
                return url;
            })
            .finally(() => {
                draftDrivePending = null;
            });
    }
    return draftDrivePending;
}

function buildDraftPayload() {
    return {
        html: htmlCodeArea.value,
        css: cssCodeArea.value,
        javascript: javascriptCodeArea.value,
        title: titleInput.value,
        protocol: protocolSelect.value,
        updatedAt: Date.now()
    };
}

async function writeDraft(payload) {
    const driveUrl = await getDraftDriveUrl();
    const url = `${driveUrl}${DRAFT_FILE}`;
    const response = await fetch(url, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: {
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to save draft: ${response.statusText}`);
    }
}

async function saveDraft({ force = false } = {}) {
    try {
        const payload = buildDraftPayload();
        const serialized = JSON.stringify(payload);
        if (!force && serialized === lastDraftPayload) {
            return;
        }
        lastDraftPayload = serialized;
        await writeDraft(payload);
    } catch (error) {
        console.error('[saveDraft] Error saving draft:', error);
    }
}

export function scheduleDraftSave() {
    if (saveTimer) {
        clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
        saveDraft();
    }, saveDelay);
}

async function loadDraft() {
    try {
        const driveUrl = await getDraftDriveUrl();
        const url = `${driveUrl}${DRAFT_FILE}`;
        const response = await fetch(url);
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        if (!data || data.isCleared) {
            return;
        }
        if (typeof data.html === 'string') {
            htmlCodeArea.value = data.html;
        }
        if (typeof data.css === 'string') {
            cssCodeArea.value = data.css;
        }
        if (typeof data.javascript === 'string') {
            javascriptCodeArea.value = data.javascript;
        }
        if (typeof data.title === 'string') {
            titleInput.value = data.title;
        }
        if (typeof data.protocol === 'string' && !paramProtocol) {
            protocolSelect.value = data.protocol;
            safeLocalStorageSet('lastProtocol', data.protocol);
            toggleTitleInput();
            updateSelectorURL();
        }
        update();
    } catch (error) {
        console.error('[loadDraft] Error loading draft:', error);
    }
}

async function clearDraft() {
    try {
        const driveUrl = await getDraftDriveUrl();
        const url = `${driveUrl}${DRAFT_FILE}`;
        const response = await fetch(url, { method: 'DELETE' });
        if (response.ok || response.status === 404) {
            return;
        }
    } catch (error) {
        console.error('[clearDraft] Error deleting draft:', error);
    }
    try {
        await writeDraft({ isCleared: true, clearedAt: Date.now() });
    } catch (error) {
        console.error('[clearDraft] Error saving cleared draft:', error);
    }
}

// Initialize UI state
toggleTitleInput();
updateSelectorURL();
loadDraft();

// When protocol changes: update UI, localStorage, and URL
protocolSelect.addEventListener('change', () => {
    toggleTitleInput();
    safeLocalStorageSet('lastProtocol', protocolSelect.value);
    updateSelectorURL();
    scheduleDraftSave();
});

function updateSelectorURL() {
    const base = window.location.pathname + window.location.hash;
    const newURL = `${base}?protocol=${protocolSelect.value}`;
    history.replaceState(null, '', newURL);
}

// Assemble code before uploading
export async function assembleCode() {
    const protocol = protocolSelect.value;
    let fileName = 'index.html';

    if (protocol === 'hyper') {
        const title = $('#titleInput').value.trim();
        if (!title) {
            alert("Please enter a title for your project.");
            return;
        }
        fileName = `${title.replace(/\s+/g, '-').toLowerCase()}.html`;
    }

    // Display loading spinner
    showSpinner(true);

    // Combine your code into a single HTML file
    let combinedCode = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <style>${basicCSS}</style>
        <style>${$('#cssCode').value}</style>
    </head>
    <body>
        ${$('#htmlCode').value}
        <script>${$('#javascriptCode').value}</script>
    </body>
    </html>`;

    // Convert the combined code into a Blob
    const blob = new Blob([combinedCode], { type: 'text/html' });
    const file = new File([blob], fileName, { type: 'text/html' });

    // Upload the file
    await uploadFile(file);
    showSpinner(false);
}

uploadButton.addEventListener('click', assembleCode);

if (clearDraftButton) {
    clearDraftButton.addEventListener('click', async () => {
        htmlCodeArea.value = '';
        cssCodeArea.value = '';
        javascriptCodeArea.value = '';
        titleInput.value = '';
        update();
        lastDraftPayload = null;
        await clearDraft();
    });
}

[htmlCodeArea, cssCodeArea, javascriptCodeArea, titleInput].forEach((el) => {
    if (!el) {
        return;
    }
    el.addEventListener('input', () => {
        scheduleDraftSave();
    });
});

// Upload code to Dweb
async function uploadFile(file) {
    const protocol = protocolSelect.value;
    console.log(`[uploadFile] Uploading ${file.name}, protocol: ${protocol}`);

    try {
        let url;
        if (protocol === 'hyper') {
            // Resolved inside the try: a failed lookup used to escape past the
            // finally below, leaving the spinner up and the error only in the
            // console.
            const driveUrl = await getOrCreateHyperdrive();
            url = `${driveUrl}${encodeURIComponent(file.name)}`;
            console.log(`[uploadFile] Hyper URL: ${url}`);
        } else {
            url = `ipfs://bafyaabakaieac/${encodeURIComponent(file.name)}?peerskyOrigin=${encodeURIComponent(window.location.href)}`;
            console.log(`[uploadFile] IPFS URL: ${url}`);
        }

        const response = await fetch(url, {
            method: 'PUT',
            body: file, // Send raw file bytes
            headers: {
                'Content-Type': file.type || 'text/html'
            }
        });

        console.log(`[uploadFile] Response status: ${response.status}, ok: ${response.ok}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[uploadFile] Error uploading ${file.name}: ${errorText}`);
            addError(file.name, errorText);
            return;
        }

        const finalUrl = protocol === 'hyper' ? url : response.headers.get('Location');
        addURL(finalUrl);
    } catch (error) {
        console.error(`[uploadFile] Error uploading ${file.name}:`, error);
        addError(file.name, error.message);
    } finally {
        showSpinner(false);
    }
}

let hyperdriveUrl = null;
let hyperdrivePending = null;

async function getOrCreateHyperdrive() {
    if (hyperdriveUrl) {
        return hyperdriveUrl;
    }
    if (!hyperdrivePending) {
        hyperdrivePending = resolveDriveUrl(DRIVE_NAME, DRIVE_LOOKUP_TIMEOUT_MS)
            .then((url) => {
                hyperdriveUrl = url;
                console.log(`[getOrCreateHyperdrive] Hyperdrive URL: ${url}`);
                return url;
            })
            .catch((error) => {
                console.error('[getOrCreateHyperdrive] Error generating Hyperdrive key:', error);
                throw error;
            })
            .finally(() => {
                hyperdrivePending = null;
            });
    }
    return hyperdrivePending;
}

function addURL(url) {
    console.log(`[addURL] Adding URL: ${url}`);
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const copyContainer = document.createElement('span');
    const copyIcon = '⊕';
    copyContainer.innerHTML = copyIcon;
    copyContainer.onclick = async function() {
        let success = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
                success = true;
            } else {
                throw new Error('Clipboard API unavailable');
            }
        } catch (err) {
            console.warn('Clipboard API failed, attempting fallback...', err);
            const textArea = document.createElement("textarea");
            textArea.value = url;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();
            try {
                success = document.execCommand('copy');
            } catch (e) {
                console.error('Fallback copy failed:', e);
            }
            document.body.removeChild(textArea);
        }

        if (success) {
            copyContainer.textContent = ' Copied!';
            setTimeout(() => {
                copyContainer.innerHTML = copyIcon;
            }, 3000);
        } else {
            console.error('[addURL] Failed to copy URL to clipboard');
            alert('Failed to copy URL to clipboard');
        }
    };

    listItem.appendChild(link);
    listItem.appendChild(copyContainer);
    uploadListBox.appendChild(listItem);
}

function addError(name, text) {
    console.log(`[addError] Error in ${name}: ${text}`);
    uploadListBox.innerHTML += `<li class="log">Error in ${name}: ${text}</li>`;
}

// The fetchFromDWeb function detects which protocol is used and fetches the content
async function fetchFromDWeb(url) {
    console.log(`[fetchFromDWeb] Fetching URL: ${url}`);
    if (!url) {
        alert("Please enter a CID or Name.");
        return;
    }

    if (!url.startsWith('ipfs://') && !url.startsWith('hyper://')) {
        alert("Invalid protocol. URL must start with ipfs:// or hyper://");
        return;
    }

    try {
        const response = await fetch(url);
        console.log(`[fetchFromDWeb] Response status: ${response.status}`);
        const data = await response.text();
        parseAndDisplayData(data);
    } catch (error) {
        console.error("[fetchFromDWeb] Error fetching from DWeb:", error);
        alert("Failed to fetch from DWeb.");
    }
}

// Modified event listener for fetchButton
fetchButton.addEventListener('click', () => {
    const cidOrName = fetchCidInput.value;
    fetchFromDWeb(cidOrName);
});

// Parse the data and display it in the code editor
function parseAndDisplayData(data) {
    console.log(`[parseAndDisplayData] Parsing received data`);
    const parser = new DOMParser();
    const doc = parser.parseFromString(data, 'text/html');

    // Extracting CSS
    const styleElements = Array.from(doc.querySelectorAll('style'));
    styleElements.shift(); // Remove the first element (basicCSS)
    let cssContent = styleElements.map(style => style.innerHTML).join('');

    // Extracting JavaScript
    const jsContent = doc.querySelector('script') ? doc.querySelector('script').innerHTML : '';

    // Remove script and style tags from the HTML content
    doc.querySelectorAll('script, style').forEach(el => el.remove());
    const htmlContent = doc.body.innerHTML; // Get the content inside the body tag without script/style tags

    // Displaying the content in respective textareas
    console.log(`[parseAndDisplayData] Setting HTML: ${htmlContent.substring(0, 50)}...`);
    console.log(`[parseAndDisplayData] Setting CSS: ${cssContent.substring(0, 50)}...`);
    console.log(`[parseAndDisplayData] Setting JS: ${jsContent.substring(0, 50)}...`);
    $('#htmlCode').value = htmlContent;
    $('#cssCode').value = cssContent;
    $('#javascriptCode').value = jsContent;
    update(0);
    scheduleDraftSave();
}
