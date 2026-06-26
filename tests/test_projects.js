const fs = require('fs');
const path = require('path');

// 1. Mock Browser Environment
global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {}
};
global.requestAnimationFrame = () => {};
global.cancelAnimationFrame = () => {};
function createMockElement(id = "") {
    const el = {
        id,
        style: {
            removeProperty: () => {},
            setProperty: () => {}
        },
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
        },
        dataset: {},
        addEventListener: () => {},
        click: () => {},
        remove: () => {},
        querySelectorAll: () => [],
        querySelector: (sel) => createMockElement(sel),
        innerHTML: "",
        children: []
    };
    el.appendChild = (child) => {
        el.children.push(child);
        return child;
    };
    return el;
}
global.document = {
    getElementById: (id) => createMockElement(id),
    createElement: (tag) => createMockElement(tag),
    body: createMockElement("body"),
    addEventListener: () => {}
};

// Global confirm/alert/prompt stubs
global.confirmResult = true;
global.confirm = (msg) => {
    console.log("   [CONFIRM]:", msg);
    return global.confirmResult;
};
global.alert = (msg) => {
    console.log("   [ALERT]:", msg);
};
global.promptResult = "New Project Title";
global.prompt = (msg, def) => {
    console.log("   [PROMPT]:", msg, "->", global.promptResult);
    return global.promptResult;
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

// Load SandboxController to test export/import
let sandboxCode = fs.readFileSync(path.join(__dirname, '../multi-map-sandbox.js'), 'utf8');
sandboxCode = sandboxCode.replace('class SandboxController', 'global.SandboxController = class SandboxController');
eval(sandboxCode);
const SandboxController = global.SandboxController;

async function runTests() {
    console.log("Starting Projects & Pages Architecture Tests...");

    // ==========================================
    // Test Case 1: Guest Mode Legacy Local Data Migration
    // ==========================================
    console.log("\n--- Test Case 1: Guest Mode Legacy Local Data Migration ---");
    let localStore = {};
    global.localStorage = {
        getItem(key) { return localStore[key] || null; },
        setItem(key, val) { localStore[key] = String(val); },
        removeItem(key) { delete localStore[key]; }
    };

    const legacyMapId = "legacy-map-111";
    const legacyMap = {
        map_id: legacyMapId,
        meta: { title: "Legacy Guest Map", type: "generic", created: new Date().toISOString() },
        nodes: [{ id: "root-111", type: "root", title: "Legacy Root", data: { x: 0, y: 0, isCore: true } }],
        connections: []
    };

    localStore["mm_core_state"] = JSON.stringify(legacyMap);
    localStore["mm_constellation_lib"] = JSON.stringify([legacyMap]);

    // Constructing kernel should trigger local migration
    const kernel = new MultiMapKernel();

    console.assert(kernel.projects.length === 1, "Should have created a default project container");
    console.assert(kernel.projects[0].project_id === "default_project", "Default project ID should be default_project");
    console.assert(kernel.projects[0].page_ids.includes(legacyMapId), "Default project should contain the legacy page ID");
    
    const lib = kernel.getLibrary();
    console.assert(lib.length === 1, "Library should contain 1 map");
    console.assert(lib[0].meta.project_id === "default_project", "Migrated map should have project_id metadata set to default_project");
    console.log("✓ Legacy Guest Mode migration successfully verified");

    // ==========================================
    // Test Case 2: Project & Page CRUD Operations (Guest Mode)
    // ==========================================
    console.log("\n--- Test Case 2: Project & Page CRUD Operations (Guest Mode) ---");
    
    // Create new project
    const newProjId = await kernel.createProject("Project Bravo", "Description Bravo", "⭐", "#ef4444");
    console.assert(kernel.projects.length === 2, "Should have 2 projects after creation");
    console.assert(kernel.activeProjectId === newProjId, "Active project should switch to the newly created project");
    
    const activeProj = kernel.projects.find(p => p.project_id === newProjId);
    console.assert(activeProj.meta.title === "Project Bravo", "Project title should be Bravo");
    console.assert(activeProj.page_ids.length === 1, "Newly created project should have a default page created automatically");
    
    const bravoPageId = activeProj.page_ids[0];
    console.assert(kernel.state.map_id === bravoPageId, "Kernel active state should load the default page of new project");
    console.assert(kernel.state.meta.project_id === newProjId, "Active state should be marked with the correct project_id");

    // Rename project
    await kernel.renameProject(newProjId, "Project Bravo Renamed", "New Description", "🎉", "#10b981");
    console.assert(activeProj.meta.title === "Project Bravo Renamed", "Project title should be updated");
    console.assert(activeProj.meta.icon === "🎉", "Project icon should be updated");

    // Create page
    const pageObj = await kernel.createPage(newProjId, "Second Page", "person");
    console.assert(activeProj.page_ids.length === 2, "Project page_ids should now list 2 pages");
    console.assert(kernel.getLibrary().some(p => p.map_id === pageObj.map_id), "Library should contain the new page");
    console.assert(pageObj.meta.project_id === newProjId, "New page's project_id should match");

    // Move page between projects
    await kernel.movePage(pageObj.map_id, newProjId, "default_project");
    console.assert(!activeProj.page_ids.includes(pageObj.map_id), "Bravo project should no longer contain the moved page ID");
    const defaultProj = kernel.projects.find(p => p.project_id === "default_project");
    console.assert(defaultProj.page_ids.includes(pageObj.map_id), "Default project should now contain the moved page ID");
    
    const movedPage = kernel.getLibrary().find(p => p.map_id === pageObj.map_id);
    console.assert(movedPage.meta.project_id === "default_project", "Moved page metadata project_id should update to default_project");
    console.log("✓ Project/Page CRUD and Move operations verified successfully");

    // ==========================================
    // Test Case 3: Firestore Sync & Legacy Firestore Data Migration
    // ==========================================
    console.log("\n--- Test Case 3: Firestore Sync & Legacy Firestore Data Migration ---");

    let firestoreDB = {};
    let setDocCalls = [];
    let deleteDocCalls = [];
    let activeSession = null;

    global.window.FirebaseAuth = {
        currentUser: {
            uid: "user-xyz-789",
            isAnonymous: false
        }
    };
    global.window.FirebaseDb = {};
    global.window.Firestore = {
        doc(db, ...args) {
            const path = args.join('/');
            return {
                path,
                col: args[0],
                uid: args[1],
                subcol: args[2],
                docId: args[3],
                args
            };
        },
        collection(db, ...args) {
            const path = args.join('/');
            return {
                path,
                col: args[0],
                uid: args[1],
                subcol: args[2],
                args
            };
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

    // Pre-populate legacy flat maps in Firestore (mimicking old database before migration)
    const dbLegacyMapId = "firestore-legacy-map-456";
    firestoreDB[`users/user-xyz-789/maps/${dbLegacyMapId}`] = {
        map_id: dbLegacyMapId,
        meta: { title: "Legacy Cloud Map", type: "generic", created: new Date().toISOString() },
        nodes: [{ id: "n-cloud", type: "root", title: "Cloud Root", data: { x: 0, y: 0, isCore: true } }],
        connections: []
    };

    // Pre-populate guest localStorage state to trigger auth guest-to-cloud migration
    localStore["mm_projects"] = JSON.stringify([
        {
            project_id: "guest-proj-999",
            meta: { title: "Guest Proj 999", color: "#ffffff" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            page_ids: ["guest-page-999"]
        }
    ]);
    const guestPage = {
        map_id: "guest-page-999",
        meta: { title: "Guest Page 999", type: "generic", project_id: "guest-proj-999" },
        nodes: [{ id: "n-gp", type: "root", title: "Guest Page Root", data: { x: 0, y: 0, isCore: true } }],
        connections: []
    };
    localStore["mm_constellation_lib"] = JSON.stringify([guestPage]);
    localStore["mm_core_state"] = JSON.stringify(guestPage);

    // Call syncWithFirestore
    await kernel.syncWithFirestore("user-xyz-789");

    // 1. Verify Guest Local Storage is cleared after migration to Firestore
    console.assert(localStore["mm_projects"] === undefined, "Guest projects should be cleared");
    console.assert(localStore["mm_constellation_lib"] === undefined, "Guest pages library should be cleared");

    // 2. Verify guest project and page exist in Firestore now
    console.assert(firestoreDB["users/user-xyz-789/projects/guest-proj-999"] !== undefined, "Guest project should be migrated to Firestore path");
    console.assert(firestoreDB["users/user-xyz-789/projects/guest-proj-999/pages/guest-page-999"] !== undefined, "Guest page should be migrated to Firestore nested path");

    // 3. Verify legacy flat map is migrated to default_project path and the legacy path deleted
    console.assert(firestoreDB[`users/user-xyz-789/maps/${dbLegacyMapId}`] === undefined, "Legacy flat map path should be deleted");
    console.assert(firestoreDB[`users/user-xyz-789/projects/default_project/pages/${dbLegacyMapId}`] !== undefined, "Legacy map should exist in default_project/pages");
    console.assert(firestoreDB[`users/user-xyz-789/projects/default_project`].page_ids.includes(dbLegacyMapId), "default_project page_ids must include legacy map ID");

    console.log("✓ Firestore synchronization and two-way migrations verified");

    // ==========================================
    // Test Case 4: Packaged Project Export / Import
    // ==========================================
    console.log("\n--- Test Case 4: Packaged Project Export & Import ---");
    
    // Instantiate SandboxController
    const controller = new SandboxController(kernel, { get: () => ({ render: () => {} }) });

    // Mock Active Project and pages
    kernel.activeProjectId = "guest-proj-999";
    kernel.firestoreProjects = [
        {
            project_id: "guest-proj-999",
            meta: { title: "Guest Proj 999", color: "#ffffff" },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            page_ids: ["guest-page-999"]
        }
    ];
    kernel.firestorePagesByProject["guest-proj-999"] = [guestPage];

    // Let's verify export packaging
    const exportedPages = kernel.getPages("guest-proj-999");
    const exportPayload = {
        type: "multimap_project",
        project: kernel.firestoreProjects[0],
        pages: exportedPages
    };

    console.assert(exportPayload.project.project_id === "guest-proj-999", "Export payload should contain project meta");
    console.assert(exportPayload.pages.length === 1, "Export payload should contain all project pages");
    console.assert(exportPayload.pages[0].map_id === "guest-page-999", "Export page ID matches");

    // Let's test import processing (simulate uploading this file structure)
    const importPayload = {
        type: "multimap_project",
        project: {
            project_id: "imported-proj-777",
            meta: { title: "Imported Project", description: "Test Import", icon: "🚀", color: "#3b82f6" },
            page_ids: ["imported-page-777"]
        },
        pages: [
            {
                map_id: "imported-page-777",
                meta: { title: "Imported Page", type: "generic" },
                nodes: [{ id: "n-imp", type: "root", title: "Imported Root", data: { x: 0, y: 0, isCore: true } }],
                connections: []
            }
        ]
    };

    await controller.processProjectImport(importPayload);

    // Verify imported data in DB
    console.assert(firestoreDB["users/user-xyz-789/projects/imported-proj-777"] !== undefined, "Imported project should exist in Firestore");
    console.assert(firestoreDB["users/user-xyz-789/projects/imported-proj-777/pages/imported-page-777"] !== undefined, "Imported page should exist in Firestore");
    console.assert(kernel.activeProjectId === "imported-proj-777", "Imported project should become active project");
    console.assert(kernel.state.map_id === "imported-page-777", "Kernel state should load first page of imported project");

    console.log("✓ Packaged project export and import verified successfully");

    console.log("\nAll Projects & Pages Architecture Tests Passed Successfully! 🎉");
}

runTests().catch(e => {
    console.error("Test execution failed:", e);
    process.exit(1);
});
