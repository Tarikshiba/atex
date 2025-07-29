document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('atex-token');
    const historyContainer = document.getElementById('transaction-history');
    const welcomeText = document.getElementById('welcome-text');
    const verifiedBadge = document.getElementById('verified-badge');

    if (!token) {
        window.location.href = '/';
        return;
    }

    const renderVolumeProgress = (volumeData, userData) => {
        const currentVolumeSpan = document.getElementById('current-volume');
        const progressBar = document.getElementById('progress-bar');
        const volumeLimitSpan = document.getElementById('volume-limit');
        
        const isVerified = userData && userData.kyc_status === 'verified';
        const limit = isVerified ? 50000000 : 100000;
        const currentVolume = volumeData.monthlyVolume || 0;

        const percentage = (currentVolume / limit) * 100;
        // CORRECTION : On affiche une largeur minimale pour les petits pourcentages
        const displayWidth = (percentage > 0 && percentage < 1) ? 1 : Math.min(percentage, 100);
        const displayPercentage = percentage.toFixed(2); // On affiche un pourcentage plus précis

        currentVolumeSpan.textContent = `${Math.round(currentVolume).toLocaleString('fr-FR')} FCFA`;
        volumeLimitSpan.textContent = `${limit.toLocaleString('fr-FR')} FCFA`;
        progressBar.style.width = `${displayWidth}%`;
        progressBar.textContent = `${displayPercentage}%`;

        if (percentage > 90) {
            progressBar.classList.remove('bg-teal-500');
            progressBar.classList.add('bg-red-500');
        } else {
            progressBar.classList.add('bg-teal-500');
            progressBar.classList.remove('bg-red-500');
        }
    };
    
    const renderTransactions = (transactions) => {
        if (!transactions || transactions.length === 0) {
            historyContainer.innerHTML = '<p class="text-warm-gray">Vous n\'avez aucune transaction pour le moment.</p>';
            return;
        }
        let tableHTML = `
            <div class="overflow-x-auto"><table class="table-auto border-collapse w-full"><thead class="thead-light"><tr>
            <th class="px-4 py-2 text-left">Date</th><th class="px-4 py-2 text-left">Type</th>
            <th class="px-4 py-2 text-left">Détail</th><th class="px-4 py-2 text-left">Statut</th>
            </tr></thead><tbody>`;
        transactions.forEach(tx => {
            const date = new Date(tx.createdAt._seconds * 1000).toLocaleDateString('fr-FR');
            const type = tx.type === 'buy' ? '<span class="font-semibold text-green-600">Achat</span>' : '<span class="font-semibold text-red-600">Vente</span>';
            const detail = tx.type === 'buy' ? `${tx.amountToSend} FCFA → ${Number(tx.amountToReceive).toFixed(4)} ${tx.currencyTo}` : `${tx.amountToSend} ${tx.currencyFrom} → ${Math.round(tx.amountToReceive)} FCFA`;
            let statusBadge = '';
            const statusText = tx.status || 'pending';
            switch (statusText.toLowerCase()) {
                case 'completed': case 'terminé': case 'validé': case 'termine':
                    statusBadge = `<span class="bg-green-200 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full capitalize">${statusText}</span>`; break;
                case 'cancelled': case 'annulé':
                    statusBadge = `<span class="bg-red-200 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full capitalize">${statusText}</span>`; break;
                case 'pending': default:
                    statusBadge = `<span class="bg-yellow-200 text-yellow-800 text-xs font-medium px-2.5 py-0.5 rounded-full capitalize">${statusText}</span>`; break;
            }
            tableHTML += `<tr class="border-b"><td class="px-4 py-3">${date}</td><td class="px-4 py-3">${type}</td><td class="px-4 py-3">${detail}</td><td class="px-4 py-3">${statusBadge}</td></tr>`;
        });
        tableHTML += '</tbody></table></div>';
        historyContainer.innerHTML = tableHTML;
    };

    try {
        const [userResponse, transactionsResponse, volumeResponse] = await Promise.all([
            fetch('/api/user/me', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/user/transactions', { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch('/api/user/transaction-volume', { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if ([userResponse, transactionsResponse, volumeResponse].some(res => res.status === 401 || res.status === 403)) {
            localStorage.removeItem('atex-token');
            window.location.href = '/';
            return;
        }
        const userData = userResponse.ok ? await userResponse.json() : null;
        const transactions = transactionsResponse.ok ? await transactionsResponse.json() : [];
        const volumeData = volumeResponse.ok ? await volumeResponse.json() : { monthlyVolume: 0 };
        
        if (userData && welcomeText) {
            // CORRECTION : On cible le span dédié au texte
            welcomeText.textContent = `Bienvenue, ${userData.username} !`;
            if (userData.kyc_status === 'verified' && verifiedBadge) {
                verifiedBadge.classList.remove('hidden');
            }
        }
        renderVolumeProgress(volumeData, userData);
        renderTransactions(transactions);
    } catch (error) {
        console.error("Erreur lors du chargement des données du dashboard:", error);
        historyContainer.innerHTML = `<p class="text-red-500">Une erreur est survenue.</p>`;
    }

    const logoutButton = document.getElementById('logout-button');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            localStorage.removeItem('atex-token');
            window.location.href = '/';
        });
    }
});