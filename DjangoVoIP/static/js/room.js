const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = `${wsProtocol}${window.location.host}/ws/room/${roomId}/`;
console.log('Connecting to WebSocket:', wsUrl);

const chatSocket = new WebSocket(wsUrl);

let localStream = null;
const peerConnections = {};
let rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Карта гучності користувача 
const audioVolumeMap = {};


let isAudioReady = false;
let signalingQueue = [];
const remoteIceQueue = {};

chatSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateMyConnectionStatus(connectionStates.ERROR, 'Помилка з\'єднання');
    showLocalToast('Помилка з\'єднання WebSocket!', 'error');
    alert('Помилка з\'єднання WebSocket!');
};

chatSocket.onclose = () => {
    console.warn('WebSocket closed');
    updateMyConnectionStatus(connectionStates.ERROR, 'Відключено');
    showLocalToast('Відключено від серверу', 'error');
};

async function fetchIceServers() {
    try {
        console.log('[RTC Config] Fetching ICE servers...');
        const res = await fetch('/api/turn-credentials/');
        if (res.ok) {
            const data = await res.json();
            console.log('[RTC Config] Received ICE config:', data);
            rtcConfig = data;
        } else {
            console.warn('[RTC Config] Failed to fetch, status:', res.status);
        }
    } catch (e) {
        console.error("[RTC Config] Failed to fetch TURN credentials, using default STUN", e);
    }
    console.log('[RTC Config] Final rtcConfig:', rtcConfig);
}


