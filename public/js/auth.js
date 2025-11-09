// Simple auth UI helper

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/user/me', { credentials: 'include' });
    if (res.ok) {
      const user = await res.json();
      onLoggedIn(user);
    } else {
      onLoggedOut();
    }
  } catch (err) {
    // Likely server not available or not connected to DB
    onLoggedOut();
  }
}

function onLoggedIn(user) {
  document.getElementById('loginBtn').style.display = 'none';
  const logout = document.getElementById('logoutBtn');
  logout.style.display = 'inline-block';
  logout.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = '/auth/logout';
  });
}

function onLoggedOut() {
  document.getElementById('loginBtn').style.display = 'inline-block';
  const logout = document.getElementById('logoutBtn');
  logout.style.display = 'none';
  document.getElementById('loginBtn').addEventListener('click', (e) => {
    e.preventDefault();
    // Open Frontier OAuth
    window.location.href = '/auth/frontier';
  });
}

// Initialize
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
  });
}
