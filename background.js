importScripts('config/system-prompts.js', 'config/config.js', 'utils/markdown-formatter.js');

// ============================================================
// API INITIALIZATION
// ============================================================

function createInitialApiState() {
    return {
        summarizer: { available: false, status: 'unknown' },
        promptAPI: { available: false, status: 'unknown' }
    };
}

let SummarizerAPI = createInitialApiState();

function initializeSummarizerAPI() {
    const summarizer = {
        available: false,
        availability: async () => {
            try {
                if (typeof Summarizer !== 'undefined') {
                    return await Summarizer.availability();
                }
                if (self.ai && self.ai.summarizer) {
                    return await self.ai.summarizer.availability();
                }
                return 'unavailable';
            } catch (e) {
                return 'unavailable';
            }
        },
        create: async (options) => {
            if (typeof Summarizer !== 'undefined') {
                return await Summarizer.create(options);
            }
            if (self.ai && self.ai.summarizer) {
                return await self.ai.summarizer.create(options);
            }
            throw new Error('Summarizer API not available');
        }
    };

    const promptAPI = {
        available: false,
        availability: async () => {
            try {
                if (typeof LanguageModel !== 'undefined') {
                    return await LanguageModel.availability();
                }
                return 'unavailable';
            } catch (e) {
                return 'unavailable';
            }
        },
        create: async (options) => {
            if (typeof LanguageModel !== 'undefined') {
                return await LanguageModel.create(options);
            }
            throw new Error('Language Model API not available');
        },
        params: async () => {
            if (typeof LanguageModel !== 'undefined' && LanguageModel.params) {
                return await LanguageModel.params();
            }
            return null;
        }
    };

    return { summarizer, promptAPI };
}

async function initAPIs() {
    const apis = initializeSummarizerAPI();

    try {
        const summarizerStatus = await apis.summarizer.availability();
        apis.summarizer.available = summarizerStatus === 'available' || summarizerStatus === 'readily';
        SummarizerAPI.summarizer = { available: apis.summarizer.available, status: summarizerStatus };
    } catch (e) {
        SummarizerAPI.summarizer = { available: false, status: 'error' };
    }

    try {
        const promptStatus = await apis.promptAPI.availability();
        apis.promptAPI.available = promptStatus === 'available' || promptStatus === 'readily';
        SummarizerAPI.promptAPI = { available: apis.promptAPI.available, status: promptStatus };
    } catch (e) {
        SummarizerAPI.promptAPI = { available: false, status: 'error' };
    }

    SummarizerAPI._apis = apis;
    return SummarizerAPI;
}

let apiInitializationPromise = initAPIs();

// ============================================================
// SETTINGS
// ============================================================

let settings = {
    apiChoice: 'summarization',
    customPrompt: 'Summarize this article in 2-3 sentences',
    displayMode: 'tooltip'
};

chrome.storage.local.get(['apiChoice', 'customPrompt', 'displayMode'], (result) => {
    if (result.apiChoice) settings.apiChoice = result.apiChoice;
    if (result.customPrompt) settings.customPrompt = result.customPrompt;
    if (result.displayMode) settings.displayMode = result.displayMode;
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.apiChoice) settings.apiChoice = changes.apiChoice.newValue;
        if (changes.customPrompt) settings.customPrompt = changes.customPrompt.newValue;
        if (changes.displayMode) settings.displayMode = changes.displayMode.newValue;
    }
});

// ============================================================
// CACHING
// ============================================================

const htmlCache = {};
const summaryCache = new Map();
const youtubeCaptionCache = new Map();
const youtubeSummaryCache = new Map();
const youtubeDescriptionCache = new Map();
const twitterThreadCache = new Map();

const CACHE_DURATION = 30 * 60 * 1000;
const TWITTER_THREAD_TTL = 5 * 60 * 1000;

