(function() {
'use strict';

// ============================================================
// CONSTANTS & STATE
// ============================================================

const HOVER_DELAY = 300;
const IS_YOUTUBE = window.location.hostname.includes('youtube.com');
const IS_TWITTER = window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com');
const DEBUG_ENABLED = !IS_YOUTUBE;

const REDDIT_HOSTS = new Set(['www.reddit.com', 'old.reddit.com', 'reddit.com', 'np.reddit.com']);
const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);

let currentHoverUrl = null;
let hoverTimeout = null;
let hideTimeout = null;
let tooltip = null;
let isMouseInTooltip = false;
let currentSummaryUrl = null;
let showTimestamp = 0;
let gazeEnabled = false;
let displayMode = 'tooltip';
let twitterGqlCache = new Map();
let currentRequestToken = 0;

// ============================================================
// SAFE MESSAGING
// ============================================================

function safeSendMessage(message, callback) {
    try {
        if (!chrome.runtime?.id) return;
        if (callback) {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    callback(null);
                    return;
                }
                callback(response);
            });
        } else {
            chrome.runtime.sendMessage(message).catch(() => {});
        }
    } catch (e) {
        if (callback) callback(null);
    }
}

function safeSendMessageAsync(message) {
    return new Promise((resolve) => {
        safeSendMessage(message, (response) => {
            resolve(response);
        });
    });
}

// ============================================================
// TOOLTIP SYSTEM
// ============================================================

