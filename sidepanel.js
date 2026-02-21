// ========================================
// MOLLITIAM - SIDEPANEL CONTROLLER
// ========================================

// State
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

let currentContent = { title: '', fullContent: '', summary: '' };
const elements = {};

// ============ Initialization ============

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Mollitiam] Sidepanel DOMContentLoaded');
  
  try {
    // Get all DOM elements
    cacheElements();
    await loadSettings();
    setupTabNavigation();
    setupEventListeners();
    showWelcome();
    
    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_API_STATUS' });
      console.log('[Mollitiam] API status:', status);
    } catch (e) {
      console.error('[Mollitiam] Failed to get API status:', e);
    }
    
    console.log('[Mollitiam] Sidepanel initialization complete');
  } catch (error) {
    console.error('[Mollitiam] Sidepanel initialization error:', error);
  }
});

function cacheElements() {
  // Summary tab
  elements.welcome = document.getElementById('welcome');
  elements.loadingExtract = document.getElementById('loading-extract');
  elements.loadingSummarize = document.getElementById('loading-summarize');
  elements.contentArea = document.getElementById('content-area');
  elements.error = document.getElementById('error');
  elements.title = document.getElementById('title');
  elements.aiSummary = document.getElementById('ai-summary');
  elements.articleContent = document.getElementById('article-content');
  elements.toggleBtn = document.getElementById('toggle-full-content');
  elements.fullContentSection = document.getElementById('full-content-section');
  
  // AI Settings
  elements.radioSummarization = document.getElementById('radio-summarization');
  elements.radioPrompt = document.getElementById('radio-prompt');
  elements.customPrompt = document.getElementById('custom-prompt');
  elements.promptContainer = document.getElementById('prompt-container');
  elements.displayMode = document.getElementById('display-mode');

  // Accessibility
  elements.simplifyBtn = document.getElementById('simplify-btn');
  elements.optimizeMode = document.getElementById('optimize-mode');
  elements.fontToggle = document.getElementById('font-toggle');
  elements.hoverToggle = document.getElementById('hover-toggle');
  elements.themeSelect = document.getElementById('theme-select');
  elements.lineSpacing = document.getElementById('line-spacing');
  elements.lineSpacingValue = document.getElementById('line-spacing-value');
  elements.letterSpacing = document.getElementById('letter-spacing');
  elements.letterSpacingValue = document.getElementById('letter-spacing-value');
  elements.wordSpacing = document.getElementById('word-spacing');
  elements.wordSpacingValue = document.getElementById('word-spacing-value');
  elements.resetSpacing = document.getElementById('reset-spacing');

  // Gaze controls
  elements.gazeEnabled = document.getElementById('gaze-enabled');
  elements.gazeStatusDot = document.getElementById('gaze-status-dot');
  elements.gazeStatusText = document.getElementById('gaze-status-text');
  elements.calibrateBtn = document.getElementById('calibrate-btn');
  elements.dwellTime = document.getElementById('dwell-time');
  elements.dwellValue = document.getElementById('dwell-value');

  // Mouth click controls
  elements.mouthClickEnabled = document.getElementById('mouth-click-enabled');
  elements.mouthStatusDot = document.getElementById('mouth-status-dot');
  elements.mouthStatusText = document.getElementById('mouth-status-text');
  elements.calibrateMouthBtn = document.getElementById('calibrate-mouth-btn');
}

// ============ Tab Navigation ============

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all tabs
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Activate clicked tab
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      const tabContent = document.getElementById(tabId);
      if (tabContent) tabContent.classList.add('active');
    });
  });
}

