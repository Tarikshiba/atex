document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('atex-token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    const kycSection = document.getElementById('kyc-section');
    const kycForm = document.getElementById('kyc-form');
    const requestButton = document.getElementById('request-kyc-button');
    const buttonText = document.getElementById('button-text');
    const buttonSpinner = document.getElementById('button-spinner');
    const feedbackP = document.getElementById('kyc-feedback');

    const updateUIWithStatus = (status) => {
        if (status === 'submitted') {
            kycSection.innerHTML = `
                <div class="text-center">
                    <h2 class="text-2xl font-semibold text-deep-night mb-4">Demande en cours</h2>
                    <p class="text-gray-600">Votre demande de vérification est en cours de traitement. Notre équipe vous contactera par email très prochainement si des informations supplémentaires sont nécessaires.</p>
                </div>
            `;
        } else if (status === 'verified') {
            kycSection.innerHTML = `
                <div class="text-center">
                    <h2 class="text-2xl font-semibold text-green-600 mb-4">✅ Compte Vérifié</h2>
                    <p class="text-gray-600">Félicitations ! Votre compte est vérifié. Votre limite de vente mensuelle a été augmentée.</p>
                </div>
            `;
        }
    };

    const loadKycStatus = async () => {
        try {
            const response = await fetch('/api/user/kyc-status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            updateUIWithStatus(data.status);
        } catch (error) {
            console.error("Erreur de chargement du statut KYC:", error);
        }
    };

    if (kycForm) {
        kycForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            buttonText.textContent = 'Envoi en cours...';
            buttonSpinner.classList.remove('hidden');
            requestButton.disabled = true;
            feedbackP.textContent = '';

            // Création d'un objet FormData pour envoyer les fichiers
            const formData = new FormData();
            formData.append('firstName', document.getElementById('firstName').value);
            formData.append('lastName', document.getElementById('lastName').value);
            formData.append('docRecto', document.getElementById('docRecto').files[0]);
            formData.append('docVerso', document.getElementById('docVerso').files[0]);
            formData.append('selfie', document.getElementById('selfie').files[0]);
            
            try {
                const response = await fetch('/api/user/kyc-request', {
                    method: 'POST',
                    headers: {
                        // PAS de 'Content-Type', le navigateur le mettra pour nous avec FormData
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message);
                }

                updateUIWithStatus('submitted');

            } catch (error) {
                feedbackP.textContent = error.message;
                feedbackP.className = 'text-sm text-center h-4 mt-4 text-red-500';
                buttonText.textContent = 'Soumettre ma demande';
                buttonSpinner.classList.add('hidden');
                requestButton.disabled = false;
            }
        });
    }

    loadKycStatus();
});