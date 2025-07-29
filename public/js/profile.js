document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('atex-token');

    // --- SÉCURITÉ : Vérifier si l'utilisateur est connecté ---
    if (!token) {
        window.location.href = '/'; // Rediriger si non connecté
        return;
    }

    // --- SÉLECTION DES ÉLÉMENTS DU DOM ---
    const passwordForm = document.getElementById('change-password-form');
    const walletsForm = document.getElementById('wallets-form');
    const passwordFeedback = document.getElementById('password-feedback');
    const walletsFeedback = document.getElementById('wallets-feedback');

    const btcWalletInput = document.getElementById('btc-wallet');
    const usdtWalletInput = document.getElementById('usdt-wallet');

    // ==========================================================
    // 1. CHARGER LES DONNÉES EXISTANTES DE L'UTILISATEUR
    // ==========================================================

    // Fonction pour charger les adresses de portefeuille enregistrées
    const loadUserWallets = async () => {
        try {
            const response = await fetch('/api/user/wallets', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Erreur lors du chargement des portefeuilles.');
            
            const wallets = await response.json();
            if (btcWalletInput) btcWalletInput.value = wallets.btc || '';
            if (usdtWalletInput) usdtWalletInput.value = wallets.usdt_trc20 || '';

        } catch (error) {
            console.error(error);
            walletsFeedback.textContent = error.message;
            walletsFeedback.className = 'text-sm text-center h-4 text-red-500';
        }
    };

    // ==========================================================
    // 2. GESTION DES FORMULAIRES
    // ==========================================================

    // Gestion du formulaire de changement de mot de passe
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            passwordFeedback.textContent = 'Mise à jour...';
            passwordFeedback.className = 'text-sm text-center h-4 text-yellow-600';

            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            if (newPassword !== confirmPassword) {
                passwordFeedback.textContent = 'Les nouveaux mots de passe ne correspondent pas.';
                passwordFeedback.className = 'text-sm text-center h-4 text-red-500';
                return;
            }

            try {
                const response = await fetch('/api/user/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ currentPassword, newPassword })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.message);
                }
                
                passwordFeedback.textContent = result.message;
                passwordFeedback.className = 'text-sm text-center h-4 text-green-500';
                passwordForm.reset(); // Vider le formulaire

            } catch (error) {
                passwordFeedback.textContent = error.message;
                passwordFeedback.className = 'text-sm text-center h-4 text-red-500';
            }
        });
    }

    // Gestion du formulaire d'enregistrement des portefeuilles
    if (walletsForm) {
        walletsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            walletsFeedback.textContent = 'Enregistrement...';
            walletsFeedback.className = 'text-sm text-center h-4 text-yellow-600';
            
            try {
                const response = await fetch('/api/user/save-wallets', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        btcWallet: btcWalletInput.value,
                        usdtWallet: usdtWalletInput.value
                    })
                });

                const result = await response.json();
                 if (!response.ok) {
                    throw new Error(result.message);
                }

                walletsFeedback.textContent = result.message;
                walletsFeedback.className = 'text-sm text-center h-4 text-green-500';

            } catch (error) {
                walletsFeedback.textContent = error.message;
                walletsFeedback.className = 'text-sm text-center h-4 text-red-500';
            }
        });
    }
    
    // --- APPEL INITIAL ---
    // On charge les portefeuilles dès que la page est prête
    loadUserWallets();
});