// ============ Settings ============

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    'apiChoice', 'customPrompt', 'displayMode', 'gazeEnabled', 'gazeDwellMs', 'mouthClickEnabled', 'mouthCalV1'
  ]);
  const syncStored = await chrome.storage.sync.get([
    'simplificationLevel', 'optimizeFor', 'selectedTheme', 'fontEnabled', 'hoverEnabled',
    'lineSpacing', 'letterSpacing', 'wordSpacing'
  ]);

  // Merge stored values
  if (stored.apiChoice) settings.apiChoice = stored.apiChoice;
  if (stored.customPrompt) settings.customPrompt = stored.customPrompt;
  if (stored.displayMode) settings.displayMode = stored.displayMode;
  if (typeof stored.gazeEnabled === 'boolean') settings.gazeEnabled = stored.gazeEnabled;
  if (typeof stored.gazeDwellMs === 'number') settings.gazeDwellMs = stored.gazeDwellMs;
  
  if (syncStored.simplificationLevel) settings.simplificationLevel = syncStored.simplificationLevel;
  if (syncStored.optimizeFor) settings.optimizeFor = syncStored.optimizeFor;
  if (syncStored.selectedTheme) settings.selectedTheme = syncStored.selectedTheme;
  if (typeof syncStored.fontEnabled === 'boolean') settings.fontEnabled = syncStored.fontEnabled;
  if (typeof syncStored.hoverEnabled === 'boolean') settings.hoverEnabled = syncStored.hoverEnabled;
  if (syncStored.lineSpacing) settings.lineSpacing = syncStored.lineSpacing;
  if (typeof syncStored.letterSpacing === 'number') settings.letterSpacing = syncStored.letterSpacing;
  if (typeof syncStored.wordSpacing === 'number') settings.wordSpacing = syncStored.wordSpacing;

  // Update UI from settings
  
  // AI settings
  if (elements.radioSummarization && elements.radioPrompt) {
    if (settings.apiChoice === 'summarization') elements.radioSummarization.checked = true;
    else elements.radioPrompt.checked = true;
  }
  if (elements.customPrompt) elements.customPrompt.value = settings.customPrompt;
  if (elements.displayMode) elements.displayMode.value = settings.displayMode;
  
  // Accessibility
  if (elements.optimizeMode) elements.optimizeMode.value = settings.optimizeFor;
  if (elements.fontToggle) elements.fontToggle.checked = settings.fontEnabled;
  if (elements.hoverToggle) elements.hoverToggle.checked = settings.hoverEnabled;
  if (elements.themeSelect) elements.themeSelect.value = settings.selectedTheme;
  
  // Level buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.level === settings.simplificationLevel);
  });
  
  // Spacing
  if (elements.lineSpacing) { elements.lineSpacing.value = settings.lineSpacing; }
  if (elements.lineSpacingValue) elements.lineSpacingValue.textContent = settings.lineSpacing;
  if (elements.letterSpacing) { elements.letterSpacing.value = settings.letterSpacing; }
  if (elements.letterSpacingValue) elements.letterSpacingValue.textContent = settings.letterSpacing;
  if (elements.wordSpacing) { elements.wordSpacing.value = settings.wordSpacing; }
  if (elements.wordSpacingValue) elements.wordSpacingValue.textContent = settings.wordSpacing;

  // Gaze
  if (elements.gazeEnabled) elements.gazeEnabled.checked = settings.gazeEnabled;
  if (elements.dwellTime) elements.dwellTime.value = settings.gazeDwellMs;
  if (elements.dwellValue) elements.dwellValue.textContent = settings.gazeDwellMs;
  if (elements.calibrateBtn) elements.calibrateBtn.disabled = !settings.gazeEnabled;
  if (!settings.gazeEnabled) updateGazeStatus('ready', 'Enable to start');

  // Mouth click
  const mouthEnabled = stored.mouthClickEnabled || false;
  if (elements.mouthClickEnabled) elements.mouthClickEnabled.checked = mouthEnabled;
  if (elements.calibrateMouthBtn) elements.calibrateMouthBtn.disabled = !mouthEnabled;
  updateMouthStatus(!!stored.mouthCalV1);

  togglePromptContainer();
}

async function saveLocalSettings() {
  await chrome.storage.local.set({
    apiChoice: settings.apiChoice,
    customPrompt: settings.customPrompt,
    displayMode: settings.displayMode,
    gazeEnabled: settings.gazeEnabled,
    gazeDwellMs: settings.gazeDwellMs
  });
}

