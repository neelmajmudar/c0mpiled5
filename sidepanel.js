// ============================================================
// STATE
// ============================================================

let settings = {
    apiChoice: 'summarization',
    customPrompt: 'Summarize this article in 2-3 sentences',
    displayMode: 'tooltip',
    gazeEnabled: false,
    gazeDwellMs: 600,
    simplificationLevel: '3',
    optimizeFor: 'textClarity',
    selectedTheme: 'default',
    fontEnabled: false,
    hoverEnabled: false,
    lineSpacing: 1.5,
    letterSpacing: 0,
    wordSpacing: 0
};

let elements = {};

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    loadSettings();
    setupTabNavigation();
    setupEventListeners();
    showWelcome();

    // Query API status
    chrome.runtime.sendMessage({ type: 'GET_API_STATUS' }, (response) => {
        if (chrome.runtime.lastError) return;
        // Could update UI with API status indicators here
    });
});

function cacheElements() {
    elements = {
        // Tabs
        tabBtns: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),

        // Accessibility
        levelBtns: document.querySelectorAll('.level-btn'),
        optimizeMode: document.getElementById('optimize-mode'),
        simplifyBtn: document.getElementById('simplify-btn'),
        fontToggle: document.getElementById('font-toggle'),
        hoverToggle: document.getElementById('hover-toggle'),
        themeSelect: document.getElementById('theme-select'),
        lineSpacing: document.getElementById('line-spacing'),
        letterSpacing: document.getElementById('letter-spacing'),
        wordSpacing: document.getElementById('word-spacing'),
        lineSpacingValue: document.getElementById('line-spacing-value'),
        letterSpacingValue: document.getElementById('letter-spacing-value'),
        wordSpacingValue: document.getElementById('word-spacing-value'),
        resetSpacingBtn: document.getElementById('reset-spacing-btn'),

        // AI Summary
        displayMode: document.getElementById('display-mode'),
        apiChoiceRadios: document.querySelectorAll('input[name="api-choice"]'),
        customPrompt: document.getElementById('custom-prompt'),
        promptContainer: document.getElementById('prompt-container'),
        loadingState: document.getElementById('loading-state'),
        loadingText: document.getElementById('loading-text'),
        contentArea: document.getElementById('content-area'),
        title: document.getElementById('title'),
        aiSummary: document.getElementById('ai-summary'),
        toggleContentBtn: document.getElementById('toggle-content-btn'),
        fullContentSection: document.getElementById('full-content-section'),
        articleContent: document.getElementById('article-content'),
        fallbackArticle: document.getElementById('fallback-article'),
        errorState: document.getElementById('error-state'),
        errorMessage: document.getElementById('error-message'),
        welcomeState: document.getElementById('welcome-state'),

        // Tracking
        gazeToggle: document.getElementById('gaze-toggle'),
        gazeStatusDot: document.getElementById('gaze-status-dot'),
        gazeStatusText: document.getElementById('gaze-status-text'),
        calibrateBtn: document.getElementById('calibrate-btn'),
        dwellTime: document.getElementById('dwell-time'),
        dwellValue: document.getElementById('dwell-value'),
        mouthToggle: document.getElementById('mouth-toggle'),
        mouthStatusDot: document.getElementById('mouth-status-dot'),
        mouthStatusText: document.getElementById('mouth-status-text'),
        mouthCalibrateBtn: document.getElementById('mouth-calibrate-btn')
    };
}

