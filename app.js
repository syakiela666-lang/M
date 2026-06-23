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
let currentSort = 'high';
let currentMode = 'normal'; // 'normal', 'ob', 'os'
let sliderValue = 100;
let searchQuery = '';

// ========== DOM REFS ==========
const favListEl = document.getElementById('favorites-list');
const emptyFavEl = document.getElementById('empty-fav');
const allcoinsListEl = document.getElementById('allcoins-list');
const searchInputEl = document.getElementById('search-input');
const btnObEl = document.getElementById('btn-ob');
const btnOsEl = document.getElementById('btn-os');
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

async function fetchFromBinanceWithPath(path) {
    const baseUrls = [
        'https://fapi.binance.com',
        'https://fapi1.binance.com',
        'https://fapi2.binance.com',
        'https://fapi3.binance.com'
    ];
    for (const base of baseUrls) {
        try {
            const res = await fetchWithFallback(`${base}${path}`);
            return await res.json();
        } catch (e) {
            continue;
        }
    }
    throw new Error('All Binance endpoints unreachable for path: ' + path);
}

async function fetchAllTickers() {
    try {
        const data = await fetchFromBinance();

        const oldTickers = allTickers;
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
            
            // Preserve RSI, cRSI, and obScore if they exist
            if (oldTickers[symbol] && oldTickers[symbol].rsi !== undefined) {
                allTickers[symbol].rsi = oldTickers[symbol].rsi;
                allTickers[symbol].crsi = oldTickers[symbol].crsi;
                allTickers[symbol].obScore = oldTickers[symbol].obScore;
            }
            
            allSymbols.push(symbol);
        });

        allSymbols.sort((a, b) => a.localeCompare(b));
        initializeIndicators();
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
    if (currentMode === 'ob') {
        return (a, b) => {
            const scoreA = allTickers[a] && allTickers[a].obScore !== undefined ? allTickers[a].obScore : -Infinity;
            const scoreB = allTickers[b] && allTickers[b].obScore !== undefined ? allTickers[b].obScore : -Infinity;
            if (scoreA === scoreB) {
                const pctA = allTickers[a] ? allTickers[a].pct : -Infinity;
                const pctB = allTickers[b] ? allTickers[b].pct : -Infinity;
                return pctB - pctA;
            }
            return scoreB - scoreA;
        };
    }
    if (currentMode === 'os') {
        return (a, b) => {
            const scoreA = allTickers[a] && allTickers[a].obScore !== undefined ? allTickers[a].obScore : Infinity;
            const scoreB = allTickers[b] && allTickers[b].obScore !== undefined ? allTickers[b].obScore : Infinity;
            if (scoreA === scoreB) {
                const pctA = allTickers[a] ? allTickers[a].pct : Infinity;
                const pctB = allTickers[b] ? allTickers[b].pct : Infinity;
                return pctA - pctB; // sort by lower percent for oversold
            }
            return scoreA - scoreB;
        };
    }
    if (currentSort === 'high') {
        return (a, b) => {
            const pctA = allTickers[a] ? allTickers[a].pct : -Infinity;
            const pctB = allTickers[b] ? allTickers[b].pct : -Infinity;
            return pctB - pctA;
        };
    }
    if (currentSort === 'low') {
        return (a, b) => {
            const pctA = allTickers[a] ? allTickers[a].pct : Infinity;
            const pctB = allTickers[b] ? allTickers[b].pct : Infinity;
            return pctA - pctB;
        };
    }

    // Default fallback
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

/// ========== RENDERING ==========
const cardCacheFav = {};
const cardCacheAll = {};

