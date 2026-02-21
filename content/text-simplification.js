let systemPrompt = null;
let isSimplifying = false;
let aiAvailable = null;

function getReadingLevel() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['simplificationLevel', 'readingLevel'], (result) => {
            resolve(result.simplificationLevel || result.readingLevel || '3');
        });
    });
}

function checkAIAvailability() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: 'checkPromptAPI' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ available: false, status: 'error' });
                    return;
                }
                resolve(response || { available: false, status: 'unknown' });
            });
        } catch (e) {
            resolve({ available: false, status: 'error' });
        }
    });
}

function loadSystemPrompts() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: 'getSystemPrompts' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(response?.prompts || null);
            });
        } catch (e) {
            resolve(null);
        }
    });
}

function simplifyTextViaBackground(text, sysPrompt) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(
                { action: 'simplifyText', text, systemPrompt: sysPrompt },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (response?.success) {
                        resolve(response.simplifiedText);
                    } else {
                        reject(new Error(response?.error || 'Simplification failed'));
                    }
                }
            );
        } catch (e) {
            reject(e);
        }
    });
}

async function loadCurrentSystemPrompt() {
    const prompts = await loadSystemPrompts();
    if (!prompts) return null;

    const readingLevel = await getReadingLevel();
    const optimizeFor = await new Promise((resolve) => {
        chrome.storage.sync.get(['optimizeFor'], (result) => {
            resolve(result.optimizeFor || 'textClarity');
        });
    });

    return prompts[optimizeFor]?.[readingLevel] || prompts.textClarity['3'];
}

async function ensureInitialized() {
    if (aiAvailable === null) {
        const result = await checkAIAvailability();
        aiAvailable = result.available;
    }
    if (!systemPrompt) {
        systemPrompt = await loadCurrentSystemPrompt();
    }
}

function showToast(msg, bgColor, duration = 8000) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        padding: 12px 24px; border-radius: 8px; color: white;
        font-size: 14px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        background-color: ${bgColor || '#0D9488'}; transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

const METADATA_SELECTORS = [
    '.author', '.byline', '.date', '.meta', '.tags', '.social', '.share',
    '.comments', '.sidebar', '.nav', '.footer', '.header', '.ad',
    '.advertisement', '.related', '.recommended'
];

function isMetadataElement(el) {
    for (const selector of METADATA_SELECTORS) {
        if (el.closest(selector)) return true;
    }
    return false;
}

async function simplifyPageContent() {
    if (isSimplifying) return { success: false, error: 'Already simplifying' };
    isSimplifying = true;

    try {
        await ensureInitialized();

        if (!aiAvailable) {
            showToast(
                'AI not available. Enable these Chrome flags:\n' +
                'chrome://flags/#prompt-api-for-gemini-nano\n' +
                'chrome://flags/#summarization-api-for-gemini-nano\n' +
                'chrome://flags/#optimization-guide-on-device-model',
                '#EF4444', 12000
            );
            return { success: false, error: 'AI not available' };
        }

        // Reload system prompt
        systemPrompt = await loadCurrentSystemPrompt();

        // Content extraction - try selectors in order
        const contentSelectors = [
            'main article', 'article', '.post-content', '.entry-content',
            '.article-body', '[itemprop="articleBody"]', '.content', '#content',
            'main', '.main', '[role="main"]', 'body'
        ];

        let container = null;
        for (const selector of contentSelectors) {
            container = document.querySelector(selector);
            if (container) break;
        }

        if (!container) {
            showToast('Could not find page content', '#EF4444', 5000);
            return { success: false, error: 'No content found' };
        }

        // Extract text elements
        const elements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, dl');
        const validElements = Array.from(elements).filter(el => !isMetadataElement(el) && el.textContent.trim());

        if (validElements.length === 0) {
            showToast('No text content found to simplify', '#EF4444', 5000);
            return { success: false, error: 'No text elements' };
        }

        // Chunking - groups of ~800 tokens
        const chunks = [];
        let currentChunk = [];
        let currentTokens = 0;

        for (const el of validElements) {
            const text = el.textContent.trim();
            const tokens = estimateTokens(text);
            const isHeader = /^H[1-6]$/.test(el.tagName);
            const isList = /^(UL|OL|DL)$/.test(el.tagName);

            if (isHeader || isList) {
                if (currentChunk.length > 0) {
                    chunks.push([...currentChunk]);
                    currentChunk = [];
                    currentTokens = 0;
                }
            }

            if (currentTokens + tokens > 800 && currentChunk.length > 0) {
                chunks.push([...currentChunk]);
                currentChunk = [];
                currentTokens = 0;
            }

            currentChunk.push(el);
            currentTokens += tokens;
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }

        // Process each chunk
        for (const chunk of chunks) {
            // Skip single-header chunks
            if (chunk.length === 1 && /^H[1-6]$/.test(chunk[0].tagName)) continue;

            const nonHeaderElements = chunk.filter(el => !/^H[1-6]$/.test(el.tagName));
            if (nonHeaderElements.length === 0) continue;

            const textToSimplify = nonHeaderElements.map(el => el.textContent.trim()).join('\n\n');

            let simplified = null;
            for (let retry = 0; retry < 5; retry++) {
                try {
                    simplified = await simplifyTextViaBackground(textToSimplify, systemPrompt);
                    if (simplified) break;
                } catch (e) {
                    if (retry < 4) await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (!simplified) continue;

            const simplifiedParts = simplified.split('\n\n').filter(p => p.trim());

            // Match simplified paragraphs to original DOM elements
            const targetElements = nonHeaderElements;
            const partsToApply = simplifiedParts.length > targetElements.length
                ? simplifiedParts.slice(0, targetElements.length)
                : simplifiedParts;

            // If fewer simplified parts, remove excess originals
            if (simplifiedParts.length < targetElements.length) {
                for (let i = simplifiedParts.length; i < targetElements.length; i++) {
                    targetElements[i].style.display = 'none';
                }
            }

            for (let i = 0; i < partsToApply.length; i++) {
                const originalEl = targetElements[i];
                const simplifiedText = partsToApply[i];

                // Store original
                const originalHtml = originalEl.innerHTML;
                const originalText = originalEl.textContent;

                let newEl;
                if (/^(UL|OL|DL)$/.test(originalEl.tagName)) {
                    newEl = document.createElement(originalEl.tagName);
                    const items = simplifiedText.split('\n').filter(l => l.trim());
                    for (const item of items) {
                        const li = document.createElement('li');
                        li.textContent = item.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '');
                        newEl.appendChild(li);
                    }
                } else {
                    newEl = document.createElement('p');
                    if (typeof marked !== 'undefined' && marked.parse) {
                        newEl.innerHTML = marked.parse(simplifiedText);
                    } else {
                        newEl.textContent = simplifiedText;
                    }
                }

                newEl.classList.add('simplified-text');
                newEl.setAttribute('data-original-html', originalHtml);
                newEl.setAttribute('data-original-text', originalText);

                originalEl.parentNode.replaceChild(newEl, originalEl);

                // Add hover listeners if enabled
                if (hoverEnabled) {
                    newEl.addEventListener('mouseenter', showOriginalText);
                    newEl.addEventListener('mouseleave', hideOriginalText);
                }

                // Check OpenDyslexic
                if (fontEnabled) {
                    newEl.style.fontFamily = "'OpenDyslexic', sans-serif";
                }
            }
        }

        showToast('✨ Text simplified', '#0D9488', 3000);
        return { success: true };
    } finally {
        isSimplifying = false;
    }
}
