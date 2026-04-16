import { $ } from './common.js';
import { update } from './codeEditor.js';
import { scheduleDraftSave } from './dweb.js';

const APP_ID = 'peerpad';
const SYSTEM_PROMPT = 'You are a programmer\'s assistant that helps users create simple web pages.';
const PREFIX_MESSAGE = { role: 'system', content: SYSTEM_PROMPT };

const toggleAiButton = $('#toggleAiButton');
const aiContainer = $('#ai-container');
const aiPromptBox = $('#aiPromptBox');
const generateButton = $('#generateButton');
const showAiLogButton = $('#showAiLog');
const closeAiLogButton = $('#closeAiLog');
const aiLogDialog = $('#aiLogDialog');
const aiLogs = $('#aiLogs');

const htmlCodeArea = $('#htmlCode');
const cssCodeArea = $('#cssCode');
const javascriptCodeArea = $('#javascriptCode');

try {
    const saved = localStorage.getItem('editor-ai-prompt');
    if (saved?.trim()) aiPromptBox.value = saved;
} catch { }

aiPromptBox.addEventListener('input', () => {
    try { localStorage.setItem('editor-ai-prompt', aiPromptBox.value.trim()); }
    catch { }
});

toggleAiButton.addEventListener('click', () => aiContainer.classList.toggle('hidden'));
const showAiLogEl = $('#showAiLog');
if (showAiLogEl) showAiLogEl.style.marginLeft = '8px';
showAiLogButton.addEventListener('click', () => aiLogDialog.showModal());
closeAiLogButton.addEventListener('click', () => aiLogDialog.close());

// History button (appended beside Generate / Open Logs)
const aiButtonsEl = $('#ai-buttons');
if (aiButtonsEl) {
    const historyBtn = document.createElement('button');
    historyBtn.textContent = '🕘 History';
    historyBtn.style.marginLeft = '8px';
    aiButtonsEl.appendChild(historyBtn);

    let historyDialog = null;

    function ensureHistoryDialog() {
        if (historyDialog) return historyDialog;
        historyDialog = document.createElement('dialog');
        historyDialog.style.cssText =
            'width:520px;max-width:95vw;max-height:80vh;overflow-y:auto;border-radius:10px;' +
            'padding:16px;' +
            'background:var(--peersky-nav-background,var(--base02,var(--browser-theme-background,#18181c)));' +
            'color:var(--browser-theme-text-color,#e5e5e5);' +
            'border:1px solid var(--base04,color-mix(in srgb,var(--browser-theme-text-color,#e5e5e5) 22%,var(--browser-theme-background,#18181c)));';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
        const title = document.createElement('strong');
        title.textContent = 'AI Generation History';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:inherit';
        closeBtn.addEventListener('click', () => historyDialog.close());
        header.append(title, closeBtn);

        const listEl = document.createElement('div');
        listEl.id = 'ppHistoryList';
        listEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';

        historyDialog.append(header, listEl);
        document.body.appendChild(historyDialog);
        return historyDialog;
    }

    historyBtn.addEventListener('click', async () => {
        const dlg = ensureHistoryDialog();
        const listEl = dlg.querySelector('#ppHistoryList');
        listEl.textContent = 'Loading\u2026';
        dlg.showModal();

        let enabled = false;
        try { enabled = window.llmMemory ? await window.llmMemory.isEnabled() : false; }
        catch { enabled = false; }

        if (!enabled) {
            listEl.textContent = '';
            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:13px;color:#888';
            msg.textContent = 'Memory is disabled. Enable it in Settings \u2192 AI / LLMs.';
            listEl.appendChild(msg);
            return;
        }

        let entries;
        try { entries = await window.llmMemory.list({ appId: APP_ID, limit: 200 }); }
        catch { entries = []; }
        const userEntries = entries.filter(e => e.role === 'user').reverse();

        if (!userEntries.length) {
            listEl.textContent = '';
            const msg = document.createElement('div');
            msg.style.cssText = 'color:#888;font-size:13px';
            msg.textContent = 'No history yet.';
            listEl.appendChild(msg);
            return;
        }

        listEl.textContent = '';
        for (const entry of userEntries) {
            const card = document.createElement('div');
            card.style.cssText =
                'padding:10px 12px;border:1px solid var(--browser-theme-border,#333);' +
                'border-radius:8px;cursor:pointer;font-size:13px;transition:background 0.12s;background:transparent';
            const titleDiv = document.createElement('div');
            titleDiv.style.cssText = 'font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:transparent';
            titleDiv.textContent = entry.content.slice(0, 100).replace(/\n/g, ' ');
            const metaDiv = document.createElement('div');
            metaDiv.style.cssText = 'font-size:11px;color:#888;margin-top:3px;background:transparent';
            metaDiv.textContent = relTime(entry.ts);
            /* titleDiv and metaDiv moved into cardInfo above */

            card.addEventListener('mouseenter', () => { card.style.background = 'var(--browser-theme-hover,rgba(255,255,255,0.07))'; });
            card.addEventListener('mouseleave', () => { card.style.background = ''; });
            card.addEventListener('click', async (ev) => {
                if (ev.target.closest('.history-del-btn')) return;
                let sessionEntries;
                try { sessionEntries = await window.llmMemory.list({ sessionId: entry.sessionId }); }
                catch { sessionEntries = []; }
                const assistant = sessionEntries.find(e => e.role === 'assistant');
                if (assistant?.content) {
                    try {
                        const parsed = JSON.parse(assistant.content);
                        if (parsed.html != null) htmlCodeArea.value = parsed.html;
                        if (parsed.css  != null) cssCodeArea.value = parsed.css;
                        if (parsed.js   != null) javascriptCodeArea.value = parsed.js;
                    } catch {
                        htmlCodeArea.value = assistant.content;
                    }
                    update();
                    scheduleDraftSave();
                }
                dlg.close();
                aiContainer.classList.remove('hidden');
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'history-del-btn';
            delBtn.title = 'Delete';
            delBtn.textContent = '\u2715';
            delBtn.style.cssText =
                'all:unset;cursor:pointer;margin-left:auto;padding:2px 6px;border-radius:4px;' +
                'font-size:11px;color:var(--settings-danger-color-hover,#c62828);flex-shrink:0;';
            delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'rgba(198,40,40,0.12)'; });
            delBtn.addEventListener('mouseleave', () => { delBtn.style.background = ''; });
            delBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                if (!window.llmMemory) return;
                try { await window.llmMemory.clear({ sessionId: entry.sessionId }); } catch {}
                card.remove();
                if (!listEl.children.length) {
                    const msg = document.createElement('div');
                    msg.style.cssText = 'color:#888;font-size:13px';
                    msg.textContent = 'No history yet.';
                    listEl.appendChild(msg);
                }
            });
            card.style.display = 'flex';
            card.style.alignItems = 'flex-start';
            card.style.gap = '8px';
            const cardInfo = document.createElement('div');
            cardInfo.style.cssText = 'flex:1;min-width:0';
            cardInfo.append(titleDiv, metaDiv);
            card.append(cardInfo, delBtn);
            listEl.appendChild(card);
        }
    });
}

