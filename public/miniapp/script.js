document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();

    // --- VARIABLES GLOBALES ---
    let atexPrices = {};
    let availableCryptosList = []; // Nouvelle variable pour stocker les infos (symboles, réseaux...)
    let currentMode = 'buy';

    // --- ÉLÉMENTS DU DOM ---
    const amountToSendInput = document.getElementById('amount-to-send');
    const cryptoSelect = document.getElementById('crypto-select');
    const amountToReceiveDisplay = document.getElementById('amount-to-receive');
    const submitBtn = document.getElementById('submit-btn');
    const buyTab = document.getElementById('buy-tab');
    const sellTab = document.getElementById('sell-tab');
    
    // Sélecteurs améliorés pour éviter les erreurs si le label change
    const amountLabel = document.querySelector('label[for="amount-to-send"]');
    const amountCurrencySpan = document.querySelector('.calculator .form-group span'); // Le "FCFA" à côté de l'input
    
    const walletAddressGroup = document.getElementById('wallet-address-group');
    const walletAddressInput = document.getElementById('wallet-address');
    const mmProviderSelect = document.getElementById('mm-provider');
    const phoneNumberInput = document.getElementById('phone-number');
    const userGreetingDiv = document.getElementById('user-greeting');
    const historyContainer = document.getElementById('transaction-history-container');
    const referralLinkSpan = document.getElementById('referral-link');
    const copyReferralLinkBtn = document.getElementById('copy-referral-link');
    const totalEarningsP = document.getElementById('total-earnings');
    const referralCountP = document.getElementById('referral-count');

    // --- NOUVELLE FONCTION DE CHECK-IN ---
    async function performUserCheckIn() {
        try {
            const user = tg.initDataUnsafe?.user;
            const referredByCode = tg.initDataUnsafe?.start_param || null;

            if (user) {
                console.log('Check-in utilisateur...');
                await fetch('/api/miniapp/user-check-in', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user, referredByCode })
                });
            }
        } catch (error) {
            console.error("Erreur check-in:", error);
        }
    }

    // --- HELPER : Récupérer le symbole d'une crypto (ex: USDT) depuis son ID (ex: usdt_trc20) ---
    function getCryptoSymbol(id) {
        const crypto = availableCryptosList.find(c => c.id === id);
        return crypto ? crypto.symbol : id.toUpperCase();
    }

    // --- LOGIQUE DU CALCULATEUR ---
    function calculate() {
        const amount = parseFloat(amountToSendInput.value) || 0;
        const selectedId = cryptoSelect.value;
        
        // Si pas de prix ou pas de crypto sélectionnée
        if (amount === 0 || !atexPrices[selectedId]) {
            const initialCurrency = currentMode === 'buy' ? getCryptoSymbol(selectedId) : 'FCFA';
            amountToReceiveDisplay.textContent = `0.00 ${initialCurrency}`;
            return;
        }

        const rate = atexPrices[selectedId][currentMode]; // Rate Achat ou Vente
        let result, resultCurrency;

        if (currentMode === 'buy') {
            // Achat : FCFA divisé par taux
            result = amount / rate;
            resultCurrency = getCryptoSymbol(selectedId);
        } else {
            // Vente : Crypto multiplié par taux
            result = amount * rate;
            resultCurrency = 'FCFA';
        }

        // Affichage (6 décimales pour BTC/ETH, 2 pour les autres)
        const symbol = getCryptoSymbol(selectedId).toLowerCase();
        const decimals = (symbol === 'btc' || symbol === 'eth') ? 6 : 2;
        amountToReceiveDisplay.textContent = `${result.toFixed(decimals)} ${resultCurrency}`;
    }

    // --- RÉCUPÉRATION DE LA CONFIG (PRIX + LISTE CRYPTOS) ---
    async function fetchPrices() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Erreur réseau');
            const data = await response.json();
            
            atexPrices = data.atexPrices;
            availableCryptosList = data.availableCryptos || [];

            // --- CONSTRUCTION DU MENU DÉROULANT ---
            // On sauvegarde la sélection actuelle pour ne pas la perdre si possible
            const currentSelection = cryptoSelect.value;
            cryptoSelect.innerHTML = ''; // On vide "Chargement..."

            if (availableCryptosList.length === 0) {
                const opt = document.createElement('option');
                opt.text = "Aucune crypto disponible";
                cryptoSelect.add(opt);
            } else {
                availableCryptosList.forEach(crypto => {
                    const option = document.createElement('option');
                    option.value = crypto.id; // L'ID sert de valeur (ex: usdt_trc20)
                    option.text = crypto.name; // Le nom s'affiche (ex: USDT TRC20)
                    cryptoSelect.add(option);
                });

                // Restaurer la sélection ou mettre la première par défaut
                if (currentSelection && availableCryptosList.some(c => c.id === currentSelection)) {
                    cryptoSelect.value = currentSelection;
                } else {
                    cryptoSelect.value = availableCryptosList[0].id;
                }
            }

            // Recalculer après la mise à jour
            calculate();
            updateInterfaceLabels(); 

        } catch (error) {
            console.error("Erreur config:", error);
            cryptoSelect.innerHTML = '<option>Erreur de chargement</option>';
        }
    }

    function updateInterfaceLabels() {
        const selectedId = cryptoSelect.value;
        const symbol = getCryptoSymbol(selectedId);
        const selectedOptionText = cryptoSelect.options[cryptoSelect.selectedIndex]?.text || symbol;

        if (currentMode === 'buy') {
            amountLabel.textContent = 'Montant (FCFA)';
            amountCurrencySpan.textContent = 'FCFA';
            submitBtn.textContent = 'Acheter';
            submitBtn.style.backgroundColor = '#28a745';
        } else {
            amountLabel.textContent = `Montant (${selectedOptionText})`;
            amountCurrencySpan.textContent = symbol;
            submitBtn.textContent = 'Vendre';
            submitBtn.style.backgroundColor = '#dc3545';
        }
    }

    function switchMode(newMode) {
        currentMode = newMode;
        buyTab.classList.toggle('active', newMode === 'buy');
        sellTab.classList.toggle('active', newMode === 'sell');
        walletAddressGroup.classList.toggle('hidden', newMode !== 'buy');
        
        updateInterfaceLabels();
        calculate();
    }

    // --- ÉCOUTEURS D'ÉVÉNEMENTS ---
    amountToSendInput.addEventListener('input', calculate);
    
    cryptoSelect.addEventListener('change', () => {
        updateInterfaceLabels();
        calculate();
    });

    buyTab.addEventListener('click', () => switchMode('buy'));
    sellTab.addEventListener('click', () => switchMode('sell'));

    submitBtn.addEventListener('click', async () => {
        const user = tg.initDataUnsafe?.user;
        const amountToSend = parseFloat(amountToSendInput.value);
        const selectedId = cryptoSelect.value;
        const selectedSymbol = getCryptoSymbol(selectedId);
        
        const resultText = amountToReceiveDisplay.textContent.split(' ')[0];
        const amountToReceive = parseFloat(resultText);
        
        const walletAddress = walletAddressInput.value;
        const paymentMethod = mmProviderSelect.value;
        const phoneNumber = phoneNumberInput.value;

        // Validations
        if (!amountToSend || amountToSend <= 0) return tg.showAlert("Veuillez entrer un montant valide.");
        
        if (currentMode === 'buy' && !walletAddress) return tg.showAlert("Veuillez entrer votre adresse de portefeuille.");
        
        if (!phoneNumber) return tg.showAlert("Veuillez entrer votre numéro de téléphone.");
        if (!phoneNumber.startsWith('+')) return tg.showAlert("Format invalide. Incluez l'indicatif (ex: +221...).");

        // Construction des données pour le serveur
        const transactionData = {
            type: currentMode,
            // Si achat : on envoie FCFA. Si vente : on envoie la Crypto (ex: USDT)
            currencyFrom: currentMode === 'buy' ? 'FCFA' : selectedSymbol, 
            amountToSend: amountToSend,
            // Si achat : on reçoit Crypto. Si vente : on reçoit FCFA
            currencyTo: currentMode === 'buy' ? selectedSymbol : 'FCFA',
            amountToReceive: amountToReceive,
            paymentMethod: paymentMethod,
            walletAddress: walletAddress || 'non-requis',
            phoneNumber: phoneNumber,
            telegramUsername: user?.username || 'non-défini',
            telegramId: user?.id || null,
            
            // --- AJOUT IMPORTANT : ON ENVOIE L'ID TECHNIQUE DE LA CRYPTO ---
            // Cela aidera le serveur à retrouver le wallet admin exact pour la vente
            cryptoId: selectedId 
        };

        try {
            tg.MainButton.showProgress();
            const response = await fetch('/api/miniapp/initiate-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(transactionData)
            });
            const data = await response.json();
            
            if (!response.ok) throw new Error(data.message || 'Erreur inconnue.');

            // Si c'est une vente, on affiche simplement le message de succès (plus de redirection)
            tg.showAlert(data.message, () => { tg.close(); });

        } catch (error) {
            tg.showAlert(`Erreur : ${error.message}`);
        } finally {
            tg.MainButton.hideProgress();
        }
    });

    // --- COPIE LIEN PARRAINAGE ---
    copyReferralLinkBtn.addEventListener('click', () => {
        const link = referralLinkSpan.textContent;
        if(link && link !== 'Erreur...') {
            navigator.clipboard.writeText(link)
                .then(() => {
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert("Lien copié !");
                })
                .catch(() => tg.showAlert("Erreur copie."));
        }
    });

    // --- FONCTIONS HISTORIQUE & PARRAINAGE (Inchangées, juste intégrées) ---
    function formatStatus(status) {
        switch (status) {
            case 'completed': return 'Complétée';
            case 'pending': return 'En attente';
            case 'cancelled': return 'Annulée';
            default: return status;
        }
    }
    function formatDate(isoString) {
        return new Date(isoString).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    }

    async function displayTransactionHistory() {
        const user = tg.initDataUnsafe?.user;
        if (!user) return;
        historyContainer.innerHTML = '<p>Chargement...</p>';
        try {
            const res = await fetch(`/api/miniapp/my-transactions/${user.id}`);
            const txs = await res.json();
            if (txs.length === 0) { historyContainer.innerHTML = '<p>Aucune transaction.</p>'; return; }
            historyContainer.innerHTML = txs.map(tx => `
                <div class="transaction-item">
                    <div class="transaction-header">
                        <span class="transaction-type">${tx.type === 'buy' ? 'Achat' : 'Vente'} ${tx.currencyTo}</span>
                        <span class="transaction-date">${formatDate(tx.createdAt)}</span>
                    </div>
                    <div class="transaction-body">
                        <span>${tx.amountToSend} ${tx.currencyFrom} ➔ ${tx.amountToReceive} ${tx.currencyTo}</span>
                    </div>
                    <div class="transaction-footer"><span class="status-badge status-${tx.status}">${formatStatus(tx.status)}</span></div>
                </div>`).join('');
        } catch (e) { historyContainer.innerHTML = '<p>Erreur historique.</p>'; }
    }

    async function displayReferralInfo() {
        const user = tg.initDataUnsafe?.user;
        if (!user) return;
        try {
            const res = await fetch(`/api/miniapp/referral-info/${user.id}`);
            const info = await res.json();
            const botUsername = "AtexOfficielBot"; 
            const shortAppName = "atexly"; // Vérifie que c'est bien ton shortname
            referralLinkSpan.textContent = `https://t.me/${botUsername}/${shortAppName}?startapp=${info.referralCode}`;
            totalEarningsP.textContent = `${(info.referralEarnings || 0).toFixed(2)} USDT`;
            referralCountP.textContent = info.referralCount || 0;
            
            // Listes
            const renderList = (list, containerId, headerId) => {
                const container = document.getElementById(containerId);
                document.querySelector(`#${headerId} span`).textContent = `(${list.length})`;
                container.innerHTML = list.length ? list.map(r => `<p class="referral-item">👤 ${r.name}</p>`).join('') : '<p class="referral-item-empty">Aucun filleul.</p>';
            };
            renderList(info.activeReferrals, 'active-referrals-list', 'active-referrals-header');
            renderList(info.inactiveReferrals, 'inactive-referrals-list', 'inactive-referrals-header');
        } catch (e) { console.error(e); }
    }

    // --- LOGIQUE RETRAIT (Inchangée) ---
    const showWithdrawalBtn = document.getElementById('show-withdrawal-btn');
    const withdrawalModal = document.getElementById('withdrawal-modal');
    if (showWithdrawalBtn) {
        showWithdrawalBtn.addEventListener('click', () => withdrawalModal.classList.remove('hidden'));
        document.getElementById('close-withdrawal-modal').addEventListener('click', () => withdrawalModal.classList.add('hidden'));
        
        // Logique radio (USDT vs MM)
        document.querySelectorAll('input[name="withdrawal-method"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const isUsdt = e.target.value === 'usdt';
                document.getElementById('withdrawal-usdt-group').classList.toggle('hidden', !isUsdt);
                document.getElementById('withdrawal-mm-group').classList.toggle('hidden', isUsdt);
            });
        });

        document.getElementById('submit-withdrawal-btn').addEventListener('click', async () => {
            const user = tg.initDataUnsafe?.user;
            if(!user) return;
            const amount = parseFloat(document.getElementById('withdrawal-amount').value);
            const method = document.querySelector('input[name="withdrawal-method"]:checked').value;
            
            // ... (Validations simples) ...
            if(amount < 5) return tg.showAlert("Min 5 USDT");

            let details = {};
            if(method === 'usdt') details = { walletAddress: document.getElementById('withdrawal-wallet').value };
            else details = { provider: document.getElementById('withdrawal-mm-provider').value, phone: document.getElementById('withdrawal-phone').value };

            try {
                const res = await fetch('/api/miniapp/request-withdrawal', {
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ telegramId: user.id, telegramUsername: user.username, amount, method, details })
                });
                const d = await res.json();
                tg.showAlert(d.message, () => withdrawalModal.classList.add('hidden'));
            } catch(e) { tg.showAlert("Erreur retrait"); }
        });
    }

    // --- INITIALISATION ---
    async function initializeApp() {
        await performUserCheckIn();
        await fetchPrices(); // Charge la config et construit le menu
        
        const user = tg.initDataUnsafe?.user;
        if (user) userGreetingDiv.innerHTML = `<h2>Bonjour, ${user.first_name} ! 👋</h2>`;
        
        document.getElementById('splash-screen').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('nav-bar').classList.remove('hidden');
        
        // Navigation Tabs
        const navButtons = document.querySelectorAll('nav button');
        const pages = document.querySelectorAll('.page');
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const pageId = btn.dataset.page;
                if(pageId === 'profile') displayTransactionHistory();
                if(pageId === 'earn') displayReferralInfo();
                
                navButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                pages.forEach(p => p.classList.toggle('active', p.id === pageId));
            });
        });

        switchMode('buy');
    }

    initializeApp();
});