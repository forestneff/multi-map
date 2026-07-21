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
        this.register(new IframePhaseEngine(kernel, 'file', 'engines/file-explorer.html'));
        this.register(new IframePhaseEngine(kernel, 'text-edit', 'engines/text-editor.html'));
        
        this.register(new DataPhaseEngine(kernel)); 
        this.register(new LinkPhaseEngine(kernel)); 
        
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
                    if (window.SC.saveHistoryState) window.SC.saveHistoryState();
                    window.SC.render();
                } else if (type === 'ACTION' && event.data.action) {
                    const action = event.data.action;
                    if (action === 'LINK' && id) window.SC.actionLink(id);
                    else if (action === 'ADD_CHILD' && id) window.SC.actionAddChild(id);
                    else if (action === 'SAVE_CONSTELLATION' && id) window.SC.actionSaveConstellation(id);
                    else if (action === 'DELETE' && id) window.SC.actionDelete(id);
                    else if (action === 'ENTER_PORTAL' && id) window.SC.actionEnterPortal(id);
                    else if (action === 'OPEN_FILE_TAB' && id) window.SC.actionOpenFileInNewTab(id);
                    else if (action === 'EDIT_FILE_LOCALLY' && id) window.SC.actionEditFileLocally(id);
                    else if (action === 'TRIGGER_AI' && id) window.SC.actionTriggerAI(id);
                    else if (action === 'APPLY_TEMPLATE' && id && event.data.data) {
                        window.SC.actionApplyTemplateToNode(id, event.data.data);
                    }
                    else if (action === 'TRIGGER_LINKTREE_IMPORT' && id) {
                        window.SC.actionTriggerLinktreeImport(id);
                    }
                    else if (action === 'CREATE_SUBMAP_AND_LINK' && id && event.data.data) {
                        window.SC.actionSetPortalTarget(id, 'new');
                    }
                    else if (action === 'SHARE_PAGE' && id) {
                        window.SC.actionSharePageWithExpiry(id, event.data.data);
                    }
                    else if (action === 'REVOKE_SHARE_PAGE' && id) {
                        window.SC.actionRevokeShare(id);
                    }
                    else if (action === 'MOUNT_DIRECTORY' && id) {
                        window.SC.actionMountDirectory(id);
                    }
                    else if (action === 'AUTHORIZE_GOOGLE_SERVICES' && id) {
                        window.SC.actionAuthorizeGoogleServices(id);
                    }
                    else if (action === 'SAVE_FILE_CONTENT' && id && event.data.data) {
                        window.SC.actionSaveFileContent(id, event.data.data.content);
                    }
                    else if (action === 'CLOSE_FILE_EDITOR' && id) {
                        window.SC.actionCloseFileEditor(id);
                    }
                    else if (action === 'GIT_PUSH' && id && event.data.data) {
                        window.SC.actionGitPush(id, event.data.data);
                    }
                    else if (action === 'SWITCH_TO_MAP_VIEW') {
                        window.SC.setView('map');
                        window.SC.actionCloseDataManager();
                        window.SC.render();
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
            this.iframe.src = this.url + (this.url.includes('?') ? '&' : '?') + 't=' + Date.now();
            this.iframe.className = "w-full h-full border-none";
        }

        // Always update the onload handler to use the latest state and highlight
        const highlight = window.SC && window.SC.activeSearchHighlight ? window.SC.activeSearchHighlight : null;
        const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        this.iframe.onload = () => {
            if (this.iframe && this.iframe.contentWindow) {
                this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: stateClone, highlight: highlight, theme: theme }, '*');
            }
        };
        
        if (this.iframe.parentNode !== container) {
            container.innerHTML = ''; // Clear container
            container.appendChild(this.iframe);
        }
        
        if (this.iframe.contentWindow) {
            const highlight = window.SC && window.SC.activeSearchHighlight ? window.SC.activeSearchHighlight : null;
            const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
            this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: stateClone, highlight: highlight, theme: theme }, '*');
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
            const sortedPages = [...pages].sort((a, b) => {
                const aIsMaster = a.meta && a.meta.isMaster === true;
                const bIsMaster = b.meta && b.meta.isMaster === true;
                if (aIsMaster && !bIsMaster) return -1;
                if (!aIsMaster && bIsMaster) return 1;
                return 0;
            });
            
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
                            const activeVault = this.kernel.activeVault;
                            let vaultLabel = 'Local Browser (Legacy) 📁';
                            if (activeVault === 'firebase') vaultLabel = 'Firebase (Cloud) ☁️';
                            else if (activeVault === 'gdrive') vaultLabel = 'Google Drive 🔺';
                            else if (activeVault === 'local-os') vaultLabel = 'Local OS 💾';
                            
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
                                                <span>Target: ${vaultLabel}</span>
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
                                        ${(() => {
                                            if (activeVault === 'firebase') return '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Firebase';
                                            if (activeVault === 'gdrive') return '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Google Drive';
                                            if (activeVault === 'local-os') return '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local OS';
                                            return '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local';
                                        })()}
                                    </span>
                                </div>
                                `}
                                
                                <div class="flex justify-between items-center px-1 border-t border-slate-800/40 pt-2 select-none">
                                    <span class="text-[9px] text-slate-500">Show All Projects:</span>
                                    <label class="flex items-center gap-1 cursor-pointer text-[9px] text-slate-400 hover:text-slate-300 transition-colors" title="Toggle aggregation of all project vaults">
                                        <input type="checkbox" onchange="SC.actionToggleShowAllVaults(this.checked)" ${this.kernel.showAllVaults ? 'checked' : ''} class="w-3 h-3 bg-slate-950 border border-slate-700 text-purple-650 rounded focus:ring-purple-600 cursor-pointer">
                                        <span class="font-semibold text-slate-400">Aggregated</span>
                                    </label>
                                </div>
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
                                        <button onclick="event.stopPropagation(); SC.actionCreateProject()" class="text-[9px] bg-purple-600 hover:bg-purple-500 text-white px-2 py-0.5 rounded transition-all font-bold uppercase tracking-wider cursor-pointer">+ New Project</button>
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
                                            
                                            const vault = proj.vault || 'local';
                                            let vaultBadge = '';
                                            if (vault === 'firebase') vaultBadge = '<span class="text-[8px] bg-sky-950 border border-sky-800 text-sky-400 px-1 py-0.5 rounded font-mono font-bold select-none leading-none">Firebase</span>';
                                            else if (vault === 'gdrive') vaultBadge = '<span class="text-[8px] bg-amber-950 border border-amber-800 text-amber-400 px-1 py-0.5 rounded font-mono font-bold select-none leading-none">GDrive</span>';
                                            else if (vault === 'local-os') vaultBadge = '<span class="text-[8px] bg-emerald-950 border border-emerald-800 text-emerald-400 px-1 py-0.5 rounded font-mono font-bold select-none leading-none">Local OS</span>';
                                            else vaultBadge = '<span class="text-[8px] bg-slate-800 border border-slate-700 text-slate-400 px-1 py-0.5 rounded font-mono font-bold select-none leading-none">Local</span>';

                                            return `
                                            <div id="proj-item-${proj.project_id}" class="group flex flex-col gap-1 p-2 rounded-lg border transition-all cursor-pointer shrink-0 ${isActive ? 'bg-purple-950/30 border-purple-800/80 shadow-md ring-1 ring-purple-500/25' : 'bg-slate-950/50 border-slate-800/60 hover:border-slate-700/80'}" 
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
                                                        <button onclick="event.stopPropagation(); SC.showTransferProjectDropdown(event, '${proj.project_id}')" class="bg-slate-900 hover:bg-slate-800 text-purple-300 hover:text-purple-100 text-[9px] py-0.5 px-2 rounded border border-slate-800/80 shadow transition-all font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer" title="Transfer Project">🔄 Transfer</button>
                                                        <button onclick="event.stopPropagation(); SC.actionOpenProjectSettings('${proj.project_id}')" class="bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-[9px] py-0.5 px-2 rounded border border-slate-800/80 shadow transition-all font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer" title="Project Settings">⚙️ settings</button>
                                                    </div>
                                                </div>
                                                <div class="text-[9px] text-slate-500 pl-5 flex items-center justify-between gap-2">
                                                    <span>${pagesCount} pages</span>
                                                    ${vaultBadge}
                                                </div>
                                            </div>
                                            `;
                                        }).join('')}
                                    </div>
                                    ` : ''}
                                </div>
                                
                                <!-- Bottom Section: Content Panel -->
                                <div class="flex flex-col gap-2 min-h-0 bg-slate-950/20 p-3 rounded-xl border border-slate-800/40 shrink-0">
                                    <div class="flex justify-between items-center shrink-0 gap-2 cursor-pointer select-none hover:opacity-85 transition-opacity" onclick="SC.registry.get('data').toggle('pagesSub')">
                                        <div class="flex flex-col min-w-0">
                                            <h3 class="text-sky-400 font-bold uppercase text-[10px] tracking-widest flex items-center gap-1.5">
                                                📄 Content <span class="text-slate-500 text-[8px]">${this.ui.pagesSub ? '▼' : '▶'}</span>
                                            </h3>
                                            <span class="text-[8px] text-slate-400 truncate font-semibold">Active Project: ${activeProjTitle}</span>
                                        </div>
                                        <div class="flex gap-1 shrink-0">
                                            <button onclick="event.stopPropagation(); SC.actionCreateProjectFolder()" class="text-[9px] bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded transition-all font-bold uppercase tracking-wider">+ New Folder</button>
                                            <button onclick="event.stopPropagation(); SC.actionCreatePage()" class="text-[9px] bg-sky-600 hover:bg-sky-500 text-white px-2 py-0.5 rounded transition-all font-bold uppercase tracking-wider">+ New Page</button>
                                        </div>
                                    </div>
                                    ${this.ui.pagesSub ? (() => {
                                        const activeProject = projects.find(p => p.project_id === activeProjId);
                                        const folders = activeProject?.folders || [];
                                        const pageAssignments = activeProject?.page_assignments || {};
                                         const renderPageItem = (page, indentClass = "") => {
                                            const isCurrentPage = page.map_id === state.map_id;
                                            const meta = page.meta || {};
                                            const title = meta.title || "Untitled Page";
                                            const type = meta.type || "generic";
                                            const nodeCount = page.nodes ? page.nodes.length : 0;
                                            const isMaster = meta.isMaster === true;
                                            
                                            let storageIcon = '☁️';
                                            if (meta.storage_target === 'google_drive') storageIcon = '🔺';
                                            else if (meta.storage_target === 'local_os') storageIcon = '📁';

                                            const accentColor = isMaster ? 'purple' : 'sky';
                                            const cardClasses = isMaster
                                                ? 'bg-purple-950/20 border-purple-800/80 shadow-[0_0_15px_rgba(139,92,246,0.15)] ring-1 ring-purple-500/20 hover:border-purple-500'
                                                : (isCurrentPage ? 'bg-slate-900/50 border-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.15)] ring-1 ring-sky-500/10 hover:border-sky-500/80' : 'border-slate-800/80 hover:border-sky-500/40');
                                                
                                            const leftBarClasses = isMaster ? 'bg-purple-500' : 'bg-sky-500';
                                            const leftBarOpacity = (isMaster || isCurrentPage) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';

                                            const typeIcons = {
                                                'web': '🌐',
                                                'person': '👤',
                                                'prompt': '💬',
                                                'agent': '🤖',
                                                'file': '📁',
                                                'generic': '📄'
                                            };
                                            const typeIcon = typeIcons[type] || '📄';

                                            const activeBadge = isCurrentPage 
                                                ? `<span class="text-[8px] bg-${accentColor}-950/60 border border-${accentColor}-600 text-${accentColor}-400 px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest font-extrabold sm:inline-block hidden">● Active</span><span class="text-[9px] text-${accentColor}-400 shrink-0 sm:hidden block font-bold" title="Active Space">●</span>` 
                                                : '';
                                            const loadBtn = isCurrentPage 
                                                ? `<button onclick="SC.actionCloseDataManager()" class="flex-1 bg-${accentColor}-950/40 hover:bg-${accentColor}-900/40 text-${accentColor}-450 hover:text-${accentColor}-350 text-[9px] py-1 rounded font-bold border border-${accentColor}-900/50 cursor-pointer transition-all shadow" title="Close Data Manager">Active Space</button>`
                                                : `<button onclick="SC.actionLoadFromLibrary('${page.map_id}')" class="flex-1 bg-slate-900 hover:bg-${accentColor}-600 text-white text-[9px] py-1 rounded font-bold transition-all border border-slate-800/80 shadow">Load</button>`;

                                            const typeBadgeColor = isMaster ? 'bg-purple-950 border-purple-800/60 text-purple-300' : 'bg-slate-900 border border-slate-800 text-slate-400';

                                            return `
                                            <div id="page-item-${page.map_id}" class="bg-slate-950/70 border rounded-xl overflow-hidden group relative transition-all shrink-0 ${cardClasses} ${indentClass}" 
                                                  draggable="true" 
                                                  ondragstart="event.dataTransfer.setData('text/plain', 'page:${page.map_id}')">
                                                <div class="absolute left-0 top-0 bottom-0 w-1 ${leftBarClasses} rounded-l-xl ${leftBarOpacity} transition-opacity"></div>
                                                
                                                <div class="p-3 flex flex-col gap-2">
                                                    <div class="flex justify-between items-start gap-2">
                                                        <div class="font-bold text-xs text-slate-200 truncate flex-1 flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing">
                                                            <span title="Storage Target" class="shrink-0">${storageIcon}</span>
                                                            <span class="truncate ${isMaster ? 'text-purple-300 font-extrabold' : ''}">${title}</span>
                                                            ${activeBadge}
                                                            <span class="text-[8px] border px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest ${typeBadgeColor} sm:inline-block hidden">${type}</span>
                                                            <span class="text-[10px] shrink-0 sm:hidden block" title="Page Type: ${type}">${typeIcon}</span>
                                                            ${meta.shared ? `
                                                                <span class="text-[8px] bg-teal-900/50 border border-teal-700/50 text-teal-400 px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-widest sm:inline-block hidden">🔗 shared</span>
                                                                <span class="text-teal-400 text-[10px] shrink-0 sm:hidden block" title="Shared Page">🔗</span>
                                                            ` : ''}
                                                        </div>
                                                        <span class="text-[9px] text-slate-500 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800/60 shrink-0 sm:inline-block hidden">${nodeCount} nodes</span>
                                                        <span class="text-[9px] text-slate-400 shrink-0 sm:hidden block" title="${nodeCount} nodes">⬡ ${nodeCount}</span>
                                                    </div>
                                                    
                                                    <div class="flex gap-1.5 ${isCurrentPage ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'} transition-opacity">
                                                        ${loadBtn}
                                                        <button onclick="SC.actionOpenPageSettings('${page.map_id}')" class="bg-slate-900 hover:bg-slate-700 text-slate-300 hover:text-white text-[9px] py-1 px-2.5 rounded font-bold transition-all border border-slate-800/80 shadow" title="Settings & Sharing">⚙️ Settings</button>
                                                    </div>
                                                </div>
                                            </div>
                                            `;
                                        };

                                        const renderFolder = (folderId, depth = 0) => {
                                            const folder = folders.find(f => f.id === folderId);
                                            if (!folder) return '';
                                            const indentClass = depth > 0 ? `ml-4 border-l-2 border-emerald-900/30 pl-2` : '';
                                            
                                            const childFolders = folders.filter(f => f.parent_id === folderId);
                                            const childPages = sortedPages.filter(p => pageAssignments[p.map_id] === folderId && !p.meta?.isMaster);
                                            
                                            const isExpanded = folder.isExpanded !== false;
                                            
                                            return `
                                            <div class="flex flex-col gap-1 ${indentClass}" 
                                                 ondragover="event.preventDefault(); event.stopPropagation(); this.classList.add('bg-emerald-900/20')"
                                                 ondragleave="event.stopPropagation(); this.classList.remove('bg-emerald-900/20')"
                                                 ondrop="event.stopPropagation(); this.classList.remove('bg-emerald-900/20'); SC.actionAssignToFolder(event, '${folderId}')">
                                                <div class="flex items-center justify-between group bg-slate-900/40 border border-emerald-900/50 p-2 rounded hover:border-emerald-700/50 transition-colors" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', 'folder:${folderId}')">
                                                    <div class="flex items-center gap-2 cursor-pointer flex-1" onclick="SC.actionToggleFolder('${folderId}')">
                                                        <span class="text-[10px] text-emerald-500">${isExpanded ? '▼' : '▶'}</span>
                                                        <span class="text-xs font-bold text-emerald-400">📁 ${folder.name}</span>
                                                    </div>
                                                    <div class="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                                        <button onclick="SC.actionRenameProjectFolder('${folderId}')" class="text-[9px] text-slate-400 hover:text-white px-1">✏️</button>
                                                        <button onclick="SC.actionDeleteProjectFolder('${folderId}')" class="text-[9px] text-rose-400 hover:text-rose-300 px-1">🗑️</button>
                                                    </div>
                                                </div>
                                                ${isExpanded ? `
                                                <div class="flex flex-col gap-2 mt-1">
                                                    ${childFolders.map(f => renderFolder(f.id, depth + 1)).join('')}
                                                    ${childPages.map(p => renderPageItem(p, "ml-4 border-l border-emerald-900/30")).join('')}
                                                </div>
                                                ` : ''}
                                            </div>
                                            `;
                                        };

                                        const rootFolders = folders.filter(f => !f.parent_id);
                                        const rootPages = sortedPages.filter(p => !pageAssignments[p.map_id] && !p.meta?.isMaster);
                                        const masterPages = sortedPages.filter(p => p.meta?.isMaster);
                                        
                                        if (rootFolders.length === 0 && rootPages.length === 0 && masterPages.length === 0) {
                                            return '<div class="text-center text-slate-600 text-xs py-10 italic border border-dashed border-slate-800 rounded-lg">No content found in this project.</div>';
                                        }

                                        setTimeout(() => {
                                            const activePage = document.getElementById(`page-item-${state.map_id}`);
                                            if (activePage) {
                                                activePage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                            }
                                        }, 100);

                                        return `
                                        <div class="flex flex-col gap-2 overflow-y-auto max-h-[350px] custom-scrollbar pr-1" id="pages-list-container"
                                             ondragover="event.preventDefault(); this.classList.add('bg-slate-900/20')"
                                             ondragleave="this.classList.remove('bg-slate-900/20')"
                                             ondrop="this.classList.remove('bg-slate-900/20'); SC.actionAssignToFolder(event, '')">
                                            ${masterPages.map(p => renderPageItem(p)).join('')}
                                            ${rootFolders.map(f => renderFolder(f.id)).join('')}
                                            ${rootPages.map(p => renderPageItem(p)).join('')}
                                        </div>
                                        `;
                                    })() : ''}
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

            setTimeout(() => {
                const activeProjEl = container.querySelector(`#proj-item-${activeProjId}`);
                if (activeProjEl) {
                    activeProjEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                }
                const activePageEl = container.querySelector(`#page-item-${state.map_id}`);
                if (activePageEl) {
                    activePageEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                }
            }, 100);
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