function createTooltip() {
    if (tooltip) return tooltip;

    tooltip = document.createElement('div');
    tooltip.id = 'mollitiam-summary-tooltip';
    tooltip.style.cssText = `
        position: fixed; display: none; z-index: 999999;
        background: #fff; color: #212121; font-size: 14px;
        border-radius: 12px; padding: 16px; max-width: 400px; max-height: 500px;
        overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        border: 1px solid #E0E0E0; border-left: 4px solid #0D9488;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.5; opacity: 0; transition: opacity 0.2s ease;
    `;

    // Close button
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
        position: absolute; top: 8px; right: 12px; cursor: pointer;
        font-size: 18px; color: #9E9E9E; line-height: 1;
    `;
    closeBtn.addEventListener('click', () => hideTooltip());
    tooltip.appendChild(closeBtn);

    // Content area
    const content = document.createElement('div');
    content.className = 'tooltip-content';
    tooltip.appendChild(content);

    tooltip.addEventListener('mouseenter', () => { isMouseInTooltip = true; clearTimeout(hideTimeout); });
    tooltip.addEventListener('mouseleave', () => { isMouseInTooltip = false; scheduleHide(300); });

    document.body.appendChild(tooltip);
    return tooltip;
}

function positionTooltip(element, placement) {
    if (!tooltip) return;
    const rect = element.getBoundingClientRect();
    const gap = 12;

    let left, top;
    placement = placement || 'auto';

    if (placement === 'auto') {
        placement = rect.left > window.innerWidth / 2 ? 'left' : 'right';
    }

    if (placement === 'right') {
        left = rect.right + gap;
        top = rect.top;
    } else {
        left = rect.left - 400 - gap;
        top = rect.top;
    }

    // Clamp to viewport
    left = Math.max(gap, Math.min(left, window.innerWidth - 412));
    top = Math.max(gap, Math.min(top, window.innerHeight - 300));

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function showTooltip(element, content, url, options = {}) {
    const tip = createTooltip();
    const contentEl = tip.querySelector('.tooltip-content');
    contentEl.innerHTML = content;

    positionTooltip(element, options.placement);
    tip.style.display = 'block';
    requestAnimationFrame(() => { tip.style.opacity = '1'; });

    showTimestamp = Date.now();
    currentSummaryUrl = url;

    // Dismiss handlers
    const dismissOnClick = (e) => {
        if (!tip.contains(e.target) && e.target !== element) {
            hideTooltip();
            document.removeEventListener('click', dismissOnClick);
        }
    };
    const dismissOnEsc = (e) => {
        if (e.key === 'Escape') {
            hideTooltip();
            document.removeEventListener('keydown', dismissOnEsc);
        }
    };
    document.addEventListener('click', dismissOnClick);
    document.addEventListener('keydown', dismissOnEsc);
}

function hideTooltip() {
    if (!tooltip) return;
    tooltip.style.opacity = '0';
    setTimeout(() => {
        if (tooltip) tooltip.style.display = 'none';
    }, 200);
    currentSummaryUrl = null;
}

function updateTooltipContent(content, url) {
    if (!tooltip || tooltip.style.display === 'none') return;
    const contentEl = tooltip.querySelector('.tooltip-content');
    if (contentEl) contentEl.innerHTML = content;
}

function scheduleHide(delay, forUrl) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        if (isMouseInTooltip) return;
        if (forUrl && forUrl !== currentSummaryUrl) return;
        hideTooltip();
    }, delay || 300);
}

function cancelActiveSummary(reason) {
    clearTimeout(hoverTimeout);
    clearTimeout(hideTimeout);
    hideTooltip();
    currentHoverUrl = null;
}

// ============================================================
// TWITTER HELPERS
// ============================================================

function ensureTwitterInterceptor() {
    if (document.getElementById('mollitiam-twitter-interceptor')) return;
    const script = document.createElement('script');
    script.id = 'mollitiam-twitter-interceptor';
    script.src = chrome.runtime.getURL('twitter/twitter-interceptor.js');
    document.documentElement.appendChild(script);

    window.addEventListener('message', handleTwitterPostMessage);
}

function handleTwitterPostMessage(event) {
    if (event.source !== window) return;
    if (event.data?.source !== 'hover-preview-twitter') return;
    if (event.data?.type === 'TWITTER_GQL_RESPONSE') {
        recordTwitterGqlPayload(event.data.payload?.json);
    }
}

function recordTwitterGqlPayload(json) {
    if (!json) return;
    const tweetIds = extractTweetIdsFromJson(json);
    for (const id of tweetIds) {
        if (!twitterGqlCache.has(id)) twitterGqlCache.set(id, []);
        const entries = twitterGqlCache.get(id);
        if (entries.length < 8) entries.push(json);
    }
}

function extractTweetIdsFromJson(obj, ids = new Set()) {
    if (!obj || typeof obj !== 'object') return ids;
    if (obj.rest_id) ids.add(obj.rest_id);
    if (obj.restId) ids.add(obj.restId);
    if (obj.legacy?.id_str) ids.add(obj.legacy.id_str);
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') extractTweetIdsFromJson(obj[key], ids);
    }
    return ids;
}

function buildThreadFromCache(tweetId) {
    const payloads = twitterGqlCache.get(tweetId);
    if (!payloads || payloads.length === 0) return null;

    const tweetMap = new Map();
    for (const json of payloads) {
        collectTweetsFromPayload(json, tweetMap);
    }

    const tweets = Array.from(tweetMap.values());
    if (tweets.length === 0) return null;

    // Sort by timestamp
    tweets.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    return { tweets, rootId: tweetId };
}

function collectTweetsFromPayload(obj, map) {
    if (!obj || typeof obj !== 'object') return;
    const candidate = extractTweetCandidate(obj);
    if (candidate && candidate.id && !map.has(candidate.id)) {
        map.set(candidate.id, candidate);
    }
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') collectTweetsFromPayload(obj[key], map);
    }
}

function extractTweetCandidate(node) {
    const result = resolveTweetResult(node);
    if (!result) return null;

    const legacy = result.legacy || result;
    const text = extractTweetText(result, legacy);
    if (!text) return null;

    return {
        id: result.rest_id || result.id_str || legacy.id_str,
        handle: result.core?.user_results?.result?.legacy?.screen_name || '',
        authorName: result.core?.user_results?.result?.legacy?.name || '',
        text,
        timestamp: legacy.created_at || '',
        media: extractTweetMedia(legacy),
        permalink: legacy.id_str ? `https://x.com/i/web/status/${legacy.id_str}` : '',
        conversationId: legacy.conversation_id_str || '',
        inReplyToId: legacy.in_reply_to_status_id_str || ''
    };
}

