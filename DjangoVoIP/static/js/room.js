const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const wsUrl = `${wsProtocol}${window.location.host}/ws/room/${roomId}/`;
console.log('Connecting to WebSocket:', wsUrl);

const chatSocket = new WebSocket(wsUrl);

let localStream = null;
const peerConnections = {};
let rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

chatSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    alert('Помилка з\'єднання WebSocket!');
};

chatSocket.onclose = () => {
    console.warn('WebSocket closed');
};

async function fetchIceServers() {
    try {
        const res = await fetch('/api/turn-credentials/');
        if (res.ok) {
            const data = await res.json();
            rtcConfig = data;
        }
    } catch (e) { 
        console.error("Не вдалося завантажити TURN токени, працює дефолтний STUN", e); 
    }
}


async function loadChatHistory() {
    try {
        const res = await fetch(`/api/rooms/${roomId}/messages/`);
        const data = await res.json();
        const chatBox = document.getElementById('chat-box');

        // Handle both paginated and non-paginated responses
        const messages = data.results ? data.results : (Array.isArray(data) ? data : []);

        if (messages.length > 0) {
            messages.reverse().forEach(msg => {
                chatBox.innerHTML += `<p><strong>${msg.user.username}:</strong> ${msg.text}</p>`;
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (e) { console.error("Помилка завантаження історії чату", e); }
}

async function initAudio() {
    try {
        console.log('Requesting microphone access...');
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.log('Microphone access granted');

        // Log audio tracks
        const audioTracks = localStream.getAudioTracks();
        console.log('Audio tracks:', audioTracks.length);
        audioTracks.forEach(track => {
            console.log('Track:', track.label, 'enabled:', track.enabled);
        });

    } catch (err) { 
        console.error('Microphone error:', err);
        alert("Будь ласка, дозвольте доступ до мікрофона!"); 
    }
}

chatSocket.onopen = async () => {
    console.log('WebSocket connected');
    await fetchIceServers();
    await initAudio();
    await loadChatHistory();
    // Wait for socket to be ready before sending
    if (chatSocket.readyState === WebSocket.OPEN) {
        sendSignaling('all', { type: 'ready-for-connections' }, null);
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
                statusSpan.textContent = payload.state.isMuted ? 'Микрофон вимкнено' : 'Онлайн';
                statusSpan.classList.toggle('muted', payload.state.isMuted);
            }
        }
    }
    else if (stream === 'signaling') {
        const senderId = payload.sender_id;

        if (payload.sdp) {
            if (payload.sdp.type === 'offer') {
                    const pc = createPeerConnection(senderId);
                    await pc.setRemoteDescription(payload.sdp);
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    sendSignaling(senderId, pc.localDescription, null);
                } else if (payload.sdp.type === 'answer') {
                    const pc = peerConnections[senderId];
                    if (pc) await pc.setRemoteDescription(payload.sdp);
            } else if (payload.sdp.type === 'ready-for-connections') {
                const pc = createPeerConnection(senderId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendSignaling(senderId, pc.localDescription, null);
            }
        } else if (payload.ice) {
            const pc = peerConnections[senderId];
            if (pc) await pc.addIceCandidate(payload.ice);
        }
    }
};

function createPeerConnection(targetUserId) {
    if (peerConnections[targetUserId]) return peerConnections[targetUserId];

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[targetUserId] = pc;

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) sendSignaling(targetUserId, null, event.candidate);
    };

    pc.ontrack = (event) => {
        let audioElem = document.getElementById(`audio-${targetUserId}`);
        if (!audioElem) {
            audioElem = document.createElement('audio');
            audioElem.id = `audio-${targetUserId}`;
            audioElem.autoplay = true;
            document.getElementById('remote-audios').appendChild(audioElem);
        }
        audioElem.srcObject = event.streams[0];
    };

    return pc;
}

function sendSignaling(targetUserId, sdp, ice) {
    if (chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({
            stream: 'signaling',
            payload: { target_user_id: targetUserId, sdp: sdp, ice: ice }
        }));
    } else {
        console.warn('WebSocket not open, cannot send signaling');
    }
}

document.getElementById('chat-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && this.value.trim() !== '') {
        if (chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(JSON.stringify({ stream: 'chat', payload: { message: this.value } }));
            this.value = '';
        } else {
            alert('WebSocket не з\'єднаний!');
        }
    }
});

let isMuted = false;
document.getElementById('mute-btn').addEventListener('click', function () {
    isMuted = !isMuted;
    if (localStream) localStream.getAudioTracks()[0].enabled = !isMuted;
    chatSocket.send(JSON.stringify({ stream: 'voice', payload: { isMuted: isMuted } }));
    this.innerText = isMuted ? "Увімкнути мікрофон" : "Вимкнути мікрофон";
});

// Leave room functionality
async function leaveRoom() {
    if (!confirm('Ви впевнені, що хочете покинути кімнату?')) {
        return;
    }

    try {
        const response = await fetch(`/api/rooms/${roomId}/leave/`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            }
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

// ===== ADMIN PANEL FUNCTIONS =====

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

// Check if current user is admin and load room info
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


document.getElementById('change-password-btn')?.addEventListener('click', function() {
    openModal('password-modal');
    document.getElementById('new-password-input').focus();
});

document.getElementById('confirm-password-btn')?.addEventListener('click', async function() {
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


document.getElementById('generate-invite-btn')?.addEventListener('click', function() {
    openModal('invite-modal');
});

document.getElementById('generate-link-btn')?.addEventListener('click', async function() {
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

document.getElementById('copy-invite-btn')?.addEventListener('click', function() {
    const text = document.getElementById('invite-link-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('Посилання скопійовано в буфер обміну');
    });
});


document.getElementById('add-member-btn')?.addEventListener('click', function() {
    openModal('add-member-modal');
    document.getElementById('username-input').focus();
});

document.getElementById('confirm-add-member-btn')?.addEventListener('click', async function() {
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

// Remove member functionality
document.getElementById('remove-member-btn')?.addEventListener('click', function() {
    const selectEl = document.getElementById('remove-username-input');
    selectEl.innerHTML = '<option value="">-- Виберіть користувача --</option>';

    // Populate with connected users (except current user)
    Object.entries(connectedUsers).forEach(([userId, username]) => {
        if (userId != currentUserId) {
            const option = document.createElement('option');
            option.value = userId;
            option.textContent = username;
            selectEl.appendChild(option);
        }
    });

    openModal('remove-member-modal');
});

document.getElementById('confirm-remove-member-btn')?.addEventListener('click', async function() {
    const userId = document.getElementById('remove-username-input').value;

    if (!userId) {
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
            body: JSON.stringify({ user_id: parseInt(userId) })
        });

        if (response.ok) {
            const data = await response.json();
            alert(`${data.username} видалено з кімнати`);
            closeModal('remove-member-modal');
            // Refresh user list
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

// Delete room
document.getElementById('delete-room-btn')?.addEventListener('click', async function() {
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

// Initialize admin panel when page loads
document.addEventListener('DOMContentLoaded', checkAdminStatus);
