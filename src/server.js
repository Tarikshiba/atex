// Importer les dépendances nécessaires
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@sanity/client');
const axios = require('axios'); // <- On importe axios
require('dotenv').config();

// --- CONFIGURATION DE FIREBASE (pour les transactions et la config des frais) ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- CONFIGURATION DE SANITY (pour le contenu) ---
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


// ================= NOUVELLE LOGIQUE DE PRIX DYNAMIQUES =================

// Notre cache en mémoire pour stocker les prix temporairement
const cache = {
  prices: null,
  lastFetch: 0
};
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes en millisecondes

// Mapping de nos symboles internes vers les IDs de CoinGecko
const coinGeckoMapping = {
  usdt: 'tether',
  btc: 'bitcoin',
  eth: 'ethereum',
  ltc: 'litecoin',
  xrp: 'ripple',
  trx: 'tron',
  bnb: 'binance-coin'
};

// Route pour la configuration (maintenant dynamique)
app.get('/api/config', async (req, res) => {
  try {
    const now = Date.now();
    let pricesFromApi;

    // 1. Vérifier le cache
    if (cache.prices && (now - cache.lastFetch < CACHE_DURATION)) {
      pricesFromApi = cache.prices;
    } else {
      // 2. Si le cache est vide ou expiré, appeler l'API CoinGecko
      const ids = Object.values(coinGeckoMapping).join(',');
      const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=xof`;
      
      const response = await axios.get(apiUrl);
      const rawPrices = response.data;

      // 3. Formater les prix pour notre application
      pricesFromApi = {};
      for (const symbol in coinGeckoMapping) {
        const coingeckoId = coinGeckoMapping[symbol];
        if (rawPrices[coingeckoId]) {
          pricesFromApi[symbol] = rawPrices[coingeckoId].xof;
        }
      }
      
      // 4. Mettre à jour notre cache
      cache.prices = pricesFromApi;
      cache.lastFetch = now;
    }

    // 5. Récupérer la configuration des frais depuis Firestore
    const docRef = db.collection('configuration').doc('rates_and_fees');
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Le document de configuration des frais est introuvable." });
    }
    const feeConfig = doc.data();

    // 6. Envoyer la configuration complète au frontend
    res.status(200).json({ 
      marketRates: pricesFromApi,
      fees: feeConfig
    });

  } catch (error) {
    console.error("Erreur lors de la récupération de la configuration dynamique:", error);
    // En cas d'erreur de l'API externe, on peut utiliser le cache si disponible
    if (cache.prices) {
        const docRef = db.collection('configuration').doc('rates_and_fees');
        const doc = await docRef.get();
        const feeConfig = doc.data();
        res.status(200).json({ marketRates: cache.prices, fees: feeConfig });
        return;
    }
    res.status(500).json({ message: "Erreur interne du serveur lors de la récupération des prix." });
  }
});

// ================= FIN DE LA NOUVELLE LOGIQUE =================


// Route pour les transactions (écrit toujours dans Firestore)
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

// Routes de contenu (lisent Sanity)
app.get('/api/press-articles', async (req, res) => {
  const query = `*[_type == "pressArticle"]{ title, url, excerpt, "imageUrl": mainImage.asset->url, category, publishedDate, readingTime } | order(publishedDate desc)`;
  try {
    const articles = await client.fetch(query);
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

app.listen(PORT, () => {
  console.log(`Le serveur ATEX écoute sur le port ${PORT}`);
});