function resolveTweetResult(node) {
    if (!node || typeof node !== 'object') return null;
    // Handle various Twitter API response shapes
    if (node.__typename === 'Tweet' && node.legacy) return node;
    if (node.tweet_results?.result) return resolveTweetResult(node.tweet_results.result);
    if (node.result?.__typename === 'Tweet') return node.result;
    if (node.result?.tweet) return node.result.tweet;
    if (node.tweet?.legacy) return node.tweet;
    if (node.tweetResult?.result) return resolveTweetResult(node.tweetResult.result);
    if (node.itemContent?.tweet_results?.result) return resolveTweetResult(node.itemContent.tweet_results.result);
    if (node.content?.itemContent?.tweet_results?.result) return resolveTweetResult(node.content.itemContent.tweet_results.result);
    if (node.legacy && node.rest_id) return node;
    return null;
}

function extractTweetText(result, legacy) {
    // Check note_tweet (long tweets) first
    if (result.note_tweet?.note_tweet_results?.result?.text) {
        return result.note_tweet.note_tweet_results.result.text;
    }
    return legacy.full_text || legacy.text || result.full_text || result.text || '';
}

function extractTweetMedia(legacy) {
    if (!legacy?.extended_entities?.media) return [];
    return legacy.extended_entities.media.map(m => ({
        type: m.type,
        url: m.media_url_https || m.media_url,
        videoUrl: m.video_info?.variants?.find(v => v.content_type === 'video/mp4')?.url
    }));
}

function extractThreadFromDom(articleElement, tweetId) {
    const articles = collectThreadArticles(articleElement);
    const nodes = [];
    const seen = new Set();

    for (let i = 0; i < Math.min(articles.length, 12); i++) {
        const node = extractNodeFromArticle(articles[i], i === 0, tweetId);
        if (node && node.text && !seen.has(node.text)) {
            seen.add(node.text);
            nodes.push(node);
        }
    }

    return nodes.length > 0 ? nodes : null;
}

function expandTwitterThread(articleElement, options = {}) {
    const expandBtns = document.querySelectorAll('[role="button"]');
    for (const btn of expandBtns) {
        if (/(show|view|reveal).*(repl|thread|tweet)/i.test(btn.textContent)) {
            btn.click();
        }
    }
}

function preloadTwitterConversation(articleElement, options = {}) {
    for (let pass = 0; pass < 3; pass++) {
        expandTwitterThread(articleElement, options);
    }
}

function collectThreadArticles(rootArticle) {
    const container = rootArticle.closest('[data-testid="cellInnerDiv"]')?.parentElement ||
                      rootArticle.closest('section') ||
                      document;
    return Array.from(container.querySelectorAll('article[role="article"]'));
}

function extractNodeFromArticle(article, isRoot, fallbackTweetId) {
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const userEl = article.querySelector('[data-testid="User-Name"]');
    const timeEl = article.querySelector('time');

    if (!textEl) return null;

    return {
        text: textEl.innerText,
        author: userEl ? userEl.innerText.split('\n')[0] : 'Unknown',
        handle: userEl ? (userEl.innerText.match(/@\w+/) || [''])[0] : '',
        timestamp: timeEl ? timeEl.getAttribute('datetime') : '',
        isRoot
    };
}

function formatTwitterThreadForSummary(threadPayload) {
    if (!threadPayload || !threadPayload.length) return '';
    let text = 'Twitter Thread:\n\n';
    for (const tweet of threadPayload) {
        text += `${tweet.author || tweet.handle || 'User'}: ${tweet.text}\n\n`;
    }
    return text;
}

