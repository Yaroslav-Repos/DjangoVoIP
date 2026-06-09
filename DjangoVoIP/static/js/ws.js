
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
        alert('Помилка з\'єднання WebSocket!');
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
            const userList = document.getElementById('user-list');
            if (payload.action === 'join') {
                if (!document.getElementById(`user-${payload.user_id}`)) {
                    state.connectedUsers[payload.user_id] = payload.username;
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
                delete state.connectedUsers[payload.user_id];
                detachRemoteTrack(payload.user_id);
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
    };
}