function cleanupCaches() {
    const now = Date.now();
    for (const [key, entry] of summaryCache) {
        if (now - entry.timestamp > CACHE_DURATION) summaryCache.delete(key);
    }
    for (const [key, entry] of youtubeCaptionCache) {
        if (now - entry.timestamp > CACHE_DURATION) youtubeCaptionCache.delete(key);
    }
    for (const [key, entry] of youtubeSummaryCache) {
        if (now - entry.timestamp > CACHE_DURATION) youtubeSummaryCache.delete(key);
    }
    for (const [key, entry] of youtubeDescriptionCache) {
        if (now - entry.timestamp > CACHE_DURATION) youtubeDescriptionCache.delete(key);
    }
    for (const [key, entry] of twitterThreadCache) {
        if (now - entry.timestamp > TWITTER_THREAD_TTL) twitterThreadCache.delete(key);
    }
}

setInterval(cleanupCaches, 5 * 60 * 1000);

// ============================================================
// JOB MANAGEMENT
// ============================================================

const summarizationJobs = new Map();
const youtubeJobsByVideoId = new Map();
let activePageJobId = 0;
let activeYouTubeJobId = 0;

function createSummarizationJob({ url, tabId, feature, metadata = {} }) {
    const id = Date.now() + Math.random();
    const controller = new AbortController();
    const job = {
        id, url, tabId, feature, metadata,
        controller,
        signal: controller.signal,
        session: null,
        sessionType: null,
        createdAt: Date.now()
    };
    summarizationJobs.set(id, job);
    return job;
}

function registerJobSession(jobId, session, type) {
    const job = summarizationJobs.get(jobId);
    if (job) {
        job.session = session;
        job.sessionType = type;
    }
}

function destroyJobSession(jobId) {
    const job = summarizationJobs.get(jobId);
    if (job && job.session) {
        try { job.session.destroy(); } catch (e) { /* ignore */ }
        job.session = null;
    }
}

function finalizeJob(jobId) {
    destroyJobSession(jobId);
    summarizationJobs.delete(jobId);
}

function abortJob(jobId) {
    const job = summarizationJobs.get(jobId);
    if (job) {
        job.controller.abort();
        destroyJobSession(jobId);
        summarizationJobs.delete(jobId);
    }
}

function getJob(jobId) {
    return summarizationJobs.get(jobId);
}

// ============================================================
// AI SUMMARIZATION
// ============================================================

async function summarizeContent({ job, text, url }) {
    await apiInitializationPromise;
    if (settings.apiChoice === 'summarization' && SummarizerAPI.summarizer.available) {
        return await useSummarizationAPI(job, text, url);
    } else if (SummarizerAPI.promptAPI.available) {
        return await usePromptAPI(job, text, url);
    }
    throw new Error('No AI API available');
}

async function useSummarizationAPI(job, text, url) {
    const apis = SummarizerAPI._apis;
    const session = await apis.summarizer.create({
        type: 'key-points',
        format: 'markdown',
        length: 'medium',
        sharedContext: 'This is an article from a webpage.',
        outputLanguage: 'en'
    });
    registerJobSession(job.id, session, 'summarizer');

    // Truncate to 4000 chars with start/middle/end sampling
    let truncated = text;
    if (text.length > 4000) {
        const partSize = Math.floor(4000 / 3);
        const start = text.substring(0, partSize);
        const midStart = Math.floor(text.length / 2) - Math.floor(partSize / 2);
        const middle = text.substring(midStart, midStart + partSize);
        const end = text.substring(text.length - partSize);
        truncated = start + '\n\n' + middle + '\n\n' + end;
    }

    let result = '';
    let lastBroadcast = 0;
    const stream = await session.summarizeStreaming(truncated);

    for await (const chunk of stream) {
        if (job.signal.aborted) throw new Error('Aborted');
        result = chunk.trim();
        const now = Date.now();
        if (now - lastBroadcast > 150) {
            broadcastStreamingUpdate(job, result, url);
            lastBroadcast = now;
        }
    }

    broadcastStreamingUpdate(job, result, url);
    return result;
}