class LinkPhaseEngine extends PhaseEngineBase {
    constructor(kernel) {
        super(kernel);
        this.id = 'link';
        this._metaCache = {}; // In-memory cache keyed by URL
        this._fetchingUrls = new Set();
    }

    /**
     * Fetches link metadata from the cloud function, with in-memory caching.
     * Also persists fetched metadata onto the node's data._linkMeta field.
     */
    async fetchMeta(url, nodeId) {
        if (!url) return null;
        if (this._metaCache[url]) return this._metaCache[url];
        if (this._fetchingUrls.has(url)) return null; // Already in-flight

        this._fetchingUrls.add(url);

        try {
            let endpoint = 'https://us-central1-mm-multi-map.cloudfunctions.net/generateMapState/link-meta';
            if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname === '0.0.0.0' || window.location.hostname === '[::1]') {
                const host = (window.location.hostname === '0.0.0.0' || window.location.hostname === '[::1]' || !window.location.hostname) ? '127.0.0.1' : window.location.hostname;
                endpoint = `http://${host}:5001/mm-multi-map/us-central1/generateMapState/link-meta`;
            }

            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });

            if (!resp.ok) {
                this._fetchingUrls.delete(url);
                return null;
            }

            const meta = await resp.json();
            this._metaCache[url] = meta;
            this._fetchingUrls.delete(url);

            // Persist to node data for offline use
            if (nodeId && window.SC && window.SC.kernel) {
                const node = window.SC.kernel.state.nodes.find(n => n.id === nodeId);
                if (node) {
                    if (!node.data) node.data = {};
                    node.data._linkMeta = meta;
                    node.data._linkMetaTs = Date.now();
                }
            }

            // Re-render to show fetched data
            const container = document.getElementById('view-content');
            if (container && window.SC && window.SC.viewMode === 'link') {
                this.render(container, window.SC.kernel.state);
            }

            return meta;
        } catch (err) {
            console.warn('LinkPhaseEngine: fetchMeta failed for', url, err);
            this._fetchingUrls.delete(url);
            return null;
        }
    }

    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    render(container, state) {
        container.innerHTML = '';
        const isLight = document.body.classList.contains('light-mode');
        container.className = `link-phase-container w-full h-full overflow-y-auto p-6 flex flex-col gap-6 custom-scrollbar ${isLight ? 'link-phase-light' : 'link-phase-dark'}`;

        // Resolve root node title
        const rootNode = (state.nodes || []).find(n => n.type === 'link-root');
        const pageTitle = (rootNode && rootNode.title) || 'Link Space';

        // Header section
        const header = document.createElement('div');
        header.className = 'link-phase-header flex flex-col gap-1 pb-4 border-b items-center text-center';
        header.innerHTML = `
            <h2 class="text-xl font-extrabold tracking-tight flex items-center gap-2 justify-center">
                <span>🔗</span> ${this.escapeHTML(pageTitle)}
            </h2>
        `;
        container.appendChild(header);

        // Find all web-link nodes
        const linkNodes = (state.nodes || []).filter(n => n.type === 'web-link');

        if (linkNodes.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'link-phase-empty flex-1 flex flex-col items-center justify-center text-center py-12 px-6 border border-dashed rounded-2xl';
            emptyState.innerHTML = `
                <div class="text-4xl mb-3">🌳</div>
                <div class="font-bold text-sm mb-1">No Link Nodes Found</div>
                <p class="text-[11px] link-phase-muted max-w-xs leading-normal">Add web-link nodes (🔗) to this space and set their <strong>href</strong> field to a URL. Metadata will be fetched automatically.</p>
            `;
            container.appendChild(emptyState);
            return;
        }

        // Build parent lookup from connections
        const parentMap = {}; // nodeId → parentId
        (state.connections || []).forEach(c => {
            if (c.type === 'structural') {
                parentMap[c.to] = c.from;
            }
        });

        // Find hub nodes and organize links into groups
        const hubNodes = (state.nodes || []).filter(n => n.type === 'hub');
        const hubMap = {};
        hubNodes.forEach(h => { hubMap[h.id] = h; });

        // Group links: { hubId: [linkNodes], '__ungrouped__': [linkNodes] }
        const groups = {};
        const hubOrder = []; // Track hub order as encountered

        linkNodes.forEach(node => {
            const parentId = parentMap[node.id];
            if (parentId && hubMap[parentId]) {
                if (!groups[parentId]) {
                    groups[parentId] = [];
                    hubOrder.push(parentId);
                }
                groups[parentId].push(node);
            } else {
                if (!groups['__ungrouped__']) groups['__ungrouped__'] = [];
                groups['__ungrouped__'].push(node);
            }
        });

        // Render order: hub sections first, then ungrouped at the bottom
        const sectionOrder = [];
        hubOrder.forEach(hid => sectionOrder.push(hid));
        if (groups['__ungrouped__'] && groups['__ungrouped__'].length > 0) {
            sectionOrder.push('__ungrouped__');
        }

        // Stack container
        const stack = document.createElement('div');
        stack.className = 'flex flex-col gap-4 max-w-2xl mx-auto w-full pb-10';

        sectionOrder.forEach(groupKey => {
            const links = groups[groupKey];
            if (!links || links.length === 0) return;

            // Hub group: collapsible accordion section
            if (groupKey !== '__ungrouped__' && hubMap[groupKey]) {
                const hub = hubMap[groupKey];
                const isCollapsed = hub.data && hub.data.collapsed;

                // Section wrapper
                const section = document.createElement('div');
                section.className = 'link-phase-section';

                // Clickable header
                const sectionHeader = document.createElement('div');
                sectionHeader.className = 'link-phase-section-header flex items-center gap-2 py-2 cursor-pointer select-none';
                sectionHeader.innerHTML = `
                    <span class="text-[11px] transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}" style="display:inline-block;">▶</span>
                    <span class="text-base">💠</span>
                    <span class="font-bold text-sm tracking-wide">${this.escapeHTML(hub.title || 'Untitled Hub')}</span>
                    <span class="link-phase-muted text-[10px] ml-1">${links.length}</span>
                    <div class="flex-1 border-b link-phase-header ml-2" style="border-style: solid;"></div>
                `;

                // Toggle collapse on click — syncs with map node
                sectionHeader.onclick = () => {
                    if (window.SC && window.SC.kernel) {
                        window.SC.kernel.toggleCollapse(hub.id);
                        window.SC.render();
                        // Re-render this phase view to reflect the new state
                        const container = document.getElementById('view-content');
                        if (container && window.SC.viewMode === 'link') {
                            this.render(container, window.SC.kernel.state);
                        }
                    }
                };

                section.appendChild(sectionHeader);

                // Card container (hidden when collapsed)
                if (!isCollapsed) {
                    const cardGroup = document.createElement('div');
                    cardGroup.className = 'flex flex-col gap-4 mt-2';
                    links.forEach(node => {
                        cardGroup.appendChild(this._renderLinkCard(node, state));
                    });
                    section.appendChild(cardGroup);
                }

                stack.appendChild(section);

            } else {
                // Ungrouped links — flat list with a subtle label
                if (sectionOrder.length > 1) {
                    // Only show label if there are also hub sections above
                    const label = document.createElement('div');
                    label.className = 'link-phase-muted text-[10px] uppercase font-bold tracking-widest pt-4 pb-1';
                    label.textContent = 'Uncategorized';
                    stack.appendChild(label);
                }

                links.forEach(node => {
                    stack.appendChild(this._renderLinkCard(node, state));
                });
            }
        });

        container.appendChild(stack);
    }

    /**
     * Renders a single link card element for a web-link node.
     */
    _renderLinkCard(node, state) {
        let pData = {};
        let isJson = false;
        try {
            pData = JSON.parse(node.content || '{}');
            isJson = true;
        } catch(e) {
            pData = { text: node.content || '', href: '' };
        }

        // Resolve URL using the same logic as getWebLinkUrl on the map canvas
        let url = (pData.href || '').trim();
        if (!url && isJson) {
            const candidates = [pData.text, pData.src, pData.classes].filter(Boolean);
            for (const candidate of candidates) {
                const txt = candidate.trim();
                if (txt.match(/^(https?:\/\/|www\.)/i) || txt.match(/^[a-z0-9\-]+\.[a-z]{2,6}(\/|$)/i)) {
                    url = txt;
                    break;
                }
            }
        }
        if (!url && !isJson && node.content) {
            url = node.content.trim();
        }
        if (url && !/^(https?:\/\/|file:\/\/)/i.test(url) && !/^[.\/]/.test(url)) {
            url = 'https://' + url;
        }
        if (url && /^[#.\/]/.test(url)) {
            url = '';
        }

        const nodeText = pData.text || node.title || '';

        // Get cached/persisted metadata
        const cachedMeta = this._metaCache[url] || (node.data && node.data._linkMeta) || null;
        if (!this._metaCache[url] && cachedMeta) {
            this._metaCache[url] = cachedMeta;
        }

        // Kick off fetch if needed
        const META_TTL = 1000 * 60 * 60 * 24;
        const metaTs = (node.data && node.data._linkMetaTs) || 0;
        if (url && !cachedMeta && !this._fetchingUrls.has(url)) {
            this.fetchMeta(url, node.id);
        } else if (url && cachedMeta && (Date.now() - metaTs > META_TTL) && !this._fetchingUrls.has(url)) {
            this.fetchMeta(url, node.id);
        }

        // Resolve display values
        const title = (cachedMeta && cachedMeta.title) || nodeText || 'Untitled Link';
        const description = (cachedMeta && cachedMeta.description) || pData.description || '';
        const ogImage = (cachedMeta && cachedMeta.image) || pData.src || '';
        const siteName = (cachedMeta && cachedMeta.siteName) || '';
        const favicon = (cachedMeta && cachedMeta.favicon) || '';
        const themeColor = (cachedMeta && cachedMeta.themeColor) || '';
        const isFetching = url && !cachedMeta && this._fetchingUrls.has(url);

        let domain = '';
        try { domain = new URL(url).hostname.replace('www.', ''); } catch(e) {}

        const card = document.createElement('div');
        card.className = 'link-card rounded-2xl overflow-hidden transition-all duration-300 group relative cursor-pointer';
        if (themeColor) {
            card.style.borderLeftColor = themeColor;
            card.style.borderLeftWidth = '3px';
        }

        // OG image banner
        let ogImageHtml = '';
        if (ogImage) {
            ogImageHtml = `
                <div class="link-card-image w-full h-36 overflow-hidden relative">
                    <img src="${this.escapeHTML(ogImage)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.parentElement.style.display='none'" alt="">
                    <div class="link-card-image-overlay absolute inset-0"></div>
                </div>
            `;
        }

        // Favicon
        let faviconHtml = '';
        if (favicon) {
            faviconHtml = `<img src="${this.escapeHTML(favicon)}" class="w-4 h-4 rounded-sm" onerror="this.style.display='none'" alt="">`;
        } else {
            faviconHtml = `<span class="text-xs">🔗</span>`;
        }

        // Site label
        let siteLabel = '';
        if (siteName) {
            siteLabel = `<span class="link-phase-muted text-[10px] font-bold uppercase tracking-wider">${this.escapeHTML(siteName)}</span>`;
        } else if (domain) {
            siteLabel = `<span class="link-phase-muted text-[10px] font-bold uppercase tracking-wider">${this.escapeHTML(domain)}</span>`;
        }

        card.innerHTML = `
            ${ogImageHtml}
            <div class="p-4 flex gap-3">
                <div class="flex-1 min-w-0 flex flex-col gap-1.5">
                    <div class="flex items-center gap-2">
                        ${faviconHtml}
                        ${siteLabel}
                        ${isFetching ? '<span class="text-[9px] text-indigo-400 animate-pulse ml-auto">Fetching...</span>' : ''}
                    </div>
                    <h3 class="link-card-title font-extrabold text-[15px] leading-snug group-hover:text-indigo-400 transition-colors line-clamp-2">${this.escapeHTML(title)}</h3>
                    ${description ? `<p class="link-phase-muted text-[11px] leading-relaxed line-clamp-3">${this.escapeHTML(description)}</p>` : ''}
                    <div class="link-card-url text-[10px] truncate mt-0.5 flex items-center gap-1">
                        ${url ? `<span>🌐</span> ${this.escapeHTML(domain || url)}` : '<span class="link-phase-muted italic">No URL configured</span>'}
                    </div>
                </div>
                ${url ? `
                    <div class="flex flex-col gap-2 shrink-0 justify-center">
                        <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${this.escapeHTML(url)}').then(() => { if(window.SC) window.SC.showToast('URL copied!', 'success'); })" class="link-card-copy-btn p-2.5 rounded-xl transition-all text-xs" title="Copy URL">📋</button>
                    </div>
                ` : ''}
            </div>
        `;

        // Click opens link in new tab (or selects node if no URL)
        card.onclick = () => {
            if (url) {
                window.open(url, '_blank', 'noopener');
            } else if (window.SC && window.SC.kernel) {
                window.SC.kernel.selectNode(node.id);
                window.SC.render();
            }
        };

        return card;
    }

    /**
     * Force-refreshes metadata for a URL by busting the cache.
     */
    refreshMeta(url, nodeId) {
        delete this._metaCache[url];
        this._fetchingUrls.delete(url);
        // Clear persisted meta
        if (nodeId && window.SC && window.SC.kernel) {
            const node = window.SC.kernel.state.nodes.find(n => n.id === nodeId);
            if (node && node.data) {
                delete node.data._linkMeta;
                delete node.data._linkMetaTs;
            }
        }
        this.fetchMeta(url, nodeId);
        if (window.SC) window.SC.showToast('Refreshing metadata...', 'info');
    }
}

