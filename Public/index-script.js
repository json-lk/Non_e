// 1. Initialize Socket
const URL = "https://non-e.onrender.com"; 
const socket = io(URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
});

// --- SELECTORS ---
const signupBtn = document.getElementById('signup-btn');
const loginBtn = document.getElementById('login-btn');
const authModal = document.getElementById('auth');
const closeBut = document.querySelector('.close-but');
const loginForm = document.getElementById('logins');
const signupForm = document.getElementById('signups');
const switchForms = document.querySelectorAll('.switch-process');

// --- MODAL TOGGLES ---
signupBtn.addEventListener('click', (e) => {
    e.preventDefault();
    authModal.classList.remove('hidden');
    loginForm.classList.remove('active'); // Reset active state
    signupForm.classList.add('active');
});

loginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    authModal.classList.remove('hidden');
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
});

closeBut.addEventListener('click', () => {
    authModal.classList.add('hidden');
});

authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
});

switchForms.forEach((btn) => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const target = btn.getAttribute('data-target');
        document.querySelectorAll('.authin').forEach(form => form.classList.remove('active'));
        document.getElementById(target).classList.add('active');
    });
});

// --- AUTH LOGIC (SUPABASE INTEGRATION) ---

// 1. Handle Signup Form Submission
signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = signupForm.querySelector('input[type="text"]').value;
    const email = signupForm.querySelector('input[type="email"]').value;
    const password = signupForm.querySelectorAll('input[type="password"]')[0].value;
    
    socket.emit('signup', { name, email, password });
});

// 2. Handle Login Form Submission
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = loginForm.querySelector('input[type="email"]').value;
    const password = loginForm.querySelector('input[type="password"]').value;

    socket.emit('login', { email, password });
});

// --- SOCKET RESPONSES (Listeners kept outside to prevent memory leaks) ---

// Handle Signup Response
socket.on('signupResponse', (response) => {
    if (response.success) {
        localStorage.setItem('currentUser', JSON.stringify(response.user));
        window.location.href = 'This page.html'; // Ensure this matches your file name
    } else {
        alert("Signup failed: " + response.message);
    }
});

socket.on('loginResponse', (res) => {
    if (res.success) {
        localStorage.setItem('currentUser', JSON.stringify(res.user));
        window.location.href = 'This page.html'; 
    } else {
        alert(res.message);
    }
});

// Handle Session Restoration (If user is already logged in via Supabase)
socket.on('sessionRestore', (data) => {
    if (data.user) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        // Optional: Auto-redirect if they land on index while already logged in
        // window.location.href = 'This page.html';
    }
});
