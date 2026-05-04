require('dotenv').config();
const express = require('express');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const sharedsession = require("express-socket.io-session");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// 1. Supabase Connection
// Ensure SUPABASE_URL and SUPABASE_ANON_KEY are in your .env
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// 2. Session Setup (Using PostgreSQL via your Supabase connection string)
const sessionMiddleware = session({
    store: new pgSession({
        conString: process.env.DATABASE_URL, // Use Supabase Transaction/Session string
        tableName: 'session'                 // Create this table in Supabase first
    }),
    secret: process.env.SESSION_SECRET || 'secret-chat-key',
    resave: false,
    saveUninitialized: false,
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

const io = socketIo(server, {
    cors: {
        // MUST match your Vercel URL exactly!
        origin: "https://none-mauve.vercel.app", 
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Add this to force compatibility
});

io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// 3. Helper Logic
const getVisibleRooms = async (user) => {
    if (!user) return [];
    
    // Get rooms where user has sent a message
    const { data: userMessages } = await supabase
        .from('messages')
        .select('room_name')
        .eq('sender', user.name);

    const roomsWithActivity = (userMessages || []).map(m => m.room_name);

    // Fetch rooms owned by user OR rooms where they've messaged
    const { data: rooms } = await supabase
        .from('rooms')
        .select('*')
        .or(`owner.eq.${user.email},name.in.(${roomsWithActivity.join(',') || 'NULL'})`);

    return rooms || [];
};

// 4. Socket Logic
io.on('connection', (socket) => {
    const session = socket.handshake.session;

    // Check session on every connection
    if (session?.user) {
        socket.emit('sessionRestore', { user: session.user });
        getVisibleRooms(session.user).then(rooms => socket.emit('initRooms', rooms));
    }

    socket.on('login', async (data) => {
        try {
            const { data: user } = await supabase.from('users').select('*').eq('email', data.email).single();
            if (user && await bcrypt.compare(data.password, user.password)) {
                // Attach to session
                session.user = { name: user.name, email: user.email };
                // FORCE SAVE to Supabase session table
                session.save(() => {
                    socket.emit('loginResponse', { success: true, user: session.user });
                });
            } else {
                socket.emit('loginResponse', { success: false, message: 'Invalid credentials.' });
            }
        } catch (err) { socket.emit('loginResponse', { success: false, message: 'Server error.' }); }
    });

    socket.on('signup', async (data) => {
        try {
            const hashedPassword = await bcrypt.hash(data.password, 10);
            const { data: newUser, error } = await supabase.from('users')
                .insert([{ name: data.name, email: data.email, password: hashedPassword }]).select().single();
            if (error) throw error;

            session.user = { name: newUser.name, email: newUser.email }; 
            session.save(() => {
                socket.emit('signupResponse', { success: true, user: session.user });
            });
        } catch (e) { socket.emit('signupResponse', { success: false, message: 'Error or email exists.' }); }
    });

    socket.on('createRoom', async (roomData) => {
        if (!session?.user) return socket.emit('errorMsg', 'Login required.');
        try {
            const { data: newRoom, error } = await supabase
                .from('rooms')
                .insert([{
                    name: roomData.name,
                    password: roomData.password || "",
                    id: roomData.id || uuidv4(),
                    owner: session.user.email
                }])
                .select()
                .single();

            if (error) return socket.emit('errorMsg', 'Room name or ID exists.');

            socket.emit('room-created-success', newRoom);
            const rooms = await getVisibleRooms(session.user);
            socket.emit('initRooms', rooms);
        } catch (e) {
            socket.emit('errorMsg', 'Error creating room.');
        }
    });

    socket.on('joinRoom', async (roomName) => {
        socket.rooms.forEach(room => { if(room !== socket.id) socket.leave(room); });
        socket.join(roomName);

        const { data: history } = await supabase
            .from('messages')
            .select('*')
            .eq('room_name', roomName)
            .order('timestamp', { ascending: true })
            .limit(100);

        socket.emit('chatHistory', history || []); 
    });

    socket.on('newMessage', async (data) => {
        if (!session?.user || !data.roomName) return;
        
        const { data: msg, error } = await supabase
            .from('messages')
            .insert([{
                room_name: data.roomName,
                message: data.message,
                sender: session.user.name,
            }])
            .select()
            .single();

        if (!error) io.to(data.roomName).emit('receiveMessage', msg);
    });

    socket.on('logout', () => {
        if (session) {
            delete session.user;
            session.save(() => socket.emit('logoutConfirm'));
        }
    });

    socket.on('verify-room', async (data) => {
        const { data: room } = await supabase
            .from('rooms')
            .select('*')
            .eq('name', data.name)
            .single();

        if (!room) return socket.emit('room-access-result', { success: false, message: 'Room not found.' });
        if (room.password && room.password !== data.password) {
            return socket.emit('room-access-result', { success: false, message: 'Incorrect password.' });
        }
        socket.emit('room-access-result', { success: true, room });
    });

    socket.on('deleteRoom', async (data) => {
        if (!session?.user) return socket.emit('errorMsg', 'Login required.');
        
        const { error } = await supabase
            .from('rooms')
            .delete()
            .eq('id', data.roomId)
            .eq('owner', session.user.email); // Only owner can delete

        if (!error) io.emit('roomDeleted', data.roomId);
    });

    // Add these inside your io.on('connection') block in the server script:

    socket.on('updateProfile', async (data) => {
        if (!session?.user) return;
        try {
            const updateData = { name: data.newName, email: data.newEmail };
            if (data.newPassword) {
                updateData.password = await bcrypt.hash(data.newPassword, 10);
            }

            const { data: updatedUser, error } = await supabase
            .from('users')
            .update(updateData)
            .eq('email', data.oldEmail)
            .select()
            .single();

            if (error) throw error;

            session.user = { name: updatedUser.name, email: updatedUser.email };
            session.save(() => {
                socket.emit('updateProfileResponse', { success: true, user: session.user });
            });
        } catch (e) {
            socket.emit('updateProfileResponse', { success: false, message: e.message });
        }
    });

    socket.on('deleteAccount', async (email) => {
        if (!session?.user || session.user.email !== email) return;
        try {
            // Delete user (Supabase cascades delete if you set up FK references correctly)
            const { error } = await supabase.from('users').delete().eq('email', email);
            if (error) throw error;

            delete session.user;
            session.save(() => {
                socket.emit('deleteResponse', { success: true });
            });
        } catch (e) {
            socket.emit('deleteResponse', { success: false, message: e.message });
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