function loadSettings() {
    // Load from chrome.storage.local
    chrome.storage.local.get(
        ['apiChoice', 'customPrompt', 'displayMode', 'gazeEnabled', 'gazeDwellMs', 'mouthClickEnabled'],
        (result) => {
            if (result.apiChoice) {
                settings.apiChoice = result.apiChoice;
                elements.apiChoiceRadios.forEach(r => {
                    r.checked = r.value === settings.apiChoice;
                });
                togglePromptContainer();
            }
            if (result.customPrompt) {
                settings.customPrompt = result.customPrompt;
                elements.customPrompt.value = settings.customPrompt;
            }
            if (result.displayMode) {
                settings.displayMode = result.displayMode;
                elements.displayMode.value = settings.displayMode;
            }
            if (result.gazeEnabled !== undefined) {
                settings.gazeEnabled = result.gazeEnabled;
                elements.gazeToggle.checked = settings.gazeEnabled;
                elements.calibrateBtn.disabled = !settings.gazeEnabled;
                if (settings.gazeEnabled) updateGazeStatus('loading', 'Initializing...');
            }
            if (result.gazeDwellMs) {
                settings.gazeDwellMs = result.gazeDwellMs;
                elements.dwellTime.value = settings.gazeDwellMs;
                elements.dwellValue.textContent = settings.gazeDwellMs + 'ms';
            }
            if (result.mouthClickEnabled) {
                elements.mouthToggle.checked = true;
                elements.mouthCalibrateBtn.disabled = false;
            }
        }
    );

    // Load from chrome.storage.sync
    chrome.storage.sync.get(
        ['simplificationLevel', 'optimizeFor', 'selectedTheme', 'fontEnabled',
         'hoverEnabled', 'lineSpacing', 'letterSpacing', 'wordSpacing'],
        (result) => {
            if (result.simplificationLevel) {
                settings.simplificationLevel = result.simplificationLevel;
                elements.levelBtns.forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.level === settings.simplificationLevel);
                });
            }
            if (result.optimizeFor) {
                settings.optimizeFor = result.optimizeFor;
                elements.optimizeMode.value = settings.optimizeFor;
            }
            if (result.selectedTheme) {
                settings.selectedTheme = result.selectedTheme;
                elements.themeSelect.value = settings.selectedTheme;
            }
            if (result.fontEnabled !== undefined) {
                settings.fontEnabled = result.fontEnabled;
                elements.fontToggle.checked = settings.fontEnabled;
            }
            if (result.hoverEnabled !== undefined) {
                settings.hoverEnabled = result.hoverEnabled;
                elements.hoverToggle.checked = settings.hoverEnabled;
            }
            if (result.lineSpacing !== undefined) {
                settings.lineSpacing = result.lineSpacing;
                elements.lineSpacing.value = settings.lineSpacing;
                elements.lineSpacingValue.textContent = settings.lineSpacing;
            }
            if (result.letterSpacing !== undefined) {
                settings.letterSpacing = result.letterSpacing;
                elements.letterSpacing.value = settings.letterSpacing;
                elements.letterSpacingValue.textContent = settings.letterSpacing;
            }
            if (result.wordSpacing !== undefined) {
                settings.wordSpacing = result.wordSpacing;
                elements.wordSpacing.value = settings.wordSpacing;
                elements.wordSpacingValue.textContent = settings.wordSpacing;
            }
        }
    );
}

// ============================================================
// TAB NAVIGATION
// ============================================================