async function loadChatHistory() {
    try {
        const res = await fetch(`/api/rooms/${roomId}/messages/?page=1&page_size=50`);
        const data = await res.json();
        const chatBox = document.getElementById('chat-box');

        const messages = data.results ? data.results : (Array.isArray(data) ? data : []);

        window.chatMessagesPage = 1;
        window.chatMessagesHasMore = data.next || false;
        window.isLoadingMessages = false;

        if (messages.length > 0) {
            messages.reverse().forEach(msg => {
                chatBox.innerHTML += `<p><strong>${msg.user.username}:</strong> ${msg.text}</p>`;
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (e) { console.error("Помилка завантаження історії чату", e); }
}


document.getElementById('chat-box').addEventListener('scroll', function () {
    if (this.scrollTop < 50 && !window.isLoadingMessages && window.chatMessagesHasMore) {
        window.isLoadingMessages = true;
        loadMoreMessages();
    }
});

async function loadMoreMessages() {
    try {
        window.chatMessagesPage++;
        const res = await fetch(`/api/rooms/${roomId}/messages/?page=${window.chatMessagesPage}&page_size=50`);
        const data = await res.json();
        const chatBox = document.getElementById('chat-box');
        const messages = data.results ? data.results : [];

        if (messages.length > 0) {
            const scrollHeightBefore = chatBox.scrollHeight;
            messages.reverse().forEach(msg => {
                const newMsg = `<p><strong>${msg.user.username}:</strong> ${msg.text}</p>`;
                chatBox.insertAdjacentHTML('afterbegin', newMsg);
            });
            const scrollHeightAfter = chatBox.scrollHeight;
            chatBox.scrollTop = scrollHeightAfter - scrollHeightBefore;
        }

        window.chatMessagesHasMore = data.next || false;
        window.isLoadingMessages = false;
    } catch (e) {
        console.error("Помилка завантаження старих повідомлень", e);
        window.isLoadingMessages = false;
    }
}


let audioContext = null;
let mediaSource = null;
let analyser = null;
let animationFrameId = null;
let monitoringInterval = null;
let audioContextResumeInterval = null;

async function initAudio() {
    try {
        console.log('[Audio] Requesting microphone access...');

        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true
            },
            video: false
        });

        console.log('[Audio] Microphone access granted');
        const audioTracks = localStream.getAudioTracks();
        console.log('[Audio] Audio tracks:', audioTracks.length);
        audioTracks.forEach(track => {
            console.log('[Audio] Track:', track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('[Audio] AudioContext created, state:', audioContext.state);

        mediaSource = audioContext.createMediaStreamSource(localStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        mediaSource.connect(analyser);
        console.log('[Audio] MediaSource connected to AudioContext');

        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(e => {
                console.warn('[Audio] Autoplay blocked resume, waiting for user click');
            });
        }

        startAudioLevelMonitoring();
        startAudioKeepAlive();
        startAudioContextResumeChecker();

        console.log('[Audio] Full audio monitoring started successfully');

        // обробляємо чергу сигналів, які прийшли під час ініціалізації мікрофона
        isAudioReady = true;
        if (signalingQueue.length > 0) {
            console.log(`[Signaling] Processing ${signalingQueue.length} queued messages...`);
            for (const payload of signalingQueue) {
                handleSignalingData(payload);
            }
            signalingQueue = []; // Очищуємо чергу
        }

    } catch (err) {
        console.error('[Audio] Microphone error:', err);
        alert("Будь ласка, дозвольте доступ до мікрофона!");
        throw err;
    }
}

function startAudioLevelMonitoring() {
    function monitorAudioLevel() {
        if (audioContext && audioContext.state === 'running' && analyser) {
            try {
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                updateAudioLevelUI(average);
            } catch (err) {
                console.warn('[Audio] Error in level monitoring:', err);
            }
        }
        animationFrameId = requestAnimationFrame(monitorAudioLevel);
    }

    monitorAudioLevel();
    console.log('[Audio] Level monitoring started via requestAnimationFrame');
}

function startAudioKeepAlive() {
    monitoringInterval = setInterval(() => {
        if (localStream) {
            const tracks = localStream.getAudioTracks();
            if (tracks.length > 0) {
                const isEnabled = tracks[0].enabled;
                console.log('[Audio Keep-Alive] Track enabled:', isEnabled);
            } else {
                console.warn('[Audio Keep-Alive] No audio tracks found!');
            }
        }
    }, 5000);

    console.log('[Audio] Keep-Alive monitoring started via setInterval');
}

function startAudioContextResumeChecker() {
    audioContextResumeInterval = setInterval(() => {
        if (audioContext) {
            if (audioContext.state === 'suspended') {
                console.warn('[Audio] AudioContext was suspended! Attempting resume...');
                audioContext.resume().then(() => {
                    console.log('[Audio] AudioContext resumed successfully');
                }).catch(err => {
                    console.error('[Audio] Failed to resume AudioContext:', err);
                });
            } else if (audioContext.state === 'closed') {
                console.error('[Audio] AudioContext is closed! Recreating...');
                audioContext = null;
            }
        }
    }, 10000);

    console.log('[Audio] AudioContext resume checker started');
}

function updateAudioLevelUI(level) {
    const audioLevelText = document.getElementById('audio-level-text');
    if (audioLevelText) {
        audioLevelText.textContent = Math.round((level / 255) * 100) + '%';
    }

    const audioLevelIndicator = document.getElementById('audio-level-indicator');
    if (audioLevelIndicator) {
        const percentage = Math.min(100, (level / 255) * 100);
        audioLevelIndicator.style.width = percentage + '%';

        if (percentage < 20) {
            audioLevelIndicator.style.background = '#72767d'; // Сірий
        } else if (percentage < 50) {
            audioLevelIndicator.style.background = '#43b581'; // Зелений
        } else if (percentage < 80) {
            audioLevelIndicator.style.background = '#faa61a'; // Жовтий
        } else {
            audioLevelIndicator.style.background = '#f04747'; // Червоний
        }
    }
}

function cleanupAudioMonitoring() {
    console.log('[Audio] Cleaning up audio resources...');

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        console.log('[Audio] Cancelled requestAnimationFrame');
    }

    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        console.log('[Audio] Cleared monitoring interval');
    }

    if (audioContextResumeInterval) {
        clearInterval(audioContextResumeInterval);
        audioContextResumeInterval = null;
        console.log('[Audio] Cleared AudioContext resume interval');
    }

    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log('[Audio] Stopped track:', track.kind);
        });
        localStream = null;
    }

    if (analyser) {
        analyser.disconnect();
        analyser = null;
    }

    if (mediaSource) {
        mediaSource.disconnect();
        mediaSource = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
        console.log('[Audio] AudioContext closed');
    }

    console.log('[Audio] Cleanup complete');
}

