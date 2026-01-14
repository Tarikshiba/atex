// Importer les dépendances nécessaires
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const TelegramBot = require('node-telegram-bot-api');
const { nanoid } = require('nanoid'); 
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@sanity/client');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
// --- NOUVELLE CONFIGURATION DES RÉCOMPENSES ET PAIEMENTS ---

const PAYMENT_DETAILS = {
    'moov-togo': { number: '+22898216099', country: 'Togo', name: 'Moov Money (Togo)' },
    'yas-togo': { number: '+22871450716', country: 'Togo', name: 'YAS (Togo)' },
    'wave-senegal': { number: '+221777054493', country: 'Sénégal', name: 'Wave (Sénégal)' },
    'orange-senegal': { number: '+221786800112', country: 'Sénégal', name: 'Orange Money (Sénégal)' }
};

function escapeMarkdownV2(text) {
  if (text === null || typeof text === 'undefined') {
    return '';
  }
  const textString = String(text);
  // Liste complète des caractères à échapper pour MarkdownV2
  const charsToEscape = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  
  let escapedText = '';
  for (const char of textString) {
    if (charsToEscape.includes(char)) {
      escapedText += '\\' + char;
    } else {
      escapedText += char;
    }
  }
  return escapedText;
}

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
// On initialise DEUX bots distincts avec leurs propres tokens
const adminBot = new TelegramBot(process.env.TELEGRAM_ADMIN_BOT_TOKEN, { polling: true }); // Pour les notifications
const miniAppBot = new TelegramBot(process.env.TELEGRAM_MINI_APP_BOT_TOKEN, { polling: true }); // Pour la Mini App
// --- BOT SUPPORT CLIENT (ATEX DESK) ---
const supportBot = new TelegramBot(process.env.TELEGRAM_SUPPORT_BOT_TOKEN, { polling: true });

// --- NOUVELLE FONCTION CENTRALE D'ACTIVATION ET DE RÉCOMPENSE ---
/**
 * Vérifie si un utilisateur (le "filleul") doit devenir actif et récompense son parrain.
 * @param {FirebaseFirestore.DocumentSnapshot} filleulDocSnapshot - Le snapshot du document Firestore du filleul.
 */


console.log('Bot de la Mini App démarré et en écoute...');

// --- LOGIQUE DU BOT TELEGRAM & MINI APP ---

miniAppBot.onText(/\/start(.*)/, async (msg, match) => {
    // 1. VÉRIFICATION MAINTENANCE BOT
    const configDoc = await db.collection('configuration').doc('general').get();
    if (configDoc.exists && configDoc.data().maintenance_mode) {
         // On vérifie si c'est un admin (bypass maintenance)
         const isAdmin = (process.env.TELEGRAM_ADMIN_IDS || '').includes(msg.from.id.toString());
         if (!isAdmin) {
             return miniAppBot.sendMessage(msg.chat.id, "🚧 **ATEX est en maintenance.**\n\nNous déployons une mise à jour pour améliorer nos services. Revenez dans quelques instants !", { parse_mode: 'Markdown' });
         }
    }
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    // On nettoie le code de parrainage s'il existe
    // 1. ANALYSE DU CODE PARRAINAGE (Format: CodeParrain_IdCampagne)
    const rawParam = match[1] ? match[1].trim() : '';
    // On sépare le code parrain de l'ID campagne (séparateur "_")
    // Ex: "AbCdEf_campagne_v2" -> parrain="AbCdEf", campaign="campagne_v2"
    let [referralCode, campaignId] = rawParam.split('_');
    
    // Si pas de campagne dans le lien, on met null (ancien lien)
    if (!campaignId && rawParam) referralCode = rawParam; 

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('telegramId', '==', telegramId).limit(1).get();

        if (snapshot.empty) {
            // --- NOUVEL UTILISATEUR ---
            const newReferralCode = nanoid(8); 
            
            // Validation de la campagne
            let validReferredBy = null;

            if (referralCode && campaignId) {
                // On récupère la config ACTUELLE pour comparer
                // Note: configDoc a été récupéré plus haut pour la maintenance
                const currentConfig = configDoc.exists ? configDoc.data() : {};
                
                // On valide seulement si :
                // 1. Le parrainage est globalement ACTIF
                // 2. L'ID de campagne du lien correspond à la campagne ACTUELLE du serveur
                if (currentConfig.referral_active && currentConfig.referral_campaign_id === campaignId) {
                    validReferredBy = referralCode;
                } else {
                    console.log(`Parrainage ignoré : Campagne invalide (Lien: ${campaignId}, Serveur: ${currentConfig.referral_campaign_id})`);
                }
            } else if (referralCode && !campaignId) {
                 // Gestion des anciens liens sans campagne (optionnel: accepter ou refuser)
                 // Ici on refuse pour forcer le nouveau système
                 console.log("Ancien lien de parrainage ignoré.");
            }

            const newUser = {
                telegramId: telegramId,
                telegramUsername: msg.from.username || '',
                referralCode: newReferralCode,
                referredBy: validReferredBy, // On stocke seulement si valide
                referralCount: 0,
                isReferralActive: false,
                referralEarnings: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };

            await usersRef.add(newUser);
            console.log(`Nouvel utilisateur créé : ${telegramId} (Parrain: ${validReferredBy || 'Aucun'})`);

            // Mise à jour du compteur du parrain SI valide
            if (validReferredBy) {
                const referrerSnapshot = await usersRef.where('referralCode', '==', validReferredBy).limit(1).get();
                if (!referrerSnapshot.empty) {
                    const referrerDoc = referrerSnapshot.docs[0];
                    await referrerDoc.ref.update({
                        referralCount: admin.firestore.FieldValue.increment(1)
                    });
                }
            }

        } else {
            console.log(`Utilisateur existant : ${telegramId}`);
        }
        
        // Envoi du message de bienvenue
        const webAppUrl = process.env.MINI_APP_URL; 
        miniAppBot.sendMessage(chatId, "👋 Bienvenue sur ATEX ! Cliquez ci-dessous pour démarrer.", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Lancer l'application", web_app: { url: webAppUrl } }]
                ]
            }
        });

    } catch (error) {
        console.error("Erreur /start:", error);
        miniAppBot.sendMessage(chatId, "Erreur serveur. Réessayez plus tard.");
    }
});

// --- GESTION DES CLICS SUR LES BOUTONS D'ADMINISTRATION ---
adminBot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const adminUser = callbackQuery.from;

    const authorizedAdmins = (process.env.TELEGRAM_ADMIN_IDS || '').split(',');
    if (!authorizedAdmins.includes(adminUser.id.toString())) {
        return adminBot.answerCallbackQuery(callbackQuery.id, {
            text: "Action non autorisée. Vous n'êtes pas un administrateur.",
            show_alert: true
        });
    }

    const [action, id] = data.split(':');
    adminBot.answerCallbackQuery(callbackQuery.id);

