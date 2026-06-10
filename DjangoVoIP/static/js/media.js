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
                    // Зберігаємо аудіотрек екрану в стан
                    state.remoteScreenAudioTracks[participant.identity] = track;

                    // Якщо глядач вже відкрив вікно трансляції, додаємо аудіо в ГОЛОВНИЙ документ
                    const win = state.remoteScreenWindows[participant.identity];
                    if (win && !win.closed) {
                        console.log(`[DEBUG ScreenAudio] Window for ${participant.identity} is OPEN. Attaching audio to main document.`);
                        let audioElem = document.getElementById(`screen-audio-${participant.identity}`);
                        if (!audioElem) {
                            audioElem = document.createElement('audio');
                            audioElem.id = `screen-audio-${participant.identity}`;
                            audioElem.autoplay = true;
                            document.body.appendChild(audioElem);
                            console.log(`[DEBUG ScreenAudio] Created new <audio> element: #screen-audio-${participant.identity}`);
                        }
                        track.attach(audioElem);
                        console.log(`[DEBUG ScreenAudio] Successfully attached ScreenShareAudio to main document.`);
                    } else {
                        console.log(`[DEBUG ScreenAudio] Window for ${participant.identity} is CLOSED. Track saved in state for later.`);
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
                    delete state.remoteScreenAudioTracks[participant.identity];
                    console.log(`[DEBUG ScreenAudio] Removed ScreenShareAudio track from state for ${participant.identity}`);

                    // Видаляємо елемент з головного вікна
                    const audioElem = document.getElementById(`screen-audio-${participant.identity}`);
                    if (audioElem) {
                        track.detach(audioElem);
                        audioElem.remove();
                        console.log(`[DEBUG ScreenAudio] Removed <audio> element #screen-audio-${participant.identity} from main document.`);
                    }
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
            if (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) {
                state.remoteScreenWindows[userId].onbeforeunload = null;
                state.remoteScreenWindows[userId].close();
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
        width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } };
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

        icon.onmouseover = () => { icon.style.background = (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) ? '#d63c3c' : '#3a9f6a'; };
        icon.onmouseout = () => { icon.style.background = (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) ? '#f04747' : '#43b581'; };

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
    delete state.remoteScreenAudioTracks[userId];

    // Очищення аудіо елементу головного вікна
    const audioElem = document.getElementById(`screen-audio-${userId}`);
    if (audioElem) {
        audioElem.remove();
        console.log(`[DEBUG ScreenAudio] Cleanup: removed #screen-audio-${userId}`);
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

export function openRemoteScreenWindow(userId) {
    console.log(`[DEBUG ScreenShare] Toggling viewer window for userId: ${userId}`);

    if (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) {
        console.log(`[DEBUG ScreenShare] Window already open, closing it.`);
        state.remoteScreenWindows[userId].close();
        delete state.remoteScreenWindows[userId];
        updateRemoteScreenIconState(userId, false);
        return;
    }

    const videoTrack = state.remoteScreenTracks[userId];
    const username = state.connectedUsers[userId] || "Користувач";
    if (!videoTrack) {
        console.error(`[DEBUG ScreenShare] No video track found for ${userId}!`);
        return alert("Трансляція більше недоступна");
    }

    console.log(`[DEBUG ScreenShare] Opening new window for stream.`);
    const win = window.open("", "_blank", "width=800,height=600,scrollbars=no,resizable=yes");
    if (win) {
        win.document.title = `Трансляція екрану - ${username}`;
        win.document.body.style.cssText = "margin: 0; background-color: #000; display: flex; align-items: center; justify-content: center; height: 100vh; overflow: hidden;";

        const video = win.document.createElement('video');
        video.id = 'screen-video';
        video.autoplay = true;
        video.playsInline = true;
        video.controls = false;
        video.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain; outline: none;";
        win.document.body.appendChild(video);

        // 1. Прив'язуємо відео нативно через LiveKit
        console.log(`[DEBUG ScreenShare] Attaching video track to window element.`);
        videoTrack.attach(video);

        // 2. Аудіо обробляємо в ГОЛОВНОМУ вікні
        const audioTrack = state.remoteScreenAudioTracks[userId];
        if (audioTrack) {
            console.log(`[DEBUG ScreenAudio] Found existing audio track for ${userId}. Attaching to main document.`);
            let audioElem = document.getElementById(`screen-audio-${userId}`);
            if (!audioElem) {
                audioElem = document.createElement('audio');
                audioElem.id = `screen-audio-${userId}`;
                audioElem.autoplay = true;
                document.body.appendChild(audioElem);
                console.log(`[DEBUG ScreenAudio] Created new <audio> element: #screen-audio-${userId}`);
            }
            audioTrack.attach(audioElem);
            console.log(`[DEBUG ScreenAudio] Audio track attached successfully.`);
        } else {
            console.warn(`[DEBUG ScreenAudio] No audio track found in state for ${userId} at the moment of opening window. It might arrive later.`);
        }

        state.remoteScreenWindows[userId] = win;
        updateRemoteScreenIconState(userId, true);

        win.onbeforeunload = () => {
            console.log(`[DEBUG ScreenShare] Viewer window closed by user.`);
            videoTrack.detach(video);

            const audioElem = document.getElementById(`screen-audio-${userId}`);
            if (audioElem) {
                if (state.remoteScreenAudioTracks[userId]) {
                    state.remoteScreenAudioTracks[userId].detach(audioElem);
                }
                audioElem.remove();
                console.log(`[DEBUG ScreenAudio] Cleaned up audio element for ${userId} from main document.`);
            }

            delete state.remoteScreenWindows[userId];
            updateRemoteScreenIconState(userId, false);
        };
    } else {
        console.error(`[DEBUG ScreenShare] Browser blocked window.open!`);
    }
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

        if (state.remoteScreenWindows) {
            for (const userId in state.remoteScreenWindows) {
                if (state.remoteScreenWindows[userId] && !state.remoteScreenWindows[userId].closed) {
                    state.remoteScreenWindows[userId].close();
                }
            }
        }
    });

}