document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand(); // Plein écran direct

    // --- VARIABLES D'ÉTAT ---
    let state = {
        prices: {},
        cryptos: [],
        mode: 'buy', // 'buy' ou 'sell'
        user: tg.initDataUnsafe?.user || { first_name: 'Visiteur', id: 0 },
        settings: {}
    };

    // --- DOM ELEMENTS ---
    const els = {
        amountInput: document.getElementById('amount-to-send'),
        cryptoSelect: document.getElementById('crypto-select'),
        resultDisplay: document.getElementById('amount-to-receive'),
        submitBtn: document.getElementById('submit-btn'),
        buyTab: document.getElementById('buy-tab'),
        sellTab: document.getElementById('sell-tab'),
        walletGroup: document.getElementById('wallet-group'),
        mmGroup: document.getElementById('mm-group'),
        phoneGroupBuy: document.getElementById('phone-group-buy'),
        amountLabel: document.getElementById('amount-label'),
        currencyLabel: document.getElementById('currency-label'),
        splash: document.getElementById('splash-screen'),
        main: document.getElementById('main-content')
    };

    // --- 1. INITIALISATION ---
    async function init() {
        try {
            // Check-in Utilisateur
            await fetch('/api/miniapp/user-check-in', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user: state.user, referredByCode: tg.initDataUnsafe?.start_param })
            });

            // Charger Config & Prix
            const [configRes, settingsRes] = await Promise.all([
                fetch('/api/config'),
                fetch('/api/settings')
            ]);
            
            const configData = await configRes.json();
            state.settings = await settingsRes.json();
            state.prices = configData.atexPrices;
            state.cryptos = configData.availableCryptos || [];

            if (state.settings.maintenance_mode) {
                document.body.innerHTML = '<h1 style="color:white;text-align:center;margin-top:50%;">Maintenance en cours...</h1>';
                return;
            }

            setupUI();
            setupEarnSection();
            setupProfile();
            
            // Cacher Splash
            setTimeout(() => {
                els.splash.style.display = 'none';
                els.main.classList.remove('hidden');
            }, 500);

        } catch (e) {
            console.error("Init Error:", e);
            els.splash.innerHTML = `<p style="color:red">Erreur de connexion. Relancez.</p>`;
        }
    }

    // --- 2. SETUP UI (Remplir les listes, écouteurs) ---
    function setupUI() {
        // Remplir Select Crypto
        els.cryptoSelect.innerHTML = state.cryptos.map(c => 
            `<option value="${c.id}">${c.name}</option>`
        ).join('');

        // Listeners Calculatrice
        els.amountInput.addEventListener('input', calculate);
        els.cryptoSelect.addEventListener('change', () => { updateLabels(); calculate(); });
        
        els.buyTab.addEventListener('click', () => setMode('buy'));
        els.sellTab.addEventListener('click', () => setMode('sell'));

        els.submitBtn.addEventListener('click', handleSubmit);

        // Navigation Tabs
        document.querySelectorAll('nav button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(btn.dataset.page).classList.add('active');
            });
        });

        // Init Labels
        setMode('buy'); 
    }

    // --- 3. LOGIQUE MODE (ACHAT / VENTE) ---
    function setMode(mode) {
        state.mode = mode;
        
        // Classes actives
        if(mode === 'buy') {
            els.buyTab.classList.add('active');
            els.sellTab.classList.remove('active');
            els.walletGroup.classList.remove('hidden'); // On demande wallet pour recevoir crypto
            els.mmGroup.classList.add('hidden'); // On cache MM reception (c'est nous qui recevons l'argent)
            els.phoneGroupBuy.classList.remove('hidden'); // On demande numero payeur
            els.submitBtn.textContent = "Acheter maintenant";
            els.submitBtn.style.background = "#30D158"; // Vert
        } else {
            els.sellTab.classList.add('active');
            els.buyTab.classList.remove('active');
            els.walletGroup.classList.add('hidden'); // Pas besoin de wallet
            els.mmGroup.classList.remove('hidden'); // On demande ou envoyer l'argent (MM)
            els.phoneGroupBuy.classList.add('hidden');
            els.submitBtn.textContent = "Vendre maintenant";
            els.submitBtn.style.background = "#FF453A"; // Rouge
        }
        updateLabels();
        calculate();
    }

    function updateLabels() {
        const cryptoId = els.cryptoSelect.value;
        const crypto = state.cryptos.find(c => c.id === cryptoId);
        const symbol = crypto ? crypto.symbol : '---';

        if(state.mode === 'buy') {
            els.amountLabel.textContent = "Je paie (FCFA)";
            els.currencyLabel.textContent = "FCFA";
            els.resultDisplay.innerHTML = `0.00 <span style="font-size:16px; color:#8E8E93;">${symbol}</span>`;
        } else {
            els.amountLabel.textContent = `Je vends (${symbol})`;
            els.currencyLabel.textContent = symbol;
            els.resultDisplay.innerHTML = `0 <span style="font-size:16px; color:#8E8E93;">FCFA</span>`;
        }
    }

    // --- 4. CALCULATRICE CORE ---
    function calculate() {
        const amount = parseFloat(els.amountInput.value);
        const cryptoId = els.cryptoSelect.value;
        
        // Sécurité anti-crash
        if (!amount || isNaN(amount) || !state.prices[cryptoId]) {
            const symbol = state.mode === 'buy' ? getSymbol(cryptoId) : 'FCFA';
            els.resultDisplay.innerHTML = `0.00 <span style="font-size:16px; color:#8E8E93;">${symbol}</span>`;
            return;
        }

        const rate = state.prices[cryptoId][state.mode]; // Taux Buy ou Sell
        let result = 0;

        if (state.mode === 'buy') {
            // (FCFA / Taux) = Crypto
            result = amount / rate;
            const symbol = getSymbol(cryptoId);
            const decimals = (symbol === 'BTC' || symbol === 'ETH') ? 6 : 2;
            els.resultDisplay.innerHTML = `${result.toFixed(decimals)} <span style="font-size:16px; color:#8E8E93;">${symbol}</span>`;
        } else {
            // (Crypto * Taux) = FCFA
            result = amount * rate;
            els.resultDisplay.innerHTML = `${Math.floor(result).toLocaleString()} <span style="font-size:16px; color:#8E8E93;">FCFA</span>`;
        }
    }

    function getSymbol(id) {
        const c = state.cryptos.find(x => x.id === id);
        return c ? c.symbol : id.toUpperCase();
    }

    // --- 5. LOGIQUE GAGNER (LEVELS) ---
    async function setupEarnSection() {
        try {
            const res = await fetch(`/api/miniapp/referral-info/${state.user.id}`);
            const data = await res.json();
            
            // Calcul du Niveau
            const count = data.activeReferrals ? data.activeReferrals.length : 0;
            const levels = state.settings.levels || { l1: {threshold:5}, l2: {threshold:20}, l3: {threshold:50} };
            
            let emoji = "🥉";
            let name = "Débutant";
            let nextTarget = levels.l1.threshold;
            let progress = (count / nextTarget) * 100;

            if (count >= levels.l3.threshold) {
                emoji = "🥇"; name = "Expert (Gold)"; progress = 100; nextTarget = "Max";
            } else if (count >= levels.l2.threshold) {
                emoji = "🥈"; name = "Avancé (Silver)"; nextTarget = levels.l3.threshold; progress = ((count - levels.l2.threshold) / (levels.l3.threshold - levels.l2.threshold)) * 100;
            } else if (count >= levels.l1.threshold) {
                emoji = "🥉"; name = "Actif (Bronze)"; nextTarget = levels.l2.threshold; progress = ((count - levels.l1.threshold) / (levels.l2.threshold - levels.l1.threshold)) * 100;
            }

            // Mise à jour DOM
            document.getElementById('current-level-emoji').textContent = emoji;
            document.getElementById('current-level-name').textContent = name;
            document.getElementById('level-progress-bar').style.width = `${Math.min(progress, 100)}%`;
            document.getElementById('next-level-info').textContent = nextTarget === "Max" ? "Niveau Max atteint !" : `${count} / ${nextTarget} pour le niveau suivant`;
            
            document.getElementById('total-earnings').textContent = `${(data.referralEarnings || 0).toFixed(2)} USDT`;
            document.getElementById('referral-count').textContent = count;

            // Lien
            const link = `https://t.me/AtexOfficielBot/atexly?startapp=${data.referralCode}_${state.settings.referral_campaign_id||'v1'}`;
            document.getElementById('referral-link').textContent = link;
            document.getElementById('copy-link-btn').onclick = () => {
                navigator.clipboard.writeText(link);
                tg.showAlert("Lien copié !");
            };

            // Bouton Retrait
            document.getElementById('withdraw-btn').onclick = () => {
                const amount = data.referralEarnings || 0;
                if(amount < (state.settings.min_withdrawal || 5)) return tg.showAlert(`Minimum de retrait : ${state.settings.min_withdrawal || 5} USDT`);
                
                // Ici on pourrait ouvrir une modale, pour simplifier on demande l'adresse
                tg.showPopup({
                    title: 'Retrait USDT',
                    message: `Vous allez retirer ${amount.toFixed(2)} USDT. Entrez votre adresse TRC20:`,
                    buttons: [{type: 'ok', id: 'ok'}, {type: 'cancel'}]
                }, (btnId) => {
                    if(btnId === 'ok') {
                        // Pour faire simple dans cette version, on dit à l'utilisateur de contacter le support ou on implémente un prompt JS standard
                        // Note: Telegram WebApp ne supporte pas prompt(). Il faut une modale HTML.
                        // Pour l'instant, on redirige vers le support pour valider manuellement si besoin ou on utilise la modale HTML existante (à adapter).
                        alert("Fonctionnalité en cours de raccordement final."); 
                    }
                });
            };

        } catch (e) { console.error("Earn Error", e); }
    }

    // --- 6. PROFIL & HISTORIQUE ---
    async function setupProfile() {
        document.getElementById('user-name').textContent = state.user.first_name;
        document.getElementById('user-id').textContent = `ID: ${state.user.id}`;
        document.getElementById('user-avatar').textContent = state.user.first_name.charAt(0);

        const list = document.getElementById('history-list');
        try {
            const res = await fetch(`/api/miniapp/my-transactions/${state.user.id}`);
            const txs = await res.json();
            
            if(txs.length === 0) { list.innerHTML = '<p style="text-align:center; padding:20px; color:#555;">Aucune transaction.</p>'; return; }

            list.innerHTML = txs.map(tx => `
                <div class="tx-row">
                    <div class="tx-icon">
                        <i class="fas ${tx.type === 'buy' ? 'fa-arrow-down' : 'fa-arrow-up'}" style="color:${tx.type === 'buy' ? '#30D158' : '#FF453A'}"></i>
                    </div>
                    <div class="tx-details">
                        <span class="tx-title">${tx.type === 'buy' ? 'Achat' : 'Vente'} ${tx.currencyTo || tx.currencyFrom}</span>
                        <span class="tx-date">${new Date(tx.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div class="tx-amount">
                        ${tx.amountToSend} ${tx.currencyFrom === 'FCFA' ? 'FCFA' : ''}
                        <span class="tx-status st-${tx.status}">${tx.status === 'completed' ? 'Succès' : 'Attente'}</span>
                    </div>
                </div>
            `).join('');
        } catch(e) { list.innerHTML = '<p style="color:red; text-align:center;">Erreur historique</p>'; }
    }

    // --- 7. SOUMISSION ---
    async function handleSubmit() {
        const amount = parseFloat(els.amountInput.value);
        if(!amount || amount <= 0) return tg.showAlert("Montant invalide");

        const payload = {
            type: state.mode,
            amountToSend: amount,
            cryptoId: els.cryptoSelect.value,
            // Mapping des champs selon le mode
            walletAddress: state.mode === 'buy' ? document.getElementById('wallet-address').value : 'N/A',
            paymentMethod: state.mode === 'sell' ? document.getElementById('mm-provider').value : 'N/A',
            phoneNumber: state.mode === 'buy' ? document.getElementById('phone-number-buy').value : document.getElementById('phone-number').value,
            // Calcul côté serveur recommandé, mais on envoie l'estimatif
            amountToReceive: parseFloat(els.resultDisplay.innerText), 
            currencyFrom: state.mode === 'buy' ? 'FCFA' : getSymbol(els.cryptoSelect.value),
            currencyTo: state.mode === 'buy' ? getSymbol(els.cryptoSelect.value) : 'FCFA',
            telegramId: state.user.id,
            telegramUsername: state.user.username
        };

        // Validation basique
        if(state.mode === 'buy' && !payload.walletAddress) return tg.showAlert("Adresse wallet manquante");
        if(!payload.phoneNumber) return tg.showAlert("Numéro de téléphone manquant");

        els.submitBtn.disabled = true;
        els.submitBtn.innerText = "Traitement...";

        try {
            const res = await fetch('/api/miniapp/initiate-transaction', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const d = await res.json();
            if(res.ok) {
                tg.showAlert(d.message, () => tg.close());
            } else {
                tg.showAlert("Erreur: " + d.message);
            }
        } catch(e) {
            tg.showAlert("Erreur réseau");
        } finally {
            els.submitBtn.disabled = false;
            els.submitBtn.innerText = state.mode === 'buy' ? "Acheter maintenant" : "Vendre maintenant";
        }
    }

    // Lancement
    init();
});