(function () {
    'use strict';

    const DEFAULT_NOTE_RANGE = { min: 21, max: 108 };
    const LOOKAHEAD_SECONDS = 6;
    const NOTE_PADDING = 1.5;
    const KEYBOARD_HEIGHT_RATIO = 0.24;
    const BLACK_KEY_HEIGHT_RATIO = 0.62;
    const BACKGROUND_GRID_SECONDS = 1;

    const state = {
        isActive: false,
        animationFrameId: null,
        resizeHandler: null,
        container: null,
        canvas: null,
        ctx: null,
        statusEl: null,
        songNameEl: null,
        modeEl: null,
        hintEl: null,
        currentTimeEl: null,
        notes: [],
        noteRange: { ...DEFAULT_NOTE_RANGE },
        colors: null,
        keyboardLayout: null,
        tempoPercent: 100,
        baseSongTime: 0,
        baseWallTimeMs: 0,
        waitingForInput: false,
        clockRunning: false,
        currentTime: 0,
        expectedNotes: new Set(),
        futureNotes: new Set(),
        practiceModeName: '',
        songName: '',
        loading: 0,
    };

    function rgb(color, alpha) {
        if (!Array.isArray(color) || color.length < 3) {
            return alpha === undefined ? 'rgb(255, 255, 255)' : `rgba(255, 255, 255, ${alpha})`;
        }
        if (alpha === undefined) {
            return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        }
        return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
    }

    function isBlackKey(note) {
        return [1, 3, 6, 8, 10].includes(note % 12);
    }

    function getNoteName(note) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return noteNames[((note % 12) + 12) % 12];
    }

    function formatSongName(songName) {
        if (!songName) {
            return 'No song loaded';
        }
        return songName.replace(/\.(mid|midi|musicxml|mxl|xml|abc)$/i, '');
    }

    function getCurrentSongTime(nowMs) {
        if (!state.clockRunning) {
            return state.currentTime;
        }

        const elapsedSeconds = Math.max(0, (nowMs - state.baseWallTimeMs) / 1000);
        const tempoMultiplier = Math.max(0.1, Number(state.tempoPercent || 100) / 100);
        return state.baseSongTime + elapsedSeconds * tempoMultiplier;
    }

    function setClock(songTime, running) {
        const safeSongTime = Number.isFinite(songTime) ? songTime : 0;
        state.currentTime = safeSongTime;
        state.baseSongTime = safeSongTime;
        state.baseWallTimeMs = performance.now();
        state.clockRunning = Boolean(running);
    }

    function buildKeyboardLayout(width, height) {
        const noteRange = state.noteRange || DEFAULT_NOTE_RANGE;
        const whiteNotes = [];
        const keyMap = {};
        for (let note = noteRange.min; note <= noteRange.max; note += 1) {
            if (!isBlackKey(note)) {
                whiteNotes.push(note);
            }
        }

        const whiteWidth = width / Math.max(whiteNotes.length, 1);
        let whiteIndex = 0;

        for (let note = noteRange.min; note <= noteRange.max; note += 1) {
            if (!isBlackKey(note)) {
                const x = whiteIndex * whiteWidth;
                keyMap[note] = {
                    x,
                    y: 0,
                    width: whiteWidth,
                    height,
                    black: false,
                };
                whiteIndex += 1;
            }
        }

        const blackWidth = whiteWidth * 0.62;
        const blackHeight = height * BLACK_KEY_HEIGHT_RATIO;
        for (let note = noteRange.min; note <= noteRange.max; note += 1) {
            if (!isBlackKey(note)) {
                continue;
            }

            const leftWhite = keyMap[note - 1];
            const rightWhite = keyMap[note + 1];
            if (!leftWhite || !rightWhite) {
                continue;
            }

            keyMap[note] = {
                x: rightWhite.x - blackWidth / 2,
                y: 0,
                width: blackWidth,
                height: blackHeight,
                black: true,
            };
        }

        state.keyboardLayout = keyMap;
    }

    function resizeCanvas() {
        if (!state.canvas || !state.container) {
            return;
        }

        const rect = state.container.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        state.canvas.width = Math.floor(rect.width * dpr);
        state.canvas.height = Math.floor(rect.height * dpr);
        state.canvas.style.width = `${rect.width}px`;
        state.canvas.style.height = `${rect.height}px`;
        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        buildKeyboardLayout(rect.width, rect.height * KEYBOARD_HEIGHT_RATIO);
    }

    function getNoteLane(note) {
        if (!state.keyboardLayout) {
            return null;
        }
        return state.keyboardLayout[note] || null;
    }

    function getHandColor(channel, alpha) {
        if (!state.colors) {
            return alpha === undefined ? 'rgb(99, 102, 241)' : `rgba(99, 102, 241, ${alpha})`;
        }
        if (channel === 1) {
            return rgb(state.colors.right, alpha);
        }
        if (channel === 2) {
            return rgb(state.colors.left, alpha);
        }
        return alpha === undefined ? 'rgb(120, 120, 120)' : `rgba(120, 120, 120, ${alpha})`;
    }

    function drawBackground(ctx, width, height, hitLineY) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(10, 16, 28, 0.95)');
        gradient.addColorStop(0.58, 'rgba(16, 24, 40, 0.98)');
        gradient.addColorStop(1, 'rgba(226, 232, 240, 0.98)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        for (let second = 0; second <= LOOKAHEAD_SECONDS; second += BACKGROUND_GRID_SECONDS) {
            const y = hitLineY - second * (hitLineY / LOOKAHEAD_SECONDS);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawHitLine(ctx, width, hitLineY) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, hitLineY);
        ctx.lineTo(width, hitLineY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
        ctx.fillRect(0, hitLineY - 3, width, 6);
        ctx.restore();
    }

    function drawNotes(ctx, width, height, currentTime) {
        const keyboardHeight = height * KEYBOARD_HEIGHT_RATIO;
        const hitLineY = height - keyboardHeight - 12;
        const pixelsPerSecond = hitLineY / LOOKAHEAD_SECONDS;
        const topBoundaryTime = currentTime + LOOKAHEAD_SECONDS;
        const visibleNotes = state.notes.filter((note) => note.end >= currentTime - 0.25 && note.start <= topBoundaryTime);

        visibleNotes.forEach((note) => {
            const lane = getNoteLane(note.note);
            if (!lane) {
                return;
            }

            const yTop = hitLineY - (note.end - currentTime) * pixelsPerSecond;
            const yBottom = hitLineY - (note.start - currentTime) * pixelsPerSecond;
            const barTop = Math.max(0, yTop);
            const barBottom = Math.min(hitLineY, yBottom);
            const barHeight = Math.max(3, barBottom - barTop);
            const x = lane.x + NOTE_PADDING;
            const barWidth = Math.max(3, lane.width - NOTE_PADDING * 2);
            const expected = state.expectedNotes.has(note.note);
            const future = state.futureNotes.has(note.note);
            const fill = expected
                ? getHandColor(note.channel, 0.95)
                : future
                    ? getHandColor(note.channel, 0.46)
                    : getHandColor(note.channel, 0.74);

            ctx.save();
            ctx.fillStyle = fill;
            ctx.fillRect(x, barTop, barWidth, barHeight);

            if (expected) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, barTop, barWidth, barHeight);
            }

            if (barHeight >= 22 && barWidth >= 20) {
                const noteName = getNoteName(note.note);
                const fontSize = Math.max(10, Math.min(15, Math.min(barHeight * 0.38, barWidth * 0.42)));
                ctx.font = `600 ${fontSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = expected || future ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 23, 42, 0.88)';
                ctx.fillText(noteName, x + barWidth / 2, barTop + barHeight / 2);
            }
            ctx.restore();
        });

        drawHitLine(ctx, width, hitLineY);
    }

    function drawKeyboard(ctx, width, height) {
        if (!state.keyboardLayout) {
            return;
        }

        const keyboardHeight = height * KEYBOARD_HEIGHT_RATIO;
        const keyboardY = height - keyboardHeight;

        Object.entries(state.keyboardLayout).forEach(([note, key]) => {
            if (key.black) {
                return;
            }
            const midiNote = Number(note);
            const expected = state.expectedNotes.has(midiNote);
            const future = state.futureNotes.has(midiNote);
            ctx.fillStyle = expected
                ? 'rgba(255, 255, 255, 0.98)'
                : future
                    ? 'rgba(226, 232, 240, 0.92)'
                    : 'rgba(248, 250, 252, 0.98)';
            ctx.fillRect(key.x, keyboardY, key.width, key.height);

            if (expected) {
                ctx.fillStyle = getHandColor(0, 0.26);
                ctx.fillRect(key.x, keyboardY, key.width, key.height);
                ctx.strokeStyle = getHandColor(0, 0.9);
                ctx.lineWidth = 2;
            } else if (future) {
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
                ctx.lineWidth = 1.5;
            } else {
                ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
                ctx.lineWidth = 1;
            }
            ctx.strokeRect(key.x, keyboardY, key.width, key.height);
        });

        Object.entries(state.keyboardLayout).forEach(([note, key]) => {
            if (!key.black) {
                return;
            }
            const midiNote = Number(note);
            const expected = state.expectedNotes.has(midiNote);
            const future = state.futureNotes.has(midiNote);
            ctx.fillStyle = expected
                ? getHandColor(0, 0.96)
                : future
                    ? 'rgba(30, 41, 59, 0.94)'
                    : 'rgba(15, 23, 42, 0.98)';
            ctx.fillRect(key.x, keyboardY, key.width, key.height);
            ctx.strokeStyle = expected ? 'rgba(255, 255, 255, 0.95)' : 'rgba(148, 163, 184, 0.4)';
            ctx.lineWidth = expected ? 2 : 1;
            ctx.strokeRect(key.x, keyboardY, key.width, key.height);
        });
    }

    function updateHeader() {
        if (state.songNameEl) {
            state.songNameEl.textContent = formatSongName(state.songName);
        }
        if (state.modeEl) {
            state.modeEl.textContent = state.practiceModeName || 'Waiting';
        }
        if (state.currentTimeEl) {
            state.currentTimeEl.textContent = `${getCurrentSongTime(performance.now()).toFixed(2)}s`;
        }
        if (state.statusEl) {
            if (state.loading > 0 && state.loading < 4) {
                state.statusEl.textContent = 'Loading song data...';
            } else if (!state.songName) {
                state.statusEl.textContent = 'Load a song in Songs, then start learning to see the falling notes.';
            } else if (state.waitingForInput) {
                state.statusEl.textContent = 'Waiting for the correct keys';
            } else if (state.clockRunning) {
                state.statusEl.textContent = 'Playing';
            } else {
                state.statusEl.textContent = 'Ready';
            }
        }
        if (state.hintEl) {
            if (!state.songName) {
                state.hintEl.textContent = 'The Songs tab still controls song selection, tempo, mode, and loop points.';
            } else if (state.expectedNotes.size > 0) {
                state.hintEl.textContent = `Expected notes: ${Array.from(state.expectedNotes).join(', ')}`;
            } else if (state.futureNotes.size > 0) {
                state.hintEl.textContent = `Next notes: ${Array.from(state.futureNotes).join(', ')}`;
            } else {
                state.hintEl.textContent = 'Watch the hit line and keyboard; the LED hints still come from learning mode.';
            }
        }
    }

    function draw(timestamp) {
        if (!state.isActive || !state.ctx || !state.canvas) {
            return;
        }

        const rect = state.canvas.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const currentTime = getCurrentSongTime(timestamp);
        state.currentTime = currentTime;

        drawBackground(state.ctx, width, height, height - height * KEYBOARD_HEIGHT_RATIO - 12);
        drawNotes(state.ctx, width, height, currentTime);
        drawKeyboard(state.ctx, width, height);
        updateHeader();

        state.animationFrameId = window.requestAnimationFrame(draw);
    }

    function applyVisualizationPayload(payload) {
        state.songName = payload.song_name || payload.current_song_name || '';
        state.loading = Number(payload.loading || 0);
        state.notes = Array.isArray(payload.notes) ? payload.notes : [];
        state.noteRange = payload.note_range || { ...DEFAULT_NOTE_RANGE };
        state.colors = payload.colors || null;
        state.tempoPercent = Number(payload.tempo_percent || 100);
        state.practiceModeName = payload.practice_mode_name || '';
        state.expectedNotes = new Set();
        state.futureNotes = new Set();
        state.waitingForInput = false;
        if (Number.isFinite(payload.current_time)) {
            setClock(Number(payload.current_time), Boolean(payload.is_started_midi));
        } else if (!state.songName) {
            setClock(0, false);
        } else {
            setClock(0, false);
        }
        resizeCanvas();
        updateHeader();
    }

    function fetchVisualizationState() {
        return fetch('/api/get_learning_visualization')
            .then((response) => response.json())
            .then((payload) => {
                if (!payload.success) {
                    throw new Error(payload.error || 'Failed to load visualization state');
                }
                applyVisualizationPayload(payload);
            })
            .catch((error) => {
                console.error('Failed to fetch learning visualization:', error);
                if (state.statusEl) {
                    state.statusEl.textContent = 'Unable to load falling-note data.';
                }
            });
    }

    function attachGlobalHandlers() {
        window.handleFallingNotesInit = function (payload) {
            if (!state.isActive) {
                return;
            }
            applyVisualizationPayload(payload);
        };

        window.handleFallingNotesState = function (payload) {
            if (!state.isActive) {
                return;
            }

            state.songName = payload.song_name || state.songName;
            state.practiceModeName = payload.practice_mode_name || state.practiceModeName;
            state.tempoPercent = Number(payload.tempo_percent || state.tempoPercent || 100);
            state.waitingForInput = Boolean(payload.waiting_for_input);
            state.expectedNotes = new Set(payload.expected_notes || []);
            state.futureNotes = new Set(payload.future_notes || []);
            setClock(Number(payload.current_time || state.currentTime || 0), Boolean(payload.clock_running));
            updateHeader();
        };

        window.handleLearningReset = function (payload) {
            if (!state.isActive) {
                return;
            }

            state.expectedNotes = new Set();
            state.futureNotes = new Set();
            state.waitingForInput = false;
            setClock(Number((payload && payload.current_time) || 0), false);

            if (payload && payload.clear_song) {
                state.songName = '';
                state.notes = [];
            }
            updateHeader();
        };

        window.handleLearningVisualizationTime = function (timeValue) {
            if (!state.isActive) {
                return;
            }

            const numericTime = parseFloat(timeValue);
            if (Number.isNaN(numericTime)) {
                return;
            }
            setClock(numericTime, !state.waitingForInput);
        };
    }

    function initializePracticePage() {
        state.container = document.getElementById('practice-stage');
        state.canvas = document.getElementById('practice-canvas');
        state.statusEl = document.getElementById('practice-status');
        state.songNameEl = document.getElementById('practice-song-name');
        state.modeEl = document.getElementById('practice-mode');
        state.hintEl = document.getElementById('practice-hint');
        state.currentTimeEl = document.getElementById('practice-current-time');

        if (!state.container || !state.canvas) {
            return;
        }

        state.ctx = state.canvas.getContext('2d');
        state.isActive = true;
        attachGlobalHandlers();
        state.resizeHandler = resizeCanvas;
        window.addEventListener('resize', state.resizeHandler);
        resizeCanvas();
        fetchVisualizationState();

        if (state.animationFrameId !== null) {
            window.cancelAnimationFrame(state.animationFrameId);
        }
        state.animationFrameId = window.requestAnimationFrame(draw);
    }

    function cleanupPracticePage() {
        state.isActive = false;
        if (state.animationFrameId !== null) {
            window.cancelAnimationFrame(state.animationFrameId);
            state.animationFrameId = null;
        }
        if (state.resizeHandler) {
            window.removeEventListener('resize', state.resizeHandler);
            state.resizeHandler = null;
        }
        window.handleFallingNotesInit = null;
        window.handleFallingNotesState = null;
        window.handleLearningReset = null;
        window.handleLearningVisualizationTime = function () {};
    }

    window.initializePracticePage = initializePracticePage;
    window.cleanupPracticePage = cleanupPracticePage;
    attachGlobalHandlers();
})();
