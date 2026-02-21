// ========================================
// MOLLITIAM - MERGED BACKGROUND SERVICE WORKER
// ========================================

// Import config files
importScripts('config/system-prompts.js', 'config/config.js', 'utils/markdown-formatter.js');

// ========================================
// AI APIS INITIALIZATION
// ========================================

async function initializeSummarizerAPI() {
  let summarizerAvailable = false;

  if ('Summarizer' in self) {
    console.log('[Mollitiam] Found global Summarizer API');
    summarizerAvailable = true;
  } else if ('ai' in self && 'summarizer' in self.ai) {
    console.log('[Mollitiam] Found ai.summarizer namespace');
    summarizerAvailable = true;
  }

  return {
    summarizer: {
      available: summarizerAvailable,
      availability: summarizerAvailable
        ? () => ('Summarizer' in self ? Summarizer.availability({ outputLanguage: 'en' }) : ai.summarizer.availability({ outputLanguage: 'en' }))
        : null,
      create: summarizerAvailable
        ? (options) => ('Summarizer' in self ? Summarizer.create(options) : ai.summarizer.create(options))
        : null
    },
    promptAPI: (() => {
      let promptAvailable = false;
      let PromptAPI = null;

      if ('LanguageModel' in self) {
        promptAvailable = true;
        PromptAPI = self.LanguageModel;
      } else if ('ai' in self && 'languageModel' in self.ai) {
        promptAvailable = true;
        PromptAPI = self.ai.languageModel;
      }

      console.log('[Mollitiam] Prompt API detection:', { promptAvailable, hasGlobal: 'LanguageModel' in self, hasNamespaced: 'ai' in self && 'languageModel' in (self.ai || {}) });

      return {
        available: promptAvailable,
        availability: promptAvailable
          ? (options) => PromptAPI.availability(options || { expectedOutputs: [{ type: 'text', languages: ['en'] }] })
          : null,
        create: promptAvailable ? (options) => PromptAPI.create(options) : null,
        params: promptAvailable && PromptAPI.params ? () => PromptAPI.params() : null
      };
    })()
  };
}

function createInitialApiState() {
  return {
    summarizer: {
      available: false,
      status: 'initializing',
      availability: null,
      create: null
    },
    promptAPI: {
      available: false,
      status: 'initializing',
      availability: null,
      create: null,
      params: null
    }
  };
}

let SummarizerAPI = createInitialApiState();

async function initAPIs() {
  try {
    const api = await initializeSummarizerAPI();

    Object.assign(SummarizerAPI.summarizer, api.summarizer);
    SummarizerAPI.summarizer.status = SummarizerAPI.summarizer.available ? 'initializing' : 'unavailable';

    Object.assign(SummarizerAPI.promptAPI, api.promptAPI);
    SummarizerAPI.promptAPI.status = SummarizerAPI.promptAPI.available ? 'initializing' : 'unavailable';

    console.log('[Mollitiam] APIs initialized:', {
      summarizerAvailable: SummarizerAPI.summarizer.available,
      promptAvailable: SummarizerAPI.promptAPI.available,
      hasGlobalLanguageModel: 'LanguageModel' in self,
      hasAiNamespace: 'ai' in self,
      hasAiLanguageModel: 'ai' in self && 'languageModel' in self.ai,
      hasGlobalSummarizer: 'Summarizer' in self
    });

    if (SummarizerAPI.summarizer.available && SummarizerAPI.summarizer.availability) {
      try {
        const summarizerAvailability = await SummarizerAPI.summarizer.availability();
        SummarizerAPI.summarizer.status = summarizerAvailability;
      } catch (error) {
        console.error('[Mollitiam] Summarizer availability check failed:', error);
        SummarizerAPI.summarizer.status = 'unavailable';
      }
    } else {
      SummarizerAPI.summarizer.status = 'unavailable';
    }

    if (SummarizerAPI.promptAPI.available && SummarizerAPI.promptAPI.availability) {
      try {
        const promptAvailability = await SummarizerAPI.promptAPI.availability({
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        });
        SummarizerAPI.promptAPI.status = promptAvailability;
      } catch (error) {
        console.error('[Mollitiam] Prompt API availability check failed:', error);
        SummarizerAPI.promptAPI.status = 'unavailable';
      }
    } else {
      SummarizerAPI.promptAPI.status = 'unavailable';
    }
  } catch (error) {
    console.error('[Mollitiam] API initialization failed:', error);
    SummarizerAPI.summarizer.status = 'error';
    SummarizerAPI.promptAPI.status = 'error';
  }
}

const apiInitializationPromise = initAPIs();

// Helper: wait for API init with timeout (prevents hanging if availability check stalls)
function waitForApiInit(timeoutMs = 15000) {
  return Promise.race([
    apiInitializationPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('API init timed out')), timeoutMs))
  ]).catch(err => {
    console.warn('[Mollitiam] waitForApiInit:', err.message);
  });
}

// ========================================
// SETTINGS MANAGEMENT
// ========================================

let settings = {
  apiChoice: 'summarization',
  customPrompt: 'Summarize this article in 2-3 sentences',
  displayMode: 'tooltip'
};

async function loadSettings() {
  const stored = await chrome.storage.local.get(['apiChoice', 'customPrompt', 'displayMode']);
  if (stored.apiChoice) settings.apiChoice = stored.apiChoice;
  if (stored.customPrompt) settings.customPrompt = stored.customPrompt;
  if (stored.displayMode) settings.displayMode = stored.displayMode;
  console.log('[Mollitiam] Settings loaded:', settings);
}

