(function() {
    'use strict';

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    const crossingsContainer = document.getElementById('crossings');
    const lastUpdateEl = document.getElementById('last-update');
    const refreshBtn = document.getElementById('refresh-btn');
    const modal = document.getElementById('modal');
    const modalClose = document.getElementById('modal-close');
    const modalIcon = document.getElementById('modal-icon');
    const modalTitle = document.getElementById('modal-title');
    const heatmapInto = document.getElementById('heatmap-into');
    const heatmapOut = document.getElementById('heatmap-out');

    let currentCrossings = [];
    let lastFetchTime = null;
    let lastFocusedCard = null;

    // Rate limiting for manual refreshes
    const REFRESH_LIMIT = 3;           // Max refreshes allowed
    const REFRESH_WINDOW = 60 * 1000;  // Within 1 minute
    const COOLDOWN_TIME = 30 * 1000;   // 30 second cooldown when limit hit
    let refreshTimestamps = [];
    let cooldownUntil = null;

    function canRefresh() {
        const now = Date.now();

        // Check if in cooldown
        if (cooldownUntil && now < cooldownUntil) {
            return false;
        }

        // Clear cooldown if expired
        if (cooldownUntil && now >= cooldownUntil) {
            cooldownUntil = null;
            refreshTimestamps = [];
        }

        // Remove timestamps outside the window
        refreshTimestamps = refreshTimestamps.filter(t => now - t < REFRESH_WINDOW);

        return refreshTimestamps.length < REFRESH_LIMIT;
    }

    function recordRefresh() {
        refreshTimestamps.push(Date.now());

        // If limit reached, start cooldown
        if (refreshTimestamps.length >= REFRESH_LIMIT) {
            cooldownUntil = Date.now() + COOLDOWN_TIME;
            startCooldownTimer();
        }
    }

    function startCooldownTimer() {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('cooldown');

        const updateCooldown = () => {
            const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
            if (remaining > 0) {
                refreshBtn.title = `Wait ${remaining}s`;
                setTimeout(updateCooldown, 1000);
            } else {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove('cooldown');
                refreshBtn.title = 'Refresh';
            }
        };
        updateCooldown();
    }

    function getRelativeTime(date) {
        const now = Date.now();
        const diffMs = now - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);

        if (diffSec < 10) return 'Just now';
        if (diffSec < 60) return `${diffSec} sec ago`;
        if (diffMin === 1) return '1 min ago';
        if (diffMin < 60) return `${diffMin} min ago`;
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    async function fetchCrossings() {
        refreshBtn.classList.add('loading');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch('/api/crossings', { signal: controller.signal });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Invalid response format');
            }

            const data = await response.json();
            currentCrossings = data;
            renderCrossings(data);
            updateTimestamp();
        } catch (error) {
            console.error('Failed to fetch crossings:', error);
            crossingsContainer.innerHTML = `
                <div class="error-state">
                    <p>Sorry, we couldn't load traffic data right now.</p>
                    <button class="retry-btn" data-action="reload">Try Again</button>
                </div>
            `;
        } finally {
            clearTimeout(timeoutId);
            refreshBtn.classList.remove('loading');
        }
    }

    function renderCrossings(crossings) {
        // Group crossings by name
        const grouped = {};
        crossings.forEach(crossing => {
            const baseName = crossing.name;
            if (!grouped[baseName]) {
                grouped[baseName] = { name: baseName, icon: crossing.icon };
            }
            if (crossing.direction === 'Into Manhattan') {
                grouped[baseName].into = crossing;
            } else {
                grouped[baseName].out = crossing;
            }
        });

        // Filter out incomplete groups (missing into or out data)
        const crossingGroups = Object.values(grouped).filter(g => g.into && g.out);

        if (crossingGroups.length === 0) {
            crossingsContainer.innerHTML = `
                <div class="error-state">
                    <p>Sorry, no crossing data is available right now.</p>
                    <button class="retry-btn" data-action="reload">Try Again</button>
                </div>
            `;
            return;
        }

        crossingsContainer.innerHTML = crossingGroups.map((group, index) => {
            const intoTime = typeof group.into.waitTime === 'number' ? group.into.waitTime : Infinity;
            const outTime = typeof group.out.waitTime === 'number' ? group.out.waitTime : Infinity;
            const intoFaster = intoTime < outTime && intoTime !== Infinity;
            const outFaster = outTime < intoTime && outTime !== Infinity;
            const intoDisplay = typeof group.into.waitTime === 'number' ? escapeHtml(group.into.waitTime) : '--';
            const outDisplay = typeof group.out.waitTime === 'number' ? escapeHtml(group.out.waitTime) : '--';
            const name = escapeHtml(group.name);
            const icon = escapeHtml(group.icon);
            const area = escapeHtml(group.into.area || '');

            function delayHtml(crossing) {
                if (typeof crossing.waitTime !== 'number' || typeof crossing.baselineTime !== 'number') return '';
                const delay = crossing.waitTime - crossing.baselineTime;
                if (delay <= 0) return '<div class="delay-info">No delay</div>';
                return `<div class="delay-info">+${escapeHtml(delay)} min from traffic</div>`;
            }

            function distanceHtml(crossing) {
                if (!crossing.distance) return '';
                return `<div class="distance-info">${escapeHtml(crossing.distance)}</div>`;
            }

            return `
            <div class="crossing-card" data-crossing="${name}" role="button" tabindex="0" aria-label="View details for ${name}" style="animation: fadeIn 0.3s ease ${index * 0.1}s both;">
                <div class="card-header">
                    <span class="crossing-icon">${icon}</span>
                    <h2>${name}</h2>
                    ${area ? `<span class="card-area">${area}</span>` : ''}
                </div>
                <div class="directions-row">
                    <div class="direction-box into${intoFaster ? ' faster' : ''}">
                        <div class="direction-label">Into NYC${intoFaster ? ' ✓' : ''}</div>
                        <div class="wait-time">${intoDisplay}</div>
                        <div class="wait-label">${typeof group.into.waitTime === 'number' ? 'minutes' : ''}</div>
                        ${delayHtml(group.into)}
                        ${distanceHtml(group.into)}
                        <span class="status-badge ${escapeHtml(group.into.statusClass)}">${escapeHtml(group.into.status)}</span>
                    </div>
                    <div class="direction-box out${outFaster ? ' faster' : ''}">
                        <div class="direction-label">Out of NYC${outFaster ? ' ✓' : ''}</div>
                        <div class="wait-time">${outDisplay}</div>
                        <div class="wait-label">${typeof group.out.waitTime === 'number' ? 'minutes' : ''}</div>
                        ${delayHtml(group.out)}
                        ${distanceHtml(group.out)}
                        <span class="status-badge ${escapeHtml(group.out.statusClass)}">${escapeHtml(group.out.status)}</span>
                    </div>
                </div>
            </div>
        `}).join('');
    }

    async function openModal(crossingName) {
        // Find the crossing data
        const intoData = currentCrossings.find(c => c.name === crossingName && c.direction === 'Into Manhattan');
        const outData = currentCrossings.find(c => c.name === crossingName && c.direction === 'Out of Manhattan');

        if (!intoData || !outData) return;

        modalIcon.textContent = intoData.icon;
        modalTitle.textContent = crossingName;
        modal.classList.add('open');
        modalClose.focus();

        // Show loading state
        heatmapInto.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Loading...</p>';
        heatmapOut.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Loading...</p>';

        // Fetch historical data for both directions
        try {
            const fetchHistory = async (id) => {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 10000);
                try {
                    const response = await fetch(`/api/crossings/${id}/history`, { signal: ctrl.signal });
                    if (!response.ok) throw new Error(`Server error: ${response.status}`);
                    return response.json();
                } finally {
                    clearTimeout(tid);
                }
            };

            const [intoHistory, outHistory] = await Promise.all([
                fetchHistory(intoData.id),
                fetchHistory(outData.id)
            ]);

            renderHeatmap(heatmapInto, intoHistory);
            renderHeatmap(heatmapOut, outHistory);
        } catch (error) {
            console.error('Failed to fetch historical data:', error);
            const errorHtml = `
                <div class="heatmap-empty">
                    <p>Sorry, historical data isn't available right now.</p>
                </div>
            `;
            heatmapInto.innerHTML = errorHtml;
            heatmapOut.innerHTML = errorHtml;
        }
    }

    function renderHeatmap(container, data) {
        const { days, heatmap } = data;

        // Check if there's any actual data
        const hasData = heatmap.some(cell => cell.avgTime !== null);

        if (!hasData) {
            container.innerHTML = `
                <div class="heatmap-empty">
                    <p>No historical data available</p>
                    <span>Data will appear here as traffic readings are collected</span>
                </div>
            `;
            return;
        }

        // On mobile, show only peak commute hours (6-10am, 4-8pm)
        const isMobile = window.innerWidth <= 600;
        const peakHours = [6, 7, 8, 9, 10, 16, 17, 18, 19, 20];
        const hours = isMobile ? peakHours : data.hours;

        let html = '';
        if (isMobile) {
            html += '<p class="peak-hours-note">Showing peak hours only</p>';
        }
        html += `<div class="heatmap" role="grid" style="grid-template-columns: 50px repeat(${hours.length}, 1fr);">`;

        // Header row with hour labels
        html += '<div class="heatmap-row" role="row">';
        html += '<div class="heatmap-cell heatmap-label" role="columnheader"></div>'; // Empty corner
        hours.forEach(hour => {
            const displayHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
            const ampm = hour >= 12 ? 'pm' : 'am';
            const label = `${displayHour}${ampm}`;
            html += `<div class="heatmap-cell heatmap-label hour-label" role="columnheader">${label}</div>`;
        });
        html += '</div>';

        // Data rows
        days.forEach((day, dayIndex) => {
            html += '<div class="heatmap-row" role="row">';
            html += `<div class="heatmap-cell heatmap-label day-label" role="rowheader">${day}</div>`;

            hours.forEach(hour => {
                const cell = heatmap.find(h => h.dayIndex === dayIndex && h.hour === hour);
                const avgTime = cell ? cell.avgTime : null;
                const label = cell ? cell.label : `${hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour)}${hour >= 12 ? 'pm' : 'am'}`;
                const safeDay = escapeHtml(day);
                const safeLabel = escapeHtml(label);

                if (avgTime === null) {
                    html += `<div class="heatmap-cell no-data" role="gridcell" title="${safeDay} ${safeLabel}: No data">-</div>`;
                } else {
                    const sampleCount = cell ? cell.sampleCount : 0;
                    const sampleText = sampleCount > 0 ? ` (${escapeHtml(sampleCount)} reading${sampleCount === 1 ? '' : 's'})` : '';
                    const color = getHeatmapColor(avgTime);
                    html += `<div class="heatmap-cell" role="gridcell" style="background: ${color};" title="${safeDay} ${safeLabel}: ${escapeHtml(avgTime)} min${sampleText}">${escapeHtml(avgTime)}</div>`;
                }
            });

            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;
    }

    function getHeatmapColor(value) {
        // Map value (8-45 min) to color (green -> yellow -> red)
        const min = 8;
        const max = 45;
        const normalized = Math.max(0, Math.min(1, (value - min) / (max - min)));

        // Green to yellow to red gradient
        let r, g, b;
        if (normalized < 0.5) {
            // Green to yellow
            const t = normalized * 2;
            r = Math.round(34 + (234 - 34) * t);
            g = Math.round(197 + (179 - 197) * t);
            b = Math.round(94 + (8 - 94) * t);
        } else {
            // Yellow to red
            const t = (normalized - 0.5) * 2;
            r = Math.round(234 + (239 - 234) * t);
            g = Math.round(179 + (68 - 179) * t);
            b = Math.round(8 + (68 - 8) * t);
        }

        return `rgb(${r}, ${g}, ${b})`;
    }

    function closeModal() {
        modal.classList.remove('open');
        if (lastFocusedCard) {
            lastFocusedCard.focus();
            lastFocusedCard = null;
        }
    }

    function updateTimestamp() {
        lastFetchTime = new Date();
        lastUpdateEl.textContent = 'Last updated: Just now';
    }

    function refreshTimestamp() {
        if (lastFetchTime) {
            lastUpdateEl.textContent = `Last updated: ${getRelativeTime(lastFetchTime)}`;
        }
    }

    async function fetchStats() {
        try {
            const response = await fetch('/api/stats');
            if (!response.ok) return;
            const stats = await response.json();
            const footerStats = document.getElementById('footer-stats');
            if (!footerStats) return;
            const totalReadings = stats.crossings.reduce((sum, c) => sum + c.readingCount, 0);
            const source = stats.apiConfigured ? 'Live data' : 'Mock data';
            footerStats.textContent = `${totalReadings.toLocaleString()} readings \u00b7 ${source}`;
        } catch (_) {
            // Stats are non-critical, silently ignore errors
        }
    }

    // Manual refresh with rate limiting
    function manualRefresh() {
        if (!canRefresh()) return;
        recordRefresh();
        fetchCrossings();
    }

    // Event delegation for crossings container (cards + retry buttons)
    crossingsContainer.addEventListener('click', (e) => {
        const reloadBtn = e.target.closest('[data-action="reload"]');
        if (reloadBtn) {
            location.reload();
            return;
        }
        const card = e.target.closest('.crossing-card');
        if (card) {
            lastFocusedCard = card;
            openModal(card.dataset.crossing);
        }
    });

    crossingsContainer.addEventListener('keydown', (e) => {
        const card = e.target.closest('.crossing-card');
        if (card && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            lastFocusedCard = card;
            openModal(card.dataset.crossing);
        }
    });

    // Event listeners
    refreshBtn.addEventListener('click', manualRefresh);
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) {
            closeModal();
        }
        // Focus trap within modal
        if (e.key === 'Tab' && modal.classList.contains('open')) {
            const focusable = modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
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
    });

    // Initial load
    fetchCrossings().then(fetchStats);

    // Update relative timestamp every 10 seconds
    setInterval(refreshTimestamp, 10000);

    // Auto-refresh every 10 minutes
    setInterval(() => { fetchCrossings().then(fetchStats); }, 600000);
})();