function setupTabNavigation() {
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            elements.tabBtns.forEach(b => b.classList.remove('active'));
            elements.tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');
        });
    });
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
    // --- Level buttons ---
    elements.levelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.levelBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            settings.simplificationLevel = btn.dataset.level;
            chrome.storage.sync.set({ simplificationLevel: settings.simplificationLevel });
        });
    });

    // --- Optimize mode ---
    elements.optimizeMode.addEventListener('change', () => {
        settings.optimizeFor = elements.optimizeMode.value;
        chrome.storage.sync.set({ optimizeFor: settings.optimizeFor });
    });

    // --- Simplify button ---
    elements.simplifyBtn.addEventListener('click', () => {
        elements.simplifyBtn.disabled = true;
        elements.simplifyBtn.textContent = 'Simplifying...';
        chrome.runtime.sendMessage({ action: 'simplifyActiveTab' });
        setTimeout(() => {
            elements.simplifyBtn.disabled = false;
            elements.simplifyBtn.innerHTML = '&#10024; Simplify Page Text';
        }, 2000);
    });

    // --- Font toggle ---
    elements.fontToggle.addEventListener('change', () => {
        settings.fontEnabled = elements.fontToggle.checked;
        chrome.storage.sync.set({ fontEnabled: settings.fontEnabled });
        relayToActiveTab({ action: 'toggleFont', enabled: settings.fontEnabled });
    });

    // --- Hover toggle ---
    elements.hoverToggle.addEventListener('change', () => {
        settings.hoverEnabled = elements.hoverToggle.checked;
        chrome.storage.sync.set({ hoverEnabled: settings.hoverEnabled });
        relayToActiveTab({ action: 'toggleHover', enabled: settings.hoverEnabled });
    });

    // --- Theme select ---
    elements.themeSelect.addEventListener('change', () => {
        settings.selectedTheme = elements.themeSelect.value;
        chrome.storage.sync.set({ selectedTheme: settings.selectedTheme });
        relayToActiveTab({ action: 'applyTheme', theme: settings.selectedTheme });
    });

    // --- Spacing sliders ---
    elements.lineSpacing.addEventListener('input', () => {
        elements.lineSpacingValue.textContent = elements.lineSpacing.value;
        applySpacing();
    });
    elements.letterSpacing.addEventListener('input', () => {
        elements.letterSpacingValue.textContent = elements.letterSpacing.value;
        applySpacing();
    });
    elements.wordSpacing.addEventListener('input', () => {
        elements.wordSpacingValue.textContent = elements.wordSpacing.value;
        applySpacing();
    });

    // --- Reset spacing ---
    elements.resetSpacingBtn.addEventListener('click', () => {
        elements.lineSpacing.value = 1.5;
        elements.letterSpacing.value = 0;
        elements.wordSpacing.value = 0;
        elements.lineSpacingValue.textContent = '1.5';
        elements.letterSpacingValue.textContent = '0';
        elements.wordSpacingValue.textContent = '0';
        applySpacing();
    });

    // --- API choice radios ---
    elements.apiChoiceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            settings.apiChoice = radio.value;
            chrome.storage.local.set({ apiChoice: settings.apiChoice });
            togglePromptContainer();
        });
    });

    // --- Custom prompt ---
    elements.customPrompt.addEventListener('input', () => {
        settings.customPrompt = elements.customPrompt.value;
        chrome.storage.local.set({ customPrompt: settings.customPrompt });
    });

    // --- Display mode ---
    elements.displayMode.addEventListener('change', () => {
        settings.displayMode = elements.displayMode.value;
        chrome.storage.local.set({ displayMode: settings.displayMode });
        relayToActiveTab({ type: 'DISPLAY_MODE_CHANGED', displayMode: settings.displayMode });
    });

    // --- Toggle full content ---
    elements.toggleContentBtn.addEventListener('click', () => {
        const section = elements.fullContentSection;
        const visible = section.style.display !== 'none';
        section.style.display = visible ? 'none' : 'block';
        elements.toggleContentBtn.textContent = visible ? 'Show Full Content' : 'Hide Full Content';
    });

    // --- Gaze toggle ---
    elements.gazeToggle.addEventListener('change', () => {
        settings.gazeEnabled = elements.gazeToggle.checked;
        chrome.storage.local.set({ gazeEnabled: settings.gazeEnabled });
        relayToActiveTab({ type: 'GAZE_ENABLED_CHANGED', enabled: settings.gazeEnabled });
        elements.calibrateBtn.disabled = !settings.gazeEnabled;
        if (!settings.gazeEnabled) {
            updateGazeStatus('disabled', 'Disabled');
        }
    });

    // --- Calibrate button ---
    elements.calibrateBtn.addEventListener('click', () => {
        relayToActiveTab({ type: 'TRIGGER_CALIBRATION' });
    });

    // --- Mouth toggle ---
    elements.mouthToggle.addEventListener('change', () => {
        const enabled = elements.mouthToggle.checked;
        chrome.storage.local.set({ mouthClickEnabled: enabled });
        elements.mouthCalibrateBtn.disabled = !enabled;
        if (!enabled) updateMouthStatus(false);
    });

    // --- Mouth calibrate button ---
    elements.mouthCalibrateBtn.addEventListener('click', () => {
        relayToActiveTab({ type: 'TRIGGER_MOUTH_CALIBRATION' });
    });

    // --- Dwell slider ---
    elements.dwellTime.addEventListener('input', () => {
        settings.gazeDwellMs = parseInt(elements.dwellTime.value);
        elements.dwellValue.textContent = settings.gazeDwellMs + 'ms';
        chrome.storage.local.set({ gazeDwellMs: settings.gazeDwellMs });
    });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function relayToActiveTab(payload) {
    chrome.runtime.sendMessage({ action: 'relayToActiveTab', payload });
}

