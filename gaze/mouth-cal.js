// Mouth click calibration
(function() {
    'use strict';

    const MOUTH_CALIBRATION_SAMPLES = 30;
    let overlay = null;
    let calibrating = false;

    function createOverlay(phase, text) {
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'mollitiam-mouth-cal-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.85); color: white;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        overlay.innerHTML = `
            <div style="text-align:center;max-width:400px;padding:24px;">
                <h2 style="font-size:24px;margin-bottom:12px;color:#2DD4BF;">Mouth Click Calibration</h2>
                <p id="mouth-cal-phase" style="font-size:14px;color:#94A3B8;margin-bottom:16px;">${phase}</p>
                <p id="mouth-cal-text" style="font-size:18px;margin-bottom:24px;line-height:1.4;">${text}</p>
                <div id="mouth-cal-progress" style="width:100%;height:6px;background:#334155;border-radius:3px;margin-bottom:24px;">
                    <div id="mouth-cal-bar" style="height:100%;width:0%;background:#0D9488;border-radius:3px;transition:width 0.2s;"></div>
                </div>
                <button id="mouth-cal-cancel" style="padding:8px 20px;background:transparent;color:#94A3B8;border:1px solid #475569;border-radius:8px;cursor:pointer;font-size:13px;">Cancel</button>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('mouth-cal-cancel').addEventListener('click', cancelCalibration);
    }

    function updateOverlay(phase, text, progress) {
        const phaseEl = document.getElementById('mouth-cal-phase');
        const textEl = document.getElementById('mouth-cal-text');
        const bar = document.getElementById('mouth-cal-bar');
        if (phaseEl) phaseEl.textContent = phase;
        if (textEl) textEl.textContent = text;
        if (bar && progress !== undefined) bar.style.width = progress + '%';
    }

    async function startCalibration() {
        if (calibrating) return;
        calibrating = true;

        const core = window.__gazeCore;
        if (!core || !core.isRunning()) {
            calibrating = false;
            return;
        }

        const human = core.getHuman();
        const video = core.getVideo();
        if (!human || !video) {
            calibrating = false;
            return;
        }

        // Phase 1: Collect baseline (mouth closed)
        createOverlay('Step 1 of 2', 'Keep your mouth CLOSED and stay still.');
        const baselineSamples = [];

        for (let i = 0; i < MOUTH_CALIBRATION_SAMPLES; i++) {
            if (!calibrating) return;
            try {
                const result = await human.detect(video);
                if (result?.face?.length) {
                    const face = result.face[0];
                    if (face.mesh?.length > 400) {
                        const top = face.mesh[13];
                        const bottom = face.mesh[14];
                        const left = face.mesh[78];
                        const right = face.mesh[308];
                        if (top && bottom && left && right) {
                            const vDist = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
                            const hDist = Math.hypot(left[0] - right[0], left[1] - right[1]);
                            if (hDist > 0) baselineSamples.push(vDist / hDist);
                        }
                    }
                }
            } catch (e) { /* continue */ }
            updateOverlay('Step 1 of 2', 'Keep your mouth CLOSED and stay still.', ((i + 1) / MOUTH_CALIBRATION_SAMPLES) * 100);
            await new Promise(r => setTimeout(r, 80));
        }

        if (baselineSamples.length < 10) {
            cancelCalibration();
            return;
        }

        const baselineAvg = baselineSamples.reduce((a, b) => a + b, 0) / baselineSamples.length;

        // Phase 2: Collect max (mouth open)
        updateOverlay('Step 2 of 2', 'Now OPEN your mouth wide!', 0);
        await new Promise(r => setTimeout(r, 1000));

        const maxSamples = [];
        for (let i = 0; i < MOUTH_CALIBRATION_SAMPLES; i++) {
            if (!calibrating) return;
            try {
                const result = await human.detect(video);
                if (result?.face?.length) {
                    const face = result.face[0];
                    if (face.mesh?.length > 400) {
                        const top = face.mesh[13];
                        const bottom = face.mesh[14];
                        const left = face.mesh[78];
                        const right = face.mesh[308];
                        if (top && bottom && left && right) {
                            const vDist = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
                            const hDist = Math.hypot(left[0] - right[0], left[1] - right[1]);
                            if (hDist > 0) maxSamples.push(vDist / hDist);
                        }
                    }
                }
            } catch (e) { /* continue */ }
            updateOverlay('Step 2 of 2', 'Keep your mouth OPEN wide!', ((i + 1) / MOUTH_CALIBRATION_SAMPLES) * 100);
            await new Promise(r => setTimeout(r, 80));
        }

        if (maxSamples.length < 10) {
            cancelCalibration();
            return;
        }

        const maxAvg = maxSamples.reduce((a, b) => a + b, 0) / maxSamples.length;

        // Compute threshold (midpoint between baseline and max)
        const threshold = baselineAvg + (maxAvg - baselineAvg) * 0.5;

        const calData = {
            baseline: baselineAvg,
            max: maxAvg,
            threshold,
            ts: Date.now()
        };

        chrome.storage.local.set({ mouthCalV1: calData });
        calibrating = false;
        cleanup();

        window.dispatchEvent(new CustomEvent('gaze:status', {
            detail: { phase: 'calibrated', note: 'Mouth calibration complete' }
        }));
    }

    function cancelCalibration() {
        calibrating = false;
        cleanup();
    }

    function cleanup() {
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }

    // Triggers
    window.addEventListener('gaze:startMouthCalibration', () => startCalibration());

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TRIGGER_MOUTH_CALIBRATION') {
            startCalibration();
            sendResponse({ success: true });
            return true;
        }
    });
})();
