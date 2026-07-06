/*
 * Shared mobile renderer for tournament report pages. Reads the canonical
 * `#page-data` JSON payload (see docs/redesign/page-data-contract.md) emitted
 * by scripts/usta/build_report_from_players.py's build_page_data() and
 * renders the mobile view from it exclusively — no DOM scraping of the
 * desktop <table>. This is what keeps a desktop column rename/reorder from
 * silently breaking mobile: the payload and the SSR table come from the same
 * in-memory `sections` list at generation time, and this file only reads the
 * payload.
 *
 * Every report template (master-report-template.html + the four
 * templates/reports/variants/*.html) loads this file via
 * <script src="assets/js/report.js" defer></script>, right after the SSR
 * desktop table and its sibling <script type="application/json" id="page-data">.
 *
 * Two small per-template DOM hooks (not page-data fields) are preserved from
 * the previous per-template inline scripts, since they are page-level
 * rendering config rather than player data:
 *   - table[data-flight-source="official"] / table[data-default-sort] on the
 *     desktop `.players-table` — selects the initial mobile sort order.
 *   - body[data-roster-label] — "Roster #" (default, draw-based reports) vs
 *     "Seed" (doubles/mixed-doubles/singles+doubles variants), matching the
 *     wording difference the four templates already had.
 */
