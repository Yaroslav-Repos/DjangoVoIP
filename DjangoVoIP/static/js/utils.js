
export const connectionStates = {
    CONNECTING: 'connecting',
    INITIALIZING_AUDIO: 'initializing_audio',
    CHECKING_MICROPHONE: 'checking_microphone',
    ESTABLISHING_RTC: 'establishing_rtc',
    CONNECTED: 'connected',
    ERROR: 'error'
};

export function updateMyConnectionStatus(stateCode, message) {
    const myUserItem = document.getElementById(`user-${window.currentUserId}`);
    if (!myUserItem) return;

    myUserItem.style.position = 'relative';

    const oldBadge = myUserItem.querySelector('.my-connection-badge');
    if (oldBadge) oldBadge.remove();

    const badge = document.createElement('div');
    badge.className = 'my-connection-badge';

    const colors = {
        [connectionStates.CONNECTING]: '#faa61a',
        [connectionStates.INITIALIZING_AUDIO]: '#5865f2',
        [connectionStates.CHECKING_MICROPHONE]: '#5865f2',
        [connectionStates.ESTABLISHING_RTC]: '#5865f2',
        [connectionStates.CONNECTED]: '#43b581',
        [connectionStates.ERROR]: '#f04747'
    };

    const emoji = {
        [connectionStates.CONNECTING]: '🔄',
        [connectionStates.INITIALIZING_AUDIO]: '🎤',
        [connectionStates.CHECKING_MICROPHONE]: '🔊',
        [connectionStates.ESTABLISHING_RTC]: '📡',
        [connectionStates.CONNECTED]: '✅',
        [connectionStates.ERROR]: '❌'
    };

    badge.style.cssText = `
        position: absolute; bottom: -28px; left: 0; right: 0;
        background: ${colors[stateCode]}; color: white;
        padding: 6px 10px; border-radius: 4px; font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font-weight: 500; z-index: 10; animation: pulse-badge 1.5s infinite;
    `;

    badge.textContent = `${emoji[stateCode]} ${message}`;
    myUserItem.appendChild(badge);
}

export function showLocalToast(message, type = 'info') {
    let toastContainer = document.getElementById('local-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'local-toast-container';
        toastContainer.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            z-index: 9999; display: flex; flex-direction: column; gap: 10px;
        `;
        document.body.appendChild(toastContainer);

        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInToast { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes slideOutToast { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
            @keyframes pulse-badge { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        `;
        document.head.appendChild(style);
    }

    const toast = document.createElement('div');
    const colors = { 'info': '#5865f2', 'success': '#43b581', 'error': '#f04747' };
    const emoji = { 'info': '🔄', 'success': '✅', 'error': '❌' };

    toast.style.cssText = `
        background: #36393f; color: white; padding: 12px 16px;
        border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        font-size: 13px; min-width: 280px; animation: slideInToast 0.3s ease-out;
        border-left: 4px solid ${colors[type]};
    `;

    toast.textContent = `${emoji[type]} ${message}`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutToast 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


export function clearMyConnectionStatus() {
    setTimeout(() => {
        const myUserItem = document.getElementById(`user-${window.currentUserId}`);
        if (myUserItem) {
            const badge = myUserItem.querySelector('.my-connection-badge');
            if (badge) badge.remove();
        }
    }, 2000);
}


export function getCookie(name) {
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

export const formatDate = (dateInput) => {
    const d = new Date(dateInput);

    if (isNaN(d.getTime())) return '';

    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
