/*
 * Shared site script for Tennis Tracker pages: theme toggle, nav burger, and
 * scroll-aware nav styling. This is the single script every page loads
 * (see scripts/lib/site_nav.py:SITE_JS_TAG) — it replaces the old inline
 * per-page <script> blocks (index.html) and the standalone theme.js.
 *
 * Theme contract: the theme lives on <html data-theme="dark|light"> and is
 * persisted to localStorage('theme'). A tiny inline snippet in each page's
 * <head> (scripts/lib/site_nav.py:THEME_PRELOAD) applies the initial theme
 * before first paint (honoring prefers-color-scheme) to avoid a flash; this
 * file only wires the #theme-toggle button and keeps its icon in sync.
 *
 * Every handler below is guarded by an element-presence check, so this file
 * is safe to include on pages that lack a burger, a theme toggle, or #main-nav.
 */
(function () {
  var root = document.documentElement;

  function isDark() {
    return root.getAttribute('data-theme') === 'dark';
  }

  // Icon rule (canonical, matching index + report pages): sun in dark, moon
  // in light. Supports every icon markup variant seen across the site.
  function updateThemeIcons(dark) {
    // Sun/moon SVG pair (player + simulator).
    var sun = document.getElementById('sunIcon');
    var moon = document.getElementById('moonIcon');
    if (sun) sun.style.display = dark ? '' : 'none';
    if (moon) moon.style.display = dark ? 'none' : '';
    // Homepage SVG pair (index).
    var homeSun = document.getElementById('theme-icon-sun');
    var homeMoon = document.getElementById('theme-icon-moon');
    if (homeSun) homeSun.style.display = dark ? '' : 'none';
    if (homeMoon) homeMoon.style.display = dark ? 'none' : '';
    // Single emoji span (report/calendar pages).
    var emoji = document.getElementById('theme-icon');
    if (emoji) emoji.textContent = dark ? '☀️' : '🌙';
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) {}
    updateThemeIcons(theme === 'dark');
  }

  function toggleTheme() {
    setTheme(isDark() ? 'light' : 'dark');
  }

  // Back-compat global for any inline onclick="toggleDarkMode()" still in the wild.
  window.toggleDarkMode = toggleTheme;

  function wireTheme() {
    // Initial theme (incl. prefers-color-scheme) is applied by the inline
    // <head> preload snippet; sync the icon from the actual attribute, not
    // just localStorage.
    updateThemeIcons(isDark());
    var toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.addEventListener('click', toggleTheme);
  }

  function wireBurger() {
    var burger = document.getElementById('nav-burger');
    var nav = document.getElementById('main-nav');
    if (!burger || !nav) return;

    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = nav.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', String(isOpen));
    });

    function closeNav() {
      nav.classList.remove('nav-open');
      burger.setAttribute('aria-expanded', 'false');
    }

    // Close on outside click.
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) closeNav();
    });

    // Close on Escape.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    // Close on nav-link click.
    nav.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', closeNav);
    });
  }

  function wireScroll() {
    var nav = document.getElementById('main-nav');
    if (!nav) return;
    window.addEventListener('scroll', function () {
      nav.classList.toggle('nav-scrolled', window.scrollY > 0);
    }, { passive: true });
  }

  function init() {
    wireTheme();
    wireBurger();
    wireScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
