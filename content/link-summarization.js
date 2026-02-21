// ========================================
// MOLLITIAM - LINK SUMMARIZATION MODULE
// Hover-to-summarize links
// ========================================

(function() {
  'use strict';
  
  // Configuration
  const HOVER_DELAY = 300;
  const IS_YOUTUBE = window.location.hostname.includes('youtube.com');
  const IS_TWITTER = window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com');
  const DEBUG_ENABLED = !IS_YOUTUBE;
  
  const debugLog = (...args) => {
    if (DEBUG_ENABLED) console.log(...args);
  };
  
  // Safe wrapper for chrome.runtime.sendMessage to handle "Extension context invalidated"
  function safeSendMessage(message, callback) {
    try {
      if (!chrome.runtime?.id) {
        if (callback) callback({ error: 'Extension context invalidated' });
        return;
      }
      if (callback) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            callback({ error: chrome.runtime.lastError.message });
            return;
          }
          callback(response);
        });
      } else {
        // Fire-and-forget — no callback avoids "message port closed" warning
        chrome.runtime.sendMessage(message).catch(() => {});
      }
    } catch (e) {
      if (callback) callback({ error: 'Extension context invalidated' });
    }
  }
  
  // Promise-based version
  function safeSendMessageAsync(message) {
    return new Promise((resolve) => {
      safeSendMessage(message, (response) => resolve(response || { error: 'No response' }));
    });
  }
  
  const REDDIT_HOSTS = ['reddit.com','www.reddit.com','old.reddit.com','new.reddit.com','np.reddit.com','redd.it'];
  const TWITTER_HOSTS = new Set(['twitter.com','www.twitter.com','x.com','www.x.com']);
  const YOUTUBE_HOSTS = new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com']);
  
  // State management
  let currentHoverTimeout = null;
  let hideTimeout = null;
  let lastProcessedUrl = null;
  let currentlyProcessingUrl = null;
  let currentlyDisplayedUrl = null;
  let processingElement = null;
  let tooltip = null;
  let tooltipContent = null;
  let tooltipCloseHandlerAttached = false;
  let twitterHoverTimeout = null;
  let currentTwitterArticle = null;
  let currentTwitterTweetId = null;
  let pendingTwitterThreadId = null;
  let pendingTwitterStartedAt = 0;
  let displayMode = 'tooltip';
  let gazeEnabled = false;
  let currentTooltipPlacement = 'auto';
  let currentYouTubeRequestToken = 0;
  let currentHoveredElement = null;
  let isMouseInTooltip = false;
  let displayTimes = new Map();
  let hoverTimeouts = new Map();
  
  // Twitter-specific state
  const twitterGqlCache = new Map();
  let twitterInterceptorInstalled = false;
  
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  
  // ============ Tooltip Management ============
  
  function createTooltip() {
    if (tooltip && tooltipContent && tooltipContent.parentNode === tooltip) return tooltip;
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
      tooltip = null;
      tooltipContent = null;
    }
    
    if (!document.getElementById('mollitiam-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'mollitiam-tooltip-styles';
      style.textContent = `
        #mollitiam-summary-tooltip ul { margin: 12px 0; padding-left: 24px; list-style-type: disc; list-style-position: outside; }
        #mollitiam-summary-tooltip li { margin-bottom: 8px; line-height: 1.6; display: list-item; }
        #mollitiam-summary-tooltip strong { font-weight: 600; }
        #mollitiam-summary-tooltip em { font-style: italic; }
        .mollitiam-tooltip-close { position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.05); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1; color: #666; transition: all 0.2s ease; padding: 0; z-index: 1; }
        .mollitiam-tooltip-close:hover { background: rgba(0,0,0,0.1); color: #333; transform: scale(1.1); }
      `;
      document.head.appendChild(style);
    }
    
    tooltip = document.createElement('div');
    tooltip.id = 'mollitiam-summary-tooltip';
    tooltip.style.cssText = `position:fixed;z-index:2147483647;background:white;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.2),0 2px 8px rgba(0,0,0,0.1);padding:16px 40px 16px 16px;max-width:400px;max-height:500px;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;display:none;pointer-events:auto;opacity:0;transition:opacity 0.2s ease;cursor:auto;user-select:text;border-left:4px solid #0D9488;`;

    tooltipContent = document.createElement('div');
    tooltipContent.className = 'mollitiam-tooltip-content';
    tooltip.appendChild(tooltipContent);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'mollitiam-tooltip-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('data-gaze-clickable', 'true');
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hideTooltip(); });
    tooltip.appendChild(closeBtn);

    tooltip.addEventListener('mouseenter', () => { isMouseInTooltip = true; clearTimeout(hideTimeout); hideTimeout = null; });
    tooltip.addEventListener('mouseleave', () => { isMouseInTooltip = false; scheduleHide(200); });

    document.body.appendChild(tooltip);
    return tooltip;
  }
  
  function positionTooltip(element, placement = 'auto') {
    if (!tooltip || !element) return;
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let top = rect.top, left = rect.left;
    
    if (placement === 'right') {
      left = rect.right + gap;
      if (left + tooltipRect.width > vw - gap) left = rect.left - gap - tooltipRect.width;
      if (left < gap) left = Math.max(gap, rect.left);
      top = Math.max(gap, Math.min(rect.top, vh - tooltipRect.height - gap));
    } else if (placement === 'left') {
      left = rect.left - gap - tooltipRect.width;
      if (left < gap) left = rect.right + gap;
      if (left + tooltipRect.width > vw - gap) left = Math.max(gap, vw - tooltipRect.width - gap);
      top = Math.max(gap, Math.min(rect.top, vh - tooltipRect.height - gap));
    } else {
      if (rect.bottom + gap + tooltipRect.height < vh) top = rect.bottom + gap;
      else if (rect.top - gap - tooltipRect.height > 0) top = rect.top - gap - tooltipRect.height;
      else top = Math.max(gap, (vh - tooltipRect.height) / 2);
      left = rect.left;
      if (left + tooltipRect.width > vw - gap) left = Math.max(gap, rect.right - tooltipRect.width);
      if (left < gap) left = gap;
    }
    
    top = Math.max(gap, Math.min(top, vh - tooltipRect.height - gap));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }
  
  const handleTooltipPointerDown = (event) => {
    if (!tooltip || tooltip.style.display !== 'block') return;
    if (tooltip.contains(event.target)) return;
    hideTooltip();
  };
  
  const handleTooltipKeyDown = (event) => {
    if (event.key === 'Escape' && tooltip && tooltip.style.display === 'block') {
      event.preventDefault();
      cancelActiveSummary('escape_key');
    }
  };
  
  function attachTooltipDismissHandlers() {
    if (tooltipCloseHandlerAttached) return;
    document.addEventListener('pointerdown', handleTooltipPointerDown, true);
    document.addEventListener('keydown', handleTooltipKeyDown, true);
    tooltipCloseHandlerAttached = true;
  }
  
  function detachTooltipDismissHandlers() {
    if (!tooltipCloseHandlerAttached) return;
    document.removeEventListener('pointerdown', handleTooltipPointerDown, true);
    document.removeEventListener('keydown', handleTooltipKeyDown, true);
    tooltipCloseHandlerAttached = false;
  }

  function cancelActiveSummary(reason = 'user_cancel') {
    const previousUrl = currentlyProcessingUrl;
    const wasYouTube = previousUrl ? (() => {
      try { return YOUTUBE_HOSTS.has(new URL(previousUrl, window.location.origin).hostname.toLowerCase()); }
      catch (e) { return false; }
    })() : false;
    
    if (currentHoverTimeout) { clearTimeout(currentHoverTimeout); currentHoverTimeout = null; }
    hoverTimeouts.forEach(({ timeoutId }) => clearTimeout(timeoutId));
    hoverTimeouts.clear();
    hideTooltip();
    currentlyProcessingUrl = null;
    processingElement = null;
    currentHoveredElement = null;
    
    if (IS_TWITTER) clearTwitterState();
    if (wasYouTube) {
      const videoId = extractYouTubeVideoId(previousUrl);
      if (videoId) safeSendMessage({ action: 'ABORT_YOUTUBE_SUMMARY', videoId, reason });
    }
  }
  
  function scheduleHide(delay = 500, forUrl = null) {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (!isMouseInTooltip && (!forUrl || currentlyDisplayedUrl === forUrl)) hideTooltip();
    }, delay);
  }
  
  function showTooltip(element, content, url, options = {}) {
    if (displayMode === 'panel') return;
    const placement = options.placement || 'auto';
    currentTooltipPlacement = placement;
    clearTimeout(hideTimeout);
    hideTimeout = null;
    
    const tooltipEl = createTooltip();
    tooltipContent.innerHTML = content;
    tooltipEl.style.display = 'block';
    attachTooltipDismissHandlers();
    currentlyDisplayedUrl = url;
    
    const anchor = element || processingElement || currentHoveredElement;
    positionTooltip(anchor, placement);
    if (url) displayTimes.set(url, Date.now());
    requestAnimationFrame(() => { tooltipEl.style.opacity = '1'; });
  }
  
  function hideTooltip() {
    if (tooltip) {
      tooltip.style.opacity = '0';
      currentlyDisplayedUrl = null;
      setTimeout(() => {
        if (tooltip && !isMouseInTooltip) tooltip.style.display = 'none';
      }, 200);
      detachTooltipDismissHandlers();
      currentlyProcessingUrl = null;
      processingElement = null;
      currentHoveredElement = null;
      currentTooltipPlacement = 'auto';
    }
  }
  
  function updateTooltipContent(content, url) {
    if (displayMode === 'panel') return;
    clearTimeout(hideTimeout);
    hideTimeout = null;
    if (tooltip) {
      if (tooltip.style.display !== 'block') {
        tooltip.style.display = 'block';
        if (url) displayTimes.set(url, Date.now());
      }
      currentlyDisplayedUrl = url;
      tooltipContent.innerHTML = content;
      tooltip.style.opacity = '1';
      const el = currentHoveredElement || processingElement;
      if (el) positionTooltip(el, currentTooltipPlacement);
    }
  }
  
  // ============ Twitter Helpers ============
  
  function ensureTwitterInterceptor() {
    if (!IS_TWITTER || twitterInterceptorInstalled) return;
    twitterInterceptorInstalled = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('twitter/twitter-interceptor.js');
    script.type = 'text/javascript';
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    window.addEventListener('message', handleTwitterPostMessage);
  }
  
  function handleTwitterPostMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'hover-preview-twitter' || data.type !== 'TWITTER_GQL_RESPONSE') return;
    try {
      if (data.payload && data.payload.json) recordTwitterGqlPayload(data.payload.json);
    } catch (e) {}
  }
  
  function recordTwitterGqlPayload(json) {
    const ids = extractTweetIdsFromJson(json);
    ids.forEach((id) => {
      if (!twitterGqlCache.has(id)) twitterGqlCache.set(id, []);
      const entries = twitterGqlCache.get(id);
      entries.push(json);
      if (entries.length > 8) entries.shift();
    });
  }
  
  function extractTweetIdsFromJson(obj) {
    const ids = new Set();
    const visited = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      if (node.rest_id || node.restId) ids.add(String(node.rest_id || node.restId));
      if (node.legacy && node.legacy.id_str) ids.add(String(node.legacy.id_str));
      for (const key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key) && typeof node[key] === 'object' && node[key] !== null) walk(node[key]);
      }
    }
    try { walk(obj); } catch (e) {}
    return Array.from(ids);
  }
  
  function buildThreadFromCache(tweetId) {
    if (!tweetId) return null;
    const blobs = twitterGqlCache.get(tweetId);
    if (!blobs || !blobs.length) return null;
    const nodesById = new Map();
    blobs.forEach((blob) => collectTweetsFromPayload(blob, nodesById));
    if (!nodesById.size) return null;
    const rootNode = nodesById.get(tweetId) || Array.from(nodesById.values())[0];
    if (!rootNode) return null;
    const conversationId = rootNode.conversationId || null;
    const collectedNodes = [];
    nodesById.forEach((node) => {
      if (conversationId && node.conversationId && node.conversationId !== conversationId) return;
      collectedNodes.push(Object.assign({}, node));
    });
    if (!collectedNodes.length) return null;
    collectedNodes.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const limitedNodes = collectedNodes.slice(0, 20);
    if (!limitedNodes.some((n) => n.id === rootNode.id)) limitedNodes.unshift(Object.assign({}, rootNode));
    limitedNodes.forEach((n, i) => { n.order = i; });
    return { rootId: rootNode.id, conversationId, nodes: limitedNodes, source: 'interceptor' };
  }
  
  function collectTweetsFromPayload(obj, map) {
    const visited = new Set();
    function walk(node) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);
      const candidate = extractTweetCandidate(node);
      if (candidate) {
        const existing = map.get(candidate.id);
        if (!existing || (candidate.text && candidate.text.length > (existing.text || '').length)) map.set(candidate.id, candidate);
      }
      for (const key in node) {
        if (Object.prototype.hasOwnProperty.call(node, key) && typeof node[key] === 'object' && node[key] !== null) walk(node[key]);
      }
    }
    walk(obj);
  }
  
  function extractTweetCandidate(node) {
    const result = resolveTweetResult(node);
    if (!result) return null;
    const legacy = result.legacy || (result.tweet && result.tweet.legacy);
    if (!legacy) return null;
    const id = result.rest_id || (legacy && legacy.id_str);
    if (!id) return null;
    const userLegacy = (result.core && result.core.user_results && result.core.user_results.result && result.core.user_results.result.legacy) || (result.author && result.author.legacy) || null;
    const text = extractTweetText(result, legacy);
    const timestamp = legacy.created_at ? new Date(legacy.created_at).toISOString() : null;
    const conversationId = legacy.conversation_id_str || null;
    const handle = userLegacy ? userLegacy.screen_name : (legacy && legacy.screen_name) || null;
    const authorName = userLegacy ? userLegacy.name : null;
    const avatarUrl = userLegacy ? userLegacy.profile_image_url_https : null;
    const permalink = handle ? `https://x.com/${handle}/status/${id}` : (legacy.url || null);
    const inReplyToId = legacy.in_reply_to_status_id_str ? String(legacy.in_reply_to_status_id_str) : null;
    const media = extractTweetMedia(legacy);
    return { id: String(id), conversationId: conversationId ? String(conversationId) : null, authorName: authorName || null, handle: handle ? `@${handle}` : null, avatarUrl: avatarUrl || null, timestamp, permalink, text, media, inReplyToId, order: 0 };
  }
  
  function resolveTweetResult(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.__typename === 'Tweet') return node;
    if (node.result && node.result.__typename === 'Tweet') return node.result;
    if (node.tweet && node.tweet.__typename === 'Tweet') return node.tweet;
    if (node.tweet_results && node.tweet_results.result && node.tweet_results.result.__typename === 'Tweet') return node.tweet_results.result;
    if (node.itemContent && node.itemContent.tweet_results && node.itemContent.tweet_results.result) return node.itemContent.tweet_results.result;
    if (node.item && node.item.itemContent && node.item.itemContent.tweet_results && node.item.itemContent.tweet_results.result) return node.item.itemContent.tweet_results.result;
    if (node.content && node.content.tweetResult && node.content.tweetResult.result) return node.content.tweetResult.result;
    if (node.content && node.content.itemContent && node.content.itemContent.tweet_results && node.content.itemContent.tweet_results.result) return node.content.itemContent.tweet_results.result;
    if (node.tweetResult && node.tweetResult.result) return node.tweetResult.result;
    return null;
  }
  
  function extractTweetText(result, legacy) {
    if (!legacy) return '';
    if (result.note_tweet && result.note_tweet.note_tweet_results && result.note_tweet.note_tweet_results.result) {
      const note = result.note_tweet.note_tweet_results.result;
      if (note && note.text) return note.text;
    }
    return legacy.full_text || legacy.text || '';
  }
  
  function extractTweetMedia(legacy) {
    const media = [];
    const entities = (legacy.extended_entities && legacy.extended_entities.media) || (legacy.entities && legacy.entities.media) || [];
    entities.forEach((item) => {
      if (!item) return;
      if (item.type === 'photo') media.push({ kind: 'photo', urls: item.media_url_https ? [item.media_url_https] : [] });
      else if (item.type === 'animated_gif' || item.type === 'video') {
        const variants = (item.video_info && item.video_info.variants) || [];
        media.push({ kind: item.type === 'animated_gif' ? 'gif' : 'video', urls: variants.filter(v => v.url).map(v => v.url), poster: item.media_url_https || null });
      }
    });
    return media;
  }
  
  async function extractThreadFromDom(articleElement, tweetId) {
    try { await expandTwitterThread(articleElement); } catch (e) {}
    const articles = collectThreadArticles(articleElement);
    if (!articles.length) return null;
    const nodes = [];
    articles.forEach((article, index) => {
      const node = extractNodeFromArticle(article, index === 0, tweetId);
      if (node) nodes.push(node);
    });
    if (!nodes.length) return null;
    const deduped = new Map();
    nodes.forEach((n) => { const existing = deduped.get(n.id); if (!existing || (n.text && n.text.length > (existing.text || '').length)) deduped.set(n.id, n); });
    const uniqueNodes = Array.from(deduped.values());
    if (!uniqueNodes.length) return null;
    uniqueNodes.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const limitedNodes = uniqueNodes.slice(0, 12);
    limitedNodes.forEach((n, i) => { n.order = i; });
    const rootNode = limitedNodes.find((n) => n.id === tweetId) || limitedNodes[0];
    return { rootId: rootNode.id, conversationId: rootNode.conversationId || null, nodes: limitedNodes, source: 'dom' };
  }
  
  async function waitForPrimaryTwitterArticle(timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const article = document.querySelector('article[role="article"]');
      if (article) return article;
      await sleep(150);
    }
    return null;
  }
  
  async function captureThreadForBackground(tweetId) {
    const start = Date.now();
    let lastPayload = null;
    while (Date.now() - start < 12000) {
      const cached = buildThreadFromCache(tweetId);
      if (cached && cached.nodes && cached.nodes.length > 1) { cached.source = 'background-intercept'; return cached; }
      const rootArticle = await waitForPrimaryTwitterArticle();
      if (rootArticle) {
        await sleep(400);
        await preloadTwitterConversation(rootArticle, { passes: 6, skipRestore: true });
        await sleep(500);
        const payload = await extractThreadFromDom(rootArticle, tweetId);
        if (payload && Array.isArray(payload.nodes) && payload.nodes.length > 1) { payload.source = 'background-dom'; return payload; }
        if (payload) lastPayload = payload;
      } else { await sleep(400); }
    }
    if (lastPayload && lastPayload.nodes && lastPayload.nodes.length) lastPayload.source = 'background-dom';
    return lastPayload;
  }

  async function expandTwitterThread(articleElement, options = {}) {
    const { skipRestore = false } = options || {};
    const scrollElement = document.scrollingElement || document.documentElement;
    const originalScrollTop = scrollElement.scrollTop;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const expandButtons = [];
    const EXPAND_LABEL_REGEX = /(show|view|reveal).*(repl|thread|tweet)/i;
    try {
      for (let i = 0; i < 6; i++) {
        document.querySelectorAll('div[role="button"], button, a[role="link"]').forEach((btn) => {
          if ((btn.textContent || '').trim() && EXPAND_LABEL_REGEX.test((btn.textContent || '').trim())) expandButtons.push(btn);
        });
        await sleep(160);
      }
      expandButtons.forEach((btn) => { try { btn.click(); } catch (e) {} });
      if (articleElement && articleElement.scrollIntoView) articleElement.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      await sleep(260);
    } finally {
      if (!skipRestore) scrollElement.scrollTop = originalScrollTop;
      document.documentElement.style.scrollBehavior = originalBehavior || '';
    }
  }
  
  async function preloadTwitterConversation(articleElement, options = {}) {
    const { passes = 6, skipRestore = false } = options || {};
    const scrollElement = document.scrollingElement || document.documentElement;
    const originalScrollTop = scrollElement.scrollTop;
    const originalBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    try {
      for (let i = 0; i < passes; i++) {
        await expandTwitterThread(articleElement, { skipRestore: true });
        scrollElement.scrollBy(0, Math.max(window.innerHeight * 0.9, 600));
        await sleep(420 + (i * 90));
        await expandTwitterThread(articleElement, { skipRestore: true });
        await sleep(220);
      }
      scrollElement.scrollTo(0, document.body.scrollHeight);
      await sleep(600);
      await expandTwitterThread(articleElement, { skipRestore: true });
    } finally {
      if (!skipRestore) scrollElement.scrollTop = originalScrollTop;
      document.documentElement.style.scrollBehavior = originalBehavior || '';
    }
  }
  
  function collectThreadArticles(rootArticle) {
    const articles = new Set();
    if (rootArticle) articles.add(rootArticle);
    ['[aria-label^="Timeline:"]','[data-testid="primaryColumn"]','main[role="main"]'].forEach((sel) => {
      const c = document.querySelector(sel);
      if (c) c.querySelectorAll('article[role="article"]').forEach((a) => articles.add(a));
    });
    document.querySelectorAll('article[role="article"]').forEach((a) => articles.add(a));
    return Array.from(articles);
  }
  
  function extractNodeFromArticle(article, isRoot, fallbackTweetId) {
    const link = article.querySelector('a[href*="/status/"]');
    const match = link && link.getAttribute('href') ? link.getAttribute('href').match(/status\/(\d+)/) : null;
    const id = match ? match[1] : (isRoot && fallbackTweetId ? fallbackTweetId : null);
    if (!id) return null;
    const handleEl = article.querySelector('div[dir="ltr"] span');
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const timeEl = article.querySelector('time');
    const media = [];
    Array.from(article.querySelectorAll('img')).forEach((img) => {
      if (img && img.src && (img.width || 0) * (img.height || 0) > 40000) media.push({ kind: 'photo', urls: [img.src] });
    });
    return { id: String(id), conversationId: null, authorName: null, handle: handleEl ? handleEl.textContent : null, avatarUrl: null, timestamp: timeEl ? timeEl.getAttribute('datetime') : null, permalink: link ? link.href : null, text: textEl ? textEl.innerText.trim() : '', media, inReplyToId: null, order: 0, source: 'dom' };
  }
  
  function formatTwitterThreadForSummary(threadPayload) {
    if (!threadPayload || !threadPayload.nodes || !threadPayload.nodes.length) return '';
    const lines = [];
    threadPayload.nodes.forEach((node, index) => {
      const indexLabel = index === 0 ? 'Original tweet' : `Reply ${index}`;
      const authorLabel = node.handle || node.authorName || 'Unknown user';
      let ts = '';
      if (node.timestamp) { const d = new Date(node.timestamp); if (!Number.isNaN(d.getTime())) ts = d.toLocaleString(); }
      lines.push(`${indexLabel} — ${authorLabel}${ts ? ` (${ts})` : ''}`);
      if (node.text) lines.push(node.text);
      if (node.media && node.media.length) lines.push(`[Media: ${node.media.map(m => m.kind).join(', ')}]`);
      lines.push('');
    });
    return lines.join('\n').trim();
  }
  
  function clearTwitterState() { currentTwitterArticle = null; currentTwitterTweetId = null; pendingTwitterThreadId = null; pendingTwitterStartedAt = 0; }
  
  function getTweetInfoFromArticle(article) {
    if (!article) return null;
    const link = article.querySelector('a[href*="/status/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const match = href.match(/status\/(\d+)/);
    if (!match) return null;
    const id = match[1];
    const displayUrl = link.href || (`https://x.com${href.startsWith('/') ? href : `/${href}`}`);
    return { id, url: `https://x.com/i/status/${id}`, displayUrl };
  }
  
  async function processTwitterHover(article, presetInfo = null) {
    const info = presetInfo || getTweetInfoFromArticle(article);
    if (!info) return;
    const { id, url, displayUrl } = info;
    const requestUrl = displayUrl || url;
    const shortUrl = getShortUrl(url);
    currentTwitterArticle = article;
    currentTwitterTweetId = id;
    currentlyProcessingUrl = url;
    processingElement = article;
    currentHoveredElement = article;
    pendingTwitterThreadId = id;
    pendingTwitterStartedAt = Date.now();
    
    if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(article, '<div style="text-align:center;padding:16px;opacity:0.75;">Capturing thread\u2026</div>', url);
    
    let threadPayload = null;
    if (window.location.pathname.includes('/status/')) {
      threadPayload = buildThreadFromCache(id);
      if (!threadPayload) threadPayload = await extractThreadFromDom(article, id);
    }
    
    if (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2) {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(article, '<div style="text-align:center;padding:16px;opacity:0.75;">Opening conversation\u2026</div>', url);
      for (let attempt = 0; attempt < 3 && (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2); attempt++) {
        try {
          const response = await safeSendMessageAsync({ type: 'SCRAPE_TWITTER_THREAD', url, tweetId: id, requestUrl });
          if (response && response.status === 'ok' && response.payload && response.payload.nodes && response.payload.nodes.length) { threadPayload = response.payload; break; }
        } catch (e) {}
        await sleep(400 * (attempt + 1));
      }
    }
    
    if (!threadPayload || !threadPayload.nodes || threadPayload.nodes.length < 2) {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(article, '<div style="padding:10px;background:#fee;border-radius:8px;">Unable to capture replies right now.</div>', url);
      currentlyProcessingUrl = null; processingElement = null; currentHoveredElement = null; clearTwitterState();
      return;
    }
    
    const summaryInput = formatTwitterThreadForSummary(threadPayload);
    const leadNode = threadPayload.nodes[0];
    const title = leadNode && (leadNode.handle || leadNode.authorName) ? `Thread by ${leadNode.handle || leadNode.authorName}` : 'Twitter Thread';
    const result = await safeSendMessageAsync({ type: 'SUMMARIZE_CONTENT', url, title, textContent: summaryInput });
    const isStillCurrent = (currentlyProcessingUrl === url);
    handleSummaryResult(result, article, url, shortUrl, isStillCurrent);
    pendingTwitterThreadId = null;
    pendingTwitterStartedAt = 0;
    if (!currentHoveredElement && (displayMode === 'tooltip' || displayMode === 'both')) scheduleHide(800, url);
  }
  
  // ============ Utility Helpers ============
  
  function findLink(element) {
    let current = element;
    for (let i = 0; i < 10 && current; i++) {
      if (current.tagName === 'A' && current.href) return current;
      current = current.parentElement;
    }
    return null;
  }
  
  function getShortUrl(url) {
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(s => s);
      return segments.slice(-2).join('/') || u.hostname;
    } catch (e) { return url.substring(0, 50); }
  }
  
  function isRedditPostUrl(url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const matchesRedditHost = REDDIT_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
      if (!matchesRedditHost) return false;
      if (hostname === 'redd.it' || hostname.endsWith('.redd.it')) return /^[a-z0-9]+$/i.test(parsed.pathname.replace(/\//g, '').trim());
      return /\/comments\/[a-z0-9]+/i.test(parsed.pathname);
    } catch (e) { return false; }
  }
  
  function isInternalTwitterLink(url) {
    try { return TWITTER_HOSTS.has(new URL(url, window.location.origin).hostname.toLowerCase()); }
    catch (e) { return false; }
  }
  
  function extractYouTubeVideoId(url) {
    if (!url) return null;
    const patterns = [/(?:youtube\.com\/(watch\?v=|embed\/)|youtu\.be\/)([^&\n?#]+)/, /youtube\.com\/shorts\/([^&\n?#]+)/, /[?&]v=([^&\n?#]+)/];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[2]) return match[2];
      if (match && match[1] && pattern.source.includes('shorts')) return match[1];
      if (!pattern.source.includes('shorts') && match && match[1]) return match[1];
    }
    return null;
  }
  
  function isYouTubeVideoLink(url) {
    try { if (!YOUTUBE_HOSTS.has(new URL(url, window.location.origin).hostname.toLowerCase())) return false; return !!extractYouTubeVideoId(url); }
    catch (e) { return false; }
  }
  
  function findYouTubeCardElement(element) {
    if (!element) return null;
    for (const sel of ['ytd-rich-grid-video-renderer','ytd-video-renderer','ytd-compact-video-renderer','ytd-playlist-video-renderer','ytd-playlist-renderer','ytd-rich-item-renderer','ytd-grid-video-renderer']) {
      const card = element.closest(sel);
      if (card) return card;
    }
    return null;
  }
  
  function isYouTubeThumbnail(element) {
    if (!IS_YOUTUBE) return false;
    for (const sel of ['ytd-thumbnail','ytd-video-preview','ytd-playlist-thumbnail','a#thumbnail']) {
      if (element.matches(sel) || element.closest(sel)) return true;
    }
    return false;
  }
  
  function waitForYouTubeCaptions(videoId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => { if (settled) return; settled = true; window.removeEventListener('youtube-captions-ready', captionListener); clearTimeout(timeout); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout')); }, 5000);
      const captionListener = (event) => { if (event.detail && event.detail.videoId === videoId) { cleanup(); resolve(); } };
      window.addEventListener('youtube-captions-ready', captionListener);
      if (window.hasYouTubeCaptions) window.hasYouTubeCaptions(videoId).then((has) => { if (has) { cleanup(); resolve(); } }).catch(() => {});
    });
  }

  async function handleYouTubeVideoHover(anchorElement, linkElement, url, requestToken) {
    if (requestToken !== currentYouTubeRequestToken) return;
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) { currentlyProcessingUrl = null; return; }
    const tooltipAnchor = anchorElement || linkElement;
    currentlyProcessingUrl = url;
    processingElement = linkElement || tooltipAnchor;
    currentHoveredElement = tooltipAnchor;
    const tooltipOptions = { placement: 'right' };
    if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(tooltipAnchor, '<div style="text-align:center;padding:16px;opacity:0.75;">Capturing captions\u2026</div>', url, tooltipOptions);
    
    const summaryTimeout = setTimeout(() => {
      if (currentlyProcessingUrl === url) {
        safeSendMessage({ action: 'ABORT_YOUTUBE_SUMMARY', videoId });
        if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(tooltipAnchor, '<div style="padding:10px;background:#fee;border-radius:8px;">Summary timed out.</div>', url, tooltipOptions);
        currentlyProcessingUrl = null;
      }
    }, 30000);

    try { await waitForYouTubeCaptions(videoId); } catch (e) {}

    if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(tooltipAnchor, '<div style="text-align:center;padding:16px;opacity:0.75;">Generating summary\u2026</div>', url, tooltipOptions);
    if (requestToken !== currentYouTubeRequestToken) return;
    
    safeSendMessage({ action: 'GET_YOUTUBE_SUMMARY', videoId, url }, (response) => {
      clearTimeout(summaryTimeout);
      if (requestToken !== currentYouTubeRequestToken) return;
      if (!response || response.error) { currentlyProcessingUrl = null; return; }
      if (response.status === 'complete') {
        const formatted = formatAISummary(response.summary || '');
        showTooltip(tooltipAnchor, formatted, url, tooltipOptions);
        currentlyProcessingUrl = null; processingElement = null;
      } else if (response.status === 'streaming') { return; }
      else if (response.error) {
        const msg = response.error === 'NO_CAPTIONS' ? 'No captions available.' : `Error: ${response.error}`;
        if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(tooltipAnchor, `<div style="padding:10px;background:#fee;border-radius:8px;">${msg}</div>`, url, tooltipOptions);
        currentlyProcessingUrl = null; processingElement = null;
      }
    });
  }
  
  // ============ Mouse Event Handlers ============
  
  function handleMouseOver(e) {
    if (gazeEnabled) return;
    const link = findLink(e.target);
    
    if (!link) {
      if (IS_TWITTER) {
        const article = e.target.closest && e.target.closest('article[role="article"]');
        if (article) {
          const info = getTweetInfoFromArticle(article);
          if (!info) return;
          ensureTwitterInterceptor();
          if (currentTwitterTweetId === info.id && currentlyProcessingUrl === info.url) return;
          if (twitterHoverTimeout) { clearTimeout(twitterHoverTimeout); twitterHoverTimeout = null; }
          twitterHoverTimeout = setTimeout(() => { twitterHoverTimeout = null; processTwitterHover(article, info); }, HOVER_DELAY);
          return;
        }
      }
      return;
    }
    
    let url = link.href;
    
    if (IS_TWITTER) {
      const article = link.closest && link.closest('article[role="article"]');
      if (article) {
        const tweetInfo = getTweetInfoFromArticle(article);
        if (tweetInfo) {
          ensureTwitterInterceptor();
          link.__hoverTweetInfo = tweetInfo;
          link.__hoverArticle = article;
          link.__hoverCanonicalUrl = tweetInfo.url;
          url = tweetInfo.url;
        }
      }
      try {
        const parsedUrl = new URL(url, window.location.origin);
        if (isInternalTwitterLink(parsedUrl.href) && !/\/status\//.test(parsedUrl.pathname)) return;
      } catch (e) {}
    }
    
    if (IS_YOUTUBE) {
      try {
        const parsedUrl = new URL(url, window.location.origin);
        if (YOUTUBE_HOSTS.has(parsedUrl.hostname.toLowerCase()) && !isYouTubeVideoLink(url)) return;
      } catch (e) { return; }
      
      if (isYouTubeThumbnail(e.target) || isYouTubeVideoLink(url)) {
        const videoId = extractYouTubeVideoId(url);
        if (!videoId) return;
        const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
        if (hoverTimeouts.has(canonicalUrl) || currentlyProcessingUrl === canonicalUrl) return;
        
        if (currentlyProcessingUrl && currentlyProcessingUrl !== canonicalUrl) {
          const oldVideoId = extractYouTubeVideoId(currentlyProcessingUrl);
          safeSendMessage({ action: 'ABORT_YOUTUBE_SUMMARY', videoId: oldVideoId, newVideoId: videoId });
        }
        
        const requestToken = ++currentYouTubeRequestToken;
        link.__hoverRequestToken = requestToken;
        link.__hoverCanonicalUrl = canonicalUrl;
        const oldTimeout = hoverTimeouts.get(canonicalUrl);
        if (oldTimeout) { clearTimeout(oldTimeout.timeoutId); hoverTimeouts.delete(canonicalUrl); }
        if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
        currentHoveredElement = link;
        
        let thumbnailElement = e.target.closest('ytd-thumbnail') || e.target.closest('ytd-video-preview') || e.target.closest('ytd-playlist-thumbnail');
        const cardElement = findYouTubeCardElement(thumbnailElement || link) || thumbnailElement || link;
        link.__hoverAnchor = cardElement;
        
        const hoverTimeout = setTimeout(() => {
          hoverTimeouts.delete(canonicalUrl);
          handleYouTubeVideoHover(cardElement, link, canonicalUrl, requestToken);
        }, HOVER_DELAY);
        hoverTimeouts.set(canonicalUrl, { timeoutId: hoverTimeout, requestToken });
        return;
      }
    }
    
    if (currentlyProcessingUrl === url) return;
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    currentHoveredElement = link;
    clearTimeout(currentHoverTimeout);
    currentHoverTimeout = setTimeout(() => processLinkHover(link), HOVER_DELAY);
  }
  
  function handleMouseOut(e) {
    const link = findLink(e.target);
    if (!link) {
      if (IS_TWITTER) {
        const article = e.target.closest && e.target.closest('article[role="article"]');
        if (article) {
          const relatedArticle = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('article[role="article"]');
          if (relatedArticle === article) return;
          if (twitterHoverTimeout) { clearTimeout(twitterHoverTimeout); twitterHoverTimeout = null; }
          if (currentlyProcessingUrl) scheduleHide(400, currentlyProcessingUrl);
          currentHoveredElement = null;
        }
      }
      return;
    }
    
    const url = link.__hoverCanonicalUrl || link.href;
    const anchorElement = link.__hoverAnchor;
    const relatedTarget = e.relatedTarget;
    
    if (IS_YOUTUBE && isYouTubeThumbnail(e.target)) {
      const thumbnailElement = e.target.closest('ytd-thumbnail') || e.target.closest('ytd-video-preview') || e.target.closest('ytd-playlist-thumbnail');
      if (relatedTarget && thumbnailElement && thumbnailElement.contains(relatedTarget)) return;
      const pendingTimeout = hoverTimeouts.get(url);
      if (pendingTimeout) { clearTimeout(pendingTimeout.timeoutId); hoverTimeouts.delete(url); }
    }
    
    if (relatedTarget) {
      if (anchorElement && anchorElement.contains(relatedTarget)) return;
      if (link.contains(relatedTarget) || link === relatedTarget) return;
      if (tooltip && (tooltip.contains(relatedTarget) || tooltip === relatedTarget)) return;
    }
    
    delete link.__hoverAnchor;
    delete link.__hoverRequestToken;
    
    if (currentlyProcessingUrl === url) {
      // Streaming active, don't hide
    } else {
      const urlDisplayTime = displayTimes.get(url) || 0;
      const timeSinceDisplay = urlDisplayTime > 0 ? Date.now() - urlDisplayTime : Infinity;
      const MIN_DISPLAY_TIME = 500;
      if (timeSinceDisplay < MIN_DISPLAY_TIME && urlDisplayTime > 0) {
        setTimeout(() => { if (!isMouseInTooltip && !currentHoveredElement) scheduleHide(500, url); }, MIN_DISPLAY_TIME - timeSinceDisplay);
      } else {
        scheduleHide(500, url);
      }
    }
    
    clearTimeout(currentHoverTimeout);
    currentHoverTimeout = null;
    currentHoveredElement = null;
  }
  
  // ============ Link Processing ============
  
  async function processLinkHover(link) {
    const url = link.__hoverCanonicalUrl || link.href;
    const shortUrl = getShortUrl(url);
    const isReddit = isRedditPostUrl(url);
    const tweetInfo = link.__hoverTweetInfo || null;
    const tweetArticle = link.__hoverArticle || (link.closest && link.closest('article[role="article"]'));
    
    if (IS_TWITTER && tweetInfo && tweetArticle) { await processTwitterHover(tweetArticle, tweetInfo); return; }
    if (IS_TWITTER) {
      try { if (isInternalTwitterLink(new URL(url, window.location.origin).href) && !/\/status\//.test(new URL(url, window.location.origin).pathname)) { currentlyProcessingUrl = null; processingElement = null; return; } }
      catch (e) { currentlyProcessingUrl = null; processingElement = null; return; }
    }
    
    if (currentlyProcessingUrl && currentlyProcessingUrl !== url) debugLog(`[Mollitiam] Switching from "${getShortUrl(currentlyProcessingUrl)}" to "${shortUrl}"`);
    currentlyProcessingUrl = url;
    processingElement = link;
    
    if (displayMode === 'tooltip' || displayMode === 'both') {
      const loadingMsg = isReddit ? '<div style="text-align:center;padding:20px;opacity:0.6;">Gathering Reddit discussion...</div>' : '<div style="text-align:center;padding:20px;opacity:0.6;">Extracting content...</div>';
      showTooltip(link, loadingMsg, url);
    }
    
    if (isReddit) { await processRedditPost(link, url, shortUrl); return; }
    
    const response = await safeSendMessageAsync({ type: 'FETCH_CONTENT', url });
    if (response.error) {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, `<div style="padding:10px;background:#fee;border-radius:8px;">Error: ${response.error}</div>`, url);
      currentlyProcessingUrl = null; processingElement = null;
      return;
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(response.html, 'text/html');
    const reader = new Readability(doc.cloneNode(true));
    const article = reader.parse();
    let title, textContent;
    if (article && article.textContent && article.textContent.trim().length > 100) {
      title = article.title || 'Untitled';
      textContent = article.textContent;
    } else {
      title = doc.title || 'Untitled';
      textContent = doc.querySelector('meta[name="description"]')?.getAttribute('content') || doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || 'No content could be extracted.';
    }
    
    if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, '<div style="opacity:0.6;font-style:italic;">Generating summary...</div>', url);
    
    const result = await safeSendMessageAsync({ type: 'SUMMARIZE_CONTENT', url, title, textContent });
    handleSummaryResult(result, link, url, shortUrl, currentlyProcessingUrl === url);
  }
  
  async function processRedditPost(link, url, shortUrl) {
    if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, '<div style="opacity:0.6;font-style:italic;">Summarizing Reddit discussion...</div>', url);
    try {
      const result = await safeSendMessageAsync({ type: 'SUMMARIZE_REDDIT_POST', url });
      handleSummaryResult(result, link, url, shortUrl, currentlyProcessingUrl === url);
    } catch (error) {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, `<div style="padding:10px;background:#fee;border-radius:8px;">Error: ${error.message || 'Unable to summarize'}</div>`, url);
      if (currentlyProcessingUrl === url) { currentlyProcessingUrl = null; processingElement = null; }
    }
  }
  
  function handleSummaryResult(result, link, url, shortUrl, isStillCurrent) {
    if (!result || !result.status) {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, '<div style="padding:10px;background:#fee;border-radius:8px;">Error: No summary result.</div>', url);
      if (isStillCurrent) { currentlyProcessingUrl = null; processingElement = null; clearTwitterState(); }
      return;
    }
    if (result.status === 'duplicate' || result.status === 'aborted') {
      if (isStillCurrent) { currentlyProcessingUrl = null; processingElement = null; clearTwitterState(); }
      return;
    }
    if (result.status === 'error') {
      if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, `<div style="padding:10px;background:#fee;border-radius:8px;">Error: ${result.error || result.message || 'Unknown'}</div>`, url);
      if (isStillCurrent) { currentlyProcessingUrl = null; processingElement = null; clearTwitterState(); }
      return;
    }
    if (result.status === 'complete' && result.cached) {
      if (isStillCurrent) {
        const formatted = formatAISummary(result.summary);
        if (displayMode === 'tooltip' || displayMode === 'both') showTooltip(link, formatted, url);
        if (displayMode === 'panel' || displayMode === 'both') safeSendMessage({ type: 'DISPLAY_CACHED_SUMMARY', title: result.title, summary: formatted });
        currentlyProcessingUrl = null; processingElement = null; clearTwitterState();
      }
      return;
    }
    // Streaming updates handled via STREAMING_UPDATE messages
  }
  
  // ============ Message Listener ============
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CAPTURE_TWITTER_THREAD') {
      if (!IS_TWITTER) { sendResponse({ status: 'error', error: 'NOT_TWITTER_CONTEXT' }); return false; }
      (async () => {
        try {
          const payload = await captureThreadForBackground(message.tweetId);
          sendResponse(payload && payload.nodes && payload.nodes.length ? { status: 'ok', payload } : { status: 'error', error: 'NO_THREAD_DATA' });
        } catch (e) { sendResponse({ status: 'error', error: e ? e.message : 'CAPTURE_FAILED' }); }
      })();
      return true;
    }
    if (message.type === 'STREAMING_UPDATE') {
      if (message.url === currentlyProcessingUrl) updateTooltipContent(message.content, message.url);
    }
    if (message.type === 'PROCESSING_STATUS') {
      if (message.status === 'started' && currentHoveredElement && (displayMode === 'tooltip' || displayMode === 'both')) {
        showTooltip(currentHoveredElement, '<div style="opacity:0.6;font-style:italic;">Generating summary...</div>', message.url);
      }
    }
    if (message.type === 'DISPLAY_MODE_CHANGED') {
      displayMode = message.displayMode;
      if (displayMode === 'panel') hideTooltip();
    }
    if (message.type === 'GAZE_ENABLED_CHANGED') gazeEnabled = message.gazeEnabled;
    if (message.type === 'TRIGGER_CALIBRATION') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', altKey: true, bubbles: true, cancelable: true }));
    }
    if (message.type === 'TRIGGER_MOUTH_CALIBRATION') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', altKey: true, bubbles: true, cancelable: true }));
    }
    if (message.type === 'PING') { sendResponse({ status: 'ok' }); return true; }
  });

  // Listen for gaze:status events and relay to sidepanel
  window.addEventListener('gaze:status', (event) => {
    if (event.detail) safeSendMessage({ type: 'GAZE_STATUS', phase: event.detail.phase, note: event.detail.note });
  });
  
  // Get initial settings
  chrome.storage.local.get(['displayMode', 'gazeEnabled'], (result) => {
    if (result.displayMode) displayMode = result.displayMode;
    if (typeof result.gazeEnabled === 'boolean') gazeEnabled = result.gazeEnabled;
  });
  
  // Format AI summary to HTML
  function formatAISummary(text) {
    if (!text) return '';
    let f = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    f = f.replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h3>$1</h3>').replace(/^# (.+)$/gm, '<h2>$1</h2>');
    f = f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
    f = f.replace(/\*([^\*\s][^\*]*?[^\*\s])\*/g, '<em>$1</em>').replace(/_([^_\s][^_]*?[^_\s])_/g, '<em>$1</em>');
    f = f.replace(/^[\*\-\u2022] (.+)$/gm, '<li>$1</li>');
    f = f.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    f = f.replace(/(<li>.*?<\/li>\n?)+/g, (m) => '<ul>' + m.replace(/\n/g, '') + '</ul>');
    f = f.replace(/\n\n+/g, '</p><p>');
    f = f.replace(/\n/g, '<br>');
    if (!f.startsWith('<h') && !f.startsWith('<ul') && !f.startsWith('<p>')) f = '<p>' + f;
    if (!f.endsWith('</p>') && !f.endsWith('</ul>') && !f.endsWith('</h2>') && !f.endsWith('</h3>') && !f.endsWith('</h4>')) f = f + '</p>';
    f = f.replace(/<p><\/p>/g, '').replace(/<p>\s*<\/p>/g, '');
    f = f.replace(/<p>(<h\d>)/g, '$1').replace(/(<\/h\d>)<\/p>/g, '$1').replace(/<p>(<ul>)/g, '$1').replace(/(<\/ul>)<\/p>/g, '$1');
    return f;
  }
  
  // Initialize
  if (IS_TWITTER) ensureTwitterInterceptor();
  document.body.addEventListener('mouseover', handleMouseOver, true);
  document.body.addEventListener('mouseout', handleMouseOut, true);
  debugLog('[Mollitiam] Link summarization initialized');
  
})();