async function saveSyncSettings() {
  await chrome.storage.sync.set({
    simplificationLevel: settings.simplificationLevel,
    optimizeFor: settings.optimizeFor,
    selectedTheme: settings.selectedTheme,
    fontEnabled: settings.fontEnabled,
    hoverEnabled: settings.hoverEnabled,
    lineSpacing: settings.lineSpacing,
    letterSpacing: settings.letterSpacing,
    wordSpacing: settings.wordSpacing
  });
}

// ============ Event Listeners ============

function setupEventListeners() {
  // --- Simplification ---
  
  // Level buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      settings.simplificationLevel = btn.dataset.level;
      chrome.storage.sync.set({ simplificationLevel: settings.simplificationLevel });
    });
  });
  
  // Optimize mode
  if (elements.optimizeMode) {
    elements.optimizeMode.addEventListener('change', (e) => {
      settings.optimizeFor = e.target.value;
      chrome.storage.sync.set({ optimizeFor: settings.optimizeFor });
    });
  }
  
  // Simplify button
  if (elements.simplifyBtn) {
    elements.simplifyBtn.addEventListener('click', async () => {
      elements.simplifyBtn.disabled = true;
      elements.simplifyBtn.textContent = 'Simplifying...';
      
      try {
        const response = await chrome.runtime.sendMessage({ action: 'simplifyActiveTab' });
        console.log('[Mollitiam] Simplify response:', response);
        if (response && response.success === false) {
          elements.simplifyBtn.textContent = response.error || 'Failed';
          setTimeout(() => {
            elements.simplifyBtn.disabled = false;
            elements.simplifyBtn.textContent = 'Simplify Page Text';
          }, 3000);
          return;
        }
      } catch (e) {
        console.error('[Mollitiam] Simplify failed:', e);
        elements.simplifyBtn.textContent = 'Error - Try Again';
        setTimeout(() => {
          elements.simplifyBtn.disabled = false;
          elements.simplifyBtn.textContent = 'Simplify Page Text';
        }, 3000);
        return;
      }
      
      setTimeout(() => {
        elements.simplifyBtn.disabled = false;
        elements.simplifyBtn.textContent = 'Simplify Page Text';
      }, 2000);
    });
  }
  
  // --- Visual Settings ---
  
  // Font toggle
  if (elements.fontToggle) {
    elements.fontToggle.addEventListener('change', (e) => {
      settings.fontEnabled = e.target.checked;
      chrome.storage.sync.set({ fontEnabled: settings.fontEnabled });
      relayToActiveTab({ action: 'toggleFont', enabled: settings.fontEnabled });
    });
  }
  
  // Hover toggle
  if (elements.hoverToggle) {
    elements.hoverToggle.addEventListener('change', (e) => {
      settings.hoverEnabled = e.target.checked;
      chrome.storage.sync.set({ hoverEnabled: settings.hoverEnabled });
      relayToActiveTab({ action: 'toggleHover', enabled: settings.hoverEnabled });
    });
  }
  
  // Theme select
  if (elements.themeSelect) {
    elements.themeSelect.addEventListener('change', (e) => {
      settings.selectedTheme = e.target.value;
      chrome.storage.sync.set({ selectedTheme: settings.selectedTheme });
      relayToActiveTab({ action: 'applyTheme', theme: settings.selectedTheme });
    });
  }
  
  // --- Spacing ---
  
  if (elements.lineSpacing) {
    elements.lineSpacing.addEventListener('input', (e) => {
      settings.lineSpacing = parseFloat(e.target.value);
      if (elements.lineSpacingValue) elements.lineSpacingValue.textContent = settings.lineSpacing;
      applySpacing();
    });
  }
  
  if (elements.letterSpacing) {
    elements.letterSpacing.addEventListener('input', (e) => {
      settings.letterSpacing = parseFloat(e.target.value);
      if (elements.letterSpacingValue) elements.letterSpacingValue.textContent = settings.letterSpacing;
      applySpacing();
    });
  }
  
  if (elements.wordSpacing) {
    elements.wordSpacing.addEventListener('input', (e) => {
      settings.wordSpacing = parseInt(e.target.value, 10);
      if (elements.wordSpacingValue) elements.wordSpacingValue.textContent = settings.wordSpacing;
      applySpacing();
    });
  }
  
  if (elements.resetSpacing) {
    elements.resetSpacing.addEventListener('click', () => {
      settings.lineSpacing = 1.5;
      settings.letterSpacing = 0;
      settings.wordSpacing = 0;
      if (elements.lineSpacing) { elements.lineSpacing.value = 1.5; }
      if (elements.lineSpacingValue) elements.lineSpacingValue.textContent = '1.5';
      if (elements.letterSpacing) { elements.letterSpacing.value = 0; }
      if (elements.letterSpacingValue) elements.letterSpacingValue.textContent = '0';
      if (elements.wordSpacing) { elements.wordSpacing.value = 0; }
      if (elements.wordSpacingValue) elements.wordSpacingValue.textContent = '0';
      applySpacing();
    });
  }
  
  // --- AI Settings ---
  
  document.querySelectorAll('input[name="api-choice"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      settings.apiChoice = e.target.value;
      togglePromptContainer();
      saveLocalSettings();
    });
  });
  
  if (elements.customPrompt) {
    elements.customPrompt.addEventListener('input', (e) => {
      settings.customPrompt = e.target.value;
      saveLocalSettings();
    });
  }
  
  if (elements.displayMode) {
    elements.displayMode.addEventListener('change', (e) => {
      settings.displayMode = e.target.value;
      saveLocalSettings();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'DISPLAY_MODE_CHANGED', displayMode: settings.displayMode }).catch(() => {});
        }
      });
    });
  }
  
  // Toggle full content
  if (elements.toggleBtn) {
    elements.toggleBtn.addEventListener('click', () => {
      if (elements.fullContentSection.classList.contains('hidden')) {
        elements.fullContentSection.classList.remove('hidden');
        elements.toggleBtn.textContent = 'Hide Full Content';
      } else {
        elements.fullContentSection.classList.add('hidden');
        elements.toggleBtn.textContent = 'View Full Content';
      }
    });
  }

  // --- Gaze Controls ---
  
  if (elements.gazeEnabled) {
    elements.gazeEnabled.addEventListener('change', async (e) => {
      settings.gazeEnabled = e.target.checked;
      saveLocalSettings();
      
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GAZE_ENABLED_CHANGED', gazeEnabled: settings.gazeEnabled }).catch(() => {});
        }
      });
      
      if (elements.calibrateBtn) elements.calibrateBtn.disabled = !settings.gazeEnabled;
      
      if (!settings.gazeEnabled) {
        updateGazeStatus('ready', 'Disabled');
      } else {
        updateGazeStatus('loading', 'Initializing...');
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          if (tabs[0]) {
            try {
              await chrome.tabs.sendMessage(tabs[0].id, { type: 'PING' });
            } catch (error) {
              updateGazeStatus('loading', 'Refreshing page...');
              setTimeout(() => chrome.tabs.reload(tabs[0].id), 300);
            }
          }
        });
      }
    });
  }

  if (elements.calibrateBtn) {
    elements.calibrateBtn.addEventListener('click', () => {
      elements.calibrateBtn.blur();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_CALIBRATION' }).catch(() => {});
      });
    });
  }

  if (elements.mouthClickEnabled) {
    elements.mouthClickEnabled.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      chrome.storage.local.set({ mouthClickEnabled: enabled });
      if (elements.calibrateMouthBtn) elements.calibrateMouthBtn.disabled = !enabled;
    });
  }

  if (elements.calibrateMouthBtn) {
    elements.calibrateMouthBtn.addEventListener('click', () => {
      elements.calibrateMouthBtn.blur();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'TRIGGER_MOUTH_CALIBRATION' }).catch(() => {});
      });
    });
  }

  if (elements.dwellTime) {
    elements.dwellTime.addEventListener('input', (e) => {
      const value = parseInt(e.target.value, 10);
      settings.gazeDwellMs = value;
      if (elements.dwellValue) elements.dwellValue.textContent = value;
      saveLocalSettings();
    });
  }
}

