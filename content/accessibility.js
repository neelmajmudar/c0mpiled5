// ========================================
// MOLLITIAM - ACCESSIBILITY MODULE
// OpenDyslexic font, themes, spacing adjustments
// ========================================

let fontEnabled = false;
let hoverEnabled = false;
let simplifiedElements = [];

// Load feature states from storage when script loads
chrome.storage.sync.get(['fontEnabled'], function(result) {
    fontEnabled = result.fontEnabled || false;
    if (fontEnabled) {
        toggleOpenDyslexicFont(true);
    }
});

// Function to toggle OpenDyslexic font
function toggleOpenDyslexicFont(enabled) {
    console.log(`[Mollitiam] ${enabled ? 'Applying' : 'Removing'} OpenDyslexic font...`);
    
    if (enabled) {
        // Add font-face definition if it doesn't exist
        if (!document.getElementById('opendyslexic-font-face')) {
            const fontFaceStyle = document.createElement('style');
            fontFaceStyle.id = 'opendyslexic-font-face';
            fontFaceStyle.textContent = `
                @font-face {
                    font-family: 'OpenDyslexic';
                    src: url('${chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2')}') format('woff2'),
                         url('${chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff')}') format('woff'),
                         url('${chrome.runtime.getURL('fonts/OpenDyslexic-Regular.otf')}') format('opentype');
                    font-weight: normal;
                    font-style: normal;
                    font-display: swap;
                }
            `;
            document.head.appendChild(fontFaceStyle);
        }

        // Create or update style element to apply font to entire page
        let fontStyle = document.getElementById('opendyslexic-font-style');
        if (!fontStyle) {
            fontStyle = document.createElement('style');
            fontStyle.id = 'opendyslexic-font-style';
            document.head.appendChild(fontStyle);
        }

        fontStyle.textContent = `
            body, body * {
                font-family: 'OpenDyslexic', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif !important;
                line-height: 1.5;
                letter-spacing: 0.5px;
                word-spacing: 3px;
            }
        `;
    } else {
        const fontStyle = document.getElementById('opendyslexic-font-style');
        if (fontStyle) fontStyle.parentNode.removeChild(fontStyle);

        const fontFaceStyle = document.getElementById('opendyslexic-font-face');
        if (fontFaceStyle) fontFaceStyle.parentNode.removeChild(fontFaceStyle);
    }
}

function applyOpenDyslexicFont() {
    toggleOpenDyslexicFont(true);
}

function removeOpenDyslexicFont() {
    toggleOpenDyslexicFont(false);
}

// Function to apply spacing adjustments
function applySpacingAdjustments(lineSpacing, letterSpacing, wordSpacing) {
    const existingStyle = document.getElementById('spacing-adjustments-style');
    if (existingStyle) existingStyle.remove();

    const style = document.createElement('style');
    style.id = 'spacing-adjustments-style';
    style.textContent = `
        body, body * {
            line-height: ${lineSpacing} !important;
            letter-spacing: ${letterSpacing}px !important;
            word-spacing: ${wordSpacing}px !important;
        }
    `;
    document.head.appendChild(style);
}

// Function to apply selected theme
function applyTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    const { backgroundColor, textColor } = theme;

    let themeStyle = document.getElementById('theme-style');
    if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'theme-style';
        document.head.appendChild(themeStyle);
    }

    if (themeName === 'default') {
        themeStyle.textContent = '';
        return;
    }

    themeStyle.textContent = `
        html, body {
            background-color: ${backgroundColor} !important;
            color: ${textColor} !important;
        }
        body * {
            background-color: ${backgroundColor} !important;
            color: ${textColor} !important;
        }
    `;
}

// Hover feature for showing original text on simplified elements
function enableHoverFeature() {
    console.log("[Mollitiam] Enabling hover feature...");
    simplifiedElements = document.querySelectorAll('.simplified-text');
    simplifiedElements.forEach(el => {
        el.addEventListener('mouseenter', showOriginalText);
        el.addEventListener('mouseleave', hideOriginalText);
    });
}

function disableHoverFeature() {
    console.log("[Mollitiam] Disabling hover feature...");
    simplifiedElements.forEach(el => {
        el.removeEventListener('mouseenter', showOriginalText);
        el.removeEventListener('mouseleave', hideOriginalText);
    });
}

function showOriginalText(event) {
    const originalText = event.currentTarget.getAttribute('data-original-text');
    if (!originalText) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'original-text-tooltip';
    tooltip.textContent = originalText;
    document.body.appendChild(tooltip);

    const rect = event.currentTarget.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 10}px`;

    event.currentTarget._originalTextTooltip = tooltip;
}

function hideOriginalText(event) {
    const tooltip = event.currentTarget._originalTextTooltip;
    if (tooltip) {
        tooltip.remove();
        event.currentTarget._originalTextTooltip = null;
    }
}

// Initialize accessibility features on DOMContentLoaded
function initAccessibility() {
    // Apply saved theme
    chrome.storage.sync.get(['selectedTheme'], function(result) {
        const selectedTheme = result.selectedTheme || 'default';
        applyTheme(selectedTheme);
    });
    
    // Load and apply initial spacing settings
    chrome.storage.sync.get(['lineSpacing', 'letterSpacing', 'wordSpacing'], function(result) {
        applySpacingAdjustments(
            result.lineSpacing || 1.5,
            result.letterSpacing || 0,
            result.wordSpacing || 0
        );
    });
}