// --- LOGIQUE POUR LES TRANSACTIONS CLASSIQUES (V3 - REVENUE SHARE) ---
if (action === 'approve' || action === 'cancel') {
    try {
        const transactionRef = db.collection('transactions').doc(id);
        const doc = await transactionRef.get();
        if (!doc.exists) return adminBot.sendMessage(msg.chat.id, "Erreur : Transaction introuvable.");

        const txData = doc.data();
        if (txData.status !== 'pending') return adminBot.sendMessage(msg.chat.id, "⚠️ Transaction déjà traitée.");

        const status = action === 'approve' ? 'completed' : 'cancelled';
        const emoji = action === 'approve' ? '✅ Approuvée' : '❌ Annulée';

        await transactionRef.update({ status });
        
        // =========================================================
        // SYSTÈME DE PARRAINAGE : REVENUE SHARE (PROFIT)
        // =========================================================
        if (action === 'approve') {
            const usersRef = db.collection('users');
            const userSnapshot = await usersRef.where('telegramId', '==', txData.telegramId).limit(1).get();
            
            if (!userSnapshot.empty) {
                const userDoc = userSnapshot.docs[0];
                const userData = userDoc.data();

                // 1. Marquer l'utilisateur comme ACTIF s'il ne l'était pas
                // Un utilisateur est actif dès qu'il fait une transaction réussie
                if (!userData.isActive) {
                    await userDoc.ref.update({ isActive: true });
                    // Si parrain, incrémenter son compteur de filleuls ACTIFS
                    if (userData.referredBy) {
                        const referrerSnapshot = await usersRef.where('referralCode', '==', userData.referredBy).limit(1).get();
                        if (!referrerSnapshot.empty) {
                             // On incrémente le nombre de filleuls actifs du parrain
                             await referrerSnapshot.docs[0].ref.update({
                                 activeReferralCount: admin.firestore.FieldValue.increment(1)
                             });
                        }
                    }
                }

                // 2. CALCUL DES GAINS POUR LE PARRAIN (Revenue Share)
                if (userData.referredBy) {
                    const configDoc = await db.collection('configuration').doc('general').get();
                    const config = configDoc.exists ? configDoc.data() : {};
                    
                    // --- RÉCUPÉRATION DES RÉGLAGES CONFIGURÉS ---
                    const margin = config.referral_margin || 30; // Défaut 30 si non configuré
                    const l1 = config.levels?.l1 || { threshold: 5, percent: 5 };
                    const l2 = config.levels?.l2 || { threshold: 20, percent: 8 };
                    const l3 = config.levels?.l3 || { threshold: 50, percent: 12 };

                    const referrerSnapshot = await usersRef.where('referralCode', '==', userData.referredBy).limit(1).get();
                    
                    if (!referrerSnapshot.empty) {
                        const referrerDoc = referrerSnapshot.docs[0];
                        const referrerData = referrerDoc.data();
                        
                        // Nombre de filleuls actifs (Fallback sur referralCount total si pas encore de activeReferralCount)
                        let activeCount = referrerData.activeReferralCount || referrerData.referralCount || 0;

                        // DÉTERMINATION DU NIVEAU
                        let percent = 0;
                        let levelName = "";
                        
                        if (activeCount >= l3.threshold) { percent = l3.percent; levelName = "Expert (Niv 3)"; }
                        else if (activeCount >= l2.threshold) { percent = l2.percent; levelName = "Avancé (Niv 2)"; }
                        else if (activeCount >= l1.threshold) { percent = l1.percent; levelName = "Actif (Niv 1)"; }
                        
                        // Si le parrain est qualifié (Niveau 1 atteint)
                        if (percent > 0) {
                            // CALCUL DU VOLUME EN USDT (Approximatif basé sur montant FCFA)
                            // On convertit le montant FCFA de la transaction en USDT pour avoir une base de volume
                            let amountFCFA = 0;
                            if (txData.type === 'buy') amountFCFA = txData.amountToSend; 
                            else amountFCFA = txData.amountToReceive;

                            // On utilise un taux fixe de division pour estimer le volume USDT (ex: 650)
                            // Volume USDT = Montant FCFA / 650
                            const estimatedVolumeUSDT = amountFCFA / 650;

                            // CALCUL DU GAIN
                            // Marge Totale Théorique = Volume USDT * Marge Configurée (ex: 30)
                            const totalMarginFCFA = estimatedVolumeUSDT * margin;
                            
                            // Part du parrain en FCFA
                            const referrerShareFCFA = totalMarginFCFA * (percent / 100);
                            
                            // CONVERSION DU GAIN EN USDT (Pour créditer le solde)
                            // On divise par 650 (ou le taux de vente actuel)
                            const ratesDoc = await db.collection('configuration').doc('manual_rates').get();
                            const usdtSellRate = ratesDoc.exists ? (ratesDoc.data().rates?.usdt?.sell || 650) : 650;
                            
                            const referrerShareUSDT = referrerShareFCFA / usdtSellRate;

                            if (referrerShareUSDT > 0.001) { 
                                await referrerDoc.ref.update({
                                    referralEarnings: admin.firestore.FieldValue.increment(referrerShareUSDT)
                                });

                                // Notification Parrain
                                const msgParrain = `💰 **GAIN AFFILIATION (${levelName})**\n\nUn filleul a fait une transaction.\n💵 Base Marge : ${totalMarginFCFA.toFixed(0)} FCFA\n💎 **Votre part (${percent}%) : +${referrerShareUSDT.toFixed(4)} USDT**`;
                                try { await miniAppBot.sendMessage(referrerData.telegramId, msgParrain, { parse_mode: 'Markdown' }); } catch(e) {}
                            }
                        }
                    }
                }
            }
        }
        // ================= FIN SYSTÈME PARRAINAGE =================

        // Notification Utilisateur (inchangé)
        let userMessage;
        const txTypeText = txData.type === 'buy' ? 'd\'achat' : 'de vente';
        const supportUsername = "AtexlySupportBot";

        if (action === 'approve') {
            userMessage = `🎉 Bonne nouvelle ! Votre transaction ${txTypeText} de ${txData.amountToSend.toLocaleString('fr-FR')} ${txData.currencyFrom || 'FCFA'} a été **approuvée**.`;
        } else { 
            userMessage = `⚠️ Information : Votre transaction ${txTypeText} a été **annulée**. Pour en connaître la raison, veuillez contacter : @${supportUsername}`;
        }
        try { await miniAppBot.sendMessage(txData.telegramId, userMessage, { parse_mode: 'Markdown' }); } catch (e) {}

        const originalMessage = msg.text;
        const updatedMessage = `${escapeMarkdownV2(originalMessage)}\n\n*STATUT : ${emoji} par ${escapeMarkdownV2(adminUser.first_name)}*`;
        
        adminBot.editMessageText(updatedMessage, {
            chat_id: msg.chat.id, message_id: msg.message_id,
            parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [] }
        });
    } catch (error) {
        console.error("Erreur (callback transaction):", error);
        adminBot.sendMessage(msg.chat.id, "Une erreur est survenue.");
    }
}
    
    // --- NOUVELLE LOGIQUE POUR LES RETRAITS DE GAINS ---
    if (action === 'approve_withdrawal' || action === 'reject_withdrawal') {
        try {
            const withdrawalRef = db.collection('withdrawals').doc(id);
            const doc = await withdrawalRef.get();
            if (!doc.exists) return adminBot.sendMessage(msg.chat.id, "Erreur : Demande de retrait introuvable.");

            const withdrawalData = doc.data();
            let newStatus, statusEmoji, userMessage;

            if (action === 'approve_withdrawal') {
                newStatus = 'completed';
                statusEmoji = '✅ Approuvée';
                userMessage = `🎉 Bonne nouvelle ! Votre demande de retrait de ${withdrawalData.amount.toFixed(2)} USDT a été approuvée et traitée.`;
                await withdrawalRef.update({ status: newStatus });
            } else { // reject_withdrawal
                newStatus = 'cancelled';
                statusEmoji = '❌ Rejetée';
                userMessage = `⚠️ Votre demande de retrait de ${withdrawalData.amount.toFixed(2)} USDT a été rejetée. Les fonds ont été recrédités sur votre solde de gains.`;
                
                const userSnapshot = await db.collection('users').where('telegramId', '==', withdrawalData.telegramId).limit(1).get();
                if (!userSnapshot.empty) {
                    const userDoc = userSnapshot.docs[0];
                    await userDoc.ref.update({
                        referralEarnings: admin.firestore.FieldValue.increment(withdrawalData.amount)
                    });
                }
                await withdrawalRef.update({ status: newStatus });
            }

            const originalMessage = msg.text;
            const updatedMessage = `${escapeMarkdownV2(originalMessage)}\n\n*STATUT : ${statusEmoji} par ${escapeMarkdownV2(adminUser.first_name)}*`;
            adminBot.editMessageText(updatedMessage, {
                chat_id: msg.chat.id, message_id: msg.message_id,
                parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [] }
            });

            await miniAppBot.sendMessage(withdrawalData.telegramId, userMessage);

        } catch (error) {
            console.error("Erreur (callback withdrawal):", error);
            adminBot.sendMessage(msg.chat.id, "Une erreur est survenue (retrait).");
        }
    }
});

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
app.use('/miniapp', express.static(path.join(__dirname, 'public', 'miniapp'))); // <-- AJOUT

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

