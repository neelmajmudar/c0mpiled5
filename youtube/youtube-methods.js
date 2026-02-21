// Utility library for YouTube operations. Available as window.YouTubeMethods.
(function() {
    'use strict';

    const YouTubeMethods = {};

    // Extract video ID from 10+ URL formats
    YouTubeMethods.extractVideoId = function(url) {
        if (!url) return null;
        const patterns = [
            /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/vi\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/vi_webp\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.com\/.*[?&]v=)([a-zA-Z0-9_-]{11})/,
            /(?:youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /(?:youtube\.googleapis\.com\/v\/)([a-zA-Z0-9_-]{11})/,
            /(?:m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    };

    // Parse caption data in multiple formats
    YouTubeMethods.parseCaptionData = function(data, format) {
        // JSON3 format
        if (format === 'json3' || (data && typeof data === 'object' && data.events)) {
            const captions = [];
            for (const event of (data.events || [])) {
                if (event.segs) {
                    const text = event.segs.map(s => s.utf8 || '').join('');
                    if (text.trim()) {
                        captions.push({ text: text.trim(), start: event.tStartMs || 0 });
                    }
                }
            }
            return captions;
        }

        // XML format
        if (format === 'xml' || (typeof data === 'string' && data.includes('<text'))) {
            const captions = [];
            const regex = /<text[^>]*start="([\d.]+)"[^>]*>(.*?)<\/text>/gs;
            let match;
            while ((match = regex.exec(typeof data === 'string' ? data : '')) !== null) {
                const text = match[2]
                    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>').replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"').replace(/<[^>]+>/g, '');
                if (text.trim()) {
                    captions.push({ text: text.trim(), start: parseFloat(match[1]) * 1000 });
                }
            }
            return captions;
        }

        // Plain JSON array
        if (Array.isArray(data)) {
            return data.map(item => ({
                text: item.text || item.utf8 || '',
                start: item.start || item.tStartMs || 0
            })).filter(c => c.text.trim());
        }

        return [];
    };

    // Join captions into plain text
    YouTubeMethods.captionsToText = function(captions) {
        return captions.map(c => c.text).join(' ');
    };

    // Fetch captions directly (tries 3 endpoints)
    YouTubeMethods.fetchCaptionsDirect = async function(videoId, lang = 'en') {
        const endpoints = [
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
            `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}`,
            `https://video.google.com/timedtext?v=${videoId}&lang=${lang}`
        ];

        for (const url of endpoints) {
            try {
                // In extension context, route through background
                if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
                    const response = await new Promise((resolve) => {
                        chrome.runtime.sendMessage(
                            { action: 'FETCH_YOUTUBE_CAPTIONS', url },
                            resolve
                        );
                    });
                    if (response?.success && response.data) {
                        let parsed;
                        try { parsed = JSON.parse(response.data); } catch (e) { parsed = response.data; }
                        const captions = YouTubeMethods.parseCaptionData(parsed);
                        if (captions.length > 0) return captions;
                    }
                } else {
                    const resp = await fetch(url);
                    if (resp.ok) {
                        const text = await resp.text();
                        let parsed;
                        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
                        const captions = YouTubeMethods.parseCaptionData(parsed);
                        if (captions.length > 0) return captions;
                    }
                }
            } catch (e) { /* try next */ }
        }
        return [];
    };

    // Setup network intercept (monkey-patches fetch/XHR)
    YouTubeMethods.setupNetworkIntercept = function() {
        const captures = [];
        const origFetch = window.fetch;
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;

        window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : input?.url || '';
            const response = await origFetch.call(this, input, init);
            if (url.includes('timedtext') || url.includes('caption')) {
                try {
                    const clone = response.clone();
                    const text = await clone.text();
                    captures.push({ url, data: text, source: 'fetch', timestamp: Date.now() });
                } catch (e) { /* ignore */ }
            }
            return response;
        };

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._ytMethodsUrl = url;
            return origOpen.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            const xhr = this;
            if (xhr._ytMethodsUrl && (xhr._ytMethodsUrl.includes('timedtext') || xhr._ytMethodsUrl.includes('caption'))) {
                xhr.addEventListener('load', () => {
                    captures.push({ url: xhr._ytMethodsUrl, data: xhr.responseText, source: 'xhr', timestamp: Date.now() });
                });
            }
            return origSend.apply(this, args);
        };

        // Return cleanup function
        return function cleanup() {
            window.fetch = origFetch;
            XMLHttpRequest.prototype.open = origOpen;
            XMLHttpRequest.prototype.send = origSend;
            return captures;
        };
    };

    // Setup webRequest intercept (background only)
    YouTubeMethods.setupWebRequestIntercept = function() {
        if (typeof chrome === 'undefined' || !chrome.webRequest) return null;
        const captures = [];
        chrome.webRequest.onCompleted.addListener(
            (details) => {
                if (details.url.includes('timedtext') || details.url.includes('caption')) {
                    captures.push({ url: details.url, timestamp: Date.now() });
                }
            },
            { urls: ['*://*.youtube.com/*', '*://*.google.com/*'] }
        );
        return captures;
    };

    // Wait for captions via custom event
    YouTubeMethods.waitForCaptions = function(videoId, timeout = 10000) {
        return new Promise((resolve) => {
            const handler = (e) => {
                if (e.detail?.videoId === videoId) {
                    window.removeEventListener('youtube-captions-ready', handler);
                    clearTimeout(timer);
                    resolve(e.detail);
                }
            };
            window.addEventListener('youtube-captions-ready', handler);
            const timer = setTimeout(() => {
                window.removeEventListener('youtube-captions-ready', handler);
                resolve(null);
            }, timeout);
        });
    };

    window.YouTubeMethods = YouTubeMethods;
})();
