/**
 * Multi-Map PHASE ENGINE SYSTEM v14.11
 * Features: Dynamic Search Highlighting and Inspector UX Refinements.
 */

class PhaseRegistrySystem {
    constructor() {
        this.engines = [];
        this.activeViewMode = 'map';
        this.kernel = null;
    }
    init(kernel) {
        this.kernel = kernel;

        
        // Register the new IframePhaseEngines
        this.register(new IframePhaseEngine(kernel, 'inspector', 'engines/universal.html'));
        this.register(new IframePhaseEngine(kernel, 'web', 'engines/web-architect.html'));
        this.register(new IframePhaseEngine(kernel, 'orbital', 'engines/orbital-focus.html'));
        this.register(new IframePhaseEngine(kernel, 'prompt', 'engines/prompt-engine.html'));
        this.register(new IframePhaseEngine(kernel, 'agent', 'engines/agent-config.html'));
        this.register(new IframePhaseEngine(kernel, 'person', 'engines/person.html'));
        
        this.register(new DataPhaseEngine(kernel)); 
        
        // Listen for messages from iframes
        window.addEventListener('message', (event) => {
            if (event.data && window.SC && window.SC.kernel) {
                const type = event.data.type;
                const id = event.data.id;
                
                if (type === 'SELECT_NODE' && id) {
                    window.SC.kernel.selectNode(id);
                    window.SC.render();
                } else if (type === 'UPDATE_NODE' && id && event.data.data) {
                    window.SC.kernel.updateNode(id, event.data.data);
                    window.SC.render();
                } else if (type === 'ACTION' && event.data.action) {
                    const action = event.data.action;
                    if (action === 'LINK' && id) window.SC.actionLink(id);
                    else if (action === 'ADD_CHILD' && id) window.SC.actionAddChild(id);
                    else if (action === 'SAVE_CONSTELLATION' && id) window.SC.actionSaveConstellation(id);
                    else if (action === 'DELETE' && id) window.SC.actionDelete(id);
                    else if (action === 'ENTER_PORTAL' && id) window.SC.actionEnterPortal(id);
                    else if (action === 'TRIGGER_AI' && id) window.SC.actionTriggerAI(id);
                    else if (action === 'APPLY_TEMPLATE' && id && event.data.data) {
                        window.SC.actionApplyTemplateToNode(id, event.data.data);
                    }
                    else if (action === 'CREATE_SUBMAP_AND_LINK' && id && event.data.data) {
                        const newId = window.SC.kernel.createSubmap(event.data.data, 'New ' + event.data.data + ' Map'); 
                        window.SC.kernel.updateNode(id, { content: newId }); 
                        window.SC.actionEnterPortal(id);
                    }
                }
            }
        });
    }
    register(engine) { this.engines.push(engine); }
    get(id) { return this.engines.find(e => e.id === id); }
}

class PhaseEngineBase {
    constructor(kernel) { this.kernel = kernel; this.id = 'base'; }
    render(container, state) { }
    escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}

class IframePhaseEngine extends PhaseEngineBase {
    constructor(kernel, id, url) {
        super(kernel);
        this.id = id;
        this.url = url;
        this.iframe = null;
    }
    render(container, state) {
        let stateClone = state;
        // Inject schema data into state for the inspector iframe without mutating global state
        if (state && state.session) {
            const sessionClone = Object.assign({}, state.session);
            if (typeof MultiMapSchema !== 'undefined') {
                sessionClone.schemaData = {
                    definitions: MultiMapSchema.definitions,
                    rules: MultiMapSchema.rules,
                    mapTypes: MultiMapSchema.mapTypes
                };
            }
            sessionClone.library = this.kernel.getLibrary();
            sessionClone.linkingMode = this.kernel.linkingMode;
            sessionClone.linkingSourceId = this.kernel.linkingSourceId;
            sessionClone.activeProjectId = this.kernel.activeProjectId;
            sessionClone.projects = this.kernel.getProjects();
            
            stateClone = Object.assign({}, state, { session: sessionClone });
        }

        if (!this.iframe) {
            this.iframe = document.createElement('iframe');
            this.iframe.src = this.url;
            this.iframe.className = "w-full h-full border-none";
        }

        // Always update the onload handler to use the latest state and highlight
        this.iframe.onload = () => {
            const highlight = window.SC && window.SC.activeSearchHighlight ? window.SC.activeSearchHighlight : null;
            if (this.iframe && this.iframe.contentWindow) {
                this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: stateClone, highlight: highlight }, '*');
            }
        };
        
        if (this.iframe.parentNode !== container) {
            container.innerHTML = ''; // Clear container
            container.appendChild(this.iframe);
        }
        
        if (this.iframe.contentWindow) {
            const highlight = window.SC && window.SC.activeSearchHighlight ? window.SC.activeSearchHighlight : null;
            this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: stateClone, highlight: highlight }, '*');
        }
    }
}

class DataPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { 
        super(kernel); 
        this.id = 'data'; 
        this.ui = { templates: true, api: false, json: false, library: true, projectsSub: true, pagesSub: true, openItems: {} };
    }
    
    toggle(section) {
        this.ui[section] = !this.ui[section];
        const container = document.getElementById('data-manager-content');
        if (container) this.render(container, this.kernel.state);
    }

    toggleItem(id) {
        this.ui.openItems[id] = !this.ui.openItems[id];
        const container = document.getElementById('data-manager-content');
        if (container) this.render(container, this.kernel.state);
    }
    
    handlePageDrop(event, targetProjectId) {
        event.preventDefault();
        const pageId = event.dataTransfer.getData("text/plain");
        if (!pageId) return;
        
        const projects = this.kernel.getProjects();
        let fromProjId = null;
        for (const p of projects) {
            if (p.page_ids && p.page_ids.includes(pageId)) {
                fromProjId = p.project_id;
                break;
            }
        }
        
        if (!fromProjId) {
            const lib = this.kernel.getLibrary();
            const page = lib.find(p => p.map_id === pageId);
            if (page) fromProjId = page.meta?.project_id || 'default_project';
        }
        
        if (fromProjId && fromProjId !== targetProjectId) {
            this.kernel.movePage(pageId, fromProjId, targetProjectId);
            const container = document.getElementById('data-manager-content');
            if (container) this.render(container, this.kernel.state);
        }
    }
    
    render(container, state) {
        try {
            const activeProjId = this.kernel.activeProjectId;
            const projects = this.kernel.getProjects();
            const pages = this.kernel.getPages(activeProjId);
            
            const activeProj = projects.find(p => p.project_id === activeProjId) || projects[0] || { meta: { title: "My Project" } };
            const activeProjTitle = activeProj.meta?.title || "My Project";
        
        container.innerHTML = `
            <div class="w-full flex flex-col gap-4 pb-10">
                <p class="text-slate-400 text-xs px-1">Manage workspace projects, organize nested pages, and package system configurations.</p>
                <div class="flex flex-col gap-4">
                
                        <!-- Quota Meter & Vault -->
                        ${(() => {
                            const tier = this.kernel.getCurrentTier();
                            const usage = this.kernel.getStorageUsage();
                            const limit = this.kernel.getStorageLimit(tier);
                            const percent = Math.min(100, (usage / limit) * 100);
                            const mbUsage = (usage / 1024 / 1024).toFixed(2);
                            const mbLimit = (limit / 1024 / 1024).toFixed(1);
                            const isWarning = percent >= 80;
                            const activeVault = this.kernel.isUsingCloudVault() ? 'firebase' : 'local';
                            
                            return `
                            <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-4 flex flex-col gap-3 shrink-0">
                                <div class="flex justify-between items-end">
                                    <div class="flex flex-col">
                                        <h2 class="text-sky-400 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5">☁️ Data Vault</h2>
                                        <div class="relative mt-1">
                                            <button 
                                                id="vault-selector-btn"
                                                onclick="SC.showVaultSelectorDropdown(event)"
                                                class="bg-slate-950 hover:bg-slate-800 text-[10px] text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                                            >
                                                <span>Target: ${activeVault === 'firebase' ? 'Firebase (Cloud) ☁️' : 'Local Browser (Legacy) 📁'}</span>
                                                <span class="text-[8px] opacity-60">▼</span>
                                            </button>
                                        </div>
                                    </div>
                                    <span class="text-[9px] font-mono ${isWarning ? 'text-rose-400 font-bold' : 'text-slate-400'}">${mbUsage} MB / ${mbLimit} MB</span>
                                </div>
                                
                                <div class="w-full bg-slate-800 rounded-full h-1.5 mt-0.5 overflow-hidden">
                                    <div class="h-1.5 rounded-full ${isWarning ? 'bg-rose-500' : 'bg-sky-500'}" style="width: ${percent}%"></div>
                                </div>
                                
                                ${isWarning ? `
                                <div class="mt-1 p-2 bg-rose-950/40 border border-rose-900/50 rounded-lg text-rose-300 text-[9px] flex flex-col gap-1.5">
                                    <p><strong>Warning:</strong> ${tier === 'guest' ? 'Local guest storage' : 'Cloud workspace'} is almost full.</p>
                                    <div class="flex gap-1.5 mt-0.5">
                                        ${tier === 'guest' ? `<button onclick="alert('Sign up coming soon!')" class="flex-1 bg-sky-600 hover:bg-sky-500 py-1 rounded transition-colors text-white font-bold">Free Account</button>` : ''}
                                        <button onclick="alert('Bring Your Own Storage coming in Phase 2!')" class="flex-1 bg-rose-900/60 hover:bg-rose-800 py-1 rounded transition-colors text-white">BYOS Options</button>
                                    </div>
                                </div>
                                ` : `
                                <div class="text-[9px] text-slate-500 flex justify-between px-1">
                                    <span>Sync Status:</span>
                                    <span class="font-bold flex items-center gap-1" id="save-status">
                                        ${this.kernel.isUsingCloudVault() ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Cloud' : '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local'}
                                    </span>
                                </div>
                                `}
                            </div>
                            `;
                        })()}
                        
                        
                        <!-- 1. Workspace Library Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col shrink-0">
                            <div class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('library')">
                                <h2 class="text-purple-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2 font-black">📚 Workspace Library</h2>
                                <div class="flex items-center gap-3">
                                    <span class="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] border border-slate-700">${projects.length} Projects / ${pages.length} Pages</span>
                                    <span class="text-slate-500 text-xs">${this.ui.library ? '▼' : '▶'}</span>
                                </div>
                            </div>
                            
                            ${this.ui.library ? `
                            <div class="p-4 border-t border-slate-800 flex flex-col gap-4 bg-slate-900/40">
                                
                                <!-- Top Section: Projects Panel -->
                                <div class="flex flex-col gap-2 min-h-0 bg-slate-950/20 p-3 rounded-xl border border-slate-800/40 shrink-0">
                                    <div class="flex justify-between items-center shrink-0 cursor-pointer select-none hover:opacity-85 transition-opacity" onclick="SC.registry.get('data').toggle('projectsSub')">
                                        <h3 class="text-purple-400 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5">
                                            📁 Projects <span class="text-slate-500 text-[8px]">${this.ui.projectsSub ? '▼' : '▶'}</span>
                                        </h3>
                                        <button onclick="event.stopPropagation(); SC.actionCreateProject()" class="text-[9px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded transition-all font-bold uppercase tracking-wider">+ New Project</button>
                                    </div>
                                    ${this.ui.projectsSub ? `
                                    <div class="flex flex-col gap-1.5 overflow-y-auto max-h-[150px] custom-scrollbar pr-1" id="projects-list-container">
                                        ${projects.map(proj => {
                                            const isActive = proj.project_id === activeProjId;
                                            const meta = proj.meta || {};
                                            const title = meta.title || "Untitled Project";
                                            const icon = meta.icon || "📁";
                                            const color = meta.color || "#8b5cf6";
                                            const pagesCount = proj.page_ids ? proj.page_ids.length : 0;
                                            
                                            return `
                                            <div class="group flex flex-col gap-1 p-2 rounded-lg border transition-all cursor-pointer shrink-0 ${isActive ? 'bg-purple-950/30 border-purple-800/80 shadow-md ring-1 ring-purple-500/25' : 'bg-slate-950/50 border-slate-800/60 hover:border-slate-700/80'}" 
                                                 onclick="SC.actionSetActiveProject('${proj.project_id}')"
                                                 ondragover="event.preventDefault(); this.classList.add('bg-purple-900/40')"
                                                 ondragleave="this.classList.remove('bg-purple-900/40')"
                                                 ondrop="this.classList.remove('bg-purple-900/40'); SC.actionMovePageToProject(event, '${proj.project_id}')">
                                                <div class="flex items-center justify-between gap-2">
                                                    <span class="text-xs font-semibold truncate flex items-center gap-1.5 cursor-pointer">
                                                        <span style="color: ${color}">${icon}</span>
                                                        <span class="${isActive ? 'text-purple-300 font-bold' : 'text-slate-300 group-hover:text-slate-100'} truncate">${title}</span>
                                                    </span>
                                                    <div class="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                                                        <button onclick="event.stopPropagation(); SC.actionOpenProjectSettings('${proj.project_id}')" class="bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-[9px] py-0.5 px-2 rounded border border-slate-800/80 shadow transition-all font-bold uppercase tracking-wider flex items-center gap-1" title="Project Settings">⚙️ settings</button>
                                                    </div>
                                                </div>
                                                <div class="text-[9px] text-slate-500 pl-5">
                                                    <span>${pagesCount} pages</span>
                                                </div>
                                            </div>
                                            `;
                                        }).join('')}
                                    </div>
                                    ` : ''}
                                </div>
                                
                                <!-- Bottom Section: Pages Panel -->
                                <div class="flex flex-col gap-2 min-h-0 bg-slate-950/20 p-3 rounded-xl border border-slate-800/40 shrink-0">
                                    <div class="flex justify-between items-center shrink-0 gap-2 cursor-pointer select-none hover:opacity-85 transition-opacity" onclick="SC.registry.get('data').toggle('pagesSub')">
                                        <div class="flex flex-col min-w-0">
                                            <h3 class="text-sky-400 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5">
                                                📄 Pages <span class="text-slate-500 text-[8px]">${this.ui.pagesSub ? '▼' : '▶'}</span>
                                            </h3>
                                            <span class="text-[8px] text-slate-400 truncate font-semibold">Active Project: ${activeProjTitle}</span>
                                        </div>
                                        <button onclick="event.stopPropagation(); SC.actionCreatePage()" class="text-[9px] bg-sky-600 hover:bg-sky-500 text-white px-2 py-0.5 rounded transition-all font-bold uppercase tracking-wider shrink-0">+ New Page</button>
                                    </div>
                                    ${this.ui.pagesSub ? `
                                    <div class="flex flex-col gap-2 overflow-y-auto max-h-[250px] custom-scrollbar pr-1" id="pages-list-container">
                                        ${(!pages || pages.length === 0) ? '<div class="text-center text-slate-600 text-xs py-10 italic border border-dashed border-slate-800 rounded-lg">No pages found in this project.</div>' : ''}
                                        ${pages.map(page => {
                                            const isCurrentPage = page.map_id === state.map_id;
                                            const meta = page.meta || {};
                                            const title = meta.title || "Untitled Page";
                                            const type = meta.type || "generic";
                                            const nodeCount = page.nodes ? page.nodes.length : 0;
                                            
                                            // Determine storage target icon
                                            let storageIcon = '☁️'; // Default firebase
                                            if (meta.storage_target === 'google_drive') storageIcon = '🔺';
                                            else if (meta.storage_target === 'local_os') storageIcon = '📁';

                                            const activeBadge = isCurrentPage ? '<span class="text-[8px] bg-sky-950/60 border border-sky-600 text-sky-400 px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest font-extrabold">● Active</span>' : '';
                                            const loadBtn = isCurrentPage 
                                                ? `<button onclick="SC.actionCloseDataManager()" class="flex-1 bg-sky-950/40 hover:bg-sky-900/40 text-sky-450 hover:text-sky-350 text-[9px] py-1 rounded font-bold border border-sky-900/50 cursor-pointer transition-all shadow" title="Close Data Manager">Active Space</button>`
                                                : `<button onclick="SC.actionLoadFromLibrary('${page.map_id}')" class="flex-1 bg-slate-900 hover:bg-sky-600 text-white text-[9px] py-1 rounded font-bold transition-all border border-slate-800/80 shadow">Load</button>`;

                                            return `
                                            <div class="bg-slate-950/70 border rounded-xl overflow-hidden group relative hover:border-sky-500/40 transition-all shrink-0 ${isCurrentPage ? 'bg-slate-900/50 border-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.15)] ring-1 ring-sky-500/10' : 'border-slate-800/80'}" 
                                                 draggable="true" 
                                                 ondragstart="event.dataTransfer.setData('text/plain', '${page.map_id}')">
                                                <div class="absolute left-0 top-0 bottom-0 w-1 bg-sky-500 rounded-l-xl ${isCurrentPage ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity"></div>
                                                
                                                <div class="p-3 flex flex-col gap-2">
                                                    <!-- Title row -->
                                                    <div class="flex justify-between items-start gap-2">
                                                        <div class="font-bold text-xs text-slate-200 truncate flex-1 flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing">
                                                            <span title="Storage Target" class="shrink-0">${storageIcon}</span>
                                                            <span class="truncate">${title}</span>
                                                            ${activeBadge}
                                                            <span class="text-[8px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest">${type}</span>
                                                            ${meta.shared ? '<span class="text-[8px] bg-teal-900/50 border border-teal-700/50 text-teal-400 px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest">🔗 shared</span>' : ''}
                                                        </div>
                                                        <span class="text-[9px] text-slate-500 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800/60 shrink-0">${nodeCount} nodes</span>
                                                    </div>
                                                    
                                                    <!-- Action row: Load + Settings modal trigger -->
                                                    <div class="flex gap-1.5 ${isCurrentPage ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'} transition-opacity">
                                                        ${loadBtn}
                                                        <button onclick="SC.actionOpenPageSettings('${page.map_id}')" class="bg-slate-900 hover:bg-slate-700 text-slate-300 hover:text-white text-[9px] py-1 px-2.5 rounded font-bold transition-all border border-slate-800/80 shadow" title="Settings & Sharing">⚙️ Settings</button>
                                                    </div>
                                                </div>
                                            </div>
                                            `;
                                        }).join('')}
                                    </div>
                                    ` : ''}
                                </div>

                                <!-- Project Export/Import Panel -->
                                <div class="p-3 bg-slate-950/20 border border-slate-800/40 rounded-xl shadow-inner flex flex-col gap-2 shrink-0">
                                    <h3 class="text-emerald-400 font-bold uppercase text-[9px] tracking-widest block mb-0.5">📦 Project Package Exchange</h3>
                                    <div class="flex gap-2">
                                        <button onclick="SC.actionDownloadProject()" class="flex-1 py-2 bg-slate-850 hover:bg-purple-600/30 text-purple-400 hover:text-purple-300 text-[10px] font-bold rounded-lg transition-all border border-slate-700/60">
                                            💾 Export Project Package
                                        </button>
                                        <label class="flex-1 py-2 bg-slate-850 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 text-[10px] font-bold rounded-lg transition-all border border-slate-700/60 cursor-pointer text-center flex items-center justify-center gap-1">
                                            📂 Import Project/Page
                                            <input type="file" accept=".json" class="hidden" onchange="SC.actionUploadProjectOrPageFile(event)">
                                        </label>
                                    </div>
                                </div>
                                
                            </div>
                            ` : ''}
                        </div>
                        
                        
                        <!-- 0. Cloud Templates Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col shrink-0">
                            <div class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('templates')">
                                <h2 class="text-blue-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">🌐 Assets</h2>
                                <div class="flex items-center gap-3">
                                    <span class="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] border border-slate-700">${state.session.remoteTemplates ? state.session.remoteTemplates.length : 0} Available</span>
                                    <span class="text-slate-500 text-xs">${this.ui.templates ? '▼' : '▶'}</span>
                                </div>
                            </div>
                            
                            ${this.ui.templates ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-4 bg-slate-900">
                                <p class="text-[11px] text-slate-400">Fetch public, read-only map assets from the global repository. Importing an asset automatically drops a portal into your map and merges the asset's graph structure via that portal.</p>
                                
                                <div class="flex gap-2">
                                    <button onclick="SC.saveConstellation()" class="flex-1 py-2 bg-slate-800 hover:bg-purple-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700 flex items-center justify-center gap-2" title="Save Current Session">
                                        💾 <span class="hidden sm:inline">Save Current</span>
                                    </button>
                                    <label class="flex-1 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700 cursor-pointer text-center flex items-center justify-center gap-2" title="Upload Asset">
                                        ⬆️ <span class="hidden sm:inline">Upload Asset</span>
                                        <input type="file" accept=".json" class="hidden" onchange="SC.actionUploadTemplateFile(event)">
                                    </label>
                                </div>

                                <div class="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar pr-2 space-y-3 mt-2">
                                    ${(!state.session.remoteTemplates || state.session.remoteTemplates.length === 0) ? '<div class="text-center text-slate-600 text-xs py-6 italic border border-dashed border-slate-800 rounded-lg">No assets loaded. Click refresh.</div>' : ''}
                                    ${(state.session.remoteTemplates || []).map(tpl => {
                                        return `
                                        <div class="bg-slate-950 border border-slate-800 p-4 rounded-xl hover:border-blue-500 transition-colors group relative overflow-hidden flex flex-col gap-3">
                                            <div class="absolute left-0 top-0 bottom-0 w-1 ${tpl.isCustom ? 'bg-emerald-500' : 'bg-blue-500'} opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                            <div class="flex justify-between items-start">
                                                <div class="flex flex-col gap-1 pr-4">
                                                    <div class="font-bold text-sm text-slate-200 flex items-center gap-2">
                                                        ${tpl.title}
                                                        ${tpl.isCustom ? '<span class="px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 text-[8px] rounded border border-emerald-800 uppercase tracking-widest">Custom</span>' : '<span class="px-1.5 py-0.5 bg-blue-900/50 text-blue-400 text-[8px] rounded border border-blue-800 uppercase tracking-widest">Default</span>'}
                                                    </div>
                                                    <div class="text-[10px] text-slate-500">${tpl.desc} <span class="ml-2 px-1 bg-slate-800 rounded">${tpl.nodes} nodes</span></div>
                                                </div>
                                            </div>

                                            <div class="flex gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button onclick="SC.actionSpawnAssetAsPortal('${tpl.id}')"
                                                    class="flex-1 bg-slate-800 hover:bg-violet-600 text-slate-300 hover:text-white text-[10px] py-1.5 rounded font-bold transition-colors border border-slate-700 shadow flex items-center justify-center gap-1"
                                                    title="Spawn as portal in current map">
                                                    🌀 <span class="hidden sm:inline">Spawn Portal</span>
                                                </button>
                                                <button onclick="SC.showAssetProjectDropdown(event, '${tpl.id}')"
                                                    class="flex-1 bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-[10px] py-1.5 rounded font-bold transition-colors border border-slate-700 shadow flex items-center justify-center gap-1"
                                                    title="Import as dedicated page — choose project">
                                                    📄 <span class="hidden sm:inline">New Page</span> <span class="text-[8px] opacity-70">▾</span>
                                                </button>
                                                <button onclick="SC.actionDownloadTemplate('${tpl.id}')" class="bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white text-[10px] py-1.5 px-3 rounded font-bold transition-colors border border-slate-700 shadow" title="Download JSON">⬇️</button>
                                                ${tpl.isCustom ? `<button onclick="SC.actionDeleteRemoteTemplate('${tpl.id}')" class="bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white text-[10px] py-1.5 px-3 rounded font-bold transition-colors border border-slate-700 shadow" title="Delete">🗑️</button>` : ''}
                                            </div>
                                        </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                            ` : ''}
                        </div>

                        <!-- 2. API Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all shrink-0">
                            <div class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('api')">
                                <h2 class="text-sky-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">📡 API Federation</h2>
                                <span class="text-slate-500 text-xs">${this.ui.api ? '▼' : '▶'}</span>
                            </div>
                            ${this.ui.api ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-4">
                                <p class="text-[11px] text-slate-400">Your session history. Manage your saved map sessions locally. (Cloud sync coming soon)</p>
                                <div class="flex flex-col gap-1">
                                    <label class="text-[10px] text-slate-500 font-bold uppercase">Push Endpoint</label>
                                    <div class="flex gap-2">
                                        <input type="text" id="api-push-url" value="${this.kernel.bridge.pushUrl}" class="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-300 outline-none focus:border-sky-500 transition-colors">
                                        <button onclick="SC.actionPushApi()" class="px-4 py-2 bg-slate-800 hover:bg-sky-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700">Push</button>
                                    </div>
                                </div>
                                <div class="flex flex-col gap-1 mt-2">
                                    <label class="text-[10px] text-slate-500 font-bold uppercase">Pull Endpoint</label>
                                    <div class="flex gap-2">
                                        <input type="text" id="api-pull-url" value="${this.kernel.bridge.pullUrl}" class="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-300 outline-none focus:border-sky-500 transition-colors">
                                        <button onclick="SC.actionPullApi()" class="px-4 py-2 bg-slate-800 hover:bg-sky-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700">Pull</button>
                                    </div>
                                </div>
                                <button onclick="SC.actionSaveEndpoints()" class="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded shadow border border-slate-700 transition-all">Save Endpoints</button>
                            </div>
                            ` : ''}
                        </div>

                        <!-- 3. JSON Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col shrink-0">
                            <div id="data-accordion-json" class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('json')">
                                <h2 class="text-emerald-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">🧬 Raw JSON Exchange</h2>
                                <span class="text-slate-500 text-xs">${this.ui.json ? '▼' : '▶'}</span>
                            </div>
                            ${this.ui.json ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-3">
                                <div class="flex justify-between items-center">
                                    <p class="text-[10px] text-slate-400">Directly edit the matrix.</p>
                                    <button onclick="SC.actionCopyJson()" class="px-3 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-400 hover:text-white rounded text-[10px] font-bold transition-colors border border-slate-700">Copy</button>
                                </div>
                                
                                <textarea id="json-exchange" class="w-full h-64 bg-slate-950 border border-slate-700 rounded-lg p-4 font-mono text-[10px] text-emerald-400 focus:border-emerald-500 outline-none resize-none shadow-inner custom-scrollbar break-all overflow-y-auto">${JSON.stringify(state, null, 2)}</textarea>
                                
                                <div id="json-io-buttons" class="flex gap-2 mt-1">
                                    <button onclick="SC.actionExportJsonFile()" class="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest rounded-lg shadow-lg shadow-indigo-900/20 transition-transform active:scale-95 flex items-center justify-center gap-2" title="Export File">
                                        💾 <span class="hidden sm:inline">Export File</span>
                                    </button>
                                    <label class="flex-1 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-black uppercase tracking-widest rounded-lg shadow-lg shadow-slate-900/20 transition-all active:scale-95 cursor-pointer text-center flex items-center justify-center gap-2" title="Import File">
                                        📂 <span class="hidden sm:inline">Import File</span>
                                        <input type="file" accept=".json" class="hidden" onchange="SC.actionImportJsonFile(event)">
                                    </label>
                                </div>

                                <button onclick="SC.actionSyncJson()" class="w-full mt-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-widest rounded-lg shadow-lg shadow-emerald-900/20 transition-transform active:scale-95 flex justify-center items-center gap-2" title="Apply JSON">
                                    💉 <span class="hidden sm:inline">Inject / Apply JSON</span>
                                </button>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error("DataPhaseEngine render failed:", err);
            container.innerHTML = `<div class="p-4 bg-rose-950/50 border border-rose-900 rounded-lg flex flex-col gap-2">
                <strong>Engine Load Failed</strong>
                <textarea class="w-full h-32 bg-rose-950/80 border border-rose-900 text-rose-300 text-[10px] p-2 rounded outline-none resize-none font-mono" readonly>${err.message}\n\n${err.stack}</textarea>
                <button onclick="window.SC.registry.get('data').render(document.getElementById('data-manager-content'), window.SC.kernel.state)" class="bg-rose-900 hover:bg-rose-800 px-3 py-1 rounded text-white mt-2 self-start">Retry</button>
            </div>`;
        }
    }
}
