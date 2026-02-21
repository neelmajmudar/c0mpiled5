// Runs in PAGE CONTEXT (injected via web_accessible_resource). YouTube only.
(function() {
    'use strict';

    if (window.__mollitiam_captionHandlerInstalled) return;
    window.__mollitiam_captionHandlerInstalled = true;

    const captionCache = new Map();

    function parseCaptions(data) {
        // JSON3 format (events + segs)
        if (data && typeof data === 'object' && data.events) {
            const captions = [];
            for (const event of data.events) {
                if (event.segs) {
                    const text = event.segs.map(s => s.utf8 || '').join('');
                    if (text.trim()) {
                        captions.push({
                            text: text.trim(),
                            start: event.tStartMs || 0,
                            duration: event.dDurationMs || 0
                        });
                    }
                }
            }
            return captions;
        }

        // XML format (<text>)
        if (typeof data === 'string' && data.includes('<text')) {
            const captions = [];
            const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>(.*?)<\/text>/gs;
            let match;
            while ((match = regex.exec(data)) !== null) {
                const text = match[3]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"')
                    .replace(/<[^>]+>/g, '');
                if (text.trim()) {
                    captions.push({
                        text: text.trim(),
                        start: parseFloat(match[1]) * 1000,
                        duration: parseFloat(match[2]) * 1000
                    });
                }
            }
            return captions;
        }

        return [];
    }

    function getVideoIdFromUrl(url) {
        const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
    }

    function setupInterception() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._captionUrl = url;
            return originalOpen.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            const xhr = this;
            const url = xhr._captionUrl || '';

            if (url && (url.includes('timedtext') || url.includes('caption'))) {
                xhr.addEventListener('load', function() {
                    try {
                        let data;
                        const responseText = xhr.responseText || xhr.response;

                        try {
                            data = JSON.parse(responseText);
                        } catch (e) {
                            data = responseText;
                        }

                        const captions = parseCaptions(data);
                        if (captions.length > 0) {
                            const videoId = getVideoIdFromUrl(window.location.href) ||
                                            getVideoIdFromUrl(url) || 'unknown';

                            const text = captions.map(c => c.text).join(' ');
                            captionCache.set(videoId, {
                                videoId,
                                captions,
                                text,
                                timestamp: Date.now()
                            });

                            // Dispatch event for content bridge
                            window.dispatchEvent(new CustomEvent('youtube-captions-ready', {
                                detail: { videoId, captionCount: captions.length }
                            }));
                        }
                    } catch (e) {
                        // Silently fail
                    }
                });
            }

            return originalSend.apply(this, args);
        };
    }

    // Expose API
    window.__ytGetCaptions = function(videoId) {
        const entry = captionCache.get(videoId);
        return entry || null;
    };

    window.__ytHasCaptions = function(videoId) {
        return captionCache.has(videoId);
    };

    window.__ytClearCache = function() {
        captionCache.clear();
    };

    // Listen for postMessage requests
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'YT_GET_CAPTIONS') {
            const videoId = event.data.videoId;
            const entry = captionCache.get(videoId);
            window.postMessage({
                type: 'YT_CAPTIONS_RESPONSE',
                videoId,
                requestId: event.data.requestId,
                data: entry || null
            }, '*');
        }
    });

    setupInterception();
})();
