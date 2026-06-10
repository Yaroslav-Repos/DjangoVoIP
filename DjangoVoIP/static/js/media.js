import { state } from './state.js';
import { updateAudioLevelUI } from './ui.js';

export async function connectLiveKit() {
    try {
        console.log('[LiveKit] Fetching token...');
        const res = await fetch(`/api/rooms/${window.roomId}/livekit-token/`);

        if (!res.ok) throw new Error(`Failed to fetch LiveKit token: ${res.statusText}`);

        const data = await res.json();
        const { token, livekit_url } = data;

        state.livekitRoom = new LivekitClient.Room({
            adaptiveStream: true,
            dynacast: true
        });

        state.livekitRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log(`[DEBUG LiveKit] TrackSubscribed: kind=${track.kind}, source=${publication.source}, participant=${participant.identity}`);

            if (track.kind === LivekitClient.Track.Kind.Audio) {
                if (publication.source === LivekitClient.Track.Source.ScreenShareAudio) {
                    console.log(`[DEBUG ScreenAudio] Received ScreenShareAudio track from ${participant.identity}`);
                    state.remoteScreenAudioTracks[participant.identity] = track;

                    // Прив'язуємо аудіо до відео-плеєра у відкритому вікні
                    const winContainer = state.remoteScreenWindows[participant.identity];
                    if (winContainer) {
                        const videoElem = winContainer.querySelector('.stream-window-video');
                        if (videoElem) {
                            track.attach(videoElem);
                            console.log(`[DEBUG ScreenAudio] Successfully attached ScreenShareAudio to in-app window video element.`);
                        }
                    } else {
                        console.log(`[DEBUG ScreenAudio] Window for ${participant.identity} is not open yet. Track saved in state for later.`);
                    }
                } else {
                    // Звичайний мікрофон користувача
                    attachRemoteTrack(track, participant.identity);
                }
            }
            else if (track.kind === LivekitClient.Track.Kind.Video && publication.source === LivekitClient.Track.Source.ScreenShare) {
                console.log(`[DEBUG ScreenShare] Received ScreenShare Video track from ${participant.identity}`);
                addRemoteScreenShare(track, participant.identity);
            }
        });

        state.livekitRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            console.log(`[DEBUG LiveKit] TrackUnsubscribed: kind=${track.kind}, source=${publication.source}, participant=${participant.identity}`);

            if (track.kind === LivekitClient.Track.Kind.Audio) {
                if (publication.source === LivekitClient.Track.Source.ScreenShareAudio) {
                    const winContainer = state.remoteScreenWindows[participant.identity];
                    if (winContainer) {
                        const videoElem = winContainer.querySelector('.stream-window-video');
                        if (videoElem) {
                            track.detach(videoElem);
                        }
                    }
                    delete state.remoteScreenAudioTracks[participant.identity];
                    console.log(`[DEBUG ScreenAudio] Removed ScreenShareAudio track from state for ${participant.identity}`);
                } else {
                    detachRemoteTrack(participant.identity);
                }
            }
            else if (track.kind === LivekitClient.Track.Kind.Video && publication.source === LivekitClient.Track.Source.ScreenShare) {
                removeRemoteScreenShare(participant.identity);
            }
        });

        console.log('[LiveKit] Connecting to room...');
        await state.livekitRoom.connect(livekit_url, token);
        console.log('[LiveKit] Connected successfully!');

        if (state.localStream) {
            const audioTrack = state.localStream.getAudioTracks()[0];
            if (audioTrack) {
                await state.livekitRoom.localParticipant.publishTrack(audioTrack);
                console.log('[LiveKit] Local audio published');
            }
        }
    } catch (error) {
        console.error('[LiveKit] Connection error:', error);
        throw error;
    }
}

