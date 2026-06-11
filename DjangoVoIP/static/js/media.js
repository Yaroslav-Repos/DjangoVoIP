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
            adaptiveStream: false,
            dynacast: true,
            autoSubscribe: false
        });

        // 
        function processPublishedTrack(publication, participant) {
            console.log(`[DEBUG LiveKit] Processing Track: kind=${publication.kind}, source=${publication.source}, participant=${participant.identity}`);

            if (publication.source === LivekitClient.Track.Source.ScreenShare ||
                publication.source === LivekitClient.Track.Source.ScreenShareAudio) {

                if (!state.remoteScreenPublications[participant.identity]) {
                    state.remoteScreenPublications[participant.identity] = {};
                }
                state.remoteScreenPublications[participant.identity][publication.source] = publication;

                if (publication.kind === LivekitClient.Track.Kind.Video) {
                    addRemoteScreenShare(publication, participant.identity);
                }
            } else {
                // На звичайні мікрофони підписуємось автоматично завжди
                publication.setSubscribed(true);
            }
        }

        // Подія виявлення публікації треку 
        state.livekitRoom.on(LivekitClient.RoomEvent.TrackPublished, (publication, participant) => {
            processPublishedTrack(publication, participant);
        });

        // Подія стріму 
        state.livekitRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log(`[DEBUG LiveKit] TrackSubscribed: kind=${track.kind}, source=${publication.source}, participant=${participant.identity}`);

            if (track.kind === LivekitClient.Track.Kind.Audio) {
                if (publication.source === LivekitClient.Track.Source.ScreenShareAudio) {
                    state.remoteScreenAudioTracks[participant.identity] = track;

                    const winContainer = state.remoteScreenWindows[participant.identity];
                    if (winContainer) {
                        const videoElem = winContainer.querySelector('.stream-window-video');
                        if (videoElem) {
                            track.attach(videoElem);
                            console.log(`[DEBUG ScreenAudio] Attached ScreenShareAudio on the fly.`);
                        }
                    }
                } else {
                    attachRemoteTrack(track, participant.identity);
                }
            }
            else if (track.kind === LivekitClient.Track.Kind.Video && publication.source === LivekitClient.Track.Source.ScreenShare) {
                state.remoteScreenTracks[participant.identity] = track;

                const winContainer = state.remoteScreenWindows[participant.identity];
                if (winContainer) {
                    const videoElem = winContainer.querySelector('.stream-window-video');
                    if (videoElem) {
                        track.attach(videoElem);
                        console.log(`[DEBUG ScreenShare] Attached ScreenShare Video on the fly.`);
                    }
                }
            }
        });

        // Обробка повного закриття трансляції стрімером 
        state.livekitRoom.on(LivekitClient.RoomEvent.TrackUnpublished, (publication, participant) => {
            console.log(`[DEBUG LiveKit] TrackUnpublished: source=${publication.source}, participant=${participant.identity}`);

            if (publication.source === LivekitClient.Track.Source.ScreenShare ||
                publication.source === LivekitClient.Track.Source.ScreenShareAudio) {

                removeRemoteScreenShare(participant.identity);
            }
        });

        // Відписка від треків 
        state.livekitRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            console.log(`[DEBUG LiveKit] TrackUnsubscribed: kind=${track.kind}, source=${publication.source}`);

            if (track.kind === LivekitClient.Track.Kind.Audio) {
                if (publication.source === LivekitClient.Track.Source.ScreenShareAudio) {
                    delete state.remoteScreenAudioTracks[participant.identity];
                } else {
                    detachRemoteTrack(participant.identity);
                }
            }
            else if (track.kind === LivekitClient.Track.Kind.Video && publication.source === LivekitClient.Track.Source.ScreenShare) {
                delete state.remoteScreenTracks[participant.identity];
            }
        });

        console.log('[LiveKit] Connecting to room...');
        await state.livekitRoom.connect(livekit_url, token);
        console.log('[LiveKit] Connected successfully!');

        // Обробляємо користувачів та їхні треки, які ВЖЕ були в кімнаті на момент нашого заходження
        state.livekitRoom.remoteParticipants.forEach((participant) => {
            participant.trackPublications.forEach((publication) => {
                processPublishedTrack(publication, participant);
            });
        });

        if (state.localStream) {
            const audioTrack = state.localStream.getAudioTracks()[0];
            if (audioTrack) {
                state.localAudioPublication = await state.livekitRoom.localParticipant.publishTrack(audioTrack);
                console.log('[LiveKit] Local audio published');

                if (state.isMuted) {
                    await state.localAudioPublication.track.mute();
                }
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

    let displayConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60 }
    };

    if (quality === '720p') {
        displayConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    } else if (quality === '480p') {
        displayConstraints = { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
    }

    try {
        console.log(`[DEBUG ScreenShare] Requesting getDisplayMedia...`);
        state.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: displayConstraints,
            audio: { suppressLocalAudioPlayback: false }
        });

        const videoTrack = state.localScreenStream.getVideoTracks()[0];
        const audioTrack = state.localScreenStream.getAudioTracks()[0];

        if (videoTrack) {
            let trackConstraints = {};

            if (quality === '1080p') {
                trackConstraints = {
                    width: { min: 1280, ideal: 1920 },
                    height: { min: 720, ideal: 1080 },
                    frameRate: { min: 60, ideal: 60, max: 60 }
                };
            } else if (quality === '720p') {
                trackConstraints = {
                    width: { min: 854, ideal: 1280 },
                    height: { min: 480, ideal: 720 },
                    frameRate: { min: 30, ideal: 30, max: 30 }
                };
            } else if (quality === '480p') {
                trackConstraints = {
                    width: { min: 640, ideal: 854 },
                    height: { min: 360, ideal: 480 },
                    frameRate: { min: 15, ideal: 15, max: 15 }
                };
            }

            try {
                await videoTrack.applyConstraints(trackConstraints);
                console.log(`[DEBUG ScreenShare] applyConstraints success:`, trackConstraints);
            } catch (e) {
                console.warn(`[DEBUG ScreenShare] Device could not satisfy track constraints:`, e);
            }
        }

        videoTrack.onended = () => {
            stopScreenShare();
        };

        if (!state.livekitRoom) throw new Error("LiveKit кімната ще не готова.");

        state.localScreenPublication = await state.livekitRoom.localParticipant.publishTrack(videoTrack, {
            name: 'screen',
            source: LivekitClient.Track.Source.ScreenShare,
            videoCodec: 'h264',
   
            videoEncoding: {
                maxBitrate: quality === '1080p' ? 4_500_000 : (quality === '720p' ? 2_500_000 : 1_000_000),
                maxFramerate: quality === '1080p' ? 60 : (quality === '720p' ? 30 : 15),
                priority: 'high' 
            },
            dtx: false
        })

        if (audioTrack) {
            state.localScreenAudioPublication = await state.livekitRoom.localParticipant.publishTrack(audioTrack, {
                name: 'screen_audio',
                source: LivekitClient.Track.Source.ScreenShareAudio
            });
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
            video.muted = true;
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
        try { await state.livekitRoom.localParticipant.unpublishTrack(state.localScreenAudioPublication.track); } catch (e) { console.error(e); }
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

// Викликається при виявленні публікації (тільки малює інтерфейс)
export function addRemoteScreenShare(publication, userId) {
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

    if (state.remoteScreenPublications[userId]) {
        delete state.remoteScreenPublications[userId];
    }

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

// Підписка на потік ТІЛЬКИ у момент відкриття вікна перегляду
export function openRemoteScreenWindow(userId) {
    if (state.remoteScreenWindows && state.remoteScreenWindows[userId]) {
        closeRemoteScreenWindow(userId);
        return;
    }

    const userPubs = state.remoteScreenPublications[userId];
    if (!userPubs || !userPubs[LivekitClient.Track.Source.ScreenShare]) {
        return alert("Трансляція більше недоступна");
    }

    const username = state.connectedUsers[userId] || "Користувач";
    const { winContainer, videoElem } = createFloatingWindow(userId, username);

    if (!state.remoteScreenWindows) state.remoteScreenWindows = {};
    state.remoteScreenWindows[userId] = winContainer;
    document.body.appendChild(winContainer);

    // Даємо команду SFU: "Я хочу отримувати ці дані"
    console.log(`[LiveKit] On-demand subscribing for user: ${userId}`);
    userPubs[LivekitClient.Track.Source.ScreenShare].setSubscribed(true);

    if (userPubs[LivekitClient.Track.Source.ScreenShareAudio]) {
        userPubs[LivekitClient.Track.Source.ScreenShareAudio].setSubscribed(true);
    }

    // Якщо треки вже встигли прилетіти / закешуватися
    if (state.remoteScreenTracks[userId]) state.remoteScreenTracks[userId].attach(videoElem);
    if (state.remoteScreenAudioTracks[userId]) state.remoteScreenAudioTracks[userId].attach(videoElem);

    updateRemoteScreenIconState(userId, true);
}

// Розірвання підписки на потік (SFU перестає відправляти байти клієнту)
function closeRemoteScreenWindow(userId) {
    if (!state.remoteScreenWindows) return;

    const winContainer = state.remoteScreenWindows[userId];
    if (winContainer) {
        console.log(`[DEBUG ScreenShare] Unsubscribing screen streams for user: ${userId}`);
        const videoElem = winContainer.querySelector('.stream-window-video');

        if (state.remoteScreenTracks[userId] && videoElem) state.remoteScreenTracks[userId].detach(videoElem);
        if (state.remoteScreenAudioTracks[userId] && videoElem) state.remoteScreenAudioTracks[userId].detach(videoElem);

        // Захист від race conditions: помилка підписки не повинна ламати очищення DOM
        const userPubs = state.remoteScreenPublications[userId];
        if (userPubs) {
            try {
                if (userPubs[LivekitClient.Track.Source.ScreenShare]) {
                    userPubs[LivekitClient.Track.Source.ScreenShare].setSubscribed(false);
                }
            } catch (e) {
                console.warn('[LiveKit] Video unsubscribe failed (track might be already dead):', e);
            }
            try {
                if (userPubs[LivekitClient.Track.Source.ScreenShareAudio]) {
                    userPubs[LivekitClient.Track.Source.ScreenShareAudio].setSubscribed(false);
                }
            } catch (e) {
                console.warn('[LiveKit] Audio unsubscribe failed:', e);
            }
        }

        winContainer.remove();
        delete state.remoteScreenWindows[userId];
        delete state.remoteScreenTracks[userId];
        delete state.remoteScreenAudioTracks[userId];

        updateRemoteScreenIconState(userId, false);
    }
}


function createFloatingWindow(userId, username) {
    const container = document.createElement('div');
    container.className = 'floating-stream-window';
    container.id = `stream-win-${userId}`;

    // ВАЖЛИВО для мобільних: забороняємо браузеру скролити екран під час перетягування вікна
    container.style.touchAction = 'none';

    const header = document.createElement('div');
    header.className = 'stream-window-header';

    const title = document.createElement('span');
    title.innerText = `Трансляція: ${username}`;

    const controls = document.createElement('div');
    controls.className = 'stream-window-controls';

    const maxBtn = document.createElement('button');
    maxBtn.className = 'stream-window-btn';
    maxBtn.innerHTML = '🔲';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'stream-window-btn close';
    closeBtn.innerHTML = '❌';

    controls.appendChild(maxBtn);
    controls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(controls);

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

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'stream-window-resize-handle';
    // Додано touch-action: none і сюди
    resizeHandle.style.cssText = 'position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize; z-index: 100; touch-action: none;';
    resizeHandle.style.backgroundImage = 'linear-gradient(135deg, transparent 30%, #ccc 30%, #ccc 50%, transparent 50%, transparent 70%, #ccc 70%, #ccc 90%, transparent 90%)';
    container.appendChild(resizeHandle);

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

    // --- ПЕРЕТЯГУВАННЯ (Оновлено на PointerEvents) ---
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.onpointerdown = (e) => {
        if (e.target.tagName.toLowerCase() === 'button') return;
        if (container.classList.contains('maximized')) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = container.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;

        // Захоплюємо вказівник, щоб події не губилися при швидкому русі
        header.setPointerCapture(e.pointerId);

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
    };

    function onPointerMove(e) {
        if (!isDragging) return;
        container.style.left = `${initialX + (e.clientX - startX)}px`;
        container.style.top = `${initialY + (e.clientY - startY)}px`;
        container.style.bottom = 'auto';
        container.style.right = 'auto';
    }

    function onPointerUp(e) {
        if (!isDragging) return;
        isDragging = false;
        try { header.releasePointerCapture(e.pointerId); } catch (err) { }
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
    }

    // --- ЗМІНА РОЗМІРУ (Оновлено на PointerEvents) ---
    let isResizing = false;
    let startWidth, startHeight, startMouseX, startMouseY;

    resizeHandle.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (container.classList.contains('maximized')) return;

        isResizing = true;
        startWidth = container.clientWidth;
        startHeight = container.clientHeight;
        startMouseX = e.clientX;
        startMouseY = e.clientY;

        resizeHandle.setPointerCapture(e.pointerId);

        document.addEventListener('pointermove', onPointerMoveResize);
        document.addEventListener('pointerup', onPointerUpResize);
    };

    function onPointerMoveResize(e) {
        if (!isResizing) return;
        const newWidth = startWidth + (e.clientX - startMouseX);
        const newHeight = startHeight + (e.clientY - startMouseY);

        if (newWidth > 320) container.style.width = `${newWidth}px`;
        if (newHeight > 240) container.style.height = `${newHeight}px`;
    }

    function onPointerUpResize(e) {
        if (!isResizing) return;
        isResizing = false;
        try { resizeHandle.releasePointerCapture(e.pointerId); } catch (err) { }
        document.removeEventListener('pointermove', onPointerMoveResize);
        document.removeEventListener('pointerup', onPointerUpResize);
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