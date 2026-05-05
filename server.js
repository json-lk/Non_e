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

// 1. Database Connection
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected to MongoDB Atlas: Non_e Database");
    } catch (err) {
        console.error("❌ CRITICAL: Database connection failed!", err.message);
    }
};

connectDB();

// 2. Database Models
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

app.set('trust proxy', 1); 

app.set('trust proxy', 1); // Required for Render

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'secret-chat-key',
    resave: true,               // Force session to be saved back to the store
    saveUninitialized: false, 
    proxy: true,                // Trust the Render proxy for HTTPS
    store: MongoStore.create({
        mongoUrl: process.env.MONGO_URI,
        ttl: 14 * 24 * 60 * 60 
    }),
    cookie: { 
        secure: true,           // MUST be true for SameSite: 'none'
        httpOnly: true,
        sameSite: 'none',       // REQUIRED for cross-domain (Vercel to Render)
        maxAge: 14 * 24 * 60 * 60 * 1000 
    }
});

app.use(sessionMiddleware);

io.use(sharedsession(sessionMiddleware, { 
    autoSave: true 
}));

app.use(express.static(path.join(__dirname, 'Public')));

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
    console.log("Cookie Header:", socket.handshake.headers.cookie);
    const protocol = socket.handshake.secure ? 'https' : 'http';
    const host = socket.handshake.headers.host || 'localhost';
    const connectionUrl = new URL(socket.handshake.url, `${protocol}://${host}`);

    const session = socket.handshake.session;
    console.log(`🚀 Socket connected. Path: ${connectionUrl.pathname}`);
    console.log(`User: ${session?.user?.email || "guest"}`);

    const refreshUserRooms = async (user) => {
        const rooms = await getVisibleRooms(user);
        socket.emit('initRooms', rooms);
    };

    if (session?.user) {
        socket.emit('sessionRestore', { user: session.user });
        refreshUserRooms(session.user);
    }

    socket.on('login', async (data) => {    
        try {
            const user = await User.findOne({ email: data.email });
            if (user && await bcrypt.compare(data.password, user.password)) {
                // 1. Attach user to session
                socket.handshake.session.user = { name: user.name, email: user.email };
            
                // 2. FORCE SAVE before replying
                socket.handshake.session.save((err) => {
                    if (err) return socket.emit('loginResponse', { success: false, message: 'Session save failed' });
                
                    socket.emit('loginResponse', { success: true, user: socket.handshake.session.user });
                    refreshUserRooms(socket.handshake.session.user);
                });
            }else {
                socket.emit('loginResponse', { success: false, message: 'Invalid credentials.' });
            }
        } catch (err) {
            socket.emit('loginResponse', { success: false, message: 'Server error.' });
        }
    });
    socket.on('signup', async (data) => {
        try {
            const exists = await User.findOne({ email: data.email });
            if (exists) return socket.emit('signupResponse', { success: false, message: 'Email exists.' });

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
        socket.handshake.session.reload(async (err) => {
            if (err || !socket.handshake.session.user) {
                return socket.emit('errorMsg', 'Session expired.');
            }
            try {
                const exists = await Room.findOne({ $or: [{ name: roomData.name }, { id: roomData.id }] });
                if (exists) return socket.emit('errorMsg', 'Room already exists!');

                const newRoom = await Room.create({ 
                    name: roomData.name,
                    password: roomData.password || "",
                    id: roomData.id || uuidv4(), 
                    owner: socket.handshake.session.user.email 
                });

                socket.emit('room-created-success', newRoom);
                const rooms = await getVisibleRooms(socket.handshake.session.user);
                socket.emit('initRooms', rooms);
            } catch (e) {
                socket.emit('errorMsg', 'Database error.');
            }
        });
    });

    socket.on('joinRoom', async (roomName) => {
        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(roomName);
        const history = await Message.find({ roomName }).sort({ timestamp: 1 }).limit(50);
        socket.emit('chatHistory', history); 
    });

    socket.on('newMessage', async (data) => {
        socket.handshake.session.reload(async (err) => {
            if (err || !socket.handshake.session.user) return socket.emit('errorMsg', 'Expired.');
            try {
                const newMessage = await Message.create({
                    roomName: data.roomName,
                    message: data.message,
                    sender: socket.handshake.session.user.name,
                });
                io.to(data.roomName).emit('receiveMessage', newMessage);
            } catch (e) {
                socket.emit('errorMsg', 'Save failed.');
            }
        });
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
        if (!room) return socket.emit('room-access-result', { success: false, message: 'Not found.' });
        
        if (room.password && room.password !== data.password) {
            return socket.emit('room-access-result', { success: false, message: 'Wrong password.' });
        }
        socket.emit('room-access-result', { success: true, room });
    });

    socket.on('deleteRoom', async (data) => {
        if (!session?.user) return socket.emit('errorMsg', 'Login required.');
        const room = await Room.findOne({ id: data.roomId });
        if (!room || room.owner !== session.user.email) return socket.emit('errorMsg', 'Unauthorized.');

        await Room.deleteOne({ id: data.roomId });
        await Message.deleteMany({ roomName: room.name });
        io.emit('roomDeleted', room.id);
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