export function attachRemoteTrack(track, targetUserId) {
    let audioElem = document.getElementById(`audio-${targetUserId}`);
    if (!audioElem) {
        audioElem = document.createElement('audio');
        audioElem.id = `audio-${targetUserId}`;
        audioElem.autoplay = true;
        audioElem.volume = state.audioVolumeMap[targetUserId] || 1.0;

        let remoteAudiosContainer = document.getElementById('remote-audios');
        if (!remoteAudiosContainer) {
            remoteAudiosContainer = document.createElement('div');
            remoteAudiosContainer.id = 'remote-audios';
            remoteAudiosContainer.style.display = 'none';
            document.body.appendChild(remoteAudiosContainer);
        }
        remoteAudiosContainer.appendChild(audioElem);
    }
    track.attach(audioElem);
}

export function detachRemoteTrack(targetUserId) {
    const audioElem = document.getElementById(`audio-${targetUserId}`);
    if (audioElem) audioElem.remove();
}

export async function initAudio() {
    try {
        console.log('[Audio] Requesting microphone access...');
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
            video: false
        });

        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        state.mediaSource = state.audioContext.createMediaStreamSource(state.localStream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 256;
        state.mediaSource.connect(state.analyser);

        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume().catch(e => console.warn('[Audio] Autoplay blocked resume'));
        }

        startAudioLevelMonitoring();
        startAudioKeepAlive();
        startAudioContextResumeChecker();

        state.isAudioReady = true;
    } catch (err) {
        console.error('[Audio] Microphone error:', err);
        alert("Будь ласка, дозвольте доступ до мікрофона!");
        throw err;
    }
}

function startAudioLevelMonitoring() {
    function monitorAudioLevel() {
        if (state.audioContext && state.audioContext.state === 'running' && state.analyser) {
            try {
                const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
                state.analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                updateAudioLevelUI(average);
            } catch (err) {
                console.warn('[Audio] Error in level monitoring:', err);
            }
        }
        state.animationFrameId = requestAnimationFrame(monitorAudioLevel);
    }
    monitorAudioLevel();
}

function startAudioKeepAlive() {
    state.monitoringInterval = setInterval(() => { }, 5000);
}

function startAudioContextResumeChecker() {
    state.audioContextResumeInterval = setInterval(() => {
        if (state.audioContext && state.audioContext.state === 'suspended') {
            state.audioContext.resume().catch(err => console.error('[Audio] Failed to resume:', err));
        }
    }, 10000);
}

export function cleanupAudioMonitoring() {
    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
    if (state.monitoringInterval) clearInterval(state.monitoringInterval);
    if (state.audioContextResumeInterval) clearInterval(state.audioContextResumeInterval);

    if (state.isSharingScreen) {
        stopScreenShare();
    }

    if (state.remoteScreenWindows) {
        for (const userId in state.remoteScreenWindows) {
            if (state.remoteScreenWindows[userId]) {
                state.remoteScreenWindows[userId].remove();
            }
        }
        state.remoteScreenWindows = {};
    }

    if (state.livekitRoom) {
        state.livekitRoom.disconnect();
        state.livekitRoom = null;
    }

    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
    }
    if (state.analyser) state.analyser.disconnect();
    if (state.mediaSource) state.mediaSource.disconnect();
    if (state.audioContext && state.audioContext.state !== 'closed') {
        state.audioContext.close();
        state.audioContext = null;
    }
}

