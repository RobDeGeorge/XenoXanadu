/* ============================================================
   XenoXanadu — Shared Park Page JavaScript
   Trail search/filter, scroll handling, scroll reveal,
   mobile menu, trail modal, interactive checklists
   ============================================================ */

(function() {
  'use strict';

  // ===== DOM CACHE =====
  var trailSearch = document.getElementById('trailSearch');
  var trailGrid = document.getElementById('trailGrid');
  var trailCards = trailGrid ? trailGrid.querySelectorAll('.card') : [];
  var navLinksEl = document.getElementById('navLinks');
  var navLinks = navLinksEl ? navLinksEl.querySelectorAll('a[href^="#"]') : [];
  var navToggle = document.getElementById('navToggle');
  var scrollProgressBar = document.getElementById('scrollProgress');
  var backToTop = document.querySelector('.back-to-top');
  var sections = document.querySelectorAll('.section[id]');
  var scrollTicking = false;

  // ===== TRAIL FILTERING =====
  var searchTimeout;
  window.filterTrails = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() {
      if (!trailSearch || !trailCards.length) return;
      var query = trailSearch.value.toLowerCase();
      trailCards.forEach(function(card) {
        var name = (card.dataset.name || '').toLowerCase();
        var desc = (card.querySelector('.card-desc') || {}).textContent || '';
        card.classList.toggle('hidden', !name.includes(query) && !desc.toLowerCase().includes(query));
      });
    }, 150);
  };

  window.filterDifficulty = function(level, btn) {
    if (!trailCards.length) return;
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');

    trailCards.forEach(function(card) {
      if (level === 'all') {
        card.classList.remove('hidden');
      } else {
        card.classList.toggle('hidden', card.dataset.difficulty !== level);
      }
    });

    // Clear search
    if (trailSearch) trailSearch.value = '';
  };

  // ===== SCROLL HANDLING =====
  function onScroll() {
    scrollTicking = false;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;

    // Scroll progress bar
    if (scrollProgressBar && docHeight > 0) {
      scrollProgressBar.style.width = ((scrollTop / docHeight) * 100) + '%';
    }

    // Active nav link
    var currentSection = '';
    sections.forEach(function(section) {
      if (section.offsetTop - 80 <= scrollTop) {
        currentSection = section.id;
      }
    });
    navLinks.forEach(function(link) {
      link.classList.toggle('active', link.getAttribute('href') === '#' + currentSection);
    });

    // Back to top button
    if (backToTop) {
      backToTop.classList.toggle('visible', scrollTop > 600);
    }
  }

  window.addEventListener('scroll', function() {
    if (!scrollTicking) {
      requestAnimationFrame(onScroll);
      scrollTicking = true;
    }
  });

  if (backToTop) {
    backToTop.addEventListener('click', function() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ===== SCROLL REVEAL =====
  var revealObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  document.querySelectorAll('.section').forEach(function(section) {
    revealObserver.observe(section);
  });

  // ===== MOBILE MENU =====
  if (navToggle && navLinksEl) {
    navToggle.addEventListener('click', function() {
      var isOpen = navLinksEl.classList.toggle('open');
      navToggle.textContent = isOpen ? '\u2715' : '\u2630';
      navToggle.setAttribute('aria-expanded', isOpen);
    });

    navLinksEl.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        navLinksEl.classList.remove('open');
        navToggle.textContent = '\u2630';
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ===== TRAIL DETAIL MODAL =====
  var modal = document.getElementById('trailModal');
  var modalClose = document.getElementById('trailModalClose');
  var modalTitle = document.getElementById('trailModalTitle');
  var modalMeta = document.getElementById('trailModalMeta');
  var modalStats = document.getElementById('trailModalStats');
  var modalTips = document.getElementById('trailModalTips');
  var modalLinks = document.getElementById('trailModalLinks');

  function openTrailModal(card, info) {
    if (!modal) return;

    var titleEl = card.querySelector('.card-title');
    modalTitle.textContent = titleEl ? titleEl.textContent : card.dataset.name;

    var metaEl = card.querySelector('.card-meta');
    modalMeta.innerHTML = metaEl ? metaEl.innerHTML : '';

    var statsEl = card.querySelector('.card-stats');
    modalStats.innerHTML = statsEl ? statsEl.innerHTML : '';

    modalTips.innerHTML = '';
    if (info.tips) {
      info.tips.forEach(function(t) {
        var li = document.createElement('li');
        li.innerHTML = t;
        modalTips.appendChild(li);
      });
    }

    var linksHtml = '';
    if (info.links && info.links.length) {
      info.links.forEach(function(l) {
        linksHtml += '<a href="' + l[1] + '" target="_blank">' + l[0] + ' &rarr;</a>';
      });
    }
    var mapLink = card.querySelector('.map-link');
    if (mapLink) {
      linksHtml += '<a href="' + mapLink.href + '" target="_blank">Directions &rarr;</a>';
    }
    modalLinks.innerHTML = linksHtml;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (modalClose) modalClose.focus();
  }

  function closeTrailModal() {
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (modalClose) {
    modalClose.addEventListener('click', closeTrailModal);
  }
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeTrailModal();
    });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeTrailModal();
  });

  // ===== ENHANCE TRAIL CARDS =====
  // trailDetails should be defined in each park page before this script loads
  if (typeof trailDetails !== 'undefined' && trailCards.length) {
    trailCards.forEach(function(card) {
      var name = card.dataset.name;
      var info = trailDetails[name];
      if (!info) return;

      card.classList.add('trail-card');

      var hint = document.createElement('div');
      hint.className = 'card-expand-hint';
      hint.textContent = 'Tap for details';
      card.appendChild(hint);

      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', function(e) {
        if (e.target.closest('a')) return;
        openTrailModal(card, info);
      });
      card.addEventListener('keydown', function(e) {
        if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) {
          e.preventDefault();
          openTrailModal(card, info);
        }
      });
    });
  }

  // ===== INTERACTIVE CHECKLISTS (localStorage) =====
  document.querySelectorAll('.checklist.interactive').forEach(function(list) {
    var key = 'xenoxanadu-checklist-' + list.dataset.checklist;
    var saved = JSON.parse(localStorage.getItem(key) || '[]');

    list.querySelectorAll('li').forEach(function(li, i) {
      if (saved.includes(i)) li.classList.add('checked');
      li.addEventListener('click', function() {
        li.classList.toggle('checked');
        var checked = [];
        list.querySelectorAll('li').forEach(function(el, idx) {
          if (el.classList.contains('checked')) checked.push(idx);
        });
        localStorage.setItem(key, JSON.stringify(checked));
      });
    });
  });

})();
