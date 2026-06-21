function apiUrl(path) {
    return path;
}

const socket = io(undefined, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 500
});

const form = document.getElementById('form-container');
const input = document.getElementById('message-input');
const chatContainer = document.getElementById('chat-container');
const roomSelect = document.getElementById('room-select');
const createRoomBtn = document.getElementById('create-room-btn');
const deleteRoomBtn = document.getElementById('delete-room-btn');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const sendButton = form.querySelector('button[type="submit"]');
const whisperBtn = document.getElementById('whisper-btn');
const sendFileBtn = document.getElementById('send-file-btn');
const fileInput = document.getElementById('file-input');
const notificationBadge = document.getElementById('notification-badge');
const headerTitle = document.querySelector('header .title');
const showRegisterBtn = document.getElementById('show-register-btn');
const showLoginBtn = document.getElementById('show-login-btn');
const recordBtn = document.getElementById('record-btn');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingTime = document.getElementById('recording-time');

let miNombre = '';
const defaultRoom = 'General';
let currentRoom = '';
let roomMessages = { General: [] };
let currentSearch = '';
let unseenCount = 0;
let isWindowFocused = true;
const titleBase = document.title;
const whisperDurations = [0, 10, 20, 30];
const quickReactions = ['🔥', '😂', '💡', '💖'];

// Audio recording state
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingStartTime = 0;
let recordingTimerInterval = null;
let whisperSeconds = 0;
const whisperTimers = new Map();

function updateHeaderRoom() {
    if (headerTitle) {
        headerTitle.textContent = `Sala: ${currentRoom}`;
    }
}

function openRegisterModal() {
    Swal.fire({
        title: 'Crear cuenta',
        html: `
            <div style="display:grid; gap:10px; text-align:left;">
                <input id="swal-register-name" class="swal2-input" type="text" placeholder="Nombre" />
                <input id="swal-register-email" class="swal2-input" type="email" placeholder="Correo" />
                <input id="swal-register-password" class="swal2-input" type="password" placeholder="Contraseña" />
                <small style="color: var(--text-muted); font-size: 0.8rem; text-align: left; line-height: 1.4;">
                    📋 La contraseña debe tener:<br/>
                    • Mínimo 6 caracteres<br/>
                    • Letras y números
                </small>
            </div>
        `,
        confirmButtonText: 'Registrarse',
        showCancelButton: true,
        focusConfirm: false,
        preConfirm: () => {
            const name = document.getElementById('swal-register-name')?.value || '';
            const email = document.getElementById('swal-register-email')?.value || '';
            const password = document.getElementById('swal-register-password')?.value || '';

            if (!name.trim() || !email.trim() || !password) {
                Swal.showValidationMessage('Completa todos los campos para registrarte.');
                return false;
            }

            return { name: name.trim(), email: email.trim().toLowerCase(), password };
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            registerUser(result.value);
        }
    });
}

function openLoginModal() {
    Swal.fire({
        title: 'Iniciar sesión',
        html: `
            <div style="display:grid; gap:10px; text-align:left;">
                <input id="swal-login-email" class="swal2-input" type="email" placeholder="Correo" />
                <input id="swal-login-password" class="swal2-input" type="password" placeholder="Contraseña" />
            </div>
        `,
        confirmButtonText: 'Entrar',
        showCancelButton: true,
        focusConfirm: false,
        preConfirm: () => {
            const email = document.getElementById('swal-login-email')?.value || '';
            const password = document.getElementById('swal-login-password')?.value || '';

            if (!email.trim() || !password) {
                Swal.showValidationMessage('Ingresa tu correo y contraseña para entrar.');
                return false;
            }

            return { email: email.trim().toLowerCase(), password };
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            loginUser(result.value);
        }
    });
}

if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', openRegisterModal);
}

if (showLoginBtn) {
    showLoginBtn.addEventListener('click', openLoginModal);
}

input.disabled = true;
sendButton.disabled = true;
if (emojiBtn) emojiBtn.disabled = true;
if (sendFileBtn) sendFileBtn.disabled = true;
if (recordBtn) recordBtn.disabled = true;
if (roomSelect) roomSelect.disabled = true;
if (createRoomBtn) createRoomBtn.disabled = true;
if (deleteRoomBtn) deleteRoomBtn.disabled = true;

