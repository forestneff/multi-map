const fs = require('fs');
const path = require('path');

// 1. Mock Browser Environment
global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {}
};
global.document = {
    getElementById: () => null
};

// Global confirm/alert stubs
global.confirmResult = true;
global.confirm = (msg) => {
    return global.confirmResult;
};
global.alert = (msg) => {
    console.log("   [ALERT]:", msg);
};

// Mock HostBridge
global.HostBridge = class {
    sync() {}
    fetchTemplates() { return Promise.resolve([]); }
};

// Load rules & library so they are defined
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));
const libraryCode = fs.readFileSync(path.join(__dirname, '../multi-map-library.js'), 'utf8');
eval(libraryCode.replace('const MultiMapLibrary', 'global.MultiMapLibrary'));

// Load MultiMapKernel
let kernelCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
kernelCode = kernelCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel');
eval(kernelCode);
const MultiMapKernel = global.MultiMapKernel;

// Run tests
async function runTests() {
    console.log("Starting Persistence & Auth Tests...");

    // Test Case 1: Guest Mode (LocalStorage Fallback)
    console.log("\n--- Test Case 1: Guest Mode (LocalStorage Fallback) ---");
    let localStore = {};
    global.localStorage = {
        getItem(key) { return localStore[key] || null; },
        setItem(key, val) { localStore[key] = String(val); },
        removeItem(key) { delete localStore[key]; }
    };
    
    // Set some initial local storage data
    const initialMapId = "guest-map-123";
    const initialMap = {
        map_id: initialMapId,
        meta: { title: "Guest Map", type: "generic", created: new Date().toISOString() },
        nodes: [{ id: "n1", type: "root", title: "Guest Root", data: { x: 0, y: 0, isCore: true } }],
        connections: []
    };
    localStore["mm_core_state"] = JSON.stringify(initialMap);
    localStore["mm_constellation_lib"] = JSON.stringify([initialMap]);

    // Initialize kernel - should load Guest Map and migrate it locally to default project
    const kernel = new MultiMapKernel();
    console.assert(kernel.state.map_id === initialMapId, "Should load initial guest map ID from localStorage");
    console.assert(kernel.state.nodes[0].title === "Guest Root", "Should load guest root node");
    
    let library = kernel.getLibrary();
    console.assert(library.length === 1, "Should have 1 map in guest library");
    console.assert(library[0].map_id === initialMapId, "Should have guest map in guest library");
    console.log("✓ Guest Mode initialization successful");

    // Test Case 2: Auth Sync and Data Migration
    console.log("\n--- Test Case 2: Authenticated Sync and Migration ---");
    
    // Mock Firestore Operations
    let firestoreDB = {};
    let setDocCalls = [];
    let deleteDocCalls = [];

    global.window.FirebaseAuth = {
        currentUser: {
            uid: "user-abc-123",
            isAnonymous: false
        }
    };
    global.window.FirebaseDb = {};
    global.window.Firestore = {
        doc(db, ...args) {
            const path = args.join('/');
            return { path, args };
        },
        collection(db, ...args) {
            const path = args.join('/');
            return { path, args };
        },
        async setDoc(docRef, data) {
            setDocCalls.push({ path: docRef.path, data });
            firestoreDB[docRef.path] = JSON.parse(JSON.stringify(data));
        },
        async getDoc(docRef) {
            const val = firestoreDB[docRef.path];
            return {
                exists: () => val !== undefined && val !== null,
                data: () => val
            };
        },
        async getDocs(colRef) {
            const results = [];
            const colSegmentsCount = colRef.path.split('/').length;
            for (let k in firestoreDB) {
                if (k.startsWith(colRef.path + '/')) {
                    const docSegmentsCount = k.split('/').length;
                    if (docSegmentsCount === colSegmentsCount + 1) {
                        results.push({
                            data: () => firestoreDB[k]
                        });
                    }
                }
            }
            return {
                empty: results.length === 0,
                forEach(cb) {
                    results.forEach(cb);
                }
            };
        },
        async deleteDoc(docRef) {
            deleteDocCalls.push(docRef.path);
            delete firestoreDB[docRef.path];
        }
    };

    // Trigger sync on the same kernel (simulates auth transition)
    await kernel.syncWithFirestore("user-abc-123");
    
    // Verify migration
    console.assert(localStore["mm_constellation_lib"] === undefined, "Guest library should be cleared from localStorage");
    console.assert(localStore["mm_core_state"] === undefined, "Guest active state should be cleared from localStorage");
    console.assert(firestoreDB["users/user-abc-123/projects/default_project/pages/guest-map-123"] !== undefined, "Guest map should be migrated to Firestore under default_project");
    
    const activeSession = firestoreDB["users/user-abc-123/sessions/active"];
    console.assert(activeSession.activeMapId === "guest-map-123", "Session should point to migrated map");
    console.log("✓ Guest to Firestore automatic migration verified");

    // Test Case 3: Library Operations on Firestore
    console.log("\n--- Test Case 3: Library Operations (Firestore Mode) ---");
    
    // Create new submap
    const submapId = kernel.createSubmap("person", "My Network");
    await new Promise(r => setTimeout(r, 10)); // Flush microtasks for async save
    
    console.assert(firestoreDB[`users/user-abc-123/projects/default_project/pages/${submapId}`] !== undefined, "New submap should be saved directly to Firestore under default_project");
    console.assert(kernel.getLibrary().length === 2, "Library list should now contain 2 maps (migrated + submap)");
    
    // Update library item
    await kernel.updateLibraryItem(submapId, { title: "Updated Network Title" });
    await new Promise(r => setTimeout(r, 10)); // Flush microtasks
    
    console.assert(firestoreDB[`users/user-abc-123/projects/default_project/pages/${submapId}`].meta.title === "Updated Network Title", "Submap title should update in Firestore");
    console.assert(kernel.getLibrary().find(m => m.map_id === submapId).meta.title === "Updated Network Title", "Cache library should reflect update");

    // Delete library item
    await kernel.deleteFromLibrary(submapId);
    await new Promise(r => setTimeout(r, 10)); // Flush microtasks
    
    console.assert(firestoreDB[`users/user-abc-123/projects/default_project/pages/${submapId}`] === undefined, "Submap should be deleted from Firestore");
    console.assert(kernel.getLibrary().length === 1, "Library cache should decrease to 1 map");
    console.log("✓ CRUD operations in Firestore verified");

    // Test Case 4: Disconnect / Sign out
    console.log("\n--- Test Case 4: Sign Out / Disconnect ---");
    kernel.disconnectFirestore();
    
    // Fallback to guest mode
    console.assert(kernel.firestoreLibrary.length === 0, "Firestore cache should clear on disconnect");
    console.assert(kernel.state.nodes[0].title === "Root", "Should fall back to empty/default local state");
    console.log("✓ Disconnect fallback verified");

    console.log("\nAll Persistence & Auth Tests Passed Successfully! 🎉");
}

runTests().catch(e => {
    console.error("Test execution failed:", e);
    process.exit(1);
});
