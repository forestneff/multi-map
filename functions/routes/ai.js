const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('firebase-functions/logger');
const authMiddleware = require('../middleware/auth');
const rateLimitMiddleware = require('../middleware/rateLimit');
const { extractSkillInstructions, callGemini } = require('../services/gemini');
const loggerService = require('../services/logger');

router.post('/', authMiddleware, rateLimitMiddleware, async (req, res) => {
    const startTime = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let intent = 'generate-mapstate'; // Default fallback
    let promptTextLogged = '';
    
    try {
        const { prompt, contextStr, model, mapId } = req.body;
        promptTextLogged = prompt || '';
        
        if (!prompt) {
            return res.status(400).json({ error: 'Bad Request: Missing prompt.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            logger.error("GEMINI_API_KEY environment variable is not set.");
            const err = new Error("API Key not configured");
            await loggerService.logRequest({
                uid: req.user.uid,
                sessionId: req.user.sessionId || req.user.uid,
                prompt: prompt,
                response: '',
                tokensIn: 0,
                tokensOut: 0,
                skill: 'error',
                mapId: mapId || 'unknown',
                latencyMs: Date.now() - startTime,
                error: err.message
            });
            return res.status(500).json({ error: 'Internal Server Error: API Key not configured.' });
        }

        // --- STEP 1: PARSE INTENT ---
        let faqId = null;
        try {
            const intentSkillPath = path.join(__dirname, '..', 'skills', 'parse-intent', 'SKILL.md');
            const intentSkillContent = fs.readFileSync(intentSkillPath, 'utf8');
            const intentSystemPrompt = extractSkillInstructions(intentSkillContent);
            
            const intentPrompt = `User Prompt: ${prompt}\n\nCurrent Map Context (if any):\n${contextStr || 'None'}`;
            
            const intentResult = await callGemini(intentSystemPrompt, intentPrompt, apiKey, 'gemini-2.5-flash');
            totalTokensIn += intentResult.tokens_in;
            totalTokensOut += intentResult.tokens_out;
            
            let cleanJson = intentResult.text.trim();
            if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
            }
            const intentData = JSON.parse(cleanJson);
            
            if (intentData.intent) {
                intent = intentData.intent;
                if (intent === 'faq') {
                    faqId = intentData.faq_id || 'default_faq';
                }
                logger.info(`Parsed Intent: ${intent}`);
            }
        } catch (err) {
            logger.error("Error during intent parsing, falling back to generate-mapstate:", err);
        }

        // --- FAST-PATH: FAQ INTENT ---
        if (intent === 'faq') {
            try {
                const faqLibPath = path.join(__dirname, '..', 'skills', 'faq_library.json');
                const faqLibContent = fs.readFileSync(faqLibPath, 'utf8');
                const faqLib = JSON.parse(faqLibContent);
                
                const faqResponse = faqLib[faqId] || faqLib['default_faq'] || "I'm your Multi Map assistant. How can I help?";
                const outputText = JSON.stringify({ message: faqResponse });
                
                await loggerService.logRequest({
                    uid: req.user.uid,
                    sessionId: req.user.sessionId || req.user.uid,
                    prompt: prompt,
                    response: outputText,
                    tokensIn: totalTokensIn,
                    tokensOut: totalTokensOut,
                    skill: 'faq',
                    mapId: mapId || 'unknown',
                    latencyMs: Date.now() - startTime
                });

                return res.status(200).json({ 
                    text: outputText, 
                    mode: 'analyze',
                    quota: req.quota
                });
            } catch (err) {
                logger.error("Failed to load FAQ library:", err);
                intent = 'analyze-mapstate'; // Fallback if FAQ fails
            }
        }

        // --- FAST-PATH: OUT OF SCOPE ---
        if (intent === 'out-of-scope') {
            const outOfScopeResponse = "I'm sorry, but that request is outside the current scope of my abilities on the Multi Map platform. I can help you generate maps, edit nodes, or answer questions about how this platform works!";
            const outputText = JSON.stringify({ message: outOfScopeResponse });
            
            await loggerService.logRequest({
                uid: req.user.uid,
                sessionId: req.user.sessionId || req.user.uid,
                prompt: prompt,
                response: outputText,
                tokensIn: totalTokensIn,
                tokensOut: totalTokensOut,
                skill: 'out-of-scope',
                mapId: mapId || 'unknown',
                latencyMs: Date.now() - startTime
            });

            return res.status(200).json({ 
                text: outputText, 
                mode: 'analyze',
                quota: req.quota
            });
        }

        // --- STEP 2: LOAD SPECIFIC SKILL ---
        let systemPrompt = '';
        try {
            const validIntents = ['generate-mapstate', 'generate-web-mapstate', 'edit-mapstate', 'analyze-mapstate'];
            if (!validIntents.includes(intent)) {
                intent = 'generate-mapstate';
            }

            const skillPath = path.join(__dirname, '..', 'skills', intent, 'SKILL.md');
            const skillContent = fs.readFileSync(skillPath, 'utf8');
            systemPrompt = extractSkillInstructions(skillContent);
        } catch (err) {
            logger.error(`Failed to load skill for intent ${intent}:`, err);
            
            await loggerService.logRequest({
                uid: req.user.uid,
                sessionId: req.user.sessionId || req.user.uid,
                prompt: prompt,
                response: '',
                tokensIn: totalTokensIn,
                tokensOut: totalTokensOut,
                skill: intent,
                mapId: mapId || 'unknown',
                latencyMs: Date.now() - startTime,
                error: err.message
            });

            return res.status(500).json({ error: `Internal Server Error: Missing skill file for ${intent}` });
        }

        // --- STEP 3: GENERATE FINAL OUTPUT ---
        const contextualPrompt = prompt + (contextStr ? "\n\n" + contextStr : "");
        const generationModel = model || 'gemini-2.5-flash';
        try {
            const generationResult = await callGemini(systemPrompt, contextualPrompt, apiKey, generationModel);
            totalTokensIn += generationResult.tokens_in;
            totalTokensOut += generationResult.tokens_out;
            
            let mode = 'generate';
            if (intent === 'edit-mapstate') mode = 'edit';
            else if (intent === 'analyze-mapstate') mode = 'analyze';

            await loggerService.logRequest({
                uid: req.user.uid,
                sessionId: req.user.sessionId || req.user.uid,
                prompt: prompt,
                response: generationResult.text,
                tokensIn: totalTokensIn,
                tokensOut: totalTokensOut,
                skill: intent,
                mapId: mapId || 'unknown',
                latencyMs: Date.now() - startTime
            });

            return res.status(200).json({ 
                text: generationResult.text, 
                mode: mode,
                quota: req.quota
            });
        } catch (err) {
            logger.error("Error during final generation:", err);
            
            await loggerService.logRequest({
                uid: req.user.uid,
                sessionId: req.user.sessionId || req.user.uid,
                prompt: prompt,
                response: '',
                tokensIn: totalTokensIn,
                tokensOut: totalTokensOut,
                skill: intent,
                mapId: mapId || 'unknown',
                latencyMs: Date.now() - startTime,
                error: err.message
            });

            return res.status(502).json({ error: err.message || "Invalid response format from Google AI" });
        }
    } catch (error) {
        logger.error("Cloud Agent Error:", error);
        
        await loggerService.logRequest({
            uid: req.user ? req.user.uid : 'anonymous',
            sessionId: (req.user && req.user.sessionId) ? req.user.sessionId : 'unknown',
            prompt: promptTextLogged,
            response: '',
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
            skill: intent || 'error',
            mapId: req.body ? req.body.mapId : 'unknown',
            latencyMs: Date.now() - startTime,
            error: error.message
        });

        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;