function updateNotificationDisplay() {
    if (!notificationBadge) return;
    if (unseenCount > 0) {
        notificationBadge.textContent = unseenCount;
        notificationBadge.classList.add('visible');
        document.title = `(${unseenCount}) ${titleBase}`;
    } else {
        notificationBadge.textContent = '0';
        notificationBadge.classList.remove('visible');
        document.title = titleBase;
    }
}

function resetNotifications() {
    unseenCount = 0;
    updateNotificationDisplay();
}

function setWhisperMode(seconds) {
    whisperSeconds = seconds;
    if (!whisperBtn) return;
    whisperBtn.textContent = seconds > 0 ? `Susurro ${seconds}s` : 'Normal';
    whisperBtn.classList.toggle('is-whisper', seconds > 0);
}

function cycleWhisperMode() {
    const currentIndex = whisperDurations.indexOf(whisperSeconds);
    const next = whisperDurations[(currentIndex + 1) % whisperDurations.length];
    setWhisperMode(next);
}

function scheduleWhisperRemoval(item) {
    if (!item?.id || !item.expiresAt) return;
    const remaining = item.expiresAt - Date.now();
    if (remaining <= 0) {
        removeMessageById(item.room, item.id);
        return;
    }
    const timeout = setTimeout(() => {
        removeMessageById(item.room, item.id);
        whisperTimers.delete(item.id);
    }, remaining);
    whisperTimers.set(item.id, timeout);
}

function removeMessageById(room, id) {
    if (!roomMessages[room]) return;
    roomMessages[room] = roomMessages[room].filter((entry) => entry.id !== id);
    if (room === currentRoom) renderHistory();
}

function addReactionButtons(item, container) {
    if (item.usuario !== miNombre || !item.id) return;
    const wrap = document.createElement('div');
    wrap.className = 'quick-reactions';

    quickReactions.forEach((emoji) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quick-reaction-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            socket.emit('message-reaction', {
                room: item.room || currentRoom,
                messageId: item.id,
                emoji
            });
        });
        wrap.appendChild(btn);
    });

    container.appendChild(wrap);
}

function renderPoll(item, container) {
    const pollWrap = document.createElement('div');
    pollWrap.className = 'poll-box';

    const title = document.createElement('div');
    title.className = 'poll-question';
    title.textContent = item.poll?.question || 'Encuesta';
    pollWrap.appendChild(title);

    (item.poll?.options || []).forEach((option, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'poll-option';
        const votes = Number((item.poll?.votes && item.poll.votes[index]) || 0);
        row.textContent = `${option} (${votes})`;
        row.addEventListener('click', () => {
            socket.emit('poll-vote', {
                room: item.room || currentRoom,
                messageId: item.id,
                optionIndex: index
            });
        });
        pollWrap.appendChild(row);
    });

    container.appendChild(pollWrap);
}

function addReactionSummary(item, container) {
    const entries = Object.entries(item.reactions || {}).filter(([, count]) => Number(count) > 0);
    if (entries.length === 0) return;
    const summary = document.createElement('div');
    summary.className = 'reaction-summary';
    summary.textContent = entries.map(([emoji, count]) => `${emoji} ${count}`).join('  ');
    container.appendChild(summary);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];
        isRecording = true;
        recordingStartTime = Date.now();

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            isRecording = false;
            clearInterval(recordingTimerInterval);
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                sendAudio(dataUrl);
            };
            reader.readAsDataURL(audioBlob);
            
            stream.getTracks().forEach(track => track.stop());
            updateRecordingUI();
        };

        mediaRecorder.start();
        updateRecordingUI();
        startRecordingTimer();
    } catch (error) {
        Swal.fire('Error', 'No se pudo acceder al micrófono. ' + error.message, 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
    }
}

function startRecordingTimer() {
    recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 100);
}

function updateRecordingUI() {
    if (isRecording) {
        recordingIndicator.classList.remove('hidden');
        recordBtn.textContent = '⏹️';
        input.disabled = true;
        sendButton.disabled = true;
        if (emojiBtn) emojiBtn.disabled = true;
        if (sendFileBtn) sendFileBtn.disabled = true;
    } else {
        recordingIndicator.classList.add('hidden');
        recordBtn.textContent = '🎙️';
        recordingTime.textContent = '0:00';
        if (miNombre) {
            input.disabled = false;
            sendButton.disabled = false;
            if (emojiBtn) emojiBtn.disabled = false;
            if (sendFileBtn) sendFileBtn.disabled = false;
        }
    }
}

