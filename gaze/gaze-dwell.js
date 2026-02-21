// Dwell-to-click system
(function() {
    'use strict';

    let dwellMs = 600;
    let dwellTimer = null;
    let dwellTarget = null;
    let dwellStartTime = 0;
    let dwellIndicator = null;
    let gazeEnabled = false;

    const DWELL_RADIUS = 40; // Pixels — movement within this radius keeps dwell active

    function createDwellIndicator() {
        if (dwellIndicator) return dwellIndicator;

        dwellIndicator = document.createElement('div');
        dwellIndicator.id = 'mollitiam-dwell-indicator';
        dwellIndicator.style.cssText = `
            position: fixed; pointer-events: none; z-index: 999998;
            width: 40px; height: 40px; border-radius: 50%;
            border: 3px solid #0D9488; opacity: 0;
            transform: scale(1); transition: transform 0.1s ease, opacity 0.2s ease;
        `;
        document.body.appendChild(dwellIndicator);
        return dwellIndicator;
    }

    function showDwellProgress(x, y, progress) {
        const indicator = createDwellIndicator();
        indicator.style.left = (x - 20) + 'px';
        indicator.style.top = (y - 20) + 'px';
        indicator.style.opacity = '1';
        // Shrink as dwell progresses
        const scale = 1 - progress * 0.5;
        indicator.style.transform = `scale(${scale})`;
        indicator.style.borderColor = progress > 0.8 ? '#10B981' : '#0D9488';
    }

    function hideDwellProgress() {
        if (dwellIndicator) {
            dwellIndicator.style.opacity = '0';
            dwellIndicator.style.transform = 'scale(1)';
        }
    }

    function getElementAtPoint(x, y) {
        return document.elementFromPoint(x, y);
    }

    function isClickable(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
        if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') return true;
        if (el.onclick || el.getAttribute('onclick')) return true;
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') return true;
        return false;
    }

    function performClick(x, y, target) {
        if (!target) return;

        // Dispatch synthetic click
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            view: window
        });
        target.dispatchEvent(clickEvent);

        // Visual feedback — brief flash
        showDwellProgress(x, y, 1);
        setTimeout(hideDwellProgress, 300);
    }

    function handleGazePoint(e) {
        if (!gazeEnabled) return;

        const { x, y } = e.detail;
        const element = getElementAtPoint(x, y);

        if (!element) {
            resetDwell();
            return;
        }

        // Check if still on same target (within radius)
        if (dwellTarget && element !== dwellTarget) {
            const clickable = isClickable(element);
            if (!clickable) {
                resetDwell();
                return;
            }
        }

        if (element !== dwellTarget) {
            // New target
            dwellTarget = element;
            dwellStartTime = Date.now();

            if (isClickable(element)) {
                // Start dwell timer
                clearTimeout(dwellTimer);
                dwellTimer = setTimeout(() => {
                    performClick(x, y, dwellTarget);
                    resetDwell();
                }, dwellMs);
            }
        } else if (isClickable(element)) {
            // Show progress
            const elapsed = Date.now() - dwellStartTime;
            const progress = Math.min(elapsed / dwellMs, 1);
            showDwellProgress(x, y, progress);
        }
    }

    function resetDwell() {
        clearTimeout(dwellTimer);
        dwellTimer = null;
        dwellTarget = null;
        dwellStartTime = 0;
        hideDwellProgress();
    }

    // Handle mouth clicks as instant clicks
    function handleMouthClick(e) {
        if (!gazeEnabled) return;
        const core = window.__gazeCore;
        if (!core) return;
        const pos = core.getPointer();
        const element = getElementAtPoint(pos.x, pos.y);
        if (element) {
            performClick(pos.x, pos.y, element);
        }
    }

    // Listen for gaze points
    window.addEventListener('gaze:point', handleGazePoint);
    window.addEventListener('gaze:mouthClick', handleMouthClick);

    // Handle blink-to-click
    window.addEventListener('gaze:blink', (e) => {
        if (!gazeEnabled) return;
        const core = window.__gazeCore;
        if (!core) return;
        const pos = core.getPointer();
        const element = getElementAtPoint(pos.x, pos.y);
        if (element && isClickable(element)) {
            performClick(pos.x, pos.y, element);
        }
    });

    // Load settings
    chrome.storage.local.get(['gazeEnabled', 'gazeDwellMs'], (result) => {
        gazeEnabled = !!result.gazeEnabled;
        if (result.gazeDwellMs) dwellMs = result.gazeDwellMs;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.gazeEnabled) gazeEnabled = !!changes.gazeEnabled.newValue;
        if (changes.gazeDwellMs) dwellMs = changes.gazeDwellMs.newValue || 600;
    });

    // Keyboard shortcut: Alt+B toggles blink-to-click (handled by storage toggle)
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.code === 'KeyB') {
            e.preventDefault();
            // Toggle is managed via storage
        }
        if (e.altKey && e.code === 'KeyG') {
            e.preventDefault();
            chrome.storage.local.get(['gazeEnabled'], (result) => {
                chrome.storage.local.set({ gazeEnabled: !result.gazeEnabled });
            });
        }
    });
})();
