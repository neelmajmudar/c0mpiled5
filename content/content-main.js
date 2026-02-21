// ========================================
// MOLLITIAM - CONTENT MAIN ORCHESTRATOR
// Handles message routing between modules
// ========================================

// Listen for messages from popup/sidepanel/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        console.log("[Mollitiam] Received action:", request.action);
        switch (request.action) {
            case "simplify":
                try {
                    const result = await simplifyPageContent();
                    sendResponse(result || { success: true });
                } catch (error) {
                    console.error('[Mollitiam] Error simplifying content:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;
                
            case "toggleFont":
                fontEnabled = request.enabled;
                toggleOpenDyslexicFont(fontEnabled);
                sendResponse({ success: true });
                break;
                
            case "applyTheme":
                applyTheme(request.theme);
                sendResponse({ success: true });
                break;
                
            case "getFontState":
                sendResponse({ fontEnabled: fontEnabled });
                break;
                
            case "adjustSpacing":
                const { lineSpacing, letterSpacing, wordSpacing } = request;
                applySpacingAdjustments(lineSpacing, letterSpacing, wordSpacing);
                sendResponse({ success: true });
                break;
                
            case "toggleHover":
                hoverEnabled = request.enabled;
                if (hoverEnabled) {
                    enableHoverFeature();
                } else {
                    disableHoverFeature();
                }
                sendResponse({ success: true });
                break;

            case "getHoverState":
                sendResponse({ hoverEnabled: hoverEnabled });
                break;

            default:
                sendResponse({ success: true });
                break;
        }
    })();
    return true;
});

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    initAccessibility();
    ensureInitialized();
});

// Also initialize immediately if DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initAccessibility();
    ensureInitialized();
}

console.log('[Mollitiam] Content scripts loaded');
