require('dotenv').config();
const express = require('express');
const http = require('http');
const MongoStore = require('connect-mongo');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const sharedsession = require("express-socket.io-session");
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 1. Database Connection - Targeting "Non_e"
// 1. Database Connection
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected to MongoDB Atlas: Non_e Database");
    } catch (err) {
        console.error("❌ CRITICAL: Database connection failed!");
        console.error(err.message);
        // Instead of crashing the whole server, we log it.
        // Or, if you want it to stop, use process.exit(1);
    }
};

connectDB();
// 2. Database Models (These will automatically create collections in Non_e)
const User = mongoose.model('User', new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: { type: String, required: true }
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    name: { type: String, unique: true },
    id: String,
    password: { type: String, default: "" },
    owner: String
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    roomName: String,
    message: String,
    sender: String,
    timestamp: { type: Date, default: Date.now }
}));

// 3. Socket & Session Setup
const io = socketIo(server, {
    cors: {
        origin: "https://none-mauve.vercel.app",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// FIX: Initializing MongoStore correctly for v4+
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'secret-chat-key',
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        collectionName: 'sessions' // This stores login sessions in your Non_e DB
    }),
    cookie: { 
        secure: NODE_ENV === 'production', 
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 14 * 24 * 60 * 60 * 1000 
    }
});

app.set('trust proxy', 1); 
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'Public')));

// Share session with Socket.io
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// 4. Helper Logic
const getVisibleRooms = async (user) => {
    if (!user) return [];
    const roomsWithMessage = await Message.distinct('roomName', { sender: user.name });
    return await Room.find({
        $or: [
            { owner: user.email },
            { name: { $in: roomsWithMessage } }
        ]
    });
};

// 5. Socket Logic
io.on('connection', (socket) => {
    const session = socket.handshake.session;

    if (session && session.user) {
        socket.emit('sessionRestore', { user: session.user });
        getVisibleRooms(session.user).then(rooms => socket.emit('initRooms', rooms));
    }

    socket.on('login', async (data) => {
        try {
            const user = await User.findOne({ email: data.email });
            if (user && await bcrypt.compare(data.password, user.password)) {
                session.user = { name: user.name, email: user.email };
                session.save(async () => {
                    socket.emit('loginResponse', { success: true, user: session.user });
                    const rooms = await getVisibleRooms(session.user);
                    socket.emit('initRooms', rooms);
                });
            } else {
                socket.emit('loginResponse', { success: false, message: 'Invalid credentials.' });
            }
        } catch (err) {
            socket.emit('loginResponse', { success: false, message: 'Server error.' });
        }
    });

    socket.on('signup', async (data) => {
        try {
            const exists = await User.findOne({ email: data.email });
            if (exists) return socket.emit('signupResponse', { success: false, message: 'Email already exists!' });

            const hashedPassword = await bcrypt.hash(data.password, 10);
            const newUser = await User.create({
                name: data.name,
                email: data.email,
                password: hashedPassword
            });

            session.user = { name: newUser.name, email: newUser.email }; 
            session.save(async () => {
                socket.emit('signupResponse', { success: true, user: session.user });
                const rooms = await getVisibleRooms(session.user);
                socket.emit('initRooms', rooms);
            });
        } catch (e) {
            socket.emit('signupResponse', { success: false, message: 'Error creating user.' });
        }
    });

    socket.on('createRoom', async (roomData) => {
        if (!session?.user) return socket.emit('errorMsg', 'Login required.');
        try {
            const exists = await Room.findOne({ $or: [{ name: roomData.name }, { id: roomData.id }] });
            if (exists) return socket.emit('errorMsg', 'Room name or ID already exists!');

            const newRoom = await Room.create({ 
                name: roomData.name,
                password: roomData.password || "",
                id: roomData.id || uuidv4(), 
                owner: session.user.email 
            });

            socket.emit('room-created-success', newRoom);
            // Refresh rooms for the creator
            const rooms = await getVisibleRooms(session.user);
            socket.emit('initRooms', rooms);
        } catch (e) {
            socket.emit('errorMsg', 'Error creating room.');
        }
    });

    socket.on('joinRoom', async (roomName) => {
        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(roomName);
        const history = await Message.find({ roomName }).sort({ timestamp: 1 }).limit(100);
        socket.emit('chatHistory', history); 
    });

    socket.on('newMessage', async (data) => {
        if (!session?.user || !data.roomName) return;
        const newMessage = await Message.create({
            roomName: data.roomName,
            message: data.message,
            sender: session.user.name,
        });
        io.to(data.roomName).emit('receiveMessage', newMessage);
    });

    socket.on('logout', () => {
        if (session) {
            delete session.user;
            session.save(() => socket.emit('logoutConfirm'));
        }
    });

    socket.on('verify-room', async (data) => {
        if (!session?.user) return socket.emit('room-access-result', { success: false, message: 'Login required.' });
        const room = await Room.findOne({ name: data.name });
        if (!room) return socket.emit('room-access-result', { success: false, message: 'Room not found.' });
        if (room.password && room.password !== data.password) {
            return socket.emit('room-access-result', { success: false, message: 'Incorrect password.' });
        }
        socket.emit('room-access-result', { success: true, room });
    });

    socket.on('deleteRoom', async (data) => {
        if (!session?.user) return socket.emit('errorMsg', 'Login required.');
        const room = await Room.findOne({ id: data.roomId });
        if (!room) return socket.emit('errorMsg', 'Room not found.');
        if (room.owner !== session.user.email) return socket.emit('errorMsg', 'Unauthorized.');

        await Room.deleteOne({ id: data.roomId });
        await Message.deleteMany({ roomName: room.name });
        io.emit('roomDeleted', room.id);
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
