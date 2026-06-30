/**
 * Multi-Map CORE KERNEL v14.11
 * Features: Template-to-Node Application, Profile Singleton, CMS Data Syncing.
 */

class HostBridge {
    constructor() { 
        this.pushUrl = "http://localhost:8000/api/push"; 
        this.pullUrl = "http://localhost:8000/api/pull";
        this.isConnected = false; 
    }
    async checkConnection() { return false; }
    async sync(mapState) { }

    async fetchTemplates() {
        try {
            if (typeof MultiMapLibrary !== 'undefined') return await MultiMapLibrary.getManifest();
            throw new Error("Library missing.");
        } catch (e) {
            console.warn(e);
            return [
                { id: "tpl_web_standard", target_type: "web-root", title: "Standard Landing Page (Fallback)", desc: "Responsive web layout.", nodes: 13 }
            ];
        }
    }

    async fetchTemplateData(id) {
        try {
            if (typeof MultiMapLibrary !== 'undefined') return await MultiMapLibrary.getTemplateData(id);
            throw new Error("Library missing.");
        } catch (e) {
            console.error(e);
            return { map_id: id, meta: { title: `Fallback: ${id}` }, nodes: [], connections: [], submaps: [] };
        }
    }
}

class MultiMapKernel {
    // Storage Tier Constants
    static GUEST_LIMIT = 5 * 1024 * 1024; // 5MB limit for localStorage
    static FREE_LIMIT = 500 * 1024 * 1024; // 500MB limit for Free tier
    static PRO_LIMIT = 1024 * 1024 * 1024; // 1GB limit for Pro tier

    constructor() {
        this.config = { autoSaveInterval: 2000, autoFocus: true, autoCollapseDepth: 3 };
        this.bridge = new HostBridge();
        
        this.listeners = [];
        this.history = [];
        this.portalHistory = [];
        this.linkingMode = false;
        this.linkingSourceId = null;
        this.firestoreLibrary = [];
        
        this.projects = [];
        this.activeProjectId = 'default_project';
        this.firestoreProjects = [];
        this.firestorePagesByProject = {};
        
        this.activeVault = localStorage.getItem("mm_active_vault") || "firebase";

        this.migrateLocalGuestData();

        const rawState = this.loadFromStorage();
        this.state = this.ensureSchema(rawState);
        this.activeProjectId = this.state.meta.project_id || 'default_project';
        this.lastSaveState = JSON.stringify(this.state);

        if (this.state.nodes.length === 0) {
            this.addNode({ type: "root", title: "Root", data: { x: 0, y: 0, isCore: true } });
        }

        if (window.FirebaseAuth && window.FirebaseAuth.currentUser && !window.FirebaseAuth.currentUser.isAnonymous) {
            this.syncWithFirestore(window.FirebaseAuth.currentUser.uid);
        }

        setInterval(() => this.checkAutoSave(), this.config.autoSaveInterval);
    }

    isUsingCloudVault() {
        return this.activeVault === 'firebase' && 
               window.FirebaseAuth && 
               window.FirebaseAuth.currentUser && 
               !window.FirebaseAuth.currentUser.isAnonymous;
    }

    async setVault(vault) {
        if (vault !== 'firebase' && vault !== 'local') return;
        this.activeVault = vault;
        localStorage.setItem('mm_active_vault', vault);
        
        const projects = this.getProjects();
        if (projects.length > 0) {
            this.activeProjectId = projects[0].project_id;
            const pages = this.getPages(this.activeProjectId);
            if (pages.length > 0) {
                this.loadMapState(pages[0]);
            } else {
                this.state = this.getEmptyState();
                this.state.meta.project_id = this.activeProjectId;
                this.notify();
            }
        } else {
            const res = await this.createProject("My Project", "Default project");
            if (res) {
                this.activeProjectId = res.projectId;
                this.loadMapState(res.defaultPage);
            }
        }
        this.notify();
    }

    migrateLocalGuestData() {
        try {
            const rawLib = localStorage.getItem("mm_constellation_lib");
            const lib = rawLib ? JSON.parse(rawLib) : [];
            const rawProjects = localStorage.getItem("mm_projects");
            let projects = rawProjects ? JSON.parse(rawProjects) : [];
            
            if (lib.length > 0 && projects.length === 0) {
                console.log("Migrating local guest library to Project + Pages architecture...");
                const defaultProj = {
                    project_id: "default_project",
                    meta: {
                        title: "My Project",
                        description: "Default guest project",
                        icon: "📁",
                        color: "#8b5cf6"
                    },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    page_ids: lib.map(m => m.map_id)
                };
                projects = [defaultProj];
                
                lib.forEach(m => {
                    if (!m.meta) m.meta = {};
                    m.meta.project_id = "default_project";
                });
                
                localStorage.setItem("mm_projects", JSON.stringify(projects));
                localStorage.setItem("mm_constellation_lib", JSON.stringify(lib));
                
                const rawState = localStorage.getItem("mm_core_state");
                if (rawState) {
                    try {
                        const state = JSON.parse(rawState);
                        if (!state.meta) state.meta = {};
                        state.meta.project_id = "default_project";
                        localStorage.setItem("mm_core_state", JSON.stringify(state));
                    } catch(e) {}
                }
            } else if (projects.length === 0) {
                const defaultProj = {
                    project_id: "default_project",
                    meta: {
                        title: "My Project",
                        description: "Default guest project",
                        icon: "📁",
                        color: "#8b5cf6"
                    },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    page_ids: []
                };
                projects = [defaultProj];
                localStorage.setItem("mm_projects", JSON.stringify(projects));
            }
            this.projects = projects;
        } catch(e) {
            console.error("Local migration error:", e);
        }
    }

    getProjects() {
        if (this.isUsingCloudVault()) {
            return this.firestoreProjects || [];
        }
        return this.projects || [];
    }

    getPages(projectId) {
        if (this.isUsingCloudVault()) {
            return this.firestorePagesByProject[projectId] || [];
        }
        return this.getLibrary().filter(p => p.meta?.project_id === projectId || (!p.meta?.project_id && projectId === 'default_project'));
    }

    getAllPages() {
        return this.getLibrary();
    }

    getCurrentTier() {
        if (!this.isUsingCloudVault()) {
            return 'guest';
        }
        return 'free'; // Stub for now, will differentiate free/pro later
    }

    getStorageLimit(tier) {
        if (tier === 'guest') return MultiMapKernel.GUEST_LIMIT;
        if (tier === 'free') return MultiMapKernel.FREE_LIMIT;
        if (tier === 'pro') return MultiMapKernel.PRO_LIMIT;
        return MultiMapKernel.GUEST_LIMIT;
    }