chatSocket.onopen = async () => {
    console.log('WebSocket connected');

    updateMyConnectionStatus(connectionStates.CONNECTING, 'Підключення...');
    showLocalToast('Підключення до серверу...', 'info');

    try {
        updateMyConnectionStatus(connectionStates.INITIALIZING_AUDIO, 'Ініціалізація аудіо...');
        showLocalToast('Ініціалізація аудіо...', 'info');
        await fetchIceServers();

        updateMyConnectionStatus(connectionStates.CHECKING_MICROPHONE, 'Перевірка мікрофона...');
        showLocalToast('Перевірка мікрофона...', 'info');
        await initAudio();

        updateMyConnectionStatus(connectionStates.ESTABLISHING_RTC, 'Встановлення з\'єднання...');
        showLocalToast('Встановлення з\'єднання...', 'info');
        await loadChatHistory();

        if (chatSocket.readyState === WebSocket.OPEN) {
            sendSignaling('all', { type: 'ready-for-connections' }, null);
        }

        updateMyConnectionStatus(connectionStates.CONNECTED, 'Готово');
        showLocalToast('Готово до спілкування! ✅', 'success');

        setTimeout(() => {
            const myUserItem = document.getElementById(`user-${currentUserId}`);
            if (myUserItem) {
                const badge = myUserItem.querySelector('.my-connection-badge');
                if (badge) {
                    badge.style.animation = 'slideOutToast 0.3s ease-out forwards';
                    setTimeout(() => badge.remove(), 300);
                }
            }
        }, 2000);

    } catch (error) {
        updateMyConnectionStatus(connectionStates.ERROR, `Помилка: ${error.message}`);
        showLocalToast(`Помилка: ${error.message}`, 'error');
        console.error('Connection error:', error);
    }
};

chatSocket.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    const { stream, payload } = data;

    console.log('WebSocket message:', stream, payload);

    if (stream === 'presence') {
        console.log('PRESENCE MESSAGE:', payload);
        const userList = document.getElementById('user-list');
        if (payload.action === 'join') {
            if (!document.getElementById(`user-${payload.user_id}`)) {
                console.log('Adding user:', payload.username);
                connectedUsers[payload.user_id] = payload.username;
                const initials = payload.username.substring(0, 1).toUpperCase();
                userList.innerHTML += `
                    <li class="user-item" id="user-${payload.user_id}">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-info">
                            <span class="username">${payload.username}</span>
                            <span class="user-status">Онлайн</span>
                        </div>
                    </li>
                `;
            }
        } else if (payload.action === 'leave') {
            const li = document.getElementById(`user-${payload.user_id}`);
            if (li) li.remove();
            delete connectedUsers[payload.user_id];
            if (peerConnections[payload.user_id]) {
                peerConnections[payload.user_id].close();
                delete peerConnections[payload.user_id];
            }
        }
    }
    else if (stream === 'chat') {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML += `<p><strong>${payload.sender}:</strong> ${payload.message}</p>`;
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    else if (stream === 'voice') {
        const userItem = document.getElementById(`user-${payload.user_id}`);
        if (userItem) {
            const statusSpan = userItem.querySelector('.user-status');
            if (statusSpan) {
                statusSpan.textContent = payload.state.isMuted ? 'Мікрофон вимкнено' : 'Онлайн';
                statusSpan.classList.toggle('muted', payload.state.isMuted);
            }
        }
    }
    else if (stream === 'signaling') {
        // ПЕРЕВІРКА ГОТОВНОСТІ АУДІО
        if (!isAudioReady) {
            console.log(`[Signaling] Audio not ready, queuing message from ${payload.sender_id}`);
            signalingQueue.push(payload);
            return;
        }
        await handleSignalingData(payload);
    }
};