// ============ Helpers ============

function togglePromptContainer() {
  if (elements.promptContainer) {
    elements.promptContainer.classList.toggle('hidden', settings.apiChoice !== 'prompt');
  }
}

function applySpacing() {
  saveSyncSettings();
  relayToActiveTab({
    action: 'adjustSpacing',
    lineSpacing: settings.lineSpacing,
    letterSpacing: settings.letterSpacing,
    wordSpacing: settings.wordSpacing
  });
}

function relayToActiveTab(payload) {
  chrome.runtime.sendMessage({ action: 'relayToActiveTab', payload }).catch((e) => {
    console.error('[Mollitiam] relayToActiveTab failed:', e, 'payload:', payload);
  });
}

// ============ Gaze Status ============

function updateGazeStatus(phase, note) {
  if (!elements.gazeStatusDot || !elements.gazeStatusText) return;
  elements.gazeStatusDot.className = 'status-dot';
  
  if (note && note.toLowerCase().includes('disabled')) {
    elements.gazeStatusText.textContent = 'Disabled';
    return;
  }

  const statusMap = {
    'loading': { class: 'loading', text: 'Loading models...' },
    'ready': { class: 'ready', text: note || 'Ready to calibrate' },
    'live': { class: 'live', text: note || 'Active & tracking' },
    'calibrating': { class: 'loading', text: 'Calibrating...' }
  };

  const status = statusMap[phase] || { class: '', text: note || 'Unknown' };
  if (status.class) elements.gazeStatusDot.classList.add(status.class);
  elements.gazeStatusText.textContent = status.text;
}

