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

  function addPasswordControl(input) {
    if (input.dataset.passwordControlReady === 'true') return;
    input.dataset.passwordControlReady = 'true';
    const wrap = document.createElement('div');
    wrap.className = 'password-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i>';
    toggle.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(reveal));
      toggle.innerHTML = '<i class="fas fa-eye' + (reveal ? '-slash' : '') + '" aria-hidden="true"></i>';
      input.focus();
    });
    wrap.appendChild(toggle);

    if ((input.autocomplete === 'new-password' && !input.hasAttribute('data-match-password')) || input.hasAttribute('data-password-strength')) {
      input.dataset.passwordStrength = 'true';
      const feedback = document.createElement('div');
      feedback.className = 'password-strength';
      feedback.innerHTML = '<span class="password-strength-track" aria-hidden="true"><span></span></span>' +
        '<span class="password-strength-label" aria-live="polite">Use 6+ characters; a mix of letters and numbers is stronger.</span>';
      wrap.insertAdjacentElement('afterend', feedback);
      updatePasswordStrength(input);
    }

    if (input.hasAttribute('data-match-password')) {
      const note = document.createElement('span');
      note.className = 'password-match-note';
      note.setAttribute('aria-live', 'polite');
      const feedback = wrap.nextElementSibling;
      (feedback && feedback.classList.contains('password-strength') ? feedback : wrap)
        .insertAdjacentElement('afterend', note);
      updatePasswordMatch(input);
    }
  }

  function updatePasswordStrength(input) {
    const feedback = input.parentElement && input.parentElement.nextElementSibling;
    if (!feedback || !feedback.classList.contains('password-strength')) return;
    const value = input.value || '';
    const label = feedback.querySelector('.password-strength-label');
    const fill = feedback.querySelector('.password-strength-track > span');
    if (!value) {
      feedback.dataset.strength = '0';
      label.textContent = 'Use 6+ characters; a mix of letters and numbers is stronger.';
      fill.style.width = '0%';
      return;
    }
    let score = value.length >= 6 ? 1 : 0;
    if (value.length >= 8) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^a-zA-Z0-9]/.test(value)) score += 1;
    const state = score < 2 ? 'weak' : score < 3 ? 'fair' : score < 4 ? 'good' : 'strong';
    feedback.dataset.strength = state;
    fill.style.width = Math.max(12, score * 20) + '%';
    label.textContent = value.length < 6 ? 'Too short — use at least 6 characters.' :
      state.charAt(0).toUpperCase() + state.slice(1) + ' password';
  }

  function updatePasswordMatch(confirmInput) {
    const targetId = confirmInput.getAttribute('data-match-password');
    const password = targetId && document.getElementById(targetId);
    const note = confirmInput.parentElement &&
      (confirmInput.parentElement.nextElementSibling?.classList.contains('password-strength')
        ? confirmInput.parentElement.nextElementSibling.nextElementSibling
        : confirmInput.parentElement.nextElementSibling);
    if (!password || !note || !note.classList.contains('password-match-note')) return true;
    const value = confirmInput.value;
    if (!value) {
      confirmInput.classList.remove('is-invalid', 'is-valid');
      confirmInput.removeAttribute('aria-invalid');
      note.textContent = '';
      note.dataset.state = '';
      return false;
    }
    const matches = value === password.value;
    confirmInput.classList.toggle('is-invalid', !matches);
    confirmInput.classList.toggle('is-valid', matches);
    confirmInput.setAttribute('aria-invalid', String(!matches));
    note.dataset.state = matches ? 'match' : 'mismatch';
    note.textContent = matches ? 'Passwords match.' : 'Passwords do not match.';
    return matches;
  }

  function watchPasswordControls() {
    const enhance = (root) => {
      if (root.matches && root.matches('input[type="password"]')) addPasswordControl(root);
      root.querySelectorAll?.('input[type="password"]').forEach(addPasswordControl);
    };
    enhance(document);
    new MutationObserver((records) => records.forEach((record) =>
      record.addedNodes.forEach((node) => { if (node.nodeType === 1) enhance(node); })
    )).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('input', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.dataset.passwordStrength === 'true') updatePasswordStrength(input);
      if (input.hasAttribute('data-match-password')) updatePasswordMatch(input);
      if (input.type === 'password' || input.dataset.passwordStrength === 'true') {
        document.querySelectorAll('[data-match-password]').forEach(updatePasswordMatch);
      }
    });
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
            <div class="form-group"><label for="forgot-new-password">New password</label><input class="form-input" id="forgot-new-password" type="password" minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></div>
            <div class="form-group"><label for="forgot-confirm-password">Confirm new password</label><input class="form-input" id="forgot-confirm-password" type="password" minlength="6" autocomplete="new-password" data-match-password="forgot-new-password" placeholder="Repeat your new password"></div>
            <button type="button" class="btn btn-primary btn-block" id="forgot-submit">Set new password</button></div>
          <p class="auth-switch"><a href="#" id="forgot-back">Back to sign in</a></p>
        </div>
        <form id="reg-form" class="auth-modal-view">
          <span class="auth-modal-kicker">Join the neighborhood</span><h2 id="auth-modal-title-register">Create your account</h2>
          <p class="auth-modal-sub">A quicker checkout and all your orders in one place.</p><div id="reg-error" class="auth-error"></div>
          <div class="form-row"><div class="form-group"><label for="reg-name">Full name</label><input class="form-input" id="reg-name" required autocomplete="name" placeholder="Your name"></div><div class="form-group"><label for="reg-contact">Mobile number</label><input class="form-input" id="reg-contact" required inputmode="numeric" maxlength="11" placeholder="09XXXXXXXXX"></div></div>
          <div class="form-group"><label for="reg-email">Gmail address</label><input class="form-input" id="reg-email" type="email" required autocomplete="username" placeholder="you@gmail.com"></div>
          <div class="form-group"><label for="reg-address">Delivery address</label><textarea class="form-textarea" id="reg-address" required autocomplete="street-address" placeholder="House number, street, barangay, city"></textarea></div>
          <div class="form-group"><label for="reg-password">Password</label><input class="form-input" id="reg-password" type="password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></div>
          <div class="form-group"><label for="reg-confirm">Confirm password</label><input class="form-input" id="reg-confirm" type="password" required minlength="6" autocomplete="new-password" data-match-password="reg-password" placeholder="Repeat password"></div>
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
    watchPasswordControls();
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
      const signoutHtml =
        '<button type="button" class="btn btn-signout btn-sm" data-signout>' +
        t('nav.signout') +
        '</button>';

      document.querySelectorAll('.auth-buttons').forEach((box) => {
        if (token()) {
          box.innerHTML =
            '<a href="dashboard.html" class="btn btn-outline btn-sm">' + t('nav.dashboard') + '</a> ' +
            signoutHtml;
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
            signoutHtml
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
        if (!email) { fmsg('Please enter your email address.'); return; }
        try {
          await api.otpSend(email, 'RESET');
          widget.cooldown(60);
          document.getElementById('forgot-otp-wrap').style.display = 'block';
          fmsg(t('au.reset_sent'), true);
        } catch (err) {
          document.getElementById('forgot-otp-wrap').style.display = 'none';
          fmsg(err.message || 'No account found with this email address.');
        }
      }

      document.getElementById('forgot-submit').addEventListener('click', async (e) => {
        const email = document.getElementById('forgot-email').value.trim().toLowerCase();
        const code = widget.code();
        const pw = document.getElementById('forgot-new-password').value;
        const confirm = document.getElementById('forgot-confirm-password').value;
        if (code.length !== 6) { fmsg(t('co.otp_bad')); return; }
        if (!pw || pw.length < 6) { fmsg('Password must be at least 6 characters.'); return; }
        if (pw !== confirm) { fmsg('Passwords do not match.'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await api.otpVerify(email, 'RESET', code);
          await api.memberReset(email, pw);
          fmsg(t('au.reset_ok'), true);
          ['forgot-new-password', 'forgot-confirm-password'].forEach((id) => {
            const field = document.getElementById(id);
            field.value = '';
            field.dispatchEvent(new Event('input', { bubbles: true }));
          });
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
      const showErr = (m, isHtml) => {
        if (isHtml) errBox.innerHTML = m;
        else errBox.textContent = m;
        errBox.style.display = 'block';
      };

      const showNoticeEmailExists = () => {
        showErr(
          '<div class="auth-notice-card">' +
          '<i class="fas fa-info-circle"></i>' +
          '<div>' +
          '<strong>Account already registered</strong>' +
          '<p>This email already has an account in our database. Please sign in instead of registering.</p>' +
          '<button type="button" class="btn btn-primary btn-sm" data-auth-open="login" style="margin-top:0.4rem;">' +
          '<i class="fas fa-sign-in-alt"></i> Go to Sign In</button>' +
          '</div></div>',
          true
        );
        const otpSec = document.getElementById('reg-otp-section');
        if (otpSec) otpSec.style.display = 'none';
      };

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
        const password = document.getElementById('reg-password').value;
        if (password.length < 6) { showErr('Password must be at least 6 characters.'); return; }
        if (password !== document.getElementById('reg-confirm').value) { showErr('Passwords do not match.'); return; }
        
        const sendBtn = document.getElementById('reg-send-otp');
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking & sending code...';
        }
        try {
          await api.otpSend(email, 'REGISTER');
          widget.cooldown(60);
          document.getElementById('reg-otp-section').style.display = 'block';
          errBox.style.display = 'none';
        } catch (err) {
          if (err.code === 'EMAIL_EXISTS' || (err.message && err.message.toLowerCase().includes('already exists'))) {
            showNoticeEmailExists();
          } else {
            showErr(err.message);
          }
        } finally {
          if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = 'Send verification code';
          }
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
          if (err.code === 'EMAIL_EXISTS' || (err.message && err.message.toLowerCase().includes('already exists'))) {
            showNoticeEmailExists();
          } else {
            showErr(err.message);
          }
        } finally {
          btn.disabled = false;
        }
      });
    }
  });

  window.ShopAuth = { token, setSession, clear, logout, mergeGuestCart };
})(window, document);