    getStorageUsage() {
        let totalBytes = 0;
        const projects = this.getProjects();
        
        const cache = new Set();
        const replacer = (key, value) => {
            if (key === 'library' || key === 'projects' || key === 'schemaData') return undefined; // Omit dynamically injected
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) return undefined;
                cache.add(value);
            }
            return value;
        };
        
        projects.forEach(proj => {
            cache.clear();
            totalBytes += JSON.stringify(proj, replacer).length;
            const pages = this.getPages(proj.project_id);
            pages.forEach(page => {
                const target = page.meta && page.meta.storage_target ? page.meta.storage_target : 'firebase';
                if (target === 'firebase') {
                    cache.clear();
                    totalBytes += JSON.stringify(page, replacer).length;
                }
            });
        });
        return totalBytes;
    }

    getTotalPageCount() {
        let count = 0;
        const projects = this.getProjects();
        projects.forEach(proj => {
            const pages = this.getPages(proj.project_id);
            count += pages.length;
        });
        return count;
    }

    checkStorageLimit(additionalBytes = 1024) {
        const tier = this.getCurrentTier();
        if (tier !== 'guest') return true; // Only strictly enforce on guests for now
        
        const usage = this.getStorageUsage();
        const limit = this.getStorageLimit(tier);
        
        if (usage + additionalBytes > limit) {
            alert(`Guest storage limit (${(limit / 1024 / 1024).toFixed(1)}MB) exceeded. Please sign up for a Free Account or connect your Local OS to save more data.`);
            return false;
        }

        if (this.getTotalPageCount() >= 25) {
            alert(`Guest map limit (25) exceeded. Please sign up for a Free Account to create more maps.`);
            return false;
        }
        
        return true;
    }

    async createProject(title, description = "", icon = "📁", color = "#8b5cf6", autoSwitch = true) {
        if (!this.checkStorageLimit(2048)) return null;

        const projectId = this.generateId();
        const newProj = {
            project_id: projectId,
            meta: { title, description, icon, color },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            page_ids: []
        };
        
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                await window.Firestore.setDoc(projRef, newProj);
                this.firestoreProjects.push(newProj);
                this.firestorePagesByProject[projectId] = [];
            } catch (err) {
                console.error("Firestore createProject failed:", err);
            }
        } else {
            this.projects.push(newProj);
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
        }
        
        const defaultPageId = this.generateId();
        const defaultPage = {
            map_id: defaultPageId,
            meta: { 
                title: "Project Directory", 
                type: "file-root", 
                created: new Date().toISOString(),
                shared: false,
                project_id: projectId
            },
            nodes: [{ id: this.generateId(), type: "file-root", title: "Project Directory", data: { x: 0, y: 0, isCore: true } }],
            connections: [],
            session: { 
                viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, 
                selectedId: null, 
                remoteTemplates: [], 
                layoutMode: 'organic' 
            }
        };
        
        newProj.page_ids.push(defaultPageId);
        
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                await window.Firestore.setDoc(projRef, newProj);
                
                const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", defaultPageId);
                await window.Firestore.setDoc(pageRef, defaultPage);
                
                this.firestorePagesByProject[projectId].push(defaultPage);
            } catch (err) {
                console.error("Firestore createProject default page failed:", err);
            }
        } else {
            let lib = this.getLibrary();
            lib.push(defaultPage);
            this.saveLibrary(lib);
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
        }
        
        if (autoSwitch) {
            this.activeProjectId = projectId;
            this.loadMapState(defaultPage);
        }
        this.notify();
        return projectId;
    }

    async deleteProject(projectId) {
        const projects = this.getProjects();
        if (projects.length <= 1) {
            alert("Cannot delete the only remaining project. Create another project first.");
            return;
        }
        
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const pages = this.firestorePagesByProject[projectId] || [];
                for (const p of pages) {
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", p.map_id);
                    await window.Firestore.deleteDoc(pageRef);
                }
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                await window.Firestore.deleteDoc(projRef);
                
                this.firestoreProjects = this.firestoreProjects.filter(p => p.project_id !== projectId);
                delete this.firestorePagesByProject[projectId];
            } catch (err) {
                console.error("Firestore deleteProject failed:", err);
            }
        } else {
            this.projects = this.projects.filter(p => p.project_id !== projectId);
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            
            let lib = this.getLibrary().filter(p => p.meta?.project_id !== projectId);
            this.saveLibrary(lib);
        }
        
        if (this.activeProjectId === projectId) {
            const remainingProjects = this.getProjects();
            this.activeProjectId = remainingProjects[0].project_id;
            const remainingPages = this.getPages(this.activeProjectId);
            if (remainingPages.length > 0) {
                this.loadMapState(remainingPages[0]);
            } else {
                this.state = this.getEmptyState();
                this.notify();
            }
        } else {
            this.notify();
        }
    }

    async renameProject(projectId, title, description = "", icon = "📁", color = "#8b5cf6") {
        const projects = this.getProjects();
        const proj = projects.find(p => p.project_id === projectId);
        if (proj) {
            proj.meta.title = title;
            proj.meta.description = description;
            proj.meta.icon = icon;
            proj.meta.color = color;
            proj.updated_at = new Date().toISOString();
            
            if (this.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                try {
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                    await window.Firestore.setDoc(projRef, proj);
                } catch (err) {
                    console.error("Firestore renameProject failed:", err);
                }
            } else {
                localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            }
            this.notify();
        }
    }

    async createPage(projectId, title = "New Space", type = "generic") {
        if (!this.checkStorageLimit(1024)) return null;

        const pageId = this.generateId();
        const rootType = (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes && MultiMapSchema.mapTypes[type]) ? MultiMapSchema.mapTypes[type].rootNode : 'root';
        const rootTitle = (typeof MultiMapSchema !== 'undefined') ? MultiMapSchema.getDefinition(rootType).label : "Root";
        
        const newPage = {
            map_id: pageId,
            meta: { 
                title: title, 
                type: type, 
                created: new Date().toISOString(), 
                shared: false,
                project_id: projectId
            },
            nodes: [{ id: this.generateId(), type: rootType, title: rootTitle, data: { x: 0, y: 0, isCore: true } }],
            connections: [],
            session: { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [], layoutMode: 'organic' }
        };
        
        const projects = this.getProjects();
        const proj = projects.find(p => p.project_id === projectId);
        if (proj) {
            if (!proj.page_ids.includes(pageId)) {
                proj.page_ids.push(pageId);
            }
            proj.updated_at = new Date().toISOString();
            
            if (this.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                try {
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", pageId);
                    await window.Firestore.setDoc(pageRef, newPage);
                    
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                    await window.Firestore.setDoc(projRef, proj);
                    
                    if (!this.firestorePagesByProject[projectId]) this.firestorePagesByProject[projectId] = [];
                    this.firestorePagesByProject[projectId].push(newPage);
                } catch (err) {
                    console.error("Firestore createPage failed:", err);
                }
            } else {
                let lib = this.getLibrary();
                lib.push(newPage);
                this.saveLibrary(lib);
                localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            }
            // SCAFFOLD: Hook into file-root dynamic synchronization
            // If we're creating a page that is NOT the project's default 'file-root',
            // we should spawn a corresponding 'file-document' node on the Master Map.
            // TODO (Phase 2): Find the file-root map of this project and add a node linking to this newPage.
            
            this.notify();
        }
        return newPage;
    }

    async movePage(pageId, fromProjectId, toProjectId) {
        if (fromProjectId === toProjectId) return;
        
        const projects = this.getProjects();
        const fromProj = projects.find(p => p.project_id === fromProjectId);
        const toProj = projects.find(p => p.project_id === toProjectId);
        
        if (!fromProj || !toProj) return;
        
        fromProj.page_ids = fromProj.page_ids.filter(id => id !== pageId);
        fromProj.updated_at = new Date().toISOString();
        
        if (!toProj.page_ids.includes(pageId)) {
            toProj.page_ids.push(pageId);
        }
        toProj.updated_at = new Date().toISOString();
        
        let pageState = null;
        
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const oldPageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", fromProjectId, "pages", pageId);
                const pageSnap = await window.Firestore.getDoc(oldPageRef);
                if (pageSnap.exists()) {
                    pageState = pageSnap.data();
                    pageState.meta.project_id = toProjectId;
                    
                    const newPageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", toProjectId, "pages", pageId);
                    await window.Firestore.setDoc(newPageRef, pageState);
                    await window.Firestore.deleteDoc(oldPageRef);
                }
                
                const fromProjRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", fromProjectId);
                await window.Firestore.setDoc(fromProjRef, fromProj);
                
                const toProjRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", toProjectId);
                await window.Firestore.setDoc(toProjRef, toProj);
                
                if (this.firestorePagesByProject[fromProjectId]) {
                    this.firestorePagesByProject[fromProjectId] = this.firestorePagesByProject[fromProjectId].filter(p => p.map_id !== pageId);
                }
                if (pageState) {
                    if (!this.firestorePagesByProject[toProjectId]) this.firestorePagesByProject[toProjectId] = [];
                    this.firestorePagesByProject[toProjectId].push(pageState);
                }
            } catch (err) {
                console.error("Firestore movePage failed:", err);
            }
        } else {
            let lib = this.getLibrary();
            const page = lib.find(p => p.map_id === pageId);
            if (page) {
                page.meta.project_id = toProjectId;
                this.saveLibrary(lib);
            }
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
        }
        
        if (this.state.map_id === pageId) {
            this.activeProjectId = toProjectId;
            this.state.meta.project_id = toProjectId;
        }
        
        this.notify();
    }

    async clonePage(pageId, targetProjectId, newTitle = null, newProjectTitle = null) {
        if (!this.checkStorageLimit(1024)) return null;

        let sourcePage = null;
        if (this.isUsingCloudVault()) {
            for (const projId in this.firestorePagesByProject) {
                const found = this.firestorePagesByProject[projId].find(p => p.map_id === pageId);
                if (found) {
                    sourcePage = JSON.parse(JSON.stringify(found));
                    break;
                }
            }
        } else {
            const lib = this.getLibrary();
            const found = lib.find(p => p.map_id === pageId);
            if (found) {
                sourcePage = JSON.parse(JSON.stringify(found));
            }
        }
        
        if (!sourcePage) {
            console.error("Source page not found for copying:", pageId);
            return null;
        }

        let finalProjectId = targetProjectId;
        
        if (targetProjectId === 'new' || !targetProjectId) {
            const projId = this.generateId();
            const projTitle = newProjectTitle || `${sourcePage.meta.title} Project`;
            const newProj = {
                project_id: projId,
                meta: {
                    title: projTitle,
                    description: `Created from copy of page "${sourcePage.meta.title}"`,
                    icon: sourcePage.meta.icon || "📁",
                    color: "#10b981"
                },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                page_ids: []
            };
            
            if (this.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                try {
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projId);
                    await window.Firestore.setDoc(projRef, newProj);
                    this.firestoreProjects.push(newProj);
                    this.firestorePagesByProject[projId] = [];
                } catch (err) {
                    console.error("Firestore create project for clone failed:", err);
                }
            } else {
                this.projects.push(newProj);
                localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            }
            finalProjectId = projId;
        }

        const newPageId = this.generateId();
        const clonedPage = {
            ...sourcePage,
            map_id: newPageId,
            meta: {
                ...sourcePage.meta,
                title: newTitle || (targetProjectId === 'new' ? sourcePage.meta.title : `${sourcePage.meta.title} (Copy)`),
                created: new Date().toISOString(),
                project_id: finalProjectId
            }
        };

        const projects = this.getProjects();
        const targetProj = projects.find(p => p.project_id === finalProjectId);
        if (targetProj) {
            if (!targetProj.page_ids.includes(newPageId)) {
                targetProj.page_ids.push(newPageId);
            }
            targetProj.updated_at = new Date().toISOString();

            if (this.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                try {
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", finalProjectId, "pages", newPageId);
                    await window.Firestore.setDoc(pageRef, clonedPage);
                    
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", finalProjectId);
                    await window.Firestore.setDoc(projRef, targetProj);
                    
                    if (!this.firestorePagesByProject[finalProjectId]) this.firestorePagesByProject[finalProjectId] = [];
                    this.firestorePagesByProject[finalProjectId].push(clonedPage);
                } catch (err) {
                    console.error("Firestore clonePage failed:", err);
                }
            } else {
                let lib = this.getLibrary();
                lib.push(clonedPage);
                this.saveLibrary(lib);
                localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            }
            
            this.activeProjectId = finalProjectId;
            this.loadMapState(clonedPage);
            this.notify();
        }
        return newPageId;
    }


    getBlueprint(type) { return typeof MultiMapSchema !== 'undefined' ? MultiMapSchema.getDefinition(type) : { label: type, icon: "⚪" }; }
    getSmartChildType(pid) { const p = this.state.nodes.find(x => x.id === pid); return p && typeof MultiMapSchema !== 'undefined' ? MultiMapSchema.getDefaultChild(p.type) : 'note'; }

    getEmptyState() {
        return {
            map_id: this.generateId(),
            meta: { title: "New Map", type: "generic", created: new Date().toISOString() },
            nodes: [], connections: [],
            session: { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [], layoutMode: 'organic' }
        };
    }

    createSubmap(type = 'generic', title = 'New Submap') {
        const id = this.generateId();
        const rootType = (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes && MultiMapSchema.mapTypes[type]) ? MultiMapSchema.mapTypes[type].rootNode : 'root';
        const rootTitle = (typeof MultiMapSchema !== 'undefined') ? MultiMapSchema.getDefinition(rootType).label : "Root";
        
        const newState = {
            map_id: id,
            meta: { title: title, type: type, created: new Date().toISOString(), shared: false },
            nodes: [{ id: this.generateId(), type: rootType, title: rootTitle, data: { x: 0, y: 0, isCore: true } }],
            connections: [],
            session: { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [], layoutMode: 'organic' }
        };
        
        this.saveMapToLibrary(newState);
        return id;
    }

    ensureSchema(state) {
        if (!state) return this.getEmptyState();
        if (!Array.isArray(state.nodes)) state.nodes = [];
        if (!Array.isArray(state.connections)) state.connections = state.edges || [];
        delete state.edges;
        if (!state.meta) state.meta = { title: "Imported Map", type: "generic", created: new Date().toISOString() };
        if (!state.meta.type) state.meta.type = "generic";
        if (!state.meta.project_id) state.meta.project_id = this.activeProjectId || 'default_project';
        if (!state.session) state.session = { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [], layoutMode: 'organic' };
        if (this.state && this.state.session && this.state.session.remoteTemplates && this.state.session.remoteTemplates.length > 0) {
            state.session.remoteTemplates = this.state.session.remoteTemplates;
        } else if (!state.session.remoteTemplates) {
            state.session.remoteTemplates = [];
        }
        if (!state.session.layoutMode) state.session.layoutMode = 'organic';
        state.nodes.forEach(n => {
            if (!n.data) n.data = { x: 0, y: 0 };
            if (n.data.collapsed === undefined) n.data.collapsed = false;
        });

        // Ensure only one root node exists in the map and matches state.meta.type
        if (state.nodes.length > 0) {
            const isRootType = (type) => type && (type === 'root' || type.endsWith('-root'));
            const roots = state.nodes.filter(n => isRootType(n.type));
            
            let coreRoot = roots.find(n => n.data && n.data.isCore);
            if (!coreRoot) {
                // Find node with no parent or fallback to the first root
                coreRoot = roots.find(n => !state.connections.some(c => c.to === n.id && c.type === 'structural'));
            }
            if (!coreRoot) coreRoot = roots[0] || state.nodes[0];

            if (coreRoot) {
                if (!coreRoot.data) coreRoot.data = { x: 0, y: 0 };
                coreRoot.data.isCore = true;

                if (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes) {
                    // Check if the root node's existing type is already a recognised schema rootNode.
                    // If so, preserve it and sync meta.type from it (templates carry their type here).
                    const matchedByRootNode = Object.keys(MultiMapSchema.mapTypes).find(
                        m => MultiMapSchema.mapTypes[m].rootNode === coreRoot.type
                    );

                    if (matchedByRootNode) {
                        // Root type is valid — just align meta.type to match
                        if (state.meta.type !== matchedByRootNode) {
                            state.meta.type = matchedByRootNode;
                        }
                    } else {
                        // Root type is unrecognised — coerce it from meta.type
                        const mapType = state.meta.type || 'generic';
                        const expectedRootType = MultiMapSchema.mapTypes[mapType]
                            ? MultiMapSchema.mapTypes[mapType].rootNode
                            : 'root';
                        if (coreRoot.type !== expectedRootType) {
                            coreRoot.type = expectedRootType;
                        }
                    }
                } else {
                    // No schema available — leave root type untouched
                }

                // Convert all other roots to 'hub'
                state.nodes.forEach(n => {
                    if (n.id !== coreRoot.id && isRootType(n.type)) {
                        n.type = 'hub';
                        if (n.data) n.data.isCore = false;
                    }
                });
            }
        }

        return state;
    }

    resolveOverlaps(iterations = 30, kRepel = 0.08, kSpring = 0.05) {
        const repulsionDist = 240; 
        const springLength = 160;

        for (let step = 0; step < iterations; step++) {
            let moved = false;
            for (let i = 0; i < this.state.nodes.length; i++) {
                for (let j = i + 1; j < this.state.nodes.length; j++) {
                    const n1 = this.state.nodes[i], n2 = this.state.nodes[j];
                    const dx = n1.data.x - n2.data.x, dy = n1.data.y - n2.data.y;
                    const d = Math.sqrt(dx*dx + dy*dy);
                    
                    if (d < repulsionDist && d > 0.1) {
                        const force = (repulsionDist - d) * kRepel;
                        const fx = (dx / d) * force, fy = (dy / d) * force;
                        n1.data.x += fx; n1.data.y += fy;
                        n2.data.x -= fx; n2.data.y -= fy;
                        moved = true;
                    }
                }
            }

            this.state.connections.forEach(conn => {
                if (conn.type !== 'structural') return; 
                const source = this.state.nodes.find(n => n.id === conn.from);
                const target = this.state.nodes.find(n => n.id === conn.to);
                if (source && target) {
                    const dx = target.data.x - source.data.x, dy = target.data.y - source.data.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d > 0.1 && Math.abs(d - springLength) > 2) {
                        const force = (d - springLength) * kSpring;
                        const nx = (dx / d) * force, ny = (dy / d) * force;
                        source.data.x += nx; source.data.y += ny;
                        target.data.x -= nx; target.data.y -= ny;
                        moved = true;
                    }
                }
            });
            if (!moved) break;
        }
        this.notify();
    }

    autoLayoutOrganic() { this.resolveOverlaps(150, 0.15, 0.08); } 

    getDownstreamNodes(startId) {
        const result = new Set([startId]);
        const queue = [startId];
        while (queue.length > 0) {
            const curr = queue.shift();
            const kids = this.state.connections.filter(c => c.from === curr && c.type === 'structural').map(c => c.to);
            kids.forEach(k => { if (!result.has(k)) { result.add(k); queue.push(k); } });
        }
        return result;
    }

    toggleCollapse(nodeId) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (node) { node.data.collapsed = !node.data.collapsed; this.notify(); }
    }

    deleteNode(id) {
        const n = this.state.nodes.find(x => x.id === id);
        if (n && (n.type === 'root' || n.type.endsWith('-root') || (n.data && n.data.isCore))) {
            alert("The root node of a map cannot be deleted.");
            return;
        }
        this.saveHistory();
        const toDelete = this.getDownstreamNodes(id);
        this.state.nodes = this.state.nodes.filter(n => !toDelete.has(n.id));
        this.state.connections = this.state.connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to));
        if (toDelete.has(this.state.session.selectedId)) this.state.session.selectedId = null;
        this.notify();
    }

    findSmartPosition(pid) {
        const p = this.state.nodes.find(n => n.id === pid);
        if (!p) return { x: 0, y: 0 }; 
        const r = 250; const steps = 16; 
        let bestAngle = 0, maxClearance = 0;
        for (let i = 0; i < steps; i++) {
            const theta = (i * (360 / steps)) * (Math.PI / 180);
            const checkX = p.data.x + Math.cos(theta) * r;
            const checkY = p.data.y + Math.sin(theta) * r;
            let nearestDist = Infinity;
            this.state.nodes.forEach(n => {
                if (n.id === pid) return; 
                const d = Math.sqrt((n.data.x - checkX)**2 + (n.data.y - checkY)**2);
                if (d < nearestDist) nearestDist = d;
            });
            if (nearestDist > maxClearance) { maxClearance = nearestDist; bestAngle = theta; }
        }
        return { x: p.data.x + Math.cos(bestAngle) * r, y: p.data.y + Math.sin(bestAngle) * r };
    }

    addNode(data, pid = null) {
        data = data || {};
        
        // SINGLETON PERSON CHECK
        if (data.type === 'person-root') {
            const existingPerson = this.state.nodes.find(n => n.type === 'person-root');
            if (existingPerson) {
                alert("A Person node already exists in this map. Focus shifted.");
                this.selectNode(existingPerson.id);
                return existingPerson;
            }
        }

        this.saveHistory();
        const id = data.id || this.generateId();
        let posX = data.x, posY = data.y;
        
        if (this.state.nodes.length === 0) {
            const mapType = this.state.meta ? this.state.meta.type : 'generic';
            const rootType = (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes && MultiMapSchema.mapTypes[mapType]) ? MultiMapSchema.mapTypes[mapType].rootNode : 'root';
            const rootTitle = (typeof MultiMapSchema !== 'undefined') ? MultiMapSchema.getDefinition(rootType).label : "Root";
            data.type = rootType; data.title = rootTitle; data.isCore = true; posX = 0; posY = 0;
        } else if (posX === undefined && pid) {
            const pos = this.findSmartPosition(pid);
            posX = pos.x; posY = pos.y;
        }

        const node = { 
            id: id, type: data.type || 'note', title: data.title || (data.type ? data.type.toUpperCase() : 'NODE'), 
            content: data.content || '', data: { x: posX || 0, y: posY || 0, isCore: data.isCore || false, collapsed: false }
        };
        
        this.state.nodes.push(node);
        setTimeout(() => this.resolveOverlaps(40), 10);
        this.notify();
        return node;
    }

    addConnection(f, t, connType = 'structural') {
        if (f === t || this.state.connections.find(c => c.from === f && c.to === t)) return { success: false };
        let s, tg;
        if (typeof MultiMapSchema !== 'undefined') {
            s = this.state.nodes.find(n => n.id === f);
            tg = this.state.nodes.find(n => n.id === t);
            if (s && tg && !MultiMapSchema.canConnect(s.type, tg.type)) return { success: false };
        }
        this.saveHistory();
        this.state.connections.push({ id: this.generateId(), from: f, to: t, type: connType });
        if (connType === 'structural') setTimeout(() => this.resolveOverlaps(40), 10);
        this.notify();
        
        return { success: true };
    }

    updateNode(id, up) { 
        const n = this.state.nodes.find(x => x.id === id); 
        if (!n) return; 
        
        if (up.type === 'person-root') {
            const existingPerson = this.state.nodes.find(x => x.type === 'person-root' && x.id !== id);
            if (existingPerson) {
                alert("Only one Person node is permitted per constellation.");
                return;
            }
        }

        // If the core/root node's type is being updated, automatically sync the map's metadata type
        const isRootType = (type) => type && (type.endsWith('-root') || type === 'root');
        const hasParent = this.state.connections.some(c => c.to === id && c.type === 'structural');
        const isRootNode = n.data && (n.data.isCore || (!hasParent && isRootType(n.type)));

        if (up.type && isRootNode && isRootType(up.type) && up.type !== n.type) {
            if (typeof MultiMapSchema !== 'undefined' && MultiMapSchema.mapTypes) {
                const matchedMapType = Object.keys(MultiMapSchema.mapTypes).find(
                    m => MultiMapSchema.mapTypes[m].rootNode === up.type
                );
                if (matchedMapType) {
                    const allowedNodes = MultiMapSchema.mapTypes[matchedMapType].allowedNodes || [];
                    // Find any existing nodes that are not allowed in the target map type (excluding the root node itself)
                    const incompatibleNodes = this.state.nodes.filter(node => node.id !== id && !allowedNodes.includes(node.type));
                    if (incompatibleNodes.length > 0) {
                        const incompatibleTypes = [...new Set(incompatibleNodes.map(node => node.type))];
                        const shouldConvert = confirm(`Cannot change root type to "${up.type}" (map type "${matchedMapType}") because this map contains incompatible downstream nodes: ${incompatibleTypes.join(', ')}.\n\nWould you like to automatically convert these incompatible nodes to "note" nodes? Warning: some content/functionality might be lost.`);
                        if (shouldConvert) {
                            incompatibleNodes.forEach(node => {
                                const oldType = node.type;
                                node.type = 'note';
                                if (node.title === `New ${oldType}` || node.title === oldType.toUpperCase() || node.title.startsWith("New ")) {
                                    node.title = `Converted Note (${oldType})`;
                                }
                            });
                        } else {
                            return; // Block the update
                        }
                    }
                    
                    if (!this.state.meta) this.state.meta = {};
                    this.state.meta.type = matchedMapType;
                }
            }
        }

        if (up.content && n.type === 'person-root') {
            try {
                const pData = JSON.parse(up.content);
                const childConns = this.state.connections.filter(c => c.from === id && c.type === 'structural');
                const children = childConns.map(c => this.state.nodes.find(node => node.id === c.to)).filter(node => node);
                
                Object.keys(pData).forEach(field => {
                    const value = pData[field];
                    let fieldNode = children.find(node => node.title === field);
                    if (fieldNode) {
                        fieldNode.content = value;
                    } else {
                        const childId = this.generateId();
                        const pos = this.findSmartPosition(id);
                        this.state.nodes.push({
                            id: childId, type: 'note', title: field, content: value,
                            data: { x: pos.x, y: pos.y, isCore: false, collapsed: false }, submaps: []
                        });
                        this.state.connections.push({ id: this.generateId(), from: id, to: childId, type: 'structural' });
                    }
                });
            } catch(e) {}
        }

        Object.keys(up).forEach(k => { if (k === 'x' || k === 'y') n.data[k] = up[k]; else n[k] = up[k]; }); 
        this.notify(); 
    }

    // Person Profile Field Auto-Child Generator
    updatePersonField(nodeId, field, value) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (!node) return;

        let data = {};
        try { data = JSON.parse(node.content || '{}'); } catch(e) {}
        data[field] = value;
        node.content = JSON.stringify(data);

        // Find or create structural child note dedicated to this field
        const childConns = this.state.connections.filter(c => c.from === nodeId && c.type === 'structural');
        const children = childConns.map(c => this.state.nodes.find(n => n.id === c.to)).filter(n => n);
        
        let fieldNode = children.find(n => n.title === field);
        
        if (fieldNode) {
            fieldNode.content = value;
        } else {
            // Silently spawn a child node using smart positioning
            const childId = this.generateId();
            const pos = this.findSmartPosition(nodeId);
            this.state.nodes.push({
                id: childId, type: 'note', title: field, content: value,
                data: { x: pos.x, y: pos.y, isCore: false, collapsed: false }, submaps: []
            });
            this.state.connections.push({ id: this.generateId(), from: nodeId, to: childId, type: 'structural' });
            this.resolveOverlaps(40);
        }
        this.notify();
    }

    async loadRemoteTemplates() {
        try {
            const tpls = await this.bridge.fetchTemplates();
            this.state.session.remoteTemplates = tpls;
            this.notify();
        } catch(e) { console.error(e); }
    }

    // TEMPLATE BOLT-ON ENGINE
    applyTemplateToNode(targetNodeId, templateState) {
        this.saveHistory();
        const targetNode = this.state.nodes.find(x => x.id === targetNodeId);
        if (!targetNode || !templateState || !templateState.nodes || templateState.nodes.length === 0) return;

        // Root of the template is mapped to the currently selected node
        const root = templateState.nodes.find(n => n.data && n.data.isCore) || templateState.nodes[0];
        const idMap = {};
        const newNodes = [];

        templateState.nodes.forEach(n => {
            if (n.id === root.id) {
                idMap[n.id] = targetNodeId;
                // If template root has JSON payload and target doesn't, inherit it.
                if (targetNode.type === 'person-root' && !targetNode.content && n.content) {
                    targetNode.content = n.content;
                }
            } else {
                const newId = this.generateId();
                idMap[n.id] = newId;
                // Offset position relative to the target node
                newNodes.push({
                    ...n,
                    id: newId,
                    data: { 
                        ...n.data, 
                        x: targetNode.data.x + (n.data.x - root.data.x), 
                        y: targetNode.data.y + (n.data.y - root.data.y) 
                    }
                });
            }
        });

        const newConns = [];
        templateState.connections.forEach(c => {
            const fromId = idMap[c.from];
            const toId = idMap[c.to];
            if (fromId && toId && fromId !== toId) {
                newConns.push({ ...c, id: this.generateId(), from: fromId, to: toId });
            }
        });

        this.state.nodes.push(...newNodes);
        this.state.connections.push(...newConns);
        
        this.resolveOverlaps(80);
        this.notify();
    }

    importSubmap(portalId, submapState) {
        this.saveHistory();
        const portal = this.state.nodes.find(n => n.id === portalId);
        if(!portal || !submapState || !submapState.nodes) return;

        const validSub = this.ensureSchema(submapState);
        const idMap = {};
        const newNodes = validSub.nodes.map(n => {
            const newId = this.generateId();
            idMap[n.id] = newId;
            return { ...n, id: newId, data: { ...n.data, x: n.data.x + portal.data.x + 300, y: n.data.y + portal.data.y } };
        });
        
        const newConns = [];
        validSub.connections.forEach(c => {
            if (idMap[c.from] && idMap[c.to]) newConns.push({ id: this.generateId(), from: idMap[c.from], to: idMap[c.to], type: c.type || 'structural' });
        });

        this.state.nodes.push(...newNodes);
        this.state.connections.push(...newConns);
        
        if(newNodes.length > 0) {
            const linkTarget = (validSub.meta && validSub.meta.original_root && idMap[validSub.meta.original_root]) ? idMap[validSub.meta.original_root] : newNodes[0].id;
            this.addConnection(portalId, linkTarget);
        }
        this.state = this.ensureSchema(this.state);
        this.resolveOverlaps(150); 
        this.notify();
    }

    extractConstellation(rootId) {
        const root = this.state.nodes.find(n => n.id === rootId);
        if (!root) return null;
        const included = this.getDownstreamNodes(root.id);
        return {
            map_id: this.generateId(),
            meta: { title: root.title + " (Clipped)", original_root: rootId, notes: "", shared: false },
            nodes: this.state.nodes.filter(n => included.has(n.id)),
            connections: this.state.connections.filter(c => included.has(c.from) && included.has(c.to))
        };
    }

    /**
     * Clip: preserves the selected branch in a new page, replaces the node
     * with a portal to that page, and removes the downstream subtree from
     * the current map.  The node's title and position are preserved.
     * Returns the new page's map_id or null on failure.
     */
    async clipBranch(nodeId, customTitle = null, customType = null) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (!node) return null;

        // Guard: don't clip roots, portals, or web-type nodes
        const isRoot   = node.data.isCore || node.type === 'root' || node.type.endsWith('-root');
        const isPortal = node.type === 'portal' || node.type === 'smart-portal';
        const isWeb    = node.type.startsWith('web-');
        if (isRoot || isPortal || isWeb) return null;

        // 1. Extract the subtree snapshot
        this.saveHistory();
        const snapshot = this.extractConstellation(nodeId);
        if (!snapshot) return null;

        // 2. Re-root the snapshot: the clipped node becomes the root of the new page
        const rootNode = snapshot.nodes.find(n => n.id === nodeId);
        if (rootNode) {
            rootNode.data.isCore = true;
            // Derive a fitting root type from the node type
            const finalType = customType || rootNode.type;
            rootNode.type = finalType.endsWith('-root') ? finalType : (finalType + '-root');
        }

        // Remove any structural connection pointing INTO rootNode (there shouldn't be any
        // in the extracted snapshot since we only took downstream, but be safe)
        snapshot.connections = snapshot.connections.filter(c => c.to !== nodeId || c.type !== 'structural');

        // Set the new page meta
        snapshot.meta.title = customTitle || node.title || "Clipped Branch";
        snapshot.meta.type  = customType || (rootNode && rootNode.type) || 'generic';

        // 3. Persist the new page to the active project
        const saved = await this.saveConstellationToLibrary(snapshot);
        if (saved === false) return null;
        const newMapId = snapshot.map_id;

        // 4. In the current map: remove all downstream nodes EXCEPT the clipped node itself,
        //    then morph the clipped node into a portal
        const downstream = this.getDownstreamNodes(nodeId);
        downstream.delete(nodeId); // keep the root node

        this.state.nodes = this.state.nodes.filter(n => !downstream.has(n.id));
        // Remove connections FROM or TO downstream nodes, but keep the structural
        // connection TO the clipped node (parent → clipped node stays)
        this.state.connections = this.state.connections.filter(c => {
            if (downstream.has(c.from) || downstream.has(c.to)) return false;
            return true;
        });
        // Also remove connections that were FROM the clipped node to its children
        // (those children are gone now)
        this.state.connections = this.state.connections.filter(c => c.from !== nodeId || c.type !== 'structural');

        // Morph the node into a portal
        node.type    = 'portal';
        node.content = newMapId;
        // Leave title, data.x, data.y, data.isCore intact

        this.notify();
        this.saveCurrentMapToLibrary();
        return newMapId;
    }

    generateId() { return Math.random().toString(36).substr(2, 9); }
    subscribe(fn) { this.listeners.push(fn); }
    notify() { this.listeners.forEach(fn => fn(this.state)); this.bridge.sync(this.state); }
    exportMapState() { return JSON.stringify(this.state, null, 2); }
    loadFromStorage() { try { const data = localStorage.getItem("mm_core_state"); return data ? JSON.parse(data) : null; } catch (e) { return null; } }
    
    checkAutoSave() {
        const c = JSON.stringify(this.state);
        if (c !== this.lastSaveState) {
            this.lastSaveState = c;
            
            const e = document.getElementById('save-status');
            if (e) {
                e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span> Saving...';
            }
            
            if (this.isUsingCloudVault()) {
                const uid = window.FirebaseAuth.currentUser.uid;
                const mapId = this.state.map_id;
                
                const mapRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", this.activeProjectId, "pages", mapId);
                const sessionRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "sessions", "active");
                
                const snapshot = JSON.parse(c);
                
                Promise.all([
                    window.Firestore.setDoc(mapRef, snapshot),
                    window.Firestore.setDoc(sessionRef, {
                        activeProjectId: this.activeProjectId,
                        activeMapId: mapId,
                        portalHistory: this.portalHistory
                    })
                ]).then(() => {
                    if (e) {
                        e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Cloud';
                    }
                }).catch(err => {
                    console.error("Firestore autosave failed:", err);
                    if (e) {
                        e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Error';
                    }
                });
            } else {
                localStorage.setItem("mm_core_state", c);
                if (e) {
                    setTimeout(() => {
                        e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local';
                    }, 500);
                }
            }
        }
    }

    saveHistory() { try { this.history.push(JSON.stringify(this.state)); if(this.history.length > 50) this.history.shift(); } catch(e){} }
    undo() { if(this.history.length > 0) { this.state = this.ensureSchema(JSON.parse(this.history.pop())); this.notify(); } }
    
    saveLibrary(lib) { localStorage.setItem("mm_constellation_lib", JSON.stringify(lib)); }
    
    async saveMapToLibrary(mapState) {
        const snapshot = JSON.parse(JSON.stringify(mapState, (key, value) => {
            if (key === 'library' || key === 'projects' || key === 'schemaData' || key === 'remoteTemplates') return undefined;
            return value;
        }));
        
        const destProjectId = snapshot.meta.project_id || this.activeProjectId;
        snapshot.meta.project_id = destProjectId;
        
        if (this.state && this.state.map_id === snapshot.map_id) {
            if (!this.state.meta) this.state.meta = {};
            this.state.meta.project_id = destProjectId;
        }

        let exists = false;
        if (this.isUsingCloudVault()) {
            exists = this.firestorePagesByProject[destProjectId] && this.firestorePagesByProject[destProjectId].some(x => x.map_id === snapshot.map_id);
        } else {
            exists = this.getLibrary().some(x => x.map_id === snapshot.map_id);
        }

        if (!exists && !this.checkStorageLimit(1024)) return false;
        
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const mapRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", destProjectId, "pages", snapshot.map_id);
                await window.Firestore.setDoc(mapRef, snapshot);
                
                if (!this.firestorePagesByProject[destProjectId]) {
                    this.firestorePagesByProject[destProjectId] = [];
                }
                const idx = this.firestorePagesByProject[destProjectId].findIndex(x => x.map_id === snapshot.map_id);
                if (idx !== -1) {
                    this.firestorePagesByProject[destProjectId][idx] = snapshot;
                } else {
                    this.firestorePagesByProject[destProjectId].push(snapshot);
                }
                
                const proj = this.firestoreProjects.find(p => p.project_id === destProjectId);
                if (proj && !proj.page_ids.includes(snapshot.map_id)) {
                    proj.page_ids.push(snapshot.map_id);
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", destProjectId);
                    await window.Firestore.setDoc(projRef, proj);
                }
                
                // Clean from other projects in Firestore
                for (const p of this.firestoreProjects) {
                    if (p.project_id !== destProjectId && p.page_ids && p.page_ids.includes(snapshot.map_id)) {
                        p.page_ids = p.page_ids.filter(id => id !== snapshot.map_id);
                        const otherProjRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", p.project_id);
                        await window.Firestore.setDoc(otherProjRef, p);
                    }
                }
                
                this.notify();
            } catch (err) {
                console.error("Firestore saveMapToLibrary failed:", err);
            }
        } else {
            let lib = this.getLibrary();
            const idx = lib.findIndex(x => x.map_id === snapshot.map_id);
            if (idx !== -1) {
                lib[idx] = snapshot;
            } else {
                lib.push(snapshot);
            }
            this.saveLibrary(lib);
            
            const proj = this.projects.find(p => p.project_id === destProjectId);
            if (proj && !proj.page_ids.includes(snapshot.map_id)) {
                proj.page_ids.push(snapshot.map_id);
            }
            
            // Clean from other projects in Local projects list
            this.projects.forEach(p => {
                if (p.project_id !== destProjectId && p.page_ids) {
                    p.page_ids = p.page_ids.filter(id => id !== snapshot.map_id);
                }
            });
            
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            this.notify();
        }
    }

    saveConstellationToLibrary(data) {
        return this.saveMapToLibrary(data);
    }

    getLibrary() {
        if (this.isUsingCloudVault()) {
            return Object.values(this.firestorePagesByProject).flat() || [];
        }
        try { return JSON.parse(localStorage.getItem("mm_constellation_lib")) || []; } catch(e) { return []; }
    }

    async deleteFromLibrary(id) {
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                let projId = this.activeProjectId;
                for (const [pId, pages] of Object.entries(this.firestorePagesByProject)) {
                    if (pages.some(p => p.map_id === id)) {
                        projId = pId;
                        break;
                    }
                }
                
                const mapRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projId, "pages", id);
                await window.Firestore.deleteDoc(mapRef);
                
                if (this.firestorePagesByProject[projId]) {
                    this.firestorePagesByProject[projId] = this.firestorePagesByProject[projId].filter(x => x.map_id !== id);
                }
                
                const proj = this.firestoreProjects.find(p => p.project_id === projId);
                if (proj) {
                    proj.page_ids = proj.page_ids.filter(x => x !== id);
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projId);
                    await window.Firestore.setDoc(projRef, proj);
                }
                
                // SCAFFOLD: Hook into file-root dynamic synchronization
                // If we delete a page, we should remove the corresponding 'file-document' node from the project's Master Map (file-root).
                
                if (this.state.map_id === id) {
                    const allPages = this.getLibrary();
                    if (allPages.length > 0) {
                        this.loadMapState(allPages[0]);
                    } else {
                        this.state = this.getEmptyState();
                        this.notify();
                    }
                } else {
                    this.notify();
                }
            } catch (err) {
                console.error("Firestore delete failed:", err);
            }
        } else {
            let lib = this.getLibrary().filter(x => x.map_id !== id);
            this.saveLibrary(lib);
            
            this.projects.forEach(p => {
                p.page_ids = p.page_ids.filter(x => x !== id);
            });
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            
            // SCAFFOLD: Hook into file-root dynamic synchronization (local)
            // If we delete a page, we should remove the corresponding 'file-document' node from the project's Master Map (file-root).
            
            if (this.state.map_id === id) {
                if (lib.length > 0) {
                    this.loadMapState(lib[0]);
                } else {
                    this.state = this.getEmptyState();
                    this.notify();
                }
            } else {
                this.notify();
            }
        }
    }

    async updateLibraryItem(id, metaUpdates) {
        if (window.FirebaseAuth && window.FirebaseAuth.currentUser && !window.FirebaseAuth.currentUser.isAnonymous) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                let projId = this.activeProjectId;
                for (const [pId, pages] of Object.entries(this.firestorePagesByProject)) {
                    if (pages.some(p => p.map_id === id)) {
                        projId = pId;
                        break;
                    }
                }
                const mapRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projId, "pages", id);
                if (this.firestorePagesByProject[projId]) {
                    const idx = this.firestorePagesByProject[projId].findIndex(x => x.map_id === id);
                    if (idx !== -1) {
                        this.firestorePagesByProject[projId][idx].meta = { ...this.firestorePagesByProject[projId][idx].meta, ...metaUpdates };
                        await window.Firestore.setDoc(mapRef, this.firestorePagesByProject[projId][idx]);
                        if (this.state.map_id === id) {
                            this.state.meta = { ...this.state.meta, ...metaUpdates };
                        }
                        this.notify();
                    }
                }
            } catch (err) {
                console.error("Firestore updateLibraryItem failed:", err);
            }
        } else {
            let lib = this.getLibrary();
            const idx = lib.findIndex(x => x.map_id === id);
            if (idx !== -1) {
                lib[idx].meta = { ...lib[idx].meta, ...metaUpdates };
                this.saveLibrary(lib);
                if (this.state.map_id === id) {
                    this.state.meta = { ...this.state.meta, ...metaUpdates };
                }
                this.notify();
            }
        }
    }
    loadMapState(data) {
        this.saveCurrentMapToLibrary();
        this.saveHistory();
        this.state = this.ensureSchema(data);
        this.notify();
    }
    
    // --- Portal Navigation ---
    enterPortal(mapData) {
        this.saveCurrentMapToLibrary();
        this.portalHistory.push(JSON.parse(JSON.stringify(this.state)));
        this.history = []; // Clear undo history for new map
        this.state = this.ensureSchema(mapData);
        this.notify();
    }
    
    saveCurrentMapToLibrary() {
        if (!this.state || !this.state.map_id) return;
        this.saveMapToLibrary(this.state);
    }

    exitPortal() {
        if (this.portalHistory.length > 0) {
            this.saveCurrentMapToLibrary(); // Persist submap edits before leaving
            this.state = this.ensureSchema(this.portalHistory.pop());
            this.history = []; // Clear undo history
            this.notify();
            return true;
        }
        return false;
    }

    async migrateGuestData(uid) {
        try {
            const libHelper = window.MultiMapLibrary || MultiMapLibrary;
            const { projects: localProjects, pages: localPages } = libHelper.loadLocalProjects();
            
            let migratedProjects = [...localProjects];
            let migratedLib = [...localPages];
            
            // Read active guest state map ID if it exists and make sure it has the latest edits
            const rawActiveState = localStorage.getItem("mm_core_state");
            let guestActiveMapId = null;
            let guestActiveProjectId = null;
            if (rawActiveState) {
                try {
                    const activeState = JSON.parse(rawActiveState);
                    guestActiveMapId = activeState.map_id;
                    guestActiveProjectId = activeState.meta?.project_id || 'default_project';
                    
                    if (guestActiveMapId) {
                        // Replace/Insert active state in the migration array to capture unsaved edits
                        const idx = migratedLib.findIndex(m => m.map_id === guestActiveMapId);
                        if (idx > -1) {
                            migratedLib[idx] = activeState;
                        } else {
                            migratedLib.push(activeState);
                        }
                        
                        // Ensure the project lists contain this map
                        const activeProj = migratedProjects.find(p => p.project_id === guestActiveProjectId);
                        if (activeProj) {
                            if (!activeProj.page_ids) activeProj.page_ids = [];
                            if (!activeProj.page_ids.includes(guestActiveMapId)) {
                                activeProj.page_ids.push(guestActiveMapId);
                            }
                        }
                    }
                } catch(e) {
                    console.warn("Failed to parse guest active state", e);
                }
            }

            if (migratedProjects.length === 0 && migratedLib.length === 0) return;
            
            console.log(`Migrating guest projects and maps to Firestore...`);
            
            // Fix orphaned pages (pages without project or mapping to a non-existent project)
            const validProjIds = new Set(migratedProjects.map(p => p.project_id).filter(Boolean));
            let hasOrphans = false;
            
            migratedLib.forEach(page => {
                if (!page || !page.map_id) return;
                const pid = page.meta?.project_id;
                if (!pid || !validProjIds.has(pid)) {
                    if (!page.meta) page.meta = {};
                    page.meta.project_id = 'default_project';
                    hasOrphans = true;
                }
            });
            
            if (hasOrphans || migratedProjects.length === 0) {
                let defaultProj = migratedProjects.find(p => p.project_id === 'default_project');
                if (!defaultProj) {
                    defaultProj = {
                        project_id: "default_project",
                        meta: {
                            title: "My Project",
                            description: "Migrated guest project",
                            icon: "📁",
                            color: "#8b5cf6"
                        },
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        page_ids: []
                    };
                    migratedProjects.push(defaultProj);
                }
                
                // Add any orphans to default_project's page_ids
                migratedLib.forEach(page => {
                    if (!page || !page.map_id) return;
                    if (page.meta?.project_id === 'default_project') {
                        if (!defaultProj.page_ids) defaultProj.page_ids = [];
                        if (!defaultProj.page_ids.includes(page.map_id)) {
                            defaultProj.page_ids.push(page.map_id);
                        }
                    }
                });
            }
            
            let allSuccess = true;
            
            for (const proj of migratedProjects) {
                if (!proj || !proj.project_id) continue;
                try {
                    const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", proj.project_id);
                    const projSnap = await window.Firestore.getDoc(projRef);
                    
                    let finalProj = { ...proj };
                    if (!finalProj.page_ids) finalProj.page_ids = [];
                    
                    if (projSnap.exists()) {
                        const existingProj = projSnap.data();
                        const mergedPageIds = Array.from(new Set([
                            ...(existingProj.page_ids || []),
                            ...(finalProj.page_ids || [])
                        ]));
                        finalProj = {
                            ...existingProj,
                            page_ids: mergedPageIds,
                            updated_at: new Date().toISOString()
                        };
                    }
                    
                    await window.Firestore.setDoc(projRef, finalProj);
                    
                    const projPages = migratedLib.filter(m => m && m.map_id && m.meta?.project_id === proj.project_id);
                    
                    for (const page of projPages) {
                        try {
                            if (!page.meta) page.meta = {};
                            page.meta.project_id = proj.project_id;
                            
                            const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", proj.project_id, "pages", page.map_id);
                            await window.Firestore.setDoc(pageRef, page);
                        } catch (pageErr) {
                            console.error(`Failed to migrate page ${page.map_id}:`, pageErr);
                            allSuccess = false;
                        }
                    }
                } catch (projErr) {
                    console.error(`Failed to migrate project ${proj.project_id}:`, projErr);
                    allSuccess = false;
                }
            }
            
            // If there was an active guest map, update the session document in Firestore
            if (guestActiveMapId) {
                try {
                    const sessionRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "sessions", "active");
                    await window.Firestore.setDoc(sessionRef, {
                        activeProjectId: guestActiveProjectId || 'default_project',
                        activeMapId: guestActiveMapId,
                        portalHistory: []
                    });
                } catch (sessErr) {
                    console.error("Failed to update session:", sessErr);
                }
            }
            
            if (allSuccess) {
                if (typeof MultiMapLibrary !== 'undefined') MultiMapLibrary.clearLocalProjects();
                console.log("Migration complete.");
            } else {
                console.warn("Migration partially failed. Local cache was not cleared to prevent data loss.");
            }
        } catch (err) {
            console.error("Migration failed entirely:", err);
        }
    }

    async syncWithFirestore(uid) {
        try {
            console.log("Syncing with Firestore for user:", uid);
            
            await this.migrateGuestData(uid);
            
            // Always check for legacy flat maps to migrate
            const mapsCol = window.Firestore.collection(window.FirebaseDb, "users", uid, "maps");
            const mapsSnapshot = await window.Firestore.getDocs(mapsCol);
            
            const legacyMaps = [];
            mapsSnapshot.forEach(doc => legacyMaps.push(doc.data()));
            
            if (legacyMaps.length > 0) {
                console.log(`Migrating ${legacyMaps.length} legacy flat maps to projects...`);
                const defaultProjId = "default_project";
                
                const defaultProjRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", defaultProjId);
                const defaultProjSnap = await window.Firestore.getDoc(defaultProjRef);
                let defaultProj;
                if (defaultProjSnap.exists()) {
                    defaultProj = defaultProjSnap.data();
                } else {
                    defaultProj = {
                        project_id: defaultProjId,
                        meta: {
                            title: "My Project",
                            description: "Migrated workspace project",
                            icon: "📁",
                            color: "#8b5cf6"
                        },
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        page_ids: []
                    };
                }
                
                for (const map of legacyMaps) {
                    if (!map.meta) map.meta = {};
                    map.meta.project_id = defaultProjId;
                    if (!defaultProj.page_ids.includes(map.map_id)) {
                        defaultProj.page_ids.push(map.map_id);
                    }
                    
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", defaultProjId, "pages", map.map_id);
                    await window.Firestore.setDoc(pageRef, map);
                    
                    const oldMapRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "maps", map.map_id);
                    await window.Firestore.deleteDoc(oldMapRef);
                }
                
                await window.Firestore.setDoc(defaultProjRef, defaultProj);
            }
            
            const projectsCol = window.Firestore.collection(window.FirebaseDb, "users", uid, "projects");
            const projectsSnapshot = await window.Firestore.getDocs(projectsCol);
            
            this.firestoreProjects = [];
            this.firestorePagesByProject = {};
            
            if (projectsSnapshot.empty) {
                console.log("No projects found after migration. Provisioning default project and page...");
                const defaultProjId = "default_project";
                const defaultProj = {
                    project_id: defaultProjId,
                    meta: {
                        title: "Personal Workspace",
                        description: "My default workspace",
                        icon: "📁",
                        color: "#8b5cf6"
                    },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    page_ids: []
                };
                const defaultMapId = this.generateId();
                const defaultMap = {
                    map_id: defaultMapId,
                    meta: { 
                        title: "Project Directory", 
                        type: "file-root", 
                        created: new Date().toISOString(),
                        shared: false,
                        project_id: defaultProjId
                    },
                    nodes: [{ id: this.generateId(), type: "file-root", title: "Project Directory", data: { x: 0, y: 0, isCore: true } }],
                    connections: [],
                    session: { 
                        viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, 
                        selectedId: null, 
                        remoteTemplates: [], 
                        layoutMode: 'organic' 
                    }
                };
                defaultProj.page_ids.push(defaultMapId);
                
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", defaultProjId);
                await window.Firestore.setDoc(projRef, defaultProj);
                
                const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", defaultProjId, "pages", defaultMapId);
                await window.Firestore.setDoc(pageRef, defaultMap);
                
                this.firestoreProjects.push(defaultProj);
                this.firestorePagesByProject[defaultProjId] = [defaultMap];
                
                const sessionRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "sessions", "active");
                await window.Firestore.setDoc(sessionRef, {
                    activeProjectId: defaultProjId,
                    activeMapId: defaultMapId,
                    portalHistory: []
                });
            } else {
                projectsSnapshot.forEach(doc => {
                    this.firestoreProjects.push(doc.data());
                });
                
                const pagePromises = this.firestoreProjects.map(async (proj) => {
                    const pagesCol = window.Firestore.collection(window.FirebaseDb, "users", uid, "projects", proj.project_id, "pages");
                    const pagesSnapshot = await window.Firestore.getDocs(pagesCol);
                    const pages = [];
                    pagesSnapshot.forEach(doc => pages.push(doc.data()));
                    this.firestorePagesByProject[proj.project_id] = pages;
                });
                
                await Promise.all(pagePromises);
            }
            
            const sessionRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "sessions", "active");
            const sessionSnap = await window.Firestore.getDoc(sessionRef);
            
            let activeProjectId = "default_project";
            let activeMapId = null;
            let portalHistory = [];
            
            if (sessionSnap.exists()) {
                const sessionData = sessionSnap.data();
                activeProjectId = sessionData.activeProjectId || "default_project";
                activeMapId = sessionData.activeMapId;
                portalHistory = sessionData.portalHistory || [];
            }
            
            if (this.isUsingCloudVault()) {
                this.activeProjectId = activeProjectId;
                
                let activePage = null;
                if (activeMapId && this.firestorePagesByProject[activeProjectId]) {
                    activePage = this.firestorePagesByProject[activeProjectId].find(p => p.map_id === activeMapId);
                }
                
                if (!activePage) {
                    const currentProj = this.firestoreProjects.find(p => p.project_id === activeProjectId) || this.firestoreProjects[0];
                    if (currentProj) {
                        this.activeProjectId = currentProj.project_id;
                        const projPages = this.firestorePagesByProject[this.activeProjectId] || [];
                        activePage = projPages[0];
                    }
                }
                
                if (activePage) {
                    this.state = this.ensureSchema(activePage);
                    this.portalHistory = portalHistory;
                    this.lastSaveState = JSON.stringify(this.state);
                    
                    if (!sessionSnap.exists()) {
                        await window.Firestore.setDoc(sessionRef, {
                            activeProjectId: this.activeProjectId,
                            activeMapId: activePage.map_id,
                            portalHistory: []
                        });
                    }
                } else {
                    console.warn("Active page not found after sync. Initializing empty state.");
                    this.state = this.getEmptyState();
                    this.portalHistory = [];
                    this.lastSaveState = JSON.stringify(this.state);
                }
                
                this.notify();
                console.log("Firestore sync complete.");
                
                // Refresh data manager panel if it's open
                const dmDrawer = document.getElementById('data-manager-drawer');
                const dmContainer = document.getElementById('data-manager-content');
                if (dmDrawer && dmContainer && !dmDrawer.classList.contains('translate-x-full') && window.Auth) {
                    window.Auth.renderDataManager(dmContainer);
                }
                
                const e = document.getElementById('save-status');
                if (e) {
                    e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Cloud';
                }
            } else {
                this.notify();
                console.log("Firestore sync complete in background.");
                const e = document.getElementById('save-status');
                if (e) {
                    e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local';
                }
            }
        } catch (err) {
            console.error("Error syncing with Firestore:", err);
        }
    }

    disconnectFirestore() {
        console.log("Disconnecting from Firestore, falling back to LocalStorage.");
        this.firestoreLibrary = [];
        this.projects = [];
        this.activeProjectId = 'default_project';
        this.migrateLocalGuestData();
        const rawState = this.loadFromStorage();
        this.state = this.ensureSchema(rawState);
        this.portalHistory = [];
        this.lastSaveState = JSON.stringify(this.state);
        
        if (this.state.nodes.length === 0) {
            this.addNode({ type: "root", title: "Root", data: { x: 0, y: 0, isCore: true } });
        }
        this.notify();
        
        const e = document.getElementById('save-status');
        if (e) {
            e.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Local';
        }
    }

    selectNode(id) { this.state.session.selectedId = id; this.notify(); }
}