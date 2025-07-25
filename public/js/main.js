document.addEventListener('DOMContentLoaded', async function() {
    // State global de l'application
    const state = {
        config: {},
        transaction: { type: 'buy' }
    };

    // --- DOM ELEMENTS ---
    const buyAmountInput = document.getElementById('buy-amount');
    const receiveAmountDisplay = document.getElementById('receive-amount');
    const cryptoSelectBuy = document.getElementById('crypto-select');
    const sellAmountInput = document.getElementById('sell-amount');
    const receiveAmountSellDisplay = document.getElementById('receive-amount-sell');
    const cryptoSelectSell = document.getElementById('crypto-select-sell');
    const sellCurrencySymbol = document.getElementById('sell-currency-symbol');
    const buyWalletAddressInput = document.getElementById('buy-wallet-address');
    const sellPhoneNumberInput = document.getElementById('sell-phone-number');
    const initiateBuyBtn = document.getElementById('initiate-buy-btn');
    const initiateSellBtn = document.getElementById('initiate-sell-btn');
    const header = document.getElementById('header');
    
    // === FONCTION POUR LES NOTIFICATIONS ===
    function showNotification(message, type = 'error') {
        const container = document.getElementById('notification-container');
        if (!container) return;

        const notif = document.createElement('div');
        const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';
        notif.className = `toast text-white py-2 px-4 rounded-lg shadow-lg ${bgColor}`;
        notif.textContent = message;
        
        container.appendChild(notif);

        setTimeout(() => {
            notif.classList.add('show');
        }, 10);

        setTimeout(() => {
            notif.classList.remove('show');
            notif.addEventListener('transitionend', () => notif.remove());
        }, 4000);
    }
    
    // === SECTION VALIDATION DES FORMULAIRES ===
    const errorMessages = {
        amount: "Veuillez entrer un montant valide.",
        wallet: "Adresse invalide (trop courte).",
        phone: "Numéro invalide."
    };

    function showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) errorElement.textContent = message;
    }

    function hideError(elementId) {
        const errorElement = document.getElementById(elementId);
        if (errorElement) errorElement.textContent = '';
    }

    function validateAmount(inputElement, errorElementId) {
        const value = parseFloat(inputElement.value);
        if (inputElement.value.trim() === '' || isNaN(value) || value <= 0) {
            showError(errorElementId, errorMessages.amount);
            return false;
        }
        hideError(errorElementId);
        return true;
    }

    function validateWalletAddress(inputElement, errorElementId) {
        if (inputElement.value.trim().length > 0 && inputElement.value.trim().length < 15) {
            showError(errorElementId, errorMessages.wallet);
            return false;
        }
        hideError(errorElementId);
        return true;
    }

    function validatePhoneNumber(inputElement, errorElementId) {
        const phoneRegex = /^\+?[0-9]{8,}$/;
        if (inputElement.value.trim().length > 0 && !phoneRegex.test(inputElement.value.trim())) {
            showError(errorElementId, errorMessages.phone);
            return false;
        }
        hideError(errorElementId);
        return true;
    }
    
    // --- LOGIQUE DE CHARGEMENT DES DONNÉES ---

    async function loadConfiguration() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            state.config = await response.json();
            initializeCalculators();
        } catch (error) {
            console.error("Impossible de charger la configuration:", error);
            document.getElementById('exchange').innerHTML = `<div class="p-4 text-center bg-red-100 text-red-700 rounded-lg">Erreur de connexion. Impossible de charger les taux.</div>`;
        }
    }

    async function loadPressArticles() {
        try {
            const response = await fetch('/api/press-articles');
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            const articles = await response.json();
            renderPressArticles(articles);
        } catch (error) {
            console.error("Impossible de charger les articles de presse:", error);
            document.getElementById('press-articles-container').innerHTML = `<div class="p-4 text-center bg-red-100 text-red-700 rounded-lg">Impossible de charger les articles.</div>`;
        }
    }

    async function loadKnowledgeArticles() {
        try {
            const response = await fetch('/api/knowledge-articles');
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            const articles = await response.json();
            renderKnowledgeArticles(articles);
        } catch (error) {
            console.error("Impossible de charger les articles de savoir:", error);
            document.getElementById('knowledge-articles-container').innerHTML = `<div class="p-4 text-center bg-red-100 text-red-700 rounded-lg">Impossible de charger les articles.</div>`;
        }
    }

    async function loadTestimonials() {
        try {
            const response = await fetch('/api/testimonials');
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            const testimonials = await response.json();
            renderTestimonials(testimonials);
        } catch (error) {
            console.error("Impossible de charger les témoignages:", error);
            document.getElementById('testimonials-container').innerHTML = `<div class="w-full p-4 text-center bg-red-100 text-red-700 rounded-lg">Impossible de charger les témoignages.</div>`;
        }
    }

    // --- LOGIQUE DE RENDU (RENDER) ---

    function renderTestimonials(testimonials) {
        const container = document.getElementById('testimonials-container');
        if (!container) return;
        
        if (!testimonials || testimonials.length === 0) {
            container.innerHTML = '<p class="w-full text-center text-warm-gray">Aucun témoignage pour le moment.</p>';
            return;
        }

        let html = '';
        testimonials.forEach(testimonial => {
            const imageUrl = testimonial.imageUrl || 'images/default-avatar.png';
            html += `
                <div class="testimonial-card flex-shrink-0 w-full p-8 bg-white rounded-2xl">
                    <div class="flex items-start mb-6">
                        <div class="w-16 h-16 rounded-full bg-gray-200 mr-4 overflow-hidden">
                            <img src="${imageUrl}" alt="${testimonial.name}" class="w-full h-full object-cover">
                        </div>
                        <div>
                            <h3 class="text-xl font-bold text-deep-night">${testimonial.name}</h3>
                            <p class="text-warm-gray">${testimonial.location}</p>
                        </div>
                    </div>
                    <p class="text-lg text-warm-gray italic">"${testimonial.quote}"</p>
                    <div class="mt-4 flex text-soft-gold">
                        <i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i><i class="fas fa-star"></i>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
        initializeTestimonialCarousel();
    }
    
    function calculateBuyAmount() {
        if (!state.config.rates) return;
        const amountFCFA = parseFloat(buyAmountInput.value) || 0;
        const crypto = cryptoSelectBuy.value;
        const finalCryptoAmount = (amountFCFA * (1 - state.config.feePercentage / 100)) * state.config.rates.buy[crypto];
        let precision;
        if (crypto === 'btc') precision = 8;
        else if (crypto === 'eth' || crypto === 'bnb') precision = 6;
        else precision = 4;
        receiveAmountDisplay.textContent = `${finalCryptoAmount.toFixed(precision)} ${crypto.toUpperCase()}`;
        state.transaction.amountToSend = amountFCFA;
        state.transaction.amountToReceive = finalCryptoAmount;
        state.transaction.currencyFrom = 'FCFA';
        state.transaction.currencyTo = crypto.toUpperCase();
    }
    
    function calculateSellAmount() {
        if (!state.config.rates) return;
        const amountCrypto = parseFloat(sellAmountInput.value) || 0;
        const crypto = cryptoSelectSell.value;
        const calculatedAmount = (amountCrypto * (1 - state.config.feePercentage / 100)) * state.config.rates.sell[crypto];
        sellCurrencySymbol.textContent = crypto.toUpperCase();
        receiveAmountSellDisplay.textContent = `${new Intl.NumberFormat('fr-FR').format(calculatedAmount.toFixed(0))} FCFA`;
        state.transaction.amountToSend = amountCrypto;
        state.transaction.amountToReceive = calculatedAmount;
        state.transaction.currencyFrom = crypto.toUpperCase();
        state.transaction.currencyTo = 'FCFA';
    }

    async function handleInitiateTransaction() {
        const currentType = state.transaction.type;
        const button = currentType === 'buy' ? initiateBuyBtn : initiateSellBtn;
        
        let isFormValid = true;
        let errorMessage = '';

        if (currentType === 'buy') {
            const isAmountValid = validateAmount(buyAmountInput, 'buy-amount-error');
            const isWalletValid = validateWalletAddress(buyWalletAddressInput, 'buy-wallet-error');
            if (!isAmountValid || !isWalletValid) {
                isFormValid = false;
                errorMessage = 'Veuillez corriger les erreurs dans le formulaire.';
            } else if (!state.transaction.paymentMethod) {
                isFormValid = false;
                errorMessage = 'Veuillez choisir un moyen de paiement.';
            }
        } else {
            const isAmountValid = validateAmount(sellAmountInput, 'sell-amount-error');
            const isPhoneValid = validatePhoneNumber(sellPhoneNumberInput, 'sell-phone-error');
            if (!isAmountValid || !isPhoneValid) {
                isFormValid = false;
                errorMessage = 'Veuillez corriger les erreurs dans le formulaire.';
            } else if (!state.transaction.paymentMethod) {
                isFormValid = false;
                errorMessage = 'Veuillez choisir un moyen de réception.';
            }
        }

        if (!isFormValid) {
            showNotification(errorMessage);
            return;
        }

        const originalButtonText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initialisation...';
        
        try {
            state.transaction.walletAddress = buyWalletAddressInput.value;
            state.transaction.phoneNumber = sellPhoneNumberInput.value;
            
            const response = await fetch('/api/initiate-transaction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.transaction)
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'La réponse du serveur n\'est pas OK');
            }
            window.location.href = result.whatsappUrl;
        } catch (error) {
            console.error('Erreur lors de l\'initiation de la transaction:', error);
            showNotification(`Une erreur est survenue : ${error.message}`);
        } finally {
            button.disabled = false;
            button.innerHTML = originalButtonText;
        }
    }

    function renderPressArticles(articles) {
        const container = document.getElementById('press-articles-container');
        if (!container) return;
        if (!articles || articles.length === 0) {
            container.innerHTML = '<p class="text-center text-warm-gray">Aucun article pour le moment.</p>';
            return;
        }

        const formatDate = (dateString) => {
            if (!dateString) return 'Date non disponible';
            return new Date(dateString).toLocaleDateString('fr-FR', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
        };

        const featuredArticle = articles[0];
        const otherArticles = articles.slice(1);
        let html = `
            <a href="${featuredArticle.url}" target="_blank" rel="noopener noreferrer" class="featured-article block bg-white rounded-2xl overflow-hidden relative" style="background-image: url('${featuredArticle.imageUrl || ''}'); background-size: cover; background-position: center;">
                <div class="absolute inset-0 bg-gradient-to-t from-deep-night to-transparent opacity-80 z-10"></div>
                <div class="absolute bottom-0 left-0 p-8 z-20">
                    <span class="bg-forest-green text-white text-sm font-medium px-3 py-1 rounded-full mb-3 inline-block">${featuredArticle.category || ''}</span>
                    <h3 class="text-3xl font-bold text-white mb-4">${featuredArticle.title}</h3>
                    <div class="flex items-center text-sm text-white">
                        <span>${formatDate(featuredArticle.publishedDate)}</span>
                        <span class="mx-2">•</span>
                        <span>${featuredArticle.readingTime || 'N/A'} min de lecture</span>
                    </div>
                </div>
            </a>
        `;
        if (otherArticles.length > 0) {
            html += '<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mt-12">';
            otherArticles.forEach(article => {
                html += `
                    <a href="${article.url}" target="_blank" rel="noopener noreferrer" class="article-card block bg-white rounded-2xl overflow-hidden">
                        <div class="h-48 bg-gray-300" style="background-image: url('${article.imageUrl || ''}'); background-size: cover; background-position: center;"></div>
                        <div class="p-6">
                            <span class="text-sm font-semibold text-soft-gold mb-2 block">${article.category || ''}</span>
                            <h3 class="text-xl font-bold text-deep-night mb-3">${article.title}</h3>
                            <p class="text-warm-gray mb-4 text-sm">${article.excerpt || ''}</p>
                            <div class="flex items-center text-xs text-warm-gray">
                                <span>${formatDate(article.publishedDate)}</span>
                                <span class="mx-2">•</span>
                                <span>${article.readingTime || 'N/A'} min de lecture</span>
                            </div>
                        </div>
                    </a>
                `;
            });
            html += '</div>';
        }
        container.innerHTML = html;
    }

    function renderKnowledgeArticles(articles) {
        const container = document.getElementById('knowledge-articles-container');
        if (!container) return;
        if (!articles || articles.length === 0) {
            container.innerHTML = '<p class="text-center text-warm-gray md:col-span-2">Aucun article pour le moment.</p>';
            return;
        }

        const blocksToHtml = (blocks) => {
            if (!blocks) return '';
            return blocks
                .filter(block => block._type === 'block' && block.children)
                .map(block => {
                    const childrenText = block.children.map(child => child.text).join('');
                    return `<p>${childrenText}</p>`;
                })
                .join('');
        };
        let html = '';
        articles.forEach(article => {
            html += `
                <div class="bg-white rounded-2xl p-8">
                    <div class="flex items-center mb-6">
                        <div class="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center mr-4">
                            <i class="fas ${article.iconClass || 'fa-book'} text-soft-gold text-xl"></i>
                        </div>
                        <h3 class="text-2xl font-bold text-deep-night">${article.title}</h3>
                    </div>
                    <div class="text-warm-gray space-y-4">
                        ${blocksToHtml(article.content)}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    // --- INITIALISATION & GESTION DE L'UI ---
    function initializeCalculators() {
        buyAmountInput.addEventListener('input', () => validateAmount(buyAmountInput, 'buy-amount-error'));
        buyWalletAddressInput.addEventListener('input', () => validateWalletAddress(buyWalletAddressInput, 'buy-wallet-error'));
        sellAmountInput.addEventListener('input', () => validateAmount(sellAmountInput, 'sell-amount-error'));
        sellPhoneNumberInput.addEventListener('input', () => validatePhoneNumber(sellPhoneNumberInput, 'sell-phone-error'));
        
        buyAmountInput.addEventListener('input', calculateBuyAmount);
        cryptoSelectBuy.addEventListener('change', calculateBuyAmount);
        sellAmountInput.addEventListener('input', calculateSellAmount);
        cryptoSelectSell.addEventListener('change', calculateSellAmount);
        calculateBuyAmount();
        calculateSellAmount();
    }

    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) header.classList.add('header-blur', 'bg-white', 'bg-opacity-80', 'shadow-sm');
        else header.classList.remove('header-blur', 'bg-white', 'bg-opacity-80', 'shadow-sm');
    });

    document.querySelectorAll('.nav-link, #mobile-menu a').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('main > section').forEach(section => {
                if (!section.classList.contains('hidden')) section.classList.add('hidden');
            });
            const sectionId = this.dataset.section;
            const targetSection = document.getElementById(sectionId);
            if (targetSection) targetSection.classList.remove('hidden');
            const mobileMenu = document.getElementById('mobile-menu');
            if (mobileMenu.classList.contains('open')) mobileMenu.classList.remove('open');
        });
    });

    const buyTab = document.getElementById('buy-tab');
    const sellTab = document.getElementById('sell-tab');
    buyTab.addEventListener('click', () => switchTab('buy'));
    sellTab.addEventListener('click', () => switchTab('sell'));
    
    function switchTab(tabName) {
        state.transaction.type = tabName;
        const buyFlow = document.getElementById('buy-flow');
        const sellFlow = document.getElementById('sell-flow');
        if (tabName === 'buy') {
            buyFlow.classList.remove('hidden'); sellFlow.classList.add('hidden');
            buyTab.classList.add('tab-active', 'text-deep-night'); buyTab.classList.remove('text-warm-gray');
            sellTab.classList.remove('tab-active', 'text-deep-night'); sellTab.classList.add('text-warm-gray');
        } else {
            sellFlow.classList.remove('hidden'); buyFlow.classList.add('hidden');
            sellTab.classList.add('tab-active', 'text-deep-night'); sellTab.classList.remove('text-warm-gray');
            buyTab.classList.remove('tab-active', 'text-deep-night'); buyTab.classList.add('text-warm-gray');
        }
    }

    function setupStepNavigation(step1BtnId, backBtnId, step1Id, step2Id) {
        const step1Btn = document.getElementById(step1BtnId);
        const backBtn = document.getElementById(backBtnId);
        const step1 = document.getElementById(step1Id);
        const step2 = document.getElementById(step2Id);
        if(step1Btn && backBtn) {
            step1Btn.addEventListener('click', () => { step1.classList.add('hidden'); step2.classList.remove('hidden'); });
            backBtn.addEventListener('click', () => { step2.classList.add('hidden'); step1.classList.remove('hidden'); });
        }
    }
    setupStepNavigation('buy-step1-btn', 'back-buy-btn', 'step1-buy', 'step2-buy');
    setupStepNavigation('sell-step1-btn', 'back-sell-btn', 'step1-sell', 'step2-sell');

    document.querySelectorAll('.payment-option').forEach(option => {
        option.addEventListener('click', function() {
            this.closest('.grid').querySelectorAll('.payment-option').forEach(el => el.classList.remove('border-soft-gold', 'border-2'));
            this.classList.add('border-soft-gold', 'border-2');
            state.transaction.paymentMethod = this.dataset.payment;
        });
    });

    initiateBuyBtn.addEventListener('click', handleInitiateTransaction);
    initiateSellBtn.addEventListener('click', handleInitiateTransaction);

    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const closeMenuButton = document.getElementById('close-menu');
    const mobileMenu = document.getElementById('mobile-menu');
    mobileMenuButton.addEventListener('click', () => mobileMenu.classList.add('open'));
    closeMenuButton.addEventListener('click', () => mobileMenu.classList.remove('open'));

    function initializeTestimonialCarousel() {
        const testimonialsContainer = document.getElementById('testimonials-container');
        const testimonialPrev = document.getElementById('testimonial-prev');
        const testimonialNext = document.getElementById('testimonial-next');
        if (!testimonialsContainer || !testimonialPrev || !testimonialNext || testimonialsContainer.children.length === 0) {
            if (testimonialsContainer && testimonialsContainer.children.length <= 1) {
                if(testimonialPrev) testimonialPrev.style.display = 'none';
                if(testimonialNext) testimonialNext.style.display = 'none';
            }
            return;
        }

        if(testimonialPrev) testimonialPrev.style.display = 'flex';
        if(testimonialNext) testimonialNext.style.display = 'flex';
        
        let currentTestimonial = 0;
        const testimonialCount = testimonialsContainer.children.length;

        testimonialNext.addEventListener('click', () => {
            currentTestimonial = (currentTestimonial + 1) % testimonialCount;
            testimonialsContainer.style.transform = `translateX(-${currentTestimonial * 100}%)`;
        });
        testimonialPrev.addEventListener('click', () => {
            currentTestimonial = (currentTestimonial - 1 + testimonialCount) % testimonialCount;
            testimonialsContainer.style.transform = `translateX(-${currentTestimonial * 100}%)`;
        });
    }

    const authModal = document.getElementById('auth-modal');
    if (authModal) {
        document.querySelectorAll('#auth-button, #mobile-auth-button, #cta-button, .open-auth-modal').forEach(btn => btn.addEventListener('click', () => authModal.classList.remove('hidden')));
        document.getElementById('close-modal').addEventListener('click', () => authModal.classList.add('hidden'));
        authModal.addEventListener('click', e => { if (e.target === authModal) authModal.classList.add('hidden'); });
        const signupTab = document.getElementById('signup-tab');
        const loginTab = document.getElementById('login-tab');
        signupTab.addEventListener('click', () => {
            signupTab.classList.add('tab-active', 'text-deep-night');
            loginTab.classList.remove('tab-active', 'text-deep-night');
            document.getElementById('signup-form').classList.remove('hidden'); 
            document.getElementById('login-form').classList.add('hidden');
        });
        loginTab.addEventListener('click', () => {
            loginTab.classList.add('tab-active', 'text-deep-night');
            signupTab.classList.remove('tab-active', 'text-deep-night');
            document.getElementById('login-form').classList.remove('hidden'); 
            document.getElementById('signup-form').classList.add('hidden');
        });
    }

    // NOUVELLE LOGIQUE POUR L'ACCORDÉON FAQ
    function initializeFaqAccordion() {
        const accordion = document.getElementById('faq-accordion');
        if (!accordion) return;

        const questions = accordion.querySelectorAll('.faq-question');

        questions.forEach(question => {
            question.addEventListener('click', () => {
                const answer = question.nextElementSibling;

                // Fermer les autres questions ouvertes (optionnel, pour un accordéon simple)
                questions.forEach(q => {
                    if (q !== question) {
                        q.classList.remove('active');
                        q.nextElementSibling.classList.remove('open');
                    }
                });

                // Ouvrir/fermer la question cliquée
                question.classList.toggle('active');
                answer.classList.toggle('open');
            });
        });
    }


    // --- DÉMARRAGE DE L'APPLICATION ---
    loadConfiguration();
    loadPressArticles();
    loadKnowledgeArticles();
    loadTestimonials();
    initializeFaqAccordion(); // On initialise la nouvelle fonctionnalité
});