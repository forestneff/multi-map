const fs = require('fs');

class MultiMapKernel {
    static GUEST_LIMIT = 5 * 1024 * 1024;
    static FREE_LIMIT = 500 * 1024 * 1024;
    static PRO_LIMIT = 1024 * 1024 * 1024;
    
    constructor() {
        this.projects = [];
        this.firestoreProjects = [
            { project_id: 'proj1', page_ids: ['map1'] }
        ];
        this.firestorePagesByProject = {
            'proj1': [ { map_id: 'map1', meta: { title: 'Map 1' } } ]
        };
        this.activeProjectId = 'proj1';
    }
    
    getProjects() {
        return this.firestoreProjects || [];
    }
    
    getPages(projectId) {
        return this.firestorePagesByProject[projectId] || [];
    }
    
    getCurrentTier() {
        return 'free';
    }
    
    getStorageUsage() {
        let totalBytes = 0;
        const projects = this.getProjects();
        
        projects.forEach(proj => {
            totalBytes += JSON.stringify(proj).length;
            const pages = this.getPages(proj.project_id);
            pages.forEach(page => {
                const target = page.meta && page.meta.storage_target ? page.meta.storage_target : 'firebase';
                if (target === 'firebase') {
                    totalBytes += JSON.stringify(page).length;
                }
            });
        });
        return totalBytes;
    }
    
    getStorageLimit(tier) {
        if (tier === 'guest') return MultiMapKernel.GUEST_LIMIT;
        if (tier === 'free') return MultiMapKernel.FREE_LIMIT;
        if (tier === 'pro') return MultiMapKernel.PRO_LIMIT;
        return MultiMapKernel.GUEST_LIMIT;
    }
}

class DataPhaseEngine {
    constructor(kernel) {
        this.kernel = kernel;
        this.ui = { library: true, projectsSub: true, pagesSub: true };
    }
    
    render() {
        const activeProjId = this.kernel.activeProjectId;
        const projects = this.kernel.getProjects();
        const pages = this.kernel.getPages(activeProjId);
        
        const activeProj = projects.find(p => p.project_id === activeProjId) || projects[0] || { meta: { title: "My Project" } };
        const activeProjTitle = activeProj.meta?.title || "My Project";
        
        let html = ``;
        html += `
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
                            
                            return `<div>${mbUsage} / ${mbLimit}</div>`;
                        })()}
                        
                        <!-- 1. Workspace Library Collapsible Accordion -->
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden transition-all flex flex-col shrink-0">
                            
                            ${this.ui.library ? `
                            <div class="p-4 border-t border-slate-800 flex flex-col gap-4 bg-slate-900/40">
                                
                                <!-- Top Section: Projects Panel -->
                                <div class="flex flex-col gap-2 min-h-0 bg-slate-950/20 p-3 rounded-xl border border-slate-800/40 shrink-0">
                                    ${this.ui.projectsSub ? `
                                    <div class="flex flex-col gap-1.5 overflow-y-auto max-h-[150px] custom-scrollbar pr-1" id="projects-list-container">
                                        ${projects.map(proj => {
                                            const isActive = proj.project_id === activeProjId;
                                            const meta = proj.meta || {};
                                            const title = meta.title || "Untitled Project";
                                            const icon = meta.icon || "📁";
                                            const color = meta.color || "#8b5cf6";
                                            const pagesCount = proj.page_ids ? proj.page_ids.length : 0;
                                            
                                            return `<div>Project: ${title} (${pagesCount} pages)</div>`;
                                        }).join('')}
                                    </div>
                                    ` : ''}
                                </div>
                                
                                <!-- Bottom Section: Pages Panel -->
                                <div class="flex flex-col gap-2 min-h-0 bg-slate-950/20 p-3 rounded-xl border border-slate-800/40 shrink-0">
                                    ${this.ui.pagesSub ? `
                                    <div class="flex flex-col gap-2 overflow-y-auto max-h-[250px] custom-scrollbar pr-1" id="pages-list-container">
                                        ${(!pages || pages.length === 0) ? '<div class="text-center">No pages</div>' : ''}
                                        ${pages.map(page => {
                                            const isCurrentPage = page.map_id === 'map1';
                                            const meta = page.meta || {};
                                            const title = meta.title || "Untitled Page";
                                            const type = meta.type || "generic";
                                            const nodeCount = page.nodes ? page.nodes.length : 0;
                                            
                                            // Determine storage target icon
                                            let storageIcon = '☁️'; // Default firebase
                                            if (meta.storage_target === 'google_drive') storageIcon = '🔺';
                                            else if (meta.storage_target === 'local_os') storageIcon = '📁';
                                            
                                            return `<div>Page: ${title} (${nodeCount} nodes)</div>`;
                                        }).join('')}
                                    </div>
                                    ` : ''}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                </div>
            </div>
        `;
        return html;
    }
}

try {
    const kernel = new MultiMapKernel();
    const engine = new DataPhaseEngine(kernel);
    const result = engine.render();
    console.log("SUCCESS");
} catch (e) {
    console.error("FAIL:", e);
}
