/**
 * Crumbs N' Roll Bakery (CRB) — Scoped Admin Sidebar Navigation Script
 * 
 * SCOPE ISOLATION:
 * - Scoped strictly to document.getElementById('admin-sidebar')
 * - No global mutation or side effects on outside page elements
 * - Clean teardown supported via CRBAdminSidebar.destroy()
 */

(function () {
  'use strict';

  /**
   * 1. Staff Workflow Navigation Definition
   * 
   * Order defined in one array for effortless reordering.
   * NOTE: Walk-In and Dashboard can be swapped if cashiers use the system more than the owner.
   */
  const SIDEBAR_NAV_ITEMS = [
    // Section: OPERATIONS
    {
      section: 'OPERATIONS',
      sectionId: 'sb-sec-ops',
      items: [
        {
          id: 'dashboard',
          label: 'Dashboard',
          route: 'dashboard.html',
          icon: 'fas fa-chart-pie',
          badgeType: null
        },
        {
          id: 'walkin',
          label: 'Walk-In',
          route: 'walkin-pos.html',
          icon: 'fas fa-cash-register',
          badgeType: null
        },
        {
          id: 'orders',
          label: 'Orders & Verify',
          route: 'orders.html',
          icon: 'fas fa-clipboard-list',
          badgeType: 'orders',
          badgeAriaUnit: 'pending orders'
        },
        {
          id: 'refunds',
          label: 'Refunds Queue',
          route: 'refunds.html',
          icon: 'fas fa-undo-alt',
          badgeType: 'refunds',
          badgeAriaUnit: 'pending refunds'
        }
      ]
    },
    // Section: BAKERY MANAGEMENT
    {
      section: 'BAKERY MANAGEMENT',
      sectionId: 'sb-sec-mgmt',
      items: [
        {
          id: 'sales',
          label: 'Sales',
          route: 'sales.html',
          icon: 'fas fa-chart-line',
          badgeType: null
        },
        {
          id: 'inventory',
          label: 'Product Inventory',
          route: 'products.html',
          icon: 'fas fa-boxes-stacked', // Stacked-boxes outline icon fitting bakery trays/packages
          badgeType: null
        },
        {
          id: 'ingredients',
          label: 'Ingredients Inventory',
          route: 'ingredients.html',
          icon: 'fas fa-wheat-awn',
          badgeType: null
        },
        {
          id: 'settings',
          label: 'Bakery Settings',
          route: 'settings.html',
          icon: 'fas fa-cog',
          badgeType: null
        }
      ]
    }
  ];

  /* ==========================================================================
     REPLACE: connect to real counts
     Placeholder badge data (Orders & Verify: 3, Refunds Queue: 1)
     In production, update via window.CRBAdminSidebar.setBadge('orders', realCount)
     ========================================================================== */
  const INITIAL_BADGES = {
    orders: 0,
    refunds: 0
  };

  /**
   * Format count for badge display (capped at "99+", hidden when <= 0)
   */
  function formatBadgeCount(count) {
    const num = Number(count) || 0;
    if (num <= 0) return '';
    return num > 99 ? '99+' : String(num);
  }

  function initSidebar() {
    const sidebar = document.getElementById('admin-sidebar');
    if (!sidebar) return;

    // Detect current route for single active link
    const currentPath = window.location.pathname.split('/').pop().toLowerCase() || 'dashboard.html';

    // Query navigation links inside scoped root
    const navLinks = sidebar.querySelectorAll('.sb-link');
    let hasActiveSet = false;

    navLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const route = href ? href.split('/').pop().toLowerCase() : '';
      
      // Strict matching: exactly ONE item gets active state
      if (!hasActiveSet && route && currentPath === route) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('sb-is-active');
        hasActiveSet = true;
      } else {
        link.removeAttribute('aria-current');
        link.classList.remove('sb-is-active');
      }
    });

    // Fallback: If no match (e.g. index/root), default to Dashboard if present
    if (!hasActiveSet) {
      const firstLink = sidebar.querySelector('.sb-link[href*="dashboard.html"]');
      if (firstLink) {
        firstLink.setAttribute('aria-current', 'page');
        firstLink.classList.add('sb-is-active');
      }
    }

    // Set initial placeholder badge values
    updateBadge('orders', INITIAL_BADGES.orders);
    updateBadge('refunds', INITIAL_BADGES.refunds);

    // Collapsed rail state persistence in localStorage (scoped to "sb-")
    try {
      const savedCollapsed = localStorage.getItem('sb-collapsed');
      if (savedCollapsed === 'true') {
        sidebar.classList.add('sb--collapsed');
      }
    } catch (err) {
      // Ignore private-mode storage errors
    }

    // Setup mobile drawer & backdrop
    let backdrop = document.querySelector('.sb-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'sb-backdrop';
      backdrop.setAttribute('aria-label', 'Close navigation');
      backdrop.setAttribute('tabindex', '-1');
      document.body.appendChild(backdrop);
    }

    function openMobileSidebar() {
      sidebar.classList.add('sb--open');
      backdrop.classList.add('sb-backdrop--visible');
      const firstFocusable = sidebar.querySelector('a, button, [tabindex="0"]');
      if (firstFocusable) firstFocusable.focus();
    }

    function closeMobileSidebar() {
      sidebar.classList.remove('sb--open');
      backdrop.classList.remove('sb-backdrop--visible');
    }

    function toggleMobileSidebar() {
      if (sidebar.classList.contains('sb--open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    }

    // Click backdrop closes drawer
    backdrop.addEventListener('click', closeMobileSidebar);

    // Navigation item click closes mobile drawer
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        if (window.innerWidth < 640) {
          closeMobileSidebar();
        }
      });
    });

    // Keyboard support: Escape closes mobile drawer & handles focus trap
    function handleKeyDown(e) {
      if (e.key === 'Escape' && sidebar.classList.contains('sb--open')) {
        e.preventDefault();
        closeMobileSidebar();
        const toggleBtn = document.querySelector('[data-sb-toggle]');
        if (toggleBtn) toggleBtn.focus();
        return;
      }

      // Focus trap when mobile drawer is open
      if (e.key === 'Tab' && sidebar.classList.contains('sb--open')) {
        const focusable = sidebar.querySelectorAll('a, button:not([disabled]), [tabindex="0"]');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Hook external toggle buttons with data-sb-toggle
    function setupToggleButtons() {
      document.querySelectorAll('[data-sb-toggle]').forEach((btn) => {
        btn.setAttribute('aria-controls', 'admin-sidebar');
        btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          toggleMobileSidebar();
          const isOpen = sidebar.classList.contains('sb--open');
          btn.setAttribute('aria-expanded', String(isOpen));
        });
      });
    }
    setupToggleButtons();

    /**
     * Update badge count dynamically
     */
    function updateBadge(type, count) {
      const badgeEl = sidebar.querySelector(`[data-sb-badge="${type}"]`);
      if (!badgeEl) return;
      const formatted = formatBadgeCount(count);
      const textSpan = badgeEl.querySelector('.sb-badge-count');
      const srSpan = badgeEl.querySelector('.sb-sr-only');

      if (!formatted) {
        badgeEl.style.display = 'none';
        if (textSpan) textSpan.textContent = '0';
        if (srSpan) srSpan.textContent = `0 ${type}`;
      } else {
        badgeEl.style.display = '';
        if (textSpan) textSpan.textContent = formatted;
        if (srSpan) {
          const unit = type === 'orders' ? 'pending orders' : 'pending refunds';
          srSpan.textContent = `${count} ${unit}`;
        }
      }
    }

    // Public API for dashboard/topbar integration
    window.CRBAdminSidebar = {
      open: openMobileSidebar,
      close: closeMobileSidebar,
      toggle: toggleMobileSidebar,
      setBadge: updateBadge,
      toggleRail: function () {
        const isCollapsed = sidebar.classList.toggle('sb--collapsed');
        try {
          localStorage.setItem('sb-collapsed', String(isCollapsed));
        } catch (e) {}
      },
      destroy: function () {
        document.removeEventListener('keydown', handleKeyDown);
        if (backdrop && backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
      }
    };
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }
})();