// ОБРОБКА СИГНАЛІВ ТА ICE КАНДИДАТІВ
async function handleSignalingData(payload) {
    const senderId = payload.sender_id;

    if (payload.sdp) {
        if (payload.sdp.type === 'offer') {
            const pc = createPeerConnection(senderId);
            await pc.setRemoteDescription(payload.sdp);
            await processQueuedIceCandidates(senderId, pc); // Обробляємо ICE з черги

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignaling(senderId, pc.localDescription, null);

        } else if (payload.sdp.type === 'answer') {
            const pc = peerConnections[senderId];
            if (pc) {
                await pc.setRemoteDescription(payload.sdp);
                await processQueuedIceCandidates(senderId, pc); // Обробляємо ICE з черги
            }
        } else if (payload.sdp.type === 'ready-for-connections') {
            const pc = createPeerConnection(senderId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignaling(senderId, pc.localDescription, null);
        }
    } else if (payload.ice) {
        const pc = peerConnections[senderId];

        // Додаємо ICE, тільки якщо remoteDescription вже встановлено
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(payload.ice));
            } catch (error) {
                console.error(`[RTC] Error adding ICE candidate for ${senderId}:`, error);
            }
        } else {
            // Відкладаємо в чергу
            if (!remoteIceQueue[senderId]) remoteIceQueue[senderId] = [];
            remoteIceQueue[senderId].push(payload.ice);
            console.log(`[RTC] Queued ICE candidate for ${senderId}`);
        }
    }
}

// ФУНКЦІЯ ОБРОБКИ ЧЕРГИ ICE
async function processQueuedIceCandidates(userId, pc) {
    if (remoteIceQueue[userId]) {
        console.log(`[RTC] Processing ${remoteIceQueue[userId].length} queued ICE candidates for ${userId}`);
        for (const ice of remoteIceQueue[userId]) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(ice));
            } catch (error) {
                console.error(`[RTC] Error adding queued ICE candidate for ${userId}:`, error);
            }
        }
        delete remoteIceQueue[userId];
    }
}

