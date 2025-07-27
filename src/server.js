// Importer les dépendances nécessaires
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@sanity/client');
const axios = require('axios');
require('dotenv').config();

// --- CONFIGURATION DE FIREBASE ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

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

// ================= LOGIQUE DU WORKER INTÉGRÉE =================

const coinGeckoMapping = {
  usdt: 'tether',
  btc: 'bitcoin',
  bnb: 'binancecoin',
  trx: 'tron',
  xrp: 'ripple'
};

// On définit un taux de change USD -> XOF (FCFA) fixe. C'est plus stable.
const USD_TO_XOF_RATE = 615;

async function updateMarketPrices() {
  console.log("CRON JOB: Démarrage de la mise à jour des prix...");
  try {
    const configDoc = await db.collection('configuration').doc('rates_and_fees').get();
    if (!configDoc.exists) {
        throw new Error("Le document de configuration est introuvable.");
    }
    const { marginPercentage } = configDoc.data();
    
    const ids = Object.values(coinGeckoMapping).join(',');
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) {
        throw new Error("La clé d'API CoinGecko n'est pas définie.");
    }

    // ON DEMANDE LES PRIX EN USD
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&x_cg_demo_api_key=${apiKey}`;
    
    const response = await axios.get(apiUrl);
    const marketPrices = response.data;

    const atexPrices = {};
    const margin = marginPercentage / 100;

    for (const symbol in coinGeckoMapping) {
      const coingeckoId = coinGeckoMapping[symbol];
      // ON VÉRIFIE MAINTENANT LE PRIX EN USD
      if (marketPrices[coingeckoId] && marketPrices[coingeckoId].usd) {
        const marketPriceUSD = marketPrices[coingeckoId].usd;
        // ON CONVERTIT EN FCFA
        const marketPriceXOF = marketPriceUSD * USD_TO_XOF_RATE;

        atexPrices[symbol] = {
          buy: marketPriceXOF * (1 + margin),
          sell: marketPriceXOF * (1 - margin)
        };
      }
    }

    // On vérifie que l'objet n'est pas vide avant de sauvegarder
    if (Object.keys(atexPrices).length === 0) {
        throw new Error("L'objet des prix calculés est vide après traitement. La réponse de l'API était peut-être anormale.");
    }

    const pricesDocRef = db.collection('market_data').doc('live_prices');
    await pricesDocRef.set({
      prices: atexPrices,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log("CRON JOB: ✅ Succès ! Les prix ATEX ont été mis à jour.");
    return "Update successful";
  } catch (error) {
    console.error("CRON JOB: ❌ Erreur lors de la mise à jour des prix:", error.response ? error.response.data : error.message);
    throw error;
  }
}

// ================= NOUVELLE ROUTE SECRÈTE POUR LE CRON =================
app.post('/api/cron/update-prices', async (req, res) => {
    try {
        const cronSecret = process.env.CRON_SECRET;
        const providedSecret = req.headers['authorization'];

        if (!cronSecret || providedSecret !== `Bearer ${cronSecret}`) {
            return res.status(401).send('Unauthorized');
        }

        await updateMarketPrices();
        res.status(200).send('Prices updated successfully.');

    } catch (error) {
        res.status(500).send('Error updating prices.');
    }
});

// Route pour la configuration
app.get('/api/config', async (req, res) => {
  try {
    const feesDocRef = db.collection('configuration').doc('rates_and_fees');
    const feesDoc = await feesDocRef.get();
    const feeConfig = feesDoc.data();

    const pricesDocRef = db.collection('market_data').doc('live_prices');
    const pricesDoc = await pricesDocRef.get();
    if (!pricesDoc.exists) {
      console.log("Les prix n'existent pas, tentative de lancement manuel du worker...");
      await updateMarketPrices();
      const newPricesDoc = await pricesDocRef.get();
      if (!newPricesDoc.exists) {
          return res.status(404).json({ message: "Les prix du marché ne sont pas encore disponibles." });
      }
      const atexPrices = newPricesDoc.data().prices;
      return res.status(200).json({ atexPrices: atexPrices, fees: feeConfig });
    }
    const atexPrices = pricesDoc.data().prices;
    
    res.status(200).json({ 
      atexPrices: atexPrices,
      fees: feeConfig
    });
  } catch (error) {
    console.error("Erreur lors de la récupération de la configuration:", error);
    res.status(500).json({ message: "Erreur interne du serveur." });
  }
});

// Route pour les transactions
app.post('/api/initiate-transaction', async (req, res) => {
  try {
    const transactionData = req.body;
    if (!transactionData.type || !transactionData.amountToSend || !transactionData.paymentMethod || !transactionData.amountToReceive) {
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

// Routes de contenu Sanity
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