async function processTwitterHover(article, presetInfo) {
    const tweetLink = article.querySelector('a[href*="/status/"]');
    const tweetUrl = tweetLink ? tweetLink.href : '';
    const tweetId = tweetUrl.match(/\/status\/(\d+)/)?.[1] || '';

    if (!tweetId) return;

    const shortUrl = `@${tweetId.slice(-6)}`;
    showTooltip(article, '<div class="loader"></div> Loading tweet...', tweetUrl);

    // Try cache first
    const thread = buildThreadFromCache(tweetId);
    if (thread && thread.tweets.length > 0) {
        const text = formatTwitterThreadForSummary(thread.tweets);
        safeSendMessage({
            type: 'SUMMARIZE_CONTENT',
            url: tweetUrl,
            text,
            title: `Tweet by ${thread.tweets[0]?.authorName || 'User'}`
        }, (result) => handleSummaryResult(result, article, tweetUrl, shortUrl, true));
        return;
    }

    // Try DOM extraction
    preloadTwitterConversation(article);
    const domThread = extractThreadFromDom(article, tweetId);
    if (domThread) {
        const text = formatTwitterThreadForSummary(domThread);
        safeSendMessage({
            type: 'SUMMARIZE_CONTENT',
            url: tweetUrl,
            text,
            title: `Tweet by ${domThread[0]?.author || 'User'}`
        }, (result) => handleSummaryResult(result, article, tweetUrl, shortUrl, true));
        return;
    }

    // Fallback: background scrape
    safeSendMessage({
        type: 'SCRAPE_TWITTER_THREAD',
        url: tweetUrl
    }, (result) => {
        if (result?.success && result.thread) {
            const text = formatTwitterThreadForSummary(result.thread);
            safeSendMessage({
                type: 'SUMMARIZE_CONTENT',
                url: tweetUrl,
                text,
                title: 'Tweet Thread'
            }, (summaryResult) => handleSummaryResult(summaryResult, article, tweetUrl, shortUrl, true));
        } else {
            updateTooltipContent('<em>Could not load tweet content</em>', tweetUrl);
        }
    });
}

// ============================================================
// YOUTUBE HELPERS
// ============================================================

function extractYouTubeVideoId(url) {
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

function isYouTubeVideoLink(url) {
    try {
        const u = new URL(url);
        return YOUTUBE_HOSTS.has(u.hostname) && !!extractYouTubeVideoId(url);
    } catch { return false; }
}

function findYouTubeCardElement(element) {
    return element.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer');
}

function isYouTubeThumbnail(element) {
    return !!element.closest('ytd-thumbnail, #thumbnail, .ytd-thumbnail');
}

function waitForYouTubeCaptions(videoId) {
    return new Promise((resolve) => {
        const handler = (e) => {
            if (e.detail?.videoId === videoId) {
                window.removeEventListener('youtube-captions-ready', handler);
                resolve(e.detail);
            }
        };
        window.addEventListener('youtube-captions-ready', handler);
        setTimeout(() => {
            window.removeEventListener('youtube-captions-ready', handler);
            resolve(null);
        }, 5000);
    });
}

function handleYouTubeVideoHover(anchor, link, url, token) {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return;

    showTooltip(anchor, '<div class="loader"></div> Capturing captions...', url);

    const timeout = setTimeout(() => {
        if (token !== currentRequestToken) return;
        updateTooltipContent('<em>Caption capture timed out</em>', url);
    }, 30000);

    waitForYouTubeCaptions(videoId).then(() => {
        if (token !== currentRequestToken) { clearTimeout(timeout); return; }

        safeSendMessage({
            action: 'GET_YOUTUBE_SUMMARY',
            videoId
        }, (result) => {
            clearTimeout(timeout);
            if (token !== currentRequestToken) return;

            if (result?.success) {
                if (result.cached) {
                    updateTooltipContent(result.summary, url);
                } else {
                    // Streaming will update via message listener
                }
            } else if (result?.status !== 'duplicate') {
                updateTooltipContent('<em>Could not summarize video</em>', url);
            }
        });
    });
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function findLink(element) {
    let el = element;
    for (let i = 0; i < 10; i++) {
        if (!el) break;
        if (el.tagName === 'A' && el.href) return el;
        el = el.parentElement;
    }
    return null;
}

function getShortUrl(url) {
    try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        return parts.slice(-2).join('/') || url;
    } catch { return url; }
}

function isRedditPostUrl(url) {
    try {
        const u = new URL(url);
        return REDDIT_HOSTS.has(u.hostname) && /\/comments\//.test(u.pathname);
    } catch { return false; }
}

function isInternalTwitterLink(url) {
    try {
        return TWITTER_HOSTS.has(new URL(url).hostname);
    } catch { return false; }
}

// ============================================================
// MOUSE EVENTS
// ============================================================

function handleMouseOver(e) {
    if (gazeEnabled) return;

    // Twitter articles
    if (IS_TWITTER) {
        const article = e.target.closest('article[role="article"]');
        if (article) {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => processTwitterHover(article), HOVER_DELAY);
            return;
        }
    }

    // YouTube thumbnails/links
    if (IS_YOUTUBE) {
        const thumb = isYouTubeThumbnail(e.target);
        const link = findLink(e.target);
        if ((thumb || link) && link?.href && isYouTubeVideoLink(link.href)) {
            if (link.href === currentHoverUrl) return;
            currentHoverUrl = link.href;
            clearTimeout(hoverTimeout);
            currentRequestToken++;
            const token = currentRequestToken;
            hoverTimeout = setTimeout(() => handleYouTubeVideoHover(link, link, link.href, token), HOVER_DELAY);
            return;
        }
    }

    // General links
    const link = findLink(e.target);
    if (!link || !link.href) return;
    if (link.href === currentHoverUrl) return;
    if (link.href.startsWith('javascript:') || link.href.startsWith('#')) return;

    currentHoverUrl = link.href;
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => processLinkHover(link), HOVER_DELAY);
}

