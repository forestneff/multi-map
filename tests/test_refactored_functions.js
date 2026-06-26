const http = require('http');

console.log("Starting Refactored Functions Integration Tests...\n");

const BASE_URL = 'http://127.0.0.1:5001/mm-multi-map/us-central1/generateMapState';

// Helper to make POST requests
function post(url, headers, body) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const data = JSON.stringify(body);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        body: resData ? JSON.parse(resData) : null
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        body: resData
                    });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

// Helper to make GET requests
function get(url, headers) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: headers
        };

        const req = http.request(options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        body: resData ? JSON.parse(resData) : null
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        body: resData
                    });
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

async function runTests() {
    try {
        // --- Test 1: Admin Router Status (No auth required) ---
        console.log("Running Test 1: Admin status check...");
        const adminRes = await get(`${BASE_URL}/admin/status`);
        console.log(`Response status: ${adminRes.statusCode}`);
        console.log(`Response body:`, adminRes.body);
        if (adminRes.statusCode !== 200 || !adminRes.body || adminRes.body.status !== 'admin-router-active') {
            throw new Error("Test 1 Failed: Admin status endpoint did not route correctly or return expected body.");
        }
        console.log("✓ Test 1 Passed!\n");

        // --- Test 2: Unauthorized Request (Missing Authorization Header) ---
        console.log("Running Test 2: Request without Authorization header...");
        const unauthRes = await post(BASE_URL, {}, { prompt: "Hello" });
        console.log(`Response status: ${unauthRes.statusCode}`);
        console.log(`Response body:`, unauthRes.body);
        if (unauthRes.statusCode !== 401 || !unauthRes.body.error || !unauthRes.body.error.includes("Missing Authorization header")) {
            throw new Error("Test 2 Failed: Did not reject request with 401 Unauthorized.");
        }
        console.log("✓ Test 2 Passed!\n");

        // --- Test 3: Unauthorized Request (Invalid Token) ---
        console.log("Running Test 3: Request with invalid Authorization token...");
        const badTokenRes = await post(BASE_URL, { 'Authorization': 'Bearer bad-token' }, { prompt: "Hello" });
        console.log(`Response status: ${badTokenRes.statusCode}`);
        console.log(`Response body:`, badTokenRes.body);
        if (badTokenRes.statusCode !== 401 || !badTokenRes.body.error || !badTokenRes.body.error.includes("Invalid token")) {
            throw new Error("Test 3 Failed: Did not reject invalid token with 401 Unauthorized.");
        }
        console.log("✓ Test 3 Passed!\n");

        // --- Test 4: Authorized Request (Valid Intent / Gemini Integration) ---
        console.log("Running Test 4: Authorized request (Gemini FAQ mapping)...");
        const authRes = await post(
            BASE_URL, 
            { 'Authorization': 'Bearer dev-placeholder-token-refactored' }, 
            { prompt: "What is Multi Map?", contextStr: "" }
        );
        console.log(`Response status: ${authRes.statusCode}`);
        console.log(`Response body:`, authRes.body);
        if (authRes.statusCode !== 200 || !authRes.body.text || !authRes.body.mode) {
            throw new Error("Test 4 Failed: Expected 200 OK with text and mode payload.");
        }
        console.log("✓ Test 4 Passed!\n");

        console.log("All Express Functions Refactor tests passed successfully! 🎉");
        process.exit(0);
    } catch (err) {
        console.error("❌ Test run failed:", err.message);
        process.exit(1);
    }
}

// Give emulator a moment to be running, then start
setTimeout(runTests, 1000);
