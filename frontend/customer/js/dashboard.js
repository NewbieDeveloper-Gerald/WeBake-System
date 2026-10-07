/**
 * Member dashboard (dashboard.js). Runs dashboard.html for signed-in members.
 *
 * WHAT: Profile view/edit, server cart display, order history with track
 * links, and an injected change-password card. Guests bounce to login.
 */
(function (window, document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('profile-form')) return; // dashboard only

    const U = window.WeBakeUtils;
    const api = window.ShopAPI;

    if (!window.ShopAuth.token()) {
      window.location.href = 'home.html?auth=login&next=dashboard.html';
      return;
    }

    const sessionName = localStorage.getItem('webake_member_name') || '';
    if (sessionName) {
      document.getElementById('dash-name').value = sessionName;
      const greetingName = document.getElementById('dashboard-member-name');
      if (greetingName) greetingName.textContent = sessionName;
    }

    // Change-password card (injected: the shell predates the endpoint).
    const grid = document.querySelector('.dashboard-grid');
    const pwCard = document.createElement('div');
    pwCard.className = 'dash-card';
    pwCard.innerHTML =
      '<div class="dash-card-title"><i class="fas fa-key"></i> Change Password</div>' +
      '<form id="pw-form"><div class="profile-grid">' +
      '<div class="form-group"><label class="dash-label">Current password</label>' +
      '<input type="password" class="form-input" id="cp-current" required autocomplete="current-password"></div>' +
      '<div class="form-group"><label class="dash-label">New password (min 6)</label>' +
      '<input type="password" class="form-input" id="cp-new" required minlength="6" autocomplete="new-password"></div>' +
      '<div class="form-group"><label class="dash-label" for="cp-confirm">Confirm new password</label>' +
      '<input type="password" class="form-input" id="cp-confirm" required minlength="6" autocomplete="new-password" data-match-password="cp-new"></div>' +
      '</div><button type="submit" class="btn btn-primary btn-sm">Change password</button> ' +
      '<span id="cp-msg"></span></form>';
    grid.appendChild(pwCard);

    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cp-msg');
      const newPassword = document.getElementById('cp-new').value;
      if (newPassword.length < 6) {
        msg.textContent = 'New password must be at least 6 characters.';
        msg.style.color = 'var(--danger)';
        return;
      }
      if (newPassword !== document.getElementById('cp-confirm').value) {
        msg.textContent = 'New passwords do not match.';
        msg.style.color = 'var(--danger)';
        return;
      }
      try {
        await api.changePassword(
          document.getElementById('cp-current').value,
          newPassword
        );
        msg.textContent = 'Password changed.';
        msg.style.color = 'var(--success)';
        e.target.reset();
        ['cp-new', 'cp-confirm'].forEach((id) => {
          document.getElementById(id).dispatchEvent(new Event('input', { bubbles: true }));
        });
      } catch (err) {
        msg.textContent = err.message;
        msg.style.color = 'var(--danger)';
      }
    });

    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.updateProfile({
          name: document.getElementById('dash-name').value.trim(),
          contact: document.getElementById('dash-contact').value.trim(),
          address: document.getElementById('dash-address').value.trim(),
        });
        const name = document.getElementById('dash-name').value.trim();
        localStorage.setItem('webake_member_name', name);
        const greetingName = document.getElementById('dashboard-member-name');
        if (greetingName) greetingName.textContent = name || 'there';
        U.toast('Profile saved.');
      } catch (err) {
        U.toast(err.message);
      }
    });

    async function load() {
      const [{ member }, cartRes, ordersRes, prodRes] = await Promise.all([
        api.profile(), api.cartGet(), api.mine(), api.products(),
      ]);
      const memberName = member.name || member.full_name || localStorage.getItem('webake_member_name') || '';
      document.getElementById('dash-name').value = memberName;
      if (memberName) localStorage.setItem('webake_member_name', memberName);
      const greetingName = document.getElementById('dashboard-member-name');
      if (greetingName) greetingName.textContent = memberName || 'there';
      document.getElementById('dash-contact').value = member.contact || '';
      document.getElementById('dash-email').value = member.email || '';
      document.getElementById('dash-address').value = member.address || '';

      // Saved cart, enriched with live catalog names/prices.
      const catalog = Object.fromEntries((prodRes.products || []).map((p) => [p.id, p]));
      const lines = cartRes.items || [];
      const cartTotal = lines.reduce((sum, line) => {
        const product = catalog[line.product_id];
        return sum + (product ? Number(line.bundles || 0) * Number(product.price_bundle_centavos || 0) : 0);
      }, 0);
      document.getElementById('dash-cart-container').innerHTML = lines.length
        ? '<div class="saved-cart-list">' + lines.map((l) => {
            const p = catalog[l.product_id];
            const name = p ? p.name : '#' + l.product_id;
            const line = p ? U.pesos(l.bundles * p.price_bundle_centavos) : '-';
            return '<div class="saved-cart-item"><span class="saved-cart-icon"><i class="fas fa-bread-slice"></i></span>' +
              '<span class="saved-cart-details"><strong>' + U.escapeHtml(name) + '</strong><small>' +
              U.escapeHtml(String(l.bundles)) + ' bundles saved</small></span><strong class="saved-cart-line-total">' +
              line + '</strong></div>';
          }).join('') + '</div><div class="saved-cart-summary"><span>' + lines.length +
          (lines.length === 1 ? ' product saved' : ' products saved') + '</span><strong>' +
          U.pesos(cartTotal) + '</strong></div><p class="saved-cart-estimate">Estimated cart total</p>' +
          '<a class="btn btn-primary saved-cart-cta" href="products.html"><i class="fas fa-bag-shopping"></i> Review saved cart</a>'
        : '<div class="saved-cart-empty"><span><i class="fas fa-basket-shopping"></i></span><strong>Your cart is empty</strong>' +
          '<p>Choose your bakery favorites and they’ll be saved here.</p>' +
          '<a class="btn btn-outline btn-sm" href="products.html">Browse products</a></div>';

      // Order history with track links.
      const orders = ordersRes.orders || [];
      document.getElementById('dash-orders-container').innerHTML = orders.length
        ? orders.map((o) =>
            '<div class="order-row"><div><strong>' + U.escapeHtml(o.order_code) + '</strong><br>' +
            '<small>' + U.fmtDate(o.created_at) + ' - ' +
            U.escapeHtml(String(o.status).replace(/_/g, ' ').toLowerCase()) + '</small></div>' +
            '<div><strong>' + U.pesos(o.total_centavos) + '</strong><br>' +
            '<a href="track.html?code=' + encodeURIComponent(o.order_code) +
            '&email=' + encodeURIComponent(member.email) + '">Track</a></div></div>'
          ).join('')
        : '<p class="empty-state">You haven\'t placed any orders yet.</p>';
    }

    load().catch((err) => {
      // Dead token: bounce to login (ShopAPI has no 401 redirect for shoppers).
      if (err.status === 401) {
        window.ShopAuth.clear();
        window.location.href = 'home.html?auth=login&next=dashboard.html';
        return;
      }
      U.toast(err.message);
    });
  });
})(window, document);
