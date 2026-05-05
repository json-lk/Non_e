// 1. Initialize Socket correctly for Cross-Origin
const URL = "https://non-e.onrender.com"; 
const socket = io(URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
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

// --- AUTH SUBMISSIONS ---

// Login
document.getElementById('logins').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = e.target.querySelector('input[type="email"]').value;
    const password = e.target.querySelector('input[type="password"]').value;
    socket.emit('login', { email, password });
});

// Signup
document.getElementById('signups').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.querySelector('input[type="text"]').value;
    const email = e.target.querySelector('input[type="email"]').value;
    const password = e.target.querySelectorAll('input[type="password"]')[0].value;
    socket.emit('signup', { name, email, password });
});

// Update Profile
document.getElementById('edit-profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) return;

    socket.emit('updateProfile', {
        oldEmail: currentUser.email,
        newName: document.getElementById('edit-name').value,
        newEmail: document.getElementById('edit-email').value,
        newPassword: document.getElementById('edit-password').value
    });
});

// Delete Account (Permanent MongoDB Wipe)
document.getElementById('delusr').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm("⚠️ Delete account permanently? This cannot be undone.")) {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        socket.emit('deleteAccount', user.email);
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
        // Close room modals if they exist on this page
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

// Initial UI Check
updateAccountButton();

// --- SOCKET LISTENERS (MongoDB Sync) ---

// Automatically logged in via MongoDB Session
socket.on('sessionRestore', (data) => {
    if (data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        authModal.classList.add('hidden');
        updateAccountButton();
        console.log("Welcome back, " + data.user.name);
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
        alert("Account deleted.");
        location.reload();
    }
});

socket.on('logoutConfirm', () => {
    localStorage.removeItem('currentUser');
    updateAccountButton();
    window.location.href = 'index.html';
});
