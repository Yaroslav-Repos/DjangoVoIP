
import { initWebSocket } from './ws.js';
import { initializeEventListeners } from './ui.js';
import { checkAdminStatus, initAdminListeners } from './admin.js';
import { initScreenShareListeners } from './media.js';

document.addEventListener('DOMContentLoaded', () => {

    initializeEventListeners();


    initAdminListeners();


    checkAdminStatus();


    initScreenShareListeners();


    initWebSocket();
});