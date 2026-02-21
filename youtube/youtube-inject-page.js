// Page context testing utility. Intercepts fetch + XHR for timedtext/caption.
(function() {
    'use strict';

    if (window.__mollitiam_ytTestInstalled) return;
    window.__mollitiam_ytTestInstalled = true;

    const captureData = new Map();
    let interceptActive = false;
    let originalFetch = null;
    let originalXhrOpen = null;
    let originalXhrSend = null;

    function startCapture() {
        if (interceptActive) return;
        interceptActive = true;

        // Intercept fetch
        originalFetch = window.fetch;
        window.fetch = async function(input, init) {
            const url = typeof input === 'string' ? input : input?.url || '';
            const response = await originalFetch.call(this, input, init);

            if (url.includes('timedtext') || url.includes('caption')) {
                try {
                    const clone = response.clone();
                    const text = await clone.text();
                    captureData.set(url, {
                        url,
                        data: text,
                        timestamp: Date.now(),
                        source: 'fetch'
                    });
                    showNotification('Caption captured (fetch)');
                } catch (e) { /* ignore */ }
            }

            return response;
        };

        // Intercept XHR
        originalXhrOpen = XMLHttpRequest.prototype.open;
        originalXhrSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...args) {
            this._testUrl = url;
            return originalXhrOpen.call(this, method, url, ...args);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            const xhr = this;
            const url = xhr._testUrl || '';

            if (url.includes('timedtext') || url.includes('caption')) {
                xhr.addEventListener('load', function() {
                    try {
                        captureData.set(url, {
                            url,
                            data: xhr.responseText || xhr.response,
                            timestamp: Date.now(),
                            source: 'xhr'
                        });
                        showNotification('Caption captured (XHR)');
                    } catch (e) { /* ignore */ }
                });
            }

            return originalXhrSend.apply(this, args);
        };
    }

    function stopCapture() {
        if (!interceptActive) return;
        interceptActive = false;

        if (originalFetch) window.fetch = originalFetch;
        if (originalXhrOpen) XMLHttpRequest.prototype.open = originalXhrOpen;
        if (originalXhrSend) XMLHttpRequest.prototype.send = originalXhrSend;
    }

    function showNotification(msg) {
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = `
            position: fixed; top: 10px; right: 10px; z-index: 999999;
            background: #0D9488; color: white; padding: 8px 16px;
            border-radius: 8px; font-size: 13px; font-family: sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    // Expose test API
    window.__ytCaptureData = captureData;
    window.ytTestStart = startCapture;
    window.ytTestStop = stopCapture;
    window.ytTestResults = () => Array.from(captureData.entries());
})();
