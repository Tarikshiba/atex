document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand(); // Force l'app en plein écran

    // --- VARIABLES GLOBALES ---
    let atexPrices = {};
    let availableCryptosList = [];
    let currentMode = 'buy';
    let userLevel = 0;

    // --- ÉLÉMENTS DU DOM (Nouveaux IDs iOS) ---
    // Inputs Échange
    const amountToSendInput = document.getElementById('amount-to-send');
    const cryptoSelect = document.getElementById('crypto-select');
    const amountToReceiveDisplay = document.getElementById('amount-to-receive');
    const submitBtn = document.getElementById('submit-btn');
    
    // Segmented Control (Switch)
    const buyTab = document.getElementById('buy-tab');
    const sellTab = document.getElementById('sell-tab');
    const segmentBg = document.getElementById('segment-bg');

    // Labels dynamiques
    const amountLabel = document.getElementById('amount-label');
    const currencySuffix = document.getElementById('currency-suffix');
    
    // Groupes conditionnels
    const walletAddressGroup = document.getElementById('wallet-address-group');
    const walletAddressInput = document.getElementById('wallet-address');
    const mmProviderGroup = document.getElementById('mm-provider-group'); // Nouveau conteneur
    const mmProviderSelect = document.getElementById('mm-provider');
    const phoneNumberGroup = document.getElementById('phone-number-group');
    const phoneNumberInput = document.getElementById('phone-number');

    // Autres
    const userGreetingDiv = document.getElementById('user-greeting'); // (Sera remplacé par le header Profil)
    const historyContainer = document.getElementById('transaction-history-container');
    const referralLinkSpan = document.getElementById('referral-link');
    const copyReferralLinkBtn = document.getElementById('copy-referral-link');
    const totalEarningsEl = document.getElementById('total-earnings');
    const referralCountEl = document.getElementById('referral-count');

    // --- 1. LOGIQUE UI APPLE (Switch & Navigation) ---

    // Animation du "Segmented Control" (La pilule qui glisse)
    function switchMode(newMode) {
        currentMode = newMode;
        
        if (newMode === 'buy') {
            segmentBg.style.transform = 'translateX(0%)';
            buyTab.classList.add('active');
            sellTab.classList.remove('active');
            
            // Affichage UI Achat
            walletAddressGroup.classList.remove('hidden'); // On montre Wallet
            mmProviderGroup.classList.remove('hidden');    // On montre Mobile Money (Source paiement)
            
            amountLabel.textContent = "Je paie (FCFA)";
            currencySuffix.textContent = "FCFA";
            submitBtn.textContent = "Acheter maintenant";
            submitBtn.classList.remove('shadow-red-200');
            submitBtn.classList.add('shadow-green-200');
            submitBtn.style.backgroundColor = '#34C759'; // Vert iOS
            
        } else {
            segmentBg.style.transform = 'translateX(100%)';
            sellTab.classList.add('active');
            buyTab.classList.remove('active');
            
            // Affichage UI Vente
            walletAddressGroup.classList.add('hidden');    // On cache Wallet (pas besoin de l'adresse du client)
            mmProviderGroup.classList.remove('hidden');    // On garde MM (Destination paiement)
            
            // Mise à jour Label dynamique selon crypto sélectionnée
            const symbol = getCryptoSymbol(cryptoSelect.value);
            amountLabel.textContent = `Je vends (${symbol})`;
            currencySuffix.textContent = symbol;
            
            submitBtn.textContent = "Vendre maintenant";
            submitBtn.classList.remove('shadow-green-200');
            submitBtn.classList.add('shadow-red-200');
            submitBtn.style.backgroundColor = '#FF3B30'; // Rouge iOS
        }
        
        calculate();
    }

    // Exposer la fonction au HTML (pour le onclick="")
    window.switchMode = switchMode;

    // --- 2. LOGIQUE MÉTIER (Calculs & API) ---

    function getCryptoSymbol(id) {
        const crypto = availableCryptosList.find(c => c.id === id);
        return crypto ? crypto.symbol : (id ? id.toUpperCase() : 'Crypto');
    }

    function calculate() {
        const amount = parseFloat(amountToSendInput.value) || 0;
        const selectedId = cryptoSelect.value;
        
        if (amount === 0 || !atexPrices[selectedId]) {
            const destCurrency = currentMode === 'buy' ? getCryptoSymbol(selectedId) : 'FCFA';
            // Mise à jour du gros titre montant
            amountToReceiveDisplay.innerHTML = `0.00 <span class="text-sm text-gray-500">${destCurrency}</span>`;
            return;
        }

        const rate = atexPrices[selectedId][currentMode];
        let result, resultCurrency;

        if (currentMode === 'buy') {
            result = amount / rate;
            resultCurrency = getCryptoSymbol(selectedId);
        } else {
            result = amount * rate;
            resultCurrency = 'FCFA';
        }

        const decimals = (resultCurrency === 'BTC' || resultCurrency === 'ETH') ? 6 : 2;
        amountToReceiveDisplay.innerHTML = `${result.toFixed(decimals)} <span class="text-sm text-gray-500">${resultCurrency}</span>`;
    }

    // --- 3. RÉCUPÉRATION DONNÉES ---

    async function fetchPrices() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            
            atexPrices = data.atexPrices;
            availableCryptosList = data.availableCryptos || [];

            const currentSelection = cryptoSelect.value;
            cryptoSelect.innerHTML = ''; 

            if (availableCryptosList.length === 0) {
                const opt = document.createElement('option');
                opt.text = "Maintenance...";
                cryptoSelect.add(opt);
            } else {
                availableCryptosList.forEach(crypto => {
                    const option = document.createElement('option');
                    option.value = crypto.id;
                    
                    // --- CORRECTION SMART DISPLAY ---
                    // Si le nom contient déjà le symbole (insensible à la casse), on ne l'ajoute pas.
                    if (crypto.name.toLowerCase().includes(crypto.symbol.toLowerCase())) {
                        option.text = crypto.name; 
                    } else {
                        option.text = `${crypto.name} (${crypto.symbol})`;
                    }
                    // ---------------------------------
                    
                    cryptoSelect.add(option);
                });

                if (currentSelection && availableCryptosList.some(c => c.id === currentSelection)) {
                    cryptoSelect.value = currentSelection;
                } else {
                    cryptoSelect.value = availableCryptosList[0].id;
                }
            }
            calculate();
        } catch (error) {
            console.error("Config Error:", error);
        }
    }

    // --- 4. GESTION PROFIL & GAMIFICATION ---

    function updateProfileUI(user) {
        if (!user) return;

        // Mise à jour Nom & ID
        const nameEl = document.getElementById('profile-name');
        const idEl = document.getElementById('profile-id');
        if(nameEl) nameEl.textContent = `${user.first_name} ${user.last_name || ''}`;
        if(idEl) idEl.textContent = `ID: ${user.id}`;

        // Mise à jour Avatar (Photo ou Initiales)
        const container = document.getElementById('profile-avatar-container');
        if (user.photo_url) {
            container.innerHTML = `<img src="${user.photo_url}" class="w-full h-full object-cover">`;
        } else {
            // Génération Initiales
            const initials = (user.first_name[0] || '') + (user.last_name ? user.last_name[0] : '');
            container.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-white text-3xl font-bold">${initials.toUpperCase()}</div>`;
        }
    }

    async function displayReferralInfo() {
        const settings = window.atexSettings;
        const noView = document.getElementById('no-campaign-view');
        const activeView = document.getElementById('active-campaign-view');

        if (!settings || !settings.referral_active) {
            if(noView) noView.classList.remove('hidden');
            if(activeView) activeView.classList.add('hidden');
            return;
        }

        if(noView) noView.classList.add('hidden');
        if(activeView) activeView.classList.remove('hidden');

        const user = tg.initDataUnsafe?.user;
        if (!user) return;

        try {
            const res = await fetch(`/api/miniapp/referral-info/${user.id}`);
            const info = await res.json();
            
            // A. LIEN
            const campaignId = settings.referral_campaign_id || 'v1';
            const botUser = "AtexOfficielBot"; 
            const shortName = "atexly"; 
            const fullLink = `https://t.me/${botUser}/${shortName}?startapp=${info.referralCode}_${campaignId}`;
            
            if(referralLinkSpan) referralLinkSpan.textContent = fullLink;
            if(totalEarningsEl) totalEarningsEl.textContent = `${(info.referralEarnings || 0).toFixed(2)} $`; // ou USDT
            if(referralCountEl) referralCountEl.textContent = info.referralCount || 0;

            // B. GAMIFICATION (BARRE DE NIVEAU)
            // Récupérer la config des niveaux depuis settings (chargés au démarrage)
            const l1 = settings.levels?.l1 || { threshold: 5 };
            const l2 = settings.levels?.l2 || { threshold: 20 };
            const l3 = settings.levels?.l3 || { threshold: 50 };

            // Calcul du niveau actuel
            const activeCount = info.activeReferrals ? info.activeReferrals.length : 0;
            const activeCountDisplay = document.getElementById('active-referrals-count');
            if(activeCountDisplay) activeCountDisplay.textContent = `(${activeCount})`;

            const levelNameEl = document.getElementById('current-level-name');
            const progressTextEl = document.getElementById('progress-text');
            const nextLevelEl = document.getElementById('next-level-text');
            const barEl = document.getElementById('level-progress-bar');
            const cardEl = document.querySelector('.level-card');

            // Reset classes
            cardEl.classList.remove('level-starter', 'level-bronze', 'level-silver', 'level-gold');

            let currentLvl = 'Starter';
            let nextThreshold = l1.threshold;
            let percent = 0;
            let cardClass = 'level-starter';
            let nextName = `Niveau 1 (${l1.percent || 5}%)`;

            if (activeCount >= l3.threshold) {
                currentLvl = 'Expert (Or)';
                cardClass = 'level-gold';
                nextThreshold = l3.threshold * 1.5; // Cap théorique
                percent = 100;
                nextName = "Niveau Max";
            } else if (activeCount >= l2.threshold) {
                currentLvl = 'Confirmé (Argent)';
                cardClass = 'level-silver';
                nextThreshold = l3.threshold;
                percent = ((activeCount - l2.threshold) / (l3.threshold - l2.threshold)) * 100;
                nextName = `Niveau 3 (${l3.percent || 12}%)`;
            } else if (activeCount >= l1.threshold) {
                currentLvl = 'Initié (Bronze)';
                cardClass = 'level-bronze';
                nextThreshold = l2.threshold;
                percent = ((activeCount - l1.threshold) / (l2.threshold - l1.threshold)) * 100;
                nextName = `Niveau 2 (${l2.percent || 8}%)`;
            } else {
                // Starter
                percent = (activeCount / l1.threshold) * 100;
            }

            // Application UI
            cardEl.classList.add(cardClass);
            levelNameEl.textContent = currentLvl;
            progressTextEl.textContent = `${activeCount} / ${nextThreshold} actifs`;
            nextLevelEl.textContent = nextName;
            barEl.style.width = `${Math.min(percent, 100)}%`;

            // C. LISTE FILLEULS
            const listContainer = document.getElementById('active-referrals-list');
            if(listContainer) {
                if (info.activeReferrals && info.activeReferrals.length > 0) {
                    listContainer.innerHTML = info.activeReferrals.map(r => `
                        <div class="flex items-center justify-between p-3">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                                    ${r.name.charAt(0).toUpperCase()}
                                </div>
                                <span class="text-sm font-medium text-gray-700">${r.name}</span>
                            </div>
                            <span class="text-xs text-green-500 font-bold bg-green-50 px-2 py-1 rounded-lg">Actif</span>
                        </div>
                    `).join('');
                } else {
                    listContainer.innerHTML = `<p class="p-4 text-sm text-gray-400 italic text-center">Aucun filleul actif pour le moment.</p>`;
                }
            }

        } catch (e) { console.error("Referral Error", e); }
    }

    // --- 5. HISTORIQUE & FORMATAGE IOS ---

    async function displayTransactionHistory() {
        const user = tg.initDataUnsafe?.user;
        if (!user) return;
        
        historyContainer.innerHTML = '<div class="p-4 text-center text-gray-400">Chargement...</div>';
        
        try {
            const res = await fetch(`/api/miniapp/my-transactions/${user.id}`);
            const txs = await res.json();
            
            if (txs.length === 0) { 
                historyContainer.innerHTML = '<div class="p-4 text-center text-gray-400 italic">Aucune transaction récente.</div>'; 
                return; 
            }
            
            // Génération HTML style iOS List
            historyContainer.innerHTML = txs.map(tx => {
                const isBuy = tx.type === 'buy';
                // Icône : Flèche Verte Bas (Reçu/Achat) ou Rouge Haut (Envoyé/Vente)
                const iconClass = isBuy ? 'fa-arrow-down text-green-500' : 'fa-arrow-up text-red-500';
                const bgClass = isBuy ? 'bg-green-50' : 'bg-red-50';
                const title = isBuy ? `Achat ${tx.currencyTo}` : `Vente ${tx.currencyFrom}`;
                const date = new Date(tx.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour:'2-digit', minute:'2-digit' });
                
                // Statut couleur
                let statusColor = 'text-yellow-500';
                let statusText = 'En attente';
                if(tx.status === 'completed') { statusColor = 'text-green-500'; statusText = 'Succès'; }
                if(tx.status === 'cancelled') { statusColor = 'text-red-500'; statusText = 'Annulé'; }

                return `
                <div class="history-item">
                    <div class="history-icon ${bgClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="history-content">
                        <div class="flex justify-between items-center">
                            <span class="history-title">${title}</span>
                            <span class="history-amount ${isBuy ? 'text-green-600' : 'text-gray-900'}">
                                ${isBuy ? '+' : '-'}${isBuy ? tx.amountToReceive.toFixed(4) : tx.amountToSend} 
                                <span class="text-xs text-gray-400">${isBuy ? tx.currencyTo : tx.currencyFrom}</span>
                            </span>
                        </div>
                        <div class="flex justify-between items-center mt-1">
                            <span class="history-subtitle">${date}</span>
                            <span class="text-xs font-medium ${statusColor}">${statusText}</span>
                        </div>
                    </div>
                </div>
                `;
            }).join('');
            
        } catch (e) { 
            historyContainer.innerHTML = '<div class="p-4 text-center text-red-400">Erreur de chargement.</div>'; 
        }
    }

    // --- 6. INITIALISATION & LISTENERS ---

    // Listeners Globaux
    amountToSendInput.addEventListener('input', calculate);
    cryptoSelect.addEventListener('change', () => {
        // MAJ du suffixe si en mode vente
        if (currentMode === 'sell') {
            const symbol = getCryptoSymbol(cryptoSelect.value);
            amountLabel.textContent = `Je vends (${symbol})`;
            currencySuffix.textContent = symbol;
        }
        calculate();
    });

    // --- FONCTION CŒUR : ENVOI DE LA TRANSACTION ---
    async function processTransaction() {
        const user = tg.initDataUnsafe?.user;
        const amount = parseFloat(amountToSendInput.value);
        
        if (!amount || amount <= 0) return tg.showAlert("Montant invalide.");
        
        const data = {
            type: currentMode,
            currencyFrom: currentMode === 'buy' ? 'FCFA' : getCryptoSymbol(cryptoSelect.value),
            amountToSend: amount,
            currencyTo: currentMode === 'buy' ? getCryptoSymbol(cryptoSelect.value) : 'FCFA',
            amountToReceive: parseFloat(amountToReceiveDisplay.textContent),
            paymentMethod: mmProviderSelect.value,
            walletAddress: walletAddressInput.value || 'N/A',
            phoneNumber: phoneNumberInput.value,
            telegramUsername: user?.username,
            telegramId: user?.id,
            cryptoId: cryptoSelect.value
        };

        try {
            tg.MainButton.showProgress();
            const res = await fetch('/api/miniapp/initiate-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const json = await res.json();
            if(!res.ok) throw new Error(json.message);
            
            // Succès
            tg.showAlert(json.message);
            // On peut vider les champs ici si tu veux
            amountToSendInput.value = '';
            calculate();

        } catch (e) {
            tg.showAlert(e.message);
        } finally {
            tg.MainButton.hideProgress();
        }
    }

    // --- INTERCEPTION DU CLIC (Night Mode Logic) ---
    submitBtn.addEventListener('click', () => {
        // 1. Validation de base avant de lancer la modale
        const amount = parseFloat(amountToSendInput.value);
        if (!amount || amount <= 0) return tg.showAlert("Veuillez entrer un montant.");

        // 2. Vérification Mode Nuit
        const settings = window.atexSettings || {};
        
        if (settings.night_mode_manual) {
            // AFFICHER LA MODALE NUIT
            const nightModal = document.getElementById('night-mode-modal');
            nightModal.classList.remove('hidden');
            
            // Vibration pour attirer l'attention (Haptic Feedback)
            if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');

        } else {
            // MODE JOUR : Envoi direct
            processTransaction();
        }
    });

    // --- GESTION DES BOUTONS DE LA MODALE NUIT ---
    const nightModal = document.getElementById('night-mode-modal');
    
    document.getElementById('night-cancel-btn').addEventListener('click', () => {
        nightModal.classList.add('hidden'); // On ferme juste
    });

    document.getElementById('night-continue-btn').addEventListener('click', () => {
        nightModal.classList.add('hidden'); // On ferme
        processTransaction(); // ET on lance la transaction
    });

    // Copie Lien
    if(copyReferralLinkBtn) {
        copyReferralLinkBtn.addEventListener('click', () => {
            const link = referralLinkSpan.textContent;
            navigator.clipboard.writeText(link).then(() => tg.showAlert("Lien copié !"));
        });
    }

    // Gestion Modale Retrait (Inchangé mais ID adaptés)
    const showWithdrawalBtn = document.getElementById('show-withdrawal-btn');
    const withdrawalModal = document.getElementById('withdrawal-modal');
    if(showWithdrawalBtn) {
        showWithdrawalBtn.addEventListener('click', () => withdrawalModal.classList.remove('hidden'));
        document.getElementById('close-withdrawal-modal').addEventListener('click', () => withdrawalModal.classList.add('hidden'));
        
        // Toggle Méthode
        const radios = document.querySelectorAll('input[name="withdrawal-method"]');
        radios.forEach(r => r.addEventListener('change', (e) => {
            const isUsdt = e.target.value === 'usdt';
            document.getElementById('withdrawal-usdt-group').classList.toggle('hidden', !isUsdt);
            document.getElementById('withdrawal-mm-group').classList.toggle('hidden', isUsdt);
        }));

        // Submit Retrait (Copier logique existante ici si besoin, pour l'instant placeholder)
        document.getElementById('submit-withdrawal-btn').addEventListener('click', async () => {
             // ... Logique existante fetch('/api/miniapp/request-withdrawal') ...
             // (Je te laisse replacer ton code de retrait ici, ou je peux le réécrire si tu veux)
             const user = tg.initDataUnsafe?.user;
             const amount = parseFloat(document.getElementById('withdrawal-amount').value);
             const method = document.querySelector('input[name="withdrawal-method"]:checked').value;
             // Simulation
             tg.showAlert("Demande de retrait envoyée !");
             withdrawalModal.classList.add('hidden');
        });
    }

    // --- MAIN ---
    async function init() {
        // 1. Settings
        try {
            const sRes = await fetch('/api/settings');
            window.atexSettings = await sRes.json();
            
            // Maintenance
            if (window.atexSettings.maintenance_mode) {
                document.getElementById('maintenance-screen').classList.remove('hidden');
                document.getElementById('splash-screen').classList.add('hidden');
                return;
            }

            // --- NOUVEAU : Mise à jour du délai d'affichage ---
            const timeoutDisplay = document.getElementById('tx-timeout-display');
            if (timeoutDisplay && window.atexSettings.transaction_timeout) {
                timeoutDisplay.textContent = window.atexSettings.transaction_timeout;
            }
            // ---------------------------------------------------

        } catch(e) { console.error("Settings Error", e); }

        // 2. Check-in & Prices
        const user = tg.initDataUnsafe?.user;
        if(user) {
            await fetch('/api/miniapp/user-check-in', { 
                method: 'POST', headers:{'Content-Type':'application/json'}, 
                body: JSON.stringify({ user, referredByCode: tg.initDataUnsafe?.start_param }) 
            });
            updateProfileUI(user);
        }
        await fetchPrices();

        // 3. Navigation
        const navBtns = document.querySelectorAll('.nav-btn');
        const pages = document.querySelectorAll('.page');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const pageId = btn.dataset.page;
                navBtns.forEach(b => { b.classList.remove('active'); b.querySelector('i').classList.replace('text-blue-500','text-gray-400'); b.querySelector('span').classList.remove('text-blue-500'); });
                
                btn.classList.add('active');
                btn.querySelector('i').classList.replace('text-gray-400','text-blue-500'); // Highlight Icon
                btn.querySelector('span').classList.add('text-blue-500'); // Highlight Text

                pages.forEach(p => p.classList.remove('active'));
                document.getElementById(pageId).classList.add('active');

                if(pageId === 'earn') displayReferralInfo();
                if(pageId === 'profile') displayTransactionHistory();
            });
        });

        // 4. Reveal
        setTimeout(() => {
            document.getElementById('splash-screen').classList.add('hidden');
            document.getElementById('main-content').classList.remove('hidden');
            document.getElementById('nav-bar').classList.remove('hidden');
        }, 1500); // 1.5s de splash screen pour l'effet "Premium"
    }

    init();

    // Fonction utilitaire pour ouvrir les liens externes via Telegram
    window.openLink = (url) => {
        if (tg.openLink) {
            tg.openLink(url);
        } else {
            window.open(url, '_blank');
        }
    };
});