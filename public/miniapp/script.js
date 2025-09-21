document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();

    // --- NOUVELLE FONCTION DE CHECK-IN AU DÉMARRAGE ---
    async function performUserCheckIn() {
        try {
            const user = tg.initDataUnsafe?.user;
            const referredByCode = tg.initDataUnsafe?.start_param || null;

            if (user) {
                console.log('Performing user check-in...');
                await fetch('/api/miniapp/user-check-in', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user, referredByCode })
                });
                console.log('Check-in complete.');
            }
        } catch (error) {
            console.error("Erreur critique lors du check-in:", error);
        }
    }

    // --- VARIABLES GLOBALES ---
    let atexPrices = {};
    let currentMode = 'buy';

    // --- ÉLÉMENTS DU DOM ---
    const amountToSendInput = document.getElementById('amount-to-send');
    const cryptoSelect = document.getElementById('crypto-select');
    const amountToReceiveDisplay = document.getElementById('amount-to-receive');
    const submitBtn = document.getElementById('submit-btn');
    const buyTab = document.getElementById('buy-tab');
    const sellTab = document.getElementById('sell-tab');
    const amountLabel = document.querySelector('label[for="amount-to-send"]');
    const amountCurrencySpan = document.querySelector('.calculator .form-group span');
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

    // --- FONCTIONS HELPER ---
    function formatStatus(status) {
        switch (status) {
            case 'completed': return 'Complétée';
            case 'pending': return 'En attente';
            case 'cancelled': return 'Annulée';
            default: return status;
        }
    }

    function formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // --- FONCTIONS D'AFFICHAGE ---
    async function displayTransactionHistory() {
        const user = tg.initDataUnsafe?.user;
        if (!user) {
            historyContainer.innerHTML = '<p>Impossible d\'identifier l\'utilisateur.</p>';
            return;
        }
        historyContainer.innerHTML = '<p>Chargement de l\'historique...</p>';
        try {
            const response = await fetch(`/api/miniapp/my-transactions/${user.id}`);
            if (!response.ok) throw new Error('Erreur lors de la récupération des données.');
            const transactions = await response.json();
            if (transactions.length === 0) {
                historyContainer.innerHTML = '<p>Aucune transaction pour le moment.</p>';
                return;
            }
            let historyHtml = '';
            transactions.forEach(tx => {
                const typeText = tx.type === 'buy' ? 'Achat' : 'Vente';
                const fromText = `${tx.amountToSend.toLocaleString('fr-FR')} ${tx.currencyFrom}`;
                const toText = `${tx.amountToReceive.toLocaleString('fr-FR')} ${tx.currencyTo}`;
                historyHtml += `
                    <div class="transaction-item">
                        <div class="transaction-header">
                            <span class="transaction-type">${typeText} de ${tx.currencyTo}</span>
                            <span class="transaction-date">${formatDate(tx.createdAt)}</span>
                        </div>
                        <div class="transaction-body">
                            <span>${fromText} ➔ ${toText}</span>
                        </div>
                        <div class="transaction-footer">
                            <span class="status-badge status-${tx.status}">${formatStatus(tx.status)}</span>
                        </div>
                    </div>
                `;
            });
            historyContainer.innerHTML = historyHtml;
        } catch (error) {
            console.error("Erreur fetch historique:", error);
            historyContainer.innerHTML = '<p>Impossible de charger l\'historique. Veuillez réessayer.</p>';
        }
    }
    
    async function displayReferralInfo() {
    const user = tg.initDataUnsafe?.user;
    if (!user) return;
    try {
        const response = await fetch(`/api/miniapp/referral-info/${user.id}`);
        if (!response.ok) throw new Error('Erreur réseau.');
        const info = await response.json();
        
        // --- MISE À JOUR DES INFOS GÉNÉRALES (inchangé) ---
        const botUsername = "AtexOfficielBot";
        const shortAppName = "atexly";
        const referralLink = `https://t.me/${botUsername}/${shortAppName}?startapp=${info.referralCode}`;
        referralLinkSpan.textContent = referralLink;
        totalEarningsP.textContent = `${(info.referralEarnings || 0).toFixed(2)} USDT`;
        referralCountP.textContent = info.referralCount || 0;

        // --- NOUVEAU BLOC : AFFICHAGE DES LISTES DE FILLEULS ---
        const activeContainer = document.getElementById('active-referrals-list');
        const inactiveContainer = document.getElementById('inactive-referrals-list');

        // Vider les anciens contenus
        activeContainer.innerHTML = '';
        inactiveContainer.innerHTML = '';

        // Mettre à jour les en-têtes avec les comptes
        document.querySelector('#active-referrals-header span').textContent = `(${info.activeReferrals.length})`;
        document.querySelector('#inactive-referrals-header span').textContent = `(${info.inactiveReferrals.length})`;

        // Remplir la liste des actifs
        if (info.activeReferrals.length > 0) {
            info.activeReferrals.forEach(ref => {
                const p = document.createElement('p');
                p.className = 'referral-item';
                p.textContent = `👤 ${ref.name}`;
                activeContainer.appendChild(p);
            });
        } else {
            activeContainer.innerHTML = '<p class="referral-item-empty">Aucun filleul actif.</p>';
        }

        // Remplir la liste des inactifs
        if (info.inactiveReferrals.length > 0) {
            info.inactiveReferrals.forEach(ref => {
                const p = document.createElement('p');
                p.className = 'referral-item';
                p.textContent = `👤 ${ref.name}`;
                inactiveContainer.appendChild(p);
            });
        } else {
            inactiveContainer.innerHTML = '<p class="referral-item-empty">Aucun filleul en attente.</p>';
        }
        // --- FIN DU NOUVEAU BLOC ---

    } catch (error) {
        console.error("Erreur fetch parrainage:", error);
        referralLinkSpan.textContent = "Erreur de chargement.";
    }
}

    // --- LOGIQUE DU CALCULATEUR ---
    function calculate() {
        const amount = parseFloat(amountToSendInput.value) || 0;
        const selectedCrypto = cryptoSelect.value;
        if (amount === 0 || !atexPrices[selectedCrypto]) {
            const initialCurrency = currentMode === 'buy' ? selectedCrypto.toUpperCase() : 'FCFA';
            amountToReceiveDisplay.textContent = `0.00 ${initialCurrency}`;
            return;
        }
        const rate = atexPrices[selectedCrypto][currentMode];
        let result, resultCurrency;
        if (currentMode === 'buy') {
            result = amount / rate;
            resultCurrency = selectedCrypto.toUpperCase();
        } else {
            result = amount * rate;
            resultCurrency = 'FCFA';
        }
        const decimals = selectedCrypto === 'btc' || selectedCrypto === 'eth' ? 6 : 2;
        amountToReceiveDisplay.textContent = `${result.toFixed(decimals)} ${resultCurrency}`;
    }

    async function fetchPrices() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            atexPrices = data.atexPrices;
            calculate();
        } catch (error) {
            console.error("Erreur lors de la récupération des prix:", error);
        }
    }

    function switchMode(newMode) {
        currentMode = newMode;
        buyTab.classList.toggle('active', newMode === 'buy');
        sellTab.classList.toggle('active', newMode === 'sell');
        walletAddressGroup.classList.toggle('hidden', newMode !== 'buy');
        if (newMode === 'buy') {
            amountLabel.textContent = 'Montant (FCFA)';
            amountCurrencySpan.textContent = 'FCFA';
            submitBtn.textContent = 'Acheter';
            submitBtn.style.backgroundColor = '#28a745';
        } else {
            amountLabel.textContent = `Montant (${cryptoSelect.options[cryptoSelect.selectedIndex].text})`;
            amountCurrencySpan.textContent = cryptoSelect.value.toUpperCase();
            submitBtn.textContent = 'Vendre';
            submitBtn.style.backgroundColor = '#dc3545';
        }
        calculate();
    }

    // --- ÉCOUTEURS D'ÉVÉNEMENTS ---
    amountToSendInput.addEventListener('input', calculate);
    cryptoSelect.addEventListener('change', () => {
        if (currentMode === 'sell') {
            amountLabel.textContent = `Montant (${cryptoSelect.options[cryptoSelect.selectedIndex].text})`;
            amountCurrencySpan.textContent = cryptoSelect.value.toUpperCase();
        }
        calculate();
    });
    buyTab.addEventListener('click', () => switchMode('buy'));
    sellTab.addEventListener('click', () => switchMode('sell'));
     submitBtn.addEventListener('click', async () => {
        const user = tg.initDataUnsafe?.user;
        const amountToSend = parseFloat(amountToSendInput.value);
        const selectedCrypto = cryptoSelect.value;
        const resultText = amountToReceiveDisplay.textContent.split(' ')[0];
        const amountToReceive = parseFloat(resultText);
        const walletAddress = walletAddressInput.value;
        const paymentMethod = mmProviderSelect.value;
        const phoneNumber = phoneNumberInput.value;

        if (!amountToSend || amountToSend <= 0) return tg.showAlert("Veuillez entrer un montant valide.");
        if (currentMode === 'buy' && !walletAddress) return tg.showAlert("Veuillez entrer votre adresse de portefeuille.");
        
        // --- BLOC DE VALIDATION DU TÉLÉPHONE AMÉLIORÉ ---
        if (!phoneNumber) return tg.showAlert("Veuillez entrer votre numéro de téléphone.");
        
        // On vérifie que le numéro commence bien par un "+"
        if (!phoneNumber.startsWith('+')) {
            return tg.showAlert("Format invalide. Veuillez inclure l'indicatif de votre pays (ex: +221...).");
        }
        // --- FIN DU BLOC DE VALIDATION ---

        const transactionData = {
            type: currentMode,
            currencyFrom: currentMode === 'buy' ? 'FCFA' : selectedCrypto.toUpperCase(),
            amountToSend: amountToSend,
            currencyTo: currentMode === 'buy' ? selectedCrypto.toUpperCase() : 'FCFA',
            amountToReceive: amountToReceive,
            paymentMethod: paymentMethod,
            walletAddress: walletAddress || 'non-requis',
            phoneNumber: phoneNumber,
            telegramUsername: user?.username || 'non-défini',
            telegramId: user?.id || null
        };

        try {
            tg.MainButton.showProgress();
            const response = await fetch('/api/miniapp/initiate-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(transactionData)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Une erreur est survenue.');

            if (currentMode === 'sell' && data.redirectUrl) {
                tg.openTelegramLink(data.redirectUrl);
                tg.close();
            } else {
                tg.showAlert(data.message, () => { tg.close(); });
            }
        } catch (error) {
            tg.showAlert(`Erreur : ${error.message}`);
        } finally {
            tg.MainButton.hideProgress();
        }
    });

    copyReferralLinkBtn.addEventListener('click', () => {
        const link = referralLinkSpan.textContent;
        if(link && link !== 'Erreur de chargement.') {
            navigator.clipboard.writeText(link)
                .then(() => {
                    tg.HapticFeedback.notificationOccurred('success');
                    tg.showAlert("Lien de parrainage copié !");
                })
                .catch(err => {
                    tg.showAlert("Erreur lors de la copie.");
                    console.error('Erreur de copie:', err);
                });
        }
    });

