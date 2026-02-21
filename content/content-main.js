chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'simplify':
            (async () => {
                try {
                    const result = await simplifyPageContent();
                    sendResponse(result);
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;

        case 'toggleFont':
            toggleOpenDyslexicFont(request.enabled);
            sendResponse({ success: true });
            return true;

        case 'applyTheme':
            applyTheme(request.theme);
            sendResponse({ success: true });
            return true;

        case 'getFontState':
            sendResponse({ fontEnabled });
            return true;

        case 'adjustSpacing':
            applySpacingAdjustments(request.lineSpacing, request.letterSpacing, request.wordSpacing);
            sendResponse({ success: true });
            return true;

        case 'toggleHover':
            if (request.enabled) {
                enableHoverFeature();
            } else {
                disableHoverFeature();
            }
            sendResponse({ success: true });
            return true;

        case 'getHoverState':
            sendResponse({ hoverEnabled });
            return true;
    }

    return true;
});

// Initialize on ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initAccessibility();
        ensureInitialized();
    });
} else {
    initAccessibility();
    ensureInitialized();
}
