// =======================================================
// VERCEL SERVERLESS FUNCTION - Relais vers n8n
// =======================================================
// Cette fonction contourne les problèmes CORS en faisant
// le relais côté serveur entre le front Vercel et n8n

module.exports = async function handler(req, res) {
    // Configuration CORS pour autoriser les appels depuis le front Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Gérer les requêtes OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Vérifier la méthode
    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Method Not Allowed',
            message: 'Seul GET est autorisé'
        });
    }

    try {
        // Récupérer les paramètres
        const { action, devis_id } = req.query;

        // Validation
        if (!action || !devis_id) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Paramètres manquants: action et devis_id requis',
                received: { action, devis_id }
            });
        }

        if (!['accept', 'postpone', 'refuse'].includes(action)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: `Action invalide: "${action}". Valeurs autorisées: accept, postpone, refuse`
            });
        }

        console.log(`[VERCEL API] 📤 Relais vers n8n: action=${action}, devis_id=${devis_id}`);

        // Configuration n8n
        const N8N_WEBHOOK_URL = 'https://n8n-prod.traiteur-origin.com/webhook/gmail-actions-v3-3';
        const targetUrl = `${N8N_WEBHOOK_URL}?action=${action}&devis_id=${devis_id}`;

        // Timeout de 25 secondes (Vercel limite à 10s sur Free, 60s sur Pro)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        // Appel vers n8n
        const n8nResponse = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/html, */*',
                'User-Agent': 'Vercel-Gmail-Relay/1.0'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`[VERCEL API] 📥 Réponse n8n: status=${n8nResponse.status}`);

        // Récupérer le contenu de la réponse
        const contentType = n8nResponse.headers.get('content-type');
        let responseData;

        if (contentType && contentType.includes('application/json')) {
            responseData = await n8nResponse.json();
        } else {
            responseData = await n8nResponse.text();
        }

        // Si n8n répond avec succès
        if (n8nResponse.ok) {
            console.log(`[VERCEL API] ✅ Succès`);
            return res.status(200).json({
                success: true,
                action: action,
                devis_id: devis_id,
                n8n_status: n8nResponse.status,
                timestamp: new Date().toISOString(),
                message: 'Action traitée avec succès',
                data: responseData
            });
        } else {
            // n8n a renvoyé une erreur
            console.error(`[VERCEL API] ❌ Erreur n8n: ${n8nResponse.status}`);
            return res.status(n8nResponse.status).json({
                success: false,
                error: 'n8n Error',
                n8n_status: n8nResponse.status,
                message: `n8n a renvoyé une erreur ${n8nResponse.status}`,
                details: responseData
            });
        }

    } catch (error) {
        console.error(`[VERCEL API] 💥 Exception:`, error.message);

        // Gérer les timeouts
        if (error.name === 'AbortError') {
            return res.status(504).json({
                success: false,
                error: 'Gateway Timeout',
                message: 'n8n met trop de temps à répondre (> 25s)',
                timestamp: new Date().toISOString()
            });
        }

        // Autres erreurs
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}