/* ========================================
   MONITORING APP
   Binance Futures Price Tracker
   - Show all coins, star to favorite
   - Live search filter
   - Display size slider (%)
   ======================================== */

// ========== CONSTANTS ==========
const API_ENDPOINTS = [
    'https://fapi.binance.com/fapi/v1/ticker/24hr',
    'https://fapi1.binance.com/fapi/v1/ticker/24hr',
    'https://fapi2.binance.com/fapi/v1/ticker/24hr',
    'https://fapi3.binance.com/fapi/v1/ticker/24hr',
    'https://fapi4.binance.com/fapi/v1/ticker/24hr'
];
const FETCH_TIMEOUT = 8000; // 8 seconds per endpoint
const LS_KEYS = {
    favorites: 'mon_favorites',
    notes: 'mon_notes',
    sort: 'mon_sort',
    slider: 'mon_slider',
    targets: 'mon_targets'
};

// ========== STATE ==========
let allTickers = {};       // { BTCUSDT: { symbol, price, pct, name }, ... }
let allSymbols = [];       // ['BTCUSDT', 'ETHUSDT', ...] sorted
let favorites = new Set(); // Set of symbol strings
let notes = {};            // { BTCUSDT: 'some note', ... }
let targets = {};          // { BTCUSDT: 0.04, ... }
let currentSort = 'name';
let sliderValue = 100;
let searchQuery = '';

// ========== DOM REFS ==========
const favListEl = document.getElementById('favorites-list');
const emptyFavEl = document.getElementById('empty-fav');
const allcoinsListEl = document.getElementById('allcoins-list');
const searchInputEl = document.getElementById('search-input');
const refreshBtnEl = document.getElementById('refresh-btn');
const sortSelectEl = document.getElementById('sort-select');
const sizeSliderEl = document.getElementById('size-slider');
const loadingOverlayEl = document.getElementById('loading-overlay');
const settingsBtnEl = document.getElementById('settings-btn');
const settingsPopupEl = document.getElementById('settings-popup');
const settingsBackdropEl = document.getElementById('settings-backdrop');
const sliderValueEl = document.getElementById('slider-value');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const searchClearBtnEl = document.getElementById('search-clear');

// ========== INIT ==========
function init() {
    loadState();
    applySlider(sliderValue);
    sortSelectEl.value = currentSort;
    bindEvents();
    fetchAllTickers();
    registerServiceWorker();
}

// ========== LOCAL STORAGE ==========
function loadState() {
    try {
        const f = localStorage.getItem(LS_KEYS.favorites);
        if (f) favorites = new Set(JSON.parse(f));
    } catch(e) { favorites = new Set(); }

    try {
        const n = localStorage.getItem(LS_KEYS.notes);
        if (n) notes = JSON.parse(n);
    } catch(e) { notes = {}; }

    try {
        const t = localStorage.getItem(LS_KEYS.targets);
        if (t) targets = JSON.parse(t);
    } catch(e) { targets = {}; }

    const s = localStorage.getItem(LS_KEYS.sort);
    if (s) currentSort = s;

    const sl = localStorage.getItem(LS_KEYS.slider);
    if (sl) sliderValue = Math.min(150, parseInt(sl));
}

function saveFavorites() {
    localStorage.setItem(LS_KEYS.favorites, JSON.stringify([...favorites]));
}

function saveNotes() {
    localStorage.setItem(LS_KEYS.notes, JSON.stringify(notes));
}

function saveTargets() {
    localStorage.setItem(LS_KEYS.targets, JSON.stringify(targets));
}

function saveSort() {
    localStorage.setItem(LS_KEYS.sort, currentSort);
}

function saveSlider() {
    localStorage.setItem(LS_KEYS.slider, String(sliderValue));
}

// ========== API ==========
async function fetchWithFallback(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }
}

async function fetchFromBinance() {
    for (const endpoint of API_ENDPOINTS) {
        try {
            const res = await fetchWithFallback(endpoint);
            const data = await res.json();
            return data;
        } catch (e) {
            console.warn(`Endpoint failed: ${endpoint}`, e.message);
            continue;
        }
    }
    throw new Error('All Binance endpoints unreachable');
}