function sendAudio(dataUrl) {
    if (!miNombre) {
        Swal.fire('Error', 'Debes ingresar un nombre antes de enviar audios.', 'warning');
        return;
    }
    const payload = { room: currentRoom, dataUrl, playbackRate: 1 };
    socket.emit('mensaje-audio', payload, (status) => {
        if (status !== 'ok') console.error('Audio upload failed', status);
    });
}

function matchesSearch(item, query) {
    if (!query) return true;
    const normalized = query.toLowerCase();
    if (item.usuario && item.usuario.toLowerCase().includes(normalized)) return true;
    if (item.mensaje && item.mensaje.toLowerCase().includes(normalized)) return true;
    if (item.type === 'imagen' && item.name && item.name.toLowerCase().includes(normalized)) return true;
    if (item.type === 'audio' && item.name && item.name.toLowerCase().includes(normalized)) return true;
    if (item.type === 'system' && item.mensaje && item.mensaje.toLowerCase().includes(normalized)) return true;
    if (item.type === 'poll' && item.poll?.question?.toLowerCase().includes(normalized)) return true;
    return false;
}

function createMessageElement(item) {
    const div = document.createElement('div');
    div.classList.add('mensaje');
    if (item.usuario === miNombre && item.type !== 'system') {
        div.classList.add('propio');
    }

    if (item.type === 'system') {
        div.classList.add('sistema');
        div.textContent = item.mensaje;
        return div;
    }

    const autor = document.createElement('span');
    autor.className = 'autor';
    autor.textContent = item.usuario;

    const hora = document.createElement('span');
    hora.className = 'hora';
    hora.textContent = item.hora;

    div.appendChild(autor);

    if (item.type === 'texto') {
        const texto = document.createElement('div');
        texto.className = 'texto';
        texto.textContent = item.mensaje;
        div.appendChild(texto);
        if (item.whisperSeconds > 0 && item.expiresAt) {
            const whisperTag = document.createElement('div');
            whisperTag.className = 'whisper-tag';
            whisperTag.textContent = `Se borra en ${item.whisperSeconds}s`;
            div.appendChild(whisperTag);
        }
        addReactionButtons(item, div);
        addReactionSummary(item, div);
    } else if (item.type === 'imagen') {
        const imagen = document.createElement('div');
        imagen.className = 'imagen-mensaje';
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = item.name || 'Imagen enviada';
        imagen.appendChild(img);
        div.appendChild(imagen);
        addReactionButtons(item, div);
        addReactionSummary(item, div);
    } else if (item.type === 'audio') {
        const audioContainer = document.createElement('div');
        audioContainer.className = 'audio-mensaje';
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = item.dataUrl;
        audio.style.maxWidth = '100%';
        audio.playbackRate = Number(item.playbackRate || 1);
        audioContainer.appendChild(audio);

        const speeds = document.createElement('div');
        speeds.className = 'audio-speeds';
        [1, 1.5, 2].forEach((speed) => {
            const speedBtn = document.createElement('button');
            speedBtn.type = 'button';
            speedBtn.className = 'audio-speed-btn';
            speedBtn.textContent = `${speed}x`;
            speedBtn.addEventListener('click', () => {
                audio.playbackRate = speed;
                Array.from(speeds.children).forEach((btn) => btn.classList.remove('active'));
                speedBtn.classList.add('active');
            });
            if (speed === Number(item.playbackRate || 1)) {
                speedBtn.classList.add('active');
            }
            speeds.appendChild(speedBtn);
        });
        audioContainer.appendChild(speeds);
        div.appendChild(audioContainer);
        addReactionButtons(item, div);
        addReactionSummary(item, div);
    } else if (item.type === 'poll') {
        renderPoll(item, div);
    }

    div.appendChild(hora);
    return div;
}