async function usePromptAPI(job, text, url) {
    const apis = SummarizerAPI._apis;
    const session = await apis.promptAPI.create({
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        signal: job.signal
    });
    registerJobSession(job.id, session, 'prompt');

    // Truncate to 3000 chars
    let truncated = text;
    if (text.length > 3000) {
        const partSize = Math.floor(3000 / 3);
        const start = text.substring(0, partSize);
        const midStart = Math.floor(text.length / 2) - Math.floor(partSize / 2);
        const middle = text.substring(midStart, midStart + partSize);
        const end = text.substring(text.length - partSize);
        truncated = start + '\n\n' + middle + '\n\n' + end;
    }

    const prompt = `${settings.customPrompt}\n\nContent:\n${truncated}`;
    let result = '';
    let lastBroadcast = 0;
    const stream = await session.promptStreaming(prompt);

    for await (const chunk of stream) {
        if (job.signal.aborted) throw new Error('Aborted');
        // Each chunk is the FULL accumulated text, not a delta
        result = chunk.trim();
        const now = Date.now();
        if (now - lastBroadcast > 150) {
            broadcastStreamingUpdate(job, result, url);
            lastBroadcast = now;
        }
    }

    broadcastStreamingUpdate(job, result, url);
    return result;
}

function broadcastStreamingUpdate(job, text, url) {
    const formatted = formatAISummary(text);
    const message = {
        type: 'STREAMING_UPDATE',
        jobId: job.id,
        url: url,
        content: formatted,
        rawContent: text
    };

    // Send to sidepanel
    chrome.runtime.sendMessage(message).catch(() => {});

    // Send to content tab
    if (job.tabId) {
        chrome.tabs.sendMessage(job.tabId, message).catch(() => {});
    }
}

// ============================================================
// PLATFORM-SPECIFIC HANDLERS
// ============================================================

// --- Twitter ---
async function handleTwitterBackgroundScrape(tweetUrl, sendResponse) {
    const cacheKey = tweetUrl;
    const cached = twitterThreadCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < TWITTER_THREAD_TTL) {
        sendResponse({ success: true, thread: cached.data });
        return;
    }

    try {
        const tab = await chrome.tabs.create({ url: tweetUrl, active: false });
        await waitForTabComplete(tab.id, 18000);

        let thread = null;
        // Try message approach (3 attempts)
        for (let i = 0; i < 3; i++) {
            try {
                thread = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_TWITTER_THREAD' });
                if (thread) break;
            } catch (e) { /* retry */ }
            await new Promise(r => setTimeout(r, 1000));
        }

        // Fallback: executeScript
        if (!thread) {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: captureTwitterThreadInTab
            });
            if (results && results[0]) thread = results[0].result;
        }

        if (thread) {
            twitterThreadCache.set(cacheKey, { data: thread, timestamp: Date.now() });
        }

        chrome.tabs.remove(tab.id).catch(() => {});
        sendResponse({ success: !!thread, thread });
    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}

function captureTwitterThreadInTab() {
    // Scroll and expand thread, then extract articles
    const articles = document.querySelectorAll('article[role="article"]');
    const tweets = [];
    articles.forEach(article => {
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const userEl = article.querySelector('[data-testid="User-Name"]');
        if (textEl) {
            tweets.push({
                text: textEl.innerText,
                author: userEl ? userEl.innerText.split('\n')[0] : 'Unknown',
                element: null
            });
        }
    });
    return tweets.length > 0 ? tweets.slice(0, 12) : null;
}

function waitForTabComplete(tabId, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, timeout);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 2000);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// --- Reddit ---
function buildRedditApiUrl(url) {
    let apiUrl = url;
    apiUrl = apiUrl.replace('old.reddit.com', 'reddit.com');
    if (apiUrl.includes('redd.it/')) {
        apiUrl = apiUrl.replace('redd.it/', 'reddit.com/comments/');
    }
    if (!apiUrl.endsWith('/')) apiUrl += '/';
    apiUrl += '.json?limit=40&depth=2&raw_json=1';
    return apiUrl;
}

function extractRedditThread(data) {
    if (!Array.isArray(data) || data.length < 1) return null;

    const postData = data[0]?.data?.children?.[0]?.data;
    if (!postData) return null;

    const post = {
        title: postData.title,
        selftext: (postData.selftext || '').substring(0, 1500),
        subreddit: postData.subreddit,
        author: postData.author,
        score: postData.score
    };

    const comments = [];
    if (data[1]?.data?.children) {
        const sorted = data[1].data.children
            .filter(c => c.kind === 't1' && c.data?.body)
            .sort((a, b) => (b.data.score || 0) - (a.data.score || 0))
            .slice(0, 5);

        for (const c of sorted) {
            comments.push({
                author: c.data.author,
                body: (c.data.body || '').substring(0, 600),
                score: c.data.score
            });
        }
    }

    return { post, comments };
}

