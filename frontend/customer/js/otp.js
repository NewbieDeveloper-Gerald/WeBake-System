/**
 * OtpWidget: reusable 6-box code entry + resend cooldown (otp.js).
 *
 * WHAT: Auto-advance, backspace-back, whole-code paste, 60s resend timer.
 * attach() wires any container holding .otp-input boxes; the page supplies
 * onVerify(code) and onResend(). Used by checkout, register, member reset.
 */
(function (window, document) {
  'use strict';

  function attach(opts) {
    const root = typeof opts.root === 'string'
      ? document.querySelector(opts.root) : opts.root;
    const boxes = [...root.querySelectorAll('.otp-input')];
    const timerWrap = opts.timerWrap ? document.querySelector(opts.timerWrap) : null;
    const timerEl = opts.timerEl ? document.querySelector(opts.timerEl) : null;
    const resendBtn = opts.resendBtn ? document.querySelector(opts.resendBtn) : null;
    let seconds = 0;
    let tick = null;

    function code() {
      return boxes.map((b) => b.value.trim()).join('');
    }

    function clear() {
      boxes.forEach((b) => { b.value = ''; });
      boxes[0].focus();
    }

    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(0, 1);
        if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
        // Auto-submit once all six boxes are filled.
        if (code().length === boxes.length && opts.onVerify) opts.onVerify(code());
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
      });
      // Pasting "123456" spreads one digit per box.
      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, boxes.length);
        digits.split('').forEach((d, j) => { if (boxes[j]) boxes[j].value = d; });
        const next = boxes[Math.min(digits.length, boxes.length - 1)];
        next.focus();
        if (code().length === boxes.length && opts.onVerify) opts.onVerify(code());
      });
    });

    function cooldown(sec) {
      seconds = sec || 60;
      if (timerWrap) timerWrap.style.display = '';
      if (resendBtn) resendBtn.style.display = 'none';
      window.clearInterval(tick);
      tick = window.setInterval(() => {
        seconds -= 1;
        if (timerEl) timerEl.textContent = seconds;
        if (seconds <= 0) {
          window.clearInterval(tick);
          if (timerWrap) timerWrap.style.display = 'none';
          if (resendBtn) {
            resendBtn.style.display = '';
            resendBtn.innerHTML = '<i class="fas fa-redo-alt"></i> ' +
              ((window.WB_I18N && window.WB_I18N.t('c.resend')) || 'Resend OTP');
          }
        }
      }, 1000);
    }

    if (resendBtn && opts.onResend) {
      resendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        opts.onResend();
      });
    }

    return { code, clear, cooldown };
  }

  window.OtpWidget = { attach };
})(window, document);
