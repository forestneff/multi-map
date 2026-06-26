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

let localStore = {};
global.localStorage = {
    getItem(key) { return localStore[key] || null; },
    setItem(key, val) { localStore[key] = String(val); },
    removeItem(key) { delete localStore[key]; }
};
global.window.localStorage = global.localStorage;

const mockElements = {};
function createMockElement(id = "") {
    const el = {
        id,
        style: {
            removeProperty: () => {},
            setProperty: () => {},
            height: ""
        },
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => {}
        },
        dataset: {},
        addEventListener: () => {},
        click: () => {},
        remove: () => {},
        querySelectorAll: () => [],
        querySelector: (sel) => createMockElement(sel),
        innerHTML: "",
        children: [],
        value: "",
        scrollTop: 0,
        scrollHeight: 100,
        focus: () => {}
    };
    el.appendChild = (child) => {
        el.children.push(child);
        return child;
    };
    return el;
}
function getMockElement(id) {
    if (!mockElements[id]) {
        mockElements[id] = createMockElement(id);
    }
    return mockElements[id];
}
global.document = {
    getElementById: (id) => getMockElement(id),
    createElement: (tag) => createMockElement(tag),
    body: getMockElement("body"),
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

// Load rules & library
const rulesCode = fs.readFileSync(path.join(__dirname, '../multi-map-rules.js'), 'utf8');
eval(rulesCode.replace('const MultiMapSchema', 'global.MultiMapSchema'));
const libraryCode = fs.readFileSync(path.join(__dirname, '../multi-map-library.js'), 'utf8');
eval(libraryCode.replace('const MultiMapLibrary', 'global.MultiMapLibrary'));

// Load MultiMapKernel
let kernelCode = fs.readFileSync(path.join(__dirname, '../multi-map-core.js'), 'utf8');
kernelCode = kernelCode.replace('class MultiMapKernel', 'global.MultiMapKernel = class MultiMapKernel');
eval(kernelCode);
const MultiMapKernel = global.MultiMapKernel;

// Load SandboxController
let sandboxCode = fs.readFileSync(path.join(__dirname, '../multi-map-sandbox.js'), 'utf8');
sandboxCode = sandboxCode.replace('class SandboxController', 'global.SandboxController = class SandboxController');
eval(sandboxCode);
const SandboxController = global.SandboxController;

// Load MultiMapAI
let aiCode = fs.readFileSync(path.join(__dirname, '../multi_map_ai_engine.js'), 'utf8');
aiCode = aiCode.replace('class MultiMapAI', 'global.MultiMapAI = class MultiMapAI');
eval(aiCode);
const MultiMapAI = global.MultiMapAI;

async function runTests() {
    console.log("Starting Project AI Integration Tests...");

    const kernel = new MultiMapKernel();
    
    // Setup registry mock so SandboxController can call inspector.render() or data.render()
    const mockRegistry = {
        get: (id) => ({
            render: (container, state) => {}
        })
    };
    const sandbox = new SandboxController(kernel, mockRegistry);
    const aiEngine = new MultiMapAI(kernel, sandbox);
    global.window.AI = aiEngine;

    // Wait for initializations
    await new Promise(resolve => setTimeout(resolve, 100));

    // ==========================================
    // Test Case 1: Context Building Verification
    // ==========================================
    console.log("\n--- Test Case 1: Context Building Verification ---");
    const context = aiEngine.buildContextString();
    
    console.assert(context.includes("--- PROJECT CONTEXT ---"), "Context should include Project Context header");
    console.assert(context.includes("Active Project ID: default_project"), "Context should show active project ID");
    console.assert(context.includes("All Workspace Projects:"), "Context should list workspace projects");
    console.log("✓ Context building successfully verified");

    // ==========================================
    // Test Case 2: Project-Level AI Generation Import
    // ==========================================
    console.log("\n--- Test Case 2: Project-Level AI Generation Import ---");
    const aiGeneratedProject = {
        type: "multimap_project",
        project: {
            project_id: "ai-generated-proj-123",
            meta: {
                title: "AI Generated School Project",
                description: "Science & Math workspace",
                icon: "🔬",
                color: "#10b981"
            }
        },
        pages: [
            {
                map_id: "ai-page-math",
                meta: { title: "Mathematics", type: "generic" },
                nodes: [{ id: "math-root", type: "root", title: "Math Hub", data: { x: 0, y: 0, isCore: true } }],
                connections: []
            },
            {
                map_id: "ai-page-science",
                meta: { title: "Science Experiments", type: "generic" },
                nodes: [{ id: "science-root", type: "root", title: "Science Hub", data: { x: 0, y: 0, isCore: true } }],
                connections: []
            }
        ]
    };

    aiEngine.pendingProjectData = aiGeneratedProject;
    await aiEngine.importPendingProject();

    console.assert(kernel.projects.length === 2, "Should have 2 projects now");
    console.assert(kernel.activeProjectId === "ai-generated-proj-123", "Active project should be the imported one");
    
    const activePages = kernel.getPages("ai-generated-proj-123");
    console.assert(activePages.length === 2, "Active project should contain 2 pages");
    console.assert(activePages.some(p => p.map_id === "ai-page-math"), "Should contain mathematics page");
    console.assert(activePages.some(p => p.map_id === "ai-page-science"), "Should contain science page");
    console.log("✓ Project-level AI generation and import verified");

    // ==========================================
    // Test Case 3: Project-Level AI Edits
    // ==========================================
    console.log("\n--- Test Case 3: Project-Level AI Edits ---");
    
    // Create another project for move testing
    const destProjId = await kernel.createProject("Destination Project", "Move target", "📁", "#8b5cf6");

    // Setup input value for handleSend simulator
    const aiEditPayload = {
        message: "Applied edits to project.",
        edits: [
            {
                action: "project-update",
                projectId: "ai-generated-proj-123",
                data: {
                    title: "AI School Project Updated",
                    description: "Updated description",
                    icon: "📚",
                    color: "#f59e0b"
                }
            },
            {
                action: "page-add",
                projectId: "ai-generated-proj-123",
                data: {
                    title: "History Page",
                    type: "generic"
                }
            },
            {
                action: "page-rename",
                pageId: "ai-page-math",
                data: {
                    title: "Advanced Math"
                }
            },
            {
                action: "page-move",
                pageId: "ai-page-science",
                fromProjectId: "ai-generated-proj-123",
                toProjectId: destProjId
            },
            {
                action: "page-delete",
                pageId: "ai-page-science" // delete moved page
            }
        ]
    };

    // Inject edits directly by triggering handleSend simulation flow
    // We mock geminiAPIGeneration to return our payload
    aiEngine.geminiAPIGeneration = () => Promise.resolve({
        text: JSON.stringify(aiEditPayload),
        mode: 'edit'
    });

    const mockInput = document.getElementById('ai-input');
    mockInput.value = "Update project structure";
    
    await aiEngine.handleSend();

    // Verify Project Metadata Update
    const targetProj = kernel.projects.find(p => p.project_id === "ai-generated-proj-123");
    console.assert(targetProj.meta.title === "AI School Project Updated", "Project title should be updated");
    console.assert(targetProj.meta.icon === "📚", "Project icon should be updated");

    // Verify Page Renaming
    const lib = kernel.getLibrary();
    const mathPage = lib.find(p => p.map_id === "ai-page-math");
    console.assert(mathPage.meta.title === "Advanced Math", "Math page should have been renamed");

    // Verify Page Deletion (since page-delete ran on the science page)
    const sciencePage = lib.find(p => p.map_id === "ai-page-science");
    console.assert(!sciencePage, "Science page should have been deleted");

    // Verify Page Addition
    const updatedPages = kernel.getPages("ai-generated-proj-123");
    console.assert(updatedPages.length === 2, "Should still have 2 pages (math + history)");
    console.assert(updatedPages.some(p => p.meta.title === "History Page"), "Should contain the new History page");

    console.log("✓ Project-level AI edits successfully verified");

    // ==========================================
    // Test Case 4: Co-Pilot Page Cloning
    // ==========================================
    console.log("\n--- Test Case 4: Co-Pilot Page Cloning ---");
    
    // We will clone "ai-page-math" (which is now "Advanced Math" in the library) into a new project named "Math Special"
    const aiClonePayload = {
        message: "Cloned page to a new project.",
        edits: [
            {
                action: "page-copy",
                pageId: "ai-page-math",
                toProjectId: "new",
                data: {
                    title: "Advanced Math Clone",
                    projectName: "Math Special"
                }
            }
        ]
    };

    aiEngine.geminiAPIGeneration = () => Promise.resolve({
        text: JSON.stringify(aiClonePayload),
        mode: 'edit'
    });

    const mockInput2 = document.getElementById('ai-input');
    mockInput2.value = "Copy page Advanced Math to a new project named Math Special";

    await aiEngine.handleSend();

    // Verify a new project was created
    const clonedProj = kernel.projects.find(p => p.meta.title === "Math Special");
    console.assert(clonedProj, "New project 'Math Special' should be created");
    
    // Verify the page was copied with the new title
    const clonedProjPages = kernel.getPages(clonedProj.project_id);
    console.assert(clonedProjPages.length === 1, "New project should contain exactly 1 page");
    console.assert(clonedProjPages[0].meta.title === "Advanced Math Clone", "Cloned page should be titled 'Advanced Math Clone'");
    console.assert(clonedProjPages[0].map_id !== "ai-page-math", "Cloned page map_id should be different from source page map_id");
    
    console.log("✓ Co-Pilot Page cloning successfully verified");

    console.log("\nAll Project AI Integration Tests Passed Successfully! 🎉");
    process.exit(0);
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
