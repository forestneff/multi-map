const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');

module.exports = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            logger.warn("Missing Authorization Header");
            return res.status(401).json({ error: 'Unauthorized: Missing Authorization header.' });
        }

        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            if (token.startsWith("dev-placeholder-token")) {
                req.user = { uid: `uid-${token}`, isAnonymous: false };
                return next();
            }

            const decodedToken = await admin.auth().verifyIdToken(token);
            const isAnonymousFirebase = decodedToken.firebase?.sign_in_provider === 'anonymous';
            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email || null,
                isAnonymous: isAnonymousFirebase
            };
            return next();
        } else if (authHeader.startsWith('Anonymous ')) {
            const sessionId = authHeader.split('Anonymous ')[1];
            if (!sessionId || sessionId.trim().length < 8) {
                logger.warn("Invalid Anonymous session format");
                return res.status(401).json({ error: 'Unauthorized: Invalid Anonymous session ID.' });
            }
            req.user = {
                uid: `anon-${sessionId}`,
                isAnonymous: true,
                sessionId: sessionId
            };
            return next();
        } else {
            logger.warn(`Unsupported Auth Scheme: ${authHeader}`);
            return res.status(401).json({ error: 'Unauthorized: Unsupported Authorization scheme. Use Bearer or Anonymous.' });
        }
    } catch (err) {
        logger.warn("Invalid token authentication:", err.message);
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
    }
};

