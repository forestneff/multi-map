const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

module.exports = {
    logRequest: async ({ uid, sessionId, prompt, response, tokensIn, tokensOut, skill, mapId, latencyMs, error = null }) => {
        try {
            const db = admin.firestore();
            const logRef = db.collection('ai_logs').doc();
            await logRef.set({
                uid: uid || 'anonymous',
                session_id: sessionId || 'unknown',
                timestamp: FieldValue.serverTimestamp(),
                prompt: prompt || '',
                response: response || '',
                tokens_in: tokensIn || 0,
                tokens_out: tokensOut || 0,
                skill: skill || 'unknown',
                map_id: mapId || 'unknown',
                latency_ms: latencyMs || 0,
                error: error ? String(error) : null,
                is_golden: false
            });
            logger.info(`AI Log written successfully: ${logRef.id}`);
        } catch (err) {
            logger.error("Failed to write AI request log:", err);
        }
    }
};