function renderHistory() {
    const query = currentSearch.trim().toLowerCase();
    chatContainer.innerHTML = '';
    const history = roomMessages[currentRoom] || [];
    const filtered = history.filter(item => matchesSearch(item, query));

    if (query && filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mensaje sistema';
        empty.textContent = 'No se encontraron mensajes que coincidan con la búsqueda.';
        chatContainer.appendChild(empty);
        return;
    }

    filtered.forEach(item => {
        chatContainer.appendChild(createMessageElement(item));
    });

    if (!query) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function addHistory(entry) {
    const room = entry.room || 'General';
    if (!roomMessages[room]) roomMessages[room] = [];
    roomMessages[room].push(entry);
    if (room === currentRoom) renderHistory();
}

function joinRoom(room) {
    if (!room || room === currentRoom) return;
    currentRoom = room;
    if (roomSelect) roomSelect.value = room;
    updateHeaderRoom();
    socket.emit('joinRoom', room);
    renderHistory();
}

function addRoomIfNeeded(room) {
    if (!roomSelect) return;
    const exists = Array.from(roomSelect.options).some(option => option.value === room);
    if (!exists) {
        const option = document.createElement('option');
        option.value = room;
        option.textContent = room;
        roomSelect.appendChild(option);
    }
}

function renderRoomOptions(rooms = []) {
    if (!roomSelect) return;
    const previous = currentRoom || roomSelect.value || defaultRoom;
    roomSelect.innerHTML = '';

    rooms.forEach((room) => {
        const option = document.createElement('option');
        option.value = room;
        option.textContent = room;
        roomSelect.appendChild(option);
        if (!roomMessages[room]) roomMessages[room] = [];
    });

    const nextRoom = rooms.includes(previous) ? previous : defaultRoom;
    if (rooms.includes(nextRoom)) {
        roomSelect.value = nextRoom;
        if (currentRoom && currentRoom !== nextRoom) {
            currentRoom = nextRoom;
            updateHeaderRoom();
            renderHistory();
        }
    }
}

async function requestRoomCode(title) {
    const result = await Swal.fire({
        title,
        html: `
            <div style="display:grid; gap:8px; text-align:left;">
                <input id="swal-room-code" class="swal2-input" type="password" placeholder="Codigo" maxlength="4" />
                <small style="color:#6b7280;">Codigo requerido para confirmar.</small>
            </div>
        `,
        confirmButtonText: 'Confirmar',
        showCancelButton: true,
        focusConfirm: false,
        preConfirm: () => {
            const code = document.getElementById('swal-room-code')?.value || '';
            if (!code.trim()) {
                Swal.showValidationMessage('Ingresa el codigo.');
                return false;
            }
            return code.trim();
        }
    });

    if (!result.isConfirmed) return null;
    return result.value;
}

async function createRoomFlow() {
    const roomResult = await Swal.fire({
        title: 'Crear sala',
        input: 'text',
        inputLabel: 'Nombre de sala',
        inputPlaceholder: 'Ejemplo: Musica',
        showCancelButton: true,
        inputValidator: (value) => {
            const cleaned = String(value || '').trim();
            if (!cleaned) return 'Ingresa un nombre.';
            if (cleaned.length < 2) return 'La sala debe tener al menos 2 caracteres.';
            return null;
        }
    });

    if (!roomResult.isConfirmed) return;
    const roomName = String(roomResult.value || '').trim();
    const code = await requestRoomCode('Confirmar creacion');
    if (!code) return;

    socket.emit('room-create', { name: roomName, code }, (response) => {
        if (!response?.ok) {
            Swal.fire('No se pudo crear', response?.error || 'Error desconocido.', 'error');
            return;
        }
        joinRoom(response.room || roomName);
    });
}

async function deleteRoomFlow() {
    if (!currentRoom || currentRoom === defaultRoom) {
        Swal.fire('Accion no permitida', 'La sala General no se puede borrar.', 'info');
        return;
    }

    const confirm = await Swal.fire({
        title: `Borrar sala ${currentRoom}?`,
        text: 'Los usuarios en esa sala volveran a General.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Continuar'
    });
    if (!confirm.isConfirmed) return;

    const code = await requestRoomCode('Confirmar borrado');
    if (!code) return;

    socket.emit('room-delete', { room: currentRoom, code }, (response) => {
        if (!response?.ok) {
            Swal.fire('No se pudo borrar', response?.error || 'Error desconocido.', 'error');
            return;
        }
        joinRoom(response.fallbackRoom || defaultRoom);
    });
}

function playSound(type) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'system') {
            osc.frequency.value = 520;
            gain.gain.value = 0.12;
        } else if (type === 'message') {
            osc.frequency.value = 760;
            gain.gain.value = 0.1;
        } else {
            osc.frequency.value = 440;
            gain.gain.value = 0.1;
        }

        const now = ctx.currentTime;
        osc.start(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.stop(now + 0.18);
    } catch (err) {
        console.warn('Sound notification unavailable', err);
    }
}

