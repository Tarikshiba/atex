document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('atex-token');
    const historyContainer = document.getElementById('transaction-history');
    const welcomeMessageContainer = document.getElementById('welcome-message'); // On cible le conteneur du message

    // 1. Sécurité : si pas de token, on redirige vers l'accueil
    if (!token) {
        window.location.href = '/';
        return;
    }

    // 2. Fonction pour afficher les transactions dans un tableau
    const renderTransactions = (transactions) => {
        if (!transactions || transactions.length === 0) {
            historyContainer.innerHTML = '<p class="text-warm-gray">Vous n\'avez aucune transaction pour le moment.</p>';
            return;
        }

        let tableHTML = `
            <div class="overflow-x-auto">
                <table class="table-auto border-collapse w-full">
                    <thead class="thead-light">
                        <tr>
                            <th class="px-4 py-2 text-left">Date</th>
                            <th class="px-4 py-2 text-left">Type</th>
                            <th class="px-4 py-2 text-left">Détail</th>
                            <th class="px-4 py-2 text-left">Statut</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        transactions.forEach(tx => {
            const date = new Date(tx.createdAt._seconds * 1000).toLocaleDateString('fr-FR');
            const type = tx.type === 'buy' ? 
                '<span class="font-semibold text-green-600">Achat</span>' : 
                '<span class="font-semibold text-red-600">Vente</span>';
            
            const detail = tx.type === 'buy' ? 
                `${tx.amountToSend} FCFA → ${Number(tx.amountToReceive).toFixed(4)} ${tx.currencyTo}` :
                `${tx.amountToSend} ${tx.currencyFrom} → ${Math.round(tx.amountToReceive)} FCFA`;
            
            let statusBadge = '';
            const statusText = tx.status || 'pending';
            switch (statusText.toLowerCase()) {
                case 'terminé':
                case 'validé':
                case 'termine':
                    statusBadge = `<span class="bg-green-200 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full">${statusText}</span>`;
                    break;
                case 'annulé':
                    statusBadge = `<span class="bg-red-200 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">${statusText}</span>`;
                    break;
                default: // 'pending' ou autre
                    statusBadge = `<span class="bg-yellow-200 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded-full">${statusText}</span>`;
            }

            tableHTML += `
                <tr class="border-b">
                    <td class="px-4 py-3">${date}</td>
                    <td class="px-4 py-3">${type}</td>
                    <td class="px-4 py-3">${detail}</td>
                    <td class="px-4 py-3">${statusBadge}</td>
                </tr>
            `;
        });

        tableHTML += '</tbody></table></div>';
        historyContainer.innerHTML = tableHTML;
    };

    // 3. Appeler nos API sécurisées en parallèle
    try {
        const [userResponse, transactionsResponse] = await Promise.all([
            fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/user/transactions', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        // Gérer les erreurs de token (si l'un ou l'autre échoue)
        if (userResponse.status === 401 || userResponse.status === 403 || transactionsResponse.status === 401 || transactionsResponse.status === 403) {
            localStorage.removeItem('atex-token');
            window.location.href = '/';
            return;
        }

        // Traiter les données de l'utilisateur
        if (userResponse.ok) {
            const userData = await userResponse.json();
            if (welcomeMessageContainer) {
                welcomeMessageContainer.textContent = `Bienvenue, ${userData.username} !`;
            }
        } else {
            console.error('Erreur lors du chargement des infos utilisateur.');
        }

        // Traiter l'historique des transactions
        if (transactionsResponse.ok) {
            const transactions = await transactionsResponse.json();
            renderTransactions(transactions);
        } else {
            throw new Error('Erreur lors du chargement de l\'historique.');
        }

    } catch (error) {
        historyContainer.innerHTML = `<p class="text-red-500">${error.message}</p>`;
    }


    // --- Logique de Déconnexion ---
    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            // On supprime le token
            localStorage.removeItem('atex-token');
            // On redirige vers la page d'accueil
            window.location.href = '/';
        });
    }

}); // C'est la dernière ligne de ton fichier