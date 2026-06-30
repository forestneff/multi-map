const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log("Running Backend Slash-Command Tag Routing Tests...");

// 1. Mock dependencies in require cache before requiring the router!
const mockLogger = {
    info: (msg) => console.log("   [LOG INFO]:", msg),
    error: (msg, err) => console.log("   [LOG ERROR]:", msg, err || ""),
    warn: (msg) => console.log("   [LOG WARN]:", msg)
};
require.cache[require.resolve('firebase-functions/logger')] = {
    exports: mockLogger
};

const mockLoggerService = {
    logRequest: () => Promise.resolve()
};
require.cache[require.resolve(path.join(__dirname, '../functions/services/logger'))] = {
    exports: mockLoggerService
};

const mockAuthMiddleware = (req, res, next) => {
    req.user = { uid: 'test-user-123', sessionId: 'test-session-456' };
    next();
};
require.cache[require.resolve(path.join(__dirname, '../functions/middleware/auth'))] = {
    exports: mockAuthMiddleware
};

const mockRateLimitMiddleware = (req, res, next) => {
    req.quota = { remaining: 5, limit: 5 };
    next();
};
require.cache[require.resolve(path.join(__dirname, '../functions/middleware/rateLimit'))] = {
    exports: mockRateLimitMiddleware
};

// Mock gemini
const gemini = require('../functions/services/gemini');
let callCounts = {};
let lastPromptPassed = null;
gemini.callGemini = async (systemInstruction, promptText, apiKey, model) => {
    const systemLower = systemInstruction.toLowerCase();
    let type = 'unknown';
    
    if (systemLower.includes('intent parser') || systemLower.includes('exactly one of the following')) {
        type = 'intent';
    } else if (systemLower.includes('converse with the user') || systemLower.includes('insights') || systemLower.includes('conversational response')) {
        type = 'analyze';
    } else if (systemLower.includes('edit the existing') || systemLower.includes('action types:') || systemLower.includes('edits')) {
        type = 'edit';
    } else if (systemLower.includes('project') || systemLower.includes('page-add') || systemLower.includes('multimap_project')) {
        type = 'project';
    } else {
        type = 'generate';
    }
    
    callCounts[type] = (callCounts[type] || 0) + 1;
    lastPromptPassed = promptText;
    
    // If intent parser is called, return mock JSON intent
    if (type === 'intent') {
        return {
            text: JSON.stringify({ intent: "generate-mapstate" }),
            tokens_in: 5,
            tokens_out: 5
        };
    }
    
    return {
        text: JSON.stringify({ message: "Mocked Gemini Response for " + type }),
        tokens_in: 10,
        tokens_out: 15
    };
};

process.env.GEMINI_API_KEY = 'mock-api-key';

// Load router
const router = require('../functions/routes/ai');

// Setup mini express app
const app = express();
app.use(express.json());
app.use('/', router);