function buildRedditSummaryInput(thread) {
    let input = `Reddit Post: ${thread.post.title}\n`;
    input += `Subreddit: r/${thread.post.subreddit} | Author: u/${thread.post.author} | Score: ${thread.post.score}\n\n`;
    if (thread.post.selftext) {
        input += `Post Content:\n${thread.post.selftext}\n\n`;
    }
    input += `Top Comments:\n`;
    for (const c of thread.comments) {
        input += `- u/${c.author} (${c.score} pts): ${c.body}\n`;
    }
    input += `\nFocus on: main viewpoints, consensus, and disagreements.`;
    return input;
}

async function handleSummarizeRedditPost(url, tabId, sendResponse) {
    try {
        const apiUrl = buildRedditApiUrl(url);
        const response = await fetch(apiUrl, {
            headers: { 'User-Agent': 'Mollitiam/1.0' }
        });
        const data = await response.json();
        const thread = extractRedditThread(data);
        if (!thread) {
            sendResponse({ success: false, error: 'Could not extract Reddit thread' });
            return;
        }
        const text = buildRedditSummaryInput(thread);
        const job = createSummarizationJob({ url, tabId, feature: 'reddit' });
        try {
            const result = await summarizeContent({ job, text, url });
            const formatted = formatAISummary(result);
            summaryCache.set(`${url}_${settings.apiChoice}_${settings.customPrompt}`, {
                data: formatted, timestamp: Date.now()
            });
            sendResponse({ success: true, summary: formatted, title: thread.post.title });
        } finally {
            finalizeJob(job.id);
        }
    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}

// --- YouTube ---
function parseCaptionData(data) {
    // JSON3 format (events + segs)
    if (data && data.events) {
        const lines = [];
        for (const event of data.events) {
            if (event.segs) {
                const text = event.segs.map(s => s.utf8).join('');
                if (text.trim()) lines.push(text.trim());
            }
        }
        return lines;
    }
    // XML format
    if (typeof data === 'string' && data.includes('<text')) {
        const lines = [];
        const regex = /<text[^>]*>(.*?)<\/text>/gs;
        let match;
        while ((match = regex.exec(data)) !== null) {
            const text = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
            if (text.trim()) lines.push(text.trim());
        }
        return lines;
    }
    // Plain JSON array
    if (Array.isArray(data)) {
        return data.map(item => item.text || item.utf8 || '').filter(t => t.trim());
    }
    return [];
}

async function fetchYouTubeDescription(videoId) {
    const cached = youtubeDescriptionCache.get(videoId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.data;

    try {
        const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
        const html = await resp.text();
        let description = '';

        const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (playerMatch) {
            try {
                const player = JSON.parse(playerMatch[1]);
                description = player?.videoDetails?.shortDescription || '';
            } catch (e) { /* ignore */ }
        }

        if (!description) {
            const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) ||
                              html.match(/<meta[^>]+content="([^"]*)"[^>]+name="description"/);
            if (metaMatch) description = metaMatch[1];
        }

        youtubeDescriptionCache.set(videoId, { data: description, timestamp: Date.now() });
        return description;
    } catch (e) {
        return '';
    }
}

function clipTranscript(text, maxLen) {
    if (text.length <= maxLen) return text;
    const partSize = Math.floor(maxLen / 3);
    const start = text.substring(0, partSize);
    const midStart = Math.floor(text.length / 2) - Math.floor(partSize / 2);
    const middle = text.substring(midStart, midStart + partSize);
    const end = text.substring(text.length - partSize);
    return start + '\n...\n' + middle + '\n...\n' + end;
}

function buildYouTubeSummarizationInput(videoId, description, transcript) {
    let input = `YouTube Video: ${videoId}\n\n`;
    if (description) {
        input += `Description:\n${description.substring(0, 1000)}\n\n`;
    }
    if (transcript) {
        const clipped = clipTranscript(transcript, 4000 - input.length);
        input += `Transcript:\n${clipped}`;
    }
    return input.substring(0, 4000);
}

