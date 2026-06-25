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
global.localStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; }
};

// Global confirm stub
global.confirmResult = true;
global.confirm = (msg) => {
    console.log("   [CONFIRM PROMPTED]:", msg);
    global.lastConfirm = msg;
    return global.confirmResult;
};

global.alert = (msg) => {
    console.log("   [ALERT ALERTED]:", msg);
    global.lastAlert = msg;
};

// Mock HostBridge
global.HostBridge = class {
    sync() {}
    fetchTemplates() { return Promise.resolve([]); }
};

// 2. Load rules
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));
const schema = global.MultiMapSchema;

// 3. Load core
let coreCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
coreCode = coreCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel');
eval(coreCode);
const MultiMapKernel = global.MultiMapKernel;

// 4. Load AI engine
let aiCode = fs.readFileSync(path.join(__dirname, '../multi_map_ai_engine.js'), 'utf8');
aiCode = aiCode.replace('class MultiMapAI', 'global.MultiMapAI = class MultiMapAI');
eval(aiCode);
const MultiMapAI = global.MultiMapAI;

console.log("=== RUNNING UNIT TESTS PHASE 2 ===");

function assert(condition, message) {
    if (!condition) {
        console.error("❌ FAIL:", message);
        process.exit(1);
    } else {
        console.log("✅ PASS:", message);
    }
}

// --- Test 1: updateNode with automatic conversion (confirm = true) ---
const kernel = new MultiMapKernel();
kernel.state = kernel.ensureSchema({
    meta: { type: 'web' },
    nodes: [
        { id: 'root1', type: 'web-root', title: 'Root', data: { isCore: true } },
        { id: 'hero1', type: 'web-hero', title: 'New web-hero' }
    ],
    connections: [
        { id: 'conn1', from: 'root1', to: 'hero1', type: 'structural' }
    ]
});

global.lastConfirm = null;
global.confirmResult = true; // User accepts converting incompatible nodes to note nodes

kernel.updateNode('root1', { type: 'data-root' });

assert(global.lastConfirm !== null, "Confirm prompt should be shown when root type is changed and incompatible nodes exist");
const root = kernel.state.nodes.find(n => n.id === 'root1');
const hero = kernel.state.nodes.find(n => n.id === 'hero1');
assert(root.type === 'data-root', "Root should update to data-root");
assert(kernel.state.meta.type === 'data', "Map type should sync to data");
assert(hero.type === 'note', "Incompatible node should be converted to note");
assert(hero.title === 'Converted Note (web-hero)', "Node title should update to reflect conversion");

// --- Test 2: updateNode conversion rejected (confirm = false) ---
const kernel2 = new MultiMapKernel();
kernel2.state = kernel2.ensureSchema({
    meta: { type: 'web' },
    nodes: [
        { id: 'root2', type: 'web-root', title: 'Root', data: { isCore: true } },
        { id: 'hero2', type: 'web-hero', title: 'New web-hero' }
    ],
    connections: [
        { id: 'conn2', from: 'root2', to: 'hero2', type: 'structural' }
    ]
});

global.lastConfirm = null;
global.confirmResult = false; // User rejects converting

kernel2.updateNode('root2', { type: 'data-root' });

assert(global.lastConfirm !== null, "Confirm prompt should be shown");
const root2 = kernel2.state.nodes.find(n => n.id === 'root2');
const hero2 = kernel2.state.nodes.find(n => n.id === 'hero2');
assert(root2.type === 'web-root', "Root type change should be blocked and remain web-root");
assert(kernel2.state.meta.type === 'web', "Map type should remain web");
assert(hero2.type === 'web-hero', "Downstream node type should remain web-hero");

// --- Test 3: importSubmap duplicate root sanitization ---
const parentKernel = new MultiMapKernel();
parentKernel.state = parentKernel.ensureSchema({
    meta: { type: 'generic' },
    nodes: [
        { id: 'p_root', type: 'root', title: 'Parent Root', data: { isCore: true } },
        { id: 'portal1', type: 'portal', title: 'Portal', data: { x: 100, y: 100 } }
    ],
    connections: []
});

const submap = {
    map_id: 'submap1',
    meta: { type: 'web', title: 'Submap' },
    nodes: [
        { id: 'sub_root', type: 'web-root', title: 'Sub Root', data: { isCore: true } },
        { id: 'sub_hero', type: 'web-hero', title: 'Sub Hero' }
    ],
    connections: [
        { id: 'sub_conn', from: 'sub_root', to: 'sub_hero', type: 'structural' }
    ]
};

parentKernel.importSubmap('portal1', submap);

// After import, the imported root node (sub_root) should be converted to 'hub'
const importedRoot = parentKernel.state.nodes.find(n => n.title === 'Sub Root');
assert(importedRoot !== undefined, "Imported root node should be present in nodes list");
assert(importedRoot.type === 'hub', "Imported root type should be converted to 'hub'");
assert(importedRoot.data.isCore === false, "Imported root data should not be isCore");

// Verify there is still exactly one root-type node in the parent map
const rootTypes = parentKernel.state.nodes.filter(n => n.type === 'root' || n.type.endsWith('-root'));
assert(rootTypes.length === 1, "There should be exactly 1 root-type node in the map");
assert(rootTypes[0].id === 'p_root', "The remaining root node should be the original parent root");

console.log("=== ALL TESTS PASSED SUCCESSFULLY ===");
process.exit(0);
