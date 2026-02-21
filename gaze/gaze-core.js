// IIFE. Core face detection and head tracking.
(function() {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================

    const DEFAULT_DWELL_MS = 600;
    const POINT_THROTTLE_MS = 33; // ~30fps

    // One-Euro filter parameters
    const HEAD_FILTER_MIN_CUTOFF = 0.4;
    const HEAD_FILTER_BETA = 0.0025;
    const HEAD_FILTER_D_CUTOFF = 1.0;

    // Head pointer parameters
    const HEAD_POINTER_LERP = 0.12;
    const HEAD_TRANSLATION_GAIN = 1;
    const HEAD_ROTATION_INFLUENCE = 0.22;
    const HEAD_CENTER_LERP = 0.06;
    const HEAD_EDGE_LERP = 0.10;

    // Blink detection
    const BLINK_LEFT_THRESHOLD_MS = 1000;
    const BLINK_RIGHT_THRESHOLD_MS = 2000;

    // Mouth detection
    const MOUTH_CALIBRATION_SAMPLES = 30;
    const MOUTH_OPEN_COOLDOWN_MS = 800;

    // ============================================================
    // STATE
    // ============================================================

    let human = null;
    let video = null;
    let stream = null;
    let running = false;
    let gazeEnabled = false;
    let detectionLoop = null;

    // Calibration
    let headCal = null;
    let earCal = null;
    let mouthCal = null;

    // Pointer state
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let smoothX = pointerX;
    let smoothY = pointerY;
    let lastPointTime = 0;

    // Blink state
    let leftEyeClosed = false;
    let rightEyeClosed = false;
    let leftCloseTime = 0;
    let rightCloseTime = 0;

    // Mouth state
    let mouthClickEnabled = false;
    let lastMouthClickTime = 0;

    // Filters
    let filterX = null;
    let filterY = null;

    // ============================================================
    // ONE-EURO FILTER
    // ============================================================

    class OneEuroFilter {
        constructor(freq, minCutoff, beta, dCutoff) {
            this.freq = freq;
            this.minCutoff = minCutoff;
            this.beta = beta;
            this.dCutoff = dCutoff;
            this.xPrev = null;
            this.dxPrev = 0;
            this.tPrev = null;
        }

        alpha(cutoff) {
            const te = 1.0 / this.freq;
            const tau = 1.0 / (2 * Math.PI * cutoff);
            return 1.0 / (1.0 + tau / te);
        }

        filter(x, timestamp) {
            if (this.tPrev === null) {
                this.xPrev = x;
                this.tPrev = timestamp;
                return x;
            }

            const dt = timestamp - this.tPrev;
            if (dt > 0) this.freq = 1.0 / dt;
            this.tPrev = timestamp;

            // Derivative
            const dx = (x - this.xPrev) * this.freq;
            const edx = this.alpha(this.dCutoff) * dx + (1 - this.alpha(this.dCutoff)) * this.dxPrev;
            this.dxPrev = edx;

            // Adaptive cutoff
            const cutoff = this.minCutoff + this.beta * Math.abs(edx);
            const result = this.alpha(cutoff) * x + (1 - this.alpha(cutoff)) * this.xPrev;
            this.xPrev = result;

            return result;
        }

        reset() {
            this.xPrev = null;
            this.dxPrev = 0;
            this.tPrev = null;
        }
    }

    // ============================================================
    // UTILITY
    // ============================================================

    function dispatchGazeStatus(phase, note) {
        window.dispatchEvent(new CustomEvent('gaze:status', {
            detail: { phase, note }
        }));
    }

    function dispatchGazePoint(x, y, confidence) {
        window.dispatchEvent(new CustomEvent('gaze:point', {
            detail: { x, y, confidence }
        }));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function adaptiveLerp(x, y) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = Math.abs(x - cx) / cx;
        const dy = Math.abs(y - cy) / cy;
        const edgeFactor = Math.max(dx, dy);
        return lerp(HEAD_CENTER_LERP, HEAD_EDGE_LERP, edgeFactor);
    }

    // ============================================================
    // CAMERA & HUMAN.JS SETUP
    // ============================================================

    async function loadHumanJS() {
        if (human) return human;

        try {
            const humanUrl = chrome.runtime.getURL('gaze/human/human.esm.js');
            const module = await import(humanUrl);
            const Human = module.default || module.Human;

            const modelsPath = chrome.runtime.getURL('gaze/human/models/');

            human = new Human({
                modelBasePath: modelsPath,
                backend: 'webgl',
                face: {
                    enabled: true,
                    detector: { enabled: true, maxDetected: 1, rotation: false },
                    mesh: { enabled: true },
                    iris: { enabled: true },
                    description: { enabled: false },
                    emotion: { enabled: false }
                },
                body: { enabled: false },
                hand: { enabled: false },
                object: { enabled: false },
                gesture: { enabled: false }
            });

            await human.load();
            return human;
        } catch (e) {
            dispatchGazeStatus('error', 'Failed to load face detection');
            throw e;
        }
    }

    async function startCamera() {
        if (video && stream) return;

        video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            video.srcObject = stream;
            await video.play();
        } catch (e) {
            dispatchGazeStatus('error', 'Camera access denied');
            throw e;
        }
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        if (video) {
            video.remove();
            video = null;
        }
    }

    // ============================================================
    // FACE PROCESSING
    // ============================================================

    function extractFaceData(result) {
        if (!result?.face?.length) return null;
        const face = result.face[0];

        if (!face.mesh?.length || !face.rotation) return null;

        // Key landmarks
        const nose = face.mesh[1]; // Nose tip
        const leftEye = face.mesh[33]; // Left eye inner
        const rightEye = face.mesh[263]; // Right eye inner

        if (!nose || !leftEye || !rightEye) return null;

        // Eye center
        const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
        const eyeCenterY = (leftEye[1] + rightEye[1]) / 2;

        // Head rotation
        const yaw = face.rotation.angle?.yaw || 0;
        const pitch = face.rotation.angle?.pitch || 0;
        const roll = face.rotation.angle?.roll || 0;

        // Eye Aspect Ratio for blink detection
        let leftEAR = 0, rightEAR = 0;
        if (face.mesh.length > 380) {
            // Left eye landmarks
            const l1 = face.mesh[159], l2 = face.mesh[145]; // vertical
            const l3 = face.mesh[33], l4 = face.mesh[133]; // horizontal
            if (l1 && l2 && l3 && l4) {
                const vDist = Math.hypot(l1[0] - l2[0], l1[1] - l2[1]);
                const hDist = Math.hypot(l3[0] - l4[0], l3[1] - l4[1]);
                leftEAR = hDist > 0 ? vDist / hDist : 0;
            }

            // Right eye landmarks
            const r1 = face.mesh[386], r2 = face.mesh[374];
            const r3 = face.mesh[263], r4 = face.mesh[362];
            if (r1 && r2 && r3 && r4) {
                const vDist = Math.hypot(r1[0] - r2[0], r1[1] - r2[1]);
                const hDist = Math.hypot(r3[0] - r4[0], r3[1] - r4[1]);
                rightEAR = hDist > 0 ? vDist / hDist : 0;
            }
        }

        // Mouth aspect ratio
        let mouthRatio = 0;
        if (face.mesh.length > 400) {
            const top = face.mesh[13]; // Upper lip
            const bottom = face.mesh[14]; // Lower lip
            const left = face.mesh[78]; // Left corner
            const right = face.mesh[308]; // Right corner
            if (top && bottom && left && right) {
                const vDist = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
                const hDist = Math.hypot(left[0] - right[0], left[1] - right[1]);
                mouthRatio = hDist > 0 ? vDist / hDist : 0;
            }
        }

        return {
            nose: { x: nose[0], y: nose[1] },
            eyeCenter: { x: eyeCenterX, y: eyeCenterY },
            yaw, pitch, roll,
            leftEAR, rightEAR,
            mouthRatio,
            confidence: face.boxScore || face.score || 0.5
        };
    }

    function computeHeadPointer(faceData) {
        if (!headCal) return null;

        // Nose offset relative to eye center (calibration-corrected)
        const noseOffX = faceData.nose.x - faceData.eyeCenter.x;
        const noseOffY = faceData.nose.y - faceData.eyeCenter.y;

        const calNoseOffX = headCal.cx;
        const calNoseOffY = headCal.cy;

        const deltaX = noseOffX - calNoseOffX;
        const deltaY = noseOffY - calNoseOffY;

        // Map to screen coordinates using calibration ranges
        const rangeX = Math.max(Math.abs(headCal.left - calNoseOffX), Math.abs(headCal.right - calNoseOffX)) || 1;
        const rangeY = Math.max(Math.abs(headCal.up - calNoseOffY), Math.abs(headCal.down - calNoseOffY)) || 1;

        let screenX = 0.5 + (deltaX / rangeX) * 0.5 * HEAD_TRANSLATION_GAIN;
        let screenY = 0.5 + (deltaY / rangeY) * 0.5 * HEAD_TRANSLATION_GAIN;

        // Blend in rotation influence
        screenX += faceData.yaw * HEAD_ROTATION_INFLUENCE;
        screenY += faceData.pitch * HEAD_ROTATION_INFLUENCE;

        // Clamp 0-1
        screenX = Math.max(0, Math.min(1, screenX));
        screenY = Math.max(0, Math.min(1, screenY));

        return {
            x: screenX * window.innerWidth,
            y: screenY * window.innerHeight
        };
    }

    // ============================================================
    // BLINK DETECTION
    // ============================================================

    function processBlinkDetection(faceData) {
        if (!earCal) return;
        const threshold = earCal.threshold || 0.2;
        const now = Date.now();

        // Left eye
        if (faceData.leftEAR < threshold && !leftEyeClosed) {
            leftEyeClosed = true;
            leftCloseTime = now;
        } else if (faceData.leftEAR >= threshold && leftEyeClosed) {
            leftEyeClosed = false;
            const duration = now - leftCloseTime;
            if (duration >= BLINK_LEFT_THRESHOLD_MS) {
                window.dispatchEvent(new CustomEvent('gaze:blink', {
                    detail: { eye: 'left', duration }
                }));
            }
        }

        // Right eye
        if (faceData.rightEAR < threshold && !rightEyeClosed) {
            rightEyeClosed = true;
            rightCloseTime = now;
        } else if (faceData.rightEAR >= threshold && rightEyeClosed) {
            rightEyeClosed = false;
            const duration = now - rightCloseTime;
            if (duration >= BLINK_RIGHT_THRESHOLD_MS) {
                window.dispatchEvent(new CustomEvent('gaze:blink', {
                    detail: { eye: 'right', duration }
                }));
            }
        }
    }

    // ============================================================
    // MOUTH DETECTION
    // ============================================================

    function processMouthDetection(faceData) {
        if (!mouthClickEnabled || !mouthCal) return;
        const now = Date.now();
        if (now - lastMouthClickTime < MOUTH_OPEN_COOLDOWN_MS) return;

        if (faceData.mouthRatio > mouthCal.threshold) {
            lastMouthClickTime = now;
            window.dispatchEvent(new CustomEvent('gaze:mouthClick', {
                detail: { ratio: faceData.mouthRatio }
            }));
        }
    }

    // ============================================================
    // DETECTION LOOP
    // ============================================================

    async function runDetectionLoop() {
        if (!running || !video || !human) return;

        try {
            const result = await human.detect(video);
            const faceData = extractFaceData(result);

            if (faceData) {
                const now = performance.now() / 1000;

                // Compute raw pointer
                const raw = computeHeadPointer(faceData);
                if (raw) {
                    // Apply One-Euro filter
                    if (!filterX) {
                        filterX = new OneEuroFilter(30, HEAD_FILTER_MIN_CUTOFF, HEAD_FILTER_BETA, HEAD_FILTER_D_CUTOFF);
                        filterY = new OneEuroFilter(30, HEAD_FILTER_MIN_CUTOFF, HEAD_FILTER_BETA, HEAD_FILTER_D_CUTOFF);
                    }

                    const filteredX = filterX.filter(raw.x, now);
                    const filteredY = filterY.filter(raw.y, now);

                    // Adaptive LERP smoothing
                    const lerpFactor = adaptiveLerp(filteredX, filteredY);
                    smoothX = lerp(smoothX, filteredX, lerpFactor);
                    smoothY = lerp(smoothY, filteredY, lerpFactor);

                    pointerX = smoothX;
                    pointerY = smoothY;

                    // Throttle point dispatch
                    const nowMs = Date.now();
                    if (nowMs - lastPointTime >= POINT_THROTTLE_MS) {
                        lastPointTime = nowMs;
                        dispatchGazePoint(pointerX, pointerY, faceData.confidence);
                    }
                }

                // Blink & mouth detection
                processBlinkDetection(faceData);
                processMouthDetection(faceData);
            }
        } catch (e) {
            // Detection error — continue loop
        }

        // Schedule next frame
        if (running) {
            if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
                video.requestVideoFrameCallback(() => runDetectionLoop());
            } else {
                requestAnimationFrame(() => runDetectionLoop());
            }
        }
    }

    // ============================================================
    // START / STOP
    // ============================================================

    async function startGaze() {
        if (running) return;
        running = true;

        dispatchGazeStatus('loading', 'Loading face detection...');

        try {
            await loadHumanJS();
            dispatchGazeStatus('loading', 'Starting camera...');
            await startCamera();

            // Load calibration
            const stored = await new Promise(r => {
                chrome.storage.local.get(['headCalV2', 'earCalV2', 'mouthCalV1', 'mouthClickEnabled'], r);
            });

            headCal = stored.headCalV2 || null;
            earCal = stored.earCalV2 || null;
            mouthCal = stored.mouthCalV1 || null;
            mouthClickEnabled = !!stored.mouthClickEnabled;

            // Initialize filters
            filterX = new OneEuroFilter(30, HEAD_FILTER_MIN_CUTOFF, HEAD_FILTER_BETA, HEAD_FILTER_D_CUTOFF);
            filterY = new OneEuroFilter(30, HEAD_FILTER_MIN_CUTOFF, HEAD_FILTER_BETA, HEAD_FILTER_D_CUTOFF);

            if (headCal) {
                dispatchGazeStatus('calibrated', 'Calibrated — tracking active');
            } else {
                dispatchGazeStatus('ready', 'Ready — calibration needed');
            }

            runDetectionLoop();
        } catch (e) {
            running = false;
            dispatchGazeStatus('error', e.message || 'Failed to start');
        }
    }

    function stopGaze() {
        running = false;
        stopCamera();
        filterX = null;
        filterY = null;
        dispatchGazeStatus('disabled', 'Disabled');
    }

    // ============================================================
    // STORAGE LISTENERS
    // ============================================================

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        if (changes.gazeEnabled) {
            gazeEnabled = !!changes.gazeEnabled.newValue;
            if (gazeEnabled) {
                startGaze();
            } else {
                stopGaze();
            }
        }

        if (changes.headCalV2) {
            headCal = changes.headCalV2.newValue || null;
            if (headCal && running) {
                dispatchGazeStatus('calibrated', 'Calibration updated');
            }
        }

        if (changes.earCalV2) {
            earCal = changes.earCalV2.newValue || null;
        }

        if (changes.mouthCalV1) {
            mouthCal = changes.mouthCalV1.newValue || null;
        }

        if (changes.mouthClickEnabled) {
            mouthClickEnabled = !!changes.mouthClickEnabled.newValue;
        }

        if (changes.gazeDwellMs) {
            // Dwell module reads this from storage directly
        }
    });

    // Initialize from stored state
    chrome.storage.local.get(['gazeEnabled'], (result) => {
        gazeEnabled = !!result.gazeEnabled;
        if (gazeEnabled) startGaze();
    });

    // Expose for calibration modules
    window.__gazeCore = {
        getHuman: () => human,
        getVideo: () => video,
        isRunning: () => running,
        getPointer: () => ({ x: pointerX, y: pointerY }),
        startGaze,
        stopGaze
    };

})();