function togglePromptContainer() {
    elements.promptContainer.style.display =
        settings.apiChoice === 'prompt' ? 'block' : 'none';
}

function applySpacing() {
    settings.lineSpacing = parseFloat(elements.lineSpacing.value);
    settings.letterSpacing = parseFloat(elements.letterSpacing.value);
    settings.wordSpacing = parseFloat(elements.wordSpacing.value);

    chrome.storage.sync.set({
        lineSpacing: settings.lineSpacing,
        letterSpacing: settings.letterSpacing,
        wordSpacing: settings.wordSpacing
    });

    relayToActiveTab({
        action: 'adjustSpacing',
        lineSpacing: settings.lineSpacing,
        letterSpacing: settings.letterSpacing,
        wordSpacing: settings.wordSpacing
    });
}

function updateGazeStatus(phase, note) {
    const dot = elements.gazeStatusDot;
    const text = elements.gazeStatusText;

    dot.className = 'status-dot';
    if (phase === 'loading') dot.classList.add('loading');
    else if (phase === 'ready') dot.classList.add('ready');
    else if (phase === 'calibrated') dot.classList.add('calibrated');
    else if (phase === 'live') dot.classList.add('live');

    text.textContent = note || phase || 'Disabled';
}

function updateMouthStatus(calibrated) {
    const dot = elements.mouthStatusDot;
    const text = elements.mouthStatusText;

    dot.className = 'status-dot';
    if (calibrated) {
        dot.classList.add('calibrated');
        text.textContent = 'Calibrated';
    } else {
        text.textContent = elements.mouthToggle.checked ? 'Not calibrated' : 'Disabled';
    }
}

// ============================================================
// DISPLAY FUNCTIONS
// ============================================================

function hideAll() {
    elements.welcomeState.style.display = 'none';
    elements.loadingState.style.display = 'none';
    elements.contentArea.style.display = 'none';
    elements.errorState.style.display = 'none';
}

function showWelcome() {
    hideAll();
    elements.welcomeState.style.display = 'block';
}

function showProcessing(title) {
    hideAll();
    elements.loadingState.style.display = 'block';
    elements.loadingText.textContent = 'Extracting content...';
    setTimeout(() => {
        if (elements.loadingState.style.display !== 'none') {
            elements.loadingText.textContent = 'Summarizing...';
        }
    }, 500);
}

function updateSummaryDisplay(formattedContent) {
    elements.aiSummary.innerHTML = formattedContent;
}

function displayCachedSummary(title, formattedSummary) {
    hideAll();
    elements.contentArea.style.display = 'block';
    elements.title.textContent = title || '';
    elements.aiSummary.innerHTML = formattedSummary;
}

// ============================================================
// MESSAGE LISTENER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STREAMING_UPDATE') {
        if (settings.displayMode === 'panel') {
            hideAll();
            elements.contentArea.style.display = 'block';
            if (message.title) elements.title.textContent = message.title;
            updateSummaryDisplay(message.content);
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'PROCESSING_STATUS') {
        if (settings.displayMode === 'panel') {
            showProcessing(message.title);
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'DISPLAY_CACHED_SUMMARY') {
        if (settings.displayMode === 'panel') {
            displayCachedSummary(message.title, message.summary);
        }
        sendResponse({ received: true });
        return true;
    }

    if (message.type === 'GAZE_STATUS') {
        updateGazeStatus(message.phase, message.note);
        sendResponse({ received: true });
        return true;
    }

    return true;
});

// ============================================================
// STORAGE CHANGE LISTENER
// ============================================================

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mouthCalV1) {
        updateMouthStatus(!!changes.mouthCalV1.newValue);
    }
});
