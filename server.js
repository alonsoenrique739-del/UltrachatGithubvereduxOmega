const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const usersFile = path.join(__dirname, 'users.json');

const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// CORS middleware for cross-origin requests (Vercel frontend → Railway backend)
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = FRONTEND_URL === '*' || origin === FRONTEND_URL;
    if (allowed) {
        res.header('Access-Control-Allow-Origin', origin || '*');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

//aumentamos el buffer para que pueda subir archivos (max 200 mb) incluyendo audios
const io = new Server(server, {
    maxHttpBufferSize: 2e8,
    cors: {
        origin: FRONTEND_URL,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX = /^[A-Za-zÁÉÍÓÚáéíóúÑñ\s'-]{2,40}$/;

function sanitizeText(value) {
    return String(value || '')
        .trim()
        .replace(/[<>]/g, '')
        .slice(0, 80);
}

function validateName(name) {
    const cleaned = sanitizeText(name);
    if (!cleaned || !NAME_REGEX.test(cleaned)) {
        return { valid: false, error: 'El nombre debe tener entre 2 y 40 caracteres válidos.' };
    }
    return { valid: true, value: cleaned };
}

function validateEmail(email) {
    const cleaned = sanitizeText(email).toLowerCase();
    if (!EMAIL_REGEX.test(cleaned)) {
        return { valid: false, error: 'Introduce un correo electrónico válido.' };
    }
    return { valid: true, value: cleaned };
}

function validatePassword(password) {
    const cleaned = String(password || '').trim();
    if (cleaned.length < 6) {
        return { valid: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
    }
    if (!/[A-Za-z]/.test(cleaned) || !/\d/.test(cleaned)) {
        return { valid: false, error: 'La contraseña debe incluir letras y números.' };
    }
    return { valid: true, value: cleaned };
}

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'superchat-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
}));

function loadUsers() {
    if (!fs.existsSync(usersFile)) return [];
    return JSON.parse(fs.readFileSync(usersFile, 'utf8'));
}

function saveUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

app.post('/api/register', async (req, res) => {
    const nameCheck = validateName(req.body.name);
    if (!nameCheck.valid) {
        return res.status(400).json({ error: nameCheck.error });
    }

    const emailCheck = validateEmail(req.body.email);
    if (!emailCheck.valid) {
        return res.status(400).json({ error: emailCheck.error });
    }

    const passwordCheck = validatePassword(req.body.password);
    if (!passwordCheck.valid) {
        return res.status(400).json({ error: passwordCheck.error });
    }

    const users = loadUsers();
    if (users.some((user) => user.email === emailCheck.value)) {
        return res.status(400).json({ error: 'Ese correo ya está registrado.' });
    }

    const hashedPassword = await bcrypt.hash(passwordCheck.value, 10);
    users.push({
        id: Date.now().toString(),
        name: nameCheck.value,
        email: emailCheck.value,
        password: hashedPassword
    });
    saveUsers(users);

    res.json({ ok: true, message: 'Usuario registrado correctamente.' });
});

app.post('/api/login', async (req, res) => {
    const emailCheck = validateEmail(req.body.email);
    if (!emailCheck.valid) {
        return res.status(400).json({ error: emailCheck.error });
    }

    const passwordCheck = validatePassword(req.body.password);
    if (!passwordCheck.valid) {
        return res.status(400).json({ error: 'La contraseña no es válida.' });
    }

    const users = loadUsers();
    const user = users.find((entry) => entry.email === emailCheck.value);
    if (!user) {
        return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const isValid = await bcrypt.compare(passwordCheck.value, user.password);
    if (!isValid) {
        return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    req.session.user = { id: user.id, name: user.name, email: user.email };
    res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});

app.get('/api/me', (req, res) => {
    res.json({ user: req.session.user || null });
});

//consuma datos de la carpeta public
app.use(express.static('public'));

const DEFAULT_ROOM = 'General';
const ROOM_CONFIRM_CODE = '0000';
const roomNames = new Set([DEFAULT_ROOM]);
const roomHistory = {
    [DEFAULT_ROOM]: []
};

function getRoomList() {
    return [
        DEFAULT_ROOM,
        ...Array.from(roomNames).filter((room) => room !== DEFAULT_ROOM).sort((a, b) => a.localeCompare(b))
    ];
}

function normalizeRoomName(value) {
    return String(value || '').trim().slice(0, 40);
}

function ensureRoom(room) {
    if (!roomHistory[room]) roomHistory[room] = [];
    roomNames.add(room);
}

function emitRooms(target = io) {
    target.emit('rooms-update', { rooms: getRoomList(), defaultRoom: DEFAULT_ROOM });
}

function createMessageId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

io.on('connection', (socket) => {
    console.log(`Un usuario se ha conectado (ID: ${socket.id})`);
    socket.username = '';
    emitRooms(socket);

    socket.on('nuevoUsuario', (nombre) => {
        socket.username = nombre;
    });

    socket.on('joinRoom', (room) => {
        const requestedRoom = normalizeRoomName(room);
        room = roomNames.has(requestedRoom) ? requestedRoom : DEFAULT_ROOM;
        const previousRoom = socket.currentRoom;
        if (previousRoom === room) return;

        if (previousRoom) {
            socket.leave(previousRoom);
            const leaveMessage = {
                type: 'system',
                room: previousRoom,
                mensaje: `${socket.username} ha salido de la sala`
            };
            if (!roomHistory[previousRoom]) roomHistory[previousRoom] = [];
            roomHistory[previousRoom].push(leaveMessage);
            socket.to(previousRoom).emit('mensaje-sistema', leaveMessage);
        }

        socket.join(room);
        socket.currentRoom = room;
        ensureRoom(room);
        
        socket.emit('roomHistory', { room, history: roomHistory[room] });
        
        const joinMessage = {
            type: 'system',
            room,
            mensaje: `${socket.username} se ha unido a la sala`
        };
        roomHistory[room].push(joinMessage);
        socket.broadcast.to(room).emit('mensaje-sistema', joinMessage);
    });

    socket.on('room-create', (data, ack) => {
        const roomName = normalizeRoomName(data?.name);
        const code = String(data?.code || '');

        if (code !== ROOM_CONFIRM_CODE) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Codigo de confirmacion invalido.' });
            return;
        }

        if (roomName.length < 2) {
            if (typeof ack === 'function') ack({ ok: false, error: 'El nombre de sala debe tener al menos 2 caracteres.' });
            return;
        }

        if (roomNames.has(roomName)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Esa sala ya existe.' });
            return;
        }

        ensureRoom(roomName);
        emitRooms();
        io.to(DEFAULT_ROOM).emit('mensaje-sistema', {
            type: 'system',
            room: DEFAULT_ROOM,
            mensaje: `${socket.username || 'Usuario'} ha creado la sala ${roomName}`
        });

        if (typeof ack === 'function') ack({ ok: true, room: roomName });
    });

    socket.on('room-delete', (data, ack) => {
        const roomName = normalizeRoomName(data?.room);
        const code = String(data?.code || '');

        if (code !== ROOM_CONFIRM_CODE) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Codigo de confirmacion invalido.' });
            return;
        }

        if (!roomNames.has(roomName)) {
            if (typeof ack === 'function') ack({ ok: false, error: 'La sala no existe.' });
            return;
        }

        if (roomName === DEFAULT_ROOM) {
            if (typeof ack === 'function') ack({ ok: false, error: 'La sala General no se puede borrar.' });
            return;
        }

        const roomMembers = io.sockets.adapter.rooms.get(roomName);
        if (roomMembers) {
            for (const memberId of roomMembers) {
                const memberSocket = io.sockets.sockets.get(memberId);
                if (!memberSocket) continue;
                memberSocket.leave(roomName);
                memberSocket.join(DEFAULT_ROOM);
                memberSocket.currentRoom = DEFAULT_ROOM;
                ensureRoom(DEFAULT_ROOM);
                memberSocket.emit('roomHistory', { room: DEFAULT_ROOM, history: roomHistory[DEFAULT_ROOM] });
            }
        }

        delete roomHistory[roomName];
        roomNames.delete(roomName);
        emitRooms();
        io.emit('room-deleted', { deletedRoom: roomName, fallbackRoom: DEFAULT_ROOM });
        io.to(DEFAULT_ROOM).emit('mensaje-sistema', {
            type: 'system',
            room: DEFAULT_ROOM,
            mensaje: `${socket.username || 'Usuario'} ha borrado la sala ${roomName}`
        });

        if (typeof ack === 'function') ack({ ok: true, fallbackRoom: DEFAULT_ROOM });
    });

    socket.on('mensaje-chat', (data) => {
        const room = data.room || socket.currentRoom || 'General';
        const whisperSeconds = Math.max(0, Math.min(Number(data.whisperSeconds || 0), 30));
        const id = createMessageId();
        const mensaje = {
            id,
            type: 'texto',
            usuario: socket.username || 'Usuario',
            mensaje: data.mensaje,
            room,
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reactions: {},
            whisperSeconds,
            expiresAt: whisperSeconds > 0 ? Date.now() + whisperSeconds * 1000 : null
        };
        if (!roomHistory[room]) roomHistory[room] = [];
        roomHistory[room].push(mensaje);
        io.to(room).emit('mensaje-chat', mensaje);

        if (mensaje.expiresAt) {
            setTimeout(() => {
                if (!roomHistory[room]) return;
                roomHistory[room] = roomHistory[room].filter((entry) => entry.id !== id);
            }, whisperSeconds * 1000);
        }
    });

    socket.on('upload', (fileObj, ack) => {
        const room = fileObj.room || socket.currentRoom || 'General';
        const usuario = socket.username || 'Usuario';
        const mensaje = {
            id: createMessageId(),
            type: 'imagen',
            room,
            usuario,
            name: fileObj.name,
            dataUrl: fileObj.dataUrl,
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reactions: {}
        };
        if (!roomHistory[room]) roomHistory[room] = [];
        roomHistory[room].push(mensaje);
        io.to(room).emit('mensaje-imagen', mensaje);
        if (typeof ack === 'function') ack('ok');
    });

    socket.on('mensaje-audio', (data, ack) => {
        const room = data.room || socket.currentRoom || 'General';
        const usuario = socket.username || 'Usuario';
        const mensaje = {
            id: createMessageId(),
            type: 'audio',
            room,
            usuario,
            dataUrl: data.dataUrl,
            playbackRate: Number(data.playbackRate || 1),
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reactions: {}
        };
        if (!roomHistory[room]) roomHistory[room] = [];
        roomHistory[room].push(mensaje);
        io.to(room).emit('mensaje-audio', mensaje);
        if (typeof ack === 'function') ack('ok');
    });

    socket.on('poll-create', (data) => {
        const room = data.room || socket.currentRoom || 'General';
        const options = Array.isArray(data.options)
            ? data.options.map((opt) => String(opt || '').trim()).filter(Boolean).slice(0, 6)
            : [];
        const question = String(data.question || '').trim().slice(0, 160);
        if (!question || options.length < 2) return;

        const mensaje = {
            id: createMessageId(),
            type: 'poll',
            room,
            usuario: socket.username || 'Usuario',
            poll: {
                question,
                options,
                votes: options.map(() => 0),
                voters: {}
            },
            hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (!roomHistory[room]) roomHistory[room] = [];
        roomHistory[room].push(mensaje);
        io.to(room).emit('poll-create', mensaje);
    });

    socket.on('poll-vote', (data) => {
        const room = data.room || socket.currentRoom || 'General';
        const messageId = String(data.messageId || '');
        const optionIndex = Number(data.optionIndex);
        const history = roomHistory[room] || [];
        const pollMessage = history.find((entry) => entry.id === messageId && entry.type === 'poll');
        if (!pollMessage || !Number.isInteger(optionIndex)) return;
        if (optionIndex < 0 || optionIndex >= pollMessage.poll.options.length) return;

        const voterId = socket.id;
        const previous = pollMessage.poll.voters[voterId];
        if (Number.isInteger(previous) && pollMessage.poll.votes[previous] > 0) {
            pollMessage.poll.votes[previous] -= 1;
        }
        pollMessage.poll.voters[voterId] = optionIndex;
        pollMessage.poll.votes[optionIndex] += 1;

        io.to(room).emit('poll-update', {
            room,
            id: pollMessage.id,
            poll: {
                question: pollMessage.poll.question,
                options: pollMessage.poll.options,
                votes: pollMessage.poll.votes
            }
        });
    });

    socket.on('message-reaction', (data) => {
        const room = data.room || socket.currentRoom || 'General';
        const messageId = String(data.messageId || '');
        const emoji = String(data.emoji || '').trim().slice(0, 4);
        if (!emoji) return;
        const history = roomHistory[room] || [];
        const target = history.find((entry) => entry.id === messageId && ['texto', 'imagen', 'audio'].includes(entry.type));
        if (!target) return;

        if (!target.reactions) target.reactions = {};
        if (!target.reactionByUser) target.reactionByUser = {};

        const prevEmoji = target.reactionByUser[socket.id];
        if (prevEmoji && target.reactions[prevEmoji] > 0) {
            target.reactions[prevEmoji] -= 1;
        }
        target.reactionByUser[socket.id] = emoji;
        target.reactions[emoji] = Number(target.reactions[emoji] || 0) + 1;

        io.to(room).emit('message-reaction', {
            room,
            messageId,
            reactions: target.reactions
        });
    });

    socket.on('disconnect', () => {
        if (socket.username && socket.currentRoom) {
            const leaveMessage = {
                type: 'system',
                room: socket.currentRoom,
                mensaje: `${socket.username} ha salido de la sala`
            };
            if (!roomHistory[socket.currentRoom]) roomHistory[socket.currentRoom] = [];
            roomHistory[socket.currentRoom].push(leaveMessage);
            io.to(socket.currentRoom).emit('mensaje-sistema', leaveMessage);
        }
    });

});
// levantar el servidor en el puerto 3000
const BASE_PORT = Number(process.env.PORT) || 3000;
function startServer(port) {
    server.listen(port, () => {
        console.log(`Servidor ejecutando en http://localhost:${port}`);
    });

    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port === BASE_PORT) {
            console.warn(`Puerto ${port} ocupado. Intentando con el puerto ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error(`Error al iniciar el servidor en el puerto ${port}:`, err.message);
            process.exit(1);
        }
    });
}

startServer(BASE_PORT);
