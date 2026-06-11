
import { state } from './state.js';
import { formatDate } from './utils.js';

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

                const canDelete = (msg.user.username === window.currentUsername) || state.isAdmin;

                const date =  formatDate(msg.created_at);
                const msgHtml = `
    <div class="message-wrapper" id="msg-${msg.id}">
        <small>${date}</small> <strong>${msg.user.username}:</strong> ${msg.text}
        <div class="message-options">
            ${canDelete ? `<button class="delete-msg-btn" data-id="${msg.id}" title="Видалити повідомлення">🗑️</button>` : ''}
        </div>
    </div>`;
                chatBox.innerHTML += msgHtml;
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

                const canDelete = (msg.user.username === window.currentUsername) || state.isAdmin;

                const date = formatDate(msg.created_at);
                const newMsg = `
    <div class="message-wrapper" id="msg-${msg.id}">
        <small>${date}</small> <strong>${msg.user.username}:</strong> ${msg.text}
        <div class="message-options">
            ${canDelete ? `<button class="delete-msg-btn" data-id="${msg.id}" title="Видалити повідомлення">🗑️</button>` : ''}
        </div>
    </div>`;
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
