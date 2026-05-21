const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
const chatSocket = new WebSocket(`${wsProtocol}${window.location.host}/ws/room/${roomId}/`);

let localStream = null;
const peerConnections = {};
let rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };


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
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) { alert("Будь ласка, дозвольте доступ до мікрофона!"); }
}

chatSocket.onopen = async () => {
    await fetchIceServers();
    await initAudio();
    await loadChatHistory();
    sendSignaling('all', { type: 'ready-for-connections' }, null);
};


chatSocket.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    const { stream, payload } = data;

    if (stream === 'presence') {
        const userList = document.getElementById('user-list');
        if (payload.action === 'join') {
            if (!document.getElementById(`user-${payload.user_id}`)) {
                userList.innerHTML += `<li id="user-${payload.user_id}">${payload.username}</li>`;
            }
        } else if (payload.action === 'leave') {
            const li = document.getElementById(`user-${payload.user_id}`);
            if (li) li.remove();
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
        if (userItem) userItem.style.opacity = payload.state.isMuted ? '0.4' : '1.0';
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
    chatSocket.send(JSON.stringify({
        stream: 'signaling',
        payload: { target_user_id: targetUserId, sdp: sdp, ice: ice }
    }));
}

document.getElementById('chat-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && this.value.trim() !== '') {
        chatSocket.send(JSON.stringify({ stream: 'chat', payload: { message: this.value } }));
        this.value = '';
    }
});

let isMuted = false;
document.getElementById('mute-btn').addEventListener('click', function () {
    isMuted = !isMuted;
    if (localStream) localStream.getAudioTracks()[0].enabled = !isMuted;
    chatSocket.send(JSON.stringify({ stream: 'voice', payload: { isMuted: isMuted } }));
    this.innerText = isMuted ? "Увімкнути мікрофон" : "Вимкнути мікрофон";
});
