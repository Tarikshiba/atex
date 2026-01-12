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
    // SECTION 2 & 3 : GESTION DYNAMIQUE CRYPTOS & TAUX (NOUVEAU)
    // =========================================================

   // A. Charger la configuration complète
    async function loadConfiguration() {
        try {
            // 0. CHARGER LES PARAMÈTRES GÉNÉRAUX (NOUVEAU)
            const settingsRes = await fetch('/api/settings'); // Route publique (ou admin, ici publique suffit)
            const settings = await settingsRes.json();
            
            // Appliquer aux inputs
            maintenanceToggle.checked = settings.maintenance_mode || false;
            referralToggle.checked = settings.referral_active !== false; // Actif par défaut si undefined
            referralTextInput.value = settings.referral_text || '';

            // 1. Charger la liste des cryptos
            const cryptoRes = await fetch('/api/admin/cryptos', { headers: { 'Authorization': `Bearer ${token}` }});
            activeCryptos = await cryptoRes.json();
            
            // 2. Charger les taux
            const ratesRes = await fetch('/api/admin/pricing/rates', { headers: { 'Authorization': `Bearer ${token}` }});
            const ratesData = await ratesRes.json();
            const currentRates = ratesData.rates || {};

            renderCryptoList();
            renderRatesForm(currentRates);
            
        } catch (error) {
            console.error("Erreur chargement config:", error);
        }
    }

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
    
    // 1. Ouvrir en mode AJOUT
    window.openAddModal = () => {
        document.getElementById('add-crypto-form').reset(); // Vider le formulaire
        document.getElementById('modal-title').textContent = "Ajouter une Crypto";
        document.getElementById('new-id').disabled = false; // L'ID est modifiable
        document.getElementById('new-id').classList.remove('bg-gray-700', 'cursor-not-allowed');
        document.getElementById('add-crypto-modal').classList.remove('hidden');
    };

    // 2. Ouvrir en mode MODIFICATION
    window.editCrypto = (id) => {
        const crypto = activeCryptos.find(c => c.id === id);
        if (!crypto) return;

        // Remplir les champs
        document.getElementById('new-id').value = crypto.id;
        document.getElementById('new-name').value = crypto.name;
        document.getElementById('new-symbol').value = crypto.symbol;
        document.getElementById('new-network').value = crypto.network;
        document.getElementById('new-wallet').value = crypto.walletAddress;
        document.getElementById('new-market-key').value = crypto.marketKey || '';
        document.getElementById('new-min-buy').value = crypto.minBuy || '';
        document.getElementById('new-min-sell').value = crypto.minSell || '';

        // UI : Bloquer l'ID (car c'est la clé primaire, on ne peut pas la changer sinon ça crée un doublon)
        const idInput = document.getElementById('new-id');
        idInput.disabled = true; 
        idInput.classList.add('bg-gray-700', 'cursor-not-allowed');

        // Changer le titre
        document.getElementById('modal-title').textContent = `Modifier ${crypto.name}`;
        
        // Afficher
        document.getElementById('add-crypto-modal').classList.remove('hidden');
    };

    // C. Afficher le formulaire des taux (généré dynamiquement)
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
        
        // On récupère les valeurs
        const symbol = document.getElementById('new-symbol').value.toUpperCase();
        
        const newCrypto = {
            id: document.getElementById('new-id').value.trim(),
            name: document.getElementById('new-name').value.trim(),
            symbol: symbol,
            network: document.getElementById('new-network').value.trim(),
            walletAddress: document.getElementById('new-wallet').value.trim(),
            // Si la clé marché est vide, on utilise le symbole en minuscule (ex: usdt)
            marketKey: (document.getElementById('new-market-key').value.trim() || symbol).toLowerCase(),
            
            // NOUVEAU : LIMITES
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
                loadConfiguration(); // Recharger la vue
            } else {
                alert("Erreur lors de l'ajout. Vérifiez les champs.");
            }
        } catch (error) {
            console.error(error);
        }
    });

    // E. Supprimer une Crypto (Appel API) - Fonction attachée à window pour être accessible dans le HTML
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
        const rates = {};
        
        // On reconstruit l'objet à plat
        // Le serveur attend { "usdt-buy-rate": 650, ... } mais l'ancien code reconstruisait un objet.
        // Adapté au nouveau server.js qui attend un objet plat dans req.body pour la boucle
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

    // G. SAUVEGARDER LES PARAMÈTRES GÉNÉRAUX
    if(settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = settingsForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = "Sauvegarde...";
            submitBtn.disabled = true;

            // Logique intelligente : Si on active le parrainage, on demande si c'est une nouvelle saison
            let startNewCampaign = false;
            if (referralToggle.checked) {
                 // Petite confirmation JS simple
                 startNewCampaign = confirm("Voulez-vous lancer une NOUVELLE CAMPAGNE (Saison) ?\n\n- OK : Oui, générer de nouveaux liens (les anciens expirent).\n- ANNULER : Non, garder la campagne actuelle.");
            }

            const settingsData = {
                maintenance_mode: maintenanceToggle.checked,
                referral_active: referralToggle.checked,
                referral_text: referralTextInput.value.trim(),
                new_campaign: startNewCampaign // On envoie l'info au serveur
            };

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(settingsData)
                });

                if (res.ok) {
                    alert("✅ Paramètres mis à jour !");
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
    
    // --- INITIALISATION ---
    fetchPendingTransactions();
    loadConfiguration();
});