// ================= MIDDLEWARE D'IDENTIFICATION OPTIONNELLE =================
const identifyOptionalUser = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // S'il n'y a pas de token, on continue sans utilisateur
        return next(); 
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (!err) {
            // Si le token est valide, on attache l'utilisateur à la requête
            req.user = user;
        }
        // S'il y a une erreur (token invalide/expiré), on continue quand même sans utilisateur
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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            referralCode: nanoid(8),      // <-- AJOUT
            referralEarnings: 0         // <-- AJOUT
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

// ==================================================================
// NOUVELLES ROUTES ADMIN : GESTION DES CRYPTOS & WALLETS (DYNAMIQUE)
// ==================================================================

// --- ROUTES POUR LES PARAMÈTRES GÉNÉRAUX & MIDDLEWARE MAINTENANCE ---

// Middleware de Maintenance
const checkMaintenance = async (req, res, next) => {
    // CORRECTION : On utilise originalUrl pour avoir le chemin complet (/api/admin...)
    // On laisse passer les admins, les settings et les webhooks (si besoin)
    if (req.originalUrl.startsWith('/api/admin') || req.originalUrl.startsWith('/api/settings')) {
        return next();
    }
    
    try {
        const doc = await db.collection('configuration').doc('general').get();
        if (doc.exists && doc.data().maintenance_mode) {
            return res.status(503).json({ 
                message: "ATEX est actuellement en maintenance pour mise à jour. Revenez vite !",
                maintenance: true 
            });
        }
        next();
    } catch (error) {
        next(); // En cas d'erreur DB, on laisse passer par défaut (fail-open)
    }
};

// Appliquer le middleware à TOUTES les routes API (sauf settings/admin géré au dessus)
app.use('/api', checkMaintenance);