function notifyNewMessage(room, from) {
    if (room !== currentRoom) return;
    if (from !== miNombre) {
        playSound('message');
        if (!isWindowFocused) {
            unseenCount += 1;
            updateNotificationDisplay();
        }
    }
}

window.addEventListener('focus', () => {
    isWindowFocused = true;
    resetNotifications();
});

window.addEventListener('blur', () => {
    isWindowFocused = false;
});

function enableChat(name) {
    miNombre = name;
    socket.emit('nuevoUsuario', miNombre);
    input.disabled = false;
    sendButton.disabled = false;
    if (emojiBtn) emojiBtn.disabled = false;
    if (sendFileBtn) sendFileBtn.disabled = false;
    if (recordBtn) recordBtn.disabled = false;
    if (whisperBtn) whisperBtn.disabled = false;
    if (roomSelect) roomSelect.disabled = false;
    if (createRoomBtn) createRoomBtn.disabled = false;
    if (deleteRoomBtn) deleteRoomBtn.disabled = false;
    joinRoom(defaultRoom);
    updateHeaderRoom();
    input.focus();
}

async function saveUserName(uid, name) {
    const db = window.firebaseDb;
    const dbHelpers = window.firebaseDbHelpers;
    if (!db || !dbHelpers || !uid || !name) return;

    await dbHelpers.set(dbHelpers.ref(db, `users/${uid}`), {
        name: String(name).trim()
    });
}

async function readUserName(uid) {
    const db = window.firebaseDb;
    const dbHelpers = window.firebaseDbHelpers;
    if (!db || !dbHelpers || !uid) return null;

    const snapshot = await dbHelpers.get(dbHelpers.ref(db, `users/${uid}`));
    if (!snapshot.exists()) return null;
    const profile = snapshot.val();
    return profile && typeof profile.name === 'string' ? profile.name.trim() : null;
}

async function loadSessionUser() {
    try {
        const authHelpers = window.firebaseAuthHelpers;
        const auth = window.firebaseAuth;

        if (authHelpers && auth) {
            return await new Promise((resolve) => {
                const unsubscribe = authHelpers.onAuthStateChanged(auth, async (user) => {
                    unsubscribe();
                    if (user) {
                        let resolvedName = user.displayName || user.email.split('@')[0];
                        try {
                            const storedName = await readUserName(user.uid);
                            if (storedName) resolvedName = storedName;
                        } catch (dbError) {
                            console.warn('No se pudo leer el nombre desde Realtime Database.', dbError);
                        }
                        enableChat(resolvedName);
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                });
            });
        }

        const response = await fetch(apiUrl('/api/me'));
        const data = await response.json();

        if (data.user) {
            enableChat(data.user.name);
            return true;
        }
    } catch (error) {
        console.warn('No active local session found.', error);
    }

    return false;
}

(async () => {
    const hasSession = await loadSessionUser();
    if (!hasSession) {
        const notice = document.createElement('div');
        notice.className = 'session-notice';
        notice.textContent = 'Inicia sesión o regístrate para usar el chat.';

        const chatContainer = document.getElementById('chat-container');
        if (chatContainer) {
            chatContainer.insertBefore(notice, chatContainer.firstChild);
        }
    }
})();

// manejar el evento de envío de mensajes
form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!miNombre) {
        Swal.fire('Debes ingresar un nombre antes de enviar mensajes.');
        return;
    }

    const texto = input.value.trim();
    if (texto) {
        if (texto.startsWith('/poll ')) {
            const pollBody = texto.slice(6).trim();
            const parts = pollBody.split('|').map((part) => part.trim()).filter(Boolean);
            if (parts.length < 3) {
                Swal.fire('Encuesta', 'Usa: /poll Pregunta | Opcion 1 | Opcion 2', 'info');
                return;
            }
            const [question, ...options] = parts;
            socket.emit('poll-create', { room: currentRoom, question, options });
        } else {
            socket.emit('mensaje-chat', {
                room: currentRoom,
                mensaje: texto,
                whisperSeconds
            });
        }
        input.value = '';
    }
});

if (roomSelect) {
    roomSelect.addEventListener('change', (event) => {
        joinRoom(event.target.value);
    });
}

if (createRoomBtn) {
    createRoomBtn.addEventListener('click', createRoomFlow);
}

if (deleteRoomBtn) {
    deleteRoomBtn.addEventListener('click', deleteRoomFlow);
}


