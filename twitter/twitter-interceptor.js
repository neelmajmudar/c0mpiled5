// Page context (injected). IIFE with installation guard.
(function() {
    'use strict';

    if (window.__hoverTwitterInterceptorInstalled) return;
    window.__hoverTwitterInterceptorInstalled = true;

    function shouldCapture(url) {
        if (!url || typeof url !== 'string') return false;
        if (!url.includes('/i/api/graphql/')) return false;
        return /TweetDetail|TweetResultByRestId|ConversationTimeline|threaded_conversation/i.test(url);
    }

    // Patch fetch
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const response = await originalFetch.call(this, input, init);

        if (shouldCapture(url)) {
            try {
                const clone = response.clone();
                const json = await clone.json();
                window.postMessage({
                    source: 'hover-preview-twitter',
                    type: 'TWITTER_GQL_RESPONSE',
                    payload: { url, json }
                }, '*');
            } catch (e) {
                // Silently fail — non-JSON response or parse error
            }
        }

        return response;
    };

    // Patch XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._twitterInterceptUrl = url;
        return originalOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const xhr = this;
        const url = xhr._twitterInterceptUrl || '';

        if (shouldCapture(url)) {
            xhr.addEventListener('load', function() {
                try {
                    const json = JSON.parse(xhr.responseText);
                    window.postMessage({
                        source: 'hover-preview-twitter',
                        type: 'TWITTER_GQL_RESPONSE',
                        payload: { url, json }
                    }, '*');
                } catch (e) {
                    // Silently fail
                }
            });
        }

        return originalSend.apply(this, args);
    };
})();
