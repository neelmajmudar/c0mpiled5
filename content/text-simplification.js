// ========================================
// MOLLITIAM - TEXT SIMPLIFICATION MODULE
// AI-powered text simplification via background script
// (self.ai is NOT available in content scripts — all AI runs in background.js)
// ========================================

let systemPrompt = null;
let isSimplifying = false;
let aiAvailable = null; // null = unchecked, true/false after check

// Get reading level from storage
async function getReadingLevel() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['readingLevel', 'simplificationLevel'], function(result) {
            if (result.simplificationLevel) {
                resolve(result.simplificationLevel.toString());
                return;
            }
            let level = result.readingLevel ? 
                result.readingLevel.toString() : 
                (typeof simplificationLevelsConfig !== 'undefined' && 
                 simplificationLevelsConfig.levels === 3 ? '3' : '3');
            resolve(level);
        });
    });
}

// Check if Prompt API is available (asks background script) with timeout
async function checkAIAvailability() {
    return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.warn('[Mollitiam] checkPromptAPI timed out after 10s');
                resolve({ available: false, status: 'timeout' });
            }
        }, 10000);
        try {
            chrome.runtime.sendMessage({ action: 'checkPromptAPI' }, (response) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    console.warn('[Mollitiam] Could not check AI availability:', chrome.runtime.lastError.message);
                    resolve({ available: false, status: 'error', detail: chrome.runtime.lastError.message });
                    return;
                }
                console.log('[Mollitiam] checkPromptAPI response:', response);
                resolve(response || { available: false, status: 'unknown' });
            });
        } catch (e) {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.error('[Mollitiam] checkPromptAPI exception:', e);
                resolve({ available: false, status: 'error', detail: e.message });
            }
        }
    });
}

// Load system prompts from background script
async function loadSystemPrompts() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getSystemPrompts' }, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (response && response.success) {
                resolve(response.prompts);
            } else {
                reject(new Error(response ? response.error : 'No response'));
            }
        });
    });
}

// Send text to background for AI simplification with timeout
async function simplifyTextViaBackground(text, sysPrompt) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('simplifyText timed out after 60s'));
            }
        }, 60000);
        try {
            chrome.runtime.sendMessage({
                action: 'simplifyText',
                text: text,
                systemPrompt: sysPrompt
            }, (response) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.simplifiedText);
                } else {
                    reject(new Error(response ? response.error : 'No response from background'));
                }
            });
        } catch (e) {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(e);
            }
        }
    });
}

// Load the system prompt based on user settings
async function loadCurrentSystemPrompt() {
    const loadedPrompts = await loadSystemPrompts();
    if (!loadedPrompts) throw new Error('Failed to load system prompts.');

    const readingLevel = await getReadingLevel();
    const optimizeFor = await new Promise((resolve) => {
        chrome.storage.sync.get(['optimizeFor'], (result) => {
            resolve(result.optimizeFor || 'textClarity');
        });
    });

    const prompt = loadedPrompts[optimizeFor][readingLevel];
    if (!prompt) throw new Error('System prompt is undefined for current settings.');
    return prompt;
}

// Initialize — just checks availability and loads prompt (no self.ai needed)
async function ensureInitialized() {
    if (aiAvailable === true && systemPrompt) return;
    
    console.log('[Mollitiam] ensureInitialized: checking AI availability...');
    const status = await checkAIAvailability();
    console.log('[Mollitiam] AI availability result:', JSON.stringify(status));
    aiAvailable = status.available || status.status === 'after-download';
    
    if (aiAvailable) {
        try {
            systemPrompt = await loadCurrentSystemPrompt();
            console.log('[Mollitiam] System prompt loaded successfully, AI ready');
        } catch (e) {
            console.warn('[Mollitiam] Failed to load system prompt:', e.message);
            // Reset aiAvailable if we can't get the prompt
            systemPrompt = null;
        }
    } else {
        console.warn('[Mollitiam] AI not available. Status:', status.status, 'Detail:', status.detail || 'none');
    }
}

// Show a toast notification
function showToast(msg, bgColor, duration = 8000) {
    const notice = document.createElement('div');
    notice.style.cssText = `position:fixed;top:20px;left:50%;transform:translateX(-50%);color:white;padding:14px 24px;border-radius:10px;z-index:10000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;max-width:460px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.2);line-height:1.5;background:${bgColor};`;
    notice.innerHTML = msg;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), duration);
}

