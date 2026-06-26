const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');

const getNextMidnightUTC = () => {
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0, 0, 0, 0
    ));
    return nextMidnight;
};

module.exports = async (req, res, next) => {
    let quotaDetails = { limit: 5, remaining: 5, reset_at: null };
    try {
        if (!req.user) {
            logger.warn("RateLimit middleware invoked without req.user populated. Failing open.");
            return next();
        }

        const db = admin.firestore();
        const { uid, isAnonymous } = req.user;
        const limit = isAnonymous ? 5 : 25;
        quotaDetails.limit = limit;
        quotaDetails.remaining = limit;
        
        const quotaRef = isAnonymous 
            ? db.collection('anon_quotas').doc(uid)
            : db.collection('users').doc(uid).collection('quota').doc('active');

        const { Timestamp } = require('firebase-admin/firestore');
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(quotaRef);
            const now = new Date();
            let dailyCount = 0;
            let resetAt = getNextMidnightUTC();

            if (doc.exists) {
                const data = doc.data();
                dailyCount = data.daily_count || 0;
                
                const dbResetAt = data.reset_at ? data.reset_at.toDate() : null;
                if (dbResetAt && dbResetAt > now) {
                    resetAt = dbResetAt;
                } else {
                    dailyCount = 0;
                }
            }

            if (dailyCount >= limit) {
                quotaDetails.remaining = 0;
                quotaDetails.reset_at = resetAt.toISOString();
                throw new Error("RATE_LIMIT_EXCEEDED");
            }

            dailyCount += 1;
            
            transaction.set(quotaRef, {
                daily_count: dailyCount,
                reset_at: Timestamp.fromDate(resetAt)
            }, { merge: true });

            quotaDetails.remaining = limit - dailyCount;
            quotaDetails.reset_at = resetAt.toISOString();
        });

        req.quota = quotaDetails;
        next();

    } catch (err) {
        if (err.message === "RATE_LIMIT_EXCEEDED") {
            return res.status(429).json({
                error: 'Rate limit exceeded.',
                limit: quotaDetails.limit,
                remaining: 0,
                reset_at: quotaDetails.reset_at
            });
        }
        
        logger.error("Rate Limiter error, failing open:", err);
        // Fail-open for robustness
        const isAnon = req.user ? req.user.isAnonymous : true;
        req.quota = { 
            limit: isAnon ? 5 : 25, 
            remaining: 1, 
            reset_at: getNextMidnightUTC().toISOString() 
        };
        next();
    }
};

