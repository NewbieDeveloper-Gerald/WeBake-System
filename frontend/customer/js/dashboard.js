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
    let savedCartLines = [];
    let savedCatalog = {};
    const quantityOptions = window.WEBAKE_ORDER_QUANTITY_OPTIONS || [];
    let selectedSavedIds = new Set();

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

    const savedCart = document.getElementById('dash-cart-container');
    savedCart.addEventListener('change', (e) => {
      const quantity = e.target.closest('[data-saved-quantity]');
      if (quantity) {
        savedCartLines[Number(quantity.dataset.savedQuantity)].bundles = Number(quantity.value);
        renderSavedCart();
        saveSavedCart();
        return;
      }
      const checkbox = e.target.closest('[data-saved-select]');
      if (!checkbox) return;
      const id = Number(checkbox.dataset.savedSelect);
      if (checkbox.checked) selectedSavedIds.add(id);
      else selectedSavedIds.delete(id);
      renderSavedCart();
    });
    savedCart.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('[data-saved-quantity]')) return;
      e.preventDefault();
      e.target.checked = true;
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    savedCart.addEventListener('click', async (e) => {
      const remove = e.target.closest('[data-saved-remove]');
      const checkout = e.target.closest('#saved-cart-checkout');
      if (checkout) {
        const ids = savedCartLines.filter((line) => selectedSavedIds.has(Number(line.product_id)))
          .map((line) => Number(line.product_id));
        if (!ids.length) { U.toast('Select at least one product to check out.'); return; }
        if (savedCartLines.some((line) => selectedSavedIds.has(Number(line.product_id)) && !quantityOptions.includes(Number(line.bundles)))) {
          U.toast('Choose one of the available bundle quantities for every selected product.'); return;
        }
        window.location.href = 'products.html?selected=' + encodeURIComponent(ids.join(',')) + '&checkout=1';
        return;
      }
      if (!remove) return;
      const index = Number(remove.dataset.savedRemove);
      selectedSavedIds.delete(Number(savedCartLines[index].product_id));
      savedCartLines.splice(index, 1);
      renderSavedCart();
      await saveSavedCart();
    });

    async function saveSavedCart() {
      try {
        await api.cartPut(savedCartLines.map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) })), false);
      } catch (err) {
        U.toast(err.message);
        load().catch(() => {});
      }
    }

    function renderSavedCart() {
      const lines = savedCartLines;
      const container = document.getElementById('dash-cart-container');
      if (!lines.length) {
        container.innerHTML = '<div class="saved-cart-empty"><span><i class="fas fa-basket-shopping"></i></span><strong>Your cart is empty</strong>' +
          '<p>Choose your bakery favorites and they’ll be saved here.</p>' +
          '<a class="btn btn-outline btn-sm" href="products.html">Browse products</a></div>';
        return;
      }
      const selected = lines.filter((line) => selectedSavedIds.has(Number(line.product_id)));
      const cartTotal = selected.reduce((sum, line) => {
        const product = savedCatalog[line.product_id];
        return sum + (product ? Number(line.bundles || 0) * Number(product.price_bundle_centavos || 0) : 0);
      }, 0);
      container.innerHTML = '<div class="saved-cart-list">' + lines.map((line, index) => {
        const product = savedCatalog[line.product_id];
        const name = product ? product.name : '#' + line.product_id;
        const bundles = Number(line.bundles || 0);
        const pieces = bundles * Number(product && product.pieces_per_bundle || 25);
        const total = product ? U.pesos(bundles * product.price_bundle_centavos) : '-';
        const available = Number(product && product.bundles_available || 0);
        return '<div class="saved-cart-item' + (selectedSavedIds.has(Number(line.product_id)) ? ' is-selected' : '') + '">' +
          '<label class="saved-cart-select"><input type="checkbox" data-saved-select="' + Number(line.product_id) + '"' +
          (selectedSavedIds.has(Number(line.product_id)) ? ' checked' : '') + ' aria-label="Select ' + U.escapeHtml(name) + '">' +
          '<span class="saved-cart-icon"><i class="fas fa-bread-slice"></i></span></label>' +
          '<span class="saved-cart-details"><strong>' + U.escapeHtml(name) + '</strong><small>' +
          bundles.toLocaleString() + ' bundles · ' + pieces.toLocaleString() + ' pcs</small></span>' +
          '<div class="saved-quantity-wrap"><div class="quantity-options saved-quantity-options">' + quantityOptions.map((qty) =>
            '<label class="quantity-option' + (qty === bundles ? ' selected' : '') + (qty > available ? ' unavailable' : '') + '">' +
            '<input type="radio" name="saved-quantity-' + index + '" value="' + qty + '" data-saved-quantity="' + index + '"' +
            (qty === bundles ? ' checked' : '') + (qty > available ? ' disabled' : '') +
            ' aria-label="Choose ' + qty + ' Bundles of ' + U.escapeHtml(name) + '"><span>' + qty + '</span></label>'
          ).join('') + '</div><small>Available: ' + available.toLocaleString() + ' bundles</small>' +
          '<button type="button" data-saved-remove="' + index + '" aria-label="Remove ' + U.escapeHtml(name) + '">Remove</button></div>' +
          '<strong class="saved-cart-line-total">' + total + '</strong></div>';
      }).join('') + '</div><div class="saved-cart-summary"><span>' + selected.length + ' selected · ' +
        lines.length + (lines.length === 1 ? ' product saved' : ' products saved') + '</span><strong>' +
        U.pesos(cartTotal) + '</strong></div><p class="saved-cart-estimate">Estimated selected total</p>' +
        '<button class="btn btn-primary saved-cart-cta" id="saved-cart-checkout" type="button"' + (!selected.length ? ' disabled' : '') +
        '><i class="fas fa-credit-card"></i> Check out selected</button>';
    }

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
      savedCatalog = Object.fromEntries((prodRes.products || []).map((p) => [p.id, p]));
      savedCartLines = (cartRes.items || []).map((line) => ({ product_id: Number(line.product_id), bundles: Number(line.bundles) }));
      selectedSavedIds = new Set(savedCartLines.map((line) => line.product_id));
      renderSavedCart();

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
