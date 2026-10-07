/**
 * Member sessions + login/register pages (auth.js).
 *
 * WHAT: Token storage, nav auth-buttons on every page, login (with RESET-OTP
 * forgot flow), registration (REGISTER OTP then merge guest cart), logout.
 * ShopAPI picks up the token automatically; pages just call ShopAuth.token()
 * to branch guest/member behavior.
 */
(function (window, document) {
  'use strict';

  const TOKEN_KEY = 'webake_member_token';
  const NAME_KEY = 'webake_member_name';

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setSession(tok, name) {
    localStorage.setItem(TOKEN_KEY, tok);
    localStorage.setItem(NAME_KEY, name || '');
  }

  function clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
  }

  function logout() {
    clear();
    window.location.href = 'home.html';
  }

  /** Merge the anonymous browser cart into the member's DB cart at sign-in. */
  async function mergeGuestCart() {
    let guest = [];
    try {
      guest = JSON.parse(localStorage.getItem('webake_cart') || '[]');
    } catch { guest = []; }
    if (!guest.length) return;
    try {
      await window.ShopAPI.cartPut(guest, true);
      localStorage.removeItem('webake_cart');
    } catch { /* member keeps both; dashboard shows the server cart */ }
  }

  function ensureAuthModal() {
    if (document.getElementById('auth-modal') || document.getElementById('login-form')) return;
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'auth-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <button class="auth-modal-backdrop" type="button" data-auth-close aria-label="Close dialog"></button>
      <section class="auth-modal-panel" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <button class="auth-modal-close" type="button" data-auth-close aria-label="Close"><i class="fas fa-times"></i></button>
        <div class="auth-modal-brand"><img src="../img/webake-logo.png" alt="WeBake"><span>Fresh from our oven to you</span></div>
        <form id="login-form" class="auth-modal-view">
          <span class="auth-modal-kicker">Welcome back</span><h2 id="auth-modal-title">Sign in to WeBake</h2>
          <p class="auth-modal-sub">Your favorites and orders, all in one place.</p>
          <div id="login-error" class="auth-error"></div>
          <div class="form-group"><label for="login-email">Email address</label><input class="form-input" id="login-email" type="email" required autocomplete="username" placeholder="you@example.com"></div>
          <div class="form-group"><label for="login-password">Password</label><input class="form-input" id="login-password" type="password" required autocomplete="current-password" placeholder="Enter your password"></div>
          <button type="submit" class="btn btn-primary btn-block" id="btn-login">Sign In <i class="fas fa-arrow-right"></i></button>
          <p class="auth-switch"><a href="#" id="forgot-toggle">Forgot password?</a></p>
          <p class="auth-switch">New to WeBake? <a href="#" data-auth-open="register">Create an account</a></p>
        </form>
        <div id="forgot-box" class="auth-modal-view">
          <span class="auth-modal-kicker">Account help</span><h2>Reset your password</h2>
          <p class="auth-modal-sub">We’ll email you a 6-digit verification code.</p><div id="forgot-msg" class="auth-error"></div>
          <div class="form-group"><label for="forgot-email">Email address</label><input class="form-input" id="forgot-email" type="email" autocomplete="username" placeholder="you@example.com"></div>
          <button type="button" class="btn btn-outline btn-block" id="forgot-send">Send verification code</button>
          <div id="forgot-otp-wrap"><div class="otp-inputs"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"></div>
            <p class="auth-timer"><span id="forgot-timer-wrap">Resend in <strong id="forgot-timer">60</strong>s</span><a href="#" id="forgot-resend" style="display:none">Resend code</a></p>
            <div class="form-group"><label for="forgot-new-password">New password</label><input class="form-input" id="forgot-new-password" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
            <button type="button" class="btn btn-primary btn-block" id="forgot-submit">Set new password</button></div>
          <p class="auth-switch"><a href="#" id="forgot-back">Back to sign in</a></p>
        </div>
        <form id="reg-form" class="auth-modal-view">
          <span class="auth-modal-kicker">Join the neighborhood</span><h2 id="auth-modal-title-register">Create your account</h2>
          <p class="auth-modal-sub">A quicker checkout and all your orders in one place.</p><div id="reg-error" class="auth-error"></div>
          <div class="form-row"><div class="form-group"><label for="reg-name">Full name</label><input class="form-input" id="reg-name" required autocomplete="name" placeholder="Your name"></div><div class="form-group"><label for="reg-contact">Mobile number</label><input class="form-input" id="reg-contact" required inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX"></div></div>
          <div class="form-group"><label for="reg-email">Gmail address</label><input class="form-input" id="reg-email" type="email" required autocomplete="username" placeholder="you@gmail.com"></div>
          <div class="form-group"><label for="reg-address">Delivery address</label><textarea class="form-textarea" id="reg-address" required autocomplete="street-address" placeholder="House number, street, barangay, city"></textarea></div>
          <div class="form-row"><div class="form-group"><label for="reg-password">Password</label><input class="form-input" id="reg-password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></div><div class="form-group"><label for="reg-confirm">Confirm password</label><input class="form-input" id="reg-confirm" type="password" required minlength="6" autocomplete="new-password" placeholder="Repeat password"></div></div>
          <button type="button" class="btn btn-outline btn-block" id="reg-send-otp">Send verification code</button>
          <div id="reg-otp-section"><div class="auth-verify-note"><i class="fas fa-envelope-open-text"></i><span>Enter the 6-digit code we sent to your email.</span></div><div class="otp-inputs"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"><input class="otp-input form-input" inputmode="numeric" maxlength="1"></div><p class="auth-timer"><span id="reg-timer-wrap">Resend in <strong id="reg-timer">60</strong>s</span><a href="#" id="reg-resend" style="display:none">Resend code</a></p><button type="submit" class="btn btn-primary btn-block" id="reg-submit">Verify &amp; create account <i class="fas fa-arrow-right"></i></button></div>
          <p class="auth-switch">Already have an account? <a href="#" data-auth-open="login">Sign in</a></p>
        </form>
      </section>`;
    document.body.appendChild(modal);

    const setView = (name) => {
      modal.querySelectorAll('.auth-modal-view').forEach((view) => view.classList.remove('is-current'));
      const view = modal.querySelector(name === 'register' ? '#reg-form' : name === 'forgot' ? '#forgot-box' : '#login-form');
      if (view) view.classList.add('is-current');
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      window.setTimeout(() => view && (view.querySelector('input') || view.querySelector('button'))?.focus(), 80);
    };
    const close = () => { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open'); };
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-auth-open]');
      if (trigger) { e.preventDefault(); document.getElementById('nav-links')?.classList.remove('open'); setView(trigger.dataset.authOpen); }
      if (e.target.closest('[data-auth-close]')) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('is-open')) close(); });
    window.ShopAuthModal = { open: setView, close };
    const params = new URLSearchParams(window.location.search);
    if (params.has('email')) modal.querySelector('#reg-email').value = params.get('email');
    if (params.has('auth')) window.setTimeout(() => setView(params.get('auth') === 'register' ? 'register' : 'login'), 0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname.toLowerCase();
    if (path.endsWith('/login.html') || path.endsWith('/register.html')) {
      const params = new URLSearchParams(window.location.search);
      params.set('auth', path.endsWith('/register.html') ? 'register' : 'login');
      window.location.replace('home.html?' + params.toString());
      return;
    }
    ensureAuthModal();
    const U = window.WeBakeUtils;
    const t = (k, v) => window.WB_I18N.t(k, v);
    const api = window.ShopAPI;

    renderAuthButtons();

    function renderAuthButtons() {
      document.querySelectorAll('.auth-buttons').forEach((box) => {
        if (token()) {
          box.innerHTML =
            '<a href="dashboard.html" class="btn btn-outline btn-sm">' + t('nav.dashboard') + '</a> ' +
            '<button type="button" class="btn btn-primary btn-sm" data-signout>' + t('nav.signout') + '</button>';
        } else {
          box.innerHTML =
            '<button type="button" data-auth-open="login" class="btn btn-outline btn-sm">' + t('nav.signin') + '</button> ' +
            '<button type="button" data-auth-open="register" class="btn btn-primary btn-sm">' + t('nav.register') + '</button>';
        }
      });
      document.querySelectorAll('.nav-links').forEach((box) => {
        let mobileAuth = box.querySelector('.nav-auth-mobile');
        if (!mobileAuth) {
          mobileAuth = document.createElement('div');
          mobileAuth.className = 'nav-auth-mobile';
          box.appendChild(mobileAuth);
        }
        mobileAuth.innerHTML = token()
          ? '<a href="dashboard.html" class="btn btn-outline btn-sm">' + t('nav.dashboard') + '</a>' +
            '<button type="button" class="btn btn-primary btn-sm" data-signout>' + t('nav.signout') + '</button>'
          : '<a href="#" data-auth-open="login" class="btn btn-outline btn-sm">' + t('nav.signin') + '</a>' +
            '<a href="#" data-auth-open="register" class="btn btn-primary btn-sm">' + t('nav.register') + '</a>';
      });
      document.querySelectorAll('[data-signout]').forEach((b) => {
        b.addEventListener('click', logout);
      });
    }

    /* ---------------- login.html ---------------- */

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      if (token() && !loginForm.closest('.auth-modal')) { window.location.href = 'dashboard.html'; return; }
      const errBox = document.getElementById('login-error');
      const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'block'; };

      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        const btn = document.getElementById('btn-login');
        btn.disabled = true;
        try {
          const res = await api.memberLogin(
            document.getElementById('login-email').value.trim().toLowerCase(),
            document.getElementById('login-password').value
          );
          setSession(res.token, res.member && (res.member.name || res.member.full_name));
          await mergeGuestCart();
          U.toast(t('au.welcome'));
          const next = new URLSearchParams(window.location.search).get('next');
          window.location.href = next || 'dashboard.html';
        } catch (err) {
          showErr(err.message);
        } finally {
          btn.disabled = false;
        }
      });

      // Forgot flow: RESET OTP -> new password -> sign in.
      const forgotBox = document.getElementById('forgot-box');
      document.getElementById('forgot-toggle').addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        forgotBox.style.display = 'block';
      });
      document.getElementById('forgot-back').addEventListener('click', (e) => {
        e.preventDefault();
        forgotBox.style.display = 'none';
        loginForm.style.display = '';
      });

      const widget = window.OtpWidget.attach({
        root: '#forgot-box',
        timerWrap: '#forgot-timer-wrap',
        timerEl: '#forgot-timer',
        resendBtn: '#forgot-resend',
        onResend: () => sendResetOtp(true),
      });
      const fmsg = (m, ok) => {
        const el = document.getElementById('forgot-msg');
        el.textContent = m;
        el.style.display = 'block';
        el.style.color = ok ? 'var(--success)' : 'var(--danger)';
      };

      document.getElementById('forgot-send').addEventListener('click', () => sendResetOtp(false));

      async function sendResetOtp(isResend) {
        const email = document.getElementById('forgot-email').value.trim().toLowerCase();
        if (!email) { fmsg(t('au.reset_sent')); return; }
        try {
          await api.otpSend(email, 'RESET');
          widget.cooldown(60);
          document.getElementById('forgot-otp-wrap').style.display = 'block';
          fmsg(t('au.reset_sent'), true);
        } catch (err) {
          fmsg(err.message);
        }
      }

      document.getElementById('forgot-submit').addEventListener('click', async (e) => {
        const email = document.getElementById('forgot-email').value.trim().toLowerCase();
        const code = widget.code();
        const pw = document.getElementById('forgot-new-password').value;
        if (code.length !== 6) { fmsg(t('co.otp_bad')); return; }
        if (!pw || pw.length < 6) { fmsg('Password must be at least 6 characters.'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api.otpVerify(email, 'RESET', code);
          await api.memberReset(email, pw);
          fmsg(t('au.reset_ok'), true);
          document.getElementById('forgot-new-password').value = '';
        } catch (err) {
          fmsg(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /* ---------------- register.html ---------------- */

    const regForm = document.getElementById('reg-form');
    if (regForm) {
      if (token() && !regForm.closest('.auth-modal')) { window.location.href = 'dashboard.html'; return; }
      const prefill = new URLSearchParams(window.location.search).get('email');
      if (prefill) document.getElementById('reg-email').value = prefill;

      const errBox = document.getElementById('reg-error');
      const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'block'; };
      const widget = window.OtpWidget.attach({
        root: '#reg-otp-section',
        timerWrap: '#reg-timer-wrap',
        timerEl: '#reg-timer',
        resendBtn: '#reg-resend',
        onResend: () => sendRegisterOtp(true),
      });

      document.getElementById('reg-send-otp').addEventListener('click', () => sendRegisterOtp(false));

      async function sendRegisterOtp(isResend) {
        const email = document.getElementById('reg-email').value.trim().toLowerCase();
        if (!email) { showErr(t('au.reset_sent')); return; }
        try {
          await api.otpSend(email, 'REGISTER');
          widget.cooldown(60);
          document.getElementById('reg-otp-section').style.display = 'block';
          errBox.style.display = 'none';
        } catch (err) {
          showErr(err.message);
        }
      }

      regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.style.display = 'none';
        const code = widget.code();
        if (code.length !== 6) { showErr(t('co.otp_bad')); return; }
        const pw = document.getElementById('reg-password').value;
        if (pw !== document.getElementById('reg-confirm').value) {
          showErr('Passwords do not match.');
          return;
        }
        const btn = document.getElementById('reg-submit');
        btn.disabled = true;
        try {
          const email = document.getElementById('reg-email').value.trim().toLowerCase();
          await api.otpVerify(email, 'REGISTER', code);
          const res = await api.register({
            name: document.getElementById('reg-name').value.trim(),
            email,
            password: pw,
            contact: document.getElementById('reg-contact').value.trim(),
            address: document.getElementById('reg-address').value.trim(),
          });
          setSession(res.token, res.member && (res.member.name || res.member.full_name));
          await mergeGuestCart();
          U.toast(t('au.registered'));
          window.location.href = 'dashboard.html';
        } catch (err) {
          showErr(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    }
  });

  window.ShopAuth = { token, setSession, clear, logout, mergeGuestCart };
})(window, document);