// Memory helpers
function genSessionId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function saveGenToMemory(prompt, output) {
    if (!window.llmMemory) return;
    let enabled = false;
    try { enabled = await window.llmMemory.isEnabled(); } catch { return; }
    if (!enabled) return;
    const sessionId = genSessionId();
    const ts = new Date().toISOString();
    try {
        await window.llmMemory.add({ appId: APP_ID, sessionId, role: 'user', content: prompt, model: '', ts });
        await window.llmMemory.add({ appId: APP_ID, sessionId, role: 'assistant', content: output, model: '', ts });
    } catch { /* best-effort */ }
}

function relTime(ts) {
    if (!ts) return '';
    const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
}

async function buildMemoryContext() {
    if (!window.llmMemory) return '';
    let enabled = false;
    try { enabled = await window.llmMemory.isEnabled(); } catch { return ''; }
    if (!enabled) return '';
    try {
        const recent = await window.llmMemory.list({ limit: 50 });
        if (!recent.length) return '';
        const lines = recent.map(e =>
            '[' + e.appId + ' ' + (e.ts || '').slice(0, 16) + '] ' + e.role + ': ' + e.content.slice(0, 300)
        );
        return '\n\nThe user\'s recent activity across PeerSky apps (use as context when relevant):\n' + lines.join('\n');
    } catch { return ''; }
}

// Generate button
generateButton.addEventListener('click', async () => {
    const prompt = aiPromptBox.value.trim();
    if (!prompt) { alert('Please enter a description of what you want to create!'); return; }

    aiLogs.innerHTML = '';
    aiLogDialog.showModal();

    try {
        log('Starting generation', prompt);

        const memCtx = await buildMemoryContext();
        const sysMsg = { role: 'system', content: SYSTEM_PROMPT + memCtx };

        log('Generating metadata');
        const metadata = await makeMetadata(prompt);
        log('Metadata', JSON.stringify(metadata, null, 2));

        log('Making step by step plan');
        const plan = await makePlan(prompt, metadata, sysMsg);
        log('Generated plan', plan);

        log('Generating HTML...');
        const html = await makeHTML(prompt, metadata, plan, sysMsg);
        log('HTML Generated', html);
        htmlCodeArea.value = html;
        update();

        log('Generating JavaScript...');
        const js = await makeJS(prompt, metadata, plan, html, sysMsg);
        log('JavaScript Generated', js);
        javascriptCodeArea.value = js;
        update();

        log('Generating CSS...');
        const css = await makeCSS(prompt, metadata, plan, html, sysMsg);
        log('CSS Generated', css);
        cssCodeArea.value = css;
        update();
        scheduleDraftSave();

        log('Generation Complete!', 'Your web page has been generated successfully!');

        await saveGenToMemory(prompt, JSON.stringify({ html, css, js }));
    } catch (error) {
        console.error('Generation error:', error);
        log('Error', error.message || String(error));
    }
});

