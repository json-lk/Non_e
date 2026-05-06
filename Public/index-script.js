const URL = "https://non-e.onrender.com"; 
const socket = io(URL, {
    withCredentials: true,
    transports: ["websocket", "polling"]
});

const signupBtn = document.getElementById('signup-btn');
const loginBtn = document.getElementById('login-btn');
const authModal = document.getElementById('auth');
const closeBut = document.querySelector('.close-but');
const loginForm = document.getElementById('logins');
const signupForm = document.getElementById('signups');
const switchForms = document.querySelectorAll('.switch-process');

signupBtn.addEventListener('click', (e) => {
  e.preventDefault();
  authModal.classList.remove('hidden');
  loginForm.classList.remove('hidden');
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
  if (e.target === authModal) {
    authModal.classList.add('hidden');
  }
});

switchForms.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const target = btn.getAttribute('data-target');
    document.querySelectorAll('.authin').forEach(form => form.classList.remove('active'));
    document.getElementById(target).classList.add('active');
  });
});

socket.on('signupResponse', (response) => {
    if (response.success) {
        const userData = {
            name: response.user.name,
            email: response.user.email
        };
        
        localStorage.setItem('currentUser', JSON.stringify(userData));

        alert("Welcome, " + response.user.name + "! Logging you in...");

        window.location.href = 'This page.html'; 
    } else {
        alert("Signup failed: " + response.message);
    }
});

signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = signupForm.querySelector('input[type="text"]').value;
    const email = signupForm.querySelector('input[type="email"]').value;
    const password = signupForm.querySelectorAll('input[type="password"]')[0].value;
    
    socket.emit('signup', { name, email, password });
});

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const email = loginForm.querySelector('input[type="email"]').value;
  const password = loginForm.querySelector('input[type="password"]').value;

  socket.emit('login', { email, password });
  socket.on('loginResponse', (res) => {
    if (res.success) {
        localStorage.setItem('currentUser', JSON.stringify(res.user));
        window.location.href = 'This page.html'; 
    } else {
        alert(res.message);
    }
});
});
