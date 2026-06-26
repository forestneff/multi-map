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

    return {
        text: outputText,
        tokens_in: data.usageMetadata?.promptTokenCount || 0,
        tokens_out: data.usageMetadata?.candidatesTokenCount || 0
    };
}

module.exports = {
    extractSkillInstructions,
    callGemini
};