export async function startScreenShare() {
    if (state.isSharingScreen) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert("Браузер блокує доступ до екрану. Демонстрація працює ВИКЛЮЧНО через захищене з'єднання HTTPS або через localhost!");
        return;
    }

    const qualitySelect = document.getElementById('screenshare-quality');
    const quality = qualitySelect ? qualitySelect.value : '1080p';

    let constraints = {
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 }
    };
    if (quality === '720p') constraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    else if (quality === '480p') constraints = { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };

    try {
        console.log(`[DEBUG ScreenShare] Requesting getDisplayMedia...`);
        state.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: constraints,
            audio: { suppressLocalAudioPlayback: false }
        });

        const videoTracksCount = state.localScreenStream.getVideoTracks().length;
        const audioTracksCount = state.localScreenStream.getAudioTracks().length;
        console.log(`[DEBUG ScreenShare] getDisplayMedia success. Video tracks: ${videoTracksCount}, Audio tracks: ${audioTracksCount}`);

        const videoTrack = state.localScreenStream.getVideoTracks()[0];
        const audioTrack = state.localScreenStream.getAudioTracks()[0];

        videoTrack.onended = () => {
            console.log(`[DEBUG ScreenShare] Video track ended by user.`);
            stopScreenShare();
        };

        if (!state.livekitRoom) throw new Error("LiveKit кімната ще не готова.");

        console.log(`[DEBUG ScreenShare] Publishing video track to LiveKit...`);
        state.localScreenPublication = await state.livekitRoom.localParticipant.publishTrack(videoTrack, {
            name: 'screen',
            source: LivekitClient.Track.Source.ScreenShare
        });
        console.log(`[DEBUG ScreenShare] Video track published successfully.`);

        if (!audioTrack) {
            console.warn(`[DEBUG ScreenAudio] WARNING: No audio track found in localScreenStream! User did not share system audio or browser prevented it.`);
        } else {
            console.log(`[DEBUG ScreenAudio] Found audio track: label="${audioTrack.label}", muted=${audioTrack.muted}, enabled=${audioTrack.enabled}`);
            console.log(`[DEBUG ScreenAudio] Publishing audio track to LiveKit...`);

            state.localScreenAudioPublication = await state.livekitRoom.localParticipant.publishTrack(audioTrack, {
                name: 'screen_audio',
                source: LivekitClient.Track.Source.ScreenShareAudio
            });
            console.log(`[DEBUG ScreenAudio] Audio track published successfully to LiveKit!`);
        }

        state.isSharingScreen = true;

        const btn = document.getElementById('screenshare-btn');
        if (btn) {
            btn.innerText = "🛑 Зупинити трансляцію";
            btn.style.background = "#f04747";
        }

        const win = window.open("", "_blank", "width=800,height=600,scrollbars=no,resizable=yes");
        if (win) {
            win.document.title = "Ваша трансляція екрану";
            win.document.body.style.cssText = "margin: 0; background-color: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden;";

            const video = win.document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true; // Стрімер обов'язково muted
            video.controls = true;
            video.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; outline: none;";
            win.document.body.appendChild(video);

            video.srcObject = state.localScreenStream;
            state.localScreenWindow = win;

            win.onbeforeunload = () => { if (state.isSharingScreen) stopScreenShare(); };
        }

    } catch (error) {
        console.error('[ScreenShare] Помилка:', error);
        if (error.name !== 'NotAllowedError') alert('Помилка запуску трансляції: ' + error.message);
    }
}

export async function stopScreenShare() {
    if (!state.isSharingScreen) return;
    state.isSharingScreen = false;
    console.log(`[DEBUG ScreenShare] Stopping screen share...`);

    if (state.localScreenWindow && !state.localScreenWindow.closed) {
        state.localScreenWindow.onbeforeunload = null;
        state.localScreenWindow.close();
    }
    state.localScreenWindow = null;

    if (state.localScreenPublication) {
        try { await state.livekitRoom.localParticipant.unpublishTrack(state.localScreenPublication.track); } catch (e) { console.error(e); }
        state.localScreenPublication = null;
    }

    if (state.localScreenAudioPublication) {
        try {
            console.log(`[DEBUG ScreenAudio] Unpublishing local screen audio...`);
            await state.livekitRoom.localParticipant.unpublishTrack(state.localScreenAudioPublication.track);
        } catch (e) { console.error(e); }
        state.localScreenAudioPublication = null;
    }

    if (state.localScreenStream) {
        state.localScreenStream.getTracks().forEach(t => t.stop());
        state.localScreenStream = null;
    }

    const btn = document.getElementById('screenshare-btn');
    if (btn) {
        btn.innerText = "🖥️ Почати трансляцію";
        btn.style.background = "#5865f2";
    }
}

export function addRemoteScreenShare(track, userId) {
    state.remoteScreenTracks[userId] = track;

    const userItem = document.getElementById(`user-${userId}`);
    if (userItem && !userItem.querySelector('.screenshare-icon')) {
        const icon = document.createElement('button');
        icon.className = 'screenshare-icon';
        icon.innerHTML = '🖥️ Дивитись';
        icon.style.cssText = 'margin-left: auto; background: #43b581; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; font-weight: 500; transition: background 0.2s;';

        icon.onmouseover = () => { icon.style.background = (state.remoteScreenWindows[userId]) ? '#d63c3c' : '#3a9f6a'; };
        icon.onmouseout = () => { icon.style.background = (state.remoteScreenWindows[userId]) ? '#f04747' : '#43b581'; };

        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            openRemoteScreenWindow(userId);
        });

        userItem.appendChild(icon);
    }
}

