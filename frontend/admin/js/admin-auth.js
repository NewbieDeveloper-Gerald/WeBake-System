/**
 * admin-auth: session state + the login / reset pages.
 *
 * WHAT: Stores the JWT + owner email, guards authed pages (no token -> login),
 * fills the sidebar profile, wires logout, and runs the login / forgot /
 * reset forms. One file because all three are the same session lifecycle.
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'webake_admin_token';
  const EMAIL_KEY = 'webake_admin_email';

  function setSession(token, email) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EMAIL_KEY, email || '');
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
  }

  function logout() {
    clearSession();
    location.href = 'login.html';
  }

  function initials(email) {
    const name = String(email || '?').split('@')[0].replace(/[^a-zA-Z]/g, '');
    return (name.slice(0, 2) || 'OW').toUpperCase();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const resetForm = document.getElementById('reset-form');

    // --- login.html ---
    if (loginForm) {
      // Already signed in? Skip the form.
      if (localStorage.getItem(TOKEN_KEY)) {
        location.href = 'dashboard.html';
        return;
      }
      const errBox = document.getElementById('login-error');
      const okBox = document.getElementById('login-ok');
      const forgotForm = document.getElementById('forgot-form');
      const showErr = (m) => { okBox.classList.remove('show'); errBox.textContent = m; errBox.classList.add('show'); };
      const showOk = (m) => { errBox.classList.remove('show'); okBox.textContent = m; okBox.classList.add('show'); };

      document.getElementById('forgot-toggle').addEventListener('click', (e) => {
        e.preventDefault();
        errBox.classList.remove('show'); okBox.classList.remove('show');
        loginForm.style.display = 'none';
        forgotForm.style.display = 'block';
      });
      document.getElementById('back-to-login').addEventListener('click', (e) => {
        e.preventDefault();
        forgotForm.style.display = 'none';
        loginForm.style.display = '';
      });

      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-login');
        btn.disabled = true;
        try {
          const data = await window.AdminAPI.login(
            document.getElementById('login-email').value.trim(),
            document.getElementById('login-password').value
          );
          setSession(data.token, data.admin && data.admin.email);
          location.href = 'dashboard.html';
        } catch (err) {
          showErr(err.message || 'Sign in failed.');
          btn.disabled = false;
        }
      });

      forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-forgot');
        btn.disabled = true;
        try {
          await window.AdminAPI.forgotPassword(
            document.getElementById('forgot-email').value.trim()
          );
          // Uniform message: never reveal whether the email exists.
          showOk('If this email is registered, a reset link is on its way (valid 30 minutes).');
        } catch (err) {
          showErr(err.message || 'Could not send the reset link.');
        } finally {
          btn.disabled = false;
        }
      });
      return;
    }

    // --- reset.html ---
    if (resetForm) {
      const msg = document.getElementById('reset-msg');
      const token = new URLSearchParams(location.search).get('token') || '';
      if (!token) {
        msg.textContent = 'This reset link is missing its token. Please request a new one from the sign-in page.';
        msg.classList.add('show', 'error');
        document.getElementById('btn-reset').disabled = true;
        return;
      }
      resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = document.getElementById('reset-password').value;
        const confirm = document.getElementById('reset-confirm').value;
        if (pw !== confirm) {
          msg.textContent = 'Passwords do not match.';
          msg.className = 'reset-msg show error';
          return;
        }
        const btn = document.getElementById('btn-reset');
        btn.disabled = true;
        try {
          await window.AdminAPI.resetPassword(token, pw);
          msg.textContent = 'Password reset. You can now sign in with the new password.';
          msg.className = 'reset-msg show ok';
          resetForm.querySelectorAll('input').forEach((i) => { i.disabled = true; });
        } catch (err) {
          msg.textContent = err.message || 'Reset failed. The link may have expired.';
          msg.className = 'reset-msg show error';
          btn.disabled = false;
        }
      });
      return;
    }

    // --- authed pages: fill profile + wire logout (guard lives in admin-main) ---
    window.AdminAuth = { logout, setSession, clearSession };
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Legacy shells hardcode a staff card; refresh it from the session.
    const email = localStorage.getItem(EMAIL_KEY) || '';
    const nameEl = document.getElementById('staff-email');
    const avEl = document.getElementById('staff-initials');
    // Legacy shells use different markup (.staff-name, .staff-avatar).
    const legacyName = document.querySelector('.staff-details .staff-name');
    const legacyAvatar = document.querySelector('.staff-avatar');
    window.AdminAPI.me()
      .then((data) => {
        const em = (data.admin && data.admin.email) || email;
        if (nameEl) nameEl.textContent = em;
        if (avEl) avEl.textContent = initials(em);
        if (legacyName) legacyName.textContent = em;
        if (legacyAvatar) legacyAvatar.textContent = initials(em);
      })
      .catch(() => { /* 401 auto-redirects via AdminAPI */ });
  });
})();