loadSettings();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.apiChoice) settings.apiChoice = changes.apiChoice.newValue;
    if (changes.customPrompt) settings.customPrompt = changes.customPrompt.newValue;
    if (changes.displayMode) settings.displayMode = changes.displayMode.newValue;
  }
});

// ========================================
// CACHING & STATE MANAGEMENT
// ========================================

const htmlCache = {};
const summaryCache = new Map();
const youtubeCaptionCache = new Map();
const youtubeSummaryCache = new Map();
const youtubeDescriptionCache = new Map();
const twitterThreadCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000;
const TWITTER_THREAD_TTL = 5 * 60 * 1000;
const YOUTUBE_DEBUG_LOG_FULL_INPUT = false;

const summarizationJobs = new Map();
const youtubeJobsByVideoId = new Map();
let summarizationJobCounter = 0;
let activePageJobId = null;
let activeYouTubeJobId = null;

function createSummarizationJob({ url, tabId, feature, metadata }) {
  const controller = new AbortController();
  const jobId = `job-${Date.now()}-${++summarizationJobCounter}`;
  const job = {
    id: jobId,
    url,
    tabId: typeof tabId === 'number' ? tabId : null,
    feature,
    metadata: metadata || {},
    controller,
    signal: controller.signal,
    session: null,
    sessionType: null,
    createdAt: Date.now()
  };
  summarizationJobs.set(jobId, job);
  return job;
}

function registerJobSession(job, session, type) {
  if (!job) return;
  job.session = session || null;
  job.sessionType = type || null;
}

function destroyJobSession(job) {
  if (!job || !job.session) {
    if (job) {
      job.session = null;
      job.sessionType = null;
    }
    return;
  }
  if (typeof job.session.destroy === 'function') {
    try {
      job.session.destroy();
    } catch (error) {
      console.warn('[Mollitiam] Failed to destroy session:', error);
    }
  }
  job.session = null;
  job.sessionType = null;
}

function finalizeJob(jobId) {
  const job = summarizationJobs.get(jobId);
  if (!job) return;
  destroyJobSession(job);
  summarizationJobs.delete(jobId);

  if (job.feature === 'page' && activePageJobId === jobId) {
    activePageJobId = null;
  }

  if (job.feature === 'youtube') {
    if (activeYouTubeJobId === jobId) {
      activeYouTubeJobId = null;
    }
    const videoId = job.metadata && job.metadata.videoId;
    if (videoId && youtubeJobsByVideoId.get(videoId) === jobId) {
      youtubeJobsByVideoId.delete(videoId);
    }
  }
}

function abortJob(jobId, reason) {
  const job = summarizationJobs.get(jobId);
  if (!job) return;
  if (!job.signal.aborted) {
    job.controller.abort();
  }
  console.log('[Mollitiam] Aborting job', { feature: job.feature, url: job.url, reason: reason || 'unspecified' });
  finalizeJob(jobId);
}

function getJob(jobId) {
  return summarizationJobs.get(jobId) || null;
}

// Clean cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of summaryCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) summaryCache.delete(key);
  }
  for (const [key, value] of twitterThreadCache.entries()) {
    if (now - value.timestamp > TWITTER_THREAD_TTL) twitterThreadCache.delete(key);
  }
  for (const [key, value] of youtubeDescriptionCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) youtubeDescriptionCache.delete(key);
  }
}, 5 * 60 * 1000);

// ========================================
// AI SUMMARIZATION FUNCTIONS
// ========================================

async function summarizeContent({ job, text, url }) {
  if (!job) throw new Error('Summarization job context missing');
  const signal = job.signal;
  await waitForApiInit();
  if (settings.apiChoice === 'summarization') {
    return await useSummarizationAPI({ job, text, signal, url });
  } else {
    return await usePromptAPI({ job, text, signal, url });
  }
}

async function useSummarizationAPI({ job, text, signal, url }) {
  if (!SummarizerAPI.summarizer.available) {
    throw new Error('Summarizer API not available');
  }

  const availability = SummarizerAPI.summarizer.status;
  if (availability === 'downloadable' || availability === 'downloading') {
    throw new Error('MODEL_DOWNLOAD_REQUIRED');
  }
  if (availability === 'unavailable') {
    throw new Error('Summarizer API is unavailable on this device');
  }
  if (availability !== 'available' && availability !== 'readily') {
    throw new Error(`Summarizer API status is: ${availability}`);
  }

  try {
    const options = {
      type: 'key-points',
      format: 'markdown',
      length: 'medium',
      sharedContext: 'This is an article from a webpage.',
      outputLanguage: 'en'
    };

    const summarizer = await SummarizerAPI.summarizer.create(options);
    registerJobSession(job, summarizer, 'summarizer');

    if (signal) {
      signal.addEventListener('abort', () => {
        destroyJobSession(job);
      }, { once: true });
    }

    const MAX_CHARS = 4000;
    let processedText = text;
    if (text.length > MAX_CHARS) {
      const partSize = Math.floor(MAX_CHARS / 3);
      const start = text.slice(0, partSize);
      const middle = text.slice(Math.floor(text.length / 2 - partSize / 2), Math.floor(text.length / 2 + partSize / 2));
      const end = text.slice(-partSize);
      processedText = `${start}\n\n[...]\n\n${middle}\n\n[...]\n\n${end}`;
    }

    registerJobSession(job, summarizer, 'summarizer');

    if (signal && signal.aborted) {
      destroyJobSession(job);
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const stream = summarizer.summarizeStreaming(processedText);
      let fullSummary = '';
      let lastBroadcast = 0;
      const BROADCAST_INTERVAL = 150;

      const videoIdForThisStream = job?.metadata?.videoId ||
        (url && url.includes('watch?v=') ? new URL(url).searchParams.get('v') : null);

      for await (const chunk of stream) {
        if (!summarizationJobs.has(job.id)) {
          destroyJobSession(job);
          throw new DOMException('Aborted', 'AbortError');
        }
        if (signal && signal.aborted) {
          destroyJobSession(job);
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!job.session) {
          throw new DOMException('Session destroyed', 'AbortError');
        }

        fullSummary += chunk;
        const now = Date.now();
        if (now - lastBroadcast >= BROADCAST_INTERVAL) {
          broadcastStreamingUpdate(job, fullSummary);
          lastBroadcast = now;
        }
      }

      broadcastStreamingUpdate(job, fullSummary);
      return fullSummary;
    } catch (error) {
      destroyJobSession(job);
      throw error;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'Session is destroyed') {
      throw error;
    }
    console.error('[Mollitiam] Summarization failed:', error);
    throw error;
  } finally {
    destroyJobSession(job);
  }
}

