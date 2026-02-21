// Content script that injects youtube-inject-page.js into page context.
(function() {
    'use strict';

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('youtube/youtube-inject-page.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
})();
