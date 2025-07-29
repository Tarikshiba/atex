document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('admin-login-form');
    const errorMessage = document.getElementById('error-message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = ''; // Réinitialiser le message d'erreur

        const email = form.email.value;
        const password = form.password.value;

        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                // Si le statut HTTP n'est pas 2xx, on lance une erreur avec le message du serveur
                throw new Error(data.message || 'Une erreur est survenue.');
            }
            
            // Connexion réussie
            console.log('Connexion admin réussie. Token reçu.');
            localStorage.setItem('adminToken', data.token); // On stocke le token sous un nom différent
            
            // Redirection vers le tableau de bord admin (que nous créerons ensuite)
            window.location.href = '/admin/dashboard.html';

        } catch (error) {
            console.error('Erreur lors de la connexion admin:', error);
            errorMessage.textContent = error.message;
        }
    });
});