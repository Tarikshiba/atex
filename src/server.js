// Importer les dépendances nécessaires
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@sanity/client');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// --- CONFIGURATION DE FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- NOUVELLE CONFIGURATION DES SERVICES EXTERNES ---
// Cloudinary
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});
// Multer (pour gérer les uploads en mémoire)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
// Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);


// --- FONCTION HELPER POUR CALCULER LE VOLUME MENSUEL DE VENTE ---
async function calculateUserMonthlyVolume(userId) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const transactionsRef = db.collection('transactions')
        .where('status', '==', 'completed')
        .where('userId', '==', userId)
        .where('createdAt', '>=', startOfMonth)
        .where('createdAt', '<=', endOfMonth);
    
    const snapshot = await transactionsRef.get();

    let monthlyVolume = 0;
    snapshot.forEach(doc => {
        const tx = doc.data();
        // CORRECTION : On ne somme que les transactions de type 'sell'
        if (tx.type === 'sell') {
            monthlyVolume += Number(tx.amountToReceive); // L'utilisateur reçoit des FCFA
        }
    });
    return monthlyVolume;
}

// --- CONFIGURATION DE SANITY ---
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  useCdn: true, 
  apiVersion: '2024-07-25',
});

// --- CONFIGURATION D'EXPRESS ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ================= MIDDLEWARE D'AUTHENTIFICATION (V2) =================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Accès non autorisé : token manquant." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Token invalide." });
        }
        req.user = user;
        next();
    });
};

// ================= MIDDLEWARE DE VÉRIFICATION ADMIN =================
const verifyAdminToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Accès non autorisé : token manquant." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Token invalide." });
        }
        
        // On vérifie que l'utilisateur a bien le rôle d'admin
        if (user.role !== 'admin') {
            return res.status(403).json({ message: "Accès refusé. Rôle administrateur requis." });
        }
        
        req.user = user;
        next();
    });
};

// ================= ROUTES D'AUTHENTIFICATION (V2) =================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: "Veuillez remplir tous les champs." });
        }
        const userRef = db.collection('users').where('email', '==', email);
        const snapshot = await userRef.get();
        if (!snapshot.empty) {
            return res.status(400).json({ message: "Un utilisateur avec cet email existe déjà." });
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const newUserRef = await db.collection('users').add({
            username,
            email,
            passwordHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).json({ message: "Compte créé avec succès.", userId: newUserRef.id });
    } catch (error) {
        console.error("Erreur d'inscription:", error);
        res.status(500).json({ message: "Erreur lors de la création du compte." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Veuillez remplir tous les champs." });
        }
        const userRef = db.collection('users').where('email', '==', email);
        const snapshot = await userRef.get();
        if (snapshot.empty) {
            return res.status(401).json({ message: "Email ou mot de passe incorrect." });
        }
        const userData = snapshot.docs[0].data();
        const userId = snapshot.docs[0].id;
        const isMatch = await bcrypt.compare(password, userData.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: "Email ou mot de passe incorrect." });
        }
        const payload = { id: userId, email: userData.email, username: userData.username };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({ message: "Connexion réussie.", token: token });
    } catch (error) {
        console.error("Erreur de connexion:", error);
        res.status(500).json({ message: "Erreur lors de la connexion." });
    }
});


// ===============================================
// ROUTE DE CONNEXION POUR L'ADMINISTRATEUR
// ===============================================
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (snapshot.empty) {
            return res.status(401).json({ message: 'Identifiants invalides.' });
        }

        const userDoc = snapshot.docs[0];
        const user = userDoc.data();

        // ----> VÉRIFICATION CRUCIALE DU RÔLE <----
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Accès non autorisé.' });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordCorrect) {
            return res.status(401).json({ message: 'Identifiants invalides.' });
        }

        const token = jwt.sign(
            { userId: userDoc.id, email: user.email, role: user.role }, // On inclut le rôle dans le token
            process.env.JWT_SECRET,
            { expiresIn: '3h' } // Durée de vie plus courte pour les sessions admin
        );

        res.status(200).json({ message: 'Connexion admin réussie', token });

    } catch (error) {
        console.error("Erreur de connexion admin:", error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
});