function createPeerConnection(targetUserId) {
    if (peerConnections[targetUserId]) {
        console.log(`[RTC] Returning existing connection for user ${targetUserId}`);
        return peerConnections[targetUserId];
    }

    console.log(`[RTC] Creating new PeerConnection for user ${targetUserId}`);
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetUserId] = pc;

    if (localStream) {
        console.log(`[RTC] Adding local tracks to connection for ${targetUserId}`);
        const tracks = localStream.getTracks();
        tracks.forEach((track, index) => {
            console.log(`[RTC] Adding track ${index}: type=${track.kind}, enabled=${track.enabled}, readyState=${track.readyState}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.warn(`[RTC] WARNING: localStream is NULL when creating connection for ${targetUserId}`);
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignaling(targetUserId, null, event.candidate);
        }
    };

    pc.ontrack = (event) => {
        console.log(`[RTC] Received remote track from ${targetUserId}:`, event.track.kind);

        let audioElem = document.getElementById(`audio-${targetUserId}`);
        if (!audioElem) {
            console.log(`[RTC] Creating audio element for ${targetUserId}`);
            audioElem = document.createElement('audio');
            audioElem.id = `audio-${targetUserId}`;
            audioElem.autoplay = true;
            audioElem.volume = audioVolumeMap[targetUserId] || 1.0;

            // Якщо контейнера ще немає, створимо його (на всякий випадок)
            let remoteAudiosContainer = document.getElementById('remote-audios');
            if (!remoteAudiosContainer) {
                remoteAudiosContainer = document.createElement('div');
                remoteAudiosContainer.id = 'remote-audios';
                remoteAudiosContainer.style.display = 'none';
                document.body.appendChild(remoteAudiosContainer);
            }
            remoteAudiosContainer.appendChild(audioElem);
        }

        console.log(`[RTC] Setting audio stream for ${targetUserId}`);

        // БЕЗПЕЧНИЙ ФОЛБЕК ДЛЯ МЕДІАСТРІМУ
        if (event.streams && event.streams.length > 0) {
            audioElem.srcObject = event.streams[0];
        } else {
            console.log(`[RTC] No stream found in event, creating new MediaStream for ${targetUserId}`);
            audioElem.srcObject = new MediaStream([event.track]);
        }

        // ВИРІШЕННЯ БЛОКУВАННЯ АВТОЗАПУСКУ БРАУЗЕРОМ
        audioElem.play().catch(e => {
            console.warn(`[Audio Autoplay] Blocked by browser for user ${targetUserId}. User interaction needed.`, e);
        });
    };

    pc.onconnectionstatechange = () => {
        console.log(`[RTC] Connection state for ${targetUserId}: ${pc.connectionState}`);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`[RTC] ICE connection state for ${targetUserId}: ${pc.iceConnectionState}`);
    };

    pc.onerror = (error) => {
        console.error(`[RTC] Error in connection for ${targetUserId}:`, error);
    };

    return pc;
}

function sendSignaling(targetUserId, sdp, ice) {
    if (chatSocket.readyState === WebSocket.OPEN) {
        const payload = {
            stream: 'signaling',
            payload: {
                target_user_id: targetUserId,
                sdp: sdp,
                ice: ice
            }
        };

        chatSocket.send(JSON.stringify(payload));
    } else {
        console.warn(`[Signaling] WebSocket not open (state: ${chatSocket.readyState}), cannot send to ${targetUserId}`);
    }
}

const connectionStates = {
    CONNECTING: 'connecting',
    INITIALIZING_AUDIO: 'initializing_audio',
    CHECKING_MICROPHONE: 'checking_microphone',
    ESTABLISHING_RTC: 'establishing_rtc',
    CONNECTED: 'connected',
    ERROR: 'error'
};

let currentConnectionState = null;

function updateMyConnectionStatus(state, message) {
    const myUserItem = document.getElementById(`user-${currentUserId}`);
    if (!myUserItem) return;

    myUserItem.style.position = 'relative';

    const oldBadge = myUserItem.querySelector('.my-connection-badge');
    if (oldBadge) oldBadge.remove();

    const badge = document.createElement('div');
    badge.className = 'my-connection-badge';

    const colors = {
        [connectionStates.CONNECTING]: '#faa61a',
        [connectionStates.INITIALIZING_AUDIO]: '#5865f2',
        [connectionStates.CHECKING_MICROPHONE]: '#5865f2',
        [connectionStates.ESTABLISHING_RTC]: '#5865f2',
        [connectionStates.CONNECTED]: '#43b581',
        [connectionStates.ERROR]: '#f04747'
    };

    const emoji = {
        [connectionStates.CONNECTING]: '🔄',
        [connectionStates.INITIALIZING_AUDIO]: '🎤',
        [connectionStates.CHECKING_MICROPHONE]: '🔊',
        [connectionStates.ESTABLISHING_RTC]: '📡',
        [connectionStates.CONNECTED]: '✅',
        [connectionStates.ERROR]: '❌'
    };

    badge.style.cssText = `
        position: absolute;
        bottom: -28px;
        left: 0;
        right: 0;
        background: ${colors[state]};
        color: white;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
        z-index: 10;
        animation: pulse-badge 1.5s infinite;
    `;

    badge.textContent = `${emoji[state]} ${message}`;
    myUserItem.appendChild(badge);
}

function showLocalToast(message, type = 'info') {
    let toastContainer = document.getElementById('local-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'local-toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(toastContainer);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInToast {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOutToast {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(400px); opacity: 0; }
            }
            @keyframes pulse-badge {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }
        `;
        document.head.appendChild(style);
    }

    const toast = document.createElement('div');

    const colors = {
        'info': '#5865f2',
        'success': '#43b581',
        'error': '#f04747'
    };

    const emoji = {
        'info': '🔄',
        'success': '✅',
        'error': '❌'
    };

    toast.style.cssText = `
        background: #36393f;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-size: 13px;
        min-width: 280px;
        animation: slideInToast 0.3s ease-out;
        border-left: 4px solid ${colors[type]};
    `;

    toast.textContent = `${emoji[type]} ${message}`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutToast 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

let isMuted = false;

function initializeEventListeners() {
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', function () {
            isMuted = !isMuted;
            if (localStream) localStream.getAudioTracks()[0].enabled = !isMuted;
            chatSocket.send(JSON.stringify({ stream: 'voice', payload: { isMuted: isMuted } }));
            this.innerText = isMuted ? "🔇" : "🔊";
        });
    }

    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    if (settingsToggleBtn) {
        settingsToggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const dropdown = document.getElementById('settings-dropdown-menu');
            if (dropdown) {
                dropdown.classList.toggle('visible');
            }
        });
    }

    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('settings-dropdown-menu');
        const toggleBtn = document.getElementById('settings-toggle-btn');
        if (dropdown && toggleBtn && !dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
            dropdown.classList.remove('visible');
        }
    });

    const leaveRoomBtn = document.getElementById('leave-room-menu-btn');
    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', function () {
            const dropdown = document.getElementById('settings-dropdown-menu');
            if (dropdown) dropdown.classList.remove('visible');
            leaveRoom();
        });
    }

    const userSettingsBtn = document.getElementById('user-settings-btn');
    if (userSettingsBtn) {
        userSettingsBtn.addEventListener('click', function () {
            alert('Функціональність параметрів користувача буде додана пізніше');
        });
    }

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && this.value.trim() !== '') {
                if (chatSocket.readyState === WebSocket.OPEN) {
                    chatSocket.send(JSON.stringify({ stream: 'chat', payload: { message: this.value } }));
                    this.value = '';
                } else {
                    alert('WebSocket не з\'єднаний!');
                }
            }
        });
    }

    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            if (!currentContextUserId) return;

            const volume = e.target.value / 100;
            const audioElem = document.getElementById(`audio-${currentContextUserId}`);

            if (audioElem) {
                audioElem.volume = volume;
                audioVolumeMap[currentContextUserId] = volume;
                document.getElementById('volume-percent').textContent = e.target.value + '%';
            }
        });
    }

    const muteUserBtn = document.getElementById('mute-user-btn');
    if (muteUserBtn) {
        muteUserBtn.addEventListener('click', () => {
            if (!currentContextUserId) return;

            const audioElem = document.getElementById(`audio-${currentContextUserId}`);
            const volumeSlider = document.getElementById('volume-slider');
            const volumePercent = document.getElementById('volume-percent');
            const muteBtn = document.getElementById('mute-user-btn');

            if (!audioElem) return;

            const currentVolume = audioVolumeMap[currentContextUserId] || 1.0;

            if (currentVolume === 0) {
                const previousVolume = volumeBeforeMute[currentContextUserId] || 1.0;
                audioElem.volume = previousVolume;
                audioVolumeMap[currentContextUserId] = previousVolume;
                volumeSlider.value = Math.round(previousVolume * 100);
                volumePercent.textContent = Math.round(previousVolume * 100) + '%';
                muteBtn.textContent = '🔊';
                delete volumeBeforeMute[currentContextUserId];
            } else {
                volumeBeforeMute[currentContextUserId] = currentVolume;
                audioElem.volume = 0;
                audioVolumeMap[currentContextUserId] = 0;
                volumeSlider.value = 0;
                volumePercent.textContent = '0%';
                muteBtn.textContent = '🔇';
            }
        });
    }

    const closeContextBtn = document.getElementById('close-context');
    if (closeContextBtn) {
        closeContextBtn.addEventListener('click', hideVolumeContext);
    }

    document.addEventListener('click', (e) => {
        const contextMenu = document.getElementById('user-volume-context');
        if (contextMenu && contextMenu.style.display !== 'none' && !contextMenu.contains(e.target) && !e.target.closest('.user-item')) {
            hideVolumeContext();
        }
    });

    document.addEventListener('contextmenu', (e) => {
        const userItem = e.target.closest('.user-item');
        if (userItem) {
            e.preventDefault();
            const userId = userItem.id.replace('user-', '');
            const username = userItem.querySelector('.username').textContent;
            showVolumeContext(userId, username, e);
        }
    });

    document.addEventListener('click', () => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('[Audio] AudioContext успішно розбуджено кліком!');
            }).catch(err => console.error('[Audio] Помилка розбудження:', err));
        }
    });

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeEventListeners();
    });
} else {
    initializeEventListeners();
}

