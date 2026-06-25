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
        // Inject schema data into state for the inspector iframe
        if (state && state.session) {
            if (typeof MultiMapSchema !== 'undefined') {
                state.session.schemaData = {
                    definitions: MultiMapSchema.definitions,
                    rules: MultiMapSchema.rules,
                    mapTypes: MultiMapSchema.mapTypes
                };
            }
            state.session.library = this.kernel.getLibrary();
            state.session.linkingMode = this.kernel.linkingMode;
            state.session.linkingSourceId = this.kernel.linkingSourceId;
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
                this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: state, highlight: highlight }, '*');
            }
        };
        
        if (this.iframe.parentNode !== container) {
            container.innerHTML = ''; // Clear container
            container.appendChild(this.iframe);
        }
        
        if (this.iframe.contentWindow) {
            const highlight = window.SC && window.SC.activeSearchHighlight ? window.SC.activeSearchHighlight : null;
            this.iframe.contentWindow.postMessage({ type: 'STATE_UPDATE', state: state, highlight: highlight }, '*');
        }
    }
}

class DataPhaseEngine extends PhaseEngineBase {
    constructor(kernel) { 
        super(kernel); 
        this.id = 'data'; 
        this.ui = { templates: true, api: false, json: false, library: true, openItems: {} };
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
    
    render(container, state) {
        const lib = this.kernel.getLibrary();
        
        container.innerHTML = `
            <div class="w-full flex flex-col gap-4 pb-10">
                <p class="text-slate-400 text-xs px-1">Manage local sessions, import assets, map APIs, and process raw JSON.</p>
                <div class="flex flex-col gap-4">
                        
                        <!-- 1. Sessions Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col">
                            <div id="data-accordion-library" class="p-4 bg-slate-800/50 hover:bg-slate-800 cursor-pointer flex justify-between items-center transition-colors select-none" onclick="SC.registry.get('data').toggle('library')">
                                <h2 class="text-purple-400 font-bold uppercase text-xs tracking-widest flex items-center gap-2">📚 Sessions</h2>
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
                                    ${(!lib || lib.length === 0) ? '<div class="text-center text-slate-600 text-xs py-6 italic border border-dashed border-slate-800 rounded-lg">No saved sessions found.</div>' : ''}
                                    ${lib.map(item => `
                                        <div class="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden group relative">
                                            <div class="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                            
                                            <div class="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-900/50" onclick="SC.registry.get('data').toggleItem('${item.map_id}')">
                                                <div class="font-bold text-sm text-slate-200 truncate pr-4 flex items-center gap-2">
                                                    ${item.meta?.title || 'Untitled Map'}
                                                    ${item.meta?.shared ? '<span class="text-[10px] bg-blue-900/50 text-blue-400 px-2 rounded-full border border-blue-800">Shared</span>' : '<span class="text-[10px] bg-slate-800 text-slate-400 px-2 rounded-full border border-slate-700">Local</span>'}
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
                                                        <input id="lib-title-${item.map_id}" value="${this.escapeHTML(item.meta?.title || 'Untitled Map')}" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-purple-500">
                                                    </div>
                                                    <div class="flex-1 flex flex-col gap-1">
                                                        <label class="text-[10px] font-bold text-slate-500 uppercase">Status</label>
                                                        <label class="flex items-center gap-2 text-xs text-slate-300 mt-2 cursor-pointer">
                                                            <input type="checkbox" id="lib-shared-${item.map_id}" ${item.meta?.shared ? 'checked' : ''} class="accent-purple-500">
                                                            Shared
                                                        </label>
                                                    </div>
                                                </div>
                                                <div class="flex flex-col gap-1">
                                                    <label class="text-[10px] font-bold text-slate-500 uppercase">Meta-Notes</label>
                                                    <textarea id="lib-notes-${item.map_id}" class="w-full h-20 bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-300 outline-none focus:border-purple-500 custom-scrollbar resize-none" placeholder="Add descriptions or tags...">${this.escapeHTML(item.meta?.notes || '')}</textarea>
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
                        
                        
                        <!-- 0. Cloud Templates Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col">
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

                        <!-- 2. API Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all">
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
        `;
    }
}
