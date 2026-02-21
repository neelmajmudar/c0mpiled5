// 5-step guided head tracking calibration
(function() {
    'use strict';

    const STEPS = [
        { id: 'center', label: 'Look Straight Ahead', instruction: 'Keep your head centered and look directly at the screen.' },
        { id: 'left', label: 'Turn Left', instruction: 'Slowly turn your head to the left while keeping your eyes on the screen.' },
        { id: 'right', label: 'Turn Right', instruction: 'Slowly turn your head to the right while keeping your eyes on the screen.' },
        { id: 'up', label: 'Look Up', instruction: 'Tilt your head slightly upward.' },
        { id: 'down', label: 'Look Down', instruction: 'Tilt your head slightly downward.' }
    ];

    let overlay = null;
    let currentStep = 0;
    let samples = [];
    let calibrating = false;
    const SAMPLES_NEEDED = 20;

    function createOverlay() {
        overlay = document.createElement('div');
        overlay.id = 'mollitiam-head-cal-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.85); color: white;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        overlay.innerHTML = `
            <div style="text-align:center;max-width:400px;padding:24px;">
                <h2 id="cal-title" style="font-size:24px;margin-bottom:8px;color:#2DD4BF;">Head Calibration</h2>
                <p id="cal-step" style="font-size:14px;color:#94A3B8;margin-bottom:16px;">Step 1 of 5</p>
                <p id="cal-instruction" style="font-size:18px;margin-bottom:24px;line-height:1.4;"></p>
                <div id="cal-progress" style="width:100%;height:6px;background:#334155;border-radius:3px;margin-bottom:24px;">
                    <div id="cal-progress-bar" style="height:100%;width:0%;background:#0D9488;border-radius:3px;transition:width 0.3s;"></div>
                </div>
                <p style="font-size:13px;color:#64748B;">Hold still and press <kbd style="background:#334155;padding:2px 8px;border-radius:4px;border:1px solid #475569;">Space</kbd> or long-blink (≥1s) to capture</p>
                <button id="cal-cancel" style="margin-top:20px;padding:8px 20px;background:transparent;color:#94A3B8;border:1px solid #475569;border-radius:8px;cursor:pointer;font-size:13px;">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('cal-cancel').addEventListener('click', cancelCalibration);
        document.addEventListener('keydown', handleCalKeydown);
        window.addEventListener('gaze:blink', handleCalBlink);
    }

    function updateOverlayUI() {
        const step = STEPS[currentStep];
        document.getElementById('cal-title').textContent = step.label;
        document.getElementById('cal-step').textContent = `Step ${currentStep + 1} of ${STEPS.length}`;
        document.getElementById('cal-instruction').textContent = step.instruction;
        document.getElementById('cal-progress-bar').style.width = '0%';
    }

    function handleCalKeydown(e) {
        if (e.code === 'Space' && calibrating) {
            e.preventDefault();
            captureStep();
        }
        if (e.code === 'Escape') {
            cancelCalibration();
        }
    }

    function handleCalBlink(e) {
        if (!calibrating) return;
        if (e.detail?.duration >= 1000) {
            captureStep();
        }
    }

    async function captureStep() {
        const core = window.__gazeCore;
        if (!core || !core.isRunning()) return;

        const human = core.getHuman();
        const video = core.getVideo();
        if (!human || !video) return;

        samples = [];
        const progressBar = document.getElementById('cal-progress-bar');

        for (let i = 0; i < SAMPLES_NEEDED; i++) {
            try {
                const result = await human.detect(video);
                if (result?.face?.length) {
                    const face = result.face[0];
                    if (face.mesh?.length > 1) {
                        const nose = face.mesh[1];
                        const leftEye = face.mesh[33];
                        const rightEye = face.mesh[263];
                        if (nose && leftEye && rightEye) {
                            const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
                            const eyeCenterY = (leftEye[1] + rightEye[1]) / 2;
                            samples.push({
                                noseOffX: nose[0] - eyeCenterX,
                                noseOffY: nose[1] - eyeCenterY
                            });
                        }
                    }
                }
            } catch (e) { /* continue */ }

            progressBar.style.width = ((i + 1) / SAMPLES_NEEDED * 100) + '%';
            await new Promise(r => setTimeout(r, 50));
        }

        if (samples.length < 5) {
            // Not enough samples — retry
            return;
        }

        // Average the samples
        const avgX = samples.reduce((s, v) => s + v.noseOffX, 0) / samples.length;
        const avgY = samples.reduce((s, v) => s + v.noseOffY, 0) / samples.length;

        // Store per step
        const stepId = STEPS[currentStep].id;
        if (!captureStep._data) captureStep._data = {};
        captureStep._data[stepId] = { x: avgX, y: avgY };

        currentStep++;
        if (currentStep < STEPS.length) {
            updateOverlayUI();
        } else {
            finishCalibration();
        }
    }

    function finishCalibration() {
        const data = captureStep._data;
        const calData = {
            cx: data.center.x,
            cy: data.center.y,
            left: data.left.x,
            right: data.right.x,
            up: data.up.y,
            down: data.down.y,
            version: 2,
            ts: Date.now()
        };

        chrome.storage.local.set({ headCalV2: calData });
        calibrating = false;
        captureStep._data = null;
        cleanup();

        window.dispatchEvent(new CustomEvent('gaze:status', {
            detail: { phase: 'calibrated', note: 'Head calibration complete' }
        }));
    }

    function cancelCalibration() {
        calibrating = false;
        captureStep._data = null;
        cleanup();
    }

    function cleanup() {
        document.removeEventListener('keydown', handleCalKeydown);
        window.removeEventListener('gaze:blink', handleCalBlink);
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    function startCalibration() {
        if (calibrating) return;
        calibrating = true;
        currentStep = 0;
        samples = [];
        captureStep._data = {};
        createOverlay();
        updateOverlayUI();
    }

    // Triggers
    window.addEventListener('gaze:startCalibration', startCalibration);

    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.code === 'KeyH') {
            e.preventDefault();
            startCalibration();
        }
    });

    // Message trigger
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TRIGGER_CALIBRATION') {
            startCalibration();
            sendResponse({ success: true });
            return true;
        }
    });
})();
