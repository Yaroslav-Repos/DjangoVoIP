
import { state } from './state.js';

export async function loadChatHistory() {
    try {
        const res = await fetch(`/api/rooms/${window.roomId}/messages/?page=1&page_size=50`);
        const data = await res.json();
        const chatBox = document.getElementById('chat-box');

        const messages = data.results ? data.results : (Array.isArray(data) ? data : []);

        state.chatMessagesPage = 1;
        state.chatMessagesHasMore = data.next || false;
        state.isLoadingMessages = false;

        if (messages.length > 0) {
            messages.reverse().forEach(msg => {
                chatBox.innerHTML += `<p><strong>${msg.user.username}:</strong> ${msg.text}</p>`;
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (e) { console.error("Помилка завантаження історії чату", e); }
}

export async function loadMoreMessages() {
    try {
        state.chatMessagesPage++;
        const res = await fetch(`/api/rooms/${window.roomId}/messages/?page=${state.chatMessagesPage}&page_size=50`);
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

        state.chatMessagesHasMore = data.next || false;
        state.isLoadingMessages = false;
    } catch (e) {
        console.error("Помилка завантаження старих повідомлень", e);
        state.isLoadingMessages = false;
    }
}