async function leaveRoom() {
    if (!confirm('Ви впевнені, що хочете покинути кімнату?')) return;

    try {
        const response = await fetch(`/api/rooms/${roomId}/leave/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });

        if (response.ok) {
            window.location.href = '/menu/';
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося покинути кімнату'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при виході з кімнати');
    }
}

let currentContextUserId = null;
let volumeBeforeMute = {};

function showVolumeContext(userId, username, event) {
    if (userId == currentUserId) return;

    currentContextUserId = userId;
    const contextMenu = document.getElementById('user-volume-context');
    const volumeSlider = document.getElementById('volume-slider');
    const volumePercent = document.getElementById('volume-percent');
    const contextUsername = document.getElementById('context-username');
    const muteBtn = document.getElementById('mute-user-btn');

    const currentVolume = audioVolumeMap[userId] !== undefined ? Math.round(audioVolumeMap[userId] * 100) : 100;
    volumeSlider.value = currentVolume;
    volumePercent.textContent = currentVolume + '%';
    contextUsername.textContent = username;

    muteBtn.textContent = currentVolume === 0 ? '🔇' : '🔊';

    let x = event.pageX;
    let y = event.pageY;
    const menuWidth = 220;
    const menuHeight = 150;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.style.display = 'block';
}

function hideVolumeContext() {
    document.getElementById('user-volume-context').style.display = 'none';
    currentContextUserId = null;
}

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

async function checkAdminStatus() {
    try {
        const response = await fetch(`/api/rooms/${roomId}/`);
        const room = await response.json();

        if (room.is_admin) {
            isAdmin = true;
            document.getElementById('admin-panel').style.display = 'block';
        }
    } catch (error) {
        console.error('Помилка завантаження інформації про кімнату:', error);
    }
}

document.getElementById('change-password-btn')?.addEventListener('click', function () {
    openModal('password-modal');
    document.getElementById('new-password-input').focus();
});

document.getElementById('confirm-password-btn')?.addEventListener('click', async function () {
    const newPassword = document.getElementById('new-password-input').value;

    if (!newPassword) {
        alert('Введіть новий пароль');
        return;
    }

    try {
        const response = await fetch(`/api/rooms/${roomId}/change-password/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ password: newPassword })
        });

        if (response.ok) {
            alert('Пароль змінено успішно');
            closeModal('password-modal');
            document.getElementById('new-password-input').value = '';
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося змінити пароль'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при зміні пароля');
    }
});

