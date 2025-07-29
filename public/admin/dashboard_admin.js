document.addEventListener('DOMContentLoaded', () => {
    // --- SÉLECTION DES ÉLÉMENTS DU DOM ---
    const dashboardContent = document.getElementById('dashboard-content');
    const token = localStorage.getItem('adminToken');

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
    // SECTION : LOGIQUE DES TRANSACTIONS (INCHANGÉE)
    // ===============================================
    const renderTransactions = (transactions) => {
        dashboardContent.innerHTML = '<h2 class="text-xl font-semibold mb-4">Transactions en attente</h2>';
        if (!transactions || transactions.length === 0) {
            dashboardContent.innerHTML += '<p>Aucune transaction en attente pour le moment.</p>';
            return;
        }
        const transactionList = document.createElement('div');
        transactionList.className = 'space-y-4';
        transactions.forEach(tx => {
            if (!tx || !tx.type) { 
                console.warn("Transaction malformée ignorée:", tx);
                return;
            }
            const date = new Date(tx.createdAt._seconds * 1000).toLocaleString('fr-FR');
            const typeClass = tx.type === 'buy' ? 'text-green-400' : 'text-yellow-400';
            const card = document.createElement('div');
            card.className = 'bg-gray-700 p-4 rounded-lg flex justify-between items-center';
            card.innerHTML = `
                <div>
                    <p class="font-bold text-lg ${typeClass}">${tx.type === 'buy' ? 'Achat' : 'Vente'} - ${tx.amountToSend} ${tx.currencyFrom}</p>
                    <p class="text-sm text-gray-400">Date : ${date}</p>
                    <p class="text-sm text-gray-400">ID Utilisateur : ${tx.userId || 'Non connecté'}</p>
                </div>
                <div class.flex space-x-2">
                    <button class="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded text-sm" data-id="${tx.id}" data-action="completed">Terminé</button>
                    <button class="bg-gray-600 hover:bg-gray-500 text-white font-bold py-1 px-3 rounded text-sm" data-id="${tx.id}" data-action="cancelled">Annulé</button>
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
            if (!response.ok) throw new Error('La mise à jour a échoué.');
            fetchPendingTransactions();
        } catch (error) {
            console.error('Erreur lors de la mise à jour:', error);
            alert('La mise à jour a échoué.');
        }
    };
    
    const fetchPendingTransactions = async () => {
        try {
            const response = await fetch('/api/admin/transactions/pending', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des transactions.');
            }
            const transactions = await response.json();
            renderTransactions(transactions);
        } catch (error) {
            console.error('Erreur dans fetchPendingTransactions:', error);
            dashboardContent.innerHTML = `<p class="text-red-500">Impossible de charger les transactions.</p>`;
        }
    };

    dashboardContent.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action) {
            updateTransactionStatus(e.target.dataset.id, action);
        }
    });

    // =========================================================
    // SECTION MISE À JOUR : LOGIQUE DE LA TARIFICATION DE RÉFÉRENCE
    // =========================================================
    const pricingForm = document.getElementById('pricing-form');
    const pricingFeedback = document.getElementById('pricing-feedback');
    const allCryptos = ['usdt', 'btc', 'eth', 'bnb', 'trx', 'xrp']; 

    // Fonction pour charger les prix et remplir le formulaire
    const fetchAndDisplayManualPrice = async () => {
        try {
            const response = await fetch('/api/admin/pricing/manual', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!response.ok) throw new Error('Erreur de récupération des prix.');
            
            const data = await response.json();
            const usdtPrices = data.usdt_base_prices_xof || {};
            const cryptoPrices = data.crypto_prices_usdt || {};

            // Remplir les prix de l'USDT en FCFA
            document.getElementById('usdt-buy-price').value = usdtPrices.buy || '';
            document.getElementById('usdt-sell-price').value = usdtPrices.sell || '';

            // Remplir les prix des autres cryptos en USDT
            for (const crypto of allCryptos) {
                if (crypto === 'usdt') continue; // On saute l'USDT ici
                const buyInput = document.getElementById(`${crypto}-buy-price`);
                const sellInput = document.getElementById(`${crypto}-sell-price`);
                if (cryptoPrices[crypto]) {
                    if (buyInput) buyInput.value = cryptoPrices[crypto].buy || '';
                    if (sellInput) sellInput.value = cryptoPrices[crypto].sell || '';
                }
            }
        } catch (error) {
            pricingFeedback.textContent = 'Erreur de chargement des prix.';
            pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-red-500';
        }
    };

    // Écouteur pour la soumission du nouveau formulaire de prix
    pricingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        pricingFeedback.textContent = 'Enregistrement...';
        pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-yellow-400';
        
        const bodyData = {};
        // On récupère les valeurs de tous les champs
        for (const crypto of allCryptos) {
            const buyInput = document.getElementById(`${crypto}-buy-price`);
            const sellInput = document.getElementById(`${crypto}-sell-price`);
            if (buyInput) bodyData[`${crypto}-buy-price`] = buyInput.value;
            if (sellInput) bodyData[`${crypto}-sell-price`] = sellInput.value;
        }

        try {
            const response = await fetch('/api/admin/pricing/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(bodyData)
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'Une erreur est survenue.');
            }
            pricingFeedback.textContent = result.message;
            pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-green-500';

        } catch (error) {
            pricingFeedback.textContent = error.message;
            pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-red-500';
        }
    });

    // --- LANCEMENT INITIAL DES FONCTIONS ---
    fetchPendingTransactions();
    fetchAndDisplayManualPrice();
});