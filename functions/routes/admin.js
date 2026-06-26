const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { callGemini, extractSkillInstructions } = require('../services/gemini');

router.get('/status', (req, res) => {
    res.json({ status: 'admin-router-active' });
});

// GET /logs - Fetch list of logs
router.get('/logs', async (req, res) => {
    try {
        const db = admin.firestore();
        let query = db.collection('ai_logs').orderBy('timestamp', 'desc');
        
        const { skill, uid, is_golden, limit = 50 } = req.query;
        if (skill) {
            query = query.where('skill', '==', skill);
        }
        if (uid) {
            query = query.where('uid', '==', uid);
        }
        if (is_golden) {
            query = query.where('is_golden', '==', is_golden === 'true');
        }
        
        const snapshot = await query.limit(Number(limit)).get();
        const logs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            logs.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            });
        });
        
        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /golden - List all golden logs
router.get('/golden', async (req, res) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection('ai_logs')
            .where('is_golden', '==', true)
            .orderBy('timestamp', 'desc')
            .get();
        
        const logs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            logs.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            });
        });
        
        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /golden - Toggle golden tag on a log
router.post('/golden', async (req, res) => {
    try {
        const { logId, isGolden } = req.body;
        if (!logId) {
            return res.status(400).json({ error: 'Missing logId.' });
        }
        
        const db = admin.firestore();
        const logRef = db.collection('ai_logs').doc(logId);
        await logRef.update({
            is_golden: !!isGolden
        });
        
        res.json({ success: true, logId, is_golden: !!isGolden });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /replay - Re-run prompt against live model
router.post('/replay', async (req, res) => {
    try {
        const { prompt, skill, model } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Missing prompt.' });
        }
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API Key not configured.' });
        }
        
        let systemPrompt = "You are an expert System Architect. Output valid MapState JSON.";
        try {
            const skillPath = path.join(__dirname, '..', 'skills', skill || 'generate-mapstate', 'SKILL.md');
            if (fs.existsSync(skillPath)) {
                const skillContent = fs.readFileSync(skillPath, 'utf8');
                systemPrompt = extractSkillInstructions(skillContent);
            }
        } catch (e) {
            // Fallback
        }
        
        const result = await callGemini(systemPrompt, prompt, apiKey, model || 'gemini-2.5-flash');
        res.json({ text: result.text });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

