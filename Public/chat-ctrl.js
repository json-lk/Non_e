const URL = "https://non-e.onrender.com"; 
const socket = io("https://non-e.onrender.com", {
    withCredentials: true,
    transports: ["polling", "websocket"] // Try polling first, then upgrade to websocket
});

// --- SELECTORS ---
const createChatBtn = document.getElementById('create-chat');
const createChatModal = document.getElementById('create-chatroom');
const createChatForm = document.getElementById('create-form');
const displayBox = document.getElementById('display-box');
const messageInput = document.getElementById('messages-input');
const sendmessage = document.getElementById('message-form');
const messagesContainer = document.querySelector('.messages');
const joinChatBtn = document.getElementById('join-button');
const joinChatModal = document.getElementById('join-chatroom');
const joinChatForm = document.getElementById('join-form');
const closeJoinBtn = document.getElementById('close-join');
const closeCreateBtn = document.getElementById('close-create');
const chatroomExitBtn = document.getElementById('exit');
const chatroomSettingsBtn = document.getElementById('delroom');
const chatroomUI = document.querySelector('.chatroom');

let currentRoom = null;
let currentRoomId = null;

// --- ROOM MANAGEMENT ---

createChatBtn.addEventListener('click', () => createChatModal.classList.remove('hidden'));
joinChatBtn.addEventListener('click', () => joinChatModal.classList.remove('hidden'));
closeJoinBtn.addEventListener('click', () => joinChatModal.classList.add('hidden'));
closeCreateBtn.addEventListener('click', () => createChatModal.classList.add('hidden'));

// Close modals when clicking outside
[joinChatModal, createChatModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
});

// Create Room Action
createChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomData = {
        name: document.getElementById('chat-name').value,
        password: document.getElementById('chat-password').value,
        // Supabase uses text/uuid for IDs; default to random string if empty
        id: document.getElementById('chat-id').value || Math.random().toString(36).substring(7)
    };
    socket.emit('createRoom', roomData); 
});

// Join/Verify Room Action
joinChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
        name: joinChatForm.querySelector('#chat-name').value,
        password: joinChatForm.querySelector('#chat-password').value
    };
    socket.emit('verify-room', data);
});

chatroomExitBtn.addEventListener('click', () => {
    chatroomUI.style.display = 'none';
    currentRoom = null;
    currentRoomId = null;
});

// Delete Room Action
chatroomSettingsBtn.addEventListener('click', () => {
    if (!currentRoomId) return;
    if (confirm(`Are you sure you want to delete "${currentRoom}"? This will erase all history in Supabase.`)) {
        socket.emit('deleteRoom', { roomId: currentRoomId });
    }
});

// --- MESSAGE LOGIC ---

sendmessage.addEventListener('submit', (e) => {
    e.preventDefault(); 
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) {
        alert("Session expired. Please log in.");
        return authModal.classList.remove('hidden'); // Show login modal
    }
    if (!messageInput.value.trim() || !currentRoom) return;

    socket.emit('newMessage', {
        roomName: currentRoom,
        message: messageInput.value
    });
    messageInput.value = '';
});// --- FUNCTIONS ---

function displaySingleMessage(data) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    // Supabase returns 'sender' and 'message' columns
    const isMe = data.sender === user?.name;
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', isMe ? 'my-message' : 'other-message');
    
    msgDiv.innerHTML = `
        <div>
            <div class="you" style="font-weight:bold">${isMe ? 'You' : data.sender}</div>
            <div class="text">${data.message}</div>
        </div>
    `;
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateRoomSidebar(room) {
    if (document.querySelector(`[data-id="${room.id}"]`)) return;

    const btn = document.createElement('button');
    btn.textContent = room.name;
    btn.classList.add('buttons');
    btn.setAttribute('data-id', room.id); 
    btn.onclick = () => openChatRoom(room);
    displayBox.appendChild(btn);
}

function openChatRoom(room) {
    currentRoom = room.name;
    currentRoomId = room.id;
    
    document.querySelector('.chatroom .header .logo').textContent = room.name;
    chatroomUI.style.display = 'flex';
    messagesContainer.innerHTML = ''; 
    socket.emit('joinRoom', room.name);

    const user = JSON.parse(localStorage.getItem('currentUser'));
    // Show delete button only if owner email matches
    chatroomSettingsBtn.style.display = (user && room.owner === user.email) ? 'block' : 'none';
}

// --- SOCKET LISTENERS ---
// On load, confirm session with server
socket.on('connect', () => {
    console.log("Connected to Render. Checking session...");
    socket.emit('checkSession'); // Custom event we discussed
});

socket.on('sessionRestore', (data) => {
    if (data.user) {
        // SUCCESS: The user is remembered by Supabase
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        updateAccountButton(); // Your UI helper
    } else {
        // FAIL: No session found, redirect to login
        window.location.href = 'index.html';
    }
});

socket.on('sessionRestore', (data) => {
    if (data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        // Refresh room list now that we are confirmed logged in
        socket.emit('getRooms'); 
    } else {
        // Only redirect if they are trying to access protected features
        console.log("Not logged in.");
    }
});


socket.on('initRooms', (rooms) => {
    displayBox.innerHTML = ''; 
    if (rooms) rooms.forEach(updateRoomSidebar);
});

socket.on('room-created-success', (newRoom) => {
    updateRoomSidebar(newRoom);
    openChatRoom(newRoom);
    createChatModal.classList.add('hidden');
    createChatForm.reset();
});

socket.on('chatHistory', (history) => {
    messagesContainer.innerHTML = '';
    if (history) history.forEach(displaySingleMessage);
});

socket.on('receiveMessage', (data) => {
    // Only display if the message belongs to the room currently open
    // Backend sends room_name (snake_case) from Supabase
    if (data.room_name === currentRoom) {
        displaySingleMessage(data);
    }
});

socket.on('room-access-result', (response) => {
    if (response.success) {
        updateRoomSidebar(response.room);
        openChatRoom(response.room);
        joinChatModal.classList.add('hidden');
        joinChatForm.reset();
    } else {
        alert(response.message);
    }
});

socket.on('roomDeleted', (roomId) => {
    if (currentRoomId === roomId) {
        chatroomUI.style.display = 'none';
        currentRoomId = null;
        currentRoom = null;
        alert("This room has been deleted by the owner.");
    }
    const btn = document.querySelector(`[data-id="${roomId}"]`);
    if (btn) btn.remove();
});

socket.on('logoutConfirm', () => {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
});

socket.on('errorMsg', (msg) => alert(msg));
