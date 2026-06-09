
import { state } from './state.js';
import { getCookie } from './utils.js';

export async function checkAdminStatus() {
    try {
        const response = await fetch(`/api/rooms/${window.roomId}/`);
        const room = await response.json();

        if (room.is_admin) {
            state.isAdmin = true;
            document.getElementById('admin-panel').style.display = 'block';
        }
    } catch (error) {
        console.error('Помилка завантаження інформації про кімнату:', error);
    }
}

export function initAdminListeners() {
    document.getElementById('change-password-btn')?.addEventListener('click', function () {
        openModal('password-modal');
        document.getElementById('new-password-input').focus();
    });

    document.getElementById('confirm-password-btn')?.addEventListener('click', async function () {
        const newPassword = document.getElementById('new-password-input').value;
        if (!newPassword) return alert('Введіть новий пароль');

        try {
            const response = await fetch(`/api/rooms/${window.roomId}/change-password/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
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
        } catch (error) { console.error('Помилка:', error); alert('Помилка при зміні пароля'); }
    });

    document.getElementById('generate-invite-btn')?.addEventListener('click', function () {
        openModal('invite-modal');
    });

    document.getElementById('generate-link-btn')?.addEventListener('click', async function () {
        const expiresHours = document.getElementById('expires-hours').value;
        try {
            const response = await fetch(`/api/rooms/${window.roomId}/generate-invite/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                body: JSON.stringify({ expires_hours: parseInt(expiresHours) })
            });

            if (response.ok) {
                const data = await response.json();
                const inviteLink = `${window.location.origin}/menu/?invite=${data.token}&room=${window.roomId}`;
                document.getElementById('invite-link-text').textContent = inviteLink;
                document.getElementById('invite-result').style.display = 'block';
            } else {
                const data = await response.json();
                alert('Помилка: ' + (data.detail || 'Не вдалося згенерувати посилання'));
            }
        } catch (error) { console.error('Помилка:', error); alert('Помилка при генеруванні посилання'); }
    });

    document.getElementById('copy-invite-btn')?.addEventListener('click', function () {
        const text = document.getElementById('invite-link-text').textContent;
        navigator.clipboard.writeText(text).then(() => alert('Посилання скопійовано в буфер обміну'));
    });

    document.getElementById('add-member-btn')?.addEventListener('click', function () {
        openModal('add-member-modal');
        document.getElementById('username-input').focus();
    });

    document.getElementById('confirm-add-member-btn')?.addEventListener('click', async function () {
        const username = document.getElementById('username-input').value.trim();
        if (!username) return alert('Введіть ім\'я користувача');

        try {
            const response = await fetch(`/api/rooms/${window.roomId}/add-member/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
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
        } catch (error) { console.error('Помилка:', error); alert('Помилка при додаванні користувача'); }
    });

    document.getElementById('remove-member-btn')?.addEventListener('click', async function () {
        const selectEl = document.getElementById('remove-username-input');
        selectEl.innerHTML = '<option value="">-- Завантаження --</option>';

        try {
            const response = await fetch(`/api/rooms/${window.roomId}/members/?page=1&page_size=100`);
            if (response.ok) {
                const data = await response.json();
                const members = data.results || [];
                selectEl.innerHTML = '<option value="">-- Виберіть користувача --</option>';

                members.forEach(member => {
                    if (member.username !== window.currentUsername) {
                        const option = document.createElement('option');
                        option.value = member.username;
                        option.textContent = `${member.username} (${member.role === 'admin' ? 'Адмін' : 'Член'})`;
                        selectEl.appendChild(option);
                    }
                });
            } else {
                selectEl.innerHTML = '<option value="">Помилка завантаження</option>';
            }
        } catch (error) { console.error('Помилка:', error); selectEl.innerHTML = '<option value="">Помилка завантаження</option>'; }

        openModal('remove-member-modal');
    });

    document.getElementById('confirm-remove-member-btn')?.addEventListener('click', async function () {
        const username = document.getElementById('remove-username-input').value;
        if (!username) return alert('Виберіть користувача');
        if (!confirm('Ви впевнені, що хочете видалити цього користувача?')) return;

        try {
            const response = await fetch(`/api/rooms/${window.roomId}/remove-member/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                body: JSON.stringify({ username: username })
            });

            if (response.ok) {
                const data = await response.json();
                alert(`${data.username} видалено з кімнати`);
                closeModal('remove-member-modal');
                location.reload();
            } else {
                const data = await response.json();
                alert('Помилка: ' + (data.detail || 'Не вдалося видалити користувача'));
            }
        } catch (error) { console.error('Помилка:', error); alert('Помилка при видаленні користувача'); }
    });

    document.getElementById('delete-room-btn')?.addEventListener('click', async function () {
        if (!confirm('Ви впевнені, що хочете видалити цю кімнату? Це дія незворотна.')) return;

        try {
            const response = await fetch(`/api/rooms/${window.roomId}/`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 204) {
                alert('Кімната видалена');
                window.location.href = '/menu/';
            } else {
                const data = await response.json();
                alert('Помилка: ' + (data.detail || 'Не вдалося видалити кімнату'));
            }
        } catch (error) { console.error('Помилка:', error); alert('Помилка при видаленні кімнати'); }
    });
}