function updateCoinCardDOM(card, symbol, isFav, inFavTab) {
    const data = allTickers[symbol];
    if (!data) return;

    if (isFav) {
        card.classList.add('is-favorite');
        const btnStar = card.querySelector('.btn-star');
        if (btnStar) {
            btnStar.textContent = '\u2605';
            btnStar.classList.add('active');
        }
    } else {
        card.classList.remove('is-favorite');
        const btnStar = card.querySelector('.btn-star');
        if (btnStar) {
            btnStar.textContent = '\u2606';
            btnStar.classList.remove('active');
        }
    }

    const formattedPrice = formatPrice(data.price);
    const formattedPct = (data.pct > 0 ? '+' : '') + Math.round(data.pct) + '%';
    
    const priceEl = card.querySelector('.coin-price');
    const pctEl = card.querySelector('.coin-pct');
    if (priceEl && priceEl.textContent !== formattedPrice) priceEl.textContent = formattedPrice;
    if (pctEl && pctEl.textContent !== formattedPct) {
        pctEl.textContent = formattedPct;
        pctEl.className = 'coin-pct ' + (data.pct > 0 ? 'positive' : data.pct < 0 ? 'negative' : 'zero');
    }

    const rsiInfoEl = card.querySelector('.rsi-info');
    if (data.rsi !== undefined && data.crsi !== undefined) {
        const stochStr = data.stochRsi !== undefined ? ` | StochRSI: ${data.stochRsi.toFixed(1)}` : '';
        const rsiText = `RSI: ${data.rsi.toFixed(1)} | cRSI: ${data.crsi.toFixed(1)}${stochStr}`;
        if (rsiInfoEl) {
            if (rsiInfoEl.textContent !== rsiText) rsiInfoEl.textContent = rsiText;
        } else {
            const newRsi = document.createElement('div');
            newRsi.className = 'rsi-info';
            newRsi.style = "font-size:10px; color:#b2b5be; margin-top:2px; font-weight:bold;";
            newRsi.textContent = rsiText;
            const infoEl = card.querySelector('.coin-info');
            if (infoEl) infoEl.appendChild(newRsi);
        }
    } else if (rsiInfoEl) {
        rsiInfoEl.remove();
    }

    if (inFavTab && card._updateMeter) {
        card._updateMeter();
    }
}

