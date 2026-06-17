import { state } from './state.js';

const MAX_CAMERAS = 9;

export async function startCameraWithPreview() {

    if (state.localCameraPublication) {
        stopLocalCamera();
        return;
    }

    try {
        console.log('[Camera] Запит доступу до камери...');

        state.localCameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        });


        const modal = document.getElementById('camera-preview-modal');
        const videoElem = document.getElementById('preview-video-element');

        if (modal && videoElem) {
            videoElem.srcObject = state.localCameraStream;
            modal.classList.add('active');
        }
    } catch (error) {
        console.error('[Camera] Помилка доступу:', error);
        alert('Не вдалося отримати доступ до камери. Перевірте дозволи браузера.');
    }
}

export async function publishLocalCamera() {
    if (!state.localCameraStream || !state.livekitRoom) return;

    const videoTrack = state.localCameraStream.getVideoTracks()[0];

    try {
        document.getElementById('confirm-camera-btn').innerText = 'Підключення...';
        document.getElementById('confirm-camera-btn').disabled = true;

        // Публікуємо трек
        state.localCameraPublication = await state.livekitRoom.localParticipant.publishTrack(videoTrack, {
            name: 'camera',
            source: LivekitClient.Track.Source.Camera,
            simulcast: true // Важливо для динамічної сітки!
        });

        console.log('[Camera] Трансляція успішно розпочата');

        closeCameraPreviewModal();

        const btn = document.getElementById('toggle-my-camera-btn');
        if (btn) {
            btn.innerText = "🛑 Вимкнути камеру";
            btn.style.background = "#f04747";
        }

        // Якщо Галерея зараз відкрита — перераховуємо сітку, щоб відобразити себе
        if (state.isCameraGalleryOpen) {
            recalculateVisibleCameras();
        }

    } catch (error) {
        console.error('[Camera] Помилка публікації:', error);
        alert('Помилка трансляції. Спробуйте ще раз.');
    } finally {
        document.getElementById('confirm-camera-btn').innerText = 'Почати трансляцію';
        document.getElementById('confirm-camera-btn').disabled = false;
    }
}

export async function stopLocalCamera() {
    if (!state.livekitRoom) return;

    if (state.localCameraPublication) {
        await state.livekitRoom.localParticipant.unpublishTrack(state.localCameraPublication.track);
        state.localCameraPublication = null;
    }

    if (state.localCameraStream) {
        state.localCameraStream.getTracks().forEach(t => t.stop()); // Вимикаємо індикатор камери в браузері
        state.localCameraStream = null;
    }

    // ОновлюємоUI
    const btn = document.getElementById('toggle-my-camera-btn');
    if (btn) {
        btn.innerText = "📷 Увімкнути мою камеру";
        btn.style.background = "#5865f2";
    }

    if (state.isCameraGalleryOpen) {
        recalculateVisibleCameras(); // Прибираємо себе з сітки
    }
    console.log('[Camera] Трансляція зупинена');
}


export function closeCameraPreviewModal() {
    // Якщо потік був запрошений, але ще не опублікований — гасимо камеру
    if (state.localCameraStream && !state.localCameraPublication) {
        state.localCameraStream.getTracks().forEach(t => t.stop());
        state.localCameraStream = null;
    }

    const videoElem = document.getElementById('preview-video-element');
    if (videoElem) videoElem.srcObject = null;

    const modal = document.getElementById('camera-preview-modal');
    if (modal) modal.classList.remove('active');
}

export function openCameraGallery() {
    if (state.isCameraGalleryOpen) return;
    state.isCameraGalleryOpen = true;

    const btn = document.getElementById('camera-gallery-btn');
    if (btn) {
        btn.innerText = "❌ Закрити камери";
        btn.style.background = "#f04747"; // Червоний колір
    }

    // Створюємо контейнер вікна 
    const container = document.createElement('div');
    container.id = 'camera-gallery-window';
    container.className = 'floating-window camera-gallery-active';
    container.innerHTML = `
        <div class="window-header">
            <span>📹 Веб-камера</span>
            <button id="close-camera-gallery-btn">❌</button>
        </div>
        <div class="camera-grid" id="camera-grid-container"></div>
    `;
    document.body.appendChild(container);
    state.cameraGalleryWindow = container;

    document.getElementById('close-camera-gallery-btn').addEventListener('click', closeCameraGallery);

    recalculateVisibleCameras();
}

export function closeCameraGallery() {
    if (!state.isCameraGalleryOpen) return;
    state.isCameraGalleryOpen = false;

    const btn = document.getElementById('camera-gallery-btn');
    if (btn) {
        btn.innerText = "📹 Веб-камери";
        btn.style.background = "#23a55a"; // Зелений колір
    }

    if (state.livekitRoom) {
        state.livekitRoom.remoteParticipants.forEach(participant => {

            if (participant.trackPublications) {
                participant.trackPublications.forEach(pub => {
                    if (pub.source === 'camera' && pub.isSubscribed) {
                        pub.setSubscribed(false);
                    }
                });
            }
        });
    }

    const container = document.getElementById('camera-grid-container');
    if (container) {
        container.querySelectorAll('video').forEach(video => {
            video.srcObject = null;
        });
    }

    // Видаляємо вікно з DOM
    if (state.cameraGalleryWindow) {
        state.cameraGalleryWindow.remove();
        state.cameraGalleryWindow = null;
    }
}

export function recalculateVisibleCameras() {
    if (!state.isCameraGalleryOpen || !state.livekitRoom) return;

    const room = state.livekitRoom;
    const allParticipantsWithCamera = [];

    // Перевіряємо локального юзера (якщо його камера ввімкнена)
    const localPub = room.localParticipant.getTrackPublication('camera');
    if (localPub && localPub.track) {
        allParticipantsWithCamera.push({
            identity: room.localParticipant.identity,
            participant: room.localParticipant,
            isLocal: true,
            track: localPub.track
        });
    }

    // Збираємо всіх віддалених користувачів, у яких в принципі опублікована камера
    room.remoteParticipants.forEach(p => {
        const pub = p.getTrackPublication('camera');
        if (pub) { // Камера опублікована (неважливо, чи підписані ми зараз)
            allParticipantsWithCamera.push({
                identity: p.identity,
                participant: p,
                isLocal: false,
                publication: pub,
                track: pub.track // може бути null, якщо ще не підписані
            });
        }
    });

    // СОРТУВАННЯ: Пріоритет тим, хто зараз говорить
    // state.activeSpeakers містить identity активних мовців у порядку гучності
    allParticipantsWithCamera.sort((a, b) => {
        const idxA = state.activeSpeakers.indexOf(a.identity);
        const idxB = state.activeSpeakers.indexOf(b.identity);

        const isASpeaking = idxA !== -1;
        const isBSpeaking = idxB !== -1;

        if (isASpeaking && !isBSpeaking) return -1; // А йде вперед
        if (!isASpeaking && isBSpeaking) return 1;  // Б йде вперед
        if (isASpeaking && isBSpeaking) return idxA - idxB; // Хто голосніше — той вище

        return 0; // Якщо ніхто не говорить, залишаємо як є
    });

    const top9 = allParticipantsWithCamera.slice(0, MAX_CAMERAS);
    const top9Identities = top9.map(p => p.identity);

    // Керуємо підписками LiveKit (Вмикаємо потрібні, вимикаємо зайві)
    room.remoteParticipants.forEach(p => {
        const pub = p.getTrackPublication('camera');
        if (pub) {
            const shouldBeVisible = top9Identities.includes(p.identity);

            if (shouldBeVisible && !pub.isSubscribed) {
                pub.setSubscribed(true); // Запит потоку у LiveKit
            } else if (!shouldBeVisible && pub.isSubscribed) {
                pub.setSubscribed(false); // Стоп потік
                removeCameraFromUI(p.identity);
            }
        }
    });

    renderGridElements(top9);
}

function renderGridElements(visibleParticipants) {
    const gridContainer = document.getElementById('camera-grid-container');
    if (!gridContainer) return;

    // Створюємо карту існуючих DOM-вузлів
    const currentNodes = {};
    gridContainer.querySelectorAll('.camera-item').forEach(node => {
        currentNodes[node.dataset.identity] = node;
    });

    // Очищаємо контейнер 
    gridContainer.innerHTML = '';

    visibleParticipants.forEach(p => {
        let card = currentNodes[p.identity];

        // Якщо картки для цього користувача ще немає — створюємо
        if (!card) {
            card = document.createElement('div');
            card.className = 'camera-item';
            card.dataset.identity = p.identity;
            card.innerHTML = `
                <div class="camera-video-wrapper"></div>
                <div class="camera-user-name">${p.isLocal ? 'Ви' : p.participant.name}</div>
            `;
        }

        // Перевіряємо підсвітку розмови
        if (state.activeSpeakers.includes(p.identity)) {
            card.classList.add('speaking');
        } else {
            card.classList.remove('speaking');
        }

        gridContainer.appendChild(card);

        // Якщо трек вже підписаний/доступний — монтуємо його у відео-враппер
        if (p.track) {
            const wrapper = card.querySelector('.camera-video-wrapper');
            if (wrapper && wrapper.children.length === 0) {
                const videoElem = p.track.attach();
                videoElem.style.width = '100%';
                videoElem.style.height = '100%';
                videoElem.style.objectFit = 'cover';
                if (p.isLocal) videoElem.style.transform = 'scaleX(-1)'; // Дзеркало для себе
                wrapper.appendChild(videoElem);
            }
        }
    });
}

function removeCameraFromUI(identity) {
    const card = document.querySelector(`.camera-item[data-identity="${identity}"]`);
    if (card) {
        // Відкріплюємо трек відео перед видаленням
        const video = card.querySelector('video');
        if (video) video.remove();
        card.remove();
    }
}

export function updateSpeakerHighlights() {
    if (!state.isCameraGalleryOpen) return;

    document.querySelectorAll('.camera-item').forEach(card => {
        const identity = card.dataset.identity;
        if (state.activeSpeakers.includes(identity)) {
            card.classList.add('speaking');
        } else {
            card.classList.remove('speaking');
        }
    });
}