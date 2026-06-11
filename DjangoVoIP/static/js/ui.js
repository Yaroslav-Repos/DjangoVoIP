
import { state } from './state.js';
import { getCookie } from './utils.js';
import { loadMoreMessages } from './chat.js';

export function updateAudioLevelUI(level) {
    const audioLevelText = document.getElementById('audio-level-text');
    if (audioLevelText) {
        audioLevelText.textContent = Math.round((level / 255) * 100) + '%';
    }

    const audioLevelIndicator = document.getElementById('audio-level-indicator');
    if (audioLevelIndicator) {
        const percentage = Math.min(100, (level / 255) * 100);
        audioLevelIndicator.style.width = percentage + '%';

        if (percentage < 20) audioLevelIndicator.style.background = '#72767d';
        else if (percentage < 50) audioLevelIndicator.style.background = '#43b581';
        else if (percentage < 80) audioLevelIndicator.style.background = '#faa61a';
        else audioLevelIndicator.style.background = '#f04747';
    }
}

export async function leaveRoom() {
    if (!confirm('Ви впевнені, що хочете покинути кімнату?')) return;
    try {
        const response = await fetch(`/api/rooms/${window.roomId}/leave/`, {
            method: 'POST',
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });
        if (response.ok) window.location.href = '/menu/';
        else {
            const data = await response.json();
            alert('Помилка: ' + (data.detail || 'Не вдалося покинути кімнату'));
        }
    } catch (error) { console.error('Помилка:', error); alert('Помилка при виході з кімнати'); }
}

export function showVolumeContext(userId, username, event) {
    if (userId == window.currentUserId) return;

    state.currentContextUserId = userId;
    const contextMenu = document.getElementById('user-volume-context');
    const volumeSlider = document.getElementById('volume-slider');
    const volumePercent = document.getElementById('volume-percent');
    const contextUsername = document.getElementById('context-username');
    const muteBtn = document.getElementById('mute-user-btn');

    const currentVolume = state.audioVolumeMap[userId] !== undefined ? Math.round(state.audioVolumeMap[userId] * 100) : 100;
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

export function hideVolumeContext() {
    document.getElementById('user-volume-context').style.display = 'none';
    state.currentContextUserId = null;
}

export function initializeEventListeners() {

    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', async function () {
            state.isMuted = !state.isMuted;

            if (state.localAudioPublication && state.localAudioPublication.track) {
                if (state.isMuted) {
                    await state.localAudioPublication.track.mute();
                    console.log('[LiveKit] SFU processing stopped (Track Muted)');
                } else {
                    await state.localAudioPublication.track.unmute();
                    console.log('[LiveKit] SFU processing resumed (Track Unmuted)');
                }
            } else if (state.localStream) {
                state.localStream.getAudioTracks()[0].enabled = !state.isMuted;
            }

            state.chatSocket.send(JSON.stringify({ stream: 'voice', payload: { isMuted: state.isMuted } }));
            this.innerText = state.isMuted ? "🔇" : "🔊";
        });
    }

    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    if (settingsToggleBtn) {
        settingsToggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            const dropdown = document.getElementById('settings-dropdown-menu');
            if (dropdown) dropdown.classList.toggle('visible');
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
        userSettingsBtn.addEventListener('click', () => alert('Функціональність параметрів користувача буде додана пізніше'));
    }

    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');

    chatInput.addEventListener('input', function () {
        this.style.height = 'auto'; 
        this.style.height = (this.scrollHeight) + 'px'; 
    });
    
    function sendChatMessage() {
        if (!chatInput) return;
        const message = chatInput.value.trim();
        if (message !== '') {
            if (state.chatSocket && state.chatSocket.readyState === WebSocket.OPEN) {
                state.chatSocket.send(JSON.stringify({ stream: 'chat', payload: { message: message } }));
                chatInput.value = '';
            } else {
                alert('WebSocket не з\'єднаний!');
            }
        }
    }

    if (chatInput) {
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }

    if (sendChatBtn) {
        sendChatBtn.addEventListener('click', sendChatMessage);
    }

    document.getElementById('chat-box')?.addEventListener('scroll', function () {
        if (this.scrollTop < 50 && !state.isLoadingMessages && state.chatMessagesHasMore) {
            state.isLoadingMessages = true;
            loadMoreMessages();
        }
    });

    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            if (!state.currentContextUserId) return;
            const volume = e.target.value / 100;
            const audioElem = document.getElementById(`audio-${state.currentContextUserId}`);

            if (audioElem) {
                audioElem.volume = volume;
                state.audioVolumeMap[state.currentContextUserId] = volume;
                document.getElementById('volume-percent').textContent = e.target.value + '%';
            }
        });
    }

    const muteUserBtn = document.getElementById('mute-user-btn');
    if (muteUserBtn) {
        muteUserBtn.addEventListener('click', () => {
            if (!state.currentContextUserId) return;

            const audioElem = document.getElementById(`audio-${state.currentContextUserId}`);
            const volumeSlider = document.getElementById('volume-slider');
            const volumePercent = document.getElementById('volume-percent');
            const muteBtn = document.getElementById('mute-user-btn');

            if (!audioElem) return;

            const currentVolume = state.audioVolumeMap[state.currentContextUserId] ?? 1.0;

            if (currentVolume > 0) {
                // Мутимо: зберігаємо поточну гучність, щоб знати, куди повернутися
                state.volumeBeforeMute[state.currentContextUserId] = currentVolume;
                audioElem.volume = 0;
                state.audioVolumeMap[state.currentContextUserId] = 0;
                volumeSlider.value = 0;
                volumePercent.textContent = '0%';
                muteBtn.textContent = '🔇';
            } else {
                // Розмучуємо: відновлюємо з пам'яті або ставимо 100% (1.0), якщо пам'ять пуста
                const restoredVolume = state.volumeBeforeMute[state.currentContextUserId] || 1.0;

                audioElem.volume = restoredVolume;
                state.audioVolumeMap[state.currentContextUserId] = restoredVolume;
                volumeSlider.value = Math.round(restoredVolume * 100);
                volumePercent.textContent = Math.round(restoredVolume * 100) + '%';
                muteBtn.textContent = '🔊';

                // Чистимо пам'ять після розмуту
                delete state.volumeBeforeMute[state.currentContextUserId];
            }
        });
    }

    document.getElementById('close-context')?.addEventListener('click', hideVolumeContext);

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
        if (state.audioContext && state.audioContext.state === 'suspended') {
            state.audioContext.resume().then(() => {
                console.log('[Audio] AudioContext успішно розбуджено кліком!');
            }).catch(err => console.error('[Audio] Помилка розбудження:', err));
        }
    });
}
