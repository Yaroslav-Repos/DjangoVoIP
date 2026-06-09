
import { initWebSocket } from './ws.js';
import { initializeEventListeners } from './ui.js';
import { checkAdminStatus, initAdminListeners } from './admin.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Ініціалізуємо слухачі UI подій
    initializeEventListeners();

    // 2. Ініціалізуємо слухачі адмін-панелі
    initAdminListeners();

    // 3. Перевіряємо права адміністратора
    checkAdminStatus();

    // 4. Запускаємо WebSocket (який, у свою чергу, запустить LiveKit та завантажить чат)
    initWebSocket();
});