document.getElementById('generate-invite-btn')?.addEventListener('click', function () {
    openModal('invite-modal');
});

document.getElementById('generate-link-btn')?.addEventListener('click', async function () {
    const expiresHours = document.getElementById('expires-hours').value;

    try {
        const response = await fetch(`/api/rooms/${roomId}/generate-invite/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ expires_hours: parseInt(expiresHours) })
        });

        if (response.ok) {
            const data = await response.json();
            const inviteLink = `${window.location.origin}/menu/?invite=${data.token}&room=${roomId}`;
            document.getElementById('invite-link-text').textContent = inviteLink;
            document.getElementById('invite-result').style.display = 'block';
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося згенерувати посилання'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при генеруванні посилання');
    }
});

document.getElementById('copy-invite-btn')?.addEventListener('click', function () {
    const text = document.getElementById('invite-link-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('Посилання скопійовано в буфер обміну');
    });
});

document.getElementById('add-member-btn')?.addEventListener('click', function () {
    openModal('add-member-modal');
    document.getElementById('username-input').focus();
});

document.getElementById('confirm-add-member-btn')?.addEventListener('click', async function () {
    const username = document.getElementById('username-input').value.trim();

    if (!username) {
        alert('Введіть ім\'я користувача');
        return;
    }

    try {
        const response = await fetch(`/api/rooms/${roomId}/add-member/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ username: username })
        });

        if (response.ok) {
            const data = await response.json();
            alert(`${data.username} ${data.status === 'added' ? 'доданий' : 'вже є членом'} кімнати`);
            closeModal('add-member-modal');
            document.getElementById('username-input').value = '';
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося додати користувача'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при додаванні користувача');
    }
});

