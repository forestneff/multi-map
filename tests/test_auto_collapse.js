const fs = require('fs');
const path = require('path');

// 1. Mock Browser Environment
class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.style = {
            setProperty(prop, val) { this[prop] = val; },
            removeProperty(prop) { delete this[prop]; }
        };
        this.classList = {
            classes: new Set(),
            add(...names) { names.forEach(n => this.classes.add(n)); },
            remove(...names) { names.forEach(n => this.classes.delete(n)); },
            toggle(name, force) {
                if (force === undefined) {
                    if (this.classes.has(name)) this.classes.delete(name);
                    else this.classes.add(name);
                } else if (force) {
                    this.classes.add(name);
                } else {
                    this.classes.delete(name);
                }
            },
            contains(name) { return this.classes.has(name); }
        };
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this._innerHTML = '';
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(htmlStr) {
        this._innerHTML = htmlStr;
        // Simple heuristic: if it has node-label and node-icon inside, create them as children so querySelector works
        if (htmlStr.includes('node-label')) {
            if (!this.querySelector('.node-label')) {
                const lbl = new MockElement('div');
                lbl.classList.add('node-label');
                this.appendChild(lbl);
            }
        }
        if (htmlStr.includes('node-icon')) {
            if (!this.querySelector('.node-icon')) {
                const ico = new MockElement('div');
                ico.classList.add('node-icon');
                this.appendChild(ico);
            }
        }
    }

    appendChild(child) {
        if (child.parentElement === this) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                this.children.splice(idx, 1);
            }
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
        }
        return child;
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    getBoundingClientRect() {
        return { x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 };
    }

    querySelector(selector) {
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            return this.children.find(c => c.classList.contains(cls)) || null;
        }
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            return this.children.find(c => c.id === id) || null;
        }
        if (selector.startsWith('[')) {
            const match = selector.match(/\[data-node-id="([^"]+)"\]/);
            if (match) {
                const nid = match[1];
                return this.children.find(c => c.dataset.nodeId === nid) || null;
            }
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector.startsWith('.')) {
            const cls = selector.slice(1);
            return this.children.filter(c => c.classList.contains(cls));
        }
        return [];
    }

    addEventListener(event, handler) {
        // no-op
    }

    styleProperty(prop) {
        return this.style[prop];
    }
}

global.requestAnimationFrame = () => {};

global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: () => {}
};

global.document = {
    body: new MockElement('body'),
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag),
    getElementById: (id) => {
        if (!global.document._elementsById) {
            global.document._elementsById = new Map();
        }
        if (!global.document._elementsById.has(id)) {
            const el = new MockElement('div');
            el.id = id;
            global.document._elementsById.set(id, el);
        }
        return global.document._elementsById.get(id);
    },
    addEventListener: () => {}
};

global.localStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; }
};

// 2. Load rules & schema
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));

// 3. Load core
let coreCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
coreCode = coreCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel');
eval(coreCode);
const MultiMapKernel = global.MultiMapKernel;

// 4. Load sandbox controller
let sandboxCode = fs.readFileSync(path.join(__dirname, '../multi-map-sandbox.js'), 'utf8');
sandboxCode = sandboxCode.replace('class SandboxController', 'global.SandboxController = class SandboxController');
eval(sandboxCode);
const SandboxController = global.SandboxController;

console.log("=== RUNNING AUTO-COLLAPSE UNIT TESTS ===");

function assert(condition, message) {
    if (!condition) {
        console.error("❌ FAIL:", message);
        process.exit(1);
    } else {
        console.log("✅ PASS:", message);
    }
}

// Instantiate Kernel & Registry System
const kernel = new MultiMapKernel();
kernel.config.autoCollapseDepth = 3;

// Create a deep hierarchy
kernel.state = kernel.ensureSchema({
    meta: { type: 'generic' },
    nodes: [
        { id: 'root', type: 'root', title: 'Root', data: { isCore: true, collapsed: false } },
        { id: 'n1', type: 'hub', title: 'N1', data: { collapsed: false } },
        { id: 'n2', type: 'hub', title: 'N2', data: { collapsed: false } },
        { id: 'n3', type: 'hub', title: 'N3', data: { collapsed: false } }, // depth 3
        { id: 'n4', type: 'hub', title: 'N4', data: { collapsed: false } }, // depth 4
        { id: 'n5', type: 'hub', title: 'N5', data: { collapsed: false } }, // depth 5
        { id: 'n6', type: 'hub', title: 'N6', data: { collapsed: false } }, // depth 6
        { id: 'sib1', type: 'hub', title: 'Sib1', data: { collapsed: false } }, // sibling branch at depth 1
        { id: 'sib2', type: 'hub', title: 'Sib2', data: { collapsed: false } }  // sibling branch at depth 2
    ],
    connections: [
        { id: 'c1', from: 'root', to: 'n1', type: 'structural' },
        { id: 'c2', from: 'n1', to: 'n2', type: 'structural' },
        { id: 'c3', from: 'n2', to: 'n3', type: 'structural' },
        { id: 'c4', from: 'n3', to: 'n4', type: 'structural' },
        { id: 'c5', from: 'n4', to: 'n5', type: 'structural' },
        { id: 'c6', from: 'n5', to: 'n6', type: 'structural' },
        { id: 'cs1', from: 'root', to: 'sib1', type: 'structural' },
        { id: 'cs2', from: 'sib1', to: 'sib2', type: 'structural' }
    ]
});

// Mock Registry
const registry = { get: () => null };

// Instantiate Controller
const sc = new SandboxController(kernel, registry);

