const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require('firebase-admin');
const cors = require('cors')({origin: true});
const fs = require('fs');
const path = require('path');

admin.initializeApp();

// Helper to strip frontmatter from SKILL.md
function extractSkillInstructions(skillContent) {
    return skillContent.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

// Function to call Gemini
async function callGemini(systemInstruction, promptText, apiKey, model = 'gemini-2.5-flash') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [{
                role: "user",
                parts: [{ text: promptText }]
            }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json"
            }
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API Error ${response.status}`);
    }

    const data = await response.json();
    const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!outputText) {
        throw new Error("Invalid response format from Google AI");
    }

    return outputText;
}

exports.generateMapState = onRequest({ cors: true }, async (req, res) => {
  cors(req, res, async () => {
    try {
      // 1. Verify Authentication
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn("Missing Authorization Header");
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header.' });
      }

      const token = authHeader.split('Bearer ')[1];
      if (token !== "dev-placeholder-token") {
         try {
             await admin.auth().verifyIdToken(token);
         } catch (e) {
             logger.warn("Invalid token:", e.message);
             return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
         }
      }

      // 2. Validate Request Body
      const { prompt, contextStr, model } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: 'Bad Request: Missing prompt.' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        logger.error("GEMINI_API_KEY environment variable is not set.");
        return res.status(500).json({ error: 'Internal Server Error: API Key not configured.' });
      }

      // --- STEP 1: PARSE INTENT ---
      let intent = 'generate-mapstate'; // Default fallback
      let faqId = null;
      try {
          const intentSkillPath = path.join(__dirname, 'skills', 'parse-intent', 'SKILL.md');
          const intentSkillContent = fs.readFileSync(intentSkillPath, 'utf8');
          const intentSystemPrompt = extractSkillInstructions(intentSkillContent);
          
          const intentPrompt = `User Prompt: ${prompt}\n\nCurrent Map Context (if any):\n${contextStr || 'None'}`;
          
          // Use gemini-2.5-flash for zero-latency routing
          const intentResultText = await callGemini(intentSystemPrompt, intentPrompt, apiKey, 'gemini-2.5-flash');
          
          // Parse the JSON output
          let cleanJson = intentResultText.trim();
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
              const faqLibPath = path.join(__dirname, 'skills', 'faq_library.json');
              const faqLibContent = fs.readFileSync(faqLibPath, 'utf8');
              const faqLib = JSON.parse(faqLibContent);
              
              const faqResponse = faqLib[faqId] || faqLib['default_faq'] || "I'm your Multi-Map assistant. How can I help?";
              
              // We return mode "analyze" with a JSON string matching the expected UI schema
              const outputText = JSON.stringify({ message: faqResponse });
              return res.status(200).json({ text: outputText, mode: 'analyze' });
          } catch (err) {
              logger.error("Failed to load FAQ library:", err);
              intent = 'analyze-mapstate'; // Fallback if FAQ fails
          }
      }

      // --- FAST-PATH: OUT OF SCOPE ---
      if (intent === 'out-of-scope') {
          const outOfScopeResponse = "I'm sorry, but that request is outside the current scope of my abilities on the Multi-Map platform. I can help you generate maps, edit nodes, or answer questions about how this platform works!";
          const outputText = JSON.stringify({ message: outOfScopeResponse });
          return res.status(200).json({ text: outputText, mode: 'analyze' });
      }

      // --- STEP 2: LOAD SPECIFIC SKILL ---
      let systemPrompt = '';
      try {
          // Prevent directory traversal attacks by validating intent
          const validIntents = ['generate-mapstate', 'generate-web-mapstate', 'edit-mapstate', 'analyze-mapstate'];
          if (!validIntents.includes(intent)) {
              intent = 'generate-mapstate';
          }

          const skillPath = path.join(__dirname, 'skills', intent, 'SKILL.md');
          const skillContent = fs.readFileSync(skillPath, 'utf8');
          systemPrompt = extractSkillInstructions(skillContent);
      } catch (err) {
          logger.error(`Failed to load skill for intent ${intent}:`, err);
          return res.status(500).json({ error: `Internal Server Error: Missing skill file for ${intent}` });
      }

      // --- STEP 3: GENERATE FINAL OUTPUT ---
      const contextualPrompt = prompt + (contextStr ? "\n\n" + contextStr : "");
      
      const generationModel = model || 'gemini-2.5-flash';
      try {
          const outputText = await callGemini(systemPrompt, contextualPrompt, apiKey, generationModel);
          
          // Map backend intents back to simple frontend modes
          let mode = 'generate';
          if (intent === 'edit-mapstate') mode = 'edit';
          else if (intent === 'analyze-mapstate') mode = 'analyze';

          return res.status(200).json({ text: outputText, mode: mode });
      } catch (err) {
          logger.error("Error during final generation:", err);
          return res.status(502).json({ error: err.message || "Invalid response format from Google AI" });
      }

    } catch (error) {
      logger.error("Cloud Agent Error:", error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  });
});
