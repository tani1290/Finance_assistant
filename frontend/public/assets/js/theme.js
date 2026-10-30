/**
 * FinPro — Shared Theme Manager
 * Manages dark/light theme switching, persistence, and DOM synchronization.
 * Default theme: dark. Opt-out: light-mode.
 */
(function(window, document) {
  'use strict';

  var STORAGE_KEY = 'jf_dark_mode';

  function isDarkTheme() {
    var saved = localStorage.getItem(STORAGE_KEY);
    // Dark is default; 'false' means light mode
    return saved !== 'false';
  }

  function applyTheme(isDark) {
    var root = document.documentElement;
    if (isDark) {
      root.classList.add('dark-mode');
      root.classList.remove('light-mode');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark-mode');
      root.classList.add('light-mode');
      root.style.colorScheme = 'light';
    }
    updateIcons(isDark);
  }

  function updateIcons(isDark) {
    var iconClass = isDark ? 'ri-sun-line' : 'ri-moon-line';
    var titleText = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    var ariaLabel = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';

    var icons = document.querySelectorAll('#darkModeIcon, .dark-mode-icon');
    for (var i = 0; i < icons.length; i++) {
      icons[i].className = iconClass;
    }

    var toggles = document.querySelectorAll('#darkModeToggle, .dark-mode-toggle, [data-theme-toggle]');
    for (var j = 0; j < toggles.length; j++) {
      toggles[j].title = titleText;
      toggles[j].setAttribute('aria-label', ariaLabel);
    }
  }

  function toggleDarkMode() {
    var willBeDark = document.documentElement.classList.contains('light-mode');
    localStorage.setItem(STORAGE_KEY, willBeDark ? 'true' : 'false');
    applyTheme(willBeDark);
    return willBeDark;
  }

  function initDarkMode() {
    var isDark = isDarkTheme();
    applyTheme(isDark);
  }

  // Expose on window
  window.FinProTheme = {
    isDark: isDarkTheme,
    toggle: toggleDarkMode,
    init: initDarkMode,
    apply: applyTheme,
    STORAGE_KEY: STORAGE_KEY,
  };

  // Backward compatibility with existing pages
  window.toggleDarkMode = toggleDarkMode;
  window.initDarkMode = initDarkMode;

  // Run immediately to prevent flash of wrong theme
  initDarkMode();

  // Re-sync icons when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      updateIcons(isDarkTheme());
    });
  } else {
    requestAnimationFrame(function() {
      updateIcons(isDarkTheme());
    });
  }
})(window, document);