async function usePromptAPI({ job, text, signal, url }) {
  if (!SummarizerAPI.promptAPI.available) {
    throw new Error('Prompt API not available');
  }

  const availability = SummarizerAPI.promptAPI.status;
  if (availability === 'unavailable') {
    throw new Error('Prompt API not available on this device');
  }
  if (availability === 'downloadable' || availability === 'downloading') {
    throw new Error('MODEL_DOWNLOAD_REQUIRED');
  }
  if (availability !== 'available' && availability !== 'readily') {
    throw new Error(`Prompt API status is: ${availability}`);
  }

  try {
    const session = await SummarizerAPI.promptAPI.create({
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      signal: signal
    });
    registerJobSession(job, session, 'prompt');

    if (signal) {
      signal.addEventListener('abort', () => {
        destroyJobSession(job);
      }, { once: true });
    }

    const MAX_CHARS = 3000;
    let processedText = text;
    if (text.length > MAX_CHARS) {
      const partSize = Math.floor(MAX_CHARS / 3);
      const start = text.slice(0, partSize);
      const middle = text.slice(Math.floor(text.length / 2 - partSize / 2), Math.floor(text.length / 2 + partSize / 2));
      const end = text.slice(-partSize);
      processedText = `${start}\n\n[...]\n\n${middle}\n\n[...]\n\n${end}`;
    }

    const fullPrompt = `${settings.customPrompt}\n\nContent:\n${processedText}`;

    registerJobSession(job, session, 'prompt');

    if (signal && signal.aborted) {
      destroyJobSession(job);
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const stream = session.promptStreaming(fullPrompt);
      let fullSummary = '';
      let lastBroadcast = 0;
      const BROADCAST_INTERVAL = 150;

      for await (const chunk of stream) {
        if (!summarizationJobs.has(job.id)) {
          destroyJobSession(job);
          throw new DOMException('Aborted', 'AbortError');
        }
        if (signal && signal.aborted) {
          destroyJobSession(job);
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!job.session) {
          throw new DOMException('Session destroyed', 'AbortError');
        }

        fullSummary += chunk;
        const now = Date.now();
        if (now - lastBroadcast >= BROADCAST_INTERVAL) {
          broadcastStreamingUpdate(job, fullSummary);
          lastBroadcast = now;
        }
      }

      broadcastStreamingUpdate(job, fullSummary);
      return fullSummary;
    } catch (error) {
      destroyJobSession(job);
      throw error;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'Session is destroyed') {
      throw error;
    }
    console.error('[Mollitiam] Prompt API failed:', error);
    throw error;
  } finally {
    destroyJobSession(job);
  }
}

// Broadcast streaming updates to all display surfaces
function broadcastStreamingUpdate(job, partialSummary) {
  if (!job || !summarizationJobs.has(job.id)) return;
  const formatted = formatAISummary(partialSummary);
  const payload = {
    type: 'STREAMING_UPDATE',
    content: formatted,
    url: job.url
  };

  chrome.runtime.sendMessage(payload).catch(() => {});

  if (typeof job.tabId === 'number') {
    chrome.tabs.sendMessage(job.tabId, payload).catch(() => {});
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, payload).catch(() => {});
      }
    });
  }
}

// Broadcast processing status
function broadcastProcessingStatus(status, title, job) {
  const message = {
    type: 'PROCESSING_STATUS',
    status: status,
    title: title,
    url: job ? job.url : null
  };

  chrome.runtime.sendMessage(message).catch(() => {});

  if (job && typeof job.tabId === 'number') {
    chrome.tabs.sendMessage(job.tabId, message).catch(() => {});
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
  }
}

// ========================================
// TWITTER BACKGROUND SCRAPE HELPERS
// ========================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeout = 15000) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('TAB_NOT_FOUND');
  if (tab.status === 'complete') return;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('TAB_LOAD_TIMEOUT'));
    }, timeout);

    function handleUpdate(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    }
    function handleRemoved(removedTabId) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('TAB_CLOSED'));
      }
    }
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdate);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    }

    chrome.tabs.onUpdated.addListener(handleUpdate);
    chrome.tabs.onRemoved.addListener(handleRemoved);
  });
}