async function fetchAllTickers() {
    try {
        const data = await fetchFromBinance();

        allTickers = {};
        allSymbols = [];

        data.forEach(t => {
            const symbol = t.symbol;
            if (!symbol.endsWith('USDT')) return;

            const name = symbol.replace('USDT', '');
            allTickers[symbol] = {
                symbol,
                name,
                price: parseFloat(t.lastPrice),
                pct: parseFloat(t.priceChangePercent)
            };
            allSymbols.push(symbol);
        });

        allSymbols.sort((a, b) => a.localeCompare(b));
        renderList();
    } catch (err) {
        console.error('Fetch error:', err);
        allcoinsListEl.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Gagal memuat data.</p><p class="empty-hint">Kemungkinan Binance diblokir di jaringan kamu. Coba pakai VPN.</p></div>';
        showToast('Semua endpoint Binance tidak bisa diakses.');
    }
}

async function refreshPrices() {
    loadingOverlayEl.classList.add('active');
    refreshBtnEl.classList.add('spinning');

    try {
        const data = await fetchFromBinance();

        data.forEach(t => {
            const symbol = t.symbol;
            if (!symbol.endsWith('USDT')) return;
            if (allTickers[symbol]) {
                allTickers[symbol].price = parseFloat(t.lastPrice);
                allTickers[symbol].pct = parseFloat(t.priceChangePercent);
            }
        });

        renderList();
        showToast('Harga berhasil diperbarui');
    } catch (err) {
        showToast('Gagal refresh. Cek koneksi.');
    } finally {
        loadingOverlayEl.classList.remove('active');
        setTimeout(() => refreshBtnEl.classList.remove('spinning'), 800);
    }
}

// ========== DISPLAY SCALE ==========
function applySlider(val) {
    sliderValue = val;
    const scale = val / 100;
    document.documentElement.style.setProperty('--display-scale', scale);
    sizeSliderEl.value = val;
    sliderValueEl.textContent = val + '%';
    saveSlider();
}

// ========== SORTING ==========
function getDisplayList() {
    let symbols = [...allSymbols];

    // Apply search filter
    if (searchQuery) {
        const q = searchQuery.toUpperCase();
        symbols = symbols.filter(s => {
            const name = allTickers[s].name;
            return name.startsWith(q) || name.includes(q);
        });
    }

    // Split into favorites and rest
    const favs = symbols.filter(s => favorites.has(s));
    const rest = symbols.filter(s => !favorites.has(s));

    // Favorites: always sort by target proximity (closest first)
    favs.sort((a, b) => {
        const distA = getTargetDistance(a);
        const distB = getTargetDistance(b);
        // Smaller distance = closer to target = should be first
        if (distA === -1 && distB === -1) return a.localeCompare(b);
        if (distA === -1) return 1;
        if (distB === -1) return -1;
        return distA - distB;
    });

    // All coins: use dropdown sort
    const sortFn = getSortFunction();
    rest.sort(sortFn);

    return { favs, rest };
}

function getSortFunction() {
    if (currentSort === 'high') {
        return (a, b) => {
            const pctA = allTickers[a] ? allTickers[a].pct : -Infinity;
            const pctB = allTickers[b] ? allTickers[b].pct : -Infinity;
            return pctB - pctA;
        };
    }
    // Default: name A-Z
    return (a, b) => a.localeCompare(b);
}

// Returns remaining distance % to target (0 = reached, 100 = far, -1 = no target)
function getTargetDistance(symbol) {
    const target = targets[symbol];
    if (!target || target <= 0) return -1;
    const price = allTickers[symbol] ? allTickers[symbol].price : 0;
    if (price <= 0) return -1;
    if (target === price) return 0;
    // Distance as percentage
    return Math.abs((target - price) / price) * 100;
}

// Returns progress 0-100 (100 = reached target)
function getTargetProgress(symbol) {
    const target = targets[symbol];
    if (!target || target <= 0) return -1;
    const price = allTickers[symbol] ? allTickers[symbol].price : 0;
    if (price <= 0) return -1;
    if (target > price) return Math.min(100, (price / target) * 100);
    if (target < price) return Math.min(100, (target / price) * 100);
    return 100;
}