// Main simplification function
async function simplifyPageContent() {
    if (isSimplifying) return;
    isSimplifying = true;

    try {
        // Check AI availability via background
        await ensureInitialized();
        
        if (!aiAvailable || !systemPrompt) {
            console.error('[Mollitiam] AI check failed. aiAvailable:', aiAvailable, 'systemPrompt:', !!systemPrompt);
            const status = await checkAIAvailability();
            console.error('[Mollitiam] Second AI check result:', JSON.stringify(status));
            if (status.status === 'after-download') {
                showToast('<strong>Mollitiam:</strong> Gemini Nano model is still downloading.<br>Go to <code style="background:rgba(255,255,255,0.2);padding:1px 4px;border-radius:3px;">chrome://components</code> &rarr; Check for update. Try again in a few minutes.', '#0F766E');
            } else if (status.status === 'no_api') {
                showToast('<strong>Mollitiam:</strong> Chrome AI not available.<br>Enable <code style="background:rgba(255,255,255,0.2);padding:1px 4px;border-radius:3px;">chrome://flags/#prompt-api-for-gemini-nano</code> and relaunch Chrome.', '#134E4A');
            } else if (status.status === 'timeout') {
                showToast('<strong>Mollitiam:</strong> Background script timed out. Try reloading the extension at <code style="background:rgba(255,255,255,0.2);padding:1px 4px;border-radius:3px;">chrome://extensions</code>.', '#134E4A');
            } else {
                showToast('<strong>Mollitiam:</strong> AI not ready (status: ' + (status.status || 'unknown') + '). Reload page and try again.', '#134E4A');
            }
            isSimplifying = false;
            return { success: false, error: 'AI not available: ' + (status.status || 'unknown') };
        }

        let mainContent = document.querySelector([
            'main', 'article', '.content', '.post', '#content', '#main',
            'div[role="main"]', '.article-content', '.article-body',
            '.story-body', '.article-text', '.story-content',
            '[itemprop="articleBody"]', '.paid-premium-content',
            '.str-story-body', '.str-article-content', '#story-body'
        ].join(', '));

        // Fallback to body if no specific content container found
        if (!mainContent) {
            console.warn('[Mollitiam] No specific content container found, falling back to body');
            mainContent = document.body;
        }

        if (!mainContent) {
            console.error('[Mollitiam] Could not find any content element');
            isSimplifying = false;
            return { success: false, error: 'No content found' };
        }

        // Restore original content if previously simplified
        const previouslySimplifiedElements = mainContent.querySelectorAll('[data-original-html]');
        previouslySimplifiedElements.forEach(el => {
            const originalHTML = el.getAttribute('data-original-html');
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = originalHTML;
            const originalElement = tempDiv.firstChild;
            el.parentNode.replaceChild(originalElement, el);
        });

        const isHeader = (element) => element.tagName.match(/^H[1-6]$/i);
        const estimateTokens = (text) => text.split(/\s+/).length * 1.3;
        const isList = (element) => ['UL', 'OL', 'DL'].includes(element.tagName);

        const contentElements = Array.from(mainContent.querySelectorAll([
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl',
            '.article-content p', '.article-body p', '.story-body p',
            '.article-text p', '.story-content p', '[itemprop="articleBody"] p'
        ].join(', ')))
        .filter(el => {
            if (isHeader(el)) return true;
            const isMetadata = 
                el.closest('.author, .meta, .claps, .likes, .stats, .profile, .bio, header, footer, .premium-box') ||
                (el.tagName !== 'UL' && el.tagName !== 'OL' && el.tagName !== 'DL' && el.textContent.trim().length < 50) ||
                /^(By|Published|Updated|Written by|(\d+) min read|(\d+) claps)/i.test(el.textContent.trim());
            return !isMetadata && el.textContent.trim().length > 0;
        });

        // Group elements into chunks
        const chunks = [];
        let currentChunk = [];
        let currentTokenCount = 0;
        const MAX_TOKENS = 800;

        for (let i = 0; i < contentElements.length; i++) {
            const element = contentElements[i];
            if (isHeader(element) || isList(element) ||
                (currentChunk.length > 0 && 
                 (currentTokenCount + estimateTokens(element.textContent) > MAX_TOKENS))) {
                if (currentChunk.length > 0) chunks.push(currentChunk);
                currentChunk = [element];
                currentTokenCount = estimateTokens(element.textContent);
            } else {
                currentChunk.push(element);
                currentTokenCount += estimateTokens(element.textContent);
            }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk);

        // Process each chunk
        for (let chunk of chunks) {
            if (chunk.length === 1 && isHeader(chunk[0])) continue;

            const chunkText = chunk
                .filter(el => !isHeader(el))
                .map(el => el.textContent)
                .join('\n\n');

            try {
                let simplifiedText = '';
                let attempts = 0;
                const maxAttempts = 5;
                
                while (attempts < maxAttempts) {
                    try {
                        console.log('[Mollitiam] Sending chunk to background for simplification...');
                        simplifiedText = await simplifyTextViaBackground(chunkText, systemPrompt);
                        
                        if (simplifiedText && simplifiedText.trim().length > 0) break;
                    } catch (error) {
                        console.warn(`[Mollitiam] Simplification attempt ${attempts + 1} failed:`, error.message);
                        if (attempts === maxAttempts - 1) throw error;
                    }
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (!simplifiedText || simplifiedText.trim().length === 0) continue;

                const simplifiedParagraphs = simplifiedText.split('\n\n');
                const originalParagraphs = chunk.filter(el => !isHeader(el));

                if (simplifiedParagraphs.length > originalParagraphs.length) {
                    simplifiedParagraphs.length = originalParagraphs.length;
                }
                if (simplifiedParagraphs.length < originalParagraphs.length) {
                    for (let i = simplifiedParagraphs.length; i < originalParagraphs.length; i++) {
                        originalParagraphs[i].remove();
                    }
                    originalParagraphs.length = simplifiedParagraphs.length;
                }

                originalParagraphs.forEach((p, index) => {
                    let newElement;
                    if (isList(p)) {
                        newElement = document.createElement(p.tagName);
                        const originalItems = Array.from(p.children);
                        const items = simplifiedParagraphs[index].split('\n').filter(item => item.trim());
                        items.forEach((item, idx) => {
                            const li = document.createElement(p.tagName === 'DL' ? 'dt' : 'li');
                            li.textContent = item.replace(/^[•\-*]\s*/, '');
                            if (originalItems[idx]) {
                                const nestedLists = originalItems[idx].querySelectorAll('ul, ol, dl');
                                nestedLists.forEach(nested => li.appendChild(nested.cloneNode(true)));
                            }
                            newElement.appendChild(li);
                        });
                    } else {
                        newElement = document.createElement('p');
                        newElement.innerHTML = (typeof marked !== 'undefined' && typeof marked.parse === 'function') ? 
                            marked.parse(simplifiedParagraphs[index], {
                                breaks: true, gfm: true, headerIds: false, mangle: false
                            }) : simplifiedParagraphs[index];
                    }
                    
                    newElement.classList.add('simplified-text');
                    if (!p.hasAttribute('data-original-html')) {
                        newElement.setAttribute('data-original-html', p.outerHTML);
                    } else {
                        newElement.setAttribute('data-original-html', p.getAttribute('data-original-html'));
                    }
                    newElement.setAttribute('data-original-text', p.textContent);
                    p.parentNode.replaceChild(newElement, p);
                    
                    simplifiedElements = simplifiedElements.filter(el => el !== p);
                    simplifiedElements.push(newElement);

                    if (hoverEnabled) {
                        newElement.addEventListener('mouseenter', showOriginalText);
                        newElement.addEventListener('mouseleave', hideOriginalText);
                    }

                    // Re-apply OpenDyslexic if enabled
                    chrome.storage.sync.get('useOpenDyslexic', function(result) {
                        if (result.useOpenDyslexic) applyOpenDyslexicFont();
                        else removeOpenDyslexicFont();
                    });
                });
            } catch (error) {
                console.error('[Mollitiam] Error simplifying chunk:', error);
            }
        }

        // Show notification
        const notification = document.createElement('div');
        notification.textContent = 'Text simplified';
        notification.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#0D9488;color:white;padding:12px 24px;border-radius:8px;z-index:10000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
        
        isSimplifying = false;
        return { success: true };
    } catch (error) {
        console.error('[Mollitiam] Error simplifying content:', error);
        isSimplifying = false;
        return { success: false, error: error.message };
    }
}