function handleMouseOut(e) {
    clearTimeout(hoverTimeout);

    const minDisplayTime = 500;
    if (Date.now() - showTimestamp < minDisplayTime) return;

    // Check if moving to tooltip or card
    const related = e.relatedTarget;
    if (related && (tooltip?.contains(related))) return;

    scheduleHide(300, currentHoverUrl);
    currentHoverUrl = null;
}

// ============================================================
// LINK PROCESSING
// ============================================================

function processLinkHover(link) {
    const url = link.href;
    const shortUrl = getShortUrl(url);

    // Reddit
    if (isRedditPostUrl(url)) {
        processRedditPost(link, url, shortUrl);
        return;
    }

    // Twitter
    if (IS_TWITTER || isInternalTwitterLink(url)) {
        const article = link.closest('article[role="article"]');
        if (article) {
            processTwitterHover(article);
            return;
        }
    }

    // General: Fetch HTML → Readability → Summarize
    showTooltip(link, '<div class="loader"></div> Loading...', url);

    safeSendMessage({ type: 'FETCH_CONTENT', url }, (response) => {
        if (!response?.success || !response.html) {
            updateTooltipContent('<em>Could not load page</em>', url);
            return;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.html, 'text/html');

            // Try Readability
            let title = doc.title || '';
            let content = '';

            if (typeof Readability !== 'undefined') {
                try {
                    const article = new Readability(doc).parse();
                    if (article) {
                        title = article.title || title;
                        content = article.textContent || '';
                    }
                } catch (e) { /* fallback */ }
            }

            if (!content) {
                // Fallback: meta description
                const meta = doc.querySelector('meta[name="description"]') ||
                             doc.querySelector('meta[property="og:description"]');
                content = meta ? meta.getAttribute('content') : '';
            }

            if (!content) {
                updateTooltipContent('<em>No content available</em>', url);
                return;
            }

            safeSendMessage({
                type: 'SUMMARIZE_CONTENT',
                url,
                text: content.substring(0, 5000),
                title
            }, (result) => handleSummaryResult(result, link, url, shortUrl, url === currentHoverUrl || url === currentSummaryUrl));
        } catch (e) {
            updateTooltipContent('<em>Error parsing content</em>', url);
        }
    });
}

function processRedditPost(link, url, shortUrl) {
    showTooltip(link, '<div class="loader"></div> Loading Reddit post...', url);
    safeSendMessage({
        type: 'SUMMARIZE_REDDIT_POST',
        url
    }, (result) => handleSummaryResult(result, link, url, shortUrl, true));
}