async function captureTwitterThreadInTab(tabId, tweetId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'CAPTURE_TWITTER_THREAD',
        tweetId
      });

      if (response && response.status === 'ok' && response.payload && Array.isArray(response.payload.nodes)) {
        const payload = response.payload;
        payload.source = payload.source || 'background';
        return payload;
      }

      if (response && response.error) {
        console.warn('[Twitter] Capture response error:', response.error);
      }
    } catch (error) {
      console.warn('[Twitter] Capture attempt failed:', error);
    }
    await delay(300 * (attempt + 1));
  }

  try {
    const executed = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (targetTweetId) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const start = Date.now();
        let bestNodes = null;
        while (Date.now() - start < 12000) {
          const BUTTON_SELECTOR = 'div[role="button"], button, a[role="link"]';
          const EXPAND_MATCH = /(show|view|reveal).*(repl|thread|tweet)/i;
          document.querySelectorAll(BUTTON_SELECTOR).forEach((el) => {
            const text = (el.textContent || '').trim();
            if (text && EXPAND_MATCH.test(text)) el.click();
          });
          window.scrollBy(0, Math.max(window.innerHeight * 0.9, 600));
          await sleep(420);
          document.querySelectorAll(BUTTON_SELECTOR).forEach((el) => {
            const text = (el.textContent || '').trim();
            if (text && EXPAND_MATCH.test(text)) el.click();
          });
          await sleep(220);
          const nodesMap = new Map();
          document.querySelectorAll('article[role="article"]').forEach((article) => {
            const link = article.querySelector('a[href*="/status/"]');
            const href = link ? link.getAttribute('href') : null;
            let id = null;
            if (href) {
              const match = href.match(/status\/(\d+)/);
              if (match) id = match[1];
            }
            if (!id && targetTweetId) id = targetTweetId;
            if (!id) return;
            const handleSpan = article.querySelector('div[dir="ltr"] span');
            const handle = handleSpan ? handleSpan.textContent : null;
            const textEl = article.querySelector('[data-testid="tweetText"]');
            const text = textEl ? textEl.innerText.trim() : '';
            const timeEl = article.querySelector('time');
            const timestamp = timeEl ? timeEl.getAttribute('datetime') : null;
            const media = [];
            article.querySelectorAll('img').forEach((img) => {
              if (!img || !img.src) return;
              const pixels = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
              if (pixels > 40000) media.push({ kind: 'photo', urls: [img.src] });
            });
            const existing = nodesMap.get(id);
            if (!existing || (text && text.length > (existing.text || '').length)) {
              nodesMap.set(id, {
                id: String(id), conversationId: null, authorName: null,
                handle: handle || null, avatarUrl: null, timestamp,
                permalink: link ? (link.href || null) : null, text, media,
                inReplyToId: null, order: 0
              });
            }
          });
          const nodes = Array.from(nodesMap.values());
          nodes.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
          nodes.forEach((node, idx) => { node.order = idx; });
          if (nodes.length > 1) {
            return {
              status: 'ok',
              payload: { rootId: nodes[0].id, conversationId: null, nodes, source: 'background-script' }
            };
          }
          if (nodes.length && !bestNodes) bestNodes = nodes;
          await sleep(400);
        }
        if (bestNodes && bestNodes.length) {
          bestNodes.forEach((node, idx) => { node.order = idx; });
          return {
            status: 'ok',
            payload: { rootId: bestNodes[0].id, conversationId: null, nodes: bestNodes, source: 'background-script' }
          };
        }
        return { status: 'error', error: 'NO_TWEETS_FOUND' };
      },
      args: [tweetId]
    });
    if (executed && executed.length && executed[0].result && executed[0].result.status === 'ok') {
      return executed[0].result.payload;
    }
  } catch (error) {
    console.warn('[Twitter] executeScript capture failed:', error);
  }

  return null;
}

async function handleTwitterBackgroundScrape(message) {
  const { url, tweetId, requestUrl } = message;
  if (!url) return { status: 'error', error: 'MISSING_URL' };

  const cacheKey = tweetId || url;
  const cached = twitterThreadCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < TWITTER_THREAD_TTL) {
    return { status: 'ok', payload: cached.payload };
  }

  let tab = null;
  try {
    const tabUrl = requestUrl || url;
    tab = await chrome.tabs.create({ url: tabUrl, active: false });
    if (!tab || typeof tab.id !== 'number') throw new Error('TAB_CREATION_FAILED');

    await waitForTabComplete(tab.id, 18000);
    await delay(800);

    const payload = await captureTwitterThreadInTab(tab.id, tweetId);

    if (payload && payload.nodes && payload.nodes.length) {
      twitterThreadCache.set(cacheKey, { payload, timestamp: Date.now() });
      return { status: 'ok', payload };
    }

    return { status: 'error', error: 'BACKGROUND_CAPTURE_FAILED' };
  } catch (error) {
    console.error('[Twitter] Background scrape failed:', error);
    return { status: 'error', error: error?.message || 'BACKGROUND_SCRAPE_FAILED' };
  } finally {
    if (tab && typeof tab.id === 'number') {
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
    }
  }
}

// ========================================
// CONTENT SUMMARIZATION HANDLER
// ========================================

