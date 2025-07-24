// Importer les dépendances nécessaires
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ===================================================================
// === CONFIGURATION DE FIREBASE (SÉCURISÉE POUR LA PRODUCTION) ===
// ===================================================================
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : require(path.join(__dirname, '..', 'serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// ===================================================================

// --- CONFIGURATION D'EXPRESS ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());

// --- ROUTES DE L'API ---

// Route pour récupérer la configuration
app.get('/api/config', async (req, res) => {
  try {
    const docRef = db.collection('configuration').doc('rates_and_fees');
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Le document de configuration est introuvable." });
    }
    res.status(200).json(doc.data());
  } catch (error) {
    console.error("Erreur lors de la récupération de la configuration:", error);
    res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// Route pour initier une transaction
app.post('/api/initiate-transaction', async (req, res) => {
  try {
    const transactionData = req.body;

    if (!transactionData.type || !transactionData.amountToSend || !transactionData.paymentMethod) {
      return res.status(400).json({ message: "Données de transaction manquantes ou invalides." });
    }

    const transactionToSave = {
      ...transactionData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending'
    };

    await db.collection('transactions').add(transactionToSave);

    let message = '';
    if (transactionData.type === 'buy') {
      message = `Bonjour ATEX, je souhaite initier un NOUVEL ACHAT :\n- Montant à payer : ${transactionData.amountToSend} FCFA\n- Crypto à recevoir : ${transactionData.amountToReceive.toFixed(4)} ${transactionData.currencyTo}\n- Mon adresse Wallet : ${transactionData.walletAddress}\n- Moyen de paiement : ${transactionData.paymentMethod}`;
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

// Routes pour le contenu dynamique (CMS)
app.get('/api/press-articles', async (req, res) => {
    try {
        const snapshot = await db.collection('press_articles').orderBy('publishedDate', 'desc').get();
        if (snapshot.empty) {
            return res.status(200).json([]);
        }
        const articles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(articles);
    } catch (error) {
        console.error("Erreur lors de la récupération des articles de presse:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});

app.get('/api/knowledge-articles', async (req, res) => {
    try {
        const snapshot = await db.collection('knowledge_articles').orderBy('createdAt', 'desc').get();
        if (snapshot.empty) {
            return res.status(200).json([]);
        }
        const articles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(articles);
    } catch (error) {
        console.error("Erreur lors de la récupération des articles de savoir:", error);
        res.status(500).json({ message: "Erreur interne du serveur." });
    }
});


// --- SERVICE DES FICHIERS FRONTEND (APRÈS LES ROUTES API) ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route pour servir l'application principale (si l'URL est appelée directement)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});


// --- DÉMARRAGE DU SERVEUR ---
app.listen(PORT, () => {
  console.log(`Le serveur ATEX écoute sur le port ${PORT}`);
  console.log(`Accédez à l'application sur http://localhost:${PORT}`);
});