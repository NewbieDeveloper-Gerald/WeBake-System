/* Customer-only enhancements that operate on rendered storefront content. */
(function (document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.review-star-rating').forEach(function (starBox) {
      var fieldGroup = starBox.closest('.form-group');
      var stars = starBox.querySelectorAll('[data-star]');

      function syncRatingState() {
        var valueField = fieldGroup && fieldGroup.querySelector('input[type="hidden"]');
        var selected = valueField ? Number(valueField.value) : 0;
        stars.forEach(function (star) {
          star.setAttribute('aria-pressed', String(Number(star.dataset.star) === selected));
        });
      }

      stars.forEach(function (star) {
        star.setAttribute('role', 'button');
        star.setAttribute('tabindex', '0');
        star.setAttribute('aria-label', 'Set rating to ' + star.dataset.star + ' out of 5');
        star.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            star.click();
          }
        });
      });

      starBox.addEventListener('click', syncRatingState);
      syncRatingState();
    });

    var grid = document.getElementById('product-grid');
    var search = document.getElementById('product-search');
    var resultCount = document.getElementById('product-results');
    var emptyState = document.getElementById('product-empty-state');
    if (!grid || !search) return;

    function updateProducts() {
      var query = search.value.trim().toLocaleLowerCase();
      var cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
      var visible = 0;

      cards.forEach(function (card) {
        var matches = !query || card.textContent.toLocaleLowerCase().indexOf(query) !== -1;
        card.hidden = !matches;
        if (matches) visible += 1;
      });

      if (resultCount) {
        resultCount.textContent = query
          ? visible + (visible === 1 ? ' product found' : ' products found')
          : cards.length + (cards.length === 1 ? ' product available' : ' products available');
      }
      if (emptyState) emptyState.hidden = visible !== 0 || !query;
    }

    search.addEventListener('input', updateProducts);
    new MutationObserver(updateProducts).observe(grid, { childList: true, subtree: true });
    updateProducts();
  });
})(document);
