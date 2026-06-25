const fs = require('fs');
const path = require('path');

// Mock Browser Environment
global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {}
};
global.document = {
    getElementById: () => null,
    createElement: () => ({
        style: {},
        onload: null
    })
};
global.localStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; }
};

// Load rules & core
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));
const coreCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
eval(coreCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel'));

// Load phase engines
const phaseEnginesCode = fs.readFileSync(path.join(__dirname, '../phase-engines.js'), 'utf8');
eval(phaseEnginesCode
    .replace('class PhaseRegistrySystem', 'global.PhaseRegistrySystem = class PhaseRegistrySystem')
    .replace('class PhaseEngineBase', 'global.PhaseEngineBase = class PhaseEngineBase')
    .replace('class IframePhaseEngine', 'global.IframePhaseEngine = class IframePhaseEngine')
    .replace('class DataPhaseEngine', 'global.DataPhaseEngine = class DataPhaseEngine')
);

// Instantiate Kernel and registry
const kernel = new global.MultiMapKernel();

// Setup some mock library maps
const mockLibrary = [
    { map_id: 'map_1', meta: { title: 'First Map', type: 'web' }, nodes: [], connections: [] },
    { map_id: 'map_2', meta: { title: 'Second Map', type: 'data' }, nodes: [], connections: [] }
];
kernel.saveLibrary(mockLibrary);

// Setup linking state
kernel.linkingMode = true;
kernel.linkingSourceId = 'node_abc';

// Instantiate IframePhaseEngine
const engine = new global.IframePhaseEngine(kernel, 'inspector', 'engines/universal.html');

// Mock container and iframe behavior
const container = {
    innerHTML: '',
    appendChild: (child) => {}
};

// Let's declare state variables
let postedMessages = [];
const mockIframe = {
    onload: null,
    parentNode: null,
    contentWindow: {
        postMessage: (msg, origin) => {
            postedMessages.push(msg);
        }
    }
};

// Override document.createElement to return our mock iframe
global.document.createElement = (tag) => {
    if (tag === 'iframe') {
        return mockIframe;
    }
    return {};
};

console.log("=== RUNNING PORTAL INTEGRATION TESTS ===");

// First render to initialize iframe
engine.render(container, kernel.state);

// Simulate iframe onload triggering
if (mockIframe.onload) {
    mockIframe.onload();
}

console.log("Posted messages count:", postedMessages.length);
if (postedMessages.length > 0) {
    const lastMsg = postedMessages[postedMessages.length - 1];
    console.log("Last posted message type:", lastMsg.type);
    
    const stateSession = lastMsg.state.session;
    console.log("State session library:", stateSession.library);
    console.log("State session linkingMode:", stateSession.linkingMode);
    console.log("State session linkingSourceId:", stateSession.linkingSourceId);
    
    // Assertions
    if (!stateSession.library || stateSession.library.length !== 2) {
        console.error("❌ FAIL: Library not properly injected in state.session!");
        process.exit(1);
    }
    if (stateSession.linkingMode !== true || stateSession.linkingSourceId !== 'node_abc') {
        console.error("❌ FAIL: Linking properties not properly injected in state.session!");
        process.exit(1);
    }
    
    console.log("✅ PASS: State updates correctly contain library and link-mode properties!");
} else {
    console.error("❌ FAIL: No state update posted to iframe!");
    process.exit(1);
}

// ─── SAVE-ON-EXIT PORTAL TESTS ─────────────────────────────────────────────
console.log("\n=== RUNNING SAVE-ON-EXIT PORTAL TESTS ===");

// Fresh kernel for isolation
const kernel2 = new global.MultiMapKernel();

// Seed library with a submap
const parentMap = { map_id: 'parent_001', meta: { title: 'Parent Map', type: 'generic' }, nodes: [], connections: [], submaps: [] };
const childMap  = { map_id: 'child_001',  meta: { title: 'Child Map',  type: 'generic' }, nodes: [], connections: [], submaps: [] };
kernel2.saveLibrary([parentMap, childMap]);
kernel2.loadMapState(parentMap);

// Enter the child portal
kernel2.enterPortal(childMap);

// Make changes in the child map
kernel2.addNode({ id: 'node_in_child', type: 'note', title: 'New Node', x: 0, y: 0 });

const childNodeCountBefore = kernel2.state.nodes.length;
if (childNodeCountBefore < 1) {
    console.error("❌ FAIL: Node was not added to child map state");
    process.exit(1);
}
console.log("✅ PASS: Node added to child map during portal session");

// Exit portal — this should save the child map back to the library
kernel2.exitPortal();

// Verify parent map is restored
if (kernel2.state.map_id !== 'parent_001') {
    console.error(`❌ FAIL: Parent map not restored after exit. Got: ${kernel2.state.map_id}`);
    process.exit(1);
}
console.log("✅ PASS: Parent map correctly restored after exitPortal()");

// Verify child map was saved with the new node
const lib = kernel2.getLibrary();
const savedChild = lib.find(m => m.map_id === 'child_001');
if (!savedChild) {
    console.error("❌ FAIL: Child map not found in library after exitPortal()");
    process.exit(1);
}
if (!savedChild.nodes || !savedChild.nodes.find(n => n.id === 'node_in_child')) {
    console.error("❌ FAIL: Child map in library is missing the node added during portal session");
    process.exit(1);
}
console.log("✅ PASS: Child map saved to library with session edits on exitPortal()");

// Test: entering a brand-new (unsaved) portal and exiting should ADD it to the library
const kernel3 = new global.MultiMapKernel();
kernel3.saveLibrary([parentMap]);
kernel3.loadMapState(parentMap);

const unsavedChild = { map_id: 'child_unsaved', meta: { title: 'Unsaved Child', type: 'generic' }, nodes: [], connections: [], submaps: [] };
kernel3.enterPortal(unsavedChild);
kernel3.addNode({ id: 'node_x', type: 'note', title: 'A', x: 0, y: 0 });
kernel3.exitPortal();

const lib3 = kernel3.getLibrary();
const addedEntry = lib3.find(m => m.map_id === 'child_unsaved');
if (!addedEntry) {
    console.error("❌ FAIL: Unsaved child map was not added to library on exitPortal()");
    process.exit(1);
}
console.log("✅ PASS: Unsaved child map added to library on exitPortal()");

console.log("\n=== ALL PORTAL TESTS PASSED SUCCESSFULLY ===");
process.exit(0);