export function removeRemoteScreenShare(userId) {
    closeRemoteScreenWindow(userId);

    delete state.remoteScreenTracks[userId];
    delete state.remoteScreenAudioTracks[userId];

    const userItem = document.getElementById(`user-${userId}`);
    if (userItem) {
        const icon = userItem.querySelector('.screenshare-icon');
        if (icon) icon.remove();
    }
}

export function updateRemoteScreenIconState(userId, isWatching) {
    const userItem = document.getElementById(`user-${userId}`);
    if (userItem) {
        const icon = userItem.querySelector('.screenshare-icon');
        if (icon) {
            icon.innerHTML = isWatching ? '🛑 Закрити' : '🖥️ Дивитись';
            icon.style.background = isWatching ? '#f04747' : '#43b581';
        }
    }
}

export function openRemoteScreenWindow(userId) {
    console.log(`[DEBUG ScreenShare] Toggling in-app window for userId: ${userId}`);

    if (state.remoteScreenWindows && state.remoteScreenWindows[userId]) {
        closeRemoteScreenWindow(userId);
        return;
    }

    const videoTrack = state.remoteScreenTracks[userId];
    const audioTrack = state.remoteScreenAudioTracks[userId];
    const username = state.connectedUsers[userId] || "Користувач";

    if (!videoTrack) {
        console.error(`[DEBUG ScreenShare] No video track found for ${userId}!`);
        return alert("Трансляція більше недоступна");
    }

    const { winContainer, videoElem } = createFloatingWindow(userId, username);
    document.body.appendChild(winContainer);

    console.log(`[DEBUG ScreenShare] Attaching video track to in-app window video element.`);
    videoTrack.attach(videoElem);

    // Прив'язуємо аудіопотік екрана до того самого елемента video
    if (audioTrack) {
        console.log(`[DEBUG ScreenAudio] Found existing audio track for ${userId}. Attaching to the SAME video element.`);
        audioTrack.attach(videoElem);
    } else {
        console.warn(`[DEBUG ScreenAudio] No audio track found in state for ${userId} yet.`);
    }

    if (!state.remoteScreenWindows) state.remoteScreenWindows = {};
    state.remoteScreenWindows[userId] = winContainer;

    updateRemoteScreenIconState(userId, true);
}

function closeRemoteScreenWindow(userId) {
    if (!state.remoteScreenWindows) return;

    const winContainer = state.remoteScreenWindows[userId];
    if (winContainer) {
        console.log(`[DEBUG ScreenShare] Closing in-app viewer window for user: ${userId}`);
        const videoElem = winContainer.querySelector('.stream-window-video');

        if (state.remoteScreenTracks[userId] && videoElem) {
            state.remoteScreenTracks[userId].detach(videoElem);
        }
        if (state.remoteScreenAudioTracks[userId] && videoElem) {
            state.remoteScreenAudioTracks[userId].detach(videoElem);
        }

        winContainer.remove();
        delete state.remoteScreenWindows[userId];
        updateRemoteScreenIconState(userId, false);
    }
}

