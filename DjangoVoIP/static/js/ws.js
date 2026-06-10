
import { state } from './state.js';
import { connectionStates, updateMyConnectionStatus, showLocalToast } from './utils.js';
import { initAudio, connectLiveKit, detachRemoteTrack } from './media.js';
import { loadChatHistory } from './chat.js';

export function initWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProtocol}${window.location.host}/ws/room/${window.roomId}/`;
    console.log('Connecting to WebSocket:', wsUrl);

    state.chatSocket = new WebSocket(wsUrl);

    state.chatSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateMyConnectionStatus(connectionStates.ERROR, 'Помилка з\'єднання');
        showLocalToast('Помилка з\'єднання WebSocket!', 'error');
    };

    state.chatSocket.onclose = () => {
        console.warn('WebSocket closed');
        updateMyConnectionStatus(connectionStates.ERROR, 'Відключено');
        showLocalToast('Відключено від серверу', 'error');
    };

    state.chatSocket.onopen = async () => {
        console.log('WebSocket connected');
        updateMyConnectionStatus(connectionStates.CONNECTING, 'Підключення...');
        showLocalToast('Підключення до серверу...', 'info');

        try {
            updateMyConnectionStatus(connectionStates.CHECKING_MICROPHONE, 'Перевірка мікрофона...');
            showLocalToast('Перевірка мікрофона...', 'info');
            await initAudio();

            updateMyConnectionStatus(connectionStates.ESTABLISHING_RTC, 'Встановлення з\'єднання LiveKit...');
            showLocalToast('Встановлення медіа-з\'єднання...', 'info');
            await connectLiveKit();

            await loadChatHistory();

            updateMyConnectionStatus(connectionStates.CONNECTED, 'Готово');
            showLocalToast('Готово до спілкування! ✅', 'success');

            setTimeout(() => {
                const myUserItem = document.getElementById(`user-${window.currentUserId}`);
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

    state.chatSocket.onmessage = async (e) => {
        const data = JSON.parse(e.data);
        const { stream, payload } = data;

        if (stream === 'presence') {
            handlePresence(payload);
        }
        else if (stream === 'chat') {
            handleChatMessage(payload);
        }
        else if (stream === 'voice') {
            updateUserVoiceUI(payload.user_id, payload.state);
        }
        else if (stream === 'voice_sync') {
            Object.entries(payload).forEach(([userId, s]) => updateUserVoiceUI(userId, s));
        }
    };

    
    function handlePresence(payload) {
        const userList = document.getElementById('user-list');
        if (payload.action === 'join') {
            if (!document.getElementById(`user-${payload.user_id}`)) {
                state.connectedUsers[payload.user_id] = payload.username;

                const li = document.createElement('li');
                li.className = 'user-item';
                li.id = `user-${payload.user_id}`;

                const avatar = document.createElement('div');
                avatar.className = 'user-avatar';
                avatar.textContent = payload.username.substring(0, 1).toUpperCase();

                const info = document.createElement('div');
                info.className = 'user-info';

                const name = document.createElement('span');
                name.className = 'username';
                name.textContent = payload.username; 

                const status = document.createElement('span');
                status.className = 'user-status';
                status.textContent = 'Онлайн';

                info.appendChild(name);
                info.appendChild(status);
                li.appendChild(avatar);
                li.appendChild(info);
                userList.appendChild(li);
            }
        } else if (payload.action === 'leave') {
            const li = document.getElementById(`user-${payload.user_id}`);
            if (li) li.remove();
            delete state.connectedUsers[payload.user_id];
            detachRemoteTrack(payload.user_id);
        }
    }

    function handleChatMessage(payload) {
        const chatBox = document.getElementById('chat-box');
        const p = document.createElement('p');

        const strong = document.createElement('strong');
        strong.textContent = `${payload.sender}: `; 

        const msg = document.createTextNode(payload.message); 

        p.appendChild(strong);
        p.appendChild(msg);
        chatBox.appendChild(p);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function updateUserVoiceUI(userId, state) {
        const userItem = document.getElementById(`user-${userId}`);
        if (userItem) {
            const statusSpan = userItem.querySelector('.user-status');
            if (statusSpan) {
                statusSpan.textContent = state.isMuted ? 'Мікрофон вимкнено' : 'Онлайн';
                statusSpan.classList.toggle('muted', state.isMuted);
            }
        }
    }

}
