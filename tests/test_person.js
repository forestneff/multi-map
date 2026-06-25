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

// Global confirm/alert stubs
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

console.log("=== RUNNING PERSON PROFILE SYSTEM TESTS ===");

function assert(condition, message) {
    if (!condition) {
        console.error("❌ FAIL:", message);
        process.exit(1);
    } else {
        console.log("✅ PASS:", message);
    }
}

// --- Test 1: Ontology Validation for person-root ---
assert(schema.definitions['person-root'] !== undefined, "person-root should be defined in MultiMapSchema definitions");
assert(schema.definitions['person-root'].label === "Person", "person-root label should be 'Person'");
assert(schema.mapTypes['person'] !== undefined, "person mapType should be defined");
assert(schema.mapTypes['person'].rootNode === 'person-root', "person mapType rootNode should be person-root");

// canConnect rules check
assert(schema.canConnect('person-root', 'note') === true, "person-root should allow connecting to note");
assert(schema.canConnect('person-root', 'hub') === true, "person-root should allow connecting to hub");
assert(schema.canConnect('person-root', 'portal') === true, "person-root should allow connecting to portal");
assert(schema.canConnect('person-root', 'smart-portal') === true, "person-root should allow connecting to smart-portal");
assert(schema.canConnect('person-root', 'logic-gate') === true, "person-root should allow connecting to logic-gate");
assert(schema.canConnect('person-root', 'web-section') === true, "person-root allows connecting to web-section when strict is false");

// --- Test 2: Singleton person-root Constraint ---
const kernel = new MultiMapKernel();
kernel.state = kernel.ensureSchema({
    meta: { type: 'person' },
    nodes: [
        { id: 'p_root', type: 'person-root', title: 'Person Root', data: { isCore: true } }
    ],
    connections: []
});

global.lastAlert = null;
// Try to add another person-root node
const n2 = kernel.addNode({ type: 'person-root', title: 'Another Person' });
assert(global.lastAlert !== null, "Alert should fire when adding a duplicate person-root node");
assert(kernel.state.nodes.filter(n => n.type === 'person-root').length === 1, "There should still be only 1 person-root node");

// Try to change an existing node's type to person-root
const hubNode = kernel.addNode({ type: 'hub', title: 'A Hub' });
global.lastAlert = null;
kernel.updateNode(hubNode.id, { type: 'person-root' });
assert(global.lastAlert !== null, "Alert should fire when updating a node type to person-root when one already exists");
assert(hubNode.type === 'hub', "The node type update should be rejected and remain 'hub'");

// --- Test 3: updatePersonField and child node synchronization ---
const kernel3 = new MultiMapKernel();
kernel3.state = kernel3.ensureSchema({
    meta: { type: 'person' },
    nodes: [
        { id: 'person_node', type: 'person-root', title: 'Person', content: '{}', data: { isCore: true } }
    ],
    connections: []
});

// Update fields and check if children are dynamically generated & populated
kernel3.updatePersonField('person_node', 'Name', 'Alice Smith');
kernel3.updatePersonField('person_node', 'Email', 'alice@example.com');

const nodes = kernel3.state.nodes;
const connections = kernel3.state.connections;

const nameNode = nodes.find(n => n.title === 'Name' && n.type === 'note');
const emailNode = nodes.find(n => n.title === 'Email' && n.type === 'note');

assert(nameNode !== undefined, "A child note named 'Name' should be automatically spawned");
assert(nameNode.content === 'Alice Smith', "Name node content should match the field value");
assert(emailNode !== undefined, "A child note named 'Email' should be automatically spawned");
assert(emailNode.content === 'alice@example.com', "Email node content should match the field value");

// Verify they are structurally connected to the person root
const nameConn = connections.find(c => c.from === 'person_node' && c.to === nameNode.id && c.type === 'structural');
const emailConn = connections.find(c => c.from === 'person_node' && c.to === emailNode.id && c.type === 'structural');
assert(nameConn !== undefined, "Name node should be structurally connected to the person root");
assert(emailConn !== undefined, "Email node should be structurally connected to the person root");

// Verify updating the field again updates the existing child note rather than spawning a new one
kernel3.updatePersonField('person_node', 'Name', 'Alice Johnson');
const allNameNodes = nodes.filter(n => n.title === 'Name');
assert(allNameNodes.length === 1, "There should still be only 1 Name node");
assert(allNameNodes[0].content === 'Alice Johnson', "Name node content should be updated to Alice Johnson");

// --- Test 4: updateNode JSON content sync ---
const kernel4 = new MultiMapKernel();
kernel4.state = kernel4.ensureSchema({
    meta: { type: 'person' },
    nodes: [
        { id: 'p_root_4', type: 'person-root', title: 'Person', content: '{}', data: { isCore: true } }
    ],
    connections: []
});

// Modify root node content with a JSON string directly via updateNode (simulating save/import/load/direct edit)
kernel4.updateNode('p_root_4', { content: JSON.stringify({ Name: 'Bob Vance', Email: 'bob@vance.com', Phone: '555-0199' }) });

const bobNameNode = kernel4.state.nodes.find(n => n.title === 'Name');
const bobEmailNode = kernel4.state.nodes.find(n => n.title === 'Email');
const bobPhoneNode = kernel4.state.nodes.find(n => n.title === 'Phone');

assert(bobNameNode !== undefined && bobNameNode.content === 'Bob Vance', "updateNode content payload should spawn/sync Name node");
assert(bobEmailNode !== undefined && bobEmailNode.content === 'bob@vance.com', "updateNode content payload should spawn/sync Email node");
assert(bobPhoneNode !== undefined && bobPhoneNode.content === '555-0199', "updateNode content payload should spawn/sync Phone node");

console.log("=== ALL PERSON PROFILE SYSTEM TESTS PASSED SUCCESSFULLY ===");
process.exit(0);