// ================= ROUTES API ADMIN (transactions) =================
// CORRECTION : Ajout d'un filtre pour ignorer les données potentiellement corrompues
app.get('/api/admin/transactions/pending', verifyAdminToken, async (req, res) => {
    try {
        const transactionsRef = db.collection('transactions').where('status', '==', 'pending').orderBy('createdAt', 'desc');
        const snapshot = await transactionsRef.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            
            // LA CORRECTION CRUCIALE EST ICI
            // On transforme l'objet Date de Firebase en un format simple
            if (data.createdAt && data.createdAt.toDate) {
                data.createdAt = {
                    _seconds: data.createdAt.seconds,
                    _nanoseconds: data.createdAt.nanoseconds
                };
            }
            
            return {
                id: doc.id,
                ...data
            };
        });

        res.status(200).json(transactions);
    } catch (error) {
        console.error("Erreur lors de la récupération des transactions en attente:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Route pour mettre à jour le statut d'une transaction
app.put('/api/admin/transactions/:id/status', verifyAdminToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // On vérifie que le statut envoyé est valide
    if (!status || !['completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ message: 'Statut invalide.' });
    }

    try {
        const transactionRef = db.collection('transactions').doc(id);
        const doc = await transactionRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Transaction introuvable.' });
        }

        // On met à jour le statut dans Firestore
        await transactionRef.update({ status: status });

        res.status(200).json({ message: `Transaction marquée comme : ${status}` });

    } catch (error) {
        console.error("Erreur lors de la mise à jour du statut de la transaction:", error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
});

// ================= ROUTES API ADMIN (tarification V4) =================

// Route pour récupérer les taux de change manuels
app.get('/api/admin/pricing/rates', verifyAdminToken, async (req, res) => {
    try {
        const docRef = db.collection('configuration').doc('manual_rates');
        const doc = await docRef.get();
        if (!doc.exists) {
            return res.status(200).json({ rates: {} });
        }
        res.status(200).json(doc.data());
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur.' });
    }
});

// Route pour définir les nouveaux taux de change manuels
app.post('/api/admin/pricing/rates', verifyAdminToken, async (req, res) => {
    const receivedRates = req.body;
    const cryptos = ['usdt', 'btc', 'eth', 'bnb', 'trx', 'xrp'];
    const newRatesObject = {};

    for (const crypto of cryptos) {
        const buyRate = parseFloat(receivedRates[`${crypto}-buy-rate`]);
        const sellRate = parseFloat(receivedRates[`${crypto}-sell-rate`]);
        if (!isNaN(buyRate) && !isNaN(sellRate)) {
            newRatesObject[crypto] = { buy: buyRate, sell: sellRate };
        }
    }

    try {
        const docRef = db.collection('configuration').doc('manual_rates');
        await docRef.set({
            rates: newRatesObject,
            lastUpdatedBy: req.user.email,
            lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({ message: 'Taux de change mis à jour avec succès.' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur serveur.' });
    }
});

// ================= ROUTES UTILISATEUR (V2) =================
app.get('/api/user/transactions', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const transactionsRef = db.collection('transactions').where('userId', '==', userId).orderBy('createdAt', 'desc');
        const snapshot = await transactionsRef.get();
        if (snapshot.empty) {
            return res.status(200).json([]);
        }
        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                data.createdAt = {
                    _seconds: data.createdAt.seconds,
                    _nanoseconds: data.createdAt.nanoseconds
                };
            }
            return { id: doc.id, ...data };
        });
        res.status(200).json(transactions);
    } catch (error) {
        console.error("Erreur lors de la récupération des transactions:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

app.get('/api/user/me', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }
        // On renvoie toutes les données de l'utilisateur (sauf le mot de passe)
        const userData = userDoc.data();
        delete userData.passwordHash; 
        res.status(200).json(userData);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Route pour calculer le volume de transaction du mois en cours
app.get('/api/user/transaction-volume', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Définir les dates de début et de fin du mois en cours
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // 2. Requête pour trouver les transactions complétées de l'utilisateur dans cet intervalle
        const transactionsRef = db.collection('transactions')
            .where('userId', '==', userId)
            .where('status', '==', 'completed')
            .where('createdAt', '>=', startOfMonth)
            .where('createdAt', '<=', endOfMonth);
        
        const snapshot = await transactionsRef.get();

        // 3. Calculer le volume total
        let monthlyVolume = 0;
        snapshot.forEach(doc => {
            const tx = doc.data();
            // Le volume est toujours la contre-valeur en FCFA
            if (tx.type === 'buy') {
                monthlyVolume += Number(tx.amountToSend); // L'utilisateur paie en FCFA
            } else if (tx.type === 'sell') {
                monthlyVolume += Number(tx.amountToReceive); // L'utilisateur reçoit des FCFA
            }
        });

        res.status(200).json({ monthlyVolume });

    } catch (error) {
        console.error("Erreur lors du calcul du volume de transaction:", error);
        res.status(500).json({ message: "Erreur serveur lors du calcul du volume." });
    }
});

// ================= ROUTES PROFIL UTILISATEUR =================

// Récupérer les adresses de portefeuille de l'utilisateur
app.get('/api/user/wallets', verifyToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }
        // Renvoie l'objet wallets, ou un objet vide s'il n'existe pas
        const wallets = userDoc.data().wallets || {};
        res.status(200).json(wallets);
    } catch (error) {
        console.error("Erreur lors de la récupération des portefeuilles:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Mettre à jour le mot de passe de l'utilisateur
app.post('/api/user/change-password', verifyToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Veuillez fournir un mot de passe actuel et un nouveau mot de passe de 6 caractères minimum." });
    }

    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }

        const userData = userDoc.data();

        // 1. Vérifier que l'ancien mot de passe est correct
        const isMatch = await bcrypt.compare(currentPassword, userData.passwordHash);
        if (!isMatch) {
            return res.status(400).json({ message: "L'ancien mot de passe est incorrect." });
        }

        // 2. Hasher le nouveau mot de passe
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);

        // 3. Mettre à jour dans Firestore
        await userRef.update({ passwordHash: newPasswordHash });

        res.status(200).json({ message: "Mot de passe mis à jour avec succès." });

    } catch (error) {
        console.error("Erreur lors du changement de mot de passe:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Enregistrer les adresses de portefeuille de l'utilisateur
app.post('/api/user/save-wallets', verifyToken, async (req, res) => {
    const { btcWallet, usdtWallet } = req.body;
    const userId = req.user.id;

    try {
        const userRef = db.collection('users').doc(userId);

        // On stocke les adresses dans un objet "wallets" pour garder le document propre
        await userRef.set({
            wallets: {
                btc: btcWallet || '',
                usdt_trc20: usdtWallet || ''
            }
        }, { merge: true }); // merge: true pour ne pas écraser les autres champs

        res.status(200).json({ message: "Adresses de portefeuille enregistrées avec succès." });
        
    } catch (error) {
        console.error("Erreur lors de la sauvegarde des portefeuilles:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// ================= ROUTES KYC UTILISATEUR =================

// Récupérer le statut KYC de l'utilisateur
app.get('/api/user/kyc-status', verifyToken, async (req, res) => {
    const userId = req.user.id;
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }
        // Renvoie le statut KYC, ou 'none' s'il n'existe pas
        const kycStatus = userDoc.data().kyc_status || 'none';
        res.status(200).json({ status: kycStatus });
    } catch (error) {
        console.error("Erreur lors de la récupération du statut KYC:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Soumettre une demande de vérification KYC avancée avec upload de fichiers
app.post('/api/user/kyc-request', verifyToken, upload.fields([
    { name: 'docRecto', maxCount: 1 },
    { name: 'docVerso', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]), async (req, res) => {

    const userId = req.user.id;
    const { firstName, lastName } = req.body;

    try {
        // Validation : s'assurer que les 3 fichiers sont bien là
        if (!req.files || !req.files.docRecto || !req.files.docVerso || !req.files.selfie) {
            return res.status(400).json({ message: "Les trois fichiers sont requis." });
        }

        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ message: "Utilisateur introuvable." });
        
        const userData = userDoc.data();
        if (userData.kyc_status === 'submitted' || userData.kyc_status === 'verified') {
            return res.status(400).json({ message: 'Vous avez déjà une demande en cours ou votre compte est déjà vérifié.' });
        }

        // Fonction helper pour uploader un fichier sur Cloudinary
        const uploadToCloudinary = (file) => {
            return new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream({ folder: `kyc_requests/${userId}` }, (error, result) => {
                    if (error) return reject(error);
                    resolve(result.secure_url);
                });
                uploadStream.end(file.buffer);
            });
        };

        // 1. Uploader les images sur Cloudinary en parallèle
        const [docRectoUrl, docVersoUrl, selfieUrl] = await Promise.all([
            uploadToCloudinary(req.files.docRecto[0]),
            uploadToCloudinary(req.files.docVerso[0]),
            uploadToCloudinary(req.files.selfie[0])
        ]);

        // 2. Envoyer la notification sur Telegram
        const message = `
*Nouvelle Demande de Vérification KYC*
--------------------------------------
*Utilisateur:* ${userData.email} (ID: ${userId})
*Nom:* ${firstName} ${lastName}
--------------------------------------
*Documents:*
- [Recto CNI](${docRectoUrl})
- [Verso CNI](${docVersoUrl})
- [Selfie](${selfieUrl})
        `;
        await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });

        // 3. Mettre à jour le statut de l'utilisateur
        await userRef.update({ kyc_status: 'submitted' });

        res.status(200).json({ message: 'Votre demande de vérification a bien été envoyée.' });

    } catch (error) {
        console.error("Erreur lors de la soumission KYC avancée:", error);
        res.status(500).json({ message: 'Erreur serveur lors de la soumission de vos documents.' });
    }
});

// ================= LOGIQUE DU WORKER (V4 - PRIX EN USDT) =================
async function updateMarketPrices() {
    console.log("Le worker de mise à jour des prix démarre...");
    try {
        const coinIds = 'bitcoin,ethereum,tether,binancecoin,tron,ripple';
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: {
                ids: coinIds,
                vs_currencies: 'usdt',
            }
        });

        const prices = response.data;
        const structuredPrices = {};

        // CORRECTION : On vérifie chaque prix avant de l'ajouter
        if (prices.bitcoin && prices.bitcoin.usdt) structuredPrices.btc = prices.bitcoin.usdt;
        if (prices.ethereum && prices.ethereum.usdt) structuredPrices.eth = prices.ethereum.usdt;
        if (prices.tether && prices.tether.usdt) structuredPrices.usdt = prices.tether.usdt;
        if (prices.binancecoin && prices.binancecoin.usdt) structuredPrices.bnb = prices.binancecoin.usdt;
        if (prices.tron && prices.tron.usdt) structuredPrices.trx = prices.tron.usdt;
        if (prices.ripple && prices.ripple.usdt) structuredPrices.xrp = prices.ripple.usdt;

        if (Object.keys(structuredPrices).length === 0) {
            throw new Error("Aucun prix valide n'a été récupéré depuis l'API CoinGecko.");
        }

        const docRef = db.collection('market_data').doc('realtime_usdt_prices');
        await docRef.set({
            prices: structuredPrices,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("Prix en USDT mis à jour avec succès dans Firestore.");

    } catch (error) {
        console.error("Erreur dans le worker de mise à jour des prix:", error.message);
    }
}

// Route sécurisée pour le cron job externe
app.post('/api/cron/update-prices', async (req, res) => {
    try {
        await updateMarketPrices();
        res.status(200).send('Prices updated successfully.');
    } catch (error) {
        res.status(500).send('Error updating prices.');
    }
});

app.get('/api/config', async (req, res) => {
    try {
        // 1. Récupérer les prix en temps réel (Crypto -> USDT)
        const realTimePricesDoc = await db.collection('market_data').doc('realtime_usdt_prices').get();
        if (!realTimePricesDoc.exists) throw new Error("Prix du marché non disponibles.");
        const realTimePrices = realTimePricesDoc.data().prices;

        // 2. Récupérer les taux de change manuels (USDT -> FCFA)
        const manualRatesDoc = await db.collection('configuration').doc('manual_rates').get();
        if (!manualRatesDoc.exists) throw new Error("Taux de change non configurés par l'admin.");
        const manualRates = manualRatesDoc.data().rates;

        // 3. Calculer les prix finaux en FCFA
        const finalAtexPrices = {};
        for (const crypto in realTimePrices) {
            if (manualRates[crypto]) {
                const priceInUSDT = realTimePrices[crypto];
                const ratesForCrypto = manualRates[crypto];

                finalAtexPrices[crypto] = {
                    buy: priceInUSDT * ratesForCrypto.buy,
                    sell: priceInUSDT * ratesForCrypto.sell
                };
            }
        }
        
        res.status(200).json({ atexPrices: finalAtexPrices });

    } catch (error) {
        console.error("Erreur lors de la construction de la configuration des prix:", error);
        // On relance le worker au cas où les prix temps réel seraient manquants
        updateMarketPrices().catch(console.error);
        res.status(500).json({ message: "Erreur de configuration des prix. Veuillez réessayer dans un instant." });
    }
});

app.post('/api/initiate-transaction', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const transactionData = req.body;

        if (!transactionData.type || !transactionData.amountToSend || !transactionData.paymentMethod || !transactionData.amountToReceive) {
            return res.status(400).json({ message: "Données de transaction manquantes ou invalides." });
        }
        
        // CORRECTION : La vérification ne s'applique que pour les ventes ('sell')
        if (transactionData.type === 'sell') {
            const USER_LIMIT = 100000;
            const currentTransactionAmount = Number(transactionData.amountToReceive);
            const existingVolume = await calculateUserMonthlyVolume(userId);

            if ((existingVolume + currentTransactionAmount) > USER_LIMIT) {
                return res.status(403).json({ 
                    message: `Limite de vente mensuelle de ${USER_LIMIT.toLocaleString('fr-FR')} FCFA atteinte. Votre volume de vente actuel est de ${existingVolume.toLocaleString('fr-FR')} FCFA.` 
                });
            }
        }

        const transactionToSave = {
          ...transactionData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
          userId: userId
        };

        await db.collection('transactions').add(transactionToSave);
        
        // ... (le reste de la fonction ne change pas)
        let message = '';
        if (transactionData.type === 'buy') {
            message = `Bonjour ATEX, je souhaite initier un NOUVEL ACHAT :\n- Montant à payer : ${transactionData.amountToSend} FCFA\n- Crypto à recevoir : ${Number(transactionData.amountToReceive).toFixed(6)} ${transactionData.currencyTo}\n- Mon adresse Wallet : ${transactionData.walletAddress}\n- Moyen de paiement : ${transactionData.paymentMethod}`;
        } else {
            message = `Bonjour ATEX, je souhaite initier une NOUVELLE VENTE :\n- Montant à envoyer : ${transactionData.amountToSend} ${transactionData.currencyFrom}\n- Montant à recevoir : ${Math.round(transactionData.amountToReceive)} FCFA\n- Mon numéro pour le dépôt : ${transactionData.phoneNumber}\n- Moyen de réception : ${transactionData.paymentMethod}`;
        }
        const whatsappNumber = process.env.WHATSAPP_NUMBER;
        const encodedMessage = encodeURIComponent(message);
        const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;
        res.status(200).json({ whatsappUrl });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
             return res.status(401).json({ message: "Session invalide ou expirée. Veuillez vous reconnecter." });
        }
        console.error("Erreur lors de l'initialisation de la transaction:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// MODIFIÉ : Route de contenu Sanity pour la V2
app.get('/api/press-articles', async (req, res) => {

  const page = parseInt(req.query.page) || 1;
  const limit = 3;
  const offset = (page - 1) * limit;
  const end = offset + limit; // On calcule la fin de la plage

  // La requête utilise maintenant $offset et $end, ce qui est la bonne syntaxe
  const query = `*[_type == "pressArticle"] | order(publishedDate desc) [$offset...$end]{
    title,
    url,
    excerpt,
    "imageUrl": mainImage.asset->url,
    category,
    publishedDate,
    readingTime
  }`;
  
  // On fournit les deux paramètres attendus par la requête
  const params = { offset, end };

  try {
    const articles = await client.fetch(query, params);
    res.status(200).json(articles);
  } catch (error) {
    console.error("Erreur Sanity (press-articles):", error);
    res.status(500).json({ message: "Erreur lors de la récupération des articles de presse." });
  }
});

app.get('/api/knowledge-articles', async (req, res) => {
  const query = `*[_type == "knowledgeArticle"]{ title, iconClass, content, createdAt } | order(createdAt desc)`;
  try {
    const articles = await client.fetch(query);
    res.status(200).json(articles);
  } catch (error) {
    console.error("Erreur Sanity (knowledge-articles):", error);
    res.status(500).json({ message: "Erreur lors de la récupération des articles de savoir." });
  }
});

app.get('/api/testimonials', async (req, res) => {
  const query = `*[_type == "testimonial"]{ name, location, quote, "imageUrl": image.asset->url }`;
  try {
    const testimonials = await client.fetch(query);
    res.status(200).json(testimonials);
  } catch (error) {
    console.error("Erreur Sanity (testimonials):", error);
    res.status(500).json({ message: "Erreur lors de la récupération des témoignages." });
  }
});

// --- GESTION DES ROUTES FRONTEND ET DÉMARRAGE ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- GESTION DES ROUTES FRONTEND ET DÉMARRAGE ---
// Cette route "catch-all" doit être la DERNIÈRE route de votre fichier, juste avant app.listen.
// Elle sert à renvoyer votre fichier index.html pour n'importe quelle URL non interceptée par l'API.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// On exécute le worker une première fois au démarrage pour garantir des prix frais.
//console.log("Exécution initiale du worker de prix au démarrage du serveur...");
//updateMarketPrices();

// Démarrage du serveur.
app.listen(PORT, () => {
  console.log(`Le serveur ATEX écoute sur le port ${PORT}`);
});