function handleSummaryResult(result, link, url, shortUrl, isStillCurrent) {
    if (!result) return;

    if (result.status === 'duplicate') return;
    if (result.status === 'aborted') {
        hideTooltip();
        return;
    }

    if (result.error) {
        updateTooltipContent(`<em>Error: ${result.error}</em>`, url);
        return;
    }

    if (result.success) {
        if (result.cached) {
            // Show immediately
            const html = `
                ${result.title ? `<strong style="display:block;margin-bottom:8px;color:#0D9488;">${result.title}</strong>` : ''}
                <div class="ai-summary-content">${result.summary}</div>
            `;
            if (displayMode === 'tooltip') {
                updateTooltipContent(html, url);
            } else {
                safeSendMessage({
                    type: 'DISPLAY_CACHED_SUMMARY',
                    title: result.title,
                    summary: result.summary
                });
            }
        }
        // Streaming updates handled by message listener
    }
}

// ============================================================
// INLINE formatAISummary (identical to utils version)
// ============================================================

function formatAISummaryInline(text) {
    if (!text) return '';
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/\*(\S.*?\S|\S)\*/g, '<em>$1</em>');
    html = html.replace(/_(\S.*?\S|\S)_/g, '<em>$1</em>');
    html = html.replace(/^[\*\-•] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    if (!html.startsWith('<p>') && !html.startsWith('<h') && !html.startsWith('<ul>')) html = '<p>' + html;
    if (!html.endsWith('</p>') && !html.endsWith('</h2>') && !html.endsWith('</h3>') && !html.endsWith('</h4>') && !html.endsWith('</ul>')) html += '</p>';
    html = html.replace(/<p><\/p>/g, '');
    return html;
}

// ============================================================
// MESSAGE LISTENER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_TWITTER_THREAD') {
        const articles = document.querySelectorAll('article[role="article"]');
        const tweets = [];
        articles.forEach(article => {
            const textEl = article.querySelector('[data-testid="tweetText"]');
            const userEl = article.querySelector('[data-testid="User-Name"]');
            if (textEl) {
                tweets.push({
                    text: textEl.innerText,
                    author: userEl ? userEl.innerText.split('\n')[0] : 'Unknown'
                });
            }
        });
        sendResponse(tweets.length > 0 ? tweets.slice(0, 12) : null);
        return true;
    }

    if (message.type === 'STREAMING_UPDATE') {
        if (displayMode === 'tooltip' && tooltip && tooltip.style.display !== 'none') {
            const html = `
                ${message.title ? `<strong style="display:block;margin-bottom:8px;color:#0D9488;">${message.title}</strong>` : ''}
                <div class="ai-summary-content">${message.content}</div>
            `;
            updateTooltipContent(html, message.url);
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'PROCESSING_STATUS') {
        if (displayMode === 'tooltip' && tooltip) {
            updateTooltipContent('<div class="loader"></div> ' + (message.status || 'Processing...'), message.url);
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'DISPLAY_MODE_CHANGED') {
        displayMode = message.displayMode || 'tooltip';
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'GAZE_ENABLED_CHANGED') {
        gazeEnabled = !!message.enabled;
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'TRIGGER_CALIBRATION') {
        window.dispatchEvent(new CustomEvent('gaze:startCalibration'));
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'TRIGGER_MOUTH_CALIBRATION') {
        window.dispatchEvent(new CustomEvent('gaze:startMouthCalibration'));
        sendResponse({ received: true });
        return true;
    }

    if (message.action === 'PING') {
        sendResponse({ alive: true });
        return true;
    }

    return true;
});

// ============================================================
// INITIALIZATION
// ============================================================

if (IS_TWITTER) {
    ensureTwitterInterceptor();
}

document.body.addEventListener('mouseover', handleMouseOver, true);
document.body.addEventListener('mouseout', handleMouseOut, true);

// Read settings
chrome.storage.local.get(['displayMode', 'gazeEnabled'], (result) => {
    if (result.displayMode) displayMode = result.displayMode;
    if (result.gazeEnabled) gazeEnabled = result.gazeEnabled;
});

// Relay gaze status events
window.addEventListener('gaze:status', (e) => {
    safeSendMessage({ type: 'GAZE_STATUS', phase: e.detail?.phase, note: e.detail?.note });
});

})();