// ========== RENDERING ==========
function renderList() {
    // Clear both lists
    favListEl.innerHTML = '';
    allcoinsListEl.innerHTML = '';

    if (allSymbols.length === 0) {
        // Still loading
        emptyFavEl.style.display = 'none';
        allcoinsListEl.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <p>Memuat data dari Binance...</p>
            </div>`;
        return;
    }

    const { favs } = getDisplayList();

    // === Favorites tab ===
    if (favs.length > 0) {
        emptyFavEl.style.display = 'none';
        favs.forEach(symbol => {
            favListEl.appendChild(createCoinCard(symbol, true, true));
        });
    } else {
        if (searchQuery) {
            emptyFavEl.style.display = 'none';
        } else {
            emptyFavEl.style.display = 'block';
        }
    }

    // === All Coins tab (grid) - shows ALL coins ===
    // Use all symbols that match search (including favorites)
    let allCoins;
    if (searchQuery) {
        const q = searchQuery.toUpperCase();
        allCoins = [...allSymbols].filter(s => {
            const name = allTickers[s].name;
            return name.startsWith(q) || name.includes(q);
        });
    } else {
        allCoins = [...allSymbols];
    }
    const sortFn2 = getSortFunction();
    allCoins.sort(sortFn2);

    if (allCoins.length > 0) {
        allCoins.forEach(symbol => {
            allcoinsListEl.appendChild(createCoinCard(symbol, favorites.has(symbol), false));
        });
    } else {
        const noRes = document.createElement('div');
        noRes.className = 'no-results';
        noRes.style.gridColumn = '1/-1';
        noRes.textContent = searchQuery
            ? `Tidak ada koin "${searchQuery}"`
            : 'Belum ada data.';
        allcoinsListEl.appendChild(noRes);
    }
}

function createCoinCard(symbol, isFav, inFavTab) {
    const data = allTickers[symbol];
    if (!data) return document.createElement('div');

    const card = document.createElement('div');
    card.className = 'coin-card' + (isFav ? ' is-favorite' : '');
    card.dataset.symbol = symbol;

    // Pct class
    let pctClass = 'zero';
    if (data.pct > 0) pctClass = 'positive';
    else if (data.pct < 0) pctClass = 'negative';

    const formattedPrice = formatPrice(data.price);
    const formattedPct = (data.pct > 0 ? '+' : '') + Math.round(data.pct) + '%';

    // Star icon
    const starIcon = isFav ? '\u2605' : '\u2606';

    // Favorites tab: show notes + checkmark (hidden by default)
    if (isFav && inFavTab) {
        const savedTarget = targets[symbol] || '';
        const hasTarget = savedTarget !== '';
        const targetVal = hasTarget ? parseFloat(savedTarget) : 0;
        const curPrice = allTickers[symbol] ? allTickers[symbol].price : data.price;

        // Pre-calculate progress for initial render
        let initProgress = 0;
        if (hasTarget && targetVal > 0 && curPrice > 0) {
            if (targetVal > curPrice) initProgress = Math.min(100, (curPrice / targetVal) * 100);
            else if (targetVal < curPrice) initProgress = Math.min(100, (targetVal / curPrice) * 100);
            else initProgress = 100;
            initProgress = Math.round(initProgress);
        }

        card.innerHTML = `
            <button class="btn-star active" data-symbol="${symbol}">${starIcon}</button>
            <div class="card-top">
                <div class="coin-info">
                    <div class="coin-name">${data.name}</div>
                    <div class="coin-price">${formattedPrice}</div>
                    <span class="coin-pct ${pctClass}">${formattedPct}</span>
                </div>
                <textarea class="coin-note" rows="1" placeholder="Catatan..." data-symbol="${symbol}">${notes[symbol] || ''}</textarea>
                <button class="btn-note-done" data-symbol="${symbol}" title="Selesai" style="display:none;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </button>
            </div>
            <div class="target-row">
                <button class="btn-target-toggle" data-symbol="${symbol}" title="Set target harga">
                    <span class="target-dot"></span>
                </button>
                <div class="target-input-wrap" style="display:none;">
                    <input type="number" class="target-input" data-symbol="${symbol}" placeholder="Target..." value="${savedTarget}" step="any">
                </div>
                <div class="target-meter" data-symbol="${symbol}" style="display:${hasTarget ? 'block' : 'none'};">
                    <div class="target-meter-info">
                        <span class="target-label">→ <b class="target-price">${hasTarget ? formatPrice(targetVal) : ''}</b></span>
                        <span class="target-diff ${initProgress >= 95 ? 'diff-reached' : initProgress >= 80 ? 'diff-close' : ''}">${hasTarget ? initProgress + '%' : ''}</span>
                    </div>
                    <div class="target-bar-bg">
                        <div class="target-bar-fill ${initProgress >= 95 ? 'bar-reached' : initProgress >= 80 ? 'bar-close' : initProgress <= 30 ? 'bar-far' : ''}" style="width:${hasTarget ? initProgress : 0}%;"></div>
                    </div>
                </div>
            </div>
        `;
    } else {
        // All Coins tab or non-fav: compact grid card
        card.innerHTML = `
            <div class="card-top">
                <button class="btn-star${isFav ? ' active' : ''}" data-symbol="${symbol}">${starIcon}</button>
                <div class="coin-info">
                    <div class="coin-name-row">
                        <div class="coin-name">${data.name}</div>
                        <span class="coin-pct ${pctClass}">${formattedPct}</span>
                    </div>
                    <div class="coin-price">${formattedPrice}</div>
                </div>
            </div>
        `;
    }

    // Star click handler
    const starBtn = card.querySelector('.btn-star');
    starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(symbol);
    });

    // Note handler (favorites tab only)
    if (isFav && inFavTab) {
        const noteEl = card.querySelector('.coin-note');
        const doneBtn = card.querySelector('.btn-note-done');
        const meterEl = card.querySelector('.target-meter');
        const targetInputEl = card.querySelector('.target-input');
        const targetToggleBtn = card.querySelector('.btn-target-toggle');
        const targetInputWrap = card.querySelector('.target-input-wrap');

        // Update target meter from target input
        function updateMeter() {
            const target = parseFloat(targetInputEl.value);
            if (!target || target <= 0 || isNaN(target)) {
                meterEl.style.display = 'none';
                return;
            }
            meterEl.style.display = 'block';
            const currentPrice = allTickers[symbol] ? allTickers[symbol].price : data.price;
            if (currentPrice <= 0) return;

            // Progress: 0% = far, 100% = reached target
            let progress;
            if (target > currentPrice) {
                progress = Math.min(100, (currentPrice / target) * 100);
            } else if (target < currentPrice) {
                progress = Math.min(100, (target / currentPrice) * 100);
            } else {
                progress = 100;
            }
            progress = Math.round(progress);

            const fillEl = meterEl.querySelector('.target-bar-fill');
            const priceEl = meterEl.querySelector('.target-price');
            const diffEl = meterEl.querySelector('.target-diff');

            priceEl.textContent = formatPrice(target);
            diffEl.textContent = progress + '%';
            diffEl.className = 'target-diff ' + (progress >= 95 ? 'diff-reached' : progress >= 80 ? 'diff-close' : '');

            fillEl.style.width = progress + '%';
            fillEl.className = 'target-bar-fill ' + (progress >= 95 ? 'bar-reached' : progress >= 80 ? 'bar-close' : progress <= 30 ? 'bar-far' : '');
        }

        function hideTargetInput() {
            const val = parseFloat(targetInputEl.value);
            if (val && val > 0) {
                targets[symbol] = val;
                saveTargets();
                updateMeter();
                targetInputWrap.style.display = 'none';
            } else {
                targetInputWrap.style.display = 'none';
                meterEl.style.display = 'none';
                delete targets[symbol];
                saveTargets();
            }
        }

        // Toggle button: show input for editing
        targetToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            targetInputWrap.style.display = 'flex';
            targetInputEl.focus();
            targetInputEl.select();
        });

        // Auto-hide on blur
        targetInputEl.addEventListener('blur', () => {
            setTimeout(() => hideTargetInput(), 150);
        });

        // Enter key = done
        targetInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                targetInputEl.blur();
            }
        });

        // Live update while typing
        targetInputEl.addEventListener('input', () => {
            const val = parseFloat(targetInputEl.value);
            if (val && val > 0) {
                targets[symbol] = val;
            } else {
                delete targets[symbol];
            }
            saveTargets();
            updateMeter();
        });

        // Show checkmark when editing note
        noteEl.addEventListener('focus', () => {
            doneBtn.style.display = 'flex';
        });
        noteEl.addEventListener('input', () => {
            notes[symbol] = noteEl.value;
            saveNotes();
            noteEl.style.height = 'auto';
            noteEl.style.height = noteEl.scrollHeight + 'px';
        });

        setTimeout(() => {
            if (noteEl.value && noteEl.scrollHeight > 0) {
                noteEl.style.height = 'auto';
                requestAnimationFrame(() => {
                    noteEl.style.height = noteEl.scrollHeight + 'px';
                });
            }
            updateMeter();
        }, 10);

        // Note done button
        doneBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            noteEl.blur();
            doneBtn.style.display = 'none';
            showToast('Catatan disimpan');
        });

        // Store meter update function for price refresh
        card._updateMeter = updateMeter;
    }

    return card;
}

// ========== FAVORITES ==========
function toggleFavorite(symbol) {
    if (favorites.has(symbol)) {
        favorites.delete(symbol);
        showToast(`${allTickers[symbol].name} dihapus dari favorit.`);
    } else {
        favorites.add(symbol);
        showToast(`${allTickers[symbol].name} ditambahkan ke favorit.`);
    }
    saveFavorites();
    renderList();
}

// ========== FORMATTING ==========
function formatPrice(price) {
    if (price === 0 || isNaN(price)) return '-';
    if (price >= 1000) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (price >= 1) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    // For small decimals (< 1): show all leading zeros + 3 significant digits
    const str = price.toFixed(20);
    const dotIdx = str.indexOf('.');
    if (dotIdx === -1) return str;

    let firstNonZero = -1;
    for (let i = dotIdx + 1; i < str.length; i++) {
        if (str[i] !== '0') {
            firstNonZero = i;
            break;
        }
    }

    if (firstNonZero === -1) return '0';

    const keep = firstNonZero + 3; // 3 significant digits after leading zeros
    const result = str.substring(0, keep + 1);
    return parseFloat(result).toString();
}

// ========== TOAST ==========
let toastTimeout = null;
function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2200);
}

// ========== EVENT BINDING ==========
function bindEvents() {
    // Refresh
    // Refresh button: drag + click
    let isDragging = false;
    let dragMoved = false;
    let dragStartX, dragStartY, btnStartX, btnStartY;

    function onDragStart(e) {
        const point = e.touches ? e.touches[0] : e;
        isDragging = true;
        dragMoved = false;
        const rect = refreshBtnEl.getBoundingClientRect();
        dragStartX = point.clientX;
        dragStartY = point.clientY;
        btnStartX = rect.left;
        btnStartY = rect.top;
        refreshBtnEl.classList.add('dragging');
        e.preventDefault();
    }

    function onDragMove(e) {
        if (!isDragging) return;
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - dragStartX;
        const dy = point.clientY - dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
        const btnSize = refreshBtnEl.offsetWidth;
        let newX = btnStartX + dx;
        let newY = btnStartY + dy;
        // Clamp within viewport
        newX = Math.max(0, Math.min(window.innerWidth - btnSize, newX));
        newY = Math.max(0, Math.min(window.innerHeight - btnSize, newY));
        refreshBtnEl.style.left = newX + 'px';
        refreshBtnEl.style.top = newY + 'px';
        refreshBtnEl.style.right = 'auto';
        refreshBtnEl.style.bottom = 'auto';
    }

    function onDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        refreshBtnEl.classList.remove('dragging');
        if (!dragMoved) {
            refreshPrices();
        }
        // Save position
        const rect = refreshBtnEl.getBoundingClientRect();
        localStorage.setItem('refresh-btn-pos', JSON.stringify({ left: rect.left, top: rect.top }));
    }

    // Restore saved position
    try {
        const pos = JSON.parse(localStorage.getItem('refresh-btn-pos'));
        if (pos && typeof pos.left === 'number') {
            refreshBtnEl.style.left = pos.left + 'px';
            refreshBtnEl.style.top = pos.top + 'px';
            refreshBtnEl.style.right = 'auto';
            refreshBtnEl.style.bottom = 'auto';
        }
    } catch(e) {}

    refreshBtnEl.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    refreshBtnEl.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);

    // Sort
    sortSelectEl.addEventListener('change', () => {
        currentSort = sortSelectEl.value;
        saveSort();
        renderList();
    });

    // Size slider
    sizeSliderEl.addEventListener('input', () => {
        applySlider(parseInt(sizeSliderEl.value));
    });

    // Search input - live filter
    searchInputEl.addEventListener('input', () => {
        searchQuery = searchInputEl.value.trim();
        searchClearBtnEl.style.display = searchQuery ? 'flex' : 'none';
        renderList();
    });

    // Search clear button
    searchClearBtnEl.addEventListener('click', () => {
        searchInputEl.value = '';
        searchQuery = '';
        searchClearBtnEl.style.display = 'none';
        renderList();
    });

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabPanels.forEach(p => p.classList.remove('active'));
            const targetPanel = document.getElementById('tab-' + tab);
            targetPanel.classList.add('active');

            // Recalculate textarea heights + update meters when switching to favorites
            if (tab === 'favorites') {
                targetPanel.querySelectorAll('.coin-note').forEach(noteEl => {
                    if (noteEl.value) {
                        noteEl.style.height = 'auto';
                        requestAnimationFrame(() => {
                            noteEl.style.height = noteEl.scrollHeight + 'px';
                        });
                    }
                });
                // Re-trigger meter updates
                targetPanel.querySelectorAll('.coin-card').forEach(card => {
                    if (card._updateMeter) card._updateMeter();
                });
            }
        });
    });

    // Swipe gesture to switch tabs
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeTracking = false;
    const SWIPE_THRESHOLD = 50;
    const SWIPE_MAX_VERTICAL = 80;

    const appContainer = document.querySelector('.app-container');

    appContainer.addEventListener('touchstart', (e) => {
        // Don't start swipe on interactive elements
        const target = e.target;
        if (target.closest('textarea, input, button, select, .btn-star, .btn-target-toggle, .fab-refresh')) return;
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        swipeTracking = true;
    }, { passive: true });

    appContainer.addEventListener('touchend', (e) => {
        if (!swipeTracking) return;
        swipeTracking = false;
        const dx = e.changedTouches[0].clientX - swipeStartX;
        const dy = e.changedTouches[0].clientY - swipeStartY;
        // Only trigger if horizontal swipe is dominant
        if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_MAX_VERTICAL) return;

        // Find current active tab
        let currentTab = 'favorites';
        tabBtns.forEach(btn => {
            if (btn.classList.contains('active')) currentTab = btn.dataset.tab;
        });

        let newTab = null;
        if (dx < 0 && currentTab === 'favorites') {
            newTab = 'allcoins'; // swipe left → all coins
        } else if (dx > 0 && currentTab === 'allcoins') {
            newTab = 'favorites'; // swipe right → favorites
        }

        if (newTab) {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));
            const newBtn = document.querySelector(`[data-tab="${newTab}"]`);
            const newPanel = document.getElementById('tab-' + newTab);
            newBtn.classList.add('active');
            newPanel.classList.add('active');

            if (newTab === 'favorites') {
                newPanel.querySelectorAll('.coin-note').forEach(noteEl => {
                    if (noteEl.value) {
                        noteEl.style.height = 'auto';
                        requestAnimationFrame(() => {
                            noteEl.style.height = noteEl.scrollHeight + 'px';
                        });
                    }
                });
                newPanel.querySelectorAll('.coin-card').forEach(card => {
                    if (card._updateMeter) card._updateMeter();
                });
            }
        }
    }, { passive: true });

    // Settings popup
    settingsBtnEl.addEventListener('click', () => {
        settingsPopupEl.classList.add('active');
    });
    settingsBackdropEl.addEventListener('click', () => {
        settingsPopupEl.classList.remove('active');
    });
}

// ========== SERVICE WORKER ==========
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW registration failed:', err);
        });
    }
}

// ========== START ==========
document.addEventListener('DOMContentLoaded', init);
