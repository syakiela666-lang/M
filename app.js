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
    slider: 'mon_slider'
};

// ========== STATE ==========
let allTickers = {};       // { BTCUSDT: { symbol, price, pct, name }, ... }
let allSymbols = [];       // ['BTCUSDT', 'ETHUSDT', ...] sorted
let favorites = new Set(); // Set of symbol strings
let notes = {};            // { BTCUSDT: 'some note', ... }
let currentSort = 'name';
let sliderValue = 100;
let searchQuery = '';

// ========== DOM REFS ==========
const favListEl = document.getElementById('favorites-list');
const favSectionEl = document.getElementById('favorites-section');
const emptyFavEl = document.getElementById('empty-fav');
const favHeaderEl = document.querySelector('.fav-header');
const allcoinsListEl = document.getElementById('allcoins-list');
const allcoinsHeaderEl = document.querySelector('.allcoins-header');
const searchInputEl = document.getElementById('search-input');
const refreshBtnEl = document.getElementById('refresh-btn');
const sortSelectEl = document.getElementById('sort-select');
const sizeSliderEl = document.getElementById('size-slider');
const loadingOverlayEl = document.getElementById('loading-overlay');

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

    const s = localStorage.getItem(LS_KEYS.sort);
    if (s) currentSort = s;

    const sl = localStorage.getItem(LS_KEYS.slider);
    if (sl) sliderValue = Math.min(100, parseInt(sl));
}

function saveFavorites() {
    localStorage.setItem(LS_KEYS.favorites, JSON.stringify([...favorites]));
}

function saveNotes() {
    localStorage.setItem(LS_KEYS.notes, JSON.stringify(notes));
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
        allcoinsListEl.innerHTML = '<div class="empty-state"><p>Gagal memuat data.</p><p class="empty-hint">Kemungkinan Binance diblokir di jaringan kamu. Coba pakai VPN.</p></div>';
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

    // Sort each group
    const sortFn = getSortFunction();
    favs.sort(sortFn);
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

// ========== RENDERING ==========
function renderList() {
    // Clear both lists
    favListEl.innerHTML = '';
    allcoinsListEl.innerHTML = '';

    if (allSymbols.length === 0) {
        // Still loading
        favSectionEl.classList.add('hidden');
        allcoinsHeaderEl.style.display = 'none';
        allcoinsListEl.innerHTML = `
            <div class="empty-state">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <p>Memuat data dari Binance...</p>
            </div>`;
        return;
    }

    const { favs, rest } = getDisplayList();

    // === Favorites section ===
    if (favs.length > 0) {
        favSectionEl.classList.remove('hidden');
        favHeaderEl.textContent = `\u2605 Favorit (${favs.length})`;
        emptyFavEl.style.display = 'none';

        favs.forEach(symbol => {
            favListEl.appendChild(createCoinCard(symbol, true));
        });
    } else {
        // No favorites
        if (searchQuery) {
            // Hide favorites section during search with no matches
            favSectionEl.classList.add('hidden');
        } else {
            favSectionEl.classList.remove('hidden');
            favHeaderEl.textContent = '\u2605 Favorit';
            emptyFavEl.style.display = 'block';
        }
    }

    // === All coins section ===
    if (rest.length > 0) {
        allcoinsHeaderEl.textContent = searchQuery
            ? `Hasil Pencarian (${rest.length})`
            : `Semua Koin (${rest.length})`;
        allcoinsHeaderEl.style.display = '';

        rest.forEach(symbol => {
            allcoinsListEl.appendChild(createCoinCard(symbol, false));
        });
    } else if (favs.length === 0) {
        // No results at all
        allcoinsHeaderEl.style.display = 'none';
        const noRes = document.createElement('div');
        noRes.className = 'no-results';
        noRes.textContent = searchQuery
            ? `Tidak ada koin "${searchQuery}"`
            : 'Belum ada data.';
        allcoinsListEl.appendChild(noRes);
    } else {
        // Has favorites but no other coins matching search
        allcoinsHeaderEl.style.display = 'none';
    }
}

function createCoinCard(symbol, isFav) {
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
    const formattedPct = (data.pct > 0 ? '+' : '') + data.pct.toFixed(2) + '%';

    // Star icon
    const starIcon = isFav ? '\u2605' : '\u2606';

    card.innerHTML = isFav ? `
        <div class="card-top">
            <button class="btn-star active" data-symbol="${symbol}">${starIcon}</button>
            <div class="coin-info">
                <div class="coin-name">${data.name}</div>
                <div class="coin-price">${formattedPrice}</div>
                <span class="coin-pct ${pctClass}">${formattedPct}</span>
            </div>
            <textarea class="coin-note" rows="1" placeholder="Catatan..." data-symbol="${symbol}">${notes[symbol] || ''}</textarea>
        </div>
    ` : `
        <div class="card-top">
            <button class="btn-star" data-symbol="${symbol}">${starIcon}</button>
            <div class="coin-info">
                <div class="coin-name">${data.name}</div>
                <div class="coin-price">${formattedPrice}</div>
            </div>
            <span class="coin-pct ${pctClass}">${formattedPct}</span>
        </div>
    `;

    // Star click handler
    const starBtn = card.querySelector('.btn-star');
    starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(symbol);
    });

    // Note handler (favorites only)
    if (isFav) {
        const noteEl = card.querySelector('.coin-note');
        noteEl.addEventListener('input', () => {
            notes[symbol] = noteEl.value;
            saveNotes();
            noteEl.style.height = 'auto';
            noteEl.style.height = noteEl.scrollHeight + 'px';
        });
        setTimeout(() => {
            noteEl.style.height = 'auto';
            noteEl.style.height = noteEl.scrollHeight + 'px';
        }, 0);
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
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
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
    refreshBtnEl.addEventListener('click', () => refreshPrices());

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
        renderList();
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