// 1. Récupérer les paramètres globaux (Route Publique)
app.get('/api/settings', async (req, res) => {
    try {
        const doc = await db.collection('configuration').doc('general').get();
        const defaults = { 
            maintenance_mode: false, 
            referral_active: true, 
            referral_campaign_id: 'campagne_v1', // ID par défaut
            referral_text: "Gagnez 25 FCFA par ami invité !" 
        };
        res.status(200).json(doc.exists ? { ...defaults, ...doc.data() } : defaults);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 2. Mettre à jour les paramètres (Route Admin)
app.post('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        const { maintenance_mode, referral_active, referral_text, new_campaign } = req.body;
        
        const updateData = { 
            maintenance_mode, 
            referral_active, 
            referral_text 
        };

        // Si on demande une nouvelle campagne, on génère un nouvel ID unique
        if (new_campaign) {
            updateData.referral_campaign_id = `campagne_${nanoid(6)}`;
            // Optionnel : On pourrait archiver les stats ici si tu veux
        }

        await db.collection('configuration').doc('general').set(updateData, { merge: true });
        res.status(200).json({ message: "Paramètres mis à jour.", campaignId: updateData.referral_campaign_id });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// --- FIN ROUTES PARAMÈTRES ---
// 1. Récupérer la configuration complète des cryptos
app.get('/api/admin/cryptos', verifyAdminToken, async (req, res) => {
    try {
        const doc = await db.collection('configuration').doc('crypto_list').get();
        // Si pas de config, on renvoie une liste vide
        res.status(200).json(doc.exists ? doc.data().list || [] : []);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 2. Ajouter ou Mettre à jour une crypto
app.post('/api/admin/cryptos', verifyAdminToken, async (req, res) => {
    try {
        const newCrypto = req.body; // { id, name, symbol, network, walletAddress, ... }
        if (!newCrypto.symbol || !newCrypto.id) return res.status(400).json({ message: "Données invalides." });

        const docRef = db.collection('configuration').doc('crypto_list');
        
        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            let list = doc.exists ? (doc.data().list || []) : [];
            
            // On vérifie si l'ID existe déjà pour mettre à jour, sinon on ajoute
            const index = list.findIndex(c => c.id === newCrypto.id);
            if (index > -1) {
                list[index] = { ...list[index], ...newCrypto }; // Mise à jour
            } else {
                list.push(newCrypto); // Ajout
            }
            
            t.set(docRef, { list });
        });

        res.status(200).json({ message: "Configuration crypto mise à jour." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 3. Supprimer une crypto
app.delete('/api/admin/cryptos/:id', verifyAdminToken, async (req, res) => {
    try {
        const cryptoId = req.params.id;
        const docRef = db.collection('configuration').doc('crypto_list');

        await db.runTransaction(async (t) => {
            const doc = await t.get(docRef);
            if (!doc.exists) return;
            let list = doc.data().list || [];
            list = list.filter(c => c.id !== cryptoId);
            t.set(docRef, { list });
        });

        res.status(200).json({ message: "Crypto supprimée." });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
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

// Route pour définir les nouveaux taux de change manuels (CORRIGÉE DYNAMIQUE)
app.post('/api/admin/pricing/rates', verifyAdminToken, async (req, res) => {
    const receivedRates = req.body;
    const newRatesObject = {};

    // Au lieu d'une liste fixe, on parcourt tout ce que le formulaire a envoyé
    Object.keys(receivedRates).forEach(key => {
        // On repère les champs qui finissent par "-buy-rate" (ex: "usdt-buy-rate")
        if (key.endsWith('-buy-rate')) {
            // On extrait l'ID de la crypto (ex: "usdt")
            const cryptoId = key.replace('-buy-rate', '');
            
            const buyVal = parseFloat(receivedRates[key]);
            const sellVal = parseFloat(receivedRates[`${cryptoId}-sell-rate`]);

            // Si les valeurs sont valides, on les ajoute à l'objet de sauvegarde
            if (!isNaN(buyVal) && !isNaN(sellVal)) {
                newRatesObject[cryptoId] = { buy: buyVal, sell: sellVal };
            }
        }
    });

    try {
        const docRef = db.collection('configuration').doc('manual_rates');
        // On sauvegarde le nouvel objet dynamique
        await docRef.set({
            rates: newRatesObject,
            lastUpdatedBy: req.user.email,
            lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({ message: 'Taux de change mis à jour avec succès.' });
    } catch (error) {
        console.error("Erreur sauvegarde taux:", error);
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

// ===============================================
// ROUTE API POUR LA TRANSACTION DE LA MINI APP (V4 - FINALE)
// ===============================================
app.post('/api/miniapp/initiate-transaction', async (req, res) => {
    try {
        const txData = req.body;

        // Validation simple
        if (!txData.type || !txData.amountToSend || !txData.phoneNumber) {
            return res.status(400).json({ message: "Données de transaction manquantes." });
        }
        if (txData.type === 'buy' && !txData.walletAddress) {
            return res.status(400).json({ message: "L'adresse du portefeuille est requise pour un achat." });
        }

        // --- NOUVEAU : VÉRIFICATION DES LIMITES PAR CRYPTO ---
        if (txData.cryptoId) {
            const configDoc = await db.collection('configuration').doc('crypto_list').get();
            const cryptos = configDoc.exists ? (configDoc.data().list || []) : [];
            const selectedCrypto = cryptos.find(c => c.id === txData.cryptoId);

            if (selectedCrypto) {
                // Vérification Achat (Montant en FCFA)
                if (txData.type === 'buy' && selectedCrypto.minBuy > 0) {
                    if (txData.amountToSend < selectedCrypto.minBuy) {
                        return res.status(400).json({ message: `Le minimum d'achat pour ${selectedCrypto.name} est de ${selectedCrypto.minBuy.toLocaleString('fr-FR')} FCFA.` });
                    }
                }
                // Vérification Vente (Montant en Crypto)
                // Note: En vente, amountToSend est le montant en crypto envoyé par le client
                if (txData.type === 'sell' && selectedCrypto.minSell > 0) {
                    if (txData.amountToSend < selectedCrypto.minSell) {
                        return res.status(400).json({ message: `Le minimum de vente pour ${selectedCrypto.name} est de ${selectedCrypto.minSell} ${selectedCrypto.symbol}.` });
                    }
                }
            }
        }
        // --- FIN VÉRIFICATION ---

        // 1. Sauvegarder la transaction
        const transactionToSave = {
            ...txData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            source: 'MiniApp'
        };
        const newTransactionRef = await db.collection('transactions').add(transactionToSave);
        const transactionId = newTransactionRef.id;

        // 2. Notification Admin (Logique corrigée conservée)
        let adminMessage;
        const safeUsername = escapeMarkdownV2(txData.telegramUsername || 'Anonyme');
        const safeTelegramId = escapeMarkdownV2(txData.telegramId);
        const safePaymentMethod = escapeMarkdownV2(txData.paymentMethod);
        const safePhoneNumber = escapeMarkdownV2(txData.phoneNumber);
        const safeWalletAddress = escapeMarkdownV2(txData.walletAddress);
        const safeCurrencyTo = escapeMarkdownV2(txData.currencyTo);
        const safeCurrencyFrom = escapeMarkdownV2(txData.currencyFrom);
        
        const userInfo = `👤 *Client:* @${safeUsername} \\(ID: ${safeTelegramId}\\)`;
        const separator = escapeMarkdownV2('--------------------------------------');

        if (txData.type === 'buy') {
            const valFrcfa = escapeMarkdownV2(txData.amountToSend.toLocaleString('fr-FR'));
            const valCrypto = escapeMarkdownV2(txData.amountToReceive.toFixed(6));

            adminMessage = `
*nouvelle COMMANDE D'ACHAT \\(Mini App\\)*
${separator}
${userInfo}
*Montant Payé:* ${valFrcfa} FCFA
*Crypto Achetée:* ${valCrypto} ${safeCurrencyTo}
*Opérateur MM:* ${safePaymentMethod}
*N° de Téléphone:* ${safePhoneNumber}
*Adresse Wallet:* \`${safeWalletAddress}\`
            `;
        } else { 
            // VENTE : On affiche bien ce que le client envoie (Crypto) et reçoit (FCFA)
            const valCrypto = escapeMarkdownV2(txData.amountToSend.toString()); 
            const valFcfa = escapeMarkdownV2(Math.round(txData.amountToReceive).toLocaleString('fr-FR'));

             adminMessage = `
*nouvelle COMMANDE DE VENTE \\(Mini App\\)*
${separator}
${userInfo}
*Crypto Vendue:* ${valCrypto} ${safeCurrencyFrom}
*Montant à Recevoir:* ${valFcfa} FCFA
*Opérateur MM:* ${safePaymentMethod}
*N° de Réception:* ${safePhoneNumber}
            `;
        }
        
        const options = {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Approuver", callback_data: `approve:${transactionId}` },
                    { text: "❌ Annuler", callback_data: `cancel:${transactionId}` }
                ]]
            }
        };
        await adminBot.sendMessage(process.env.TELEGRAM_CHAT_ID, adminMessage, options);

        // 3. Réponse au Client (Message Bot + HTTP)
        if (txData.type === 'buy') {
            // --- MESSAGE ACHAT (VERSION LONGUE RESTAURÉE) ---
            const paymentInfo = PAYMENT_DETAILS[txData.paymentMethod];
            if (paymentInfo) {
                // Note : Les caractères spéciaux (. ! - ( )) sont échappés pour MarkdownV2
                const payMsg = `
Bonjour ${safeUsername}\\! 👋
Votre demande d'achat a bien été reçue et est en cours de traitement\\.

Pour finaliser, veuillez effectuer le paiement sur le numéro ci\\-dessous :

🧾 *Opérateur :* ${escapeMarkdownV2(paymentInfo.name)}
📞 *Numéro :* \`${escapeMarkdownV2(paymentInfo.number)}\`
_\\(Appuyez sur le numéro pour le copier facilement\\)_

⚠️ *Important :* Si vous n'êtes pas au ${escapeMarkdownV2(paymentInfo.country)}, assurez\\-vous d'effectuer un transfert international\\.

Une fois le paiement effectué, notre équipe validera la transaction et vous recevrez vos cryptomonnaies\\.

🚨 *Après avoir payé, merci d'envoyer la capture d'écran de la transaction à notre support client :* @AtexlySupportBot
                `;
                try { await miniAppBot.sendMessage(txData.telegramId, payMsg, { parse_mode: 'MarkdownV2' }); } catch(e) { console.error("Erreur msg achat:", e.message); }
            }
            res.status(200).json({ message: "Commande reçue ! Instructions envoyées par message." });

        } else { 
            // --- MESSAGE VENTE (CORRECTION DU BUG DE SYNTAXE) ---
            
            const cryptoListDoc = await db.collection('configuration').doc('crypto_list').get();
            const cryptos = cryptoListDoc.exists ? (cryptoListDoc.data().list || []) : [];
            
            let foundCrypto = null;
            if (txData.cryptoId) foundCrypto = cryptos.find(c => c.id === txData.cryptoId);
            if (!foundCrypto) foundCrypto = cryptos.find(c => c.symbol === txData.currencyFrom);

            const targetWallet = foundCrypto ? foundCrypto.walletAddress : "Adresse non disponible. Contactez le support.";
            const networkInfo = foundCrypto ? foundCrypto.network : "Réseau standard";

            const valCrypto = escapeMarkdownV2(txData.amountToSend.toString());
            const valFcfa = escapeMarkdownV2(Math.round(txData.amountToReceive).toLocaleString('fr-FR'));
            const safeTargetWallet = escapeMarkdownV2(targetWallet);
            const safeNetwork = escapeMarkdownV2(networkInfo);
            const symbol = escapeMarkdownV2(txData.currencyFrom);

            const sellMessage = `
Bonjour ${safeUsername}\\! 👋
Votre demande de *vente* est enregistrée\\.

🔹 Vous vendez : *${valCrypto} ${symbol}*
🔹 Vous recevez : *${valFcfa} FCFA*

Pour finaliser, envoyez vos cryptos ici :

📥 *Adresse ${symbol} \\(${safeNetwork}\\) :*
\`${safeTargetWallet}\`
_\\(Appuyez pour copier\\)_

⚠️ *Important :* Utilisez bien le réseau *${safeNetwork}*\\.
🚨 *Envoyez la preuve \\(hash\\) au support :* @AtexlySupportBot
            `;
            // NOTE : J'ai mis \\(hash\\) ci-dessus. C'est ÇA qui va réparer le bug.

            try {
                await miniAppBot.sendMessage(txData.telegramId, sellMessage, { parse_mode: 'MarkdownV2' });
                console.log(`Instructions vente envoyées à ${txData.telegramId}`);
            } catch(e) {
                console.error(`Erreur envoi message vente :`, e.message);
            }

            res.status(200).json({ message: "Ordre initié ! L'adresse vous a été envoyée par message." });
        }

    } catch (error) {
        console.error("Erreur Transaction:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// ===============================================
// ROUTE API POUR L'HISTORIQUE DE LA MINI APP
// ===============================================
app.get('/api/miniapp/my-transactions/:telegramId', async (req, res) => {
    try {
        const telegramId = parseInt(req.params.telegramId, 10);

        if (isNaN(telegramId)) {
            return res.status(400).json({ message: "ID Telegram invalide." });
        }

        const transactionsRef = db.collection('transactions')
            .where('telegramId', '==', telegramId)
            .orderBy('createdAt', 'desc');
            
        const snapshot = await transactionsRef.get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Convertit le timestamp Firebase en une date lisible (ISO string)
                createdAt: data.createdAt.toDate().toISOString()
            };
        });

        res.status(200).json(transactions);

    } catch (error) {
        console.error("Erreur lors de la récupération de l'historique des transactions:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// ===============================================
// ROUTE API POUR LES INFOS DE PARRAINAGE
// ===============================================
app.get('/api/miniapp/referral-info/:telegramId', async (req, res) => {
    try {
        const telegramId = parseInt(req.params.telegramId, 10);
        if (isNaN(telegramId)) {
            return res.status(400).json({ message: "ID Telegram invalide." });
        }

        const usersRef = db.collection('users');
        const userSnapshot = await usersRef.where('telegramId', '==', telegramId).limit(1).get();

        if (userSnapshot.empty) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }

        const userData = userSnapshot.docs[0].data();
        
        // --- NOUVEAU BLOC : RÉCUPÉRER LES FILLEULS ACTIFS ET INACTIFS ---
        const referralsSnapshot = await usersRef.where('referredBy', '==', userData.referralCode).get();
        
        const activeReferrals = [];
        const inactiveReferrals = [];

        referralsSnapshot.forEach(doc => {
            const referralData = doc.data();
            const referralInfo = {
                // On prend le prénom s'il existe, sinon le username, sinon "Anonyme"
                name: referralData.firstName || referralData.telegramUsername || 'Anonyme'
            };

            if (referralData.isActive) {
                activeReferrals.push(referralInfo);
            } else {
                inactiveReferrals.push(referralInfo);
            }
        });
        // --- FIN DU NOUVEAU BLOC ---

        // On prépare les données à renvoyer, en incluant les nouvelles listes
        const referralInfo = {
            referralCode: userData.referralCode,
            referralEarnings: userData.referralEarnings || 0,
            referralCount: userData.referralCount || 0,
            activeReferrals: activeReferrals,
            inactiveReferrals: inactiveReferrals
        };

        res.status(200).json(referralInfo);

    } catch (error) {
        console.error("Erreur lors de la récupération des infos de parrainage:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

// ===============================================
// ROUTE DE CHECK-IN UTILISATEUR (POUR PARRAINAGE)
// ===============================================
app.post('/api/miniapp/user-check-in', async (req, res) => {
    try {
        const { user, referredByCode } = req.body;

        if (!user || !user.id) {
            return res.status(400).json({ message: "Données utilisateur invalides." });
        }

        const usersRef = db.collection('users');
        const userSnapshot = await usersRef.where('telegramId', '==', user.id).limit(1).get();

        let wasReferred = false; 

        // Si l'utilisateur n'existe pas, on le crée
        if (userSnapshot.empty) {
            console.log(`Check-in: Nouvel utilisateur ${user.id}. Création en cours...`);
            const newReferralCode = nanoid(8);
            const newUser = {
                telegramId: user.id,
                telegramUsername: user.username || '',
                firstName: user.first_name || '',
                referralCode: newReferralCode,
                referredBy: referredByCode || null,
                referralCount: 0,
                activeReferralCount: 0, // Nouveau champ pour le comptage V2
                isActive: false,
                referralEarnings: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            };
            await usersRef.add(newUser);
            console.log(`Nouvel utilisateur ${user.id} créé avec le code ${newReferralCode}.`);

            if (referredByCode) {
                wasReferred = true;
                const referrerSnapshot = await usersRef.where('referralCode', '==', referredByCode).limit(1).get();

                if (!referrerSnapshot.empty) {
                    const referrerDoc = referrerSnapshot.docs[0];
                    // On incrémente juste le compteur total (l'actif se fera lors du paiement)
                    await referrerDoc.ref.update({
                        referralCount: admin.firestore.FieldValue.increment(1)
                    });
                }
            }
        } else {
             console.log(`Check-in: Utilisateur existant ${user.id}.`);
        }
        
        res.status(200).json({ message: "Check-in réussi." });

        if (wasReferred) {
            try {
                const firstName = user.first_name ? `, ${escapeMarkdownV2(user.first_name)}` : '';
                const welcomeMessage = `🎉 Bienvenue sur ATEX${firstName} \\! 🎉\n\nVous avez rejoint notre communauté grâce à une invitation\\. Explorez nos services pour acheter et vendre des cryptos en toute simplicité\\.`;
                await miniAppBot.sendMessage(user.id, welcomeMessage, { parse_mode: 'MarkdownV2' });
            } catch (botError) {
                console.error(`Impossible d'envoyer le message de bienvenue à ${user.id}: ${botError.message}`);
            }
        }

    } catch (error) {
        console.error("Erreur lors du user-check-in:", error);
        if (!res.headersSent) {
            res.status(500).json({ message: "Erreur interne du serveur." });
        }
    }
});

// ===============================================
// ROUTE POUR LES DEMANDES DE RETRAIT DE GAINS
// ===============================================
app.post('/api/miniapp/request-withdrawal', async (req, res) => {
    try {
        const { telegramId, telegramUsername, amount, method, details } = req.body;

        if (!telegramId || !amount || !method || !details) {
            return res.status(400).json({ message: "Données de demande de retrait manquantes." });
        }

        const usersRef = db.collection('users');
        const userSnapshot = await usersRef.where('telegramId', '==', telegramId).limit(1).get();

        if (userSnapshot.empty) {
            return res.status(404).json({ message: "Utilisateur introuvable." });
        }

        const userDoc = userSnapshot.docs[0];
        const userData = userDoc.data();
        const currentEarnings = userData.referralEarnings || 0;

        
       // --- RÉCUPÉRATION DU SEUIL CONFIGURÉ ---
        const configDoc = await db.collection('configuration').doc('general').get();
        const config = configDoc.exists ? configDoc.data() : {};
        const minWithdrawal = config.min_withdrawal || 5; // Défaut 5 USDT si non configuré

        // --- VÉRIFICATION DE SÉCURITÉ ---
        if (amount < minWithdrawal) {
            return res.status(400).json({ message: `Le montant minimum de retrait est de ${minWithdrawal} USDT.` });
        }
        if (currentEarnings < amount) {
            return res.status(400).json({ message: "Fonds insuffisants. Vos gains ont peut-être changé." });
        }

        // 1. Débiter le compte de l'utilisateur
        await userDoc.ref.update({
            referralEarnings: admin.firestore.FieldValue.increment(-amount)
        });

        // 2. Enregistrer la demande de retrait
        const withdrawalRef = await db.collection('withdrawals').add({
            telegramId,
            telegramUsername,
            amount,
            method,
            details,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        const withdrawalId = withdrawalRef.id;

        // 3. Envoyer la notification à l'admin
        const safeUsername = escapeMarkdownV2(telegramUsername);
        const safeAmount = escapeMarkdownV2(amount.toFixed(2));
        let detailsText = '';
        if (method === 'usdt') {
            detailsText = `*Wallet:* \`${escapeMarkdownV2(details.walletAddress)}\``;
        } else {
            detailsText = `*Opérateur:* ${escapeMarkdownV2(details.provider)}\n*Numéro:* \`${escapeMarkdownV2(details.phone)}\``;
        }

        const adminMessage = `
*nouvelle DEMANDE DE RETRAIT*
${escapeMarkdownV2('--------------------------------------')}
*Client:* @${safeUsername}
*Montant:* ${safeAmount} USDT
*Méthode:* ${escapeMarkdownV2(method.toUpperCase())}
${detailsText}
        `;

        await adminBot.sendMessage(process.env.TELEGRAM_CHAT_ID, adminMessage, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Approuver", callback_data: `approve_withdrawal:${withdrawalId}` },
                        { text: "❌ Rejeter", callback_data: `reject_withdrawal:${withdrawalId}` }
                    ]
                ]
            }
        });

        res.status(200).json({ message: "Votre demande de retrait a été soumise. Elle sera traitée prochainement." });

    } catch (error) {
        console.error("Erreur lors de la demande de retrait:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
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
        await adminBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });

        // 3. Mettre à jour le statut de l'utilisateur
        await userRef.update({ kyc_status: 'submitted' });

        res.status(200).json({ message: 'Votre demande de vérification a bien été envoyée.' });

    } catch (error) {
        console.error("Erreur lors de la soumission KYC avancée:", error);
        res.status(500).json({ message: 'Erreur serveur lors de la soumission de vos documents.' });
    }
});

// ================= LOGIQUE DU WORKER (V5.1 - COINMARKETCAP ROBUSTE) =================
async function updateMarketPrices() {
    console.log("Le worker (CoinMarketCap) de mise à jour des prix démarre...");
    try {
        const coinIds = '1,1027,825,1839,1958,52,3890,11419'; // BTC, ETH, USDT, BNB, TRX, XRP, MATIC, TON
        const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest';

        const response = await axios.get(url, {
            params: { id: coinIds, convert: 'USDT' },
            headers: { 'X-CMC_PRO_API_KEY': process.env.COINMARKETCAP_API_KEY }
        });

        const prices = response.data.data;
        const structuredPrices = {};

        if (!prices || Object.keys(prices).length === 0) {
            console.warn("Avertissement: L'API CoinMarketCap a renvoyé une réponse vide ou invalide.");
            return;
        }

        const assignPrice = (id, key) => {
            const priceData = prices[id]?.quote?.USDT?.price;
            if (typeof priceData === 'number') { // Vérifie que le prix n'est pas null
                structuredPrices[key] = priceData;
            }
        };

        assignPrice('1', 'btc');
        assignPrice('1027', 'eth');
        assignPrice('825', 'usdt');
        assignPrice('1839', 'bnb');
        assignPrice('1958', 'trx');
        assignPrice('52', 'xrp');
        assignPrice('3890', 'matic');
        assignPrice('11419', 'ton');

        const docRef = db.collection('market_data').doc('realtime_usdt_prices');
        await docRef.set({
            prices: structuredPrices,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            source: 'CoinMarketCap'
        });
        console.log("Prix en USDT mis à jour avec succès dans Firestore via CoinMarketCap.");

    } catch (error) {
        console.error("Erreur dans le worker de mise à jour des prix (CoinMarketCap):", error.message);
        throw error;
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
        // 1. Récupérer les prix en temps réel
        const realTimePricesDoc = await db.collection('market_data').doc('realtime_usdt_prices').get();
        const realTimePrices = realTimePricesDoc.exists ? realTimePricesDoc.data().prices : {};

        // 2. Récupérer les taux manuels
        const manualRatesDoc = await db.collection('configuration').doc('manual_rates').get();
        const manualRates = manualRatesDoc.exists ? manualRatesDoc.data().rates : {};

        // 3. (NOUVEAU) Récupérer la liste des cryptos actives
        const cryptoListDoc = await db.collection('configuration').doc('crypto_list').get();
        const activeCryptos = cryptoListDoc.exists ? (cryptoListDoc.data().list || []) : [];

        // 4. Calculer les prix finaux (dynamique)
        const finalAtexPrices = {};
        
        // On ne génère des prix QUE pour les cryptos qui sont dans notre liste active
        // Si la liste est vide (premier lancement), on utilise les anciennes clés manuelles par sécurité ou on renvoie vide.
        const keysToProcess = activeCryptos.length > 0 ? activeCryptos.map(c => c.id) : Object.keys(manualRates);

        // --- CORRECTIF : Normalisation pour correspondance robuste ---
        const normalize = (str) => str ? str.toString().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
        const normalizedRates = {};
        Object.keys(manualRates).forEach(k => normalizedRates[normalize(k)] = manualRates[k]);
        // -------------------------------------------------------------

        keysToProcess.forEach(key => {
            let marketKey = key;
            if (activeCryptos.length > 0) {
                 const cryptoConf = activeCryptos.find(c => c.id === key);
                 if (cryptoConf) marketKey = (cryptoConf.marketKey || cryptoConf.symbol).toLowerCase();
            } else {
                 marketKey = key.split('_')[0]; 
            }

            // Recherche intelligente : Clé exacte OU Clé normalisée
            const rateData = manualRates[key] || normalizedRates[normalize(key)];

            if (rateData && realTimePrices[marketKey]) {
                const priceInUSDT = realTimePrices[marketKey];
                finalAtexPrices[key] = {
                    buy: priceInUSDT * (rateData.buy || 0),
                    sell: priceInUSDT * (rateData.sell || 0)
                };
            } else {
                console.warn(`[Prix Manquant] Impossible de calculer le prix pour : ${key} (MarketKey: ${marketKey})`);
            }
        });
        
        res.status(200).json({ 
            atexPrices: finalAtexPrices,
            availableCryptos: activeCryptos // C'est ici que la magie opère pour le frontend
        });

    } catch (error) {
        console.error("Erreur lors de la construction de la configuration des prix:", error);
        // On relance le worker au cas où les prix temps réel seraient manquants
        updateMarketPrices().catch(console.error);
        res.status(500).json({ message: "Erreur de configuration des prix. Veuillez réessayer dans un instant." });
    }
});

app.post('/api/initiate-transaction', identifyOptionalUser, async (req, res) => {
    try {
        const transactionData = req.body;
        let userId = 'anonymous'; // Par défaut, la transaction est anonyme

        if (!transactionData.type || !transactionData.amountToSend || !transactionData.paymentMethod || !transactionData.amountToReceive) {
            return res.status(400).json({ message: "Données de transaction manquantes ou invalides." });
        }

        // Si un utilisateur est identifié, on applique les règles spécifiques
        if (req.user) {
            userId = req.user.id;

            // Règles de montant minimum
            const MIN_BTC_PURCHASE = 50000;
            if (transactionData.type === 'buy' && transactionData.currencyTo === 'BTC' && transactionData.amountToSend < MIN_BTC_PURCHASE) {
                return res.status(400).json({ message: `Le montant minimum d'achat pour le Bitcoin est de ${MIN_BTC_PURCHASE.toLocaleString('fr-FR')} FCFA.` });
            }
            const MIN_ETH_PURCHASE = 35000;
            if (transactionData.type === 'buy' && transactionData.currencyTo === 'ETH' && transactionData.amountToSend < MIN_ETH_PURCHASE) {
                return res.status(400).json({ message: `Le montant minimum d'achat pour l'Ethereum est de ${MIN_ETH_PURCHASE.toLocaleString('fr-FR')} FCFA.` });
            }

            // Règle de la limite de vente mensuelle
            if (transactionData.type === 'sell') {
                const USER_LIMIT = 100000;
                const currentTransactionAmount = Number(transactionData.amountToReceive);
                const existingVolume = await calculateUserMonthlyVolume(userId);

                if ((existingVolume + currentTransactionAmount) > USER_LIMIT) {
                    return res.status(403).json({ 
                        message: `Limite de vente mensuelle de ${USER_LIMIT.toLocaleString('fr-FR')} FCFA atteinte.` 
                    });
                }
            }
        }

        // Sauvegarde de la transaction
        const transactionToSave = {
          ...transactionData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
          userId: userId // Sauvegarde avec l'ID de l'utilisateur ou 'anonymous'
        };
        await db.collection('transactions').add(transactionToSave);

        // Création de l'URL WhatsApp
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

app.get('/api/faqs', async (req, res) => {
  // On trie par date de création pour un ordre cohérent
  const query = `*[_type == "faq"] | order(_createdAt asc){ question, answer }`;
  try {
    const faqs = await client.fetch(query);
    res.status(200).json(faqs);
  } catch (error) {
    console.error("Erreur Sanity (faqs):", error);
    res.status(500).json({ message: "Erreur lors de la récupération des FAQs." });
  }
});

// ===============================================
// NOUVELLES ROUTES ADMIN : GESTION DES RETRAITS (PHASE 2)
// ===============================================

// 1. Récupérer les retraits en attente
app.get('/api/admin/withdrawals/pending', verifyAdminToken, async (req, res) => {
    try {
        const withdrawalsRef = db.collection('withdrawals').where('status', '==', 'pending').orderBy('createdAt', 'desc');
        const snapshot = await withdrawalsRef.get();

        if (snapshot.empty) return res.status(200).json([]);

        const withdrawals = snapshot.docs.map(doc => {
            const data = doc.data();
            if (data.createdAt && data.createdAt.toDate) {
                data.createdAt = { _seconds: data.createdAt.seconds };
            }
            return { id: doc.id, ...data };
        });

        res.status(200).json(withdrawals);
    } catch (error) {
        console.error("Erreur récupération retraits:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 2. Approuver un retrait (Avec preuve de paiement)
app.post('/api/admin/withdrawals/:id/approve', verifyAdminToken, async (req, res) => {
    const { id } = req.params;
    const { proof } = req.body; // Hash de transaction ou réf Mobile Money

    try {
        const withdrawalRef = db.collection('withdrawals').doc(id);
        const doc = await withdrawalRef.get();
        if (!doc.exists) return res.status(404).json({ message: "Retrait introuvable." });

        const data = doc.data();
        if (data.status !== 'pending') return res.status(400).json({ message: "Ce retrait n'est plus en attente." });

        // Mise à jour statut + preuve
        await withdrawalRef.update({ 
            status: 'completed',
            proof: proof || 'Non fournie',
            processedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Notification Client
        const message = `✅ *RETRAIT VALIDÉ !*\n\nVotre demande de ${data.amount} USDT a été traitée.\n\n📄 *Preuve/Réf :* \`${proof || 'N/A'}\`\n\nMerci de votre confiance !`;
        try { await miniAppBot.sendMessage(data.telegramId, message, { parse_mode: 'Markdown' }); } catch (e) {}

        res.status(200).json({ message: "Retrait validé." });
    } catch (error) {
        console.error("Erreur validation retrait:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// 3. Rejeter un retrait (Avec remboursement automatique)
app.post('/api/admin/withdrawals/:id/reject', verifyAdminToken, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    try {
        const withdrawalRef = db.collection('withdrawals').doc(id);
        const doc = await withdrawalRef.get();
        if (!doc.exists) return res.status(404).json({ message: "Retrait introuvable." });

        const data = doc.data();
        if (data.status !== 'pending') return res.status(400).json({ message: "Ce retrait n'est plus en attente." });

        // 1. Rembourser l'utilisateur
        const userSnapshot = await db.collection('users').where('telegramId', '==', data.telegramId).limit(1).get();
        if (!userSnapshot.empty) {
            await userSnapshot.docs[0].ref.update({
                referralEarnings: admin.firestore.FieldValue.increment(data.amount)
            });
        }

        // 2. Marquer comme rejeté
        await withdrawalRef.update({ 
            status: 'cancelled',
            rejectReason: reason || 'Non spécifiée',
            processedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Notification Client
        const message = `❌ *RETRAIT REJETÉ*\n\nVotre demande de ${data.amount} USDT a été refusée.\n💬 *Raison :* ${reason}\n\n💰 Vos fonds ont été remboursés sur votre solde.`;
        try { await miniAppBot.sendMessage(data.telegramId, message, { parse_mode: 'Markdown' }); } catch (e) {}

        res.status(200).json({ message: "Retrait rejeté et remboursé." });
    } catch (error) {
        console.error("Erreur rejet retrait:", error);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// ===============================================
// NOUVELLES ROUTES ADMIN : BROADCAST (PHASE 4)
// ===============================================

// Fonction utilitaire pour attendre (Pause)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/admin/broadcast', verifyAdminToken, async (req, res) => {
    const { message, imageUrl, buttonText, buttonUrl, isTest } = req.body;

    if (!message) return res.status(400).json({ message: "Le message est vide." });

    // --- MODE TEST : ENVOI AUX ADMINS DU .ENV ---
    if (isTest) {
        try {
            // 1. Récupérer la liste des IDs admins depuis le .env
            const adminIds = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(id => id.trim()).filter(id => id);

            if (adminIds.length === 0) {
                return res.status(400).json({ message: "Aucun ID Admin trouvé dans la configuration (.env)." });
            }

            // 2. Préparer le message
            let reply_markup = {};
            if (buttonText && buttonUrl) {
                reply_markup = { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] };
            }

            // 3. Envoyer à chaque admin de la liste
            let successCount = 0;
            for (const targetId of adminIds) {
                try {
                    if (imageUrl) {
                        await miniAppBot.sendPhoto(targetId, imageUrl, { caption: message, reply_markup });
                    } else {
                        await miniAppBot.sendMessage(targetId, message, { reply_markup });
                    }
                    successCount++;
                } catch (e) {
                    console.error(`Echec envoi test à l'admin ${targetId}:`, e.message);
                }
            }

            if (successCount === 0) {
                return res.status(500).json({ message: "Échec de l'envoi du test (vérifiez si les admins ont démarré le bot)." });
            }

            return res.status(200).json({ message: `Test envoyé à ${successCount} administrateur(s) !` });

        } catch (error) {
            console.error("Erreur Test Broadcast:", error);
            return res.status(500).json({ message: "Erreur lors de l'envoi du test." });
        }
    }

    // --- MODE DIFFUSION (VRAI ENVOI) ---
    // Répondre immédiatement à l'admin
    res.status(200).json({ message: "Diffusion démarrée en arrière-plan ! Vous recevrez un rapport quand ce sera fini." });

    (async () => {
        console.log("📢 Démarrage de la diffusion...");
        try {
            const usersSnapshot = await db.collection('users').get();
            const targets = [];
            usersSnapshot.forEach(doc => {
                const d = doc.data();
                if (d.telegramId) targets.push(d.telegramId);
            });

            const uniqueTargets = [...new Set(targets)];
            
            let reply_markup = {};
            if (buttonText && buttonUrl) {
                reply_markup = { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] };
            }

            let successCount = 0;
            let failureCount = 0;

            for (const userId of uniqueTargets) {
                try {
                    if (imageUrl) {
                        await miniAppBot.sendPhoto(userId, imageUrl, { caption: message, reply_markup });
                    } else {
                        await miniAppBot.sendMessage(userId, message, { reply_markup });
                    }
                    successCount++;
                } catch (err) {
                    failureCount++;
                }
                await sleep(50); // Pause anti-ban
            }

            const reportMsg = `📊 **RAPPORT DE DIFFUSION**\n✅ Succès : ${successCount}\n❌ Échecs : ${failureCount}\n📢 Total visé : ${uniqueTargets.length}`;
            await adminBot.sendMessage(process.env.TELEGRAM_CHAT_ID, reportMsg, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error("Erreur critique Broadcast:", error);
        }
    })();
});

// ===============================================
// SECTION 5 : SUPPORT CLIENT "ATEX DESK" (CORRIGÉ V3.1)
// ===============================================

// A. GESTION DES MESSAGES UTILISATEURS (DM -> GROUPE ADMIN)
supportBot.on('message', async (msg) => {
    // On ignore les messages du groupe support et des bots
    if (msg.chat.type !== 'private' || msg.from.is_bot) return;

    const userId = msg.from.id;
    const supportGroupId = process.env.TELEGRAM_SUPPORT_GROUP_ID;
    
    // --- 1. GESTION DU /START (Message de Bienvenue) ---
    if (msg.text === '/start') {
        const welcomeMsg = `
👋 **Bonjour et bienvenue au Support ATEX !**

Je suis là pour vous aider. 
Posez votre question ou décrivez votre problème ci-dessous, et un administrateur vous répondra dans les plus brefs délais.

_Notre équipe est disponible 7j/7._
        `;
        // On envoie le message et ON S'ARRÊTE LÀ (on ne crée pas de ticket vide pour un simple start)
        return supportBot.sendMessage(userId, welcomeMsg, { parse_mode: 'Markdown' });
    }
    // --- FIN GESTION START ---

    const username = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Inconnu');

    try {
        // 2. Chercher si l'utilisateur a déjà un Topic ouvert
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('telegramId', '==', userId).limit(1).get();
        
        let userDoc = null;
        let supportTopicId = null;

        if (!snapshot.empty) {
            userDoc = snapshot.docs[0];
            supportTopicId = userDoc.data().supportTopicId;
        }

        // 3. Si pas de Topic, on le crée
        if (!supportTopicId) {
            // Création du Topic
            const topicName = `${msg.from.first_name || 'Client'} (${userId})`;
            const topic = await supportBot.createForumTopic(supportGroupId, topicName);
            supportTopicId = topic.message_thread_id;

            // Sauvegarde DB
            if (userDoc) {
                await userDoc.ref.update({ supportTopicId: supportTopicId });
            } else {
                await usersRef.add({
                    telegramId: userId,
                    telegramUsername: msg.from.username || '',
                    supportTopicId: supportTopicId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isGuest: true
                });
            }

            // Envoyer la Carte d'Identité (SANS MARKDOWN SUR LE PSEUDO pour éviter les crashs)
            const infoMsg = `🎫 NOUVEAU TICKET\n👤 Client : ${username}\n🆔 ID : ${userId}\n--------------------------------\nLe client attend votre réponse.`;
            
            await supportBot.sendMessage(supportGroupId, infoMsg, { 
                message_thread_id: supportTopicId
                // On retire parse_mode ici pour la sécurité
            });
        }

        // 4. Transférer le message du client (Avec système d'Auto-Réparation)
        const forwardedMsg = await supportBot.forwardMessage(supportGroupId, userId, msg.message_id, {
            message_thread_id: supportTopicId
        });

        // --- SELF-HEALING: DÉTECTION SUJET SUPPRIMÉ ---
        // Si on visait un sujet précis mais que le message est arrivé sans ID de sujet (donc dans Général)
        if (supportTopicId && !forwardedMsg.message_thread_id) {
            console.log(`[Support] Le sujet ${supportTopicId} a été supprimé manuellement. Régénération...`);
            
            // A. Nettoyage : On supprime le message perdu dans Général
            try { await supportBot.deleteMessage(supportGroupId, forwardedMsg.message_id); } catch(e) {}

            // B. Reset : On crée un tout nouveau topic
            const newTopicName = `${msg.from.first_name || 'Client'} (${userId})`;
            const newTopic = await supportBot.createForumTopic(supportGroupId, newTopicName);
            const newTopicId = newTopic.message_thread_id;

            // C. Sauvegarde : On met à jour la base de données avec le nouvel ID
            if (userDoc) {
                await userDoc.ref.update({ supportTopicId: newTopicId });
            }

            // D. Info : On prévient l'admin dans le nouveau ticket
            await supportBot.sendMessage(supportGroupId, `♻️ **TICKET RESTAURÉ**\n(L'ancien sujet a été supprimé)\n👤 ${username}`, { message_thread_id: newTopicId });

            // E. Transfert : On remet le message du client au bon endroit
            await supportBot.forwardMessage(supportGroupId, userId, msg.message_id, {
                message_thread_id: newTopicId
            });
        }
        // --- FIN SELF-HEALING ---

    } catch (error) {
        console.error("Erreur ATEX Desk:", error.message);
        // En cas d'erreur critique, on prévient l'utilisateur
        if (error.message.includes("topic")) {
             supportBot.sendMessage(userId, "Une erreur technique empêche l'ouverture du ticket. Veuillez réessayer plus tard.");
        }
    }
});

// B. GESTION DES RÉPONSES ADMIN (GROUPE ADMIN -> DM UTILISATEUR)
supportBot.on('message', async (msg) => {
    if (msg.chat.id.toString() !== process.env.TELEGRAM_SUPPORT_GROUP_ID) return;
    if (!msg.message_thread_id || msg.is_topic_message === false) return;
    if (msg.forward_from) return; // On ignore les forwards

    const topicId = msg.message_thread_id;

    try {
        // Retrouver le client lié au topic
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('supportTopicId', '==', topicId).limit(1).get();

        if (snapshot.empty) return; 

        const clientTelegramId = snapshot.docs[0].data().telegramId;

        // Commandes Admin
        if (msg.text && msg.text.startsWith('/')) {
            if (msg.text === '/rib') {
                const ribMsg = `💳 **Moyens de Paiement :**\n\n🍊 Orange Money: \`+221 78 680 01 12\`\n🌊 Wave: \`+221 77 705 44 93\`\n🟡 Moov: \`+228 98 21 60 99\``;
                await supportBot.sendMessage(msg.chat.id, "✅ RIB envoyé.", { message_thread_id: topicId });
                return await supportBot.sendMessage(clientTelegramId, ribMsg, { parse_mode: 'Markdown' });
            }
        }

        // Copier la réponse au client
        await supportBot.copyMessage(clientTelegramId, msg.chat.id, msg.message_id);

    } catch (error) {
        console.error("Erreur Admin->Client:", error.message);
    }
});

// --- GESTION DES ROUTES FRONTEND ET DÉMARRAGE ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- GESTION DES ROUTES FRONTEND ET DÉMARRAGE ---
// Cette route "catch-all" doit être la DERNIÈRE route de votre fichier, juste avant app.listen.
// Elle sert à renvoyer votre fichier index.html pour n'importe quelle URL non interceptée par l'API.
//app.get('*', (req, res) => {
  //res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
//});

// On exécute le worker une première fois au démarrage pour garantir des prix frais.
//console.log("Exécution initiale du worker de prix au démarrage du serveur...");
//updateMarketPrices();

// Démarrage du serveur.
app.listen(PORT, () => {
  console.log(`Le serveur ATEX écoute sur le port ${PORT}`);
});