function updateMouthStatus(calibrated) {
  if (!elements.mouthStatusDot || !elements.mouthStatusText) return;
  elements.mouthStatusDot.className = 'status-dot';
  if (calibrated) {
    elements.mouthStatusDot.classList.add('ready');
    elements.mouthStatusText.textContent = 'Calibrated';
  } else {
    elements.mouthStatusText.textContent = 'Not calibrated';
  }
}

// ============ Display States ============

function hideAll() {
  [elements.welcome, elements.loadingExtract, elements.loadingSummarize, elements.contentArea, elements.error].forEach(el => {
    if (el && el.classList) el.classList.add('hidden');
  });
}

function showWelcome() {
  hideAll();
  if (elements.welcome) elements.welcome.classList.remove('hidden');
}

function showProcessing(title) {
  if (settings.displayMode === 'tooltip') return;
  hideAll();
  if (elements.loadingExtract) elements.loadingExtract.classList.remove('hidden');
  setTimeout(() => {
    if (elements.loadingExtract) elements.loadingExtract.classList.add('hidden');
    if (elements.loadingSummarize) elements.loadingSummarize.classList.remove('hidden');
  }, 500);
}

function updateSummaryDisplay(formattedContent) {
  if (settings.displayMode === 'tooltip') return;
  if (elements.contentArea && elements.contentArea.classList.contains('hidden')) {
    hideAll();
    elements.contentArea.classList.remove('hidden');
  }
  if (elements.aiSummary) elements.aiSummary.innerHTML = formattedContent;
}

function displayCachedSummary(title, formattedSummary) {
  hideAll();
  if (elements.contentArea) elements.contentArea.classList.remove('hidden');
  if (elements.title) elements.title.textContent = title;
  if (elements.aiSummary) elements.aiSummary.innerHTML = formattedSummary;
}

// ============ Message Listener ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STREAMING_UPDATE') {
    if (settings.displayMode === 'panel' || settings.displayMode === 'both') {
      updateSummaryDisplay(message.content);
    }
  }
  if (message.type === 'PROCESSING_STATUS') {
    if (message.status === 'started') showProcessing(message.title);
  }
  if (message.type === 'DISPLAY_CACHED_SUMMARY') {
    if (settings.displayMode === 'panel' || settings.displayMode === 'both') {
      displayCachedSummary(message.title, message.summary);
    }
  }
  if (message.type === 'GAZE_STATUS') {
    updateGazeStatus(message.phase, message.note);
  }
});

// Listen for mouth calibration completion
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mouthCalV1) {
    updateMouthStatus(!!changes.mouthCalV1.newValue);
  }
});

console.log('[Mollitiam] Sidepanel script loaded');
