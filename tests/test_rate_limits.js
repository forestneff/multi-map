const http = require('http');

console.log("Starting Rate Limiting & AI Logging Integration Tests...\n");

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
function get(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET'
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
        // Generate a random session ID to isolate this test run
        const sessionId = 'test-session-' + Math.random().toString(36).substring(2, 10);
        console.log(`Generated test anonymous session ID: ${sessionId}\n`);

        // --- Test 1: Anonymous Quota (Limit 5) ---
        console.log("Running Test 1: Executing 5 successful anonymous requests...");
        for (let i = 1; i <= 5; i++) {
            const res = await post(
                BASE_URL, 
                { 'Authorization': `Anonymous ${sessionId}` }, 
                { prompt: "What is Multi Map?", mapId: "map-anon-test-1" }
            );
            console.log(`  Request #${i} -> Status: ${res.statusCode}, Remaining: ${res.body.quota?.remaining}`);
            if (res.statusCode !== 200 || !res.body.quota || res.body.quota.remaining !== (5 - i)) {
                throw new Error(`Test 1 Failed: Request #${i} returned unexpected status/quota.`);
            }
        }
        console.log("✓ Test 1 Passed: First 5 requests succeeded.\n");

        // --- Test 2: Anonymous 6th Request blocked (HTTP 429) ---
        console.log("Running Test 2: Checking 6th anonymous request is blocked with 429...");
        const blockedRes = await post(
            BASE_URL, 
            { 'Authorization': `Anonymous ${sessionId}` }, 
            { prompt: "What is Multi Map?", mapId: "map-anon-test-1" }
        );
        console.log(`  Request #6 -> Status: ${blockedRes.statusCode}, Body:`, blockedRes.body);
        if (blockedRes.statusCode !== 429 || !blockedRes.body.error || !blockedRes.body.error.includes("Rate limit exceeded")) {
            throw new Error("Test 2 Failed: Did not return 429 Rate Limit Exceeded on 6th request.");
        }
        console.log("✓ Test 2 Passed!\n");

        // --- Test 3: Authenticated Quota (Limit 25) ---
        console.log("Running Test 3: Executing 25 successful authenticated requests...");
        // Using "dev-placeholder-token" which defaults to free tier registered user limit of 25.
        // We will make 25 requests and check they succeed.
        for (let i = 1; i <= 25; i++) {
            const res = await post(
                BASE_URL, 
                { 'Authorization': 'Bearer dev-placeholder-token' }, 
                { prompt: "What is Multi Map?", mapId: "map-auth-test-3" }
            );
            if (i === 1 || i === 25) {
                console.log(`  Request #${i} -> Status: ${res.statusCode}, Remaining: ${res.body.quota?.remaining}`);
            }
            if (res.statusCode !== 200 || !res.body.quota || res.body.quota.remaining !== (25 - i)) {
                throw new Error(`Test 3 Failed: Request #${i} returned unexpected status/quota.`);
            }
        }
        console.log("✓ Test 3 Passed: First 25 authenticated requests succeeded.\n");

        // --- Test 4: Authenticated 26th Request blocked (HTTP 429) ---
        console.log("Running Test 4: Checking 26th authenticated request is blocked with 429...");
        const blockedAuthRes = await post(
            BASE_URL, 
            { 'Authorization': 'Bearer dev-placeholder-token' }, 
            { prompt: "What is Multi Map?", mapId: "map-auth-test-3" }
        );
        console.log(`  Request #26 -> Status: ${blockedAuthRes.statusCode}, Body:`, blockedAuthRes.body);
        if (blockedAuthRes.statusCode !== 429 || !blockedAuthRes.body.error || !blockedAuthRes.body.error.includes("Rate limit exceeded")) {
            throw new Error("Test 4 Failed: Did not return 429 Rate Limit Exceeded on 26th request.");
        }
        console.log("✓ Test 4 Passed!\n");

        // --- Test 5: Verify Admin Logger Fetch ---
        console.log("Running Test 5: Fetching logged requests from Admin logs API...");
        const adminLogsRes = await get(`${BASE_URL}/admin/logs?limit=10`);
        console.log(`  Status: ${adminLogsRes.statusCode}, Found: ${adminLogsRes.body?.logs?.length} logs`);
        if (adminLogsRes.statusCode !== 200 || !adminLogsRes.body || !Array.isArray(adminLogsRes.body.logs) || adminLogsRes.body.logs.length === 0) {
            throw new Error("Test 5 Failed: Could not fetch requests log via admin endpoint.");
        }
        
        // Assert that the latest log matches our test parameters
        const latestLog = adminLogsRes.body.logs[0];
        console.log(`  Latest log ID: ${latestLog.id}`);
        console.log(`  Latest log prompt: "${latestLog.prompt}"`);
        console.log(`  Latest log skill: "${latestLog.skill}"`);
        if (latestLog.prompt !== "What is Multi Map?") {
            throw new Error("Test 5 Failed: Logged prompt did not match input.");
        }
        console.log("✓ Test 5 Passed!\n");

        console.log("All Logging & Rate Limiting tests passed successfully! 🎉");
        process.exit(0);
    } catch (err) {
        console.error("❌ Test run failed:", err.message);
        process.exit(1);
    }
}

// Start tests
setTimeout(runTests, 1000);