// --- Test 1: Depth Auto-Collapse with No Selection ---
// With autoCollapseDepth = 3:
// 'root' (depth 0), 'n1' (depth 1), 'n2' (depth 2), 'sib1' (depth 1), 'sib2' (depth 2) are visible and expanded.
// 'n3' (depth 3) should be auto-collapsed, meaning its downstream children ('n4', 'n5', 'n6') should be hidden.
// Let's call render()
sc.render();

const visibleNodesSet = new Set();
// We can intercept/read what nodes were determined to be visible by sc.renderMap
// Since renderMap hides subtrees by removing them from visibleNodes, let's verify if visibleNodes contains n4.
// To test this easily, let's execute the isNodeCollapsed logic under the hood:
const depthMap = new Map();
depthMap.set('root', 0);
depthMap.set('n1', 1);
depthMap.set('n2', 2);
depthMap.set('n3', 3);
depthMap.set('n4', 4);
depthMap.set('n5', 5);
depthMap.set('n6', 6);
depthMap.set('sib1', 1);
depthMap.set('sib2', 2);

// Let's check which nodes are visible when no selection is active
// With depth >= 3 collapsed:
// - n3 is collapsed (subtree n4 is hidden)
// - sib2 is depth 2 (expanded)
// - sib1 is depth 1 (expanded)
// Therefore, 'n4' must NOT be visible.
// Let's inspect sc.dom.worldLayer's children to see if they were rendered.
const renderedIds = Array.from(sc.dom.worldLayer.children).map(el => el.dataset.nodeId);
assert(renderedIds.includes('root'), "Root should be rendered");
assert(renderedIds.includes('n1'), "N1 should be rendered");
assert(renderedIds.includes('n2'), "N2 should be rendered");
assert(renderedIds.includes('n3'), "N3 should be rendered");
assert(!renderedIds.includes('n4'), "N4 (subtree of collapsed N3) should NOT be rendered");
assert(!renderedIds.includes('n5'), "N5 should NOT be rendered");
assert(!renderedIds.includes('n6'), "N6 should NOT be rendered");
assert(renderedIds.includes('sib1'), "Sib1 should be rendered");
assert(renderedIds.includes('sib2'), "Sib2 should be rendered");

// --- Test 2: Depth Auto-Collapse with Explicit Expansion ---
// If the user explicitly expanded N3:
kernel.state.nodes.find(n => n.id === 'n3').data.expanded = true;
sc.render();
const renderedIds2 = Array.from(sc.dom.worldLayer.children).map(el => el.dataset.nodeId);
assert(renderedIds2.includes('n4'), "N4 should now be rendered because parent N3 was explicitly expanded");
assert(!renderedIds2.includes('n5'), "N5 should not be rendered because parent N4 is collapsed");
assert(!renderedIds2.includes('n6'), "N6 should not be rendered");

// --- Test 3: Selection-driven path highlighting and sibling collapse ---
// Reset expansion on N3
kernel.state.nodes.find(n => n.id === 'n3').data.expanded = false;

// Select N2:
// Focal selection distance:
// - n2 is dist 0 (expanded)
// - n3 is dist 1 (< 3 autoCollapseDepth, expanded)
// - n4 is dist 2 (< 3 autoCollapseDepth, expanded)
// - n5 is dist 3 (>= 3 autoCollapseDepth, collapsed)
// - n6 is dist 4 (>= 3 autoCollapseDepth, hidden because n5 is collapsed)
// Sibling branch is 'sib1', 'sib2'. They are off the path and not selected/downstream of N2.
// Sibling branch 'sib1' should be collapsed, and both 'sib1' and 'sib2' should fade to 20% opacity.
// Let's select N2:
kernel.selectNode('n2');
sc.render();

const renderedIds3 = Array.from(sc.dom.worldLayer.children).map(el => el.dataset.nodeId);
assert(renderedIds3.includes('root'), "Root on path should be rendered");
assert(renderedIds3.includes('n1'), "N1 on path should be rendered");
assert(renderedIds3.includes('n2'), "N2 selected should be rendered");
assert(renderedIds3.includes('n3'), "N3 (dist 1 downstream from N2) should be rendered");
assert(renderedIds3.includes('n4'), "N4 (dist 2 downstream from N2) should be rendered");
assert(renderedIds3.includes('n5'), "N5 (dist 3 downstream from N2) should be rendered");
assert(!renderedIds3.includes('n6'), "N6 (dist 4 downstream from N2) should NOT be rendered since N5 is collapsed");

// Verify opacity values of rendered nodes:
const elSib1 = sc.dom.worldLayer.querySelector(`[data-node-id="sib1"]`);
const elSib2 = sc.dom.worldLayer.querySelector(`[data-node-id="sib2"]`);
const elN1 = sc.dom.worldLayer.querySelector(`[data-node-id="n1"]`);

assert(elN1.style.opacity === '0.9', "Ancestor N1 on active path should have high opacity (0.9)");
assert(elSib1.style.opacity === '0.2', "Sibling node Sib1 should be faded to 20% opacity (0.2)");
assert(elSib2.style.opacity === '0.2', "Sibling node Sib2 should be faded to 20% opacity (0.2)");

// --- Test 4: Deselection reverts to clean depth-based collapse ---
kernel.selectNode(null);
sc.render();
const renderedIds4 = Array.from(sc.dom.worldLayer.children).map(el => el.dataset.nodeId);
assert(!renderedIds4.includes('n4'), "Deselection should revert to clean autoCollapseDepth (N4 is hidden again)");
assert(!renderedIds4.includes('n5'), "Deselection should revert to clean autoCollapseDepth (N5 is hidden again)");
assert(!renderedIds4.includes('n6'), "Deselection should revert to clean autoCollapseDepth (N6 is hidden again)");

console.log("=== ALL AUTO-COLLAPSE TESTS PASSED SUCCESSFULLY ===");
process.exit(0);