function renderList() {
    if (allSymbols.length === 0) {
        emptyFavEl.style.display = 'none';
        allcoinsListEl.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="loading-dots"><span></span><span></span><span></span></div>
                <p>Memuat data dari Binance...</p>
            </div>`;
        return;
    } else {
        const emptyState = allcoinsListEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
    }

    const { favs } = getDisplayList();

    // === Favorites tab ===
    if (favs.length > 0) {
        emptyFavEl.style.display = 'none';
        favs.forEach((symbol, index) => {
            let card = cardCacheFav[symbol];
            if (!card) {
                card = createCoinCard(symbol, true, true);
                cardCacheFav[symbol] = card;
            } else {
                updateCoinCardDOM(card, symbol, true, true);
            }
            if (favListEl.children[index] !== card) {
                favListEl.insertBefore(card, favListEl.children[index] || null);
            }
        });
    } else {
        if (searchQuery) {
            emptyFavEl.style.display = 'none';
        } else {
            emptyFavEl.style.display = 'block';
        }
    }

    Object.keys(cardCacheFav).forEach(sym => {
        if (!favorites.has(sym)) {
            const card = cardCacheFav[sym];
            if (card && card.parentNode) {
                card.parentNode.removeChild(card);
            }
            delete cardCacheFav[sym];
        }
    });

    // === All Coins tab ===
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
        const noRes = allcoinsListEl.querySelector('.no-results');
        if (noRes) noRes.remove();
        
        allCoins.forEach((symbol, index) => {
            const isFav = favorites.has(symbol);
            let card = cardCacheAll[symbol];
            if (!card) {
                card = createCoinCard(symbol, isFav, false);
                cardCacheAll[symbol] = card;
            } else {
                updateCoinCardDOM(card, symbol, isFav, false);
            }
            if (allcoinsListEl.children[index] !== card) {
                allcoinsListEl.insertBefore(card, allcoinsListEl.children[index] || null);
            }
        });
        
        // Remove nodes not in allCoins (filtered out by search)
        Array.from(allcoinsListEl.children).forEach(child => {
            const sym = child.dataset.symbol;
            if (sym && !allCoins.includes(sym)) {
                child.remove();
            }
        });
    } else {
        allcoinsListEl.innerHTML = '';
        const noRes = document.createElement('div');
        noRes.className = 'no-results';
        noRes.style.gridColumn = '1/-1';
        noRes.innerHTML = `<p>Koin "${searchQuery}" tidak ditemukan.</p>`;
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

        let rsiInfo = '';
        if (data.rsi !== undefined && data.crsi !== undefined) {
            const stochStr = data.stochRsi !== undefined ? ` | StochRSI: ${data.stochRsi.toFixed(1)}` : '';
            rsiInfo = `<div class="rsi-info" style="font-size:10px; color:#b2b5be; margin-top:2px; font-weight:bold;">RSI: ${data.rsi.toFixed(1)} | cRSI: ${data.crsi.toFixed(1)}${stochStr}</div>`;
        }

        card.innerHTML = `
            <button class="btn-star active" data-symbol="${symbol}">${starIcon}</button>
            <div class="card-top">
                <div class="coin-info">
                    <div class="coin-name">${data.name}</div>
                    <div class="coin-price">${formattedPrice}</div>
                    <span class="coin-pct ${pctClass}">${formattedPct}</span>
                    ${rsiInfo}
                </div>
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
        let rsiInfo = '';
        if (data.rsi !== undefined && data.crsi !== undefined) {
            const stochStr = data.stochRsi !== undefined ? ` | StochRSI: ${data.stochRsi.toFixed(1)}` : '';
            rsiInfo = `<div class="rsi-info" style="font-size:10px; color:#b2b5be; margin-top:2px; font-weight:bold;">RSI: ${data.rsi.toFixed(1)} | cRSI: ${data.crsi.toFixed(1)}${stochStr}</div>`;
        }

        card.innerHTML = `
            <div class="card-top">
                <button class="btn-star${isFav ? ' active' : ''}" data-symbol="${symbol}">${starIcon}</button>
                <div class="coin-info">
                    <div class="coin-name-row">
                        <div class="coin-name">${data.name}</div>
                        <span class="coin-pct ${pctClass}">${formattedPct}</span>
                    </div>
                    <div class="coin-price">${formattedPrice}</div>
                    ${rsiInfo}
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

    // Target handler (favorites tab only)
    if (isFav && inFavTab) {
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

        setTimeout(() => {
            updateMeter();
        }, 10);

        // Store meter update function for price refresh
        card._updateMeter = updateMeter;
    }

    return card;
}

// ========== FAVORITES ==========
async function toggleFavorite(symbol) {
    if (favorites.has(symbol)) {
        favorites.delete(symbol);
        showToast(`${allTickers[symbol].name} dihapus dari favorit.`);
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify({
                method: "UNSUBSCRIBE",
                params: [`${symbol.toLowerCase()}@kline_1m`],
                id: Date.now()
            }));
        }
    } else {
        favorites.add(symbol);
        showToast(`${allTickers[symbol].name} ditambahkan ke favorit. Loading RSI...`);
        
        await initSingleIndicator(symbol);
        
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            wsConnection.send(JSON.stringify({
                method: "SUBSCRIBE",
                params: [`${symbol.toLowerCase()}@kline_1m`],
                id: Date.now()
            }));
        }
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
            const btnSize = refreshBtnEl.offsetWidth || 50; // fallback to 50 if 0
            const maxX = window.innerWidth - btnSize;
            const maxY = window.innerHeight - btnSize;
            
            let newX = Math.max(0, Math.min(pos.left, maxX));
            let newY = Math.max(0, Math.min(pos.top, maxY));

            refreshBtnEl.style.left = newX + 'px';
            refreshBtnEl.style.top = newY + 'px';
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
        // Reset modes when changing standard sort
        currentMode = 'normal';
        btnObEl.style.background = 'transparent';
        btnObEl.style.color = 'var(--red)';
        btnOsEl.style.background = 'transparent';
        btnOsEl.style.color = 'var(--green)';
        renderList();
    });

    btnObEl.addEventListener('click', () => {
        if (currentMode === 'ob') {
            currentMode = 'normal';
            btnObEl.style.background = 'transparent';
            btnObEl.style.color = 'var(--red)';
        } else {
            currentMode = 'ob';
            btnObEl.style.background = 'var(--red)';
            btnObEl.style.color = '#fff';
            btnOsEl.style.background = 'transparent';
            btnOsEl.style.color = 'var(--green)';
        }
        renderList();
    });

    btnOsEl.addEventListener('click', () => {
        if (currentMode === 'os') {
            currentMode = 'normal';
            btnOsEl.style.background = 'transparent';
            btnOsEl.style.color = 'var(--green)';
        } else {
            currentMode = 'os';
            btnOsEl.style.background = 'var(--green)';
            btnOsEl.style.color = '#fff';
            btnObEl.style.background = 'transparent';
            btnObEl.style.color = 'var(--red)';
        }
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

// ========== SCANNER OVERBOUGHT ==========
let isInitializing = false;
let wsConnection = null;
let renderInterval = null;

async function initSingleIndicator(symbol) {
    try {
        const KLINE_LIMIT = 50; 
        const data = await fetchFromBinanceWithPath(`/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${KLINE_LIMIT}`);
        
        const crsiCalc = new StatefulCyclicRSI(20);
        let lastCrsi = null;
        let lastRsi = null;
        const rsiWindow = [];
        let stochRsi = null;
        let lastKlineTime = null;
        
        for (let j = 0; j < data.length; j++) {
            const k = data[j];
            const kTime = k[0];
            const close = parseFloat(k[4]);
            const isLastCandle = (j === data.length - 1);
            crsiCalc.update(close, false);
            lastRsi = crsiCalc._tempRsi;
            lastCrsi = crsiCalc.crsi;
            lastKlineTime = kTime;
            
            if (lastRsi !== undefined && lastRsi !== null) {
                if (!isLastCandle) {
                    rsiWindow.push(lastRsi);
                    if (rsiWindow.length > 14) {
                        rsiWindow.shift();
                    }
                }
            }
        }
        
        const activeWindow = [...rsiWindow, lastRsi];
        if (activeWindow.length > 14) activeWindow.shift();
        
        if (activeWindow.length === 14) {
            const minRsi = Math.min(...activeWindow);
            const maxRsi = Math.max(...activeWindow);
            if (maxRsi === minRsi) {
                stochRsi = 0;
            } else {
                stochRsi = ((lastRsi - minRsi) / (maxRsi - minRsi)) * 100;
            }
        }
        
        if (allTickers[symbol]) {
            const rsi = lastRsi || 0;
            const crsi = lastCrsi || 0;
            allTickers[symbol].crsiCalc = crsiCalc;
            allTickers[symbol].rsiWindow = rsiWindow;
            allTickers[symbol].lastKlineTime = lastKlineTime;
            allTickers[symbol].obScore = rsi + crsi;
            allTickers[symbol].rsi = rsi;
            allTickers[symbol].crsi = crsi;
            allTickers[symbol].stochRsi = stochRsi !== null ? stochRsi : 0;
        }
    } catch (e) {
        console.warn("Failed to init klines for", symbol);
    }
}

async function initializeIndicators() {
    if (isInitializing) return;
    isInitializing = true;

    const symbols = Array.from(favorites);
    if (symbols.length > 0) {
        showToast("Menginisialisasi RSI Favorit...");
    }

    const chunkSize = 20;
    
    for (let i = 0; i < symbols.length; i += chunkSize) {
        const progress = Math.round((i / symbols.length) * 100);
        showToast(`Menginisialisasi RSI Favorit (${progress}%)...`);
        
        const chunk = symbols.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(symbol => initSingleIndicator(symbol)));
        
        await new Promise(r => setTimeout(r, 200));
    }
    
    if (symbols.length > 0) {
        showToast("Inisialisasi selesai! Connecting WebSocket...");
    } else {
        showToast("Connecting WebSocket...");
    }
    setupWebSocket();
    
    if (!renderInterval) {
        renderInterval = setInterval(() => {
            renderList();
        }, 1500);
    }
}

function setupWebSocket() {
    if (wsConnection) {
        wsConnection.close();
    }
    
    // Connect to Raw Stream instead of Combined Stream to bypass proxy/ISP issues
    wsConnection = new WebSocket(`wss://fstream.binance.com/ws/!ticker@arr`);
    
    wsConnection.onopen = async () => {
        console.log("✅ WebSocket BERHASIL terbuka!");
        showToast("Live Data Terhubung!");
        
        // Subscribe to klines in chunks to avoid payload limits
        const klineStreams = Array.from(favorites).map(sym => `${sym.toLowerCase()}@kline_1m`);
        const chunkSize = 50;
        let idCounter = 1;
        
        for (let i = 0; i < klineStreams.length; i += chunkSize) {
            const chunk = klineStreams.slice(i, i + chunkSize);
            wsConnection.send(JSON.stringify({
                method: "SUBSCRIBE",
                params: chunk,
                id: idCounter++
            }));
            await new Promise(r => setTimeout(r, 300));
        }
    };
    
    wsConnection.onerror = (error) => {
        console.error("🚨 WebSocket Error: Koneksi gagal, nyangkut, atau diblokir ISP!", error);
    };
    
    wsConnection.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);

            // 1. Abaikan pesan konfirmasi dari Binance agar tidak error
            if (msg.id !== undefined && msg.result === null) return;

            // 2. Deteksi Format Pintar (Mendukung Raw & Combined)
            let streamName = "";
            let streamData = null;

            if (msg.stream && msg.data) {
                // Format Combined Stream (/stream?streams=)
                streamName = msg.stream;
                streamData = msg.data;
            } else if (Array.isArray(msg)) {
                // Format Raw Stream Ticker (/ws/!ticker@arr)
                streamName = "!ticker@arr";
                streamData = msg;
            } else if (msg.e === "kline") {
                // Format Raw Stream Kline
                streamName = `${msg.s.toLowerCase()}@kline_1m`;
                streamData = msg;
            } else {
                return; // Abaikan pesan aneh lainnya
            }
            
            // 3. Proses Data Utama
            if (streamName === '!ticker@arr') {
                streamData.forEach(t => {
                    const sym = t.s;
                    if (allTickers[sym]) {
                        allTickers[sym].price = parseFloat(t.c);
                        allTickers[sym].pct = parseFloat(t.P);
                    }
                });
            } else if (streamName.endsWith('@kline_1m')) {
                const sym = streamData.s;
                const k = streamData.k;
                const close = parseFloat(k.c);
                const kTime = k.t;
                
                if (allTickers[sym] && allTickers[sym].crsiCalc) {
                    const isNewCandle = allTickers[sym].lastKlineTime !== kTime;
                    
                    if (isNewCandle) {
                        if (allTickers[sym].rsi !== undefined && allTickers[sym].rsi !== null) {
                            allTickers[sym].rsiWindow.push(allTickers[sym].rsi);
                            if (allTickers[sym].rsiWindow.length > 14) {
                                allTickers[sym].rsiWindow.shift();
                            }
                        }
                        allTickers[sym].crsiCalc.update(close, false);
                        allTickers[sym].lastKlineTime = kTime;
                    } else {
                        allTickers[sym].crsiCalc.update(close, true);
                    }
                    
                    const rsi = allTickers[sym].crsiCalc._tempRsi || 0;
                    const crsi = allTickers[sym].crsiCalc.crsi || 0;
                    
                    let stochRsi = 0;
                    const activeWindow = [...allTickers[sym].rsiWindow, rsi];
                    if (activeWindow.length > 14) activeWindow.shift();
                    
                    if (activeWindow.length === 14) {
                        const minRsi = Math.min(...activeWindow);
                        const maxRsi = Math.max(...activeWindow);
                        if (maxRsi === minRsi) stochRsi = 0;
                        else stochRsi = ((rsi - minRsi) / (maxRsi - minRsi)) * 100;
                    }
                    
                    allTickers[sym].rsi = rsi;
                    allTickers[sym].crsi = crsi;
                    allTickers[sym].stochRsi = stochRsi;
                    allTickers[sym].obScore = rsi + crsi;
                }
            }
        } catch (err) {
            console.error("🚨 Parsing Error di onmessage:", err);
        }
    };
    
    wsConnection.onclose = () => {
        setTimeout(setupWebSocket, 3000);
    };
}

