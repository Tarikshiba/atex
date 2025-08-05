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
// SECTION : LOGIQUE DE LA TARIFICATION (V4 - Taux de change)
// =========================================================
const pricingForm = document.getElementById('pricing-form');
const pricingFeedback = document.getElementById('pricing-feedback');
// La liste des cryptos que nous gérons
const allCryptos = ['usdt', 'btc', 'eth', 'bnb', 'trx', 'xrp', 'usdt_bep20', 'btc_bep20', 'matic', 'ton']; 

// Fonction pour charger les taux actuels et remplir le formulaire
const fetchAndDisplayRates = async () => {
    try {
        // On appelle la nouvelle route pour récupérer les taux
        const response = await fetch('/api/admin/pricing/rates', { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        
        if (!response.ok) {
            // Si le document n'existe pas encore, l'API peut renvoyer 200 avec un objet vide,
            // ce qui n'est pas une erreur, donc on ne lève pas d'erreur ici.
            // On gère les erreurs serveur (500) ou d'authentification (401, 403).
            if (response.status >= 400) {
                 throw new Error('Erreur de récupération des taux.');
            }
        }
        
        const data = await response.json();
        const rates = data.rates || {}; // On s'assure que rates est un objet

        // Remplir le formulaire avec les taux récupérés
        for (const crypto of allCryptos) {
            const buyInput = document.getElementById(`${crypto}-buy-rate`);
            const sellInput = document.getElementById(`${crypto}-sell-rate`);
            
            if (rates[crypto]) {
                if (buyInput) buyInput.value = rates[crypto].buy || '';
                if (sellInput) sellInput.value = rates[crypto].sell || '';
            }
        }
    } catch (error) {
        pricingFeedback.textContent = 'Erreur de chargement des taux.';
        pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-red-500';
    }
};

// Écouteur pour la soumission du formulaire des nouveaux taux
pricingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pricingFeedback.textContent = 'Enregistrement...';
    pricingFeedback.className = 'mt-3 text-center text-sm h-4 text-yellow-400';
    
    const bodyData = {};
    // On récupère les valeurs de tous les champs avec les nouveaux IDs
    for (const crypto of allCryptos) {
        const buyInput = document.getElementById(`${crypto}-buy-rate`);
        const sellInput = document.getElementById(`${crypto}-sell-rate`);
        
        // La clé doit correspondre à ce que le backend attend (ex: 'btc-buy-rate')
        if (buyInput) bodyData[buyInput.name] = buyInput.value;
        if (sellInput) bodyData[sellInput.name] = sellInput.value;
    }

    try {
        // On poste les données vers la nouvelle route
        const response = await fetch('/api/admin/pricing/rates', {
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
fetchAndDisplayRates(); // On appelle la nouvelle fonction de chargement
});