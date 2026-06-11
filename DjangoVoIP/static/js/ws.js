
import { state } from './state.js';
import { connectionStates, updateMyConnectionStatus, showLocalToast, formatDate } from './utils.js';
import { initAudio, connectLiveKit, detachRemoteTrack, addRemoteScreenShare } from './media.js';
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

            await loadChatHistory();

            updateMyConnectionStatus(connectionStates.CHECKING_MICROPHONE, 'Перевірка мікрофона...');
            showLocalToast('Перевірка мікрофона...', 'info');
            await initAudio();

            updateMyConnectionStatus(connectionStates.ESTABLISHING_RTC, 'Встановлення з\'єднання LiveKit...');
            showLocalToast('Встановлення медіа-з\'єднання...', 'info');
            await connectLiveKit();


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

        else if (stream === 'delete_message') {
            const msgElement = document.getElementById(`msg-${payload.message_id}`);
            if (msgElement) {
                msgElement.remove();
            }
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

                // Якщо LiveKit підключився раніше, ніж WebSocket намалював юзера,
                // публікація вже лежить у стейті, але кнопки в DOM ще немає. Малюємо її:
                if (state.remoteScreenPublications[payload.user_id]) {
                    const screenVideoPub = state.remoteScreenPublications[payload.user_id][LivekitClient.Track.Source.ScreenShare];
                    if (screenVideoPub) {
                        addRemoteScreenShare(screenVideoPub, payload.user_id);
                    }
                }
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

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        wrapper.id = `msg-${payload.message_id}`;

        const canDelete = (payload.sender === window.currentUsername) || state.isAdmin;

        const timeStr = formatDate(new Date());

        wrapper.innerHTML = `
    <small>${timeStr}</small> <strong>${payload.sender}:</strong> ${payload.message}
    <div class="message-options">
        ${canDelete ? `<button class="delete-msg-btn" data-id="${payload.message_id}" title="Видалити повідомлення">🗑️</button>` : ''}
    </div>
`;

        chatBox.appendChild(wrapper);
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

    document.getElementById('chat-box')?.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-msg-btn');
        if (deleteBtn) {
            const messageId = deleteBtn.getAttribute('data-id');

            if (messageId && confirm('Ви дійсно хочете видалити це повідомлення?')) {
                state.chatSocket.send(JSON.stringify({
                    'stream': 'delete_message',
                    'payload': {
                        'message_id': parseInt(messageId)
                    }
                }));
            }
        }
    });

}