// --- NOUVEAUX ÉLÉMENTS DU DOM POUR LE RETRAIT (AJOUTEZ CECI) ---
    const showWithdrawalBtn = document.getElementById('show-withdrawal-btn');
    const withdrawalModal = document.getElementById('withdrawal-modal');
    const closeWithdrawalModalBtn = document.getElementById('close-withdrawal-modal');
    const withdrawalMethodRadios = document.querySelectorAll('input[name="withdrawal-method"]');
    const usdtGroup = document.getElementById('withdrawal-usdt-group');
    const mmGroup = document.getElementById('withdrawal-mm-group');
    const submitWithdrawalBtn = document.getElementById('submit-withdrawal-btn');

    // --- NOUVELLE SECTION : LOGIQUE DE RETRAIT DES GAINS (AJOUTEZ CECI) ---
    if (showWithdrawalBtn) {
        showWithdrawalBtn.addEventListener('click', () => {
            withdrawalModal.classList.remove('hidden');
        });

        closeWithdrawalModalBtn.addEventListener('click', () => {
            withdrawalModal.classList.add('hidden');
        });

        withdrawalMethodRadios.forEach(radio => {
            radio.addEventListener('change', (event) => {
                const isUsdt = event.target.value === 'usdt';
                usdtGroup.classList.toggle('hidden', !isUsdt);
                mmGroup.classList.toggle('hidden', isUsdt);
            });
        });

        submitWithdrawalBtn.addEventListener('click', async () => {
            const user = tg.initDataUnsafe?.user;
            if (!user) return tg.showAlert('Utilisateur non identifié.');

            const amountInput = document.getElementById('withdrawal-amount');
            const amount = parseFloat(amountInput.value);
            const method = document.querySelector('input[name="withdrawal-method"]:checked').value;
            const totalEarnings = parseFloat(totalEarningsP.textContent);

            // Validations
            if (isNaN(amount) || amount <= 0) return tg.showAlert('Veuillez entrer un montant valide.');
            if (amount < 5) return tg.showAlert('Le montant minimum de retrait est de 5 USDT.');
            if (amount > totalEarnings) return tg.showAlert('Vous ne pouvez pas retirer plus que vos gains totaux.');

            let details = {};
            if (method === 'usdt') {
                const wallet = document.getElementById('withdrawal-wallet').value;
                if (!wallet) return tg.showAlert('Veuillez entrer votre adresse de portefeuille USDT.');
                details = { walletAddress: wallet };
            } else { // method === 'mm'
                const provider = document.getElementById('withdrawal-mm-provider').value;
                const phone = document.getElementById('withdrawal-phone').value;
                if (!phone) return tg.showAlert('Veuillez entrer votre numéro de téléphone.');
                if (!phone.startsWith('+')) return tg.showAlert("Format invalide. Le numéro doit commencer par l'indicatif du pays (ex: +221...).");
                details = { provider, phone };
            }

            const withdrawalData = {
                telegramId: user.id,
                telegramUsername: user.username || 'non-défini',
                amount,
                method,
                details
            };

            try {
                tg.MainButton.showProgress();
                const response = await fetch('/api/miniapp/request-withdrawal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(withdrawalData)
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.message || 'Une erreur est survenue.');

                tg.showAlert(data.message, () => {
                    withdrawalModal.classList.add('hidden');
                    amountInput.value = ''; // Vider le champ du montant
                    displayReferralInfo(); // Mettre à jour l'affichage des gains
                });
            } catch (error) {
                tg.showAlert(`Erreur: ${error.message}`);
            } finally {
                tg.MainButton.hideProgress();
            }
        });
    }

    // --- NOUVELLE FONCTION D'INITIALISATION ---
    async function initializeApp() {
        // Étape 1 : On s'assure que l'utilisateur est enregistré et que le parrainage est traité
        await performUserCheckIn();
        
        // Étape 2 : On charge les informations essentielles (prix, etc.)
        fetchPrices();
        
        // Étape 3 : On affiche le contenu
        const user = tg.initDataUnsafe?.user;
        if (user) {
            userGreetingDiv.innerHTML = `<h2>Bonjour, ${user.first_name} ! 👋</h2>`;
        }
        
        document.getElementById('splash-screen').classList.add('hidden');
        document.getElementById('main-content').classList.remove('hidden');
        document.getElementById('nav-bar').classList.remove('hidden');
        
        switchMode('buy');
    }

    // --- ATTACHEMENT DES ÉCOUTEURS DE NAVIGATION ---
    const navButtons = document.querySelectorAll('nav button');
    const pages = document.querySelectorAll('.page');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetPageId = button.dataset.page;
            
            if (targetPageId === 'profile') {
                displayTransactionHistory();
            } else if (targetPageId === 'earn') {
                displayReferralInfo();
            }

            // --- CES LIGNES ONT ÉTÉ DÉPLACÉES ICI ---
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            pages.forEach(page => {
                page.classList.toggle('active', page.id === targetPageId);
            });
            // --- FIN DU DÉPLACEMENT ---
        });
    });

    // On appelle la fonction principale pour démarrer l'application
    initializeApp();
});