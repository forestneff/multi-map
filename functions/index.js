const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin SDK
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const app = express();

// Configure global middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Import routes
const aiRouter = require('./routes/ai');
const adminRouter = require('./routes/admin');

// Mount routes
app.use('/', aiRouter);
app.use('/admin', adminRouter);

// Export the Express app as the Cloud Function entrypoint
exports.generateMapState = onRequest({ cors: true }, app);

// Scheduled job to clean up logs older than 90 days (runs daily at midnight UTC)
exports.cleanupOldLogs = onSchedule("0 0 * * *", async (event) => {
    try {
        const db = admin.firestore();
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        const snapshot = await db.collection('ai_logs')
            .where('timestamp', '<', ninetyDaysAgo)
            .get();
            
        if (snapshot.empty) {
            logger.info("No logs older than 90 days found for deletion.");
            return;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        
        await batch.commit();
        logger.info(`Successfully deleted ${snapshot.size} log documents older than 90 days.`);
    } catch (err) {
        logger.error("Failed to clean up old AI request logs:", err);
    }
});


