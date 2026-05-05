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