function createFloatingWindow(userId, username) {
    const container = document.createElement('div');
    container.className = 'floating-stream-window';
    container.id = `stream-win-${userId}`;

    // Шапка вікна
    const header = document.createElement('div');
    header.className = 'stream-window-header';

    const title = document.createElement('span');
    title.innerText = `Трансляція: ${username}`;

    const controls = document.createElement('div');
    controls.className = 'stream-window-controls';

    const maxBtn = document.createElement('button');
    maxBtn.className = 'stream-window-btn';
    maxBtn.innerHTML = '🔲';
    maxBtn.title = 'Розгорнути на всю вкладку';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'stream-window-btn close';
    closeBtn.innerHTML = '❌';
    closeBtn.title = 'Закрити';

    controls.appendChild(maxBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

    // Тіло вікна
    const body = document.createElement('div');
    body.className = 'stream-window-body';

    const video = document.createElement('video');
    video.className = 'stream-window-video';
    video.autoplay = true;
    video.playsInline = true;
    video.controls = true;

    body.appendChild(video);
    container.appendChild(header);
    container.appendChild(body);

    // Повзунок для зміни розміру у правому нижньому кутку
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'stream-window-resize-handle';
    resizeHandle.style.cssText = 'position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; z-index: 100;';
    resizeHandle.style.backgroundImage = 'linear-gradient(135deg, transparent 30%, #ccc 30%, #ccc 50%, transparent 50%, transparent 70%, #ccc 70%, #ccc 90%, transparent 90%)';
    container.appendChild(resizeHandle);

    // Обробники подій кнопок керування
    closeBtn.onclick = () => closeRemoteScreenWindow(userId);

    let isMaximized = false;
    let preMaxState = { top: '', left: '', width: '', height: '' };

    maxBtn.onclick = () => {
        if (!isMaximized) {
            preMaxState = {
                top: container.style.top, left: container.style.left,
                width: container.style.width, height: container.style.height
            };
            container.classList.add('maximized');
            maxBtn.innerHTML = '🔳';
        } else {
            container.classList.remove('maximized');
            container.style.top = preMaxState.top;
            container.style.left = preMaxState.left;
            container.style.width = preMaxState.width;
            container.style.height = preMaxState.height;
            maxBtn.innerHTML = '🔲';
        }
        isMaximized = !isMaximized;
    };

    // Логіка перетягування (Drag-and-Drop) за шапку вікна
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.onmousedown = (e) => {
        if (e.target.tagName.toLowerCase() === 'button') return;
        if (container.classList.contains('maximized')) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        container.style.left = `${initialX + dx}px`;
        container.style.top = `${initialY + dy}px`;
        container.style.bottom = 'auto';
        container.style.right = 'auto';
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // Логіка зміни розміру мишкою (Resize) за куток
    let isResizing = false;
    let startWidth, startHeight, startMouseX, startMouseY;

    resizeHandle.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation(); // Запобігає спрацьовуванню drag-and-drop шапки
        if (container.classList.contains('maximized')) return;

        isResizing = true;
        startWidth = container.clientWidth;
        startHeight = container.clientHeight;
        startMouseX = e.clientX;
        startMouseY = e.clientY;

        document.addEventListener('mousemove', onMouseMoveResize);
        document.addEventListener('mouseup', onMouseUpResize);
    };

    function onMouseMoveResize(e) {
        if (!isResizing) return;
        const dw = e.clientX - startMouseX;
        const dh = e.clientY - startMouseY;

        const newWidth = startWidth + dw;
        const newHeight = startHeight + dh;

        // Мінімальні ліміти розширення вікна
        if (newWidth > 320) {
            container.style.width = `${newWidth}px`;
        }
        if (newHeight > 240) {
            container.style.height = `${newHeight}px`;
        }
    }

    function onMouseUpResize() {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMoveResize);
        document.removeEventListener('mouseup', onMouseUpResize);
    }

    return { winContainer: container, videoElem: video };
}

export function initScreenShareListeners() {
    const btn = document.getElementById('screenshare-btn');
    if (btn) {
        btn.addEventListener('click', function () {
            if (!state.livekitRoom || state.livekitRoom.state !== 'connected') {
                alert('Ви ще не підключилися до аудіокімнати LiveKit!');
                return;
            }

            if (state.isSharingScreen) {
                stopScreenShare();
            } else {
                const modal = document.getElementById('screenshare-modal');
                if (modal) modal.classList.add('active');
                else startScreenShare();
            }
        });
    }

    const confirmBtn = document.getElementById('confirm-screenshare-btn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
            const modal = document.getElementById('screenshare-modal');
            if (modal) modal.classList.remove('active');
            startScreenShare();
        });
    }

    window.addEventListener('beforeunload', () => {
        if (state.localScreenWindow && !state.localScreenWindow.closed) {
            state.localScreenWindow.close();
        }
    });
}