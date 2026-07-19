/**
 * Multi-Map ONTOLOGY v14.11
 * Source of Truth for Node Types, Constraints, and Halo Logic.
 */

const MultiMapSchema = {
    definitions: {
        'root': { label: "Root", icon: "🌌", priority: 0, description: "The Singularity" },
        'data-root': { label: "Data Map", icon: "📊", priority: 0.1, description: "Data Structure Root" },
        'file-root': { label: "File Directory", icon: "📁", priority: 0.2, description: "File System Root" },
        'file-folder': { label: "Folder", icon: "📁", priority: 0.25, description: "Directory" },
        'file-document': { label: "Document", icon: "📄", priority: 0.26, description: "File / Project Page" },
        'prompt-root': { label: "Prompt Chain", icon: "💬", priority: 0.3, description: "AI Prompt Sequence" },
        'agent-root': { label: "Agent Config", icon: "🤖", priority: 0.4, description: "AI Agent Identity" },
        'link-root': { label: "Link Space", icon: "🌳", priority: 0.6, description: "Linktree Root" },
        'person-root': { label: "Person", icon: "👤", priority: 1, description: "Person Identity Root" },
        'hub': { label: "Central Hub", icon: "💠", priority: 2, description: "Router" },
        'portal': { label: "Portal", icon: "🌀", priority: 3, description: "Gateway" },
        'smart-portal': { label: "Smart Node", icon: "🪄", priority: 4, description: "AI Injection Target" },
        'flow-root': { label: "Flowchart", icon: "🛤️", priority: 0.5, description: "Flowchart Root" },
        'flow-process': { label: "Process", icon: "⚙️", priority: 11, description: "Action/Step" },
        'flow-decision': { label: "Decision", icon: "❓", priority: 12, description: "Branch" },
        'flow-terminal': { label: "Terminal", icon: "🏁", priority: 13, description: "Start/End" },
        'prompt-role': { label: "Role", icon: "🎭", priority: 14.1, description: "AI Persona" },
        'prompt-goal': { label: "Goal", icon: "🎯", priority: 14.2, description: "Primary Objective" },
        'prompt-context': { label: "Context", icon: "📚", priority: 14.3, description: "Background Info" },
        'prompt-instruction': { label: "Instruction", icon: "✅", priority: 14.4, description: "Step-by-step Directives" },
        'prompt-constraint': { label: "Constraint", icon: "⛔", priority: 14.5, description: "Rules & Boundaries" },
        'prompt-example': { label: "Example", icon: "💡", priority: 14.6, description: "Few-shot Examples" },
        'prompt-variable': { label: "Variable", icon: "🔤", priority: 14.7, description: "Dynamic Input" },
        'prompt-chain': { label: "Chain", icon: "⛓️", priority: 14.8, description: "Execution Chain" },
        'prompt-image': { label: "Image Prompt", icon: "🎨", priority: 14.11, description: "Generate Image" },
        'prompt-data-analytic': { label: "Data Analytic", icon: "📊", priority: 14.12, description: "Analyze Data" },
        'prompt-text-to-text': { label: "Text Prompt", icon: "📝", priority: 14.13, description: "Text to Text" },
        'prompt-code-gen': { label: "Code Gen", icon: "💻", priority: 14.14, description: "Generate Code" },
        'agent-persona': { label: "Persona", icon: "🧠", priority: 15.1, description: "Core Identity" },
        'agent-router': { label: "Router", icon: "🔀", priority: 15.2, description: "Skill Selection Logic" },
        'agent-skill': { label: "Skill", icon: "🛠️", priority: 15.3, description: "Workflow / SOP" },
        'agent-tool': { label: "Tool", icon: "🔧", priority: 15.4, description: "API / Function" },
        'agent-memory': { label: "Memory", icon: "💾", priority: 15.5, description: "State Management" },
        'agent-guardrail': { label: "Guardrail", icon: "🛡️", priority: 15.6, description: "Safety Boundaries" },
        'note': { label: "Note", icon: "📝", priority: 10, description: "Text" },
        'logic-gate': { label: "Logic Gate", icon: "⚡", priority: 15, description: "Flow Control" },
        'web-root': { label: "Web Page", icon: "🌐", priority: 20, description: "<html>" },
        'web-nav': { label: "Nav Bar", icon: "🧭", priority: 21, description: "<nav>" },
        'web-hero': { label: "Hero", icon: "🎉", priority: 22, description: "Header" },
        'web-section': { label: "Section", icon: "🪟", priority: 23, description: "<section>" },
        'web-footer': { label: "Footer", icon: "🦶", priority: 24, description: "<footer>" },
        'web-card': { label: "Card", icon: "🗂️", priority: 25, description: "<article>" },
        'web-link': { label: "Link", icon: "🔗", priority: 30, description: "<a>" },
        'web-button': { label: "Button", icon: "💡", priority: 31, description: "<button>" },
        'web-text': { label: "Text", icon: "¶", priority: 32, description: "<p>" },
        'web-image': { label: "Image", icon: "🖼️", priority: 33, description: "<img>" },
        'web-video': { label: "Video", icon: "🎥", priority: 34, description: "<video>" },
        'web-form': { label: "Form", icon: "📝", priority: 35, description: "<form>" },
        'web-input': { label: "Input", icon: "⌨️", priority: 36, description: "<input>" },
        'web-grid': { label: "Grid", icon: "🔲", priority: 37, description: "Layout" },
        'web-list': { label: "List", icon: "📋", priority: 38, description: "<ul>" },
        'web-modal': { label: "Modal", icon: "🪟", priority: 39, description: "Dialog" },
        'web-carousel': { label: "Carousel", icon: "🎠", priority: 40, description: "Slider" }
    },

    rules: {
        'root': { allowed: ['hub', 'person-root', 'web-root', 'data-root', 'file-root', 'prompt-root', 'agent-root', 'link-root', 'portal', 'smart-portal', 'note', 'logic-gate'], default: 'hub', strict: true },
        'link-root': { allowed: ['hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'], default: 'web-link', strict: false },
        'data-root': { allowed: ['note', 'portal', 'smart-portal', 'hub', 'logic-gate'], default: 'note', strict: false },
        'file-root': { allowed: ['file-folder', 'file-document', 'note', 'portal', 'smart-portal', 'hub', 'logic-gate'], default: 'file-document', strict: false },
        'file-folder': { allowed: ['file-folder', 'file-document', 'note', 'portal', 'smart-portal', 'hub', 'logic-gate'], default: 'file-document', strict: false },
        'file-document': { allowed: ['note'], default: 'note', strict: false },
        'prompt-root': { allowed: ['prompt-role', 'prompt-goal', 'prompt-context', 'prompt-instruction', 'prompt-constraint', 'prompt-example', 'prompt-variable', 'prompt-chain', 'prompt-image', 'prompt-data-analytic', 'prompt-text-to-text', 'prompt-code-gen', 'note', 'portal', 'smart-portal', 'hub', 'logic-gate'], default: 'prompt-goal', strict: true },
        'prompt-role': { allowed: ['prompt-context', 'prompt-goal', 'note'], default: 'prompt-goal', strict: false },
        'prompt-goal': { allowed: ['prompt-instruction', 'prompt-constraint', 'prompt-example', 'note'], default: 'prompt-instruction', strict: false },
        'prompt-context': { allowed: ['prompt-variable', 'note'], default: 'note', strict: false },
        'prompt-instruction': { allowed: ['prompt-variable', 'note'], default: 'note', strict: false },
        'prompt-constraint': { allowed: ['prompt-variable', 'note'], default: 'note', strict: false },
        'prompt-example': { allowed: ['prompt-variable', 'note'], default: 'note', strict: false },
        'prompt-variable': { allowed: ['note'], default: 'note', strict: false },
        'prompt-chain': { allowed: ['prompt-root', 'portal', 'smart-portal', 'note'], default: 'portal', strict: false },
        'prompt-image': { allowed: ['note'], default: 'note', strict: false },
        'prompt-data-analytic': { allowed: ['note'], default: 'note', strict: false },
        'prompt-text-to-text': { allowed: ['note'], default: 'note', strict: false },
        'prompt-code-gen': { allowed: ['note'], default: 'note', strict: false },
        'agent-root': { allowed: ['agent-persona', 'agent-router', 'agent-skill', 'agent-tool', 'agent-memory', 'agent-guardrail', 'note', 'portal', 'smart-portal', 'hub', 'logic-gate'], default: 'agent-persona', strict: true },
        'agent-persona': { allowed: ['agent-router', 'agent-skill', 'agent-memory', 'agent-guardrail', 'note'], default: 'agent-skill', strict: false },
        'agent-router': { allowed: ['agent-skill', 'note'], default: 'agent-skill', strict: false },
        'agent-skill': { allowed: ['agent-tool', 'agent-guardrail', 'note'], default: 'agent-tool', strict: false },
        'agent-tool': { allowed: ['note'], default: 'note', strict: false },
        'agent-memory': { allowed: ['note'], default: 'note', strict: false },
        'agent-guardrail': { allowed: ['note'], default: 'note', strict: false },
        'flow-root': { allowed: ['flow-process', 'flow-decision', 'flow-terminal', 'note', 'portal', 'smart-portal'], default: 'flow-process', strict: true },
        'flow-process': { allowed: ['flow-process', 'flow-decision', 'flow-terminal', 'note', 'portal', 'smart-portal'], default: 'flow-process', strict: false },
        'flow-decision': { allowed: ['flow-process', 'flow-decision', 'flow-terminal', 'note', 'portal', 'smart-portal'], default: 'flow-process', strict: false },
        'flow-terminal': { allowed: ['note'], default: 'note', strict: false },
        'hub': { allowed: ['note', 'hub', 'portal', 'smart-portal', 'constellation', 'web-root', 'logic-gate', 'person-root'], default: 'note', strict: false },
        'person-root': { allowed: ['hub', 'portal', 'smart-portal', 'note', 'logic-gate'], default: 'note', strict: false },
        'portal': { allowed: ['note', 'hub'], default: 'note', strict: false },
        'smart-portal': { allowed: ['note', 'hub', 'logic-gate'], default: 'note', strict: false },
        'note': { allowed: ['note', 'portal', 'smart-portal', 'logic-gate'], default: 'note', strict: false },
        'web-root': { allowed: ['web-nav', 'web-hero', 'web-section', 'web-footer', 'web-modal'], default: 'web-section', strict: true },
        'web-nav': { allowed: ['web-link', 'web-button', 'web-image'], default: 'web-link', strict: true },
        'web-hero': { allowed: ['web-text', 'web-button', 'web-image', 'web-video'], default: 'web-text', strict: false },
        'web-section': { allowed: ['web-text', 'web-image', 'web-card', 'web-button', 'web-link', 'web-grid', 'web-list', 'web-video', 'web-form', 'web-carousel'], default: 'web-text', strict: false },
        'web-card': { allowed: ['web-text', 'web-image', 'web-button', 'web-link', 'web-list'], default: 'web-text', strict: false },
        'web-footer': { allowed: ['web-link', 'web-text'], default: 'web-link', strict: true },
        'web-link': { allowed: [], default: 'note', strict: true },
        'web-button': { allowed: ['logic-gate'], default: 'logic-gate', strict: false },
        'web-text': { allowed: [], default: 'note', strict: true },
        'web-image': { allowed: [], default: 'note', strict: true },
        'web-video': { allowed: [], default: 'note', strict: true },
        'web-form': { allowed: ['web-input', 'web-button', 'web-text'], default: 'web-input', strict: true },
        'web-input': { allowed: [], default: 'note', strict: true },
        'web-grid': { allowed: ['web-card', 'web-image', 'web-text', 'web-video', 'web-form'], default: 'web-card', strict: false },
        'web-list': { allowed: ['web-text', 'web-link'], default: 'web-text', strict: true },
        'web-modal': { allowed: ['web-text', 'web-image', 'web-button', 'web-form', 'web-grid'], default: 'web-text', strict: false },
        'web-carousel': { allowed: ['web-image', 'web-card', 'web-video'], default: 'web-image', strict: true }
    },

    mapTypes: {
        'generic': { label: 'Generic Space', rootNode: 'root', allowedNodes: ['root', 'data-root', 'file-root', 'prompt-root', 'agent-root', 'flow-root', 'web-root', 'link-root', 'hub', 'person-root', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link', 'file-folder', 'file-document'] },
        'data': { label: 'Data Architecture', rootNode: 'data-root', allowedNodes: ['data-root', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] },
        'file': { label: 'File System', rootNode: 'file-root', allowedNodes: ['file-root', 'file-folder', 'file-document', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] },
        'prompt': { label: 'Prompt Engine', rootNode: 'prompt-root', allowedNodes: ['prompt-root', 'prompt-role', 'prompt-goal', 'prompt-context', 'prompt-instruction', 'prompt-constraint', 'prompt-example', 'prompt-variable', 'prompt-chain', 'prompt-image', 'prompt-data-analytic', 'prompt-text-to-text', 'prompt-code-gen', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] },
        'agent': { label: 'Agent Config', rootNode: 'agent-root', allowedNodes: ['agent-root', 'agent-persona', 'agent-router', 'agent-skill', 'agent-tool', 'agent-memory', 'agent-guardrail', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] },
        'flow': { label: 'Flowchart', rootNode: 'flow-root', allowedNodes: ['flow-root', 'flow-process', 'flow-decision', 'flow-terminal', 'note', 'portal', 'smart-portal', 'hub', 'logic-gate', 'web-link'] },
        'web': { label: 'Web Architecture', rootNode: 'web-root', allowedNodes: ['web-root', 'web-nav', 'web-hero', 'web-section', 'web-footer', 'web-card', 'web-link', 'web-button', 'web-text', 'web-image', 'web-video', 'web-form', 'web-input', 'web-grid', 'web-list', 'web-modal', 'web-carousel', 'note', 'logic-gate', 'portal', 'smart-portal', 'hub'] },
        'person': { label: 'Person Profile', rootNode: 'person-root', allowedNodes: ['person-root', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] },
        'link': { label: 'Link Hub', rootNode: 'link-root', allowedNodes: ['link-root', 'hub', 'portal', 'smart-portal', 'note', 'logic-gate', 'web-link'] }
    },

    getDefinition: function(type) {
        return this.definitions[type] || { label: type, icon: "⚪", description: "Unknown" };
    },

    getDefaultChild(type) {
        return (this.rules[type] && this.rules[type].default) || 'note';
    },

    canConnect(parentType, childType) {
        if (childType === 'root' || childType.endsWith('-root')) return false;
        if (parentType === 'portal' || parentType === 'smart-portal') return false;
        if (childType === 'note' || childType === 'web-link') return true; // Universal exception: Any node can have a note or link attached.
        const rule = this.rules[parentType];
        if (!rule || !rule.strict) return true;
        return rule.allowed.includes(childType);
    }
};