document.getElementById('remove-member-btn')?.addEventListener('click', async function () {
    const selectEl = document.getElementById('remove-username-input');
    selectEl.innerHTML = '<option value="">-- Завантаження --</option>';

    try {
        const response = await fetch(`/api/rooms/${roomId}/members/?page=1&page_size=100`);
        if (response.ok) {
            const data = await response.json();
            const members = data.results || [];
            selectEl.innerHTML = '<option value="">-- Виберіть користувача --</option>';

            members.forEach(member => {
                if (member.username !== currentUsername) {
                    const option = document.createElement('option');
                    option.value = member.username;
                    option.textContent = `${member.username} (${member.role === 'admin' ? 'Адмін' : 'Член'})`;
                    selectEl.appendChild(option);
                }
            });
        } else {
            selectEl.innerHTML = '<option value="">Помилка завантаження</option>';
        }
    } catch (error) {
        console.error('Помилка:', error);
        selectEl.innerHTML = '<option value="">Помилка завантаження</option>';
    }

    openModal('remove-member-modal');
});

document.getElementById('confirm-remove-member-btn')?.addEventListener('click', async function () {
    const username = document.getElementById('remove-username-input').value;

    if (!username) {
        alert('Виберіть користувача');
        return;
    }

    if (!confirm('Ви впевнені, що хочете видалити цього користувача?')) {
        return;
    }

    try {
        const response = await fetch(`/api/rooms/${roomId}/remove-member/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ username: username })
        });

        if (response.ok) {
            const data = await response.json();
            alert(`${data.username} видалено з кімнати`);
            closeModal('remove-member-modal');
            location.reload();
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося видалити користувача'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при видаленні користувача');
    }
});

document.getElementById('delete-room-btn')?.addEventListener('click', async function () {
    if (!confirm('Ви впевнені, що хочете видалити цю кімнату? Це дія незворотна.')) {
        return;
    }

    try {
        const response = await fetch(`/api/rooms/${roomId}/`, {
            method: 'DELETE',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
        });

        if (response.ok || response.status === 204) {
            alert('Кімната видалена');
            window.location.href = '/menu/';
        } else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося видалити кімнату'));
        }
    } catch (error) {
        console.error('Помилка:', error);
        alert('Помилка при видаленні кімнати');
    }
});

document.addEventListener('DOMContentLoaded', checkAdminStatus);