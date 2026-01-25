console.log("🚀 CHARGEMENT SYSTÈME CONTRATS V1...");
document.addEventListener('DOMContentLoaded', () => {
    // --- SÉLECTION DES ÉLÉMENTS DU DOM ---
    const dashboardContent = document.getElementById('dashboard-content');
    const token = localStorage.getItem('adminToken');
    const cryptoListBody = document.getElementById('crypto-list-body');
    const ratesContainer = document.getElementById('dynamic-rates-container');
    const addCryptoForm = document.getElementById('add-crypto-form');
    const pricingForm = document.getElementById('pricing-form');
    const pricingFeedback = document.getElementById('pricing-feedback');
    
    // NOUVEAUX ÉLÉMENTS SETTINGS
    const settingsForm = document.getElementById('general-settings-form');
    const maintenanceToggle = document.getElementById('maintenance-toggle');
    const referralToggle = document.getElementById('referral-toggle');
    const referralTextInput = document.getElementById('referral-text-input');

    // Variable globale pour stocker les cryptos chargées
    let activeCryptos = [];

    // --- SÉCURITÉ ---
    if (!token) {
        window.location.href = '/admin/login.html';
        return;
    }

    // --- DÉCONNEXION ---
    document.getElementById('logout-button').addEventListener('click', () => {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin/login.html';
    });

    // ===============================================
    // SECTION 1 : LOGIQUE DES TRANSACTIONS (INCHANGÉE)
    // ===============================================
    const renderTransactions = (transactions) => {
        dashboardContent.innerHTML = '<h2 class="text-xl font-semibold mb-4">Transactions en attente</h2>';
        if (!transactions || transactions.length === 0) {
            dashboardContent.innerHTML += '<p class="text-gray-400">Aucune transaction en attente.</p>';
            return;
        }
        const transactionList = document.createElement('div');
        transactionList.className = 'space-y-4';
        transactions.forEach(tx => {
            const date = new Date(tx.createdAt._seconds * 1000).toLocaleString('fr-FR');
            const typeClass = tx.type === 'buy' ? 'text-green-400' : 'text-yellow-400';
            const card = document.createElement('div');
            card.className = 'bg-gray-700 p-4 rounded-lg flex justify-between items-center shadow';
            card.innerHTML = `
                <div>
                    <p class="font-bold text-lg ${typeClass}">${tx.type === 'buy' ? 'Achat' : 'Vente'} - ${tx.amountToSend} ${tx.currencyFrom || 'FCFA'}</p>
                    <p class="text-sm text-gray-400">${date} - ID: ${tx.telegramId || '?'}</p>
                </div>
                <div class="flex space-x-2">
                    <button class="bg-green-600 hover:bg-green-500 text-white font-bold py-1 px-3 rounded text-sm transition" data-id="${tx.id}" data-action="completed">Valider</button>
                    <button class="bg-gray-600 hover:bg-gray-500 text-white font-bold py-1 px-3 rounded text-sm transition" data-id="${tx.id}" data-action="cancelled">Annuler</button>
                </div>
            `;
            transactionList.appendChild(card);
        });
        dashboardContent.appendChild(transactionList);
    };

    const updateTransactionStatus = async (id, newStatus) => {
        try {
            const response = await fetch(`/api/admin/transactions/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus })
            });
            if (!response.ok) throw new Error('Échec mise à jour');
            fetchPendingTransactions();
        } catch (error) {
            alert('Erreur: Impossible de mettre à jour le statut.');
        }
    };
    
    const fetchPendingTransactions = async () => {
        try {
            const response = await fetch('/api/admin/transactions/pending', { headers: { 'Authorization': `Bearer ${token}` } });
            if (response.ok) renderTransactions(await response.json());
        } catch (error) {
            dashboardContent.innerHTML = `<p class="text-red-500">Erreur chargement transactions.</p>`;
        }
    };

    dashboardContent.addEventListener('click', (e) => {
        if (e.target.dataset.action) updateTransactionStatus(e.target.dataset.id, e.target.dataset.action);
    });

    // =========================================================
    // SECTION 2 & 3 : GESTION DYNAMIQUE CRYPTOS & TAUX
    // =========================================================


    // B. Afficher le tableau des cryptos
    function renderCryptoList() {
        if (activeCryptos.length === 0) {
            cryptoListBody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Aucune crypto configurée. Cliquez sur "Ajouter" pour commencer.</td></tr>';
            return;
        }
        cryptoListBody.innerHTML = activeCryptos.map(c => `
            <tr class="border-b border-gray-700 hover:bg-gray-750 transition">
                <td class="px-4 py-3 font-mono text-yellow-500 text-xs">${c.id}</td>
                <td class="px-4 py-3 text-white font-bold">${c.name}</td>
                <td class="px-4 py-3"><span class="bg-gray-600 text-xs px-2 py-1 rounded">${c.network}</span></td>
                <td class="px-4 py-3 font-mono text-xs text-gray-400 truncate max-w-xs" title="${c.walletAddress}">${c.walletAddress.substring(0, 15)}...</td>
                <td class="px-4 py-3 text-right space-x-2">
                    <button onclick="editCrypto('${c.id}')" class="text-blue-400 hover:text-blue-200 transition" title="Modifier">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="deleteCrypto('${c.id}')" class="text-red-400 hover:text-red-200 transition" title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // --- FONCTIONS MODALES (GLOBALES) ---
    
    window.openAddModal = () => {
        document.getElementById('add-crypto-form').reset();
        document.getElementById('modal-title').textContent = "Ajouter une Crypto";
        const idInput = document.getElementById('new-id');
        idInput.disabled = false;
        idInput.classList.remove('bg-gray-700', 'cursor-not-allowed');
        document.getElementById('add-crypto-modal').classList.remove('hidden');
    };

    window.editCrypto = (id) => {
        const crypto = activeCryptos.find(c => c.id === id);
        if (!crypto) return;

        document.getElementById('new-id').value = crypto.id;
        document.getElementById('new-name').value = crypto.name;
        document.getElementById('new-symbol').value = crypto.symbol;
        document.getElementById('new-network').value = crypto.network;
        document.getElementById('new-wallet').value = crypto.walletAddress;
 // On remplace market-key par cmc-id
        document.getElementById('new-cmc-id').value = crypto.cmcId || ''; 
        document.getElementById('new-min-buy').value = crypto.minBuy || '';
        document.getElementById('new-min-sell').value = crypto.minSell || '';

        const idInput = document.getElementById('new-id');
        idInput.disabled = true; 
        idInput.classList.add('bg-gray-700', 'cursor-not-allowed');

        document.getElementById('modal-title').textContent = `Modifier ${crypto.name}`;
        document.getElementById('add-crypto-modal').classList.remove('hidden');
    };

    // C. Afficher le formulaire des taux
    function renderRatesForm(currentRates) {
        if (activeCryptos.length === 0) {
            ratesContainer.innerHTML = '<p class="text-gray-500 col-span-3 text-center">Ajoutez une crypto pour configurer ses taux.</p>';
            return;
        }
        ratesContainer.innerHTML = activeCryptos.map(c => {
            const rate = currentRates[c.id] || { buy: '', sell: '' };
            return `
            <div class="bg-gray-700 p-4 rounded border border-gray-600 shadow-sm hover:border-gray-500 transition">
                <div class="flex justify-between items-center mb-3">
                    <label class="font-bold text-teal-400">${c.name}</label>
                    <span class="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded">${c.symbol}</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="text-xs text-gray-400 mb-1 block">Achat (FCFA)</label>
                        <input type="number" step="any" name="${c.id}-buy-rate" value="${rate.buy}" 
                               class="w-full p-2 bg-gray-800 rounded border border-gray-500 text-sm text-white focus:border-green-500 outline-none" placeholder="ex: 650">
                    </div>
                    <div>
                        <label class="text-xs text-gray-400 mb-1 block">Vente (FCFA)</label>
                        <input type="number" step="any" name="${c.id}-sell-rate" value="${rate.sell}" 
                               class="w-full p-2 bg-gray-800 rounded border border-gray-500 text-sm text-white focus:border-red-500 outline-none" placeholder="ex: 600">
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // D. Ajouter une Crypto (Appel API)
    addCryptoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const symbol = document.getElementById('new-symbol').value.toUpperCase();
        
        const newCrypto = {
    id: document.getElementById('new-id').value.trim(),
    name: document.getElementById('new-name').value.trim(),
    symbol: symbol,
    network: document.getElementById('new-network').value.trim(),
    walletAddress: document.getElementById('new-wallet').value.trim(),
    // marketKey supprimé, c'est obsolète
    cmcId: document.getElementById('new-cmc-id').value.trim(), 
    minBuy: parseFloat(document.getElementById('new-min-buy').value) || 0,
    minSell: parseFloat(document.getElementById('new-min-sell').value) || 0
};

        try {
            const res = await fetch('/api/admin/cryptos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(newCrypto)
            });

            if(res.ok) {
                document.getElementById('add-crypto-modal').classList.add('hidden');
                addCryptoForm.reset();
                loadConfiguration();
            } else {
                alert("Erreur lors de l'ajout. Vérifiez les champs.");
            }
        } catch (error) {
            console.error(error);
        }
    });

    // E. Supprimer une Crypto (Appel API)
    window.deleteCrypto = async (id) => {
        if(!confirm(`Supprimer la crypto ${id} ? \nAttention : Cela supprimera aussi ses taux configurés.`)) return;
        try {
            await fetch(`/api/admin/cryptos/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }});
            loadConfiguration();
        } catch (e) { alert("Erreur suppression"); }
    };

    // F. Sauvegarder les Taux
    pricingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        pricingFeedback.textContent = 'Enregistrement...';
        pricingFeedback.className = 'mt-2 text-center text-sm font-medium text-yellow-400';
        
        const formData = new FormData(e.target);
        const flatRates = {};
        for (const [key, value] of formData.entries()) {
            flatRates[key] = value;
        }

        try {
            const response = await fetch('/api/admin/pricing/rates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(flatRates)
            });
            
            if (response.ok) {
                pricingFeedback.textContent = '✅ Taux mis à jour avec succès !';
                pricingFeedback.className = 'mt-2 text-center text-sm font-medium text-green-400';
                setTimeout(() => pricingFeedback.textContent = '', 3000);
            } else {
                throw new Error();
            }
        } catch (error) {
            pricingFeedback.textContent = '❌ Erreur de sauvegarde.';
            pricingFeedback.className = 'mt-2 text-center text-sm font-medium text-red-500';
        }
    });

    // ===============================================
    // SECTION : GESTION DES PARAMÈTRES & CONFIGURATION (V3 - NIGHT MODE)
    // ===============================================
    
    // Sélection des inputs
    const refMarginInput = document.getElementById('ref-margin-input');
    const minWithdrawalInput = document.getElementById('min-withdrawal-input');
    const l1Threshold = document.getElementById('l1-threshold');
    const l1Percent = document.getElementById('l1-percent');
    const l2Threshold = document.getElementById('l2-threshold');
    const l2Percent = document.getElementById('l2-percent');
    const l3Threshold = document.getElementById('l3-threshold');
    const l3Percent = document.getElementById('l3-percent');
    
    // Nouveaux Inputs Phase 1
    const nightModeToggle = document.getElementById('night-mode-toggle');
    const txTimeoutInput = document.getElementById('tx-timeout-input');

    // Nouvelle fonction loadConfiguration unifiée
    async function loadConfiguration() {
        try {
            console.log("Chargement de la configuration...");

            // 1. CHARGER LES PARAMÈTRES GÉNÉRAUX
            const settingsRes = await fetch('/api/settings');
            const settings = await settingsRes.json();
            
            // Appliquer aux toggles
            if(maintenanceToggle) maintenanceToggle.checked = settings.maintenance_mode || false;
            if(referralToggle) referralToggle.checked = settings.referral_active !== false;
            // --> NOUVEAU : Mode Nuit & Timeout
            if(nightModeToggle) nightModeToggle.checked = settings.night_mode_manual || false;
            if(txTimeoutInput) txTimeoutInput.value = settings.transaction_timeout || 10;
            // ---------------------------------

            if(referralTextInput) referralTextInput.value = settings.referral_text || '';

            // Appliquer aux inputs "Affiliation Avancée"
            if(refMarginInput) refMarginInput.value = settings.referral_margin || 30;
            if(minWithdrawalInput) minWithdrawalInput.value = settings.min_withdrawal || 5;
            
            // Niveaux
            if(l1Threshold) l1Threshold.value = settings.levels?.l1?.threshold || 5;
            if(l1Percent) l1Percent.value = settings.levels?.l1?.percent || 5;
            
            if(l2Threshold) l2Threshold.value = settings.levels?.l2?.threshold || 20;
            if(l2Percent) l2Percent.value = settings.levels?.l2?.percent || 8;
            
            if(l3Threshold) l3Threshold.value = settings.levels?.l3?.threshold || 50;
            if(l3Percent) l3Percent.value = settings.levels?.l3?.percent || 12;

            // 2. CHARGER LA LISTE DES CRYPTOS
            const cryptoRes = await fetch('/api/admin/cryptos', { headers: { 'Authorization': `Bearer ${token}` }});
            activeCryptos = await cryptoRes.json();
            renderCryptoList(); 

            // 3. CHARGER LES TAUX MANUELS
            const ratesRes = await fetch('/api/admin/pricing/rates', { headers: { 'Authorization': `Bearer ${token}` }});
            const ratesData = await ratesRes.json();
            const currentRates = ratesData.rates || {};
            renderRatesForm(currentRates);

        } catch (error) {
            console.error("Erreur chargement config:", error);
        }
    }

    // Gestionnaire de soumission du formulaire de paramètres
    if(settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = settingsForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = "Sauvegarde...";
            submitBtn.disabled = true;

            const settingsData = {
                maintenance_mode: maintenanceToggle.checked,
                referral_active: referralToggle.checked,
                referral_text: referralTextInput.value.trim(),
                // --> NOUVEAU : Sauvegarde Mode Nuit & Timeout
                night_mode_manual: nightModeToggle.checked,
                transaction_timeout: parseInt(txTimeoutInput.value) || 10,
                // -------------------------------------------
                referral_margin: parseFloat(refMarginInput.value) || 30,
                min_withdrawal: parseFloat(minWithdrawalInput.value) || 5,
                levels: {
                    l1: { threshold: parseInt(l1Threshold.value)||5, percent: parseFloat(l1Percent.value)||5 },
                    l2: { threshold: parseInt(l2Threshold.value)||20, percent: parseFloat(l2Percent.value)||8 },
                    l3: { threshold: parseInt(l3Threshold.value)||50, percent: parseFloat(l3Percent.value)||12 }
                }
            };

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(settingsData)
                });

                if (res.ok) {
                    alert("✅ Configuration enregistrée !");
                } else {
                    alert("❌ Erreur serveur.");
                }
            } catch (error) {
                console.error(error);
                alert("❌ Erreur connexion.");
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });
    }
    
    // ===============================================
    // SECTION 4 : GESTION DES RETRAITS (PHASE 2)
    // ===============================================

    const withdrawalsContainer = document.getElementById('withdrawals-list');
    const approveModal = document.getElementById('approve-withdrawal-modal');
    const proofInput = document.getElementById('withdrawal-proof');
    const confirmApproveBtn = document.getElementById('confirm-approve-btn');
    const approveIdInput = document.getElementById('approve-withdrawal-id');

    const fetchWithdrawals = async () => {
        try {
            const res = await fetch('/api/admin/withdrawals/pending', { headers: { 'Authorization': `Bearer ${token}` } });
            const withdrawals = await res.json();
            renderWithdrawals(withdrawals);
        } catch (e) {
            if(withdrawalsContainer) withdrawalsContainer.innerHTML = '<p class="text-red-500">Erreur chargement retraits.</p>';
        }
    };

    const renderWithdrawals = (list) => {
        if (!list || list.length === 0) {
            if(withdrawalsContainer) withdrawalsContainer.innerHTML = '<p class="text-gray-500 italic">Aucune demande de retrait en attente.</p>';
            return;
        }
        
        withdrawalsContainer.innerHTML = list.map(w => {
            const date = new Date(w.createdAt._seconds * 1000).toLocaleString('fr-FR');
            let methodIcon = w.method === 'usdt' ? '💎 USDT' : '📱 Mobile Money';
            let detailsHtml = w.method === 'usdt' 
                ? `<span class="font-mono bg-gray-900 px-1 rounded text-xs text-blue-300">${w.details.walletAddress}</span>`
                : `<span class="text-yellow-300">${w.details.provider}</span> - ${w.details.phone}`;

            return `
            <div class="bg-gray-700 p-4 rounded-lg flex justify-between items-center border-l-4 border-blue-500 shadow-md">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-bold text-white text-lg">${w.amount} USDT</span>
                        <span class="text-xs bg-blue-900 text-blue-200 px-2 py-0.5 rounded-full">${methodIcon}</span>
                    </div>
                    <p class="text-sm text-gray-300 mb-1">👤 @${w.telegramUsername || 'Anonyme'} (ID: ${w.telegramId})</p>
                    <p class="text-xs text-gray-400">📅 ${date}</p>
                    <div class="mt-2 text-sm text-gray-200">
                        ${detailsHtml}
                    </div>
                </div>
                <div class="flex flex-col space-y-2 ml-4">
                    <button onclick="openApproveModal('${w.id}')" class="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded text-sm shadow transition">
                        <i class="fas fa-check"></i> Payer
                    </button>
                    <button onclick="rejectWithdrawal('${w.id}')" class="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded text-sm shadow transition">
                        <i class="fas fa-times"></i> Rejeter
                    </button>
                </div>
            </div>`;
        }).join('');
    };

    window.openApproveModal = (id) => {
        approveIdInput.value = id;
        proofInput.value = '';
        approveModal.classList.remove('hidden');
    };

    window.rejectWithdrawal = async (id) => {
        const reason = prompt("Raison du rejet (sera envoyée à l'utilisateur) :", "Données incorrectes");
        if (reason === null) return;

        try {
            const res = await fetch(`/api/admin/withdrawals/${id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ reason })
            });
            if (res.ok) {
                alert("Retrait rejeté et remboursé.");
                fetchWithdrawals();
            } else {
                alert("Erreur serveur.");
            }
        } catch (e) { alert("Erreur connexion"); }
    };

    if(confirmApproveBtn) {
        confirmApproveBtn.addEventListener('click', async () => {
            const id = approveIdInput.value;
            const proof = proofInput.value.trim();
            
            if(!proof) return alert("Veuillez entrer une preuve de paiement (Hash ou Réf).");
            
            confirmApproveBtn.textContent = "Traitement...";
            
            try {
                const res = await fetch(`/api/admin/withdrawals/${id}/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ proof })
                });
                
                if (res.ok) {
                    approveModal.classList.add('hidden');
                    alert("✅ Paiement validé et notifié !");
                    fetchWithdrawals();
                } else {
                    alert("Erreur lors de la validation.");
                }
            } catch (e) {
                alert("Erreur connexion.");
            } finally {
                confirmApproveBtn.textContent = "Envoyer & Valider";
            }
        });
    }

    // ===============================================
    // SECTION 5 : GESTION DU BROADCAST (PHASE 4 - CORRIGÉE)
    // ===============================================
    const broadcastForm = document.getElementById('broadcast-form');
    const broadcastFeedback = document.getElementById('broadcast-feedback');
    const broadcastBtn = document.getElementById('broadcast-submit-btn');
    const broadcastTestBtn = document.getElementById('broadcast-test-btn'); 

    // --- FONCTION D'ENVOI COMMUNE ---
    const sendBroadcast = async (isTest = false) => {
        const message = document.getElementById('broadcast-message').value;
        if (!message) {
            alert("Veuillez écrire un message.");
            return;
        }

        if (!isTest) {
            if (!confirm("⚠️ ATTENTION : Vous allez envoyer ce message à TOUS les utilisateurs.\n\nConfirmer l'envoi ?")) return;
        }

        const btnToDisable = isTest ? broadcastTestBtn : broadcastBtn;
        const originalText = btnToDisable.innerHTML;
        btnToDisable.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
        btnToDisable.disabled = true;
        if (isTest) broadcastBtn.disabled = true; else broadcastTestBtn.disabled = true; 
        
        broadcastFeedback.textContent = '';

        const payload = {
            message: message,
            imageUrl: document.getElementById('broadcast-image').value || null,
            buttonText: document.getElementById('broadcast-btn-text').value || null,
            buttonUrl: document.getElementById('broadcast-btn-url').value || null,
            isTest: isTest 
        };

        try {
            const res = await fetch('/api/admin/broadcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok) {
                broadcastFeedback.className = 'text-green-500 text-center text-sm font-bold mt-2';
                broadcastFeedback.textContent = `✅ ${data.message}`;
                if (!isTest) broadcastForm.reset(); 
            } else {
                broadcastFeedback.className = 'text-red-500 text-center text-sm font-bold mt-2';
                broadcastFeedback.textContent = `❌ Erreur : ${data.message}`;
            }
        } catch (error) {
            broadcastFeedback.textContent = "❌ Erreur de connexion.";
        } finally {
            btnToDisable.innerHTML = originalText;
            broadcastTestBtn.disabled = false;
            broadcastBtn.disabled = false;
        }
    };

    if (broadcastForm) {
        broadcastTestBtn.addEventListener('click', () => sendBroadcast(true));

        broadcastForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendBroadcast(false);
        });
    }

    // ===============================================
    // SECTION 6 : GESTION DES CONTRATS (PHASE 1)
    // ===============================================
    
    const contractsBody = document.getElementById('contracts-list-body');
    const contractModal = document.getElementById('add-contract-modal');
    const contractForm = document.getElementById('add-contract-form');

    // A. Charger et afficher les contrats
    const fetchContracts = async () => {
        if (!contractsBody) return;
        try {
            const res = await fetch('/api/admin/contracts', { headers: { 'Authorization': `Bearer ${token}` } });
            const contracts = await res.json();
            
            if (contracts.length === 0) {
                contractsBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500 italic">Aucun contrat actif.</td></tr>';
                return;
            }

            contractsBody.innerHTML = contracts.map(c => {
                // Calcul du pourcentage
                const percent = c.target > 0 ? Math.min(100, Math.round((c.current / c.target) * 100)) : 0;
                let barColor = 'bg-blue-500';
                if(percent >= 100) barColor = 'bg-green-500';
                
                // Jours restants
                const end = new Date(c.endDate);
                const now = new Date();
                const diffTime = end - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                let timeBadge = `<span class="bg-gray-700 text-xs px-2 py-1 rounded">${diffDays}j restants</span>`;
                if(diffDays < 0) timeBadge = `<span class="bg-red-900 text-red-200 text-xs px-2 py-1 rounded">Expiré</span>`;
                else if(c.status === 'completed') timeBadge = `<span class="bg-green-900 text-green-200 text-xs px-2 py-1 rounded">Terminé</span>`;

                return `
                <tr class="border-b border-gray-700 hover:bg-gray-750">
                    <td class="px-4 py-3">
                        <div class="font-bold text-white">@${c.username}</div>
                        <div class="text-xs text-gray-500">${c.telegramId}</div>
                    </td>
                    <td class="px-4 py-3 font-mono text-yellow-400">${c.target} Pers.</td>
                    <td class="px-4 py-3">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold w-8 text-right">${percent}%</span>
                            <div class="w-24 bg-gray-700 rounded-full h-2">
                                <div class="${barColor} h-2 rounded-full" style="width: ${percent}%"></div>
                            </div>
                            <span class="text-xs text-gray-400">(${c.current})</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 font-bold text-green-400">${c.reward.toLocaleString()} F</td>
                    <td class="px-4 py-3">${timeBadge}</td>
                    <td class="px-4 py-3 text-right">
                        <button onclick="deleteContract('${c.id}')" class="text-red-400 hover:text-red-200 transition" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
                `;
            }).join('');

        } catch (e) { console.error(e); }
    };

    // B. Ouvrir la modale (VERSION SUPER FORCE)
    window.openContractModal = () => {
        const modal = document.getElementById('add-contract-modal');
        const form = document.getElementById('add-contract-form');

        if (modal) {
            console.log("🚀 Ouverture FORCÉE de la modale...");
            
            // 1. On retire la classe 'hidden'
            modal.classList.remove('hidden');
            
            // 2. FORCE BRUTE : On applique le style directement (pour régler le bug d'affichage)
            modal.style.display = 'flex';
            modal.style.zIndex = '9999'; // On la met tout devant
            
            if(form) form.reset();
        } else {
            alert("Erreur : Fenêtre introuvable.");
        }
    };

    // Gestion de la fermeture (Nouveau bouton avec ID)
    const closeBtn = document.getElementById('close-contract-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('add-contract-modal');
            modal.classList.add('hidden');
            modal.style.display = 'none'; // On cache proprement
        });
    }

    // C. Créer un contrat
    if (contractForm) {
        contractForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = contractForm.querySelector('button[type="submit"]');
            const originalText = btn.textContent;
            btn.textContent = "Création...";
            btn.disabled = true;

            const payload = {
                identifier: document.getElementById('contract-user').value.trim(),
                target: parseInt(document.getElementById('contract-target').value),
                duration: parseInt(document.getElementById('contract-duration').value),
                reward: parseInt(document.getElementById('contract-reward').value)
            };

            try {
                const res = await fetch('/api/admin/contracts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                
                const json = await res.json();

                if (res.ok) {
                    alert("✅ " + json.message);
                    contractModal.classList.add('hidden');
                    fetchContracts();
                } else {
                    alert("❌ Erreur : " + json.message);
                }
            } catch (error) {
                alert("Erreur de connexion.");
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });
    }

    // D. Supprimer un contrat
    window.deleteContract = async (id) => {
        if(!confirm("Supprimer ce contrat ? L'ambassadeur ne verra plus sa progression.")) return;
        try {
            await fetch(`/api/admin/contracts/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            fetchContracts();
        } catch(e) { alert("Erreur suppression"); }
    };

    // --- INITIALISATION ---
    fetchPendingTransactions();
    fetchWithdrawals();
    loadConfiguration();
    fetchContracts(); 
});