socket.on('roomHistory', ({ room, history }) => {
    if (!room) return;
    roomMessages[room] = history || [];
    roomMessages[room].forEach((entry) => {
        if (entry.whisperSeconds > 0 && entry.expiresAt) {
            scheduleWhisperRemoval(entry);
        }
    });
    addRoomIfNeeded(room);
    if (room === currentRoom) renderHistory();
});

socket.on('rooms-update', ({ rooms }) => {
    renderRoomOptions(Array.isArray(rooms) ? rooms : [defaultRoom]);
});

socket.on('room-deleted', ({ deletedRoom, fallbackRoom }) => {
    if (currentRoom === deletedRoom) {
        joinRoom(fallbackRoom || defaultRoom);
    }
});

socket.on('mensaje-chat', (data) => {
    addHistory({
        type: 'texto',
        id: data.id,
        room: data.room || currentRoom,
        usuario: data.usuario,
        mensaje: data.mensaje,
        hora: data.hora,
        reactions: data.reactions || {},
        whisperSeconds: Number(data.whisperSeconds || 0),
        expiresAt: data.expiresAt || null
    });
    if (Number(data.whisperSeconds || 0) > 0 && data.expiresAt) {
        scheduleWhisperRemoval({ id: data.id, room: data.room || currentRoom, expiresAt: data.expiresAt });
    }
    notifyNewMessage(data.room || currentRoom, data.usuario);
});

socket.on('mensaje-imagen', (data) => {
    addHistory({
        type: 'imagen',
        room: data.room || currentRoom,
        usuario: data.usuario,
        dataUrl: data.dataUrl,
        name: data.name,
        hora: data.hora
    });
    notifyNewMessage(data.room || currentRoom, data.usuario);
});

socket.on('mensaje-audio', (data) => {
    addHistory({
        type: 'audio',
        id: data.id,
        room: data.room || currentRoom,
        usuario: data.usuario,
        dataUrl: data.dataUrl,
        name: 'Nota de voz',
        hora: data.hora,
        playbackRate: Number(data.playbackRate || 1),
        reactions: data.reactions || {}
    });
    notifyNewMessage(data.room || currentRoom, data.usuario);
});

socket.on('poll-create', (data) => {
    addHistory({
        type: 'poll',
        id: data.id,
        room: data.room || currentRoom,
        usuario: data.usuario,
        poll: data.poll,
        hora: data.hora
    });
    notifyNewMessage(data.room || currentRoom, data.usuario);
});

socket.on('poll-update', (data) => {
    const room = data.room || currentRoom;
    const history = roomMessages[room] || [];
    const target = history.find((entry) => entry.id === data.id);
    if (!target) return;
    target.poll = data.poll;
    if (room === currentRoom) renderHistory();
});

socket.on('message-reaction', (data) => {
    const room = data.room || currentRoom;
    const history = roomMessages[room] || [];
    const target = history.find((entry) => entry.id === data.messageId);
    if (!target) return;
    target.reactions = data.reactions || {};
    if (room === currentRoom) renderHistory();
});

socket.on('mensaje-sistema', (data) => {
    const room = data.room || currentRoom;
    addHistory({
        type: 'system',
        room,
        mensaje: data.mensaje
    });
    playSound('system');
    if (room === currentRoom && !isWindowFocused) {
        unseenCount += 1;
        updateNotificationDisplay();
    }
});

// file send flow
if (sendFileBtn && fileInput) {
    sendFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!miNombre) {
            Swal.fire('Debes ingresar un nombre antes de enviar archivos.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(ev) {
            const dataUrl = ev.target.result;
            const payload = { room: currentRoom, name: file.name, type: file.type, dataUrl };
            socket.emit('upload', payload, (status) => {
                if (status !== 'ok') console.error('Upload failed', status);
            });
            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    });
}

// audio recording flow
if (recordBtn) {
    recordBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
}

if (whisperBtn) {
    whisperBtn.addEventListener('click', () => cycleWhisperMode());
    setWhisperMode(0);
}

const emojiList = ['😀', '😂', '😍', '😘', '😎', '😢', '😭', '😡', '👍', '👏', '🎉', '💡', '🔥', '🌟', '🙏', '🥳', '🎁', '💖', '🙌', '🍕'];

function buildEmojiPicker() {
    if (!emojiPicker) return;
    emojiPicker.innerHTML = '';
    emojiList.forEach((emoji) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'emoji-tile';
        button.textContent = emoji;
        button.addEventListener('click', () => {
            insertEmoji(emoji);
        });
        emojiPicker.appendChild(button);
    });
}

