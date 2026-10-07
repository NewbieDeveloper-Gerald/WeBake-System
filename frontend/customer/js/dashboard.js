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

    // Change-password card (injected: the shell predates the endpoint).
    const grid = document.querySelector('.dashboard-grid');
    const pwCard = document.createElement('div');
    pwCard.className = 'dash-card';
    pwCard.innerHTML =
      '<div class="dash-card-title"><i class="fas fa-key"></i> Change Password</div>' +
      '<form id="pw-form"><div class="profile-grid">' +
      '<div class="form-group"><label class="dash-label">Current password</label>' +
      '<input type="password" class="form-input" id="cp-current" required></div>' +
      '<div class="form-group"><label class="dash-label">New password (min 6)</label>' +
      '<input type="password" class="form-input" id="cp-new" required minlength="6"></div>' +
      '</div><button type="submit" class="btn btn-primary btn-sm">Change password</button> ' +
      '<span id="cp-msg"></span></form>';
    grid.appendChild(pwCard);

    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cp-msg');
      try {
        await api.changePassword(
          document.getElementById('cp-current').value,
          document.getElementById('cp-new').value
        );
        msg.textContent = 'Password changed.';
        msg.style.color = 'var(--success)';
        e.target.reset();
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
        U.toast('Profile saved.');
      } catch (err) {
        U.toast(err.message);
      }
    });

    async function load() {
      const [{ member }, cartRes, ordersRes, prodRes] = await Promise.all([
        api.profile(), api.cartGet(), api.mine(), api.products(),
      ]);
      document.getElementById('dash-name').value = member.full_name || '';
      document.getElementById('dash-contact').value = member.contact || '';
      document.getElementById('dash-email').value = member.email || '';
      document.getElementById('dash-address').value = member.address || '';

      // Saved cart, enriched with live catalog names/prices.
      const catalog = Object.fromEntries((prodRes.products || []).map((p) => [p.id, p]));
      const lines = cartRes.items || [];
      document.getElementById('dash-cart-container').innerHTML = lines.length
        ? lines.map((l) => {
            const p = catalog[l.product_id];
            const name = p ? p.name : '#' + l.product_id;
            const line = p ? U.pesos(l.bundles * p.price_bundle_centavos) : '-';
            return '<div class="review-line"><span>' + U.escapeHtml(name) + ' x' + l.bundles +
              '</span><span>' + line + '</span></div>';
          }).join('') + '<p><a class="btn btn-primary btn-sm" href="products.html">Continue shopping</a></p>'
        : '<p class="empty-state">Your cart is empty.</p>';

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