(function () {
  'use strict';

  function readPageData() {
    var el = document.getElementById('page-data');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || el.innerText || '');
    } catch (err) {
      return null;
    }
  }

  var pageData = readPageData();
  if (!pageData) return; // No payload: nothing to render (desktop-only page).

  // ========================================
  // CONFIG (small per-template DOM hooks — not page-data fields)
  // ========================================

  function reportDefaultSort() {
    if (document.querySelector('.desktop-view table.players-table[data-flight-source="official"]')) {
      return 'rank';
    }
    var table = document.querySelector('.desktop-view table.players-table[data-default-sort]');
    var value = ((table && table.getAttribute('data-default-sort')) || '').trim();
    return value || 'natRank';
  }

  function rosterLabel() {
    var value = (document.body.getAttribute('data-roster-label') || '').trim();
    return value || 'Roster #';
  }

  function initialRenderLimit() {
    var raw = (document.body.getAttribute('data-initial-limit') || '').trim();
    if (!raw) return null;
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  var currentSort = reportDefaultSort();
  var isExpanded = false;
  var allPlayers = [];
  var isMixedEvent = false;
  var mixedGroups = null;
  var multiGroups = null;
  var playerByKey = {};
  var targetPlayer = null;

  // ========================================
  // PAYLOAD READERS (replace parsePlayerData/parseKeyStats/parseTournamentInfo/
  // detectMixedEvent — everything below reads `pageData` only)
  // ========================================

  function makePlayerKey(firstName, lastName) {
    var first = (firstName || '').trim().toUpperCase();
    var last = (lastName || '').trim().toUpperCase();
    return last + '|' + first;
  }

  function partnerKeyFromText(text) {
    var raw = (text || '').trim();
    if (!raw) return '';
    if (raw.indexOf(',') !== -1) {
      var parts = raw.split(',');
      var last = (parts[0] || '').trim();
      var first = (parts.slice(1).join(',') || '').trim();
      return makePlayerKey(first, last);
    }
    var words = raw.split(/\s+/).filter(Boolean);
    if (words.length === 1) return makePlayerKey(words[0], '');
    return makePlayerKey(words[0], words.slice(1).join(' '));
  }

  function groupPrefixFor(label) {
    var g = (label || '').trim();
    if (!g) return '';
    var m = g.match(/\b(10|12|14|16|18)\b/);
    if (m) return m[1] + '-';
    return g[0].toUpperCase() + '-';
  }

  function normalizePlayer(p, groupLabel) {
    var firstName = p.firstName || '';
    var lastName = p.lastName || '';
    var fullName = p.fullName || (firstName + ' ' + lastName).trim();
    var playerKey = makePlayerKey(firstName, lastName);
    var groupPrefix = groupPrefixFor(groupLabel);
    var id = groupPrefix + playerKey.replace(/[^A-Z0-9]+/g, '-');

    var partner = p.partner || '';
    var partnerKey = p.partnerKey || (partner ? partnerKeyFromText(partner) : '');

    var utrVal = typeof p.utr === 'number' && isFinite(p.utr) ? p.utr : NaN;
    var natVal = typeof p.natRank === 'number' && isFinite(p.natRank) ? p.natRank : NaN;

    return {
      id: id,
      group: groupLabel || '',
      playerKey: playerKey,
      partner: partner,
      partnerKey: partnerKey,
      rank: p.rank,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName,
      wtn: p.wtn || '',
      utr: utrVal,
      utrUrl: p.utrUrl || null,
      natRank: natVal,
      sectionRank: p.sectionRank != null ? p.sectionRank : null,
      uaid: p.uaid || null,
      ustaUrl: p.ustaUrl || null,
      teamNst: p.teamNst || '',
      location: p.location || '',
      isTarget: !!p.isTarget,
      flight: p.flight || ''
    };
  }

  function groupLabelFor(groupId) {
    var groups = (pageData.event && pageData.event.groups) || [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === groupId) return groups[i].label || groupId;
    }
    return groupId || '';
  }

  function loadPlayerData() {
    isMixedEvent = !!(pageData.event && pageData.event.mixed);
    mixedGroups = null;
    multiGroups = null;

    var rawPlayers = Array.isArray(pageData.players) ? pageData.players : [];
    var groups = (pageData.event && pageData.event.groups) || [];

    if (isMixedEvent) {
      var girls = [];
      var boys = [];
      rawPlayers.forEach(function (p) {
        var label = groupLabelFor(p.group).toLowerCase();
        var bucket = label.indexOf('boys') !== -1 ? 'Boys' : label.indexOf('girls') !== -1 ? 'Girls' : '';
        var normalized = normalizePlayer(p, bucket);
        if (bucket === 'Boys') boys.push(normalized);
        else girls.push(normalized);
      });
      mixedGroups = { girls: girls, boys: boys };
      return girls.concat(boys);
    }

    if (groups.length > 1) {
      var byGroupId = {};
      var order = [];
      groups.forEach(function (g) {
        byGroupId[g.id] = { label: g.label || g.id, players: [] };
        order.push(g.id);
      });
      rawPlayers.forEach(function (p) {
        var gid = p.group || '';
        if (!byGroupId[gid]) {
          byGroupId[gid] = { label: gid || 'Players', players: [] };
          order.push(gid);
        }
        byGroupId[gid].players.push(normalizePlayer(p, byGroupId[gid].label));
      });
      multiGroups = order.map(function (gid) {
        return byGroupId[gid];
      });
      return multiGroups.reduce(function (acc, g) {
        return acc.concat(g.players);
      }, []);
    }

    // Single-event report: no grouping needed.
    return rawPlayers.map(function (p) {
      return normalizePlayer(p, '');
    });
  }

  function readKeyStats() {
    var stats = pageData.keyStats || {};
    return {
      drawSize: typeof stats.drawSize === 'number' ? stats.drawSize : 32,
      closes: stats.closes || '',
      registered: typeof stats.registered === 'number' ? stats.registered : 0,
      seed: typeof stats.seed === 'number' ? stats.seed : null,
      percentAbove: typeof stats.percentAbove === 'number' ? stats.percentAbove : null
    };
  }

  function readTournamentInfo() {
    var event = pageData.event || {};
    var fmt = pageData.format || {};
    var venues = pageData.venues || [];
    var contact = pageData.contact || {};
    return {
      title: event.title || '',
      dates: event.dates || '',
      location: event.location || '',
      format: {
        matchFormat: fmt.matchFormat || '',
        tiebreaks: fmt.tiebreaks || '',
        setTiebreak: fmt.setTiebreak || '',
        matchTiebreak: fmt.matchTiebreak || ''
      },
      venues: venues.map(function (v) {
        return { name: v.name || '', url: v.url || null };
      }),
      contact: {
        director: contact.director || '',
        email: contact.email || '',
        phone: contact.phone || '',
        phoneUrl: contact.phoneUrl || null
      }
    };
  }

  // ========================================
  // RENDERING FUNCTIONS
  // ========================================

  function formatUtrValue(value) {
    if (Number.isFinite(value)) return value.toFixed(2);
    return 'N/A';
  }

  function formatNatRankValue(value) {
    if (Number.isFinite(value)) return String(value);
    return 'N/A';
  }

  function isProbablyEmail(value) {
    var email = (value || '').trim();
    if (!email) return false;
    if (email.toUpperCase() === 'N/A') return false;
    return /.+@.+\..+/.test(email);
  }

  function buildAlexisCard(player) {
    if (!player) return '';

    var initials = (player.firstName[0] || '') + (player.lastName[0] || '');
    var sectionRank = player.sectionRank != null ? player.sectionRank : 'N/A';

    return (
      '\n        <div class="mobile-alexis-header">\n' +
      '          <div class="mobile-alexis-avatar">' + initials + '</div>\n' +
      '          <div class="mobile-alexis-name">\n' +
      '            <h3>' + player.fullName + '</h3>\n' +
      '            <span>' + player.location + '</span>\n' +
      '          </div>\n' +
      '          <div class="mobile-alexis-seed">' + rosterLabelValue(player) + '</div>\n' +
      '        </div>\n' +
      '        <div class="mobile-alexis-stats">\n' +
      '          <div class="mobile-alexis-stat">\n' +
      '            <div class="mobile-alexis-stat-value">' + player.wtn + '</div>\n' +
      '            <div class="mobile-alexis-stat-label">WTN</div>\n' +
      '          </div>\n' +
      '          <div class="mobile-alexis-stat">\n' +
      '            <div class="mobile-alexis-stat-value">' + formatUtrValue(player.utr) + '</div>\n' +
      '            <div class="mobile-alexis-stat-label">UTR</div>\n' +
      '          </div>\n' +
      '          <div class="mobile-alexis-stat">\n' +
      '            <div class="mobile-alexis-stat-value">' + formatNatRankValue(player.natRank) + '</div>\n' +
      '            <div class="mobile-alexis-stat-label">Nat Rank</div>\n' +
      '          </div>\n' +
      '          <div class="mobile-alexis-stat">\n' +
      '            <div class="mobile-alexis-stat-value">' + sectionRank + '</div>\n' +
      '            <div class="mobile-alexis-stat-label">Section</div>\n' +
      '          </div>\n' +
      '        </div>\n' +
      '      '
    );
  }

  function rosterLabelValue(player) {
    var label = rosterLabel();
    if (label === 'Seed') return '#' + player.rank + ' Seed';
    return label + player.rank;
  }

  function rosterDetailLabel() {
    var label = rosterLabel();
    return label === 'Seed' ? 'Seed' : 'Roster #';
  }

  function rosterDetailValue(player) {
    return '#' + player.rank;
  }

  function buildPositionGauge(players, targetPlayerArg) {
    if (!targetPlayerArg || players.length === 0) return '';

    var targetIndex = players.findIndex(function (p) {
      return p.isTarget;
    });
    var percentage = ((targetIndex / (players.length - 1)) * 100).toFixed(0);
    var percentAbove = Math.round((targetIndex / players.length) * 100);
    var firstPlayer = players[0];
    var stats = readKeyStats();
    var cushion = stats.drawSize - targetPlayerArg.rank;

    return (
      '\n        <div class="mobile-gauge-header">\n' +
      '          <span class="mobile-gauge-title">Position in Draw</span>\n' +
      '          <span class="mobile-gauge-value">' + percentAbove + '% above her</span>\n' +
      '        </div>\n' +
      '        <div class="mobile-gauge-bar">\n' +
      '          <div class="mobile-gauge-fill" id="gauge-fill" style="width: 0%;" data-width="' + percentage + '%">\n' +
      '            <div class="mobile-gauge-marker"></div>\n' +
      '          </div>\n' +
      '        </div>\n' +
      '        <div class="mobile-gauge-labels">\n' +
      '          <span>#1 ' + firstPlayer.firstName + ' ' + (firstPlayer.lastName[0] || '') + '.</span>\n' +
      '          <span>#' + targetPlayerArg.rank + ' ' + targetPlayerArg.firstName + '</span>\n' +
      '          <span>#' + players.length + '</span>\n' +
      '        </div>\n' +
      (cushion > 0
        ? '        <div class="mobile-gauge-note">\n' +
          '          <span>✓</span>\n' +
          '          ' + cushion + '-player cushion above cutoff — safe entry\n' +
          '        </div>\n'
        : '')
    );
  }

  function buildUtrHistogramMobile() {
    var bins = Array.isArray(pageData.utrHistogram) ? pageData.utrHistogram : [];
    if (!bins.length) return '';

    var maxCount = 0;
    bins.forEach(function (bin) {
      maxCount = Math.max(maxCount, bin.count || 0);
    });
    if (maxCount === 0) return '';

    var bars = bins
      .map(function (bin) {
        var height = ((bin.count || 0) / maxCount) * 100;
        var className = bin.highlight ? 'mobile-histogram-bar alexis-range' : 'mobile-histogram-bar';
        return '<div class="' + className + '" style="height: ' + height + '%;"></div>';
      })
      .join('');

    return (
      '\n        <div class="mobile-histogram">\n' +
      '          ' + bars + '\n' +
      '        </div>\n' +
      '        <div class="mobile-histogram-labels">\n' +
      '          <span>2.0</span>\n' +
      '          <span>3.0</span>\n' +
      '          <span>4.0</span>\n' +
      '          <span>5.0</span>\n' +
      '          <span>6.0</span>\n' +
      '        </div>\n' +
      '        <div class="mobile-chart-legend">\n' +
      '          <div class="mobile-legend-item">\n' +
      '            <div class="mobile-legend-dot blue"></div>\n' +
      '            <span>Other players</span>\n' +
      '          </div>\n' +
      '          <div class="mobile-legend-item">\n' +
      '            <div class="mobile-legend-dot orange"></div>\n' +
      '            <span>Alexis\'s range</span>\n' +
      '          </div>\n' +
      '        </div>\n' +
      '      '
    );
  }

  function sortPlayers(players, sortBy) {
    var sorted = players.slice();

    if (sortBy === 'rank') {
      sorted.sort(function (a, b) {
        return a.rank - b.rank;
      });
    } else if (sortBy === 'utr') {
      sorted.sort(function (a, b) {
        var aVal = Number.isFinite(a.utr) ? a.utr : -1e9;
        var bVal = Number.isFinite(b.utr) ? b.utr : -1e9;
        return bVal - aVal; // Descending (higher is better)
      });
    } else if (sortBy === 'natRank') {
      sorted.sort(function (a, b) {
        var aVal = Number.isFinite(a.natRank) ? a.natRank : 1e9;
        var bVal = Number.isFinite(b.natRank) ? b.natRank : 1e9;
        return aVal - bVal; // Ascending (lower is better)
      });
    } else if (sortBy === 'wtn') {
      sorted.sort(function (a, b) {
        var aWtn = parseFloat(a.wtn) || 999;
        var bWtn = parseFloat(b.wtn) || 999;
        return aWtn - bWtn; // Ascending (lower is better)
      });
    }

    return sorted;
  }

  function buildPlayerCards(players, sortBy, limit) {
    if (limit === undefined) limit = null;
    var sorted = sortPlayers(players, sortBy);
    var displayPlayers = limit ? sorted.slice(0, limit) : sorted;
    var stats = readKeyStats();
    var showCutoff = sortBy === 'rank'; // Only show cutoff when sorted by seed

    var html = '';
    var cutoffAdded = false;

    displayPlayers.forEach(function (player, index) {
      if (showCutoff && !cutoffAdded && player.rank === stats.drawSize && index < displayPlayers.length - 1) {
        html += '<div class="mobile-cutoff-divider">✂️ Draw cutoff after player #' + stats.drawSize + '</div>';
        cutoffAdded = true;
      }

      var isTopSeed = player.rank <= 8;
      var cardClass = ['mobile-player-card'];
      if (isTopSeed) cardClass.push('top-seed');
      if (player.isTarget) cardClass.push('target-player');

      html +=
        '\n          <div class="' + cardClass.join(' ') + '" data-player-id="' + player.id + '">\n' +
        '            <div class="mobile-player-rank">' + player.rank + '</div>\n' +
        '            <div class="mobile-player-info">\n' +
        '              <div class="mobile-player-name">' + player.fullName + '</div>\n' +
        '              <div class="mobile-player-location">' + player.location + '</div>\n' +
        '            </div>\n' +
        '            <div class="mobile-player-ratings">\n' +
        (player.utrUrl
          ? '              <a href="' + player.utrUrl + '" target="_blank" rel="noopener noreferrer" class="mobile-rating-badge utr" onclick="event.stopPropagation()">\n' +
            '                <div class="mobile-rating-value">' + formatUtrValue(player.utr) + '</div>\n' +
            '                <div class="mobile-rating-label">UTR</div>\n' +
            '              </a>\n'
          : '              <div class="mobile-rating-badge utr">\n' +
            '                <div class="mobile-rating-value">' + formatUtrValue(player.utr) + '</div>\n' +
            '                <div class="mobile-rating-label">UTR</div>\n' +
            '              </div>\n') +
        (player.uaid
          ? '              <a href="https://www.usta.com/en/home/play/player-search/profile.html#?uaid=' +
            player.uaid +
            '" target="_blank" rel="noopener noreferrer" class="mobile-rating-badge nat" onclick="event.stopPropagation()">\n' +
            '                <div class="mobile-rating-value">' + formatNatRankValue(player.natRank) + '</div>\n' +
            '                <div class="mobile-rating-label">Nat</div>\n' +
            '              </a>\n'
          : '              <div class="mobile-rating-badge nat">\n' +
            '                <div class="mobile-rating-value">' + formatNatRankValue(player.natRank) + '</div>\n' +
            '                <div class="mobile-rating-label">Nat</div>\n' +
            '              </div>\n') +
        '            </div>\n' +
        '            <div class="mobile-player-expand-icon">▼</div>\n' +
        '          </div>\n' +
        '          <div class="mobile-player-details" data-player-id="' + player.id + '">\n' +
        '            <div class="mobile-player-details-grid">\n' +
        '              <div class="mobile-detail-item">\n' +
        '                <div class="mobile-detail-label">WTN</div>\n' +
        '                <div class="mobile-detail-value">' + player.wtn + '</div>\n' +
        '              </div>\n' +
        '              <div class="mobile-detail-item">\n' +
        '                <div class="mobile-detail-label">Sec Rank</div>\n' +
        '                <div class="mobile-detail-value">' + (player.sectionRank || 'N/A') + '</div>\n' +
        '              </div>\n' +
        '              <div class="mobile-detail-item">\n' +
        '                <div class="mobile-detail-label">' + rosterDetailLabel() + '</div>\n' +
        '                <div class="mobile-detail-value">' + rosterDetailValue(player) + '</div>\n' +
        '              </div>\n' +
        (player.partner
          ? '              <div class="mobile-detail-item">\n' +
            '                <div class="mobile-detail-label">Partner</div>\n' +
            '                <div class="mobile-detail-value">\n' +
            (player.partnerKey
              ? '                  <button class="mobile-partner-jump" data-partner-key="' +
                player.partnerKey +
                '" onclick="event.stopPropagation()">' + player.partner + '</button>\n'
              : '                  ' + player.partner + '\n') +
            '                </div>\n' +
            '              </div>\n'
          : '') +
        '            </div>\n' +
        '          </div>\n        ';
    });

    return html;
  }

  function buildInfoCards(info) {
    var html = '';

    var cleanText = function (value) {
      return (value || '').replace(/\s+/g, ' ').trim();
    };
    var isLongValue = function (value) {
      return cleanText(value).length > 80;
    };
    var renderRow = function (label, value) {
      var v = cleanText(value);
      if (!v) return '';
      var rowClass = isLongValue(v) ? 'mobile-info-row is-stacked' : 'mobile-info-row';
      return (
        '\n          <div class="' + rowClass + '">\n' +
        '            <span class="mobile-info-label">' + label + '</span>\n' +
        '            <span class="mobile-info-value">' + v + '</span>\n' +
        '          </div>\n        '
      );
    };

    if (info.format.matchFormat || info.format.tiebreaks || info.format.setTiebreak || info.format.matchTiebreak) {
      html +=
        '\n          <div class="mobile-info-card">\n' +
        '            <div class="mobile-info-card-header">\n' +
        '              <span class="icon">🎾</span>\n' +
        '              Format & Scoring\n' +
        '            </div>\n' +
        '            ' + renderRow('Match Format', info.format.matchFormat) + '\n' +
        '            ' + renderRow('Tiebreaks', info.format.tiebreaks) + '\n' +
        '            ' + renderRow('Set Tiebreak', info.format.setTiebreak) + '\n' +
        '            ' + renderRow('3rd Set', info.format.matchTiebreak) + '\n' +
        '          </div>\n        ';
    }

    if (info.venues.length > 0) {
      html +=
        '\n          <div class="mobile-info-card">\n' +
        '            <div class="mobile-info-card-header">\n' +
        '              <span class="icon">📍</span>\n' +
        '              Venues\n' +
        '            </div>\n        ';
      info.venues.forEach(function (venue, i) {
        html +=
          '\n            <div class="mobile-info-row">\n' +
          '              <span class="mobile-info-label">Site ' + (i + 1) + '</span>\n' +
          '              <span class="mobile-info-value">\n' +
          '                ' +
          (venue.url
            ? '<a href="' + venue.url + '" target="_blank" rel="noopener noreferrer">' + venue.name + ' →</a>'
            : venue.name) +
          '\n              </span>\n' +
          '            </div>\n          ';
      });
      html += '</div>';
    }

    if (info.contact.director || info.contact.email || info.contact.phone) {
      html +=
        '\n          <div class="mobile-info-card">\n' +
        '            <div class="mobile-info-card-header">\n' +
        '              <span class="icon">📞</span>\n' +
        '              Contact\n' +
        '            </div>\n' +
        (info.contact.director
          ? '            <div class="mobile-info-row">\n' +
            '              <span class="mobile-info-label">Director</span>\n' +
            '              <span class="mobile-info-value">' + info.contact.director + '</span>\n' +
            '            </div>'
          : '') +
        (info.contact.email
          ? '\n            <div class="mobile-info-row">\n' +
            '              <span class="mobile-info-label">Email</span>\n' +
            '              <span class="mobile-info-value">\n' +
            '                ' +
            (isProbablyEmail(info.contact.email)
              ? '<a href="mailto:' + info.contact.email + '">' + info.contact.email + '</a>'
              : info.contact.email) +
            '\n              </span>\n' +
            '            </div>'
          : '') +
        (info.contact.phone
          ? '\n            <div class="mobile-info-row">\n' +
            '              <span class="mobile-info-label">Phone</span>\n' +
            '              <span class="mobile-info-value">\n' +
            '                ' +
            (info.contact.phoneUrl
              ? '<a href="' + info.contact.phoneUrl + '">' + info.contact.phone + '</a>'
              : info.contact.phone) +
            '\n              </span>\n' +
            '            </div>'
          : '') +
        '\n          </div>\n        ';
    }

    return html;
  }

  // ========================================
  // MAIN RENDER FUNCTION
  // ========================================

  function renderMobileView() {
    allPlayers = loadPlayerData();
    playerByKey = {};
    allPlayers.forEach(function (p) {
      if (p && p.playerKey) playerByKey[p.playerKey] = p;
    });
    targetPlayer = allPlayers.find(function (p) {
      return p.isTarget;
    });
    var stats = readKeyStats();
    var info = readTournamentInfo();

    // Keep the mobile tournament link aligned with the desktop header.
    var desktopTournamentLink = document.querySelector('.desktop-view .tournament-info a');
    var mobileTournamentLink = document.querySelector('a.mobile-tournament-link');
    if (desktopTournamentLink && mobileTournamentLink) {
      if (desktopTournamentLink.href) mobileTournamentLink.href = desktopTournamentLink.href;
      var title = (desktopTournamentLink.textContent || '').trim();
      if (title) mobileTournamentLink.textContent = title;
    }

    var titleText = info.title || "Open Level 5 Championship Singles - Girls' 12 Singles";
    document.getElementById('mobile-title').textContent = titleText;

    var metaEl = document.getElementById('mobile-meta');
    if (metaEl) {
      var datesText = (info.dates || '').trim();
      var locText = (info.location || '').trim();
      var sep = datesText && locText ? ' • ' : '';
      var mapUrl = (info.venues && info.venues[0] && info.venues[0].url) || '';

      metaEl.textContent = '';
      metaEl.append(document.createTextNode(datesText + sep));
      if (mapUrl && locText) {
        var a = document.createElement('a');
        a.href = mapUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = locText;
        metaEl.append(a);
      } else {
        metaEl.append(document.createTextNode(locText));
      }
    }

    document.getElementById('mobile-draw-size').textContent = Number.isFinite(stats.drawSize) ? stats.drawSize : '';
    document.getElementById('mobile-seed').textContent =
      (stats.closes || '').trim() || (Number.isFinite(stats.seed) ? String(stats.seed) : '');
    document.getElementById('mobile-registered').textContent = Number.isFinite(stats.registered) ? stats.registered : '';

    if (targetPlayer) {
      document.getElementById('mobile-alexis-card').innerHTML = buildAlexisCard(targetPlayer);
    }

    if (targetPlayer && allPlayers.length > 0) {
      document.getElementById('mobile-position-gauge').innerHTML = buildPositionGauge(allPlayers, targetPlayer);
      setTimeout(function () {
        var fill = document.getElementById('gauge-fill');
        if (fill) {
          fill.style.width = fill.getAttribute('data-width');
        }
      }, 100);
    }

    document.getElementById('mobile-histogram').innerHTML = buildUtrHistogramMobile();

    document.getElementById('mobile-player-count').textContent = allPlayers.length;

    // Render the roster (full list by default so mobile matches the
    // registered count; a template can opt into an initial top-N via
    // body[data-initial-limit], matching the pre-report.js per-template
    // behavior).
    var initialLimit = initialRenderLimit();
    isExpanded = initialLimit === null;
    syncMobileSortButtons(currentSort);
    renderPlayerList(currentSort, initialLimit);

    document.getElementById('mobile-info-section').innerHTML = buildInfoCards(info);
  }

  function renderPlayerList(sortBy, limit) {
    if (limit === undefined) limit = null;
    if (isMixedEvent && mixedGroups) {
      var groupLimit = limit === null ? null : 8;
      var girlsHtml = buildPlayerCards(mixedGroups.girls, sortBy, groupLimit);
      var boysHtml = buildPlayerCards(mixedGroups.boys, sortBy, groupLimit);
      var mixedHtml =
        '\n          <div class="mobile-group-header">Girls</div>\n' +
        girlsHtml +
        '\n          <div class="mobile-group-header">Boys</div>\n' +
        boysHtml;
      document.getElementById('mobile-player-list').innerHTML = mixedHtml;
    } else if (multiGroups && Array.isArray(multiGroups) && multiGroups.length > 0) {
      var groupLimit2 = limit === null ? null : 8;
      var multiHtml = multiGroups
        .map(function (group) {
          var label = group && group.label ? group.label : 'Players';
          var players = group && Array.isArray(group.players) ? group.players : [];
          var cards = buildPlayerCards(players, sortBy, groupLimit2);
          return '\n            <div class="mobile-group-header">' + label + '</div>\n            ' + cards;
        })
        .join('');
      document.getElementById('mobile-player-list').innerHTML = multiHtml;
    } else if (
      allPlayers.some(function (p) {
        return p.flight;
      })
    ) {
      // Official-flight report: group cards under flight headers, ordered players first.
      var flightOrder = [];
      var byFlight = new Map();
      var alternates = [];
      allPlayers.forEach(function (p) {
        if (p.flight) {
          if (!byFlight.has(p.flight)) {
            byFlight.set(p.flight, []);
            flightOrder.push(p.flight);
          }
          byFlight.get(p.flight).push(p);
        } else {
          alternates.push(p);
        }
      });
      var flightHtml = flightOrder
        .map(function (flight) {
          return (
            '\n            <div class="mobile-group-header">' + flight + '</div>\n            ' +
            buildPlayerCards(byFlight.get(flight), sortBy, null)
          );
        })
        .join('');
      if (alternates.length) {
        flightHtml += buildPlayerCards(alternates, sortBy, null);
      }
      document.getElementById('mobile-player-list').innerHTML = flightHtml;
    } else {
      var html = buildPlayerCards(allPlayers, sortBy, limit);
      document.getElementById('mobile-player-list').innerHTML = html;
    }

    // Update show more button
    var showMoreBtn = document.getElementById('mobile-show-more');
    if (limit && limit < allPlayers.length) {
      showMoreBtn.style.display = 'block';
      showMoreBtn.textContent = 'Show all ' + allPlayers.length + ' players ↓';
      isExpanded = false;
    } else if (limit === null) {
      showMoreBtn.style.display = 'block';
      showMoreBtn.textContent = 'Show less ↑';
      isExpanded = true;
    } else {
      showMoreBtn.style.display = 'none';
    }
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  function syncMobileSortButtons(sortBy) {
    document.querySelectorAll('.mobile-sort-btn').forEach(function (btn) {
      btn.classList.remove('active');
      if (btn.getAttribute('data-sort') === sortBy) {
        btn.classList.add('active');
      }
    });
  }

  function handleSort(sortBy) {
    currentSort = sortBy;
    syncMobileSortButtons(sortBy);

    var limit = isExpanded ? null : 8;
    renderPlayerList(sortBy, limit);
  }

  function handleShowMore() {
    if (isExpanded) {
      renderPlayerList(currentSort, 8);
    } else {
      renderPlayerList(currentSort, null);
    }
  }

  // ========================================
  // VIEW TOGGLE
  // ========================================

  function getUserViewPreference() {
    return localStorage.getItem('tennisReportViewPref');
  }

  function setUserViewPreference(view) {
    localStorage.setItem('tennisReportViewPref', view);
  }

  function detectMobileDevice() {
    return window.innerWidth <= 600;
  }

  function isMobileViewActive() {
    if (document.body.classList.contains('force-mobile')) return true;
    if (document.body.classList.contains('force-desktop')) return false;
    return detectMobileDevice();
  }

  function placeH2HBlock() {
    var wrapper = document.getElementById('alexis-roster-h2h-wrapper');
    if (!wrapper) return;
    var target = isMobileViewActive()
      ? document.getElementById('alexis-h2h-slot-mobile')
      : document.getElementById('alexis-h2h-slot-desktop');
    if (!target) return;
    if (wrapper.parentElement === target) return;
    target.appendChild(wrapper);
  }

  function toggleView(targetView) {
    setUserViewPreference(targetView);

    if (targetView === 'mobile') {
      document.body.classList.add('force-mobile');
      document.body.classList.remove('force-desktop');
    } else {
      document.body.classList.add('force-desktop');
      document.body.classList.remove('force-mobile');
    }
    placeH2HBlock();
  }

  function applyViewPreference() {
    var pref = getUserViewPreference();
    var isMobile = detectMobileDevice();

    if (!isMobile) {
      document.body.classList.remove('force-mobile', 'force-desktop');
      placeH2HBlock();
      return;
    }

    if (pref === 'desktop') {
      document.body.classList.add('force-desktop');
      document.body.classList.remove('force-mobile');
    } else if (pref === 'mobile') {
      document.body.classList.add('force-mobile');
      document.body.classList.remove('force-desktop');
    }
    placeH2HBlock();
  }

  // ========================================
  // PLAYER CARD INTERACTION
  // ========================================

  function togglePlayerDetails(playerId) {
    var card = document.querySelector('.mobile-player-card[data-player-id="' + playerId + '"]');
    var details = document.querySelector('.mobile-player-details[data-player-id="' + playerId + '"]');

    if (!card || !details) return;

    var expanded = card.classList.contains('expanded');

    document.querySelectorAll('.mobile-player-card.expanded').forEach(function (c) {
      c.classList.remove('expanded');
    });
    document.querySelectorAll('.mobile-player-details.expanded').forEach(function (d) {
      d.classList.remove('expanded');
    });

    if (!expanded) {
      card.classList.add('expanded');
      details.classList.add('expanded');
    }
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  function initMobileView() {
    applyViewPreference();

    renderMobileView();

    document.addEventListener('click', function (e) {
      var partnerBtn = e.target.closest('.mobile-partner-jump');
      if (partnerBtn) {
        e.preventDefault();
        e.stopPropagation();
        var key = (partnerBtn.getAttribute('data-partner-key') || '').trim();
        if (!key) return;
        var partner = playerByKey[key];
        if (!partner) return;
        var card = document.querySelector('.mobile-player-card[data-player-id="' + partner.id + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          togglePlayerDetails(partner.id);
        }
        return;
      }

      var card2 = e.target.closest('.mobile-player-card');
      if (card2) {
        var playerId = card2.getAttribute('data-player-id');
        if (playerId) {
          togglePlayerDetails(playerId);
        }
      }
    });

    document.querySelectorAll('.mobile-sort-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleSort(btn.getAttribute('data-sort'));
      });
    });

    var showMoreBtn = document.getElementById('mobile-show-more');
    if (showMoreBtn) showMoreBtn.addEventListener('click', handleShowMore);

    var toggleDesktopBtn = document.getElementById('mobile-toggle-desktop');
    if (toggleDesktopBtn) {
      toggleDesktopBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleView('desktop');
      });
    }

    var toggleMobileBtn = document.getElementById('desktop-toggle-mobile');
    if (toggleMobileBtn) {
      toggleMobileBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleView('mobile');
      });
    }

    window.addEventListener('resize', function () {
      applyViewPreference();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileView);
  } else {
    initMobileView();
  }
})();
