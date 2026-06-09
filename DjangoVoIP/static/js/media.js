
import { state } from './state.js';
import { updateAudioLevelUI } from './ui.js';

export async function connectLiveKit() {
    try {
        console.log('[LiveKit] Fetching token...');
        const res = await fetch(`/api/rooms/${window.roomId}/livekit-token/`);

        if (!res.ok) throw new Error(`Failed to fetch LiveKit token: ${res.statusText}`);

        const data = await res.json();
        const { token, livekit_url } = data;

        state.livekitRoom = new LivekitClient.Room();

        state.livekitRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log(`[LiveKit] Track subscribed from ${participant.identity}`);
            if (track.kind === LivekitClient.Track.Kind.Audio) {
                attachRemoteTrack(track, participant.identity);
            }
            else if (track.kind === LivekitClient.Track.Kind.Video && publication.source === LivekitClient.Track.Source.ScreenShare) {
                addRemoteScreenShare(track, participant.identity);
            }
        });

        state.livekitRoom.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            console.log(`[LiveKit] Track unsubscribed from ${participant.identity}`);
            if (track.kind === LivekitClient.Track.Kind.Audio) {
                detachRemoteTrack(participant.identity);
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
            await state.livekitRoom.localParticipant.publishTrack(audioTrack);
            console.log('[LiveKit] Local audio published');
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

        console.log('[Audio] Microphone access granted');
        const audioTracks = state.localStream.getAudioTracks();
        audioTracks.forEach(track => {
            console.log('[Audio] Track:', track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
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
    state.monitoringInterval = setInterval(() => {
        if (state.localStream) {
            const tracks = state.localStream.getAudioTracks();
            if (tracks.length > 0) {
                const isEnabled = tracks[0].enabled;
                console.log('[Audio Keep-Alive] Track enabled:', isEnabled);
            }
        }
    }, 5000);
}

function startAudioContextResumeChecker() {
    state.audioContextResumeInterval = setInterval(() => {
        if (state.audioContext) {
            if (state.audioContext.state === 'suspended') {
                state.audioContext.resume().catch(err => console.error('[Audio] Failed to resume:', err));
            } else if (state.audioContext.state === 'closed') {
                state.audioContext = null;
            }
        }
    }, 10000);
}

export function cleanupAudioMonitoring() {
    console.log('[Audio] Cleaning up audio resources...');
    if (state.animationFrameId) cancelAnimationFrame(state.animationFrameId);
    if (state.monitoringInterval) clearInterval(state.monitoringInterval);
    if (state.audioContextResumeInterval) clearInterval(state.audioContextResumeInterval);

    if (state.livekitRoom) {
        state.livekitRoom.disconnect();
        state.livekitRoom = null;
        console.log('[LiveKit] Disconnected');
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
    console.log('[ScreenShare] Натиснуто старт трансляції екрану');
    if (state.isSharingScreen) return;

    // ПЕРЕВІРКА НА HTTPS АБО LOCALHOST
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        const secureError = "Браузер блокує доступ до екрану. Демонстрація працює ВИКЛЮЧНО через захищене з'єднання HTTPS або через localhost!";
        console.error('[ScreenShare]', secureError);
        alert(secureError);
        return;
    }

    const qualitySelect = document.getElementById('screenshare-quality');
    const quality = qualitySelect ? qualitySelect.value : '1080p';

    let constraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    if (quality === '720p') {
        constraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    } else if (quality === '4k') {
        constraints = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } };
    } else if (quality === 'low') {
        constraints = { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 15 } };
    }

    try {
        state.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: constraints,
            audio: false
        });

        const track = state.localScreenStream.getVideoTracks()[0];

        track.onended = () => {
            stopScreenShare();
        };

        if (!state.livekitRoom) {
            throw new Error("LiveKit кімната ще не готова.");
        }

        state.localScreenPublication = await state.livekitRoom.localParticipant.publishTrack(track, {
            name: 'screen',
            source: LivekitClient.Track.Source.ScreenShare
        });

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

            win.onbeforeunload = () => {
                if (state.isSharingScreen) {
                    stopScreenShare();
                }
            };
        }

    } catch (error) {
        console.error('[ScreenShare] Помилка:', error);
        if (error.name !== 'NotAllowedError') {
            alert('Помилка запуску трансляції: ' + error.message);
        }
    }
}

export async function stopScreenShare() {
    console.log('[ScreenShare] Зупинка трансляції екрану');
    if (!state.isSharingScreen) return;
    state.isSharingScreen = false;

    if (state.localScreenWindow && !state.localScreenWindow.closed) {
        state.localScreenWindow.onbeforeunload = null;
        state.localScreenWindow.close();
    }
    state.localScreenWindow = null;

    if (state.localScreenPublication) {
        try {
            await state.livekitRoom.localParticipant.unpublishTrack(state.localScreenPublication.track);
        } catch (e) { console.error(e); }
        state.localScreenPublication = null;
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

        icon.onmouseover = () => icon.style.background = '#3a9f6a';
        icon.onmouseout = () => icon.style.background = '#43b581';

        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            openRemoteScreenWindow(userId);
        });

        userItem.appendChild(icon);
    }
}

export function removeRemoteScreenShare(userId) {
    if (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) {
        state.remoteScreenWindows[userId].onbeforeunload = null;
        state.remoteScreenWindows[userId].close();
    }
    delete state.remoteScreenWindows[userId];
    delete state.remoteScreenTracks[userId];

    const userItem = document.getElementById(`user-${userId}`);
    if (userItem) {
        const icon = userItem.querySelector('.screenshare-icon');
        if (icon) icon.remove();
    }
}

export function openRemoteScreenWindow(userId) {
    if (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) {
        state.remoteScreenWindows[userId].focus();
        return;
    }

    const track = state.remoteScreenTracks[userId];
    const username = state.connectedUsers[userId] || "Користувач";
    if (!track) return alert("Трансляція більше недоступна");

    const win = window.open("", "_blank", "width=800,height=600,scrollbars=no,resizable=yes");
    if (win) {
        win.document.title = `Трансляція екрану - ${username}`;
        win.document.body.style.cssText = "margin: 0; background-color: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden;";

        const video = win.document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.controls = true;
        video.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; outline: none;";
        win.document.body.appendChild(video);

        track.attach(video);
        state.remoteScreenWindows[userId] = win;

        win.onbeforeunload = () => {
            track.detach(video);
            delete state.remoteScreenWindows[userId];
        };
    }
}

// Функція для ініціалізації кнопки в обхід ui.js
export function initScreenShareListeners() {
    const btn = document.getElementById('screenshare-btn');
    if (btn) {
        console.log('[ScreenShare] Подію успішно прив\'язано до кнопки.');
        btn.addEventListener('click', function () {
            if (state.isSharingScreen) {
                stopScreenShare();
            } else {
                startScreenShare();
            }
        });
    } else {
        console.error('[ScreenShare] Помилка: Кнопку з id="screenshare-btn" не знайдено в DOM структурі.');
    }
}


