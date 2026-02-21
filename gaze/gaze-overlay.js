// Debug HUD overlay for gaze tracking
(function() {
    'use strict';

    let overlay = null;
    let pointerDot = null;
    let statusPanel = null;
    let debugVisible = false;
    let gazeEnabled = false;

    function createOverlay() {
        if (overlay) return;

        // Inject CSS
        const cssUrl = chrome.runtime.getURL('gaze/gaze-overlay.css');
        if (!document.getElementById('mollitiam-gaze-overlay-css')) {
            const link = document.createElement('link');
            link.id = 'mollitiam-gaze-overlay-css';
            link.rel = 'stylesheet';
            link.href = cssUrl;
            document.head.appendChild(link);
        }

        // Pointer dot
        pointerDot = document.createElement('div');
        pointerDot.id = 'mollitiam-gaze-pointer';
        pointerDot.className = 'gaze-pointer-dot';
        document.body.appendChild(pointerDot);

        // Status panel
        statusPanel = document.createElement('div');
        statusPanel.id = 'mollitiam-gaze-status-panel';
        statusPanel.className = 'gaze-status-panel';
        statusPanel.innerHTML = `
            <div class="gaze-status-header">Mollitiam Gaze Debug</div>
            <div class="gaze-status-row">
                <span>Position:</span>
                <span id="gaze-debug-pos">—</span>
            </div>
            <div class="gaze-status-row">
                <span>Confidence:</span>
                <span id="gaze-debug-confidence">—</span>
            </div>
            <div class="gaze-status-row">
                <span>Calibration:</span>
                <span id="gaze-debug-cal">—</span>
            </div>
            <div class="gaze-status-row">
                <span>Status:</span>
                <span id="gaze-debug-status">—</span>
            </div>
        `;
        document.body.appendChild(statusPanel);

        overlay = true;
    }

    function destroyOverlay() {
        if (pointerDot) { pointerDot.remove(); pointerDot = null; }
        if (statusPanel) { statusPanel.remove(); statusPanel = null; }
        overlay = null;
    }

    function updatePointer(x, y, confidence) {
        if (!pointerDot || !debugVisible) return;

        pointerDot.style.left = (x - 10) + 'px';
        pointerDot.style.top = (y - 10) + 'px';
        pointerDot.style.opacity = confidence > 0.3 ? '1' : '0.4';

        const posEl = document.getElementById('gaze-debug-pos');
        const confEl = document.getElementById('gaze-debug-confidence');
        if (posEl) posEl.textContent = `${Math.round(x)}, ${Math.round(y)}`;
        if (confEl) {
            confEl.textContent = (confidence * 100).toFixed(0) + '%';
            confEl.style.color = confidence > 0.7 ? '#10B981' : confidence > 0.4 ? '#F59E0B' : '#EF4444';
        }
    }

    function updateStatus(phase, note) {
        if (!debugVisible) return;
        const statusEl = document.getElementById('gaze-debug-status');
        if (statusEl) statusEl.textContent = note || phase || '—';
    }

    function updateCalibrationStatus() {
        chrome.storage.local.get(['headCalV2', 'mouthCalV1'], (result) => {
            const calEl = document.getElementById('gaze-debug-cal');
            if (!calEl) return;
            const parts = [];
            if (result.headCalV2) parts.push('Head ✓');
            else parts.push('Head ✗');
            if (result.mouthCalV1) parts.push('Mouth ✓');
            else parts.push('Mouth ✗');
            calEl.textContent = parts.join(' | ');
        });
    }

    function toggleDebug() {
        debugVisible = !debugVisible;

        if (debugVisible) {
            createOverlay();
            if (pointerDot) pointerDot.style.display = 'block';
            if (statusPanel) statusPanel.style.display = 'block';
            updateCalibrationStatus();
        } else {
            if (pointerDot) pointerDot.style.display = 'none';
            if (statusPanel) statusPanel.style.display = 'none';
        }
    }

    // Listen for gaze points
    window.addEventListener('gaze:point', (e) => {
        if (!gazeEnabled) return;

        // Always move pointer dot if gaze is active (even if debug panel hidden)
        if (pointerDot && gazeEnabled) {
            pointerDot.style.left = (e.detail.x - 10) + 'px';
            pointerDot.style.top = (e.detail.y - 10) + 'px';
            pointerDot.style.display = 'block';
        }

        if (debugVisible) {
            updatePointer(e.detail.x, e.detail.y, e.detail.confidence);
        }
    });

    // Listen for status updates
    window.addEventListener('gaze:status', (e) => {
        updateStatus(e.detail?.phase, e.detail?.note);
    });

    // Alt+D toggles debug HUD
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.code === 'KeyD') {
            e.preventDefault();
            toggleDebug();
        }
    });

    // Track gaze enabled state
    chrome.storage.local.get(['gazeEnabled'], (result) => {
        gazeEnabled = !!result.gazeEnabled;
        if (gazeEnabled) createOverlay();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.gazeEnabled) {
            gazeEnabled = !!changes.gazeEnabled.newValue;
            if (gazeEnabled) {
                createOverlay();
            } else {
                if (pointerDot) pointerDot.style.display = 'none';
            }
        }
    });
})();
