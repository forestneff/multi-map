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
        this.register(new UniversalPhaseEngine(kernel));
        this.register(new WebPhaseEngine(kernel));
        this.register(new OrbitalPhaseEngine(kernel));
        this.register(new DataPhaseEngine(kernel)); 
    }
    register(engine) { this.engines.push(engine); }
    get(id) { return this.engines.find(e => e.id === id); }
}

class PhaseEngineBase {
    constructor(kernel) { this.kernel = kernel; this.id = 'base'; }
    render(container, state) { }
    escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}

class DataPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { 
        super(kernel); 
        this.id = 'data'; 
        this.ui = { templates: true, api: false, json: false, library: true, openItems: {} };
    }
    
    toggle(section) {
        this.ui[section] = !this.ui[section];
        const container = document.getElementById('view-content');
        if (container) this.render(container, this.kernel.state);
    }

    toggleItem(id) {
        this.ui.openItems[id] = !this.ui.openItems[id];
        const container = document.getElementById('view-content');
        if (container) this.render(container, this.kernel.state);
    }
    
    render(container, state) {
        const lib = this.kernel.getLibrary();
        
        container.innerHTML = `
            <div class="min-h-full w-full overflow-y-auto custom-scrollbar p-6 md:p-10 bg-slate-950 flex flex-col items-center">
                <div class="max-w-3xl w-full flex flex-col gap-6 pb-20">
                    
                    <div class="border-b border-slate-800 pb-4 mb-2">
                        <h1 class="text-3xl font-black text-white flex items-center gap-3"><span class="text-sky-500">🗄️</span> Data Manager</h1>
                        <p class="text-slate-400 mt-2 text-sm">Manage local constellations, import cloud templates, map APIs, and process raw JSON.</p>
                    </div>

                    <div class="flex flex-col gap-6">
                        
                        <!-- 0. Cloud Templates Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col">
                            <div class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('templates')">
                                <h2 class="text-blue-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">🌐 Cloud Templates</h2>
                                <div class="flex items-center gap-3">
                                    <span class="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] border border-slate-700">${state.session.remoteTemplates ? state.session.remoteTemplates.length : 0} Available</span>
                                    <span class="text-slate-500 text-xs">${this.ui.templates ? '▼' : '▶'}</span>
                                </div>
                            </div>
                            
                            ${this.ui.templates ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-4 bg-slate-900">
                                <p class="text-[11px] text-slate-400">Fetch public, read-only map templates from the global repository. Importing a template automatically drops a portal into your map and merges the template's graph structure via that portal.</p>
                                
                                <div class="flex gap-2">
                                    <button onclick="SC.actionLoadRemoteTemplates()" class="flex-1 py-2 bg-slate-800 hover:bg-blue-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700 flex items-center justify-center gap-2" title="Refresh Library">
                                        🔄 <span class="hidden sm:inline">Refresh Library</span>
                                    </button>
                                    <label class="flex-1 py-2 bg-slate-800 hover:bg-emerald-600 hover:text-white transition-colors text-xs font-bold rounded shadow border border-slate-700 cursor-pointer text-center flex items-center justify-center gap-2" title="Upload Template">
                                        ⬆️ <span class="hidden sm:inline">Upload Template</span>
                                        <input type="file" accept=".json" class="hidden" onchange="SC.actionUploadTemplateFile(event)">
                                    </label>
                                </div>

                                <div class="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar pr-2 space-y-3 mt-2">
                                    ${(!state.session.remoteTemplates || state.session.remoteTemplates.length === 0) ? '<div class="text-center text-slate-600 text-xs py-6 italic border border-dashed border-slate-800 rounded-lg">No templates loaded. Click refresh.</div>' : ''}
                                    ${(state.session.remoteTemplates || []).map(tpl => `
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
                                                <button onclick="SC.actionSpawnTemplate('${tpl.id}')" class="flex-1 bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-[10px] py-1.5 rounded font-bold transition-colors border border-slate-700 shadow flex items-center justify-center gap-1" title="Import to Map">
                                                    🌀 <span class="hidden sm:inline">Import to Map</span>
                                                </button>
                                                <button onclick="SC.actionDownloadTemplate('${tpl.id}')" class="bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white text-[10px] py-1.5 px-3 rounded font-bold transition-colors border border-slate-700 shadow" title="Download JSON">⬇️</button>
                                                ${tpl.isCustom ? `<button onclick="SC.actionDeleteRemoteTemplate('${tpl.id}')" class="bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white text-[10px] py-1.5 px-3 rounded font-bold transition-colors border border-slate-700 shadow" title="Delete Custom Template">🗑️</button>` : ''}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            ` : ''}
                        </div>

                        <!-- 1. Library Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col">
                            <div id="data-accordion-library" class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('library')">
                                <h2 class="text-purple-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">📚 Saved Constellations</h2>
                                <div class="flex items-center gap-3">
                                    <span class="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] border border-slate-700">${lib.length} Items</span>
                                    <span class="text-slate-500 text-xs">${this.ui.library ? '▼' : '▶'}</span>
                                </div>
                            </div>
                            
                            ${this.ui.library ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-4 bg-slate-900">
                                
                                <div class="flex flex-col sm:flex-row gap-2">
                                    <button id="btn-save-session" onclick="SC.actionSaveCurrentToLibrary()" class="flex-1 py-3 border border-purple-500/50 hover:bg-purple-600/20 text-purple-400 hover:text-purple-300 font-bold text-xs uppercase tracking-widest rounded-lg transition-colors bg-slate-950 flex justify-center items-center gap-2">
                                        ➕ <span class="hidden sm:inline">Save Current Session</span>
                                    </button>
                                    <div class="flex flex-1 gap-2">
                                        <button onclick="SC.actionDownloadLibrary()" class="flex-1 py-3 bg-slate-800 hover:bg-sky-600 text-white font-bold text-xs uppercase tracking-widest rounded-lg transition-colors border border-slate-700 shadow flex justify-center items-center gap-2" title="Export entire library as a single JSON file">
                                            💾 <span class="hidden sm:inline">Export</span>
                                        </button>
                                        <label class="flex-1 py-3 bg-slate-800 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-widest rounded-lg transition-colors border border-slate-700 shadow cursor-pointer text-center flex items-center justify-center gap-2" title="Import maps into library">
                                            📂 <span class="hidden sm:inline">Import</span>
                                            <input type="file" accept=".json" class="hidden" onchange="SC.actionUploadLibraryFile(event)">
                                        </label>
                                    </div>
                                </div>

                                <div class="flex-1 overflow-y-auto max-h-[500px] custom-scrollbar pr-2 space-y-3 mt-2" id="library-list">
                                    ${lib.length === 0 ? '<div class="text-center text-slate-600 text-xs py-10 italic border border-dashed border-slate-800 rounded-lg">Library is empty.</div>' : ''}
                                    ${lib.map(item => `
                                        <div class="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden group relative">
                                            <div class="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            
                                            <div class="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-900/50" onclick="SC.registry.get('data').toggleItem('${item.map_id}')">
                                                <div class="font-bold text-sm text-slate-200 truncate pr-4 flex items-center gap-2">
                                                    ${item.meta.title}
                                                    ${item.meta.shared ? '<span class="text-[10px] bg-blue-900/50 text-blue-400 px-2 rounded-full border border-blue-800">Shared</span>' : '<span class="text-[10px] bg-slate-800 text-slate-400 px-2 rounded-full border border-slate-700">Local</span>'}
                                                </div>
                                                <div class="flex items-center gap-4">
                                                    <div class="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 shrink-0">${item.nodes.length} nodes</div>
                                                    <span class="text-slate-600 text-xs">${this.ui.openItems[item.map_id] ? '▼' : '▶'}</span>
                                                </div>
                                            </div>

                                            ${this.ui.openItems[item.map_id] ? `
                                            <div class="p-4 border-t border-slate-800 bg-slate-900/50 flex flex-col gap-3">
                                                <div class="flex gap-4">
                                                    <div class="flex-1 flex flex-col gap-1">
                                                        <label class="text-[10px] font-bold text-slate-500 uppercase">Title</label>
                                                        <input id="lib-title-${item.map_id}" value="${this.escapeHTML(item.meta.title)}" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-purple-500">
                                                    </div>
                                                    <div class="flex-1 flex flex-col gap-1">
                                                        <label class="text-[10px] font-bold text-slate-500 uppercase">Status</label>
                                                        <label class="flex items-center gap-2 text-xs text-slate-300 mt-2 cursor-pointer">
                                                            <input type="checkbox" id="lib-shared-${item.map_id}" ${item.meta.shared ? 'checked' : ''} class="accent-purple-500">
                                                            Shared
                                                        </label>
                                                    </div>
                                                </div>
                                                <div class="flex flex-col gap-1">
                                                    <label class="text-[10px] font-bold text-slate-500 uppercase">Meta-Notes</label>
                                                    <textarea id="lib-notes-${item.map_id}" class="w-full h-20 bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-300 outline-none focus:border-purple-500 custom-scrollbar resize-none" placeholder="Add descriptions or tags...">${this.escapeHTML(item.meta.notes || '')}</textarea>
                                                </div>
                                                <div class="flex gap-2 mt-2">
                                                    <button onclick="SC.actionUpdateLibraryItem('${item.map_id}')" class="flex-1 bg-slate-800 hover:bg-emerald-600 text-white text-[10px] py-2 rounded font-bold transition-colors border border-slate-700">Save</button>
                                                    <button onclick="SC.actionLoadFromLibrary('${item.map_id}')" class="flex-1 bg-slate-800 hover:bg-sky-600 text-white text-[10px] py-2 rounded font-bold transition-colors border border-slate-700">Load</button>
                                                    <button onclick="SC.actionDownloadSingleConstellation('${item.map_id}')" class="flex-1 bg-slate-800 hover:bg-indigo-600 text-white text-[10px] py-2 rounded font-bold transition-colors border border-slate-700" title="Download this map">Download</button>
                                                    <button onclick="SC.actionDeleteFromLibrary('${item.map_id}')" class="bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white text-[10px] py-2 px-3 rounded font-bold transition-colors border border-slate-700" title="Delete Map">🗑️</button>
                                                </div>
                                            </div>
                                            ` : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        
                        <!-- 2. API Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all">
                            <div class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('api')">
                                <h2 class="text-sky-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">📡 API Federation</h2>
                                <span class="text-slate-500 text-xs">${this.ui.api ? '▼' : '▶'}</span>
                            </div>
                            ${this.ui.api ? `
                            <div class="p-5 border-t border-slate-800 flex flex-col gap-4">
                                <p class="text-[10px] text-slate-400 mb-2">Configure external host API bindings.</p>
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
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col">
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
            </div>
        `;
    }
}

class UniversalPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { super(kernel); this.id = 'inspector'; }
    render(container, state) {
        const node = state.nodes.find(n => n.id === state.session.selectedId);

        if (!node) {
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full text-slate-500 opacity-70 p-6 text-center">
                    <span class="text-4xl mb-4">✨</span>
                    <p class="text-sm font-bold tracking-widest uppercase mb-2">No Node Selected</p>
                    <p class="text-xs">Click on any celestial body in the spatial map to view and edit its properties here.</p>
                </div>
            `;
            container.dataset.renderedNodeId = '';
            return;
        }

        // Check if there is an active search that demands a UI highlight pulse
        const highlight = window.SC && window.SC.activeSearchHighlight;
        const isMatch = highlight && highlight.nodeId === node.id;

        // --- FAST DOM DIFFING (Preserves Focus while typing) ---
        if (container.dataset.renderedNodeId === node.id) {
            const titleEl = container.querySelector('#edit-title');
            if (titleEl && document.activeElement !== titleEl) titleEl.value = node.title;
            
            const typeEl = container.querySelector('#edit-type');
            if (typeEl && document.activeElement !== typeEl) typeEl.value = node.type;
            
            const ta = container.querySelector('textarea#raw-content');
            
            if (node.type === 'profile') {
                let pData = {};
                try { pData = JSON.parse(node.content || '{}'); } catch(e) {}
                const inputs = container.querySelectorAll('.profile-input');
                inputs.forEach(inp => {
                    const field = inp.dataset.field;
                    const val = pData[field] || '';
                    if (document.activeElement !== inp && inp.value !== val) inp.value = val;
                    
                    // Inject Pulse via Fast-Diff
                    if (isMatch && highlight.query && val.toLowerCase().includes(highlight.query)) {
                        inp.classList.add('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse');
                        setTimeout(() => { inp.classList.remove('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse'); window.SC.activeSearchHighlight = null; }, 3000);
                    }
                });
            } else if (node.type.startsWith('web-') && node.type !== 'web-root') {
                let pData = {};
                try { pData = JSON.parse(node.content || '{}'); } catch(e) { pData = { text: node.content || '' }; }
                const inputs = container.querySelectorAll('.web-input');
                inputs.forEach(inp => {
                    const field = inp.dataset.field;
                    const val = pData[field] || '';
                    if (document.activeElement !== inp && inp.value !== val) inp.value = val;
                    
                    if (isMatch && highlight.query && val.toLowerCase().includes(highlight.query)) {
                        inp.classList.add('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse');
                        setTimeout(() => { inp.classList.remove('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse'); window.SC.activeSearchHighlight = null; }, 3000);
                    }
                });
            } else {
                if (ta && document.activeElement !== ta) ta.value = node.content || '';
                
                // Inject Pulse via Fast-Diff (Raw Text)
                if (isMatch && highlight.field === 'content' && ta) {
                    ta.classList.add('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse');
                    setTimeout(() => { ta.classList.remove('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse'); window.SC.activeSearchHighlight = null; }, 3000);
                }
            }

            // Inject Pulse via Fast-Diff (Title)
            if (isMatch && highlight.field === 'title' && titleEl) {
                titleEl.classList.add('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse');
                setTimeout(() => { titleEl.classList.remove('ring-2', 'ring-sky-500', 'shadow-[0_0_15px_rgba(56,189,248,0.5)]', 'animate-pulse'); window.SC.activeSearchHighlight = null; }, 3000);
            }
            
            const actionsContainer = container.querySelector('#node-actions-container');
            if (actionsContainer) {
                const isLinking = this.kernel.linkingMode;
                let linkBtnClass = "p-2 bg-slate-800 hover:bg-sky-600 rounded text-slate-300 hover:text-white transition-colors border-2 border-transparent flex justify-center items-center";
                let linkTitle = "Link to Node";
                
                if (isLinking) {
                    if (node.id === this.kernel.linkingSourceId) {
                        linkBtnClass = "p-2 bg-slate-900 border-2 border-red-500 text-red-500 rounded font-bold shadow-[0_0_15px_rgba(239,68,68,0.5)] transition-all flex justify-center items-center";
                        linkTitle = "Cancel Link";
                    } else {
                        linkBtnClass = "p-2 bg-slate-900 border-2 border-emerald-500 text-emerald-500 rounded font-bold shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-pulse transition-all flex justify-center items-center";
                        linkTitle = "Confirm Link";
                    }
                }
                
                actionsContainer.innerHTML = `
                    <button onclick="SC.actionLink('${node.id}')" class="${linkBtnClass}" title="${linkTitle}">🔗</button>
                    <button onclick="SC.actionAddChild('${node.id}')" class="p-2 bg-slate-800 hover:bg-emerald-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Add Child">➕</button>
                    <button onclick="SC.actionSaveConstellation('${node.id}')" class="p-2 bg-slate-800 hover:bg-purple-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Save as Submap">🌌</button>
                    <button onclick="SC.actionDelete('${node.id}')" class="p-2 bg-slate-800 hover:bg-red-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Delete Downstream">🗑️</button>
                `;
            }
            return;
        }

        container.dataset.renderedNodeId = node.id;
        const isLinking = this.kernel.linkingMode;
        
        let linkBtnClass = "p-2 bg-slate-800 hover:bg-sky-600 rounded text-slate-300 hover:text-white transition-colors border-2 border-transparent flex justify-center items-center";
        let linkTitle = "Link to Node";
        if (isLinking) {
            if (node.id === this.kernel.linkingSourceId) {
                linkBtnClass = "p-2 bg-slate-900 border-2 border-red-500 text-red-500 rounded font-bold shadow-[0_0_15px_rgba(239,68,68,0.5)] transition-all flex justify-center items-center";
                linkTitle = "Cancel Link";
            } else {
                linkBtnClass = "p-2 bg-slate-900 border-2 border-emerald-500 text-emerald-500 rounded font-bold shadow-[0_0_15px_rgba(16,185,129,0.5)] animate-pulse transition-all flex justify-center items-center";
                linkTitle = "Confirm Link";
            }
        }

        // Define base classes
        let titleClass = "w-full bg-slate-800 border border-slate-700 text-white p-2 rounded text-sm focus:border-sky-500 outline-none transition-all duration-300";
        let contentClass = "w-full flex-1 bg-slate-900 border border-slate-700 text-white p-2 rounded text-sm font-mono focus:border-sky-500 outline-none resize-none shadow-inner mt-1 min-h-[100px] transition-all duration-300";
        
        // Full Render Highlight Injection
        if (isMatch) {
            if (highlight.field === 'title') {
                titleClass += " ring-2 ring-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.5)] animate-pulse";
                setTimeout(() => { if(window.SC) { window.SC.activeSearchHighlight = null; window.SC.render(); } }, 3000);
            } else if (highlight.field === 'content' && node.type !== 'profile') {
                contentClass += " ring-2 ring-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.5)] animate-pulse";
                setTimeout(() => { if(window.SC) { window.SC.activeSearchHighlight = null; window.SC.render(); } }, 3000);
            }
        }

        let contentAreaHtml = '';
        if (node.type === 'profile') {
            let pData = {};
            try { pData = JSON.parse(node.content || '{}'); } catch(e) {}
            const fields = ['Name', 'Email', 'Phone', 'Address'];
            contentAreaHtml = `<div class="flex flex-col gap-3 mt-1">`;
            fields.forEach(f => {
                let pInputClass = "profile-input bg-slate-900 border border-slate-700 text-white p-2 rounded text-sm focus:border-sky-500 outline-none shadow-inner transition-all duration-300";
                const val = pData[f] || '';
                
                if (isMatch && highlight.query && val.toLowerCase().includes(highlight.query)) {
                    pInputClass += " ring-2 ring-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.5)] animate-pulse";
                    setTimeout(() => { if(window.SC) { window.SC.activeSearchHighlight = null; window.SC.render(); } }, 3000);
                }

                contentAreaHtml += `
                    <div class="flex flex-col gap-1">
                        <label class="text-[10px] font-bold text-slate-500 tracking-wider">${f}</label>
                        <input type="text" class="${pInputClass}" data-field="${f}" value="${this.escapeHTML(val)}" oninput="SC.actionUpdateProfileField('${node.id}', '${f}', this.value)">
                    </div>
                `;
            });
            contentAreaHtml += `</div>`;
        } else if (node.type === 'portal') {
            const lib = this.kernel.getLibrary();
            contentAreaHtml = `<select id="portal-sel" class="w-full bg-slate-800 border border-slate-700 p-2 rounded text-xs text-white outline-none focus:border-sky-500 mt-1 transition-all duration-300">
                <option value="">-- Select Destination --</option>
                ${lib.map(c => `<option value="${c.map_id}" ${node.content === c.map_id ? 'selected' : ''}>${c.meta.title}</option>`).join('')}
            </select>
            <button onclick="SC.actionEnterPortal('${node.id}')" class="mt-3 w-full py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded shadow transition-colors">Enter Portal 🌀</button>`;
        } else if (node.type.startsWith('web-') && node.type !== 'web-root') {
            let pData = {};
            try { pData = JSON.parse(node.content || '{}'); } catch(e) { pData = { text: node.content || '' }; }
            const fields = ['text', 'classes', 'src', 'href'];
            contentAreaHtml = `<div class="flex flex-col gap-3 mt-1">`;
            fields.forEach(f => {
                let pInputClass = "web-input bg-slate-900 border border-slate-700 text-white p-2 rounded text-sm focus:border-sky-500 outline-none shadow-inner transition-all duration-300";
                const val = pData[f] || '';
                
                if (isMatch && highlight.query && val.toLowerCase().includes(highlight.query)) {
                    pInputClass += " ring-2 ring-sky-500 shadow-[0_0_15px_rgba(56,189,248,0.5)] animate-pulse";
                    setTimeout(() => { if(window.SC) { window.SC.activeSearchHighlight = null; window.SC.render(); } }, 3000);
                }

                const updater = `if(!window.updateWebField) window.updateWebField = (id, f, val) => { let n = window.Kernel.state.nodes.find(x => x.id === id); if(!n) return; let d={}; try{d=JSON.parse(n.content||'{}');}catch(e){d={text:n.content||''};} d[f]=val; n.content=JSON.stringify(d); window.Kernel.notify(); }; window.updateWebField('${node.id}', '${f}', this.value)`;

                if (f === 'text') {
                    contentAreaHtml += `
                        <div class="flex flex-col gap-1">
                            <label class="text-[10px] font-bold text-slate-500 tracking-wider">${f.toUpperCase()}</label>
                            <textarea class="${pInputClass} min-h-[60px]" data-field="${f}" oninput="${updater}">${this.escapeHTML(val)}</textarea>
                        </div>
                    `;
                } else {
                    contentAreaHtml += `
                        <div class="flex flex-col gap-1">
                            <label class="text-[10px] font-bold text-slate-500 tracking-wider">${f.toUpperCase()}</label>
                            <input type="text" class="${pInputClass}" data-field="${f}" value="${this.escapeHTML(val)}" oninput="${updater}">
                        </div>
                    `;
                }
            });
            contentAreaHtml += `</div>`;
        } else {
            contentAreaHtml = `<textarea id="raw-content" class="${contentClass}">${node.content || ''}</textarea>`;
        }

        let templateHtml = '';
        const tpls = state.session.remoteTemplates || [];
        const applicableTemplates = tpls.filter(t => t.target_type === node.type || t.target_type === 'any');
        
        if (applicableTemplates.length > 0) {
            templateHtml = `
                <div class="mt-4 pt-4 border-t border-slate-800 shrink-0">
                    <label class="text-[10px] font-bold text-slate-500 uppercase block mb-2">Apply Structure</label>
                    <select class="w-full bg-slate-800 border border-slate-700 text-sky-400 p-2 rounded text-xs focus:border-sky-500 outline-none" onchange="if(this.value) { SC.actionApplyTemplateToNode('${node.id}', this.value); this.value=''; }">
                        <option value="">-- Choose Template --</option>
                        ${applicableTemplates.map(t => `<option value="${t.id}">${t.title}</option>`).join('')}
                    </select>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="p-4 flex flex-col min-h-full gap-4 relative">
                <div class="shrink-0">
                    <label class="text-[10px] font-bold text-slate-500 uppercase block mb-1">Title</label>
                    <input id="edit-title" value="${this.escapeHTML(node.title)}" class="${titleClass}">
                </div>
                <div class="shrink-0">
                    <label class="text-[10px] font-bold text-slate-500 uppercase block mb-1">Type</label>
                    <select id="edit-type" class="w-full bg-slate-800 border border-slate-700 text-white p-2 rounded text-sm focus:border-sky-500 outline-none transition-all duration-300"></select>
                </div>
                
                <div class="flex-1 flex flex-col min-h-0 shrink-0">
                    <label class="text-[10px] font-bold text-slate-500 uppercase block mb-1">Content / Payload</label>
                    ${contentAreaHtml}
                </div>
                
                ${templateHtml}

                <div class="pt-4 border-t border-slate-800 mt-auto shrink-0">
                    <label class="text-[10px] font-bold text-slate-500 uppercase block mb-2">Node Actions</label>
                    <div id="node-actions-container" class="grid grid-cols-4 gap-2">
                        <button onclick="SC.actionLink('${node.id}')" class="${linkBtnClass}" title="${linkTitle}">🔗</button>
                        <button onclick="SC.actionAddChild('${node.id}')" class="p-2 bg-slate-800 hover:bg-emerald-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Add Child">➕</button>
                        <button onclick="SC.actionSaveConstellation('${node.id}')" class="p-2 bg-slate-800 hover:bg-purple-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Save as Submap">🌌</button>
                        <button onclick="SC.actionDelete('${node.id}')" class="p-2 bg-slate-800 hover:bg-red-600 rounded text-slate-300 hover:text-white transition-colors flex justify-center items-center" title="Delete Downstream">🗑️</button>
                    </div>
                </div>
                <div class="text-[9px] text-slate-600 font-mono text-center pt-2 shrink-0">ID: ${node.id}</div>
            </div>
        `;

        const sel = container.querySelector('#edit-type');
        if (typeof MultiMapSchema !== 'undefined') {
            Object.keys(MultiMapSchema.definitions).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t; opt.text = MultiMapSchema.definitions[t].label;
                if (node.type === t) opt.selected = true;
                sel.appendChild(opt);
            });
        }

        container.querySelector('#edit-title').oninput = (e) => this.kernel.updateNode(node.id, { title: e.target.value });
        sel.onchange = (e) => { this.kernel.updateNode(node.id, { type: e.target.value }); this.render(container, state); };

        if (node.type === 'portal') {
            const portalSel = container.querySelector('#portal-sel');
            if (portalSel) portalSel.onchange = (e) => { this.kernel.updateNode(node.id, { content: e.target.value }); };
        } else if (node.type !== 'profile' && !node.type.startsWith('web-')) {
            const rawContent = container.querySelector('#raw-content');
            if (rawContent) rawContent.oninput = (e) => { this.kernel.updateNode(node.id, { content: e.target.value }); };
        }
    }
}

class OrbitalPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { super(kernel); this.id = 'orbital'; }
    render(container, state) {
        container.innerHTML = '';
        container.style.background = 'radial-gradient(circle at 50% 50%, #1e293b 0%, #020617 100%)';
        const sunId = state.session.selectedId || (state.nodes[0] ? state.nodes[0].id : null);
        if (!sunId) { container.innerHTML = '<div class="text-slate-500 p-10 text-center">Select a node to enter orbit.</div>'; return; }
        const sun = state.nodes.find(n => n.id === sunId);
        const parentConn = state.connections.find(c => c.to === sunId && c.type === 'structural');
        
        if (parentConn) {
            const parent = state.nodes.find(n => n.id === parentConn.from);
            if (parent) {
                const halo = document.createElement('div');
                halo.className = "absolute border border-dashed border-indigo-500/20 rounded-full pointer-events-none";
                halo.style.width = "500px"; halo.style.height = "500px";
                halo.style.left = "calc(50% - 250px)"; halo.style.top = "calc(50% - 250px)";
                container.appendChild(halo);
                const pEl = this.createBody(parent, 'parent');
                pEl.style.left = "calc(50% - 30px)"; pEl.style.top = "calc(50% - 280px)";
                pEl.onclick = () => { this.kernel.selectNode(parent.id); this.render(container, state); };
                container.appendChild(pEl);
            }
        }

        const center = this.createBody(sun, 'sun');
        center.style.left = "calc(50% - 60px)"; center.style.top = "calc(50% - 60px)";
        container.appendChild(center);

        const kids = state.connections.filter(c => c.from === sunId).map(c => state.nodes.find(n => n.id === c.to));
        kids.forEach((k, i) => {
            if(!k) return;
            const angle = (i / kids.length) * Math.PI * 2 - Math.PI / 2;
            const r = 220;
            const planet = this.createBody(k, 'child');
            planet.style.left = `calc(50% + ${Math.cos(angle) * r}px - 25px)`;
            planet.style.top = `calc(50% + ${Math.sin(angle) * r}px - 25px)`;
            planet.onclick = () => { this.kernel.selectNode(k.id); this.render(container, state); };
            const line = document.createElement('div');
            line.className = "absolute bg-sky-500/10 h-px pointer-events-none";
            line.style.width = `${r}px`; line.style.left = "50%"; line.style.top = "50%";
            line.style.transformOrigin = "0 0"; line.style.transform = `rotate(${angle * 180 / Math.PI}deg)`;
            container.appendChild(line); container.appendChild(planet);
        });
    }
    createBody(node, role) {
        const el = document.createElement('div');
        el.className = "absolute flex flex-col items-center justify-center rounded-full border cursor-pointer transition-all z-10 shadow-lg";
        if (role === 'sun') el.className += " bg-slate-800 border-sky-500 text-sky-100 w-[120px] h-[120px]";
        else if (role === 'parent') el.className += " bg-slate-900 border-indigo-500/50 text-indigo-300 w-[60px] h-[60px] hover:border-indigo-400";
        else el.className += " bg-slate-900 border-sky-500/30 text-sky-200 w-[50px] h-[50px] hover:border-sky-400 hover:scale-110";
        el.innerHTML = `<div class="text-xl">${(typeof MultiMapSchema !== 'undefined') ? MultiMapSchema.getDefinition(node.type).icon : '⚪'}</div><div class="text-[8px] uppercase mt-1 max-w-full truncate px-1">${node.title}</div>`;
        return el;
    }
}

class WebPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { super(kernel); this.id = 'web'; }
    render(container, state) {
        container.innerHTML = ''; container.style.background = '#f8fafc';
        
        let root = null;
        const selNode = state.nodes.find(n => n.id === state.session.selectedId);
        if (selNode && selNode.type === 'web-root') root = selNode;
        if (!root) root = state.nodes.find(n => n.type === 'web-root') || state.nodes[0];
        
        if (!root) { container.innerHTML = `<div class="flex items-center justify-center h-full text-slate-400">No Web Root Found</div>`; return; }
        
        const html = this.generateHTML(root, state);
        const frame = document.createElement('iframe');
        frame.className = "w-full h-full bg-white shadow-inner"; frame.style.border = "none"; frame.srcdoc = html;
        container.appendChild(frame);
    }

    generateHTML(root, state) {
        const getKids = (id) => state.connections.filter(c => c.from === id).map(c => state.nodes.find(n => n.id === c.to)).filter(n => n);
        
        const render = (node) => {
            const kids = getKids(node.id).map(n => {
                let childHtml = render(n);
                if (node.type === 'web-carousel') return `<div class="snap-center shrink-0">${childHtml}</div>`;
                return childHtml;
            }).join('');
            const title = this.escapeHTML(node.title);
            let contentRaw = node.content ? node.content.trim() : '';
            
            let data = { text: contentRaw, classes: '', src: '', href: '' };
            if (node.type.startsWith('web-') && node.type !== 'web-root') {
                try {
                    const pData = JSON.parse(contentRaw);
                    if (typeof pData === 'object' && pData !== null) {
                        data = { ...data, ...pData };
                    }
                } catch(e) {}
            }
            let content = data.text;
            let classes = data.classes;
            let src = data.src;
            let href = data.href;
            
            if (node.type === 'web-link') {
                let linkHref = href;
                if (!linkHref) {
                    if (state.nodes.find(n => n.id === content)) linkHref = `#${content}`; 
                    else if (content && !content.match(/^(https?:\/\/|file:\/\/|\/|\.\/|\.\.\/|#)/i)) linkHref = `https://${content}`; 
                    else linkHref = content;
                }
                return `<a id="${node.id}" href="${linkHref}" class="${classes || 'text-blue-600 hover:underline block py-1 font-semibold'}">${title}</a>`;
            }
            
            switch (node.type) {
                case 'web-root': 
                    let iframeHtml = '';
                    let isUrl = false;
                    let url = contentRaw;

                    if (contentRaw && !/\n/.test(contentRaw)) { 
                        const hasSpaces = /\s/.test(contentRaw);
                        const hasProtocol = /^(https?:\/\/|file:\/\/)/i.test(contentRaw);
                        const startsWithWww = /^www\./i.test(contentRaw);
                        const isLocalPath = /^(\.\/|\.\.\/|\/)/.test(contentRaw) || /\.html?$/i.test(contentRaw);
                        const looksLikeDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/?.*)?$/.test(contentRaw) && !hasSpaces;
                        const isLocalHost = /^localhost(:\d+)?/i.test(contentRaw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(contentRaw);

                        if (hasProtocol || isLocalPath) {
                            isUrl = true;
                        } else if (startsWithWww || looksLikeDomain) {
                            isUrl = true;
                            url = 'https://' + contentRaw;
                        } else if (isLocalHost && !hasSpaces) {
                            isUrl = true;
                            url = 'http://' + contentRaw;
                        }
                    }

                    if (isUrl) {
                        const iframeClass = kids ? 'w-full h-[85vh] border-none block' : 'w-full h-screen border-none block';
                        
                        const externalLinkBtn = `
                            <div id="preview-overlay" class="absolute inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm pointer-events-auto transition-opacity duration-300">
                                <div class="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl max-w-md w-full flex flex-col items-center text-center relative overflow-hidden">
                                    <button onclick="const el = document.getElementById('preview-overlay'); if(el) { el.style.opacity='0'; setTimeout(()=>el.style.display='none', 300); }" class="absolute top-3 right-3 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full p-1.5 transition-colors" title="Hide Preview to view iframe">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                    </button>
                                    <div id="meta-img" class="hidden w-full h-32 bg-cover bg-center rounded-lg mb-4 border border-slate-800 shadow-inner"></div>
                                    <h2 id="meta-title" class="text-xl font-black text-white mb-2 line-clamp-2 w-full">Loading Link...</h2>
                                    <p id="meta-desc" class="text-xs text-slate-400 mb-6 line-clamp-3 w-full">Attempting to fetch metadata...</p>
                                    <div class="flex gap-3 w-full">
                                        <a href="${url}" target="_blank" rel="noopener noreferrer" class="flex-1 px-4 py-3 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2">
                                            <span>Open in New Tab</span>
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                                        </a>
                                    </div>
                                </div>
                            </div>
                            <script>
                                fetch('https://api.allorigins.win/get?url=${encodeURIComponent(url)}')
                                .then(r => r.json())
                                .then(data => {
                                    const parser = new DOMParser();
                                    const doc = parser.parseFromString(data.contents, 'text/html');
                                    const title = doc.querySelector('title')?.innerText || '${url}';
                                    let desc = doc.querySelector('meta[name="description"]')?.content || doc.querySelector('meta[property="og:description"]')?.content || doc.querySelector('meta[name="twitter:description"]')?.content || '';
                                    let img = doc.querySelector('meta[property="og:image"]')?.content || doc.querySelector('meta[name="twitter:image"]')?.content;
                                    
                                    if(img && !img.startsWith('http')) {
                                        try {
                                            const urlObj = new URL('${url}');
                                            img = urlObj.origin + (img.startsWith('/') ? '' : '/') + img;
                                        } catch(e){}
                                    }
                                    
                                    document.getElementById('meta-title').innerText = title;
                                    if(desc) {
                                        document.getElementById('meta-desc').innerText = desc;
                                    } else {
                                        document.getElementById('meta-desc').innerText = '${url}';
                                    }
                                    
                                    if(img) {
                                        const imgEl = document.getElementById('meta-img');
                                        imgEl.style.backgroundImage = 'url(' + img + ')';
                                        imgEl.classList.remove('hidden');
                                    }
                                })
                                .catch(e => {
                                    document.getElementById('meta-title').innerText = 'External Link';
                                    document.getElementById('meta-desc').innerText = '${url}';
                                });
                            </script>
                        `;
                        
                        iframeHtml = `
                            <div class="relative w-full h-full">
                                ${externalLinkBtn}
                                <iframe src="${url}" class="${iframeClass}" title="Embedded Webpage" onload="const el = document.getElementById('preview-overlay'); if(el) { el.style.opacity = '0'; setTimeout(() => el.style.display = 'none', 300); }"></iframe>
                            </div>
                        `;
                    }

                    let textContent = (!isUrl && contentRaw) ? `<div class="py-12 px-8 max-w-5xl mx-auto prose text-slate-700">${contentRaw.replace(/\n/g, '<br>')}</div>` : '';
                    const kidsContainer = kids ? `<div class="${isUrl ? 'relative z-10 bg-slate-50 shadow-[0_-20px_50px_rgba(0,0,0,0.15)] pt-10' : ''}">${kids}</div>` : '';
                    
                    let editScript = '';
                    if (this.kernel.webEditMode) {
                        editScript = `
                        <style>
                            [data-mm-id] { cursor: pointer; transition: outline 0.1s; }
                            [data-mm-id]:hover { outline: 3px solid #0ea5e9 !important; outline-offset: -3px; border-radius: 4px; box-shadow: inset 0 0 20px rgba(14,165,233,0.2), 0 0 20px rgba(14,165,233,0.5) !important; position: relative; z-index: 50; }
                        </style>
                        <script>
                            document.addEventListener('click', function(e) {
                                const target = e.target.closest('[data-mm-id]');
                                if (target) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    window.parent.postMessage({ type: 'mm-select-node', id: target.getAttribute('data-mm-id') }, '*');
                                }
                            }, true);
                        </script>`;
                    }
                    
                    return `<html><head><script src="https://cdn.tailwindcss.com"></script>${editScript}</head><body class="bg-slate-50 font-sans text-slate-900 overflow-x-hidden m-0 p-0">${iframeHtml}${textContent}${kidsContainer}</body></html>`;
                    
                case 'web-nav': return `<nav data-mm-id="${node.id}" class="${classes || 'flex flex-wrap items-center justify-between gap-4 md:gap-6 p-4 md:p-6 bg-white shadow-sm sticky top-0 z-50 border-b border-slate-100 w-full'}"><div class="font-black text-xl tracking-tighter">MyBrand</div><div class="flex flex-wrap items-center gap-4 md:gap-6">${kids}</div></nav>`;
                case 'web-hero': 
                    let bgStyle = src ? `style="background-image: url('${src}'); background-size: cover; background-position: center;"` : '';
                    return `<header data-mm-id="${node.id}" class="${classes || 'bg-gradient-to-br from-slate-900 to-indigo-950 text-white py-24 md:py-32 px-4 md:px-8 text-center w-full'} relative" ${bgStyle}>
                        ${src ? '<div class="absolute inset-0 bg-slate-900/70 z-0"></div>' : ''}
                        <div class="relative z-10"><h1 class="text-5xl md:text-7xl font-black mb-6 tracking-tight">${title}</h1><div class="text-lg md:text-xl text-indigo-200 max-w-3xl mx-auto mb-10">${content || ''}</div><div class="flex flex-wrap justify-center gap-4">${kids}</div></div>
                    </header>`;
                case 'web-section': return `<section id="${node.id}" data-mm-id="${node.id}" class="${classes || 'py-16 md:py-20 px-4 md:px-8 max-w-6xl mx-auto w-full'}"><h2 class="text-3xl md:text-4xl font-black mb-10 text-center">${title}</h2><div class="flex flex-col gap-8 w-full">${kids}</div></section>`;
                case 'web-card': return `<div id="${node.id}" data-mm-id="${node.id}" class="${classes || 'bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all flex flex-col gap-3 h-full'}">${title ? `<h3 class="font-bold text-lg text-slate-900 mb-1 leading-snug">${title}</h3>` : ''}${content ? `<p class="text-slate-600 text-sm leading-relaxed">${content.replace(/\n/g, '<br>')}</p>` : ''}${kids ? `<div class="mt-2 flex flex-col gap-2">${kids}</div>` : ''}</div>`;
                case 'web-button': return `<button data-mm-id="${node.id}" class="${classes || 'px-6 md:px-8 py-3 bg-indigo-600 text-white font-bold rounded-full shadow-lg shadow-indigo-500/30 hover:bg-indigo-500 hover:-translate-y-0.5 transition-all inline-block'}">${title}</button>`;
                case 'web-text': return `<div id="${node.id}" data-mm-id="${node.id}" class="${classes || 'mb-4 w-full'}"><h3 class="font-bold text-xl text-slate-800 mb-3">${title}</h3><p class="text-slate-600 leading-relaxed">${content.replace(/\n/g, '<br>')}</p>${kids}</div>`;
                case 'web-footer': return `<footer data-mm-id="${node.id}" class="${classes || 'py-12 px-4 md:px-8 mt-12 border-t border-slate-200 text-center bg-slate-100 w-full'}">${kids || `<p class="text-slate-500 text-sm font-semibold">${content || title}</p>`}</footer>`;
                case 'web-image': return `<img id="${node.id}" data-mm-id="${node.id}" src="${src || content}" class="${classes || 'max-w-full h-auto rounded-lg shadow-sm mx-auto'}" alt="${title}" />`;
                case 'web-video': return `<video id="${node.id}" data-mm-id="${node.id}" src="${src || content}" class="${classes || 'w-full rounded-lg shadow-sm'}" controls></video>`;
                case 'web-form': return `<form id="${node.id}" data-mm-id="${node.id}" class="${classes || 'flex flex-col gap-4 w-full max-w-md mx-auto'}"><h3 class="font-bold text-lg mb-2 text-center">${title}</h3>${kids}</form>`;
                case 'web-input': return `<input id="${node.id}" data-mm-id="${node.id}" type="text" placeholder="${title}" class="${classes || 'border border-slate-300 rounded px-4 py-2 w-full focus:outline-none focus:border-indigo-500'}" />`;
                case 'web-grid': return `<div id="${node.id}" data-mm-id="${node.id}" class="${classes || 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full'}">${kids}</div>`;
                case 'web-list': return `<ul id="${node.id}" data-mm-id="${node.id}" class="${classes || 'list-disc pl-5 space-y-2 text-slate-700 w-full'}">${kids}</ul>`;
                case 'web-modal': return `<div data-mm-id="${node.id}"><dialog id="${node.id}" class="${classes || 'p-6 md:p-8 rounded-2xl shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm w-[90%] max-w-lg'}"><h3 class="font-bold text-2xl mb-4">${title}</h3>${kids}<form method="dialog" class="mt-6 flex justify-end"><button class="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-slate-800 font-bold transition-colors">Close</button></form></dialog><div class="w-full flex justify-center mt-4"><button onclick="document.getElementById('${node.id}').showModal()" class="px-6 py-3 bg-white border border-slate-200 shadow-sm rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">Open ${title}</button></div></div>`;
                case 'web-carousel': return `<div id="${node.id}" data-mm-id="${node.id}" class="${classes || 'flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 w-full custom-scrollbar'}">${kids}</div>`;
                default: return `<div id="${node.id}" data-mm-id="${node.id}" class="${classes || 'mb-6'}"><h3 class="font-bold text-lg text-slate-800 mb-2">${title}</h3><div class="prose text-slate-600 leading-relaxed">${content ? content.replace(/\n/g, '<br>') : ''}</div>${kids}</div>`;
            }
        };
        return render(root);
    }
}