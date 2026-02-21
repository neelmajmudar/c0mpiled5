// Content script on YouTube. Bridges page context <-> extension.
(function() {
    'use strict';

    // Inject caption handler into page context
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('youtube/youtube-caption-handler.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    // Re-dispatch caption ready events
    window.addEventListener('youtube-captions-ready', (e) => {
        window.dispatchEvent(new CustomEvent('yt-captions-available', {
            detail: e.detail
        }));
    });

    // Pending caption requests for correlation
    const pendingCaptionRequests = new Map();
    let requestCounter = 0;

    function getCaptionsFromPage(videoId) {
        return new Promise((resolve) => {
            const requestId = ++requestCounter;
            const timeout = setTimeout(() => {
                pendingCaptionRequests.delete(requestId);
                resolve(null);
            }, 1000);

            pendingCaptionRequests.set(requestId, { resolve, timeout });

            window.postMessage({
                type: 'YT_GET_CAPTIONS',
                videoId,
                requestId
            }, '*');
        });
    }

    // Listen for caption responses from page context
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'YT_CAPTIONS_RESPONSE') {
            const pending = pendingCaptionRequests.get(event.data.requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                pendingCaptionRequests.delete(event.data.requestId);
                pending.resolve(event.data.data);
            }
        }
    });

    // Expose to window for link-summarization.js
    window.getYouTubeCaptions = getCaptionsFromPage;
    window.hasYouTubeCaptions = function(videoId) {
        return new Promise((resolve) => {
            getCaptionsFromPage(videoId).then(data => resolve(!!data));
        });
    };

    // Handle messages from background/extension
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'GET_YOUTUBE_CAPTIONS') {
            getCaptionsFromPage(message.videoId).then((data) => {
                if (data && data.captions) {
                    sendResponse({ success: true, captions: data.captions, text: data.text });
                } else {
                    sendResponse({ success: false, error: 'No captions available' });
                }
            });
            return true;
        }
    });
})();