function log(label, ...messages) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    aiLogs.appendChild(dt);
    for (const message of messages) {
        const dd = document.createElement('dd');
        dd.textContent = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
        aiLogs.appendChild(dd);
    }
    aiLogDialog.scrollTop = aiLogDialog.scrollHeight;
}

function extractSection(content, startText, endText) {
    const startIdx = content.indexOf(startText);
    if (startIdx === -1) return content;
    const start = startIdx + startText.length;
    const end = content.indexOf(endText, start);
    if (end === -1) return content;
    return content.slice(start, end);
}

async function chat(messages, opts = {}) {
    if (!window.llm || !window.llm.chat) {
        throw new Error('LLM API not available. Please enable LLM in settings.');
    }
    return window.llm.chat({ messages, ...opts });
}

async function makeMetadata(description) {
    const content = `I have a web page I'm trying to make with the following description:
${description}

I want you to come up with a descriptive name for this page.
Make it whimsical and include the main function.

Output in the form of a JSON object that looks like this:
{"name":"Name here"}`;

    const { content: result } = await chat([{ role: 'user', content }]);
    const data = extractSection(result, '{', '}');
    try { return JSON.parse('{' + data + '}'); }
    catch { return { name: 'Generated Page' }; }
}

async function makePlan(description, { name }, sysMsg = PREFIX_MESSAGE) {
    const content = `I would like to make a web page that does the following:
${description}

I'm going to call it "${name}".
Plan how this page should work step by step.
You cannot rely on external files, if you need an image use a unicode symbol, emoji, or make an inline SVG.
Assume the general structure is taken care of, focus on the contents.
What elements do we need in the HTML and what are their IDs?
What function names do we need in the JavaScript?
How should we style layout with CSS?
Do we need user input via forms or keyboard and mouse?
Do not write any code, just the high level description.
Do not provide an example.`;

    const result = await chat([sysMsg, { role: 'user', content }], { stop: ['```'] });
    return result.content;
}

async function makeHTML(prompt, { name }, plan, sysMsg = PREFIX_MESSAGE) {
    const content = `I'm planning to make a web page called ${name} with the following description:
${prompt}

Here are the more detailed plans:
${plan}

Now make the HTML for the page.
Just output the body content, don't include html, head, body tags.
You can call JS functions from event handlers like onclick.
Use HTML5 semantic elements where appropriate.
Use the id attribute for elements that will be dynamically modified by JavaScript.
Don't use images unless the user told you their URLs.
Instead of images make SVG or use an emoji.
Make sure to define all elements from the plan.
Don't include any script tags or styles.
No inline CSS either.
Output only the HTML code.`;

    const { content: result } = await chat([sysMsg, { role: 'user', content }], { stop: ['<script'] });
    if (result.includes('```html')) return extractSection(result, '```html', '```');
    if (result.includes('```')) return extractSection(result, '```', '```');
    return result;
}

async function makeJS(prompt, { name }, plan, html, sysMsg = PREFIX_MESSAGE) {
    const content = `I'm planning to make a web page called ${name} with the following description:
${prompt}

Here are the more detailed plans:
${plan}

Only follow the JavaScript related plans.

Here's the HTML for the page:
\`\`\`html
${html}
\`\`\`

Now make the JavaScript for the page.
Use let and const for variable names.
Use element.onclick for event handlers.
Use console.log to log steps as they happen.
Make sure to define all the functions from the plan.
Do not use DOMContentLoaded or window.onload.
Only output the JavaScript and nothing else.
Output the JavaScript code inside a code block like this:
\`\`\`javascript
Code Here
\`\`\``;

    const { content: result } = await chat([sysMsg, { role: 'user', content }], { stop: ['```\n'] });
    if (result.includes('<script>')) return extractSection(result, '<script>', '</script>');
    if (result.includes('```javascript')) return extractSection(result, '```javascript', '```');
    if (result.includes('```')) return extractSection(result, '```', '```');
    return result;
}

async function makeCSS(prompt, { name }, plan, html, sysMsg = PREFIX_MESSAGE) {
    const content = `I'm planning to make a web page called ${name} with the following description:
${prompt}

Here's the HTML for the page:
\`\`\`html
${html}
\`\`\`

Here are the more detailed plans:
${plan}

Follow just the CSS related plans.

Now make the CSS for the page.
Use flexbox or grid for layout if needed.
Keep it minimal and functional.
Focus on layout, spacing, and basic styling.
Only provide the CSS and nothing else.
Output the CSS code inside a code block like:
\`\`\`css
Code Here
\`\`\``;

    const result = await chat([sysMsg, { role: 'user', content }], { stop: ['```\n'] });
    let css = result.content;
    if (css.includes('```css')) css = extractSection(css, '```css', '```');
    else if (css.includes('```')) css = extractSection(css, '```', '```');
    if (css.includes('<style>')) css = extractSection(css, '<style>', '</style>');
    return css;
}
