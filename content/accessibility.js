let fontEnabled = false;
let hoverEnabled = false;
let simplifiedElements = [];

// Load font state on init
chrome.storage.sync.get(['fontEnabled'], (result) => {
    fontEnabled = !!result.fontEnabled;
    if (fontEnabled) applyOpenDyslexicFont();
});

function toggleOpenDyslexicFont(enabled) {
    fontEnabled = enabled;
    if (enabled) {
        applyOpenDyslexicFont();
    } else {
        removeOpenDyslexicFont();
    }
}

function applyOpenDyslexicFont() {
    // Inject @font-face
    if (!document.getElementById('opendyslexic-font-face')) {
        const fontFace = document.createElement('style');
        fontFace.id = 'opendyslexic-font-face';
        fontFace.textContent = `
            @font-face {
                font-family: 'OpenDyslexic';
                src: url('${chrome.runtime.getURL('fonts/OpenDyslexic-Regular.otf')}') format('opentype');
                font-weight: normal;
                font-style: normal;
            }
        `;
        document.head.appendChild(fontFace);
    }

    // Inject global style
    if (!document.getElementById('opendyslexic-font-style')) {
        const style = document.createElement('style');
        style.id = 'opendyslexic-font-style';
        style.textContent = `
            body, body * {
                font-family: 'OpenDyslexic', sans-serif !important;
                line-height: 1.5 !important;
                letter-spacing: 0.5px !important;
                word-spacing: 3px !important;
            }
        `;
        document.head.appendChild(style);
    }
}

function removeOpenDyslexicFont() {
    const fontFace = document.getElementById('opendyslexic-font-face');
    if (fontFace) fontFace.remove();
    const style = document.getElementById('opendyslexic-font-style');
    if (style) style.remove();
}

function applySpacingAdjustments(lineSpacing, letterSpacing, wordSpacing) {
    const existing = document.getElementById('spacing-adjustments-style');
    if (existing) existing.remove();

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

function applyTheme(themeName) {
    let style = document.getElementById('theme-style');

    if (themeName === 'default') {
        if (style) style.remove();
        return;
    }

    const theme = themes[themeName];
    if (!theme) return;

    if (!style) {
        style = document.createElement('style');
        style.id = 'theme-style';
        document.head.appendChild(style);
    }

    style.textContent = `
        html, body {
            background-color: ${theme.backgroundColor} !important;
            color: ${theme.textColor} !important;
        }
        body * {
            color: ${theme.textColor} !important;
        }
    `;
}

function enableHoverFeature() {
    hoverEnabled = true;
    const elements = document.querySelectorAll('.simplified-text');
    elements.forEach(el => {
        el.addEventListener('mouseenter', showOriginalText);
        el.addEventListener('mouseleave', hideOriginalText);
    });
}

function disableHoverFeature() {
    hoverEnabled = false;
    const elements = document.querySelectorAll('.simplified-text');
    elements.forEach(el => {
        el.removeEventListener('mouseenter', showOriginalText);
        el.removeEventListener('mouseleave', hideOriginalText);
    });
}

function showOriginalText(event) {
    const el = event.currentTarget;
    const originalText = el.getAttribute('data-original-text');
    if (!originalText) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'original-text-tooltip';
    tooltip.textContent = originalText;

    const rect = el.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = (rect.top - 10) + 'px';
    tooltip.style.transform = 'translateY(-100%)';

    document.body.appendChild(tooltip);
    el._originalTextTooltip = tooltip;
}

function hideOriginalText(event) {
    const el = event.currentTarget;
    if (el._originalTextTooltip) {
        el._originalTextTooltip.remove();
        el._originalTextTooltip = null;
    }
}

function initAccessibility() {
    chrome.storage.sync.get(['selectedTheme'], (result) => {
        if (result.selectedTheme) {
            applyTheme(result.selectedTheme);
        }
    });

    chrome.storage.sync.get(['lineSpacing', 'letterSpacing', 'wordSpacing'], (result) => {
        const lineSpacing = result.lineSpacing || 1.5;
        const letterSpacing = result.letterSpacing || 0;
        const wordSpacing = result.wordSpacing || 0;
        if (lineSpacing !== 1.5 || letterSpacing !== 0 || wordSpacing !== 0) {
            applySpacingAdjustments(lineSpacing, letterSpacing, wordSpacing);
        }
    });
}