async function handleSummarizeContent(message, sender) {
  const { url, title, textContent } = message;
  const tabId = sender?.tab?.id ?? null;

  const existingPageJob = getJob(activePageJobId);

  if (existingPageJob && existingPageJob.url === url) {
    return { status: 'duplicate' };
  }
  if (existingPageJob && existingPageJob.url !== url) {
    abortJob(existingPageJob.id, 'replaced_by_new_page_request');
  }

  const cacheKey = `${url}_${settings.apiChoice}_${settings.customPrompt}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return { status: 'complete', title, summary: cached.summary, cached: true };
  }

  const job = createSummarizationJob({ url, tabId, feature: 'page' });
  activePageJobId = job.id;

  broadcastProcessingStatus('started', title, job);

  try {
    const summary = await summarizeContent({ job, text: textContent, url });
    if (job.signal.aborted) return { status: 'aborted' };

    summaryCache.set(cacheKey, { summary, timestamp: Date.now() });
    return { status: 'complete', title, summary, cached: false };
  } catch (error) {
    if (error.name === 'AbortError') return { status: 'aborted' };
    console.error('[Mollitiam] Summarization error:', error);
    return { status: 'error', error: error.message };
  } finally {
    finalizeJob(job.id);
  }
}

// ========================================
// REDDIT THREAD HELPERS
// ========================================

const REDDIT_COMMENT_LIMIT = 5;
const REDDIT_POST_CHAR_LIMIT = 1500;
const REDDIT_COMMENT_CHAR_LIMIT = 600;

function buildRedditApiUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'redd.it' || hostname.endsWith('.redd.it')) {
      const slug = parsed.pathname.replace(/\//g, '').trim();
      if (!slug) return null;
      const apiUrl = new URL(`/comments/${slug}.json`, 'https://www.reddit.com');
      apiUrl.searchParams.set('limit', '40');
      apiUrl.searchParams.set('depth', '2');
      apiUrl.searchParams.set('raw_json', '1');
      return { apiUrl: apiUrl.toString(), threadId: slug };
    }

    if (!hostname.endsWith('reddit.com')) return null;
    if (!/\/comments\/[a-z0-9]+/i.test(parsed.pathname)) return null;

    let normalizedPath = parsed.pathname;
    if (normalizedPath.endsWith('/')) normalizedPath = normalizedPath.slice(0, -1);
    if (normalizedPath.endsWith('.json')) normalizedPath = normalizedPath.slice(0, -5);

    const apiUrl = new URL(`${normalizedPath}.json`, 'https://www.reddit.com');
    apiUrl.searchParams.set('limit', '40');
    apiUrl.searchParams.set('depth', '2');
    apiUrl.searchParams.set('raw_json', '1');

    const idMatch = normalizedPath.match(/\/comments\/([a-z0-9]+)/i);
    return { apiUrl: apiUrl.toString(), threadId: idMatch ? idMatch[1] : null };
  } catch (error) {
    return null;
  }
}

function normalizeRedditText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
    .trim();
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '\u2026';
}

function extractRedditThread(json) {
  if (!Array.isArray(json) || json.length === 0) return null;
  const postListing = json[0]?.data?.children?.find(child => child.kind === 't3');
  if (!postListing?.data) return null;

  const postData = postListing.data;
  const selftext = truncateText(normalizeRedditText(postData.selftext || ''), REDDIT_POST_CHAR_LIMIT);
  const commentListing = Array.isArray(json[1]?.data?.children) ? json[1].data.children : [];
  const comments = selectTopComments(commentListing, REDDIT_COMMENT_LIMIT);

  return {
    title: postData.title || 'Untitled Reddit Post',
    subreddit: postData.subreddit || '',
    author: postData.author || '',
    score: postData.score || 0,
    selftext,
    isSelf: !!postData.is_self,
    postUrl: postData.url_overridden_by_dest || postData.url || '',
    commentCount: postData.num_comments || commentListing.length,
    comments
  };
}

function selectTopComments(children, limit) {
  const comments = [];
  for (const child of children) {
    if (!child || child.kind !== 't1' || !child.data) continue;
    const data = child.data;
    if (!data.body || data.body === '[deleted]' || data.body === '[removed]') continue;
    const body = truncateText(normalizeRedditText(data.body), REDDIT_COMMENT_CHAR_LIMIT);
    if (!body) continue;
    comments.push({ author: data.author || 'unknown', score: typeof data.score === 'number' ? data.score : 0, body });
  }
  comments.sort((a, b) => (b.score || 0) - (a.score || 0));
  return comments.slice(0, limit);
}

function buildRedditSummaryInput(thread) {
  const sections = [];
  sections.push('Summarize the following Reddit thread, focusing on the main viewpoints, consensus, and disagreements voiced in the top community comments.');
  sections.push(`Thread title: ${thread.title}`);

  const metaParts = [];
  if (thread.subreddit) metaParts.push(`Subreddit: r/${thread.subreddit}`);
  if (thread.author) metaParts.push(`Author: u/${thread.author}`);
  metaParts.push(`Upvotes: ${thread.score}`);
  metaParts.push(`Comments analyzed: ${thread.comments.length}/${thread.commentCount}`);
  sections.push(metaParts.join(' | '));

  if (thread.selftext) {
    sections.push('Original post:');
    sections.push(thread.selftext);
  } else if (!thread.isSelf && thread.postUrl) {
    sections.push(`Original post links to: ${thread.postUrl}`);
  }

  if (thread.comments.length) {
    sections.push('Top community comments:');
    thread.comments.forEach((comment, index) => {
      sections.push(`${index + 1}. u/${comment.author} (${comment.score} upvotes)\n${comment.body}`);
    });
  } else {
    sections.push('Top community comments: None available.');
  }

  return sections.join('\n\n');
}

async function handleSummarizeRedditPost(message, sender) {
  const { url } = message;
  const apiInfo = buildRedditApiUrl(url);
  if (!apiInfo) {
    return { status: 'error', error: 'INVALID_REDDIT_URL', message: 'Not a Reddit post link.' };
  }

  let redditJson;
  try {
    const response = await fetch(apiInfo.apiUrl, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    redditJson = await response.json();
  } catch (error) {
    return { status: 'error', error: 'REDDIT_FETCH_FAILED', message: 'Could not retrieve Reddit thread data.' };
  }

  const thread = extractRedditThread(redditJson);
  if (!thread) {
    return { status: 'error', error: 'REDDIT_PARSE_FAILED', message: 'Unable to parse Reddit discussion.' };
  }

  const summaryInput = buildRedditSummaryInput(thread);
  return await handleSummarizeContent({ url, title: `Reddit: ${thread.title}`, textContent: summaryInput }, sender);
}

// ========================================
// YOUTUBE CAPTION HELPERS
// ========================================

function parseCaptionData(data) {
  try {
    if (typeof data === 'string') {
      if (data.includes('"events"') || data.includes('"wireMagic"')) {
        const jsonData = JSON.parse(data);
        if (jsonData.events) {
          return jsonData.events
            .map(event => {
              if (event.segs) {
                const text = event.segs.map(seg => seg.utf8 || '').join('');
                return { start: (event.tStartMs || 0) / 1000, duration: (event.dDurationMs || 0) / 1000, text };
              }
              return null;
            })
            .filter(Boolean);
        }
      }
      if (data.includes('<?xml') || data.includes('<transcript>')) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(data, 'text/xml');
        const texts = xmlDoc.getElementsByTagName('text');
        return Array.from(texts).map(node => ({
          start: parseFloat(node.getAttribute('start') || 0),
          duration: parseFloat(node.getAttribute('dur') || 0),
          text: node.textContent
        }));
      }
      if (data.trim().startsWith('[') || data.trim().startsWith('{')) {
        return JSON.parse(data);
      }
    }
    return data;
  } catch (error) {
    console.error('[YouTube] Error parsing caption data:', error);
    return null;
  }
}

function captionsToText(captions) {
  if (!Array.isArray(captions)) return '';
  return captions
    .map(caption => caption.text || '')
    .filter(text => text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchYouTubeDescription(videoId, url) {
  const fallbackUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let targetUrl = fallbackUrl;

  if (url) {
    try {
      const parsed = new URL(url, 'https://www.youtube.com');
      if (parsed.hostname.includes('youtube.com')) targetUrl = parsed.href;
    } catch (error) {}
  }

  const response = await fetch(targetUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching description`);
  const html = await response.text();
  const description = extractYouTubeDescriptionFromHtml(html);
  return description ? description.trim() : null;
}