// Start server on a free port dynamically
const server = http.createServer(app);
server.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}/`;
    
    function post(body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const req = http.request({
                hostname: '127.0.0.1',
                port: port,
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Authorization': 'Bearer mock-token'
                }
            }, (res) => {
                let resData = '';
                res.on('data', chunk => resData += chunk);
                res.on('end', () => resolve({
                    statusCode: res.statusCode,
                    body: resData ? JSON.parse(resData) : null
                }));
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    try {
        console.log("Starting tests...");

        // --- TEST 1: Default intent parsing ---
        console.log("Running Test 1: Standard query without tags...");
        callCounts = {};
        let res = await post({ prompt: "Brainstorm marketing campaign ideas", contextStr: "" });
        if (res.statusCode !== 200) {
            throw new Error(`Test 1 Failed: Expected status 200, got ${res.statusCode}`);
        }
        if (callCounts['intent'] !== 1) {
            throw new Error(`Test 1 Failed: Expected intent parser to be called once, got ${callCounts['intent']}`);
        }
        if (callCounts['generate'] !== 1) {
            throw new Error(`Test 1 Failed: Expected generate-mapstate skill to be called, got ${JSON.stringify(callCounts)}`);
        }
        console.log("   [PASS] Test 1: Intent parser ran and routed to generate successfully.");

        // --- TEST 2: [edit] Tag Bypasses Intent Parsing ---
        console.log("Running Test 2: [edit] Tag Bypasses Intent Parsing...");
        callCounts = {};
        res = await post({ prompt: "[edit] add a new node named Pricing", contextStr: "" });
        if (res.statusCode !== 200) {
            throw new Error(`Test 2 Failed: Expected status 200, got ${res.statusCode}`);
        }
        if (callCounts['intent']) {
            throw new Error(`Test 2 Failed: Intent parser was called but should have been bypassed!`);
        }
        if (callCounts['edit'] !== 1) {
            throw new Error(`Test 2 Failed: Expected edit skill to be called, got ${JSON.stringify(callCounts)}`);
        }
        if (!lastPromptPassed.startsWith("add a new node named Pricing")) {
            throw new Error(`Test 2 Failed: Tag was not stripped correctly, prompt was: ${lastPromptPassed}`);
        }
        console.log("   [PASS] Test 2: Tag [edit] bypassed intent parsing and was stripped.");

        // --- TEST 3: /explain Tag Bypasses Intent Parsing ---
        console.log("Running Test 3: /explain Tag Bypasses Intent Parsing...");
        callCounts = {};
        res = await post({ prompt: "/explain what does node A represent", contextStr: "" });
        if (res.statusCode !== 200) {
            throw new Error(`Test 3 Failed: Expected status 200, got ${res.statusCode}`);
        }
        if (callCounts['intent']) {
            throw new Error(`Test 3 Failed: Intent parser was called but should have been bypassed!`);
        }
        if (callCounts['analyze'] !== 1) {
            throw new Error(`Test 3 Failed: Expected analyze skill to be called, got ${JSON.stringify(callCounts)}`);
        }
        if (!lastPromptPassed.startsWith("what does node A represent")) {
            throw new Error(`Test 3 Failed: Tag was not stripped correctly, prompt was: ${lastPromptPassed}`);
        }
        console.log("   [PASS] Test 3: Tag /explain bypassed intent parsing and was stripped.");

        // --- TEST 4: [project] Tag Bypasses Intent Parsing ---
        console.log("Running Test 4: [project] Tag Bypasses Intent Parsing...");
        callCounts = {};
        res = await post({ prompt: "[project] Create a complete web app with a landing page, signup page, and settings page", contextStr: "" });
        if (res.statusCode !== 200) {
            throw new Error(`Test 4 Failed: Expected status 200, got ${res.statusCode}`);
        }
        if (callCounts['intent']) {
            throw new Error(`Test 4 Failed: Intent parser was called but should have been bypassed!`);
        }
        if (callCounts['project'] !== 1) {
            throw new Error(`Test 4 Failed: Expected project skill to be called, got ${JSON.stringify(callCounts)}`);
        }
        if (!lastPromptPassed.startsWith("Create a complete web app")) {
            throw new Error(`Test 4 Failed: Tag was not stripped correctly, prompt was: ${lastPromptPassed}`);
        }
        console.log("   [PASS] Test 4: Tag [project] bypassed intent parsing and was stripped.");

        console.log("\nALL BACKEND ROUTING TESTS PASSED SUCCESSFULLY!");
        
        // --- Run Client-Side Tests ---
        runClientTests();

        server.close();
        process.exit(0);
    } catch (err) {
        console.error("Test execution failed:", err);
        server.close();
        process.exit(1);
    }
});

function runClientTests() {
    console.log("\nRunning Client-Side Autocomplete Tests...");

    // Mock Browser/DOM Environment
    let localStore = {};
    global.localStorage = {
        getItem(key) { return localStore[key] || null; },
        setItem(key, val) { localStore[key] = String(val); },
        removeItem(key) { delete localStore[key]; }
    };
    global.window = {
        innerWidth: 1024,
        innerHeight: 768,
        addEventListener: () => {},
        localStorage: global.localStorage
    };

    const elementStore = {};
    function getMockElement(id) {
        if (!elementStore[id]) {
            elementStore[id] = {
                id,
                value: '',
                style: { height: '' },
                classList: {
                    classes: new Set(['hidden']),
                    add(c) { this.classes.add(c); },
                    remove(c) { this.classes.delete(c); },
                    contains(c) { return this.classes.has(c); }
                },
                listeners: {},
                addEventListener(evt, cb) {
                    this.listeners[evt] = cb;
                },
                appendChild: () => {},
                focus() { this.focused = true; },
                innerHTML: '',
                tagName: 'TEXTAREA'
            };
        }
        return elementStore[id];
    }

    global.document = {
        getElementById: (id) => getMockElement(id),
        createElement: (tag) => {
            return {
                tagName: tag,
                style: {},
                classList: {
                    classes: new Set(),
                    add(c) { this.classes.add(c); },
                    remove(c) { this.classes.delete(c); }
                },
                innerHTML: ''
            };
        },
        activeElement: null,
        addEventListener: () => {}
    };

    // Load MultiMapAI
    let aiCode = fs.readFileSync(path.join(__dirname, '../multi_map_ai_engine.js'), 'utf8');
    aiCode = aiCode.replace('class MultiMapAI', 'global.MultiMapAI = class MultiMapAI');
    eval(aiCode);
    const MultiMapAI = global.MultiMapAI;

    const mockKernel = {};
    const mockSandbox = {
        setView: () => {},
        render: () => {}
    };

    const ai = new MultiMapAI(mockKernel, mockSandbox);

    const input = getMockElement('ai-input');
    const popover = getMockElement('ai-autocomplete-popover');

    // 1. Initial State
    if (ai.autocompleteActive) {
        throw new Error("Client Test Failed: Autocomplete should start inactive");
    }

    // 2. Typing '/' opens the popover
    input.value = '/';
    input.listeners['input']();
    if (!ai.autocompleteActive) {
        throw new Error("Client Test Failed: Autocomplete should be active after input '/'");
    }
    if (popover.classList.contains('hidden')) {
        throw new Error("Client Test Failed: Popover should not have hidden class");
    }
    if (ai.filteredCommands.length !== 5) {
        throw new Error("Client Test Failed: Expected 5 commands, got " + ai.filteredCommands.length);
    }
    console.log("   [PASS] Typing '/' activated popover and listed 5 commands.");

    // 3. Typing '/e' filters the list
    input.value = '/e';
    input.listeners['input']();
    if (ai.filteredCommands.length !== 2) {
        throw new Error("Client Test Failed: Expected 2 commands for '/e', got " + ai.filteredCommands.length);
    }
    if (ai.filteredCommands[0].key !== '/edit' || ai.filteredCommands[1].key !== '/explain') {
        throw new Error("Client Test Failed: Expected '/edit' and '/explain' in filtered list");
    }
    console.log("   [PASS] Typing '/e' filtered list to edit and explain.");

    // 4. Arrow down keydown selects /explain (index 1)
    const arrowDownEvt = { key: 'ArrowDown', preventDefault: () => {} };
    input.listeners['keydown'](arrowDownEvt);
    if (ai.activeCommandIdx !== 1) {
        throw new Error("Client Test Failed: Expected active command index to be 1, got " + ai.activeCommandIdx);
    }
    console.log("   [PASS] ArrowDown keydown updated selection index to 1.");

    // 5. Enter keydown selects /explain
    const enterEvt = { key: 'Enter', preventDefault: () => {} };
    input.listeners['keydown'](enterEvt);
    if (ai.autocompleteActive) {
        throw new Error("Client Test Failed: Autocomplete should be inactive after selecting a command");
    }
    if (!popover.classList.contains('hidden')) {
        throw new Error("Client Test Failed: Popover should be hidden after selection");
    }
    if (input.value !== '[explain] ') {
        throw new Error("Client Test Failed: Expected input value '[explain] ', got " + input.value);
    }
    console.log("   [PASS] Enter keydown confirmed selection and prepended '[explain] ' tag.");

    // 6. Escape keydown hides popover
    input.value = '/g';
    input.listeners['input'](); // activate again
    if (!ai.autocompleteActive) {
        throw new Error("Client Test Failed: Expected autocomplete to reactivate");
    }
    const escapeEvt = { key: 'Escape', preventDefault: () => {} };
    input.listeners['keydown'](escapeEvt);
    if (ai.autocompleteActive) {
        throw new Error("Client Test Failed: Autocomplete should be inactive after Escape");
    }
    if (!popover.classList.contains('hidden')) {
        throw new Error("Client Test Failed: Popover should be hidden after Escape");
    }
    console.log("   [PASS] Escape keydown dismissed the popover.");

    console.log("ALL CLIENT-SIDE AUTOCOMPLETE TESTS PASSED SUCCESSFULLY!");
}

