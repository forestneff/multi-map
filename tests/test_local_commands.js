const fs = require('fs');
const path = require('path');

// Mock localStorage
let localStore = {};
global.localStorage = {
    getItem(key) { return localStore[key] || null; },
    setItem(key, val) { localStore[key] = String(val); },
    removeItem(key) { delete localStore[key]; }
};

// 1. Mock Browser/DOM Environment
global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {},
    FirebaseAuth: { currentUser: null },
    FirebaseDb: {}
};
function createMockElement(id = "") {
    return {
        id,
        value: '',
        style: {},
        classList: { 
            add: () => {}, 
            remove: () => {}, 
            contains: () => false 
        },
        appendChild: () => {},
        focus: () => {},
        addEventListener: () => {}
    };
}
global.document = {
    getElementById: (id) => createMockElement(id),
    createElement: () => createMockElement(),
    addEventListener: () => {}
};

// 2. Load schemas & libraries
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));

// Mock HostBridge
global.HostBridge = class {
    sync() {}
    fetchTemplates() { return Promise.resolve([]); }
};

// 3. Load MultiMapKernel
let kernelCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
kernelCode = kernelCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel');
eval(kernelCode);
const MultiMapKernel = global.MultiMapKernel;

// 4. Mock SandboxController / SC
let setViewCall = null;
let actionEnterPortalCall = null;
let actionExitPortalCall = null;
let renderCallCount = 0;

const mockSandbox = {
    setView(phase) { setViewCall = phase; },
    actionEnterPortal(id) { actionEnterPortalCall = id; },
    actionExitPortal() { actionExitPortalCall = true; },
    render() { renderCallCount++; }
};
global.window.SC = mockSandbox;

// 5. Load MultiMapAI and mock message addition
let aiCode = fs.readFileSync(path.join(__dirname, '../multi_map_ai_engine.js'), 'utf8');
aiCode = aiCode.replace('class MultiMapAI', 'global.MultiMapAI = class MultiMapAI');
eval(aiCode);
const MultiMapAI = global.MultiMapAI;

// Instantiate kernel & AI Engine
const kernel = new MultiMapKernel();
const ai = new MultiMapAI(kernel, mockSandbox);

// Override addMessage to capture output
let lastRole = null;
let lastText = null;
ai.addMessage = (role, text) => {
    lastRole = role;
    lastText = text;
};

function resetSpies() {
    setViewCall = null;
    actionEnterPortalCall = null;
    actionExitPortalCall = null;
    renderCallCount = 0;
    lastRole = null;
    lastText = null;
}

// ==========================================
// RUN TESTS
// ==========================================
async function runTests() {
    console.log("Starting Client-Side Local Command Parser Tests...");

    // Test Case 1: View switching
    resetSpies();
    let handled = ai.tryExecuteLocalCommand("view web");
    console.assert(handled === true, "Should handle view switching command");
    console.assert(setViewCall === "web", "Should set view to web");
    console.assert(lastText.includes("web"), "Message should mention web");

    // Test Case 2: Exit Portal (not in portal)
    resetSpies();
    kernel.portalHistory = [];
    handled = ai.tryExecuteLocalCommand("go back");
    console.assert(handled === true, "Should handle exit portal command");
    console.assert(actionExitPortalCall === null, "Should not exit if history empty");
    console.assert(lastText.includes("not currently inside"), "Should report not inside a portal");

    // Test Case 3: Exit Portal (in portal)
    resetSpies();
    kernel.portalHistory = [{ map_id: 'parent', nodes: [], connections: [], session: {} }];
    handled = ai.tryExecuteLocalCommand("exit portal");
    console.assert(handled === true, "Should handle exit portal command");
    console.assert(actionExitPortalCall === true, "Should trigger actionExitPortal");

    // Test Case 4: Node selection
    resetSpies();
    kernel.state.nodes = [{ id: 'n1', title: 'Space Alpha', type: 'note', data: { x: 0, y: 0 } }];
    handled = ai.tryExecuteLocalCommand("select Space Alpha");
    console.assert(handled === true, "Should handle select command");
    console.assert(kernel.state.session.selectedId === 'n1', "Should select node n1");
    console.assert(lastText.includes("Selected node"), "Should say Selected node");

    // Test Case 5: Node renaming
    resetSpies();
    handled = ai.tryExecuteLocalCommand("rename Space Alpha to Space Gamma");
    console.assert(handled === true, "Should handle rename command");
    console.assert(kernel.state.nodes[0].title === "Space Gamma", "Title should be Space Gamma");
    console.assert(lastText.includes("Renamed node"), "Should report rename");

    // Test Case 6: Node adding/creation
    resetSpies();
    kernel.state.session.selectedId = 'n1';
    handled = ai.tryExecuteLocalCommand("create node Subtopic Node");
    console.assert(handled === true, "Should handle node creation command");
    const addedNode = kernel.state.nodes.find(n => n.title === "Subtopic Node");
    console.assert(addedNode !== undefined, "Node Subtopic Node should be added to nodes list");
    console.assert(addedNode.type === "note", "Inferred child type should be note");
    const conn = kernel.state.connections.find(c => c.from === 'n1' && c.to === addedNode.id);
    console.assert(conn !== undefined, "Connection should be created linking parent to new node");

    // Test Case 7: Node linking
    resetSpies();
    kernel.state.nodes = [
        { id: 'n1', title: 'Node A', type: 'note', data: { x: 0, y: 0 } },
        { id: 'n2', title: 'Node B', type: 'note', data: { x: 100, y: 100 } }
    ];
    kernel.state.connections = [];
    handled = ai.tryExecuteLocalCommand("link Node A to Node B");
    console.assert(handled === true, "Should handle link command");
    console.assert(kernel.state.connections.length === 1, "Should create connection");
    console.assert(kernel.state.connections[0].from === 'n1' && kernel.state.connections[0].to === 'n2', "Link should connect n1 to n2");

    // Test Case 8: Node deletion
    resetSpies();
    handled = ai.tryExecuteLocalCommand("delete Node B");
    console.assert(handled === true, "Should handle delete command");
    console.assert(kernel.state.nodes.length === 1, "Should delete Node B, leaving only 1 node");
    console.assert(kernel.state.nodes[0].id === 'n1', "Remaining node should be Node A");

    console.log("All Local Command Parser Tests Passed Successfully! 🎉\n");
}

runTests().catch(e => {
    console.error("Test execution failed:", e);
    process.exit(1);
});
