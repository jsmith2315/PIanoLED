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
        stageHiddenMessageEl: null,
        songSelectEl: null,
        loadSongButton: null,
        startButton: null,
        stopButton: null,
        settingsToggleEl: null,
        settingsPanelEl: null,
        practiceModeSelectEl: null,
        tempoLabelEl: null,
        tempoSliderEl: null,
        handsSelectEl: null,
        muteHandsSelectEl: null,
        wrongNotesSelectEl: null,
        futureNotesSelectEl: null,
        mistakesInputEl: null,
        loopCheckboxEl: null,
        startPointEl: null,
        endPointEl: null,
        startPointLabelEl: null,
        endPointLabelEl: null,
        leftColorPreviewEl: null,
        rightColorPreviewEl: null,
        leftActiveEl: null,
        rightActiveEl: null,
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
        settingsOpen: false,
        handColorList: [],
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

    function updateColorPreview(element, rgbValues, active) {
        if (!element) {
            return;
        }
        const fallback = [30, 41, 59];
        const values = Array.isArray(rgbValues) ? rgbValues : fallback;
        element.style.background = `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
        element.style.opacity = active ? '1' : '0.35';
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
                state.statusEl.textContent = 'Choose a song here, then start learning to see the falling notes.';
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
                state.hintEl.textContent = 'Use the song dropdown and settings panel here to set up practice before you start.';
            } else if (state.expectedNotes.size > 0) {
                state.hintEl.textContent = `Expected notes: ${Array.from(state.expectedNotes).join(', ')}`;
            } else if (state.futureNotes.size > 0) {
                state.hintEl.textContent = `Next notes: ${Array.from(state.futureNotes).join(', ')}`;
            } else {
                state.hintEl.textContent = 'Watch the hit line and keyboard; the LED hints still come from learning mode.';
            }
        }
    }

    function setSettingsOpen(isOpen) {
        state.settingsOpen = Boolean(isOpen);
        if (state.settingsPanelEl) {
            state.settingsPanelEl.classList.toggle('hidden', !state.settingsOpen);
        }
        if (state.container) {
            state.container.classList.toggle('hidden', state.settingsOpen);
        }
        if (state.stageHiddenMessageEl) {
            state.stageHiddenMessageEl.classList.toggle('hidden', !state.settingsOpen);
            state.stageHiddenMessageEl.classList.toggle('flex', state.settingsOpen);
        }
        if (state.settingsToggleEl) {
            state.settingsToggleEl.textContent = state.settingsOpen ? 'Hide Settings' : 'Show Settings';
        }
        if (!state.settingsOpen) {
            resizeCanvas();
        }
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, number));
    }

    function populateSongOptions(songs, currentSongName) {
        if (!state.songSelectEl) {
            return;
        }

        const currentValue = currentSongName || state.songName || '';
        state.songSelectEl.innerHTML = '<option value="">Select a song</option>';
        songs.forEach((song) => {
            const option = document.createElement('option');
            option.value = song;
            option.textContent = formatSongName(song);
            state.songSelectEl.appendChild(option);
        });
        state.songSelectEl.value = currentValue;
    }

    function populateSettings(response) {
        state.handColorList = Array.isArray(response.hand_colorList) ? response.hand_colorList : state.handColorList;
        const practiceValue = response.practice !== undefined ? response.practice : 0;
        const tempoValue = response.set_tempo !== undefined ? response.set_tempo : 100;
        const handsValue = response.hands !== undefined ? response.hands : 0;
        const muteHandsValue = response.mute_hand !== undefined ? response.mute_hand : 0;
        const wrongNotesValue = response.show_wrong_notes !== undefined ? response.show_wrong_notes : 0;
        const futureNotesValue = response.show_future_notes !== undefined ? response.show_future_notes : 0;
        const mistakesValue = response.number_of_mistakes !== undefined ? response.number_of_mistakes : 0;
        const startPointValue = response.start_point !== undefined ? response.start_point : 0;
        const endPointValue = response.end_point !== undefined ? response.end_point : 100;

        if (state.practiceModeSelectEl) {
            state.practiceModeSelectEl.value = String(practiceValue);
        }
        if (state.tempoSliderEl) {
            state.tempoSliderEl.value = String(tempoValue);
        }
        if (state.tempoLabelEl) {
            state.tempoLabelEl.textContent = String(tempoValue);
        }
        if (state.handsSelectEl) {
            state.handsSelectEl.value = String(handsValue);
        }
        if (state.muteHandsSelectEl) {
            state.muteHandsSelectEl.value = String(muteHandsValue);
        }
        if (state.wrongNotesSelectEl) {
            state.wrongNotesSelectEl.value = String(wrongNotesValue);
        }
        if (state.futureNotesSelectEl) {
            state.futureNotesSelectEl.value = String(futureNotesValue);
        }
        if (state.mistakesInputEl) {
            state.mistakesInputEl.value = String(mistakesValue);
        }
        if (state.loopCheckboxEl) {
            state.loopCheckboxEl.checked = Number(response.is_loop_active) === 1;
        }
        if (state.startPointEl) {
            state.startPointEl.value = String(startPointValue);
        }
        if (state.endPointEl) {
            state.endPointEl.value = String(endPointValue);
        }
        if (state.startPointLabelEl) {
            state.startPointLabelEl.textContent = String(startPointValue);
        }
        if (state.endPointLabelEl) {
            state.endPointLabelEl.textContent = String(endPointValue);
        }
        if (state.leftActiveEl) {
            state.leftActiveEl.checked = Number(response.is_led_activeL) === 1;
        }
        if (state.rightActiveEl) {
            state.rightActiveEl.checked = Number(response.is_led_activeR) === 1;
        }

        const leftColor = (state.handColorList && state.handColorList[response.hand_colorL]) || [30, 64, 175];
        const rightColor = (state.handColorList && state.handColorList[response.hand_colorR]) || [34, 197, 94];
        updateColorPreview(state.leftColorPreviewEl, leftColor, Number(response.is_led_activeL) === 1);
        updateColorPreview(state.rightColorPreviewEl, rightColor, Number(response.is_led_activeR) === 1);
    }

    function fetchSongOptions() {
        return fetch('/api/get_song_options')
            .then((response) => response.json())
            .then((payload) => {
                if (!payload.success) {
                    throw new Error(payload.error || 'Failed to load songs');
                }
                populateSongOptions(payload.songs || [], state.songName);
            })
            .catch((error) => {
                console.error('Failed to fetch song options:', error);
            });
    }

    function fetchLearningSettings() {
        return fetch('/api/get_learning_status')
            .then((response) => response.json())
            .then((payload) => {
                populateSettings(payload);
                if (payload.current_song_name) {
                    state.songName = payload.current_song_name;
                    if (state.songSelectEl) {
                        state.songSelectEl.value = payload.current_song_name;
                    }
                }
            })
            .catch((error) => {
                console.error('Failed to fetch learning settings:', error);
            });
    }

    function practiceApplySetting(settingName, value, secondValue = false, disableSequence = false) {
        return new Promise((resolve) => {
            change_setting(settingName, value, secondValue, disableSequence);
            window.setTimeout(() => {
                Promise.all([fetchLearningSettings(), fetchVisualizationState()]).finally(resolve);
            }, 250);
        });
    }

    function loadSelectedSong() {
        const selectedSong = state.songSelectEl ? state.songSelectEl.value : '';
        if (!selectedSong) {
            return;
        }

        practiceApplySetting('learning_load_song', selectedSong).then(() => {
            if (state.statusEl) {
                state.statusEl.textContent = 'Loading song data...';
            }
        });
    }

    function bindPracticeControls() {
        if (state.settingsToggleEl) {
            state.settingsToggleEl.addEventListener('click', () => setSettingsOpen(!state.settingsOpen));
        }
        if (state.loadSongButton) {
            state.loadSongButton.addEventListener('click', loadSelectedSong);
        }
        if (state.songSelectEl) {
            state.songSelectEl.addEventListener('change', loadSelectedSong);
        }
        if (state.startButton) {
            state.startButton.addEventListener('click', () => practiceApplySetting('start_learning_song', ''));
        }
        if (state.stopButton) {
            state.stopButton.addEventListener('click', () => practiceApplySetting('stop_learning_song', ''));
        }
        if (state.practiceModeSelectEl) {
            state.practiceModeSelectEl.addEventListener('change', (event) => practiceApplySetting('change_practice', event.target.value));
        }
        if (state.tempoSliderEl) {
            state.tempoSliderEl.addEventListener('input', (event) => {
                if (state.tempoLabelEl) {
                    state.tempoLabelEl.textContent = event.target.value;
                }
            });
            state.tempoSliderEl.addEventListener('change', (event) => practiceApplySetting('change_tempo', event.target.value));
        }
        const tempoStep = (delta) => {
            if (!state.tempoSliderEl) {
                return;
            }
            const nextValue = clampNumber(Number(state.tempoSliderEl.value) + delta, 10, 200, 100);
            state.tempoSliderEl.value = String(nextValue);
            if (state.tempoLabelEl) {
                state.tempoLabelEl.textContent = String(nextValue);
            }
            practiceApplySetting('change_tempo', String(nextValue));
        };
        const tempoDown = document.getElementById('practice-tempo-down');
        const tempoUp = document.getElementById('practice-tempo-up');
        if (tempoDown) {
            tempoDown.addEventListener('click', () => tempoStep(-1));
        }
        if (tempoUp) {
            tempoUp.addEventListener('click', () => tempoStep(1));
        }
        if (state.handsSelectEl) {
            state.handsSelectEl.addEventListener('change', (event) => practiceApplySetting('change_hands', event.target.value));
        }
        if (state.muteHandsSelectEl) {
            state.muteHandsSelectEl.addEventListener('change', (event) => practiceApplySetting('change_mute_hand', event.target.value));
        }
        if (state.wrongNotesSelectEl) {
            state.wrongNotesSelectEl.addEventListener('change', (event) => practiceApplySetting('change_wrong_notes', event.target.value));
        }
        if (state.futureNotesSelectEl) {
            state.futureNotesSelectEl.addEventListener('change', (event) => practiceApplySetting('change_future_notes', event.target.value));
        }
        if (state.mistakesInputEl) {
            state.mistakesInputEl.addEventListener('change', (event) => {
                const value = clampNumber(event.target.value, 0, 255, 0);
                event.target.value = String(value);
                practiceApplySetting('number_of_mistakes', String(value));
            });
        }
        if (state.loopCheckboxEl) {
            state.loopCheckboxEl.addEventListener('change', (event) => practiceApplySetting('change_learning_loop', event.target.checked ? 'true' : 'false'));
        }
        if (state.startPointEl) {
            state.startPointEl.addEventListener('input', (event) => {
                if (state.startPointLabelEl) {
                    state.startPointLabelEl.textContent = event.target.value;
                }
            });
            state.startPointEl.addEventListener('change', (event) => practiceApplySetting('learning_start_point', event.target.value));
        }
        if (state.endPointEl) {
            state.endPointEl.addEventListener('input', (event) => {
                if (state.endPointLabelEl) {
                    state.endPointLabelEl.textContent = event.target.value;
                }
            });
            state.endPointEl.addEventListener('change', (event) => practiceApplySetting('learning_end_point', event.target.value));
        }
        if (state.leftActiveEl) {
            state.leftActiveEl.addEventListener('change', (event) => practiceApplySetting('change_left_led_active', event.target.checked ? 'true' : 'false'));
        }
        if (state.rightActiveEl) {
            state.rightActiveEl.addEventListener('change', (event) => practiceApplySetting('change_right_led_active', event.target.checked ? 'true' : 'false'));
        }
        const bindColorButton = (id, settingName, step) => {
            const button = document.getElementById(id);
            if (button) {
                button.addEventListener('click', () => practiceApplySetting(settingName, String(step)));
            }
        };
        bindColorButton('practice-left-color-prev', 'change_handL_color', -1);
        bindColorButton('practice-left-color-next', 'change_handL_color', 1);
        bindColorButton('practice-right-color-prev', 'change_handR_color', -1);
        bindColorButton('practice-right-color-next', 'change_handR_color', 1);
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
            if (state.songSelectEl && state.songName) {
                state.songSelectEl.value = state.songName;
            }
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
        state.stageHiddenMessageEl = document.getElementById('practice-stage-hidden-message');
        state.songSelectEl = document.getElementById('practice-song-select');
        state.loadSongButton = document.getElementById('practice-load-song');
        state.startButton = document.getElementById('practice-start-learning');
        state.stopButton = document.getElementById('practice-stop-learning');
        state.settingsToggleEl = document.getElementById('practice-settings-toggle');
        state.settingsPanelEl = document.getElementById('practice-settings-panel');
        state.practiceModeSelectEl = document.getElementById('practice-setting-mode');
        state.tempoLabelEl = document.getElementById('practice-tempo-label');
        state.tempoSliderEl = document.getElementById('practice-tempo-slider');
        state.handsSelectEl = document.getElementById('practice-hands');
        state.muteHandsSelectEl = document.getElementById('practice-mute-hands');
        state.wrongNotesSelectEl = document.getElementById('practice-wrong-notes');
        state.futureNotesSelectEl = document.getElementById('practice-future-notes');
        state.mistakesInputEl = document.getElementById('practice-mistakes');
        state.loopCheckboxEl = document.getElementById('practice-loop');
        state.startPointEl = document.getElementById('practice-start-point');
        state.endPointEl = document.getElementById('practice-end-point');
        state.startPointLabelEl = document.getElementById('practice-start-point-label');
        state.endPointLabelEl = document.getElementById('practice-end-point-label');
        state.leftColorPreviewEl = document.getElementById('practice-left-color-preview');
        state.rightColorPreviewEl = document.getElementById('practice-right-color-preview');
        state.leftActiveEl = document.getElementById('practice-left-active');
        state.rightActiveEl = document.getElementById('practice-right-active');

        if (!state.container || !state.canvas) {
            return;
        }

        state.ctx = state.canvas.getContext('2d');
        state.isActive = true;
        attachGlobalHandlers();
        bindPracticeControls();
        setSettingsOpen(false);
        state.resizeHandler = resizeCanvas;
        window.addEventListener('resize', state.resizeHandler);
        resizeCanvas();
        Promise.all([fetchVisualizationState(), fetchSongOptions(), fetchLearningSettings()]);

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