// ========== CYCLIC RSI CLASS ==========
class StatefulCyclicRSI {
    constructor(domcycle = 20) {
        this.domcycle = domcycle;
        this.cyclelen = domcycle / 2.0;
        this.smaLength = Math.round(this.cyclelen);
        this.vibration = 10;
        this.leveling = 10.0;
        this.phasingLag = Math.round((this.vibration - 1) / 2.0); 
        this.torque = 2.0 / (this.vibration + 1);
        this.cyclicmemory = this.domcycle * 2;
        this.priceHistory = [];
        this.c_rsiHistory = [];
        this.c_crsiHistory = [];
        this.priceCount = 0;
        this.c_avgGain = 0;
        this.c_avgLoss = 0;
        this.c_prevCrsi = null;
        this.crsi = null;
        this._tempCrsi = null;
        this.currentValue = { crsi: null, upperBand: null, lowerBand: null };
    }
    _calcRSI(gain, loss) {
        if (loss === 0) return 100;
        if (gain === 0) return 0;
        return 100 - (100 / (1 + gain / loss));
    }
    _computeBands(crsiHist) {
        const vals = crsiHist.filter(v => v !== null && !isNaN(v));
        if (vals.length === 0) return { upperBand: null, lowerBand: null };
        let lmax = -999999.0;
        let lmin = 999999.0;
        for (let i = vals.length - 1; i >= 0; i--) {
            if (vals[i] > lmax) lmax = vals[i];
            if (vals[i] < lmin) lmin = vals[i];
        }
        if (lmax === -999999.0 || lmin === 999999.0) return { upperBand: null, lowerBand: null };
        const aperc = this.leveling / 100.0;
        const sorted = [...vals].sort((a, b) => a - b);
        let targetBelowCount = Math.ceil(aperc * this.cyclicmemory);
        if (targetBelowCount >= sorted.length) targetBelowCount = sorted.length - 1;
        if (targetBelowCount < 0) targetBelowCount = 0;
        let db = sorted[targetBelowCount];
        let targetAboveCount = Math.ceil(aperc * this.cyclicmemory);
        let targetUpperIndex = sorted.length - targetAboveCount;
        if (targetUpperIndex < 0) targetUpperIndex = 0;
        if (targetUpperIndex >= sorted.length) targetUpperIndex = sorted.length - 1;
        let ub = sorted[targetUpperIndex];
        return { upperBand: ub, lowerBand: db };
    }
    update(price, replaceLast = false) {
        if (!replaceLast) {
            if (this.priceHistory.length > 0) {
                if (this.priceCount === this.smaLength + 1 || this.priceCount > this.smaLength + 1) {
                    this.c_avgGain = this._tempAvgGain;
                    this.c_avgLoss = this._tempAvgLoss;
                }
                if (this._tempRsi !== undefined && this._tempRsi !== null) {
                    this.c_rsiHistory.push(this._tempRsi);
                    if (this.c_rsiHistory.length > this.phasingLag + 2) this.c_rsiHistory.shift();
                }
                if (this._tempCrsi !== undefined && this._tempCrsi !== null) {
                    this.c_prevCrsi = this._tempPrevCrsiForNextBar;
                    this.c_crsiHistory.push(this._tempCrsi);
                    if (this.c_crsiHistory.length > this.cyclicmemory) this.c_crsiHistory.shift();
                }
            }
            this.priceHistory.push(price);
            this.priceCount++;
        } else {
            if (this.priceHistory.length > 0) {
                this.priceHistory[this.priceHistory.length - 1] = price;
            }
        }
        if (this.priceCount <= this.smaLength + 1) {
            let sumGain = 0;
            let sumLoss = 0;
            const startIdx = Math.max(1, this.priceHistory.length - this.priceCount + 1);
            for (let i = startIdx; i < this.priceHistory.length; i++) {
                const diff = this.priceHistory[i] - this.priceHistory[i - 1];
                if (diff > 0) sumGain += diff;
                else sumLoss -= diff;
            }
            if (this.priceCount === this.smaLength + 1) {
                this._tempAvgGain = sumGain / this.smaLength;
                this._tempAvgLoss = sumLoss / this.smaLength;
                this._tempRsi = this._calcRSI(this._tempAvgGain, this._tempAvgLoss);
            } else {
                return null;
            }
        } else {
            const diff = price - this.priceHistory[this.priceHistory.length - 2];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            this._tempAvgGain = (gain + (this.cyclelen - 1) * this.c_avgGain) / this.cyclelen;
            this._tempAvgLoss = (loss + (this.cyclelen - 1) * this.c_avgLoss) / this.cyclelen;
            this._tempRsi = this._calcRSI(this._tempAvgGain, this._tempAvgLoss);
        }
        const activeRsiHist = [...this.c_rsiHistory, this._tempRsi];
        let crsiVal = null;
        if (activeRsiHist.length > this.phasingLag) {
            const laggedRsi = activeRsiHist[activeRsiHist.length - 1 - this.phasingLag];
            const rsiVal = this._tempRsi;
            const prevCrsiForCalc = this.c_prevCrsi !== null ? this.c_prevCrsi : rsiVal;
            crsiVal = this.torque * (2 * rsiVal - laggedRsi) + (1 - this.torque) * prevCrsiForCalc;
            crsiVal = Math.max(0, Math.min(100, crsiVal)); 
            this._tempCrsi = crsiVal;
            this._tempPrevCrsiForNextBar = crsiVal;
            const activeCrsiHist = [...this.c_crsiHistory, crsiVal];
            if (activeCrsiHist.length > this.cyclicmemory) activeCrsiHist.shift(); 
            const { upperBand, lowerBand } = this._computeBands(activeCrsiHist);
            this.crsi = crsiVal;
            this.currentValue = { crsi: crsiVal, upperBand, lowerBand };
            return this.currentValue;
        }
        return null;
    }
}

// ========== START ==========
document.addEventListener('DOMContentLoaded', init);