function extractYouTubeDescriptionFromHtml(html) {
  if (!html) return null;

  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;/s);
  if (playerMatch) {
    try {
      const data = JSON.parse(playerMatch[1]);
      const desc = data?.videoDetails?.shortDescription;
      if (desc && desc.trim()) return desc.trim();
    } catch (error) {}
  }

  const metaMatch = html.match(/<meta\s+(?:itemprop|name|property)=["']description["']\s+content=["']([^"']*)["']/i);
  if (metaMatch && metaMatch[1]) return decodeHtmlEntities(metaMatch[1]);

  const ogMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i);
  if (ogMatch && ogMatch[1]) return decodeHtmlEntities(ogMatch[1]);

  return null;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/').replace(/&nbsp;/g, ' ')
    .replace(/&#10;/g, '\n').replace(/&#13;/g, '\r').replace(/\u00a0/g, ' ');
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ')
    .replace(/\u200b/g, '').replace(/[ \f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function clipTranscript(text, limit) {
  if (!text) return '';
  if (text.length <= limit) return text;

  const partSize = Math.max(Math.floor(limit / 3), 200);
  const start = text.slice(0, partSize).trimEnd();
  const midStart = Math.max(Math.floor(text.length / 2 - partSize / 2), 0);
  const middle = text.slice(midStart, midStart + partSize).trim();
  const end = text.slice(-partSize).trimStart();

  let clipped = `${start}\n\n[...]\n\n${middle}\n\n[...]\n\n${end}`;
  if (clipped.length > limit) clipped = clipped.slice(0, limit - 1).trimEnd() + '\u2026';
  return clipped;
}

function buildYouTubeSummarizationInput({ captionText, descriptionText, videoId }) {
  const MAX_TOTAL = 4000;
  const DESCRIPTION_LIMIT = 1000;
  const HEADER_OVERHEAD = 160;
  const MIN_CAPTION_LIMIT = 600;

  const metadata = {
    captionIncluded: !!captionText,
    descriptionIncluded: !!descriptionText,
    captionTruncated: false,
    descriptionTruncated: false,
    hardTruncated: false
  };

  const sections = [];
  sections.push(`Video ID: ${videoId}`);

  let descriptionSection = '';
  if (descriptionText && descriptionText.trim().length) {
    const normalizedDescription = normalizeWhitespace(descriptionText);
    if (normalizedDescription.length > DESCRIPTION_LIMIT) {
      descriptionSection = normalizedDescription.slice(0, DESCRIPTION_LIMIT - 1).trimEnd() + '\u2026';
      metadata.descriptionTruncated = true;
    } else {
      descriptionSection = normalizedDescription;
    }
    sections.push('Description:\n' + descriptionSection);
  }

  let captionSection = '';
  if (captionText && captionText.trim().length) {
    const normalizedCaption = normalizeWhitespace(captionText);
    let captionLimit = MAX_TOTAL - HEADER_OVERHEAD - descriptionSection.length;
    captionLimit = Math.max(captionLimit, MIN_CAPTION_LIMIT);
    captionSection = clipTranscript(normalizedCaption, Math.min(captionLimit, MAX_TOTAL - HEADER_OVERHEAD));
    metadata.captionTruncated = normalizedCaption.length > captionSection.length;
    sections.push('Transcript:\n' + captionSection);
  }

  let combined = sections.join('\n\n').trim();
  if (combined.length > MAX_TOTAL) {
    if (captionSection) {
      const normalizedCaption = normalizeWhitespace(captionText);
      const available = MAX_TOTAL - (combined.length - captionSection.length) - HEADER_OVERHEAD;
      const nextLimit = Math.max(Math.min(available, captionSection.length), MIN_CAPTION_LIMIT);
      captionSection = clipTranscript(normalizedCaption, nextLimit);
      metadata.captionTruncated = true;
    }
    const newSections = [`Video ID: ${videoId}`];
    if (descriptionSection) newSections.push('Description:\n' + descriptionSection);
    if (captionSection) newSections.push('Transcript:\n' + captionSection);
    combined = newSections.join('\n\n').trim();
  }

  if (combined.length > MAX_TOTAL) {
    combined = combined.slice(0, MAX_TOTAL - 1).trimEnd() + '\u2026';
    metadata.hardTruncated = true;
  }

  return { inputText: combined, metadata };
}

async function handleYouTubeSummary(videoId, url, tabId) {
  const existingJobId = youtubeJobsByVideoId.get(videoId);
  const existingJob = existingJobId ? getJob(existingJobId) : null;
  if (existingJob) return { status: 'streaming', videoId };
  if (existingJobId && !existingJob) youtubeJobsByVideoId.delete(videoId);

  const activeJob = getJob(activeYouTubeJobId);
  if (activeJob && activeJob.metadata?.videoId && activeJob.metadata.videoId !== videoId) {
    abortJob(activeJob.id, 'youtube_video_switch');
  }

  const cachedSummary = youtubeSummaryCache.get(videoId);
  if (cachedSummary && (Date.now() - cachedSummary.timestamp) < CACHE_DURATION) {
    return { status: 'complete', cached: true, summary: cachedSummary.summary, videoId };
  }

  const job = createSummarizationJob({ url, tabId, feature: 'youtube', metadata: { videoId } });
  activeYouTubeJobId = job.id;
  youtubeJobsByVideoId.set(videoId, job.id);
  const signal = job.signal;

  try {
    let captionData = youtubeCaptionCache.get(videoId);
    let descriptionData = youtubeDescriptionCache.get(videoId);

    if (!descriptionData) {
      descriptionData = await fetchYouTubeDescription(videoId, url).catch(() => null);
      if (descriptionData) {
        youtubeDescriptionCache.set(videoId, { description: descriptionData, timestamp: Date.now() });
      }
    } else {
      descriptionData = descriptionData.description;
    }

    if (!captionData) {
      let targetTabId = tabId;
      if (!targetTabId) {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tabs[0]) throw new Error('No active tab found');
        targetTabId = tabs[0].id;
      }

      const MAX_ATTEMPTS = 6;
      const RETRY_DELAY_MS = 500;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !captionData; attempt++) {
        if (signal.aborted || !summarizationJobs.has(job.id)) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          const response = await chrome.tabs.sendMessage(targetTabId, {
            action: 'GET_YOUTUBE_CAPTIONS',
            videoId
          });

          if (response && response.success && response.data) {
            captionData = response.data;
            youtubeCaptionCache.set(videoId, { data: captionData, timestamp: captionData.timestamp || Date.now() });
            break;
          }

          const error = response?.error || 'UNKNOWN_ERROR';
          if (error !== 'NO_CAPTIONS' && error !== 'TIMEOUT') throw new Error(error);
        } catch (error) {
          if (error?.message === 'No tab with id') throw new Error('YouTube tab no longer available');
          if (attempt === MAX_ATTEMPTS && !descriptionData) {
            return { status: 'error', error: 'NO_CAPTIONS', message: 'Could not retrieve captions for this video' };
          }
        }

        if (!captionData && attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
      }

      if (!captionData && !descriptionData) {
        return { status: 'error', error: 'NO_CAPTIONS', message: 'Could not retrieve captions for this video' };
      }
    } else {
      captionData = captionData.data;
    }

    const captionArray = captionData?.captions || [];
    const captionText = captionData?.text || captionsToText(captionArray);
    const descriptionText = descriptionData || '';

    if ((!captionText || captionText.length < 10) && (!descriptionText || descriptionText.length < 20)) {
      return { status: 'error', error: 'NO_CAPTIONS', message: 'No captions or description available for this video' };
    }

    const { inputText: summarizationInput, metadata: summarizationMetadata } = buildYouTubeSummarizationInput({
      captionText, descriptionText, videoId
    });

    if (!summarizationInput || summarizationInput.length < 20) {
      return { status: 'error', error: 'NO_CAPTIONS', message: 'Not enough content to summarize' };
    }

    try {
      const summary = await summarizeContent({ job, text: summarizationInput, url });
      youtubeSummaryCache.set(videoId, { summary, timestamp: Date.now() });
      return { status: 'complete', cached: false, summary, videoId, captionCount: captionArray.length, compression: summarizationMetadata };
    } catch (error) {
      if (error.name === 'AbortError') return { status: 'aborted', message: 'Summary cancelled (switched to different video)' };
      throw error;
    }
  } catch (error) {
    console.error('[YouTube] Error generating summary:', error);
    return { status: 'error', error: 'SUMMARY_FAILED', message: error.message };
  } finally {
    finalizeJob(job.id);
  }
}

// ========================================
// EXTENSION LIFECYCLE
// ========================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Mollitiam] Extension installed');
    chrome.storage.sync.remove('readingLevel');
  }
});

