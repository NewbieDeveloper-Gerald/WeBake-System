/**
 * WeBake / Crumbs N' Roll Bakery — Scroll Spy & In-Page Navigation
 *
 * Single-array architecture:
 * Nav links, section observation, and click scrolling all read from `sections`.
 * To add a section: add `{ id: "your-id", label: "Your Label" }` to the array.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WebakeScrollSpy = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // =========================================================================
  // 1. Single source of truth for all sections (in top-to-bottom order)
  // =========================================================================
  const sections = [
    { id: 'home', label: 'Home' },
    { id: 'about-us', label: 'About Us' },
    { id: 'contact', label: 'Contact' }
  ];

  // State
  let activeSectionId = null;
  let observer = null;
  let isClickScrolling = false;
  let clickUnlockTimer = null;
  let scrollRafId = null;
  let currentNavContainer = null;

  /**
   * Update active nav link indicator and ARIA attributes
   */
  function setActive(id) {
    if (!id || activeSectionId === id) return;
    activeSectionId = id;

    if (!currentNavContainer) return;
    const links = currentNavContainer.querySelectorAll('[data-scroll-spy="true"]');
    links.forEach((link) => {
      const match = link.getAttribute('data-section') === id;
      if (match) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'true');
      } else {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Synchronize navigation links inside container with the `sections` array.
   */
  function syncNavLinks(container) {
    currentNavContainer = container;
    const existingLinks = Array.from(container.querySelectorAll('a[href^="#"]'));
    const linkMap = new Map();

    existingLinks.forEach((a) => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#')) {
        linkMap.set(href.slice(1), a);
      }
    });

    const mobileAuth = container.querySelector('.nav-auth-mobile');

    sections.forEach((sec) => {
      let link = linkMap.get(sec.id);
      if (!link) {
        link = document.createElement('a');
        link.href = `#${sec.id}`;
        link.textContent = sec.label;
        if (mobileAuth) {
          container.insertBefore(link, mobileAuth);
        } else {
          container.appendChild(link);
        }
      }
      link.setAttribute('data-section', sec.id);
      link.setAttribute('data-scroll-spy', 'true');
    });
  }

  /**
   * Close mobile menu drawer if currently open
   */
  function closeMobileMenu() {
    const navLinks = document.getElementById('nav-links');
    const navToggle = document.getElementById('nav-toggle');
    if (navLinks && navLinks.classList.contains('open')) {
      navLinks.classList.remove('open');
      if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Smoothly scroll to target section with sticky header offset
   */
  function scrollToSection(id) {
    const targetEl = document.getElementById(id);
    if (!targetEl) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Lock observer to prevent intermediate underlines from flashing during scroll
    isClickScrolling = true;
    clearTimeout(clickUnlockTimer);

    // Set active link immediately on click
    setActive(id);

    targetEl.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });

    // Release lock once scroll finishes
    const unlock = () => {
      isClickScrolling = false;
      window.removeEventListener('scrollend', unlock);
    };

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', unlock, { once: true });
    }
    clickUnlockTimer = setTimeout(unlock, prefersReducedMotion ? 50 : 800);
  }

  /**
   * Nav click event listener
   */
  function onNavClick(event) {
    const anyLink = event.target.closest('a');
    if (anyLink) {
      closeMobileMenu();
    }

    const link = event.target.closest('[data-scroll-spy="true"]');
    if (!link) return;

    const targetId = link.getAttribute('data-section');
    if (!targetId) return;

    event.preventDefault();

    // Close mobile menu
    closeMobileMenu();

    // Update URL hash without causing a page jump
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', `#${targetId}`);
    }

    scrollToSection(targetId);
  }

  /**
   * Setup IntersectionObserver for sections
   */
  function setupObserver() {
    if (!('IntersectionObserver' in window)) return;

    const options = {
      root: null,
      // Target narrow line near the middle of the viewport
      rootMargin: '-40% 0px -55% 0px',
      threshold: 0
    };

    observer = new IntersectionObserver((entries) => {
      if (isClickScrolling) return;

      const visible = entries.filter((e) => e.isIntersecting);
      if (!visible.length) return;

      // Pick section closest to center if multiple intersect
      visible.sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));

      const topTarget = visible[0].target;
      if (topTarget && topTarget.id) {
        setActive(topTarget.id);
      }
    }, options);

    sections.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) observer.observe(el);
    });
  }

  /**
   * Throttled scroll listener to guarantee edge case detection
   * 1. Top of page -> Home
   * 2. Bottom of page -> Contact
   */
  function onScroll() {
    if (isClickScrolling) return;

    if (scrollRafId) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;

      const scrollY = window.pageYOffset || document.documentElement.scrollTop;
      const viewportHeight = window.innerHeight;
      const scrollHeight = document.documentElement.scrollHeight;

      // 1. Very top of the page (within first 80px)
      if (scrollY < 80) {
        if (sections.length > 0) setActive(sections[0].id);
        return;
      }

      // 2. Very bottom of the page (within 50px of document end)
      if (viewportHeight + scrollY >= scrollHeight - 50) {
        if (sections.length > 0) setActive(sections[sections.length - 1].id);
        return;
      }
    });
  }

  /**
   * Handle cross-route navigation (e.g. /#order-status or products.html#about-us)
   */
  function handleInitialHash() {
    let rawHash = window.location.hash ? window.location.hash.slice(1) : '';
    if (rawHash === 'about') rawHash = 'about-us';
    if (rawHash === 'products') {
      window.location.href = 'products.html';
      return;
    }
    if (rawHash === 'order-status') {
      if (window.TrackModal && window.TrackModal.open) {
        window.TrackModal.open();
      }
      return;
    }

    if (!rawHash) {
      if ((window.pageYOffset || document.documentElement.scrollTop) < 80) {
        if (sections.length > 0) setActive(sections[0].id);
      }
      return;
    }

    const matched = sections.find((s) => s.id === rawHash);
    if (matched) {
      setActive(matched.id);
      setTimeout(() => {
        scrollToSection(matched.id);
      }, 120);
    }
  }

  /**
   * Initialize scroll spy
   */
  function init(navContainerSelector = '#nav-links') {
    const container = typeof navContainerSelector === 'string'
      ? document.querySelector(navContainerSelector)
      : navContainerSelector;

    if (!container) return null;

    syncNavLinks(container);
    setupObserver();

    container.addEventListener('click', onNavClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', handleInitialHash);

    // Initial check on page load
    handleInitialHash();

    return {
      sections,
      getActiveSection: () => activeSectionId,
      setActiveSection: setActive,
      scrollToSection,
      destroy
    };
  }

  /**
   * Cleanup observer and event listeners (for React/Vue unmount)
   */
  function destroy() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(clickUnlockTimer);
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    if (currentNavContainer) {
      currentNavContainer.removeEventListener('click', onNavClick);
    }
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('hashchange', handleInitialHash);
  }

  // Auto-init on DOMContentLoaded
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init('#nav-links'));
    } else {
      init('#nav-links');
    }
  }

  return {
    sections,
    init,
    destroy
  };
});

