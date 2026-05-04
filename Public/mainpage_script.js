// 1. Initialize Socket
const URL = "https://non-e.onrender.com"; 
const socket = io("https://non-e.onrender.com", {
    withCredentials: true,
    transports: ["polling", "websocket"] // Try polling first, then upgrade to websocket
});

// --- SELECTORS ---
const toggleButton = document.getElementById('theme-toggle');
const authModal = document.getElementById('auth');
const accountButton = document.querySelector('.account-button');
const accountDropdown = document.getElementById('account-dropdown');
const editProfileModal = document.getElementById('edit-profile-modal');
const switchFormButtons = document.querySelectorAll('.switch-process');

// --- THEME LOGIC ---
let isDarkMode = false;
toggleButton.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    toggleButton.innerHTML = isDarkMode ? '🌞' : '🌙';
});

// --- AUTH & PROFILE SUBMISSIONS ---

// Login

// Update Profile (Supabase logic)
document.getElementById('edit-profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;

    socket.emit('updateProfile', {
        oldEmail: currentUser.email, // Used as identifier in Supabase
        newName: document.getElementById('edit-name').value,
        newEmail: document.getElementById('edit-email').value,
        newPassword: document.getElementById('edit-password').value
    });
});

// Delete Account (Permanent Supabase Wipe)
document.getElementById('delusr').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm("⚠️ Delete account permanently from Supabase? This will remove all your messages and rooms.")) {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (user) socket.emit('deleteAccount', user.email);
    }
});

// --- UI EVENT LISTENERS ---

accountButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const user = localStorage.getItem('currentUser');
    if (!user) {
        authModal.classList.remove('hidden');
    } else {
        accountDropdown.classList.toggle('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    socket.emit('logout');
});

switchFormButtons.forEach(button => {
    button.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = button.getAttribute('data-target'); 
        document.querySelectorAll('.authin').forEach(form => form.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    });
});

// Close all modals
document.querySelectorAll('.close-but').forEach(btn => {
    btn.addEventListener('click', () => {
        authModal.classList.add('hidden');
        editProfileModal.classList.add('hidden');
        const roomModals = ['create-chatroom', 'join-chatroom'];
        roomModals.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    });
});

document.getElementById('edit-profile-btn').addEventListener('click', () => {
    accountDropdown.classList.add('hidden');
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        document.getElementById('edit-name').value = currentUser.name;
        document.getElementById('edit-email').value = currentUser.email;
        editProfileModal.classList.remove('hidden');
    }
});

document.addEventListener('click', (e) => {
    if (!accountDropdown.classList.contains('hidden') && !e.target.closest('.account-menu-container')) {
        accountDropdown.classList.add('hidden');
    }
});

// --- UI HELPERS ---
function updateAccountButton() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser && currentUser.name) {
        accountButton.textContent = currentUser.name.charAt(0).toUpperCase();
        accountButton.style.backgroundColor = '#4f46e5';
        accountButton.style.color = 'white';
    } else {
        accountButton.textContent = '👤';
        accountButton.style.backgroundColor = '#e2e8f0';
        accountButton.style.color = 'black';
    }
}

// Ask the server the moment we connect
socket.on('connect', () => {
    socket.emit('checkAuthStatus');
});

socket.on('authStatus', (data) => {
    if (data.loggedIn) {
        console.log("User is authenticated:", data.user.name);
        // Update your UI: Hide login buttons, show account icon
        document.getElementById('login-btn').style.display = 'none';
        document.getElementById('account-info').textContent = data.user.name;
    } else {
        console.log("User is not logged in.");
        // Optional: Redirect to login page if they are on a protected page
        // window.location.href = 'index.html';
    }
});
// Initial UI Check
updateAccountButton();

// --- SOCKET LISTENERS (Supabase Sync) ---

// Automatically logged in via Supabase/Postgres Session
socket.on('sessionRestore', (data) => {
    if (data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        authModal.classList.add('hidden');
        updateAccountButton();
    }
});

socket.on('loginResponse', (res) => {
    if (res.success) {
        localStorage.setItem('currentUser', JSON.stringify(res.user));
        authModal.classList.add('hidden');
        updateAccountButton();
    } else {
        alert(res.message);
    }
});

socket.on('signupResponse', (res) => {
    if (res.success) {
        localStorage.setItem('currentUser', JSON.stringify(res.user));
        authModal.classList.add('hidden');
        updateAccountButton();
        alert(`Welcome, ${res.user.name}!`);
    } else {
        alert(res.message);
    }
});

socket.on('updateProfileResponse', (res) => {
    if (res.success) {
        localStorage.setItem('currentUser', JSON.stringify(res.user));
        alert("Profile Updated Successfully!");
        editProfileModal.classList.add('hidden');
        updateAccountButton();
    } else {
        alert("Update failed: " + res.message);
    }
});

socket.on('deleteResponse', (res) => {
    if (res.success) {
        localStorage.removeItem('currentUser');
        alert("Account permanently deleted.");
        window.location.href = 'index.html'; // Direct redirect on wipe
    } else {
        alert("Delete failed: " + res.message);
    }
});

socket.on('logoutConfirm', () => {
    localStorage.removeItem('currentUser');
    updateAccountButton();
    window.location.href = 'index.html';
});