async function handleYouTubeSummary(videoId, tabId, sendResponse) {
    // Deduplicate
    const existingJobId = youtubeJobsByVideoId.get(videoId);
    if (existingJobId) {
        sendResponse({ success: false, status: 'duplicate' });
        return;
    }

    // Check cache
    const cacheKey = `yt_${videoId}_${settings.apiChoice}_${settings.customPrompt}`;
    const cached = youtubeSummaryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        sendResponse({ success: true, summary: cached.data, cached: true });
        return;
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const job = createSummarizationJob({ url, tabId, feature: 'youtube', metadata: { videoId } });
    activeYouTubeJobId = job.id;
    youtubeJobsByVideoId.set(videoId, job.id);

    try {
        // Fetch description
        const description = await fetchYouTubeDescription(videoId);

        // Request captions (6 retries)
        let captions = null;
        const cachedCaptions = youtubeCaptionCache.get(videoId);
        if (cachedCaptions && Date.now() - cachedCaptions.timestamp < CACHE_DURATION) {
            captions = cachedCaptions.data;
        } else {
            for (let retry = 0; retry < 6; retry++) {
                try {
                    const captionResult = await chrome.tabs.sendMessage(tabId, {
                        action: 'GET_YOUTUBE_CAPTIONS',
                        videoId
                    });
                    if (captionResult && captionResult.captions) {
                        captions = captionResult.captions;
                        youtubeCaptionCache.set(videoId, { data: captions, timestamp: Date.now() });
                        break;
                    }
                } catch (e) { /* retry */ }
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        const transcript = captions ? captions.map(c => c.text || c).join(' ') : '';
        const input = buildYouTubeSummarizationInput(videoId, description, transcript);
        const result = await summarizeContent({ job, text: input, url });
        const formatted = formatAISummary(result);

        youtubeSummaryCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
        sendResponse({ success: true, summary: formatted });
    } catch (e) {
        if (e.message === 'Aborted') {
            sendResponse({ success: false, status: 'aborted' });
        } else {
            sendResponse({ success: false, error: e.message });
        }
    } finally {
        youtubeJobsByVideoId.delete(videoId);
        finalizeJob(job.id);
    }
}

// --- Content Summarization ---
async function handleSummarizeContent(url, tabId, sendResponse) {
    // Deduplicate
    const existingJob = Array.from(summarizationJobs.values()).find(
        j => j.url === url && j.feature === 'content'
    );
    if (existingJob) {
        sendResponse({ success: false, status: 'duplicate' });
        return;
    }

    // Abort old page job
    if (activePageJobId) {
        const oldJob = getJob(activePageJobId);
        if (oldJob && oldJob.url !== url) {
            abortJob(activePageJobId);
        }
    }

    // Check cache
    const cacheKey = `${url}_${settings.apiChoice}_${settings.customPrompt}`;
    const cached = summaryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        sendResponse({ success: true, summary: cached.data, cached: true });
        return;
    }

    const job = createSummarizationJob({ url, tabId, feature: 'content' });
    activePageJobId = job.id;

    try {
        // Fetch HTML
        let html = htmlCache[url];
        if (!html) {
            const resp = await fetch(url);
            html = await resp.text();
            htmlCache[url] = html;
        }

        // Parse with Readability concept — content is sent from content script
        // The actual text is provided in the message, not fetched here
        sendResponse({ success: true, status: 'processing', jobId: job.id });
    } catch (e) {
        sendResponse({ success: false, error: e.message });
        finalizeJob(job.id);
    }
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // --- Action-based messages ---
    if (message.action === 'getSystemPrompts') {
        sendResponse({ success: true, prompts: systemPrompts });
        return true;
    }

    if (message.action === 'simplifyText') {
        (async () => {
            try {
                await apiInitializationPromise;
                const apis = SummarizerAPI._apis;
                if (!apis || !apis.promptAPI.available) {
                    sendResponse({ success: false, error: 'Prompt API not available' });
                    return;
                }
                const session = await apis.promptAPI.create({
                    systemPrompt: message.systemPrompt,
                    expectedOutputs: [{ type: 'text', languages: ['en'] }]
                });
                let result = '';
                const stream = await session.promptStreaming(message.text);
                for await (const chunk of stream) {
                    // Each chunk is full accumulated text
                    result = chunk.trim();
                }
                session.destroy();
                sendResponse({ success: true, simplifiedText: result });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'checkPromptAPI') {
        (async () => {
            await apiInitializationPromise;
            sendResponse({
                available: SummarizerAPI.promptAPI.available,
                status: SummarizerAPI.promptAPI.status
            });
        })();
        return true;
    }

    if (message.action === 'simplifyActiveTab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'simplify' });
            }
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'relayToActiveTab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, message.payload).catch(() => {});
            }
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'storeLogs') {
        // Store logs (no-op for now, could persist to storage)
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'FETCH_YOUTUBE_CAPTIONS') {
        (async () => {
            try {
                const resp = await fetch(message.url);
                const data = await resp.text();
                sendResponse({ success: true, data });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.action === 'ABORT_YOUTUBE_SUMMARY') {
        const videoJobId = youtubeJobsByVideoId.get(message.videoId);
        if (videoJobId) abortJob(videoJobId);
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'GET_YOUTUBE_SUMMARY') {
        handleYouTubeSummary(message.videoId, sender.tab?.id, sendResponse);
        return true;
    }

    // --- Type-based messages ---
    if (message.type === 'SCRAPE_TWITTER_THREAD') {
        handleTwitterBackgroundScrape(message.url, sendResponse);
        return true;
    }

    if (message.type === 'SUMMARIZE_CONTENT') {
        (async () => {
            const url = message.url;
            const tabId = sender.tab?.id;

            // Deduplicate
            const existingJob = Array.from(summarizationJobs.values()).find(
                j => j.url === url && j.feature === 'content'
            );
            if (existingJob) {
                sendResponse({ success: false, status: 'duplicate' });
                return;
            }

            if (activePageJobId) {
                const oldJob = getJob(activePageJobId);
                if (oldJob && oldJob.url !== url) abortJob(activePageJobId);
            }

            const cacheKey = `${url}_${settings.apiChoice}_${settings.customPrompt}`;
            const cached = summaryCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
                sendResponse({ success: true, summary: cached.data, cached: true, title: message.title });
                return;
            }

            const job = createSummarizationJob({ url, tabId, feature: 'content' });
            activePageJobId = job.id;

            try {
                const text = message.text || message.content || '';
                const result = await summarizeContent({ job, text, url });
                const formatted = formatAISummary(result);
                summaryCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
                sendResponse({ success: true, summary: formatted, title: message.title });
            } catch (e) {
                if (e.message === 'Aborted') {
                    sendResponse({ success: false, status: 'aborted' });
                } else {
                    sendResponse({ success: false, error: e.message });
                }
            } finally {
                finalizeJob(job.id);
            }
        })();
        return true;
    }

    if (message.type === 'SUMMARIZE_REDDIT_POST') {
        handleSummarizeRedditPost(message.url, sender.tab?.id, sendResponse);
        return true;
    }

    if (message.type === 'GET_API_STATUS') {
        (async () => {
            await apiInitializationPromise;
            sendResponse({
                summarizer: SummarizerAPI.summarizer,
                promptAPI: SummarizerAPI.promptAPI
            });
        })();
        return true;
    }

    if (message.type === 'GET_SETTINGS') {
        sendResponse(settings);
        return true;
    }

    if (message.type === 'FETCH_CONTENT') {
        (async () => {
            try {
                const url = message.url;
                if (htmlCache[url]) {
                    sendResponse({ success: true, html: htmlCache[url] });
                    return;
                }
                const resp = await fetch(url);
                const html = await resp.text();
                htmlCache[url] = html;
                sendResponse({ success: true, html });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (message.type === 'GAZE_STATUS') {
        chrome.runtime.sendMessage(message).catch(() => {});
        return true;
    }

    return true;
});

// ============================================================
// EXTENSION LIFECYCLE
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
    console.log('Mollitiam installed:', details.reason);
    chrome.storage.sync.remove('readingLevel');
});

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId });
});