// Open side panel on icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ========================================
// MESSAGE HANDLERS
// ========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- System prompts for text simplification ---
  if (message.action === 'getSystemPrompts') {
    sendResponse({ success: true, prompts: systemPrompts });
    return true;
  }

  // --- Simplify text chunk via Prompt API (runs in background where self.ai is available) ---
  if (message.action === 'simplifyText') {
    (async () => {
      try {
        await waitForApiInit();
        console.log('[Mollitiam] simplifyText: API state -', { available: SummarizerAPI.promptAPI.available, status: SummarizerAPI.promptAPI.status, hasCreate: !!SummarizerAPI.promptAPI.create });
        
        if (!SummarizerAPI.promptAPI.available || !SummarizerAPI.promptAPI.create) {
          sendResponse({ success: false, error: 'Prompt API not available (status: ' + SummarizerAPI.promptAPI.status + ')' });
          return;
        }

        if (SummarizerAPI.promptAPI.availability) {
          const avail = await SummarizerAPI.promptAPI.availability();
          if (avail === 'no') {
            sendResponse({ success: false, error: 'AI model not available' });
            return;
          }
        }

        const session = await SummarizerAPI.promptAPI.create({
          systemPrompt: message.systemPrompt,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              console.log(`[Mollitiam] Model download: ${Math.round((e.loaded / e.total) * 100)}%`);
            });
          }
        });

        let result = '';
        const stream = await session.promptStreaming(message.text);
        for await (const chunk of stream) {
          result = chunk.trim();
        }
        
        session.destroy();
        sendResponse({ success: true, simplifiedText: result });
      } catch (error) {
        console.error('[Mollitiam] simplifyText error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // --- Check if Prompt API is available (for content script to query) ---
  if (message.action === 'checkPromptAPI') {
    (async () => {
      try {
        await waitForApiInit();
        console.log('[Mollitiam] checkPromptAPI: promptAPI state -', { available: SummarizerAPI.promptAPI.available, status: SummarizerAPI.promptAPI.status });
        
        if (!SummarizerAPI.promptAPI.available) {
          sendResponse({ available: false, status: 'no_api' });
          return;
        }
        
        if (SummarizerAPI.promptAPI.availability) {
          const avail = await SummarizerAPI.promptAPI.availability();
          console.log('[Mollitiam] checkPromptAPI: availability result =', avail);
          sendResponse({ available: avail === 'readily' || avail === 'available', status: avail });
        } else {
          // If no availability check, assume available since the API object exists
          sendResponse({ available: true, status: 'readily' });
        }
      } catch (error) {
        console.error('[Mollitiam] checkPromptAPI error:', error);
        sendResponse({ available: false, status: 'error', error: error.message });
      }
    })();
    return true;
  }

  // --- Relay simplify command to active tab ---
  if (message.action === 'simplifyActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && /^https?:/.test(tabs[0].url)) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'simplify' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { success: true });
          }
        });
      } else {
        sendResponse({ success: false, error: 'No valid web page active' });
      }
    });
    return true;
  }

  // --- Relay any action to active tab ---
  if (message.action === 'relayToActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && /^https?:/.test(tabs[0].url)) {
        chrome.tabs.sendMessage(tabs[0].id, message.payload, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { success: true });
          }
        });
      } else {
        sendResponse({ success: false, error: 'No valid web page active' });
      }
    });
    return true;
  }

  // --- Twitter thread scrape ---
  if (message.type === 'SCRAPE_TWITTER_THREAD') {
    handleTwitterBackgroundScrape(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ status: 'error', error: error?.message || 'BACKGROUND_SCRAPE_FAILED' }));
    return true;
  }

  // --- Content summarization ---
  if (message.type === 'SUMMARIZE_CONTENT') {
    handleSummarizeContent(message, sender)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  // --- Reddit summarization ---
  if (message.type === 'SUMMARIZE_REDDIT_POST') {
    handleSummarizeRedditPost(message, sender)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ status: 'error', error: error?.message || 'Reddit summarization failed.' }));
    return true;
  }

  // --- API status ---
  if (message.type === 'GET_API_STATUS') {
    waitForApiInit().then(() => {
      sendResponse({
        summarizer: SummarizerAPI.summarizer.status,
        promptAPI: SummarizerAPI.promptAPI.status
      });
    });
    return true;
  }

  // --- Settings ---
  if (message.type === 'GET_SETTINGS') {
    sendResponse(settings);
    return true;
  }

  // --- HTML fetch ---
  if (message.type === 'FETCH_CONTENT') {
    const url = message.url;
    if (htmlCache[url]) {
      sendResponse({ cached: true, html: htmlCache[url], url });
      return true;
    }
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response.text();
      })
      .then(html => {
        htmlCache[url] = html;
        sendResponse({ cached: false, html, url });
      })
      .catch(error => sendResponse({ error: error.message, url }));
    return true;
  }

  // --- YouTube: Caption fetch ---
  if (message.action === 'FETCH_YOUTUBE_CAPTIONS') {
    fetch(message.url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response.text();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // --- YouTube: Abort summary ---
  if (message.action === 'ABORT_YOUTUBE_SUMMARY') {
    const videoId = message.videoId;
    let targetJobId = null;
    if (videoId && youtubeJobsByVideoId.has(videoId)) {
      targetJobId = youtubeJobsByVideoId.get(videoId);
    } else if (activeYouTubeJobId) {
      targetJobId = activeYouTubeJobId;
    }
    const job = targetJobId ? getJob(targetJobId) : null;
    if (job) {
      abortJob(job.id, 'content_abort_request');
      sendResponse({ status: 'aborted', message: 'YouTube summary aborted' });
    } else {
      sendResponse({ status: 'idle', message: 'No active YouTube summary' });
    }
    return true;
  }

  // --- YouTube: Get summary ---
  if (message.action === 'GET_YOUTUBE_SUMMARY') {
    const videoId = message.videoId;
    const url = message.url;
    const tabId = sender?.tab?.id || message.tabId || null;
    handleYouTubeSummary(videoId, url, tabId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ status: 'error', error: 'PROCESSING_ERROR', message: error.message }));
    return true;
  }

  // --- Gaze: Relay status to sidepanel ---
  if (message.type === 'GAZE_STATUS') {
    chrome.runtime.sendMessage({
      type: 'GAZE_STATUS',
      phase: message.phase,
      note: message.note
    }).catch(() => {});
  }
});
