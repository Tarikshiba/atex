// Importer les dépendances nécessaires
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
        const { username, email } = userDoc.data();
        res.status(200).json({ username, email });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// ================= LOGIQUE DU WORKER INTÉGRÉE (V1) =================
const coinGeckoMapping = {
  usdt: 'tether',
  btc: 'bitcoin',
  bnb: 'binancecoin',
  trx: 'tron',
  xrp: 'ripple'
};
const USD_TO_XOF_RATE = 615;

async function updateMarketPrices() {
  console.log("CRON JOB: Démarrage de la mise à jour des prix...");
  try {
    const configDoc = await db.collection('configuration').doc('rates_and_fees').get();
    if (!configDoc.exists) { throw new Error("Le document de configuration est introuvable."); }
    const { marginPercentage } = configDoc.data();
    const ids = Object.values(coinGeckoMapping).join(',');
    const apiKey = process.env.COINGECKO_API_KEY;
    if (!apiKey) { throw new Error("La clé d'API CoinGecko n'est pas définie."); }
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&x_cg_demo_api_key=${apiKey}`;
    const response = await axios.get(apiUrl);
    const marketPrices = response.data;
    const atexPrices = {};
    const margin = marginPercentage / 100;
    for (const symbol in coinGeckoMapping) {
      const coingeckoId = coinGeckoMapping[symbol];
      if (marketPrices[coingeckoId] && marketPrices[coingeckoId].usd) {
        const marketPriceUSD = marketPrices[coingeckoId].usd;
        const marketPriceXOF = marketPriceUSD * USD_TO_XOF_RATE;
        atexPrices[symbol] = {
          buy: marketPriceXOF * (1 + margin),
          sell: marketPriceXOF * (1 - margin)
        };
      }
    }
    if (Object.keys(atexPrices).length === 0) { throw new Error("L'objet des prix calculés est vide après traitement."); }
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

// ================= ROUTES DE LA V1 (avec mises à jour) =================
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

app.post('/api/initiate-transaction', (req, res) => {
    try {
        let userId = null;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            if (token) {
                try {
                    const decoded = jwt.verify(token, process.env.JWT_SECRET);
                    userId = decoded.id;
                } catch (jwtError) {
                    console.warn("Token JWT invalide fourni lors de l'initiation de la transaction:", jwtError.message);
                }
            }
        }
        const transactionData = req.body;
        if (!transactionData.type || !transactionData.amountToSend || !transactionData.paymentMethod || !transactionData.amountToReceive) {
          return res.status(400).json({ message: "Données de transaction manquantes ou invalides." });
        }
        const transactionToSave = {
          ...transactionData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
          userId: userId
        };
        db.collection('transactions').add(transactionToSave).then(() => {
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
        });
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

// --- GESTION DES ROUTES FRONTEND ET DÉMARRAGE ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Le serveur ATEX écoute sur le port ${PORT}`);
});