function insertEmoji(emoji) {
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const value = input.value;
    input.value = value.slice(0, start) + emoji + value.slice(end);
    const nextPos = start + emoji.length;
    input.setSelectionRange(nextPos, nextPos);
    input.focus();
    if (emojiPicker) emojiPicker.classList.add('hidden');
}

function toggleEmojiPicker(event) {
    if (!emojiPicker) return;
    event.stopPropagation();
    emojiPicker.classList.toggle('hidden');
}

if (emojiBtn) {
    emojiBtn.addEventListener('click', toggleEmojiPicker);
}

if (emojiPicker) {
    buildEmojiPicker();
    emojiPicker.addEventListener('click', (event) => event.stopPropagation());
}

document.addEventListener('click', () => {
    if (emojiPicker) emojiPicker.classList.add('hidden');
});

if (searchInput) {
    searchInput.addEventListener('input', (event) => {
        currentSearch = event.target.value;
        renderHistory();
    });
}

if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
        currentSearch = '';
        if (searchInput) searchInput.value = '';
        renderHistory();
        searchInput?.focus();
    });
}

function validateClientInput(name, email, password) {
    const nameValue = name.trim();
    if (nameValue.length < 2 || nameValue.length > 40) {
        return 'El nombre debe tener entre 2 y 40 caracteres.';
    }

    const emailValue = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        return 'Ingresa un correo electrónico válido.';
    }

    if (password.length < 6) {
        return 'La contraseña debe tener al menos 6 caracteres.';
    }

    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'La contraseña debe incluir letras y números.';
    }

    return null;
}

async function registerUser(values = null) {
    const name = values?.name ?? document.getElementById('register-name')?.value ?? '';
    const email = values?.email ?? document.getElementById('register-email')?.value ?? '';
    const password = values?.password ?? document.getElementById('register-password')?.value ?? '';

    const validationError = validateClientInput(name, email, password);
    if (validationError) {
        Swal.fire('Validación', validationError, 'warning');
        return;
    }

    const authHelpers = window.firebaseAuthHelpers;
    const auth = window.firebaseAuth;

    if (!authHelpers || !auth) {
        Swal.fire('Error', 'Firebase Auth no está disponible.', 'error');
        return;
    }

    try {
        const userCredential = await authHelpers.createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await saveUserName(user.uid, name);

        Swal.fire('Registro exitoso', `Cuenta creada para ${user.email}.`, 'success');
        enableChat(name || (user.email || 'Usuario').split('@')[0]);
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

async function loginUser(values = null) {
    const email = values?.email ?? document.getElementById('login-email')?.value ?? '';
    const password = values?.password ?? document.getElementById('login-password')?.value ?? '';

    const emailValue = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
        Swal.fire('Validación', 'Ingresa un correo válido.', 'warning');
        return;
    }

    if (!password) {
        Swal.fire('Validación', 'Ingresa tu contraseña para entrar.', 'warning');
        return;
    }

    const authHelpers = window.firebaseAuthHelpers;
    const auth = window.firebaseAuth;

    if (!authHelpers || !auth) {
        Swal.fire('Error', 'Firebase Auth no está disponible.', 'error');
        return;
    }

    try {
        const userCredential = await authHelpers.signInWithEmailAndPassword(auth, emailValue, password);
        const user = userCredential.user;
        let resolvedName = user.displayName || user.email.split('@')[0];

        try {
            const storedName = await readUserName(user.uid);
            if (storedName) {
                resolvedName = storedName;
            }
        } catch (dbError) {
            console.warn('No se pudo leer el nombre desde Realtime Database.', dbError);
        }

        Swal.fire('Bienvenido', `Hola ${user.email}`, 'success');
        enableChat(resolvedName);
    } catch (error) {
        Swal.fire('Error', error.message, 'error');
    }
}

async function logoutUser() {
    try {
        const authHelpers = window.firebaseAuthHelpers;
        const auth = window.firebaseAuth;

        if (authHelpers && auth) {
            await authHelpers.signOut(auth);
        }

        await fetch(apiUrl('/api/logout'), { method: 'POST' });
        window.location.reload();
    } catch (error) {
        Swal.fire('Error', 'No se pudo cerrar la sesión.', 'error');
    }
}

if (document.getElementById('logout-btn')) {
    document.getElementById('logout-btn').addEventListener('click', logoutUser);
}
