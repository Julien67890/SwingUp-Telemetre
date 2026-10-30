/* =======================================================================
   SwingUp — Télémètre · Cloud Functions (projet Firebase swingup-telemetre)

   verifierAchatPlay : appelée par l'app Android après un achat Google Play
   (et à chaque connexion pour les abonnements actifs du téléphone).
     1. vérifie l'identité de l'utilisateur (jeton Firebase) ;
     2. interroge l'API Google Play Developer sur le jeton d'achat ;
     3. valide (« acknowledge ») l'achat — sinon Google le rembourse sous 3 jours ;
     4. écrit l'état dans users/{uid}/billing/status, que l'app lit.

   Prérequis (une fois) :
     - Firebase en formule Blaze ;
     - API « Google Play Android Developer API » activée dans Google Cloud ;
     - le compte de service des fonctions invité dans la Play Console
       (Utilisateurs et autorisations) avec « Afficher les données financières »
       et « Gérer les commandes et les abonnements ».
   ======================================================================= */
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();
const db = admin.firestore();

const PACKAGE = 'app.emqgroup.swinguprangefinder';
const PRODUITS = { premium_mois: 'mois', premium_an: 'an' };
const ETATS_ACTIFS = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];

async function playApi() {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  return google.androidpublisher({ version: 'v3', auth: await auth.getClient() });
}

exports.verifierAchatPlay = onRequest(
  { region: 'europe-west1', cors: ['https://julien67890.github.io'] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
    try {
      const idToken = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const { uid } = await admin.auth().verifyIdToken(idToken);

      const { packageName, productId, purchaseToken } = req.body || {};
      if (packageName !== PACKAGE || !PRODUITS[productId] || typeof purchaseToken !== 'string' || !purchaseToken) {
        return res.status(400).json({ error: 'requête invalide' });
      }

      /* Un jeton d'achat n'appartient qu'à un seul compte : empêche de partager
         un abonnement en se connectant à plusieurs comptes sur le même téléphone. */
      const lien = db.collection('playTokens').doc(purchaseToken.slice(0, 1400).replace(/\//g, '_'));
      const deja = await lien.get();
      if (deja.exists && deja.data().uid !== uid) return res.status(409).json({ error: 'achat lié à un autre compte' });

      const api = await playApi();
      const { data: sub } = await api.purchases.subscriptionsv2.get({ packageName: PACKAGE, token: purchaseToken });
      const ligne = (sub.lineItems || []).find(l => l.productId === productId) || (sub.lineItems || [])[0];
      if (!ligne || !PRODUITS[ligne.productId]) return res.status(400).json({ error: 'produit inconnu' });

      const actif = ETATS_ACTIFS.includes(sub.subscriptionState);
      const fin = ligne.expiryTime ? Date.parse(ligne.expiryTime) : null;

      if (actif && sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
        await api.purchases.subscriptions.acknowledge({
          packageName: PACKAGE, subscriptionId: ligne.productId, token: purchaseToken, requestBody: {}
        });
      }

      await lien.set({ uid, productId: ligne.productId, majLe: Date.now() }, { merge: true });
      await db.collection('users').doc(uid).collection('billing').doc('status').set({
        status: actif ? 'active' : 'free',
        currentPeriodEnd: fin,
        plan: ligne.productId,
        source: 'play',
        playState: sub.subscriptionState || null,
        updatedAt: Date.now()
      }, { merge: true });

      return res.json({ ok: actif, status: actif ? 'active' : 'free', currentPeriodEnd: fin });
    } catch (e) {
      console.error('verifierAchatPlay', e && e.message);
      const code = e && e.code === 'auth/argument-error' ? 401 : 500;
      return res.status(code).json({ error: 'vérification impossible' });
    }
  }
);
