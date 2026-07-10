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

    constructor(isReadOnly = false) {
        this.config = { autoSaveInterval: 2000, autoFocus: true, autoCollapseDepth: 3 };
        this.bridge = new HostBridge();
        this.isReadOnly = isReadOnly;
        
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
        
        const isStateEmpty = (state) => {
            if (!state) return true;
            if (!state.nodes || state.nodes.length === 0) return true;
            if (state.nodes.length === 1 && (!state.connections || state.connections.length === 0)) {
                const root = state.nodes[0];
                const isDefaultRoot = root.type === 'root' || root.type === 'file-root';
                const isDefaultTitle = state.meta?.title === 'New Map' || state.meta?.title === 'New Submap';
                if (isDefaultRoot && isDefaultTitle && !state.meta?.isMaster) {
                    return true;
                }
            }
            return false;
        };

        if (isStateEmpty(rawState)) {
            // Find target project: current (saved in localStorage), first, or new if none
            const projects = this.projects || [];
            let targetProjId = 'default_project';
            if (projects.length > 0) {
                const lastActiveProjId = localStorage.getItem("mm_active_project_id");
                const currentProj = projects.find(p => p.project_id === lastActiveProjId) || projects[0];
                targetProjId = currentProj.project_id;
            } else {
                const defaultProj = {
                    project_id: 'default_project',
                    meta: { title: "Local Session", description: "Your local sandbox", color: "#8b5cf6" },
                    folders: [],
                    page_assignments: {},
                    page_ids: []
                };
                this.projects = [defaultProj];
                localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            }
            
            this.activeProjectId = targetProjId;
            localStorage.setItem("mm_active_project_id", targetProjId);

            // Load existing project directory/master map or the first page of this project
            const pages = this.getPages(targetProjId);
            let masterMap = pages.find(p => p.meta && p.meta.isMaster === true) || 
                            pages.find(p => p.meta && p.meta.title === "Project Directory");
            
            if (masterMap) {
                this.state = this.ensureSchema(masterMap);
            } else if (pages.length > 0) {
                this.state = this.ensureSchema(pages[0]);
            } else {
                // Create a new master project directory if no pages exist
                const masterMapId = this.generateId();
                masterMap = {
                    map_id: masterMapId,
                    meta: {
                        title: "Project Directory",
                        type: "file",
                        created: new Date().toISOString(),
                        shared: false,
                        project_id: targetProjId,
                        isMaster: true
                    },
                    nodes: [{ id: this.generateId(), type: "file-root", title: "Project Directory", data: { x: 0, y: 0, isCore: true } }],
                    connections: [],
                    session: { viewport: { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1 }, selectedId: null, remoteTemplates: [], layoutMode: 'organic' }
                };

                const proj = this.projects.find(p => p.project_id === targetProjId);
                if (proj) {
                    if (!proj.page_ids) proj.page_ids = [];
                    proj.page_ids.push(masterMapId);
                    localStorage.setItem("mm_projects", JSON.stringify(this.projects));
                }

                const libRaw = localStorage.getItem("mm_constellation_lib");
                const lib = libRaw ? JSON.parse(libRaw) : [];
                lib.push(masterMap);
                localStorage.setItem("mm_constellation_lib", JSON.stringify(lib));

                this.state = this.ensureSchema(masterMap);
            }
            localStorage.setItem("mm_core_state", JSON.stringify(this.state));
        } else {
            this.state = this.ensureSchema(rawState);
            this.activeProjectId = this.state.meta.project_id || 'default_project';
            localStorage.setItem("mm_active_project_id", this.activeProjectId);
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
            localStorage.setItem("mm_active_project_id", this.activeProjectId);
            const pages = this.getPages(this.activeProjectId);
            const masterMap = pages.find(p => p.meta && p.meta.isMaster === true) || 
                              pages.find(p => p.meta && p.meta.title === "Project Directory") || 
                              pages[0];
            if (masterMap) {
                this.loadMapState(masterMap);
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
        
        const defaultProj = {
            project_id: 'default_project',
            meta: { title: "Local Session", description: "Your local sandbox", color: "#8b5cf6" },
            folders: [],
            page_assignments: {},
            page_ids: []
        };
        
        try {
            const p = JSON.parse(localStorage.getItem("mm_projects"));
            if (p && p.length > 0) {
                if (!p.find(proj => proj.project_id === 'default_project')) {
                    p.push(defaultProj);
                }
                return p;
            }
        } catch(e) {}
        
        return [defaultProj];
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

    hasRootType(mapId, targetType) {
        const pages = this.getAllPages();
        const map = pages.find(p => p.map_id === mapId);
        if (!map || !map.nodes) return false;
        const root = map.nodes.find(n => n.type && (n.type === 'web-root' || n.type === 'root' || n.type === 'person-root' || n.type === 'agent-root' || n.type === 'prompt-root'));
        if (targetType === 'web-root') return root && root.type === 'web-root';
        if (targetType === 'prompt-root') return root && root.type === 'prompt-root';
        if (targetType === 'agent-root') return root && root.type === 'agent-root';
        if (targetType === 'person-root') return root && root.type === 'person-root';
        return root && root.type === targetType;
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
        if (this.isReadOnly) return null;
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
                type: "file", 
                created: new Date().toISOString(),
                shared: false,
                project_id: projectId,
                isMaster: true
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

    async getPagesForProject(projectId) {
        if (this.isUsingCloudVault()) {
            return this.firestorePagesByProject[projectId] || [];
        } else {
            const lib = this.getLibrary();
            const project = this.projects.find(p => p.project_id === projectId);
            const pageIds = project ? new Set(project.page_ids) : new Set();
            return lib.filter(p => {
                const hasProjId = p.meta && p.meta.project_id === projectId;
                const isInProjectList = p.map_id && pageIds.has(p.map_id);
                return hasProjId || isInProjectList;
            });
        }
    }

    async savePage(projectId, pageId, pageData) {
        if (this.isReadOnly) return;
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", pageId);
                await window.Firestore.setDoc(pageRef, pageData);
            } catch (err) {
                console.error("Firestore savePage failed:", err);
            }
        } else {
            let lib = this.getLibrary();
            const idx = lib.findIndex(p => p.map_id === pageId);
            if (idx !== -1) {
                lib[idx] = pageData;
            } else {
                lib.push(pageData);
            }
            this.saveLibrary(lib);
        }
    }

    async saveProject(projData) {
        if (this.isReadOnly) return;
        projData.updated_at = new Date().toISOString();
        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser.uid;
            try {
                const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projData.project_id);
                await window.Firestore.setDoc(projRef, projData);
                const idx = this.firestoreProjects.findIndex(p => p.project_id === projData.project_id);
                if (idx !== -1) {
                    this.firestoreProjects[idx] = projData;
                }
            } catch (err) {
                console.error("Firestore saveProject failed:", err);
            }
        } else {
            const idx = this.projects.findIndex(p => p.project_id === projData.project_id);
            if (idx !== -1) {
                this.projects[idx] = projData;
            } else {
                this.projects.push(projData);
            }
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
        }
    }

    // Folder Methods
    async createProjectFolder(projectId, folderName, parentId = null) {
        const proj = this.getProjects().find(p => p.project_id === projectId);
        if (!proj) return null;
        
        if (!proj.folders) proj.folders = [];
        const folder = {
            id: this.generateId(),
            name: folderName,
            parent_id: parentId,
            isExpanded: true
        };
        proj.folders.push(folder);
        
        await this.saveProject(proj);
        return folder;
    }

    async updateProjectFolder(projectId, folderId, updates) {
        const proj = this.getProjects().find(p => p.project_id === projectId);
        if (!proj || !proj.folders) return false;
        
        const folder = proj.folders.find(f => f.id === folderId);
        if (!folder) return false;
        
        Object.assign(folder, updates);
        await this.saveProject(proj);
        return true;
    }

    async deleteProjectFolder(projectId, folderId, unpackToRoot = true) {
        const proj = this.getProjects().find(p => p.project_id === projectId);
        if (!proj || !proj.folders) return false;
        
        // Find all nested folder IDs
        const folderIdsToDelete = new Set([folderId]);
        let added = true;
        while(added) {
            added = false;
            for (const f of proj.folders) {
                if (f.parent_id && folderIdsToDelete.has(f.parent_id) && !folderIdsToDelete.has(f.id)) {
                    folderIdsToDelete.add(f.id);
                    added = true;
                }
            }
        }
        
        if (!unpackToRoot) {
            // Option A: Delete all pages inside these folders
            const pageAssignments = proj.page_assignments || {};
            const pagesToDelete = Object.keys(pageAssignments).filter(pid => folderIdsToDelete.has(pageAssignments[pid]));
            for (const pid of pagesToDelete) {
                await this.deleteFromLibrary(pid);
            }
        }
        
        // Unassign pages from deleted folders
        if (proj.page_assignments) {
            for (const pid of Object.keys(proj.page_assignments)) {
                if (folderIdsToDelete.has(proj.page_assignments[pid])) {
                    delete proj.page_assignments[pid];
                }
            }
        }
        
        proj.folders = proj.folders.filter(f => !folderIdsToDelete.has(f.id));
        await this.saveProject(proj);
        return true;
    }

    async assignPageToFolder(projectId, pageId, folderId) {
        const proj = this.getProjects().find(p => p.project_id === projectId);
        if (!proj) return false;
        
        if (!proj.page_assignments) proj.page_assignments = {};
        
        if (folderId) {
            proj.page_assignments[pageId] = folderId;
        } else {
            delete proj.page_assignments[pageId];
        }
        
        await this.saveProject(proj);
        return true;
    }

    async getOrCreateMasterMap(projectId) {
        const pages = await this.getPagesForProject(projectId);
        const candidates = pages.filter(p => p.meta && (p.meta.isMaster === true || p.meta.title === "Project Directory"));

        candidates.sort((a, b) => {
            const aIsMaster = a.meta.isMaster === true;
            const bIsMaster = b.meta.isMaster === true;
            if (aIsMaster && !bIsMaster) return -1;
            if (!aIsMaster && bIsMaster) return 1;

            const aCreated = a.meta.created ? new Date(a.meta.created) : new Date(0);
            const bCreated = b.meta.created ? new Date(b.meta.created) : new Date(0);
            return aCreated - bCreated;
        });

        let masterMap = candidates[0];
        let masterChanged = false;

        if (masterMap) {
            if (masterMap.meta.isMaster !== true) {
                masterMap.meta.isMaster = true;
                masterChanged = true;
            }
            if (masterMap.meta.title !== "Project Directory") {
                masterMap.meta.title = "Project Directory";
                masterChanged = true;
            }
            if (masterMap.meta.type !== "file") {
                masterMap.meta.type = "file";
                masterChanged = true;
            }

            // Consolidate "ghost" directory pages
            const ghosts = candidates.slice(1);
            for (const ghost of ghosts) {
                // Ensure page IDs of ghosts are synced into project page_ids
                const projects = this.getProjects();
                const proj = projects.find(p => p.project_id === projectId);
                if (proj && ghost.nodes) {
                    ghost.nodes.forEach(node => {
                        if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                            if (!proj.page_ids.includes(node.content)) {
                                proj.page_ids.push(node.content);
                            }
                        }
                    });
                    await this.saveProject(proj);
                }

                // 1. Merge folder nodes & portal nodes from ghost
                if (ghost.nodes) {
                    masterMap.nodes = masterMap.nodes || [];
                    ghost.nodes.forEach(node => {
                        if (node.type === 'file-folder' && node.content) {
                            const exists = masterMap.nodes.some(n => n.type === 'file-folder' && n.content === node.content);
                            if (!exists) {
                                masterMap.nodes.push(JSON.parse(JSON.stringify(node)));
                                masterChanged = true;
                            }
                        } else if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                            const exists = masterMap.nodes.some(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === node.content);
                            if (!exists) {
                                masterMap.nodes.push(JSON.parse(JSON.stringify(node)));
                                masterChanged = true;
                            }
                        }
                    });
                }

                // 2. Merge structural connections
                if (ghost.connections && ghost.nodes && masterMap.nodes) {
                    masterMap.connections = masterMap.connections || [];
                    ghost.connections.forEach(conn => {
                        if (conn.type === 'structural') {
                            const ghostFromNode = ghost.nodes.find(n => n.id === conn.from);
                            const ghostToNode = ghost.nodes.find(n => n.id === conn.to);
                            if (ghostFromNode && ghostToNode) {
                                const masterFromNode = masterMap.nodes.find(n => {
                                    if (ghostFromNode.type === 'file-root') return n.type === 'file-root';
                                    return n.content === ghostFromNode.content && n.type === ghostFromNode.type;
                                });
                                const masterToNode = masterMap.nodes.find(n => {
                                    return n.content === ghostToNode.content && n.type === ghostToNode.type;
                                });
                                if (masterFromNode && masterToNode) {
                                    const connExists = masterMap.connections.some(c => c.from === masterFromNode.id && c.to === masterToNode.id && c.type === 'structural');
                                    if (!connExists) {
                                        masterMap.connections.push({
                                            id: this.generateId(),
                                            from: masterFromNode.id,
                                            to: masterToNode.id,
                                            type: 'structural'
                                        });
                                        masterChanged = true;
                                    }
                                }
                            }
                        }
                    });
                }

                // Delete ghost page
                await this.deleteGhostPageInternal(projectId, ghost.map_id);
            }

            if (masterChanged) {
                await this.savePage(projectId, masterMap.map_id, masterMap);
            }
        }

        if (!masterMap) {
            const masterMapId = this.generateId();
            masterMap = {
                map_id: masterMapId,
                meta: {
                    title: "Project Directory",
                    type: "file",
                    created: new Date().toISOString(),
                    shared: false,
                    project_id: projectId,
                    isMaster: true
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

            const projects = this.getProjects();
            const proj = projects.find(p => p.project_id === projectId);
            if (proj) {
                proj.page_ids.push(masterMapId);
                proj.updated_at = new Date().toISOString();

                if (this.isUsingCloudVault()) {
                    const uid = window.FirebaseAuth.currentUser.uid;
                    try {
                        const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", masterMapId);
                        await window.Firestore.setDoc(pageRef, masterMap);
                        const projRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId);
                        await window.Firestore.setDoc(projRef, proj);
                        if (!this.firestorePagesByProject[projectId]) this.firestorePagesByProject[projectId] = [];
                        this.firestorePagesByProject[projectId].push(masterMap);
                    } catch (err) {
                        console.error("Firestore createMasterMap failed:", err);
                    }
                } else {
                    let lib = this.getLibrary();
                    lib.push(masterMap);
                    this.saveLibrary(lib);
                    localStorage.setItem("mm_projects", JSON.stringify(this.projects));
                }
            }
        }
        return masterMap;
    }

    async deleteGhostPageInternal(projectId, pageId) {
        if (this.isReadOnly) return;

        // Remove from projects lists
        const projects = this.getProjects();
        const proj = projects.find(p => p.project_id === projectId);
        if (proj) {
            proj.page_ids = proj.page_ids.filter(id => id !== pageId);
            if (proj.page_assignments) {
                delete proj.page_assignments[pageId];
            }
            await this.saveProject(proj);
        }

        if (this.isUsingCloudVault()) {
            const uid = window.FirebaseAuth.currentUser?.uid;
            if (uid) {
                try {
                    const pageRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", projectId, "pages", pageId);
                    await window.Firestore.deleteDoc(pageRef);
                } catch (e) {
                    console.error("Failed to delete ghost page from Firestore:", e);
                }
            }
            if (this.firestorePagesByProject[projectId]) {
                this.firestorePagesByProject[projectId] = this.firestorePagesByProject[projectId].filter(p => p.map_id !== pageId);
            }
        } else {
            let lib = this.getLibrary().filter(x => x.map_id !== pageId);
            this.saveLibrary(lib);
        }

        // Redirect active state if it was the ghost page
        if (this.state && this.state.map_id === pageId) {
            const masterId = this.findMasterMapIdSync(projectId);
            if (masterId) {
                const lib = this.getLibrary();
                const master = lib.find(p => p.map_id === masterId) || (this.firestorePagesByProject[projectId]?.find(p => p.map_id === masterId));
                if (master) {
                    this.loadMapState(master, false);
                }
            }
        }
    }

    async syncProjectMasterMap(projectId) {
        if (!projectId) return;
        const masterMap = await this.getOrCreateMasterMap(projectId);
        if (!masterMap) return;

        const pages = await this.getPagesForProject(projectId);
        const nonMasterPages = pages.filter(p => p.map_id !== masterMap.map_id);
        const proj = this.getProjects().find(p => p.project_id === projectId);
        const folders = proj?.folders || [];
        const pageAssignments = proj?.page_assignments || {};

        let rootNode = masterMap.nodes.find(n => n.type === 'file-root');
        if (!rootNode) {
            rootNode = masterMap.nodes.find(n => n.type && (n.type.endsWith('-root') || n.type === 'root'));
            if (rootNode) rootNode.type = 'file-root';
        }
        if (!rootNode) return;

        let changed = false;

        const validPageIds = new Set(nonMasterPages.map(p => p.map_id));
        const seenPageIds = new Set();
        masterMap.nodes = masterMap.nodes.filter(n => {
            if (n.type === 'portal' || n.type === 'smart-portal') {
                if (n.content) {
                    if (!validPageIds.has(n.content) || seenPageIds.has(n.content)) {
                        changed = true;
                        masterMap.connections = masterMap.connections.filter(c => c.from !== n.id && c.to !== n.id);
                        return false;
                    }
                    seenPageIds.add(n.content);
                }
            }
            return true;
        });

        const validFolderIds = new Set(folders.map(f => f.id));
        const seenFolderIds = new Set();
        masterMap.nodes = masterMap.nodes.filter(n => {
            if (n.type === 'file-folder') {
                if (n.content) {
                    if (!validFolderIds.has(n.content) || seenFolderIds.has(n.content)) {
                        changed = true;
                        masterMap.connections = masterMap.connections.filter(c => c.from !== n.id && c.to !== n.id);
                        return false;
                    }
                    seenFolderIds.add(n.content);
                }
            }
            return true;
        });

        // 1. Add or update folders
        folders.forEach((folder, idx) => {
            let node = masterMap.nodes.find(n => n.type === 'file-folder' && n.content === folder.id);
            if (!node) {
                changed = true;
                const folderNodeId = this.generateId();
                const cols = 3;
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                const x = (col - (cols - 1) / 2) * 200;
                const y = -150 - (row * 150);

                node = {
                    id: folderNodeId,
                    type: 'file-folder',
                    title: folder.name,
                    content: folder.id,
                    data: { x, y, isSyncFolder: true }
                };
                masterMap.nodes.push(node);
            } else {
                if (node.title !== folder.name) {
                    node.title = folder.name;
                    changed = true;
                }
                if (node.data.collapsed === folder.isExpanded) {
                    node.data.collapsed = !folder.isExpanded;
                    changed = true;
                }
            }

            const targetParentId = folder.parent_id 
                ? (masterMap.nodes.find(n => n.type === 'file-folder' && n.content === folder.parent_id)?.id || rootNode.id)
                : rootNode.id;
            
            const existingConn = masterMap.connections.find(c => c.to === node.id && c.type === 'structural');
            if (!existingConn) {
                masterMap.connections.push({
                    id: this.generateId(),
                    from: targetParentId,
                    to: node.id,
                    type: 'structural'
                });
                changed = true;
            } else if (existingConn.from !== targetParentId) {
                existingConn.from = targetParentId;
                changed = true;
            }
        });

        // 2. Add or update pages
        nonMasterPages.forEach((page, idx) => {
            let node = masterMap.nodes.find(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === page.map_id);
            if (!node) {
                changed = true;
                const portalId = this.generateId();
                
                const cols = 4;
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                const x = (col - (cols - 1) / 2) * 160;
                const y = (row + 1) * 150;

                node = {
                    id: portalId,
                    type: 'portal',
                    title: page.meta.title || "Project Space",
                    content: page.map_id,
                    data: { x, y, isSyncPortal: true }
                };
                masterMap.nodes.push(node);
            } else {
                node.data = node.data || {};
                if (!node.data.isSyncPortal) {
                    node.data.isSyncPortal = true;
                    changed = true;
                }
                if (node.title !== page.meta.title) {
                    node.title = page.meta.title;
                    changed = true;
                }
            }

            const folderId = pageAssignments[page.map_id];
            const targetParentId = folderId 
                ? (masterMap.nodes.find(n => n.type === 'file-folder' && n.content === folderId)?.id || rootNode.id)
                : rootNode.id;

            const targetParentNode = masterMap.nodes.find(n => n.id === targetParentId);

            const existingConn = masterMap.connections.find(c => c.to === node.id && c.type === 'structural');
            if (!existingConn) {
                masterMap.connections.push({
                    id: this.generateId(),
                    from: targetParentId,
                    to: node.id,
                    type: 'structural'
                });
                changed = true;
                if (targetParentNode && targetParentNode.data) {
                    node.data.x = targetParentNode.data.x + (Math.random() * 100 - 50);
                    node.data.y = targetParentNode.data.y + 120 + (Math.random() * 50);
                }
            } else if (existingConn.from !== targetParentId) {
                // Delete any other duplicate structural connections
                masterMap.connections = masterMap.connections.filter(c => !(c.to === node.id && c.type === 'structural' && c !== existingConn));
                
                existingConn.from = targetParentId;
                changed = true;
                if (targetParentNode && targetParentNode.data) {
                    node.data.x = targetParentNode.data.x + (Math.random() * 100 - 50);
                    node.data.y = targetParentNode.data.y + 120 + (Math.random() * 50);
                }
            }
        });

        if (changed) {
            const origState = this.state;
            this.state = this.ensureSchema(masterMap);
            this.resolveOverlaps(80);
            this.state = origState;

            await this.savePage(projectId, masterMap.map_id, masterMap);
        }

        // Always sync the live state from the (potentially mutated) masterMap
        // when the user is currently viewing the master map. This covers cases
        // where deleteFromLibrary already cleaned portals on disk but the
        // in-memory state still has stale portal nodes.
        if (this.state && this.state.map_id === masterMap.map_id) {
            this.state.nodes = masterMap.nodes;
            this.state.connections = masterMap.connections;
            this.notify();
        } else if (changed) {
            this.notify();
        }
    }

    async syncFoldersFromMasterMap(mapState) {
        if (!mapState || !mapState.meta || !mapState.meta.project_id) return;
        const projectId = mapState.meta.project_id;
        const proj = this.getProjects().find(p => p.project_id === projectId);
        if (!proj) return;
        
        let changed = false;
        if (!proj.folders) proj.folders = [];
        if (!proj.page_assignments) proj.page_assignments = {};

        const folderNodes = mapState.nodes.filter(n => n.type === 'file-folder');
        const folderIds = new Set(folderNodes.map(n => n.content));
        
        folderNodes.forEach(node => {
            let folderId = node.content;
            if (!folderId) {
                folderId = this.generateId();
                node.content = folderId; // Persist back to the node
                folderIds.add(folderId); // Add the new ID to the Set so it is not filtered out later
                changed = true;
            }
            let folder = proj.folders.find(f => f.id === folderId);
            if (!folder) {
                folder = { id: folderId, name: node.title, parent_id: null, isExpanded: !node.data.collapsed };
                proj.folders.push(folder);
                changed = true;
            } else {
                if (folder.name !== node.title) {
                    folder.name = node.title;
                    changed = true;
                }
                if (folder.isExpanded === node.data.collapsed) {
                    folder.isExpanded = !node.data.collapsed;
                    changed = true;
                }
            }
            
            const parentConn = mapState.connections.find(c => c.to === node.id && c.type === 'structural');
            if (parentConn) {
                const parentNode = mapState.nodes.find(n => n.id === parentConn.from);
                if (parentNode && parentNode.type === 'file-folder') {
                    if (folder.parent_id !== parentNode.content) {
                        folder.parent_id = parentNode.content;
                        changed = true;
                    }
                } else {
                    if (folder.parent_id !== null) {
                        folder.parent_id = null;
                        changed = true;
                    }
                }
            } else {
                if (folder.parent_id !== null) {
                    folder.parent_id = null;
                    changed = true;
                }
            }
        });
        
        if (proj.folders.length !== folderNodes.length) {
            proj.folders = proj.folders.filter(f => folderIds.has(f.id));
            changed = true;
        }

        const portalNodes = mapState.nodes.filter(n => n.type === 'portal' || n.type === 'smart-portal');
        portalNodes.forEach(node => {
            const pageId = node.content;
            if (!pageId) return;
            const incomingConns = mapState.connections.filter(c => c.to === node.id && c.type === 'structural');
            let parentConn = incomingConns.find(c => {
                const n = mapState.nodes.find(node => node.id === c.from);
                return n && n.type === 'file-folder';
            });
            if (!parentConn && incomingConns.length > 0) {
                parentConn = incomingConns[0];
            }

            if (parentConn) {
                const parentNode = mapState.nodes.find(n => n.id === parentConn.from);
                if (parentNode && parentNode.type === 'file-folder') {
                    if (proj.page_assignments[pageId] !== parentNode.content) {
                        proj.page_assignments[pageId] = parentNode.content;
                        changed = true;
                    }
                } else {
                    if (proj.page_assignments[pageId]) {
                        delete proj.page_assignments[pageId];
                        changed = true;
                    }
                }
            } else {
                if (proj.page_assignments[pageId]) {
                    delete proj.page_assignments[pageId];
                    changed = true;
                }
            }
        });
        
        if (changed) {
            await this.saveProject(proj);
            this.notify();
        }
    }

    async deleteProject(projectId) {
        if (this.isReadOnly) return;
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
            await this.syncProjectMasterMap(projectId);
            
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
        
        await this.syncProjectMasterMap(fromProjectId);
        await this.syncProjectMasterMap(toProjectId);
        
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
            
            await this.syncProjectMasterMap(finalProjectId);
            
            this.activeProjectId = finalProjectId;
            this.loadMapState(clonedPage);
            this.notify();
        }
        return newPageId;
    }


    getBlueprint(type) { return typeof MultiMapSchema !== 'undefined' ? MultiMapSchema.getDefinition(type) : { label: type, icon: "⚪" }; }
    getSmartChildType(pid) {
        const p = this.state.nodes.find(x => x.id === pid);
        if (p && p.data && p.data.lastSpawnedChildType) {
            return p.data.lastSpawnedChildType;
        }
        if (this.state.meta && this.state.meta.isMaster) {
            return 'file-folder';
        }
        return p && typeof MultiMapSchema !== 'undefined' ? MultiMapSchema.getDefaultChild(p.type) : 'note';
    }

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

        // Prune legacy auto-injected "Project Directory 📁" return portals.
        // These are no longer needed — navigation to the directory is via the smart button/radial action.
        const legacyReturnPortalIds = new Set(
            state.nodes
                .filter(n => (n.type === 'portal' || n.type === 'smart-portal') && n.title === 'Project Directory 📁')
                .map(n => n.id)
        );
        if (legacyReturnPortalIds.size > 0) {
            state.nodes = state.nodes.filter(n => !legacyReturnPortalIds.has(n.id));
            state.connections = state.connections.filter(c => !legacyReturnPortalIds.has(c.from) && !legacyReturnPortalIds.has(c.to));
        }

        // Prune stale portals pointing to maps that no longer exist (for master maps)
        const isMaster = state.meta && state.meta.isMaster === true;
        
        if (isMaster) {
            const lib = this.getLibrary();
            if (lib && lib.length > 0) {
                const libraryMapIds = new Set(lib.map(m => m.map_id));
                const stalePortalIds = new Set(
                    state.nodes
                        .filter(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content && !libraryMapIds.has(n.content))
                        .map(n => n.id)
                );
                if (stalePortalIds.size > 0) {
                    state.nodes = state.nodes.filter(n => !stalePortalIds.has(n.id));
                    state.connections = state.connections.filter(c => !stalePortalIds.has(c.from) && !stalePortalIds.has(c.to));
                }
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

    async toggleCollapse(nodeId) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (node) { 
            node.data.collapsed = !node.data.collapsed; 
            
            // Bi-directional sync: If this is a project-directory map and the node is a folder, update the underlying project folder state.
            if (this.state.meta && this.state.meta.isMaster && node.type === 'file-folder' && node.content) {
                const projId = this.state.meta.project_id || this.activeProjectId;
                if (projId) {
                    await this.updateProjectFolder(projId, node.content, { isExpanded: !node.data.collapsed });
                }
            }
            
            this.notify(); 
        }
    }

    deleteNode(id) {
        if (this.isReadOnly) return;
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
        if (this.isReadOnly) return null;
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

        if (pid && typeof MultiMapSchema !== 'undefined') {
            const parent = this.state.nodes.find(n => n.id === pid);
            const childType = data.type || 'note';
            if (parent && !MultiMapSchema.canConnect(parent.type, childType)) {
                console.warn(`Kernel Blocked Node Creation: cannot connect child [${childType}] to parent [${parent.type}].`);
                return null;
            }
        }

        const node = { 
            id: id, type: data.type || 'note', title: data.title || (data.type ? data.type.toUpperCase() : 'NODE'), 
            content: data.content || '', data: { x: posX || 0, y: posY || 0, isCore: data.isCore || false, collapsed: false }
        };
        
        if (pid) {
            const parent = this.state.nodes.find(n => n.id === pid);
            if (parent) {
                parent.data = parent.data || {};
                parent.data.lastSpawnedChildType = node.type;
            }
        }
        
        this.state.nodes.push(node);
        setTimeout(() => this.resolveOverlaps(40), 10);
        this.notify();
        return node;
    }

    addConnection(f, t, connType = 'structural') {
        if (this.isReadOnly) return { success: false };
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
        if (this.isReadOnly) return;
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

        if (up.type && up.type !== n.type) {
            const parentConnection = this.state.connections.find(c => c.to === id && c.type === 'structural');
            if (parentConnection) {
                const parentNode = this.state.nodes.find(x => x.id === parentConnection.from);
                if (parentNode) {
                    parentNode.data = parentNode.data || {};
                    parentNode.data.lastSpawnedChildType = up.type;
                }
            }
        }
        
        if (n.data && n.data.isSyncPortal) {
            if (up.type && up.type !== n.type) {
                console.warn("Blocked type modification on synchronized portal.");
                delete up.type;
            }
            if (up.content && up.content !== n.content) {
                console.warn("Blocked target/content modification on synchronized portal.");
                delete up.content;
            }
            if (up.title && up.title !== n.title) {
                console.warn("Blocked title modification on synchronized portal.");
                delete up.title;
            }
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
        if (this.isReadOnly) return;
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
                
                if (!exists) {
                    await this.syncProjectMasterMap(destProjectId);
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
            
            if (!exists) {
                await this.syncProjectMasterMap(destProjectId);
            }
            
            this.notify();
        }

        return true;
    }

    async saveConstellationToLibrary(mapState) {
        if (!mapState) return false;

        const snapshot = JSON.parse(JSON.stringify(mapState));
        
        if (!snapshot.meta) snapshot.meta = {};
        
        // Ensure standard project assignments before checking early aborts
        if (!snapshot.meta.project_id && this.activeProjectId && this.activeProjectId !== 'default_project') {
            snapshot.meta.project_id = this.activeProjectId;
        }

        if (!snapshot.meta.project_id) return false;
        
        if (snapshot.meta.isMaster === true) {
            // Apply folder sync mutations to the snapshot BEFORE saving
            await this.syncFoldersFromMasterMap(snapshot);
            
            // Also apply those mutations back to the live state if it's the active map
            if (this.state && this.state.map_id === snapshot.map_id) {
                this.state.nodes = JSON.parse(JSON.stringify(snapshot.nodes));
                this.state.connections = JSON.parse(JSON.stringify(snapshot.connections));
            }
        }

        return this.saveMapToLibrary(snapshot);
    }

    getLibrary() {
        if (this.isUsingCloudVault()) {
            return Object.values(this.firestorePagesByProject).flat() || [];
        }
        try { return JSON.parse(localStorage.getItem("mm_constellation_lib")) || []; } catch(e) { return []; }
    }

    getRootMetadata(mapId) {
        const lib = this.getLibrary();
        const mapData = lib.find(m => m.map_id === mapId);
        if (mapData && mapData.nodes) {
            const rootNode = mapData.nodes.find(n => n.type === 'root' || n.type?.endsWith('-root') || n.data?.isCore);
            if (rootNode) {
                return rootNode.root_metadata || {
                    summary: "",
                    tags: [],
                    portal_behavior: "standard",
                    static_layout: false,
                    custom_payload: {}
                };
            }
        }
        return null;
    }

    isPromptMap(mapId) {
        const lib = this.getLibrary();
        const mapData = lib.find(m => m.map_id === mapId);
        if (mapData && mapData.nodes) {
            return mapData.nodes.some(n => n.type === 'prompt-root');
        }
        return false;
    }

    compilePromptMapState(mapState, varValues = {}) {
        const promptRoot = mapState.nodes.find(n => n.type === 'prompt-root');
        if (!promptRoot) return "";

        const descendants = new Set();
        const getChildren = (id) => mapState.connections.filter(c => c.from === id).map(c => mapState.nodes.find(n => n.id === c.to)).filter(n => n);
        const gather = (node) => {
            if (!node || descendants.has(node)) return;
            descendants.add(node);
            getChildren(node.id).forEach(gather);
        };
        getChildren(promptRoot.id).forEach(gather);

        const order = ['prompt-role', 'prompt-context', 'prompt-goal', 'prompt-instruction', 'prompt-constraint', 'prompt-example', 'prompt-chain'];
        const grouped = {};
        order.forEach(o => grouped[o] = []);
        descendants.forEach(n => {
            if (grouped[n.type]) grouped[n.type].push(n);
        });

        const injectVars = (text) => {
            let res = text || '';
            Object.keys(varValues).forEach(k => {
                res = res.split(`{{${k}}}`).join(varValues[k]);
            });
            return res;
        };

        let compiledMd = "";
        order.forEach(type => {
            if (grouped[type].length > 0) {
                const sectionName = type.split('-')[1].toUpperCase();
                compiledMd += `### ${sectionName}\n\n`;
                grouped[type].forEach(n => {
                    compiledMd += `${injectVars(n.content || n.title)}\n\n`;
                });
            }
        });
        return compiledMd.trim();
    }

    async deleteFromLibrary(id) {
        if (this.isReadOnly) return;
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

                // Clean up references: delete directory portals, clear other portals
                const allPages = this.getLibrary();
                for (const page of allPages) {
                    if (page.map_id !== id && page.nodes) {
                        const isMasterPage = page.meta && page.meta.isMaster === true;
                        let changed = false;
                        
                        if (isMasterPage) {
                            const portalNodes = page.nodes.filter(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === id);
                            const portalNodeIds = new Set(portalNodes.map(n => n.id));
                            if (portalNodeIds.size > 0) {
                                page.nodes = page.nodes.filter(n => !portalNodeIds.has(n.id));
                                page.connections = page.connections.filter(c => !portalNodeIds.has(c.from) && !portalNodeIds.has(c.to));
                                changed = true;
                            }
                        } else {
                            page.nodes.forEach(n => {
                                if ((n.type === 'portal' || n.type === 'smart-portal') && n.content === id) {
                                    n.content = '';
                                    changed = true;
                                }
                            });
                        }
                        
                        if (changed) {
                            await this.savePage(projId, page.map_id, page);
                        }
                    }
                }

                // Clean up portal history
                this.portalHistory.forEach(state => {
                    if (state && Array.isArray(state.nodes)) {
                        state.nodes.forEach(n => {
                            if ((n.type === 'portal' || n.type === 'smart-portal') && n.content === id) {
                                n.content = '';
                            }
                        });
                    }
                });
                
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
                
                await this.syncProjectMasterMap(projId);
                
                if (this.state.map_id === id) {
                    if (this.portalHistory.length > 0) {
                        this.exitPortal(true);
                    } else {
                        const updatedPages = this.getLibrary();
                        const masterMap = updatedPages.find(p => p.map_id !== id && p.meta && p.meta.project_id === projId && p.meta.isMaster === true);
                        if (masterMap) {
                            this.loadMapState(masterMap, false);
                        } else {
                            const sorted = updatedPages.filter(x => x.map_id !== id).sort((a, b) => {
                                const dateA = a.meta?.created_at ? new Date(a.meta.created_at) : new Date(0);
                                const dateB = b.meta?.created_at ? new Date(b.meta.created_at) : new Date(0);
                                return dateB - dateA;
                            });
                            if (sorted.length > 0) {
                                this.loadMapState(sorted[0], false);
                            } else {
                                this.state = this.getEmptyState();
                                this.notify();
                            }
                        }
                    }
                } else {
                    this.notify();
                }
            } catch (err) {
                console.error("Firestore delete failed:", err);
            }
        } else {
            let projId = this.activeProjectId;
            const project = this.projects.find(p => p.page_ids.includes(id));
            if (project) {
                projId = project.project_id;
            }

            // Clean up references: delete directory portals, clear other portals
            const allPages = this.getLibrary();
            for (const page of allPages) {
                if (page.map_id !== id && page.nodes) {
                    const isMasterPage = page.meta && page.meta.isMaster === true;
                    let changed = false;
                    
                    if (isMasterPage) {
                        const portalNodes = page.nodes.filter(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === id);
                        const portalNodeIds = new Set(portalNodes.map(n => n.id));
                        if (portalNodeIds.size > 0) {
                            page.nodes = page.nodes.filter(n => !portalNodeIds.has(n.id));
                            page.connections = page.connections.filter(c => !portalNodeIds.has(c.from) && !portalNodeIds.has(c.to));
                            changed = true;
                        }
                    } else {
                        page.nodes.forEach(n => {
                            if ((n.type === 'portal' || n.type === 'smart-portal') && n.content === id) {
                                n.content = '';
                                changed = true;
                            }
                        });
                    }
                    if (changed) {
                        await this.savePage(projId, page.map_id, page);
                    }
                }
            }

            // Clean up portal history
            this.portalHistory.forEach(state => {
                if (state && Array.isArray(state.nodes)) {
                    state.nodes.forEach(n => {
                        if ((n.type === 'portal' || n.type === 'smart-portal') && n.content === id) {
                            n.content = '';
                        }
                    });
                }
            });

            let lib = this.getLibrary().filter(x => x.map_id !== id);
            this.saveLibrary(lib);
            
            this.projects.forEach(p => {
                p.page_ids = p.page_ids.filter(x => x !== id);
            });
            localStorage.setItem("mm_projects", JSON.stringify(this.projects));
            
            await this.syncProjectMasterMap(projId);
            
            if (this.state.map_id === id) {
                if (this.portalHistory.length > 0) {
                    this.exitPortal(true);
                } else {
                    const projectObj = this.projects.find(p => p.project_id === projId);
                    const masterMap = lib.find(p => {
                        const isInProject = p.meta?.project_id === projId || (projectObj && projectObj.page_ids.includes(p.map_id));
                        return isInProject && p.meta && p.meta.isMaster === true;
                    });
                    if (masterMap) {
                        this.loadMapState(masterMap, false);
                    } else {
                        const sorted = lib.sort((a, b) => {
                            const dateA = a.meta?.created_at ? new Date(a.meta.created_at) : new Date(0);
                            const dateB = b.meta?.created_at ? new Date(b.meta.created_at) : new Date(0);
                            return dateB - dateA;
                        });
                        if (sorted.length > 0) {
                            this.loadMapState(sorted[0], false);
                        } else {
                            this.state = this.getEmptyState();
                            this.notify();
                        }
                    }
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
                        await this.syncProjectMasterMap(projId);
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
                
                let projId = this.activeProjectId;
                const project = this.projects.find(p => p.page_ids.includes(id));
                if (project) {
                    projId = project.project_id;
                }
                await this.syncProjectMasterMap(projId);
                this.notify();
            }
        }
    }
    syncPortalNodeTitles() {
        if (!this.state || !this.state.nodes) return;
        const lib = this.getLibrary() || [];
        this.state.nodes.forEach(node => {
            if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                const targetMap = lib.find(m => m.map_id === node.content);
                if (targetMap && targetMap.meta && targetMap.meta.title && targetMap.meta.title !== node.title) {
                    node.title = targetMap.meta.title;
                }
            }
        });
    }

    findMasterMapIdSync(projectId) {
        if (this.isUsingCloudVault()) {
            const pages = this.firestorePagesByProject[projectId] || [];
            const master = pages.find(p => p.meta && p.meta.isMaster === true) || pages.find(p => p.meta && (p.meta.title === "Project Directory" || p.meta.type === "file"));
            return master ? master.map_id : null;
        } else {
            const lib = this.getLibrary();
            const pages = lib.filter(p => p.meta && p.meta.project_id === projectId);
            const master = pages.find(p => p.meta && p.meta.isMaster === true) || pages.find(p => p.meta && (p.meta.title === "Project Directory" || p.meta.type === "file"));
            return master ? master.map_id : null;
        }
    }

    isDirectoryPortal(node) {
        if (!node) return false;
        if (node.type !== 'portal' && node.type !== 'smart-portal') return false;
        
        // Check if title or content matches Project Directory
        const titleMatch = node.title && (node.title.includes("Project Directory") || node.title === "Project Directory 📁");
        if (titleMatch) return true;
        
        const projectId = this.state && this.state.meta && this.state.meta.project_id;
        if (projectId) {
            const masterMapId = this.findMasterMapIdSync(projectId);
            if (masterMapId && node.content === masterMapId) return true;
        }
        return false;
    }

    loadMapState(data, saveCurrent = true) {
        if (saveCurrent) {
            this.saveCurrentMapToLibrary();
        }
        this.saveHistory();
        this.state = this.ensureSchema(data);
        this.syncPortalNodeTitles();
        
        // Track active project and stamp project_id on map if missing
        const projectId = (this.state && this.state.meta && this.state.meta.project_id)
            ? this.state.meta.project_id
            : (this.activeProjectId || 'default_project');

        this.activeProjectId = projectId;
        localStorage.setItem("mm_active_project_id", projectId);

        if (this.state && this.state.meta) {
            if (!this.state.meta.project_id) {
                this.state.meta.project_id = projectId;
                this.savePage(projectId, this.state.map_id, this.state);
            }

            // If this IS the master map, re-sync it on load to ensure all portals are current
            const isMaster = this.state.meta.isMaster === true
                || this.state.meta.title === 'Project Directory'
                || this.state.meta.type === 'file'
                || this.state.meta.type === 'file-root';
            if (isMaster) {
                this.syncProjectMasterMap(projectId).catch(err =>
                    console.error('Error syncing master map on load:', err)
                );
            }
        }
        
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

    openPortal(portalNodeId) {
        const portalNode = this.state.nodes.find(n => n.id === portalNodeId);
        if (!portalNode || !portalNode.content) return;
        const targetMapId = portalNode.content;

        const rootMeta = this.getRootMetadata(targetMapId);
        if (!rootMeta) return;

        portalNode.data = portalNode.data || {};
        portalNode.data.dynamic_endpoint = rootMeta;

        if (rootMeta.portal_behavior === 'dynamic_spawn' && !portalNode.data.has_spawned) {
            portalNode.data.has_spawned = true;
            
            const payload = rootMeta.custom_payload || {};
            const nodesToSpawn = payload.spawn_nodes || [];

            if (Array.isArray(nodesToSpawn) && nodesToSpawn.length > 0) {
                nodesToSpawn.forEach((nodeConfig, index) => {
                    const childNode = this.addNode({
                        type: nodeConfig.type || 'note',
                        title: nodeConfig.title || 'Dynamic Node',
                        content: nodeConfig.content || '',
                        x: portalNode.data.x + 150,
                        y: portalNode.data.y + (index * 80)
                    });
                    this.addConnection(portalNodeId, childNode.id, 'structural');
                });
            } else {
                const childNode = this.addNode({
                    type: 'note',
                    title: 'Dynamic Endpoint',
                    content: 'Auto-spawned from ' + (rootMeta.summary || 'Portal'),
                    x: portalNode.data.x + 150,
                    y: portalNode.data.y
                });
                this.addConnection(portalNodeId, childNode.id, 'structural');
            }
        }
        
        this.saveHistory();
        this.notify();
    }
    
    saveCurrentMapToLibrary() {
        if (!this.state || !this.state.map_id) return;
        this.syncPortalNodeTitles();
        this.saveMapToLibrary(this.state);
    }

    exitPortal(skipSave = false) {
        if (this.portalHistory.length > 0) {
            if (!skipSave) {
                this.saveCurrentMapToLibrary(); // Persist submap edits before leaving
            }
            const oldState = this.portalHistory.pop();
            const lib = this.getLibrary();
            const latestState = lib.find(p => p.map_id === oldState.map_id);
            this.state = this.ensureSchema(latestState || oldState);
            this.syncPortalNodeTitles();
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
            
            // Filter out blank pages from localPages to avoid server pollution
            const isBlankPage = (page) => {
                if (!page) return true;
                if (!page.nodes || page.nodes.length === 0) return true;
                if (page.nodes.length === 1 && (!page.connections || page.connections.length === 0)) {
                    const root = page.nodes[0];
                    const isDefaultRoot = root.type === 'root' || root.type === 'file-root';
                    const isDefaultTitle = page.meta?.title === 'New Map' || page.meta?.title === 'New Submap';
                    if (isDefaultRoot && isDefaultTitle && !page.meta?.isMaster) {
                        return true;
                    }
                }
                return false;
            };

            let migratedLib = localPages.filter(p => !isBlankPage(p));
            let migratedProjects = localProjects.map(proj => {
                const copy = { ...proj };
                if (copy.page_ids) {
                    copy.page_ids = copy.page_ids.filter(id => migratedLib.some(p => p.map_id === id));
                }
                return copy;
            });
            
            // Read active guest state map ID if it exists and make sure it has the latest edits
            const rawActiveState = localStorage.getItem("mm_core_state");
            let guestActiveMapId = null;
            let guestActiveProjectId = null;
            if (rawActiveState) {
                try {
                    const activeState = JSON.parse(rawActiveState);
                    if (!isBlankPage(activeState)) {
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
                    
                    let projPages = migratedLib.filter(m => m && m.map_id && m.meta?.project_id === proj.project_id);

                    // Fetch existing page documents from Firestore for this project to check for existing master map
                    let serverMaster = null;
                    try {
                        const pagesCol = window.Firestore.collection(window.FirebaseDb, "users", uid, "projects", proj.project_id, "pages");
                        const pagesSnapshot = await window.Firestore.getDocs(pagesCol);
                        const serverPages = [];
                        pagesSnapshot.forEach(doc => serverPages.push(doc.data()));
                        serverMaster = serverPages.find(p => p.meta && (p.meta.isMaster === true || p.meta.title === "Project Directory"));
                    } catch (fetchErr) {
                        console.warn("Failed to check server master map during migration", fetchErr);
                    }

                    const guestMaster = projPages.find(p => p.meta && (p.meta.isMaster === true || p.meta.title === "Project Directory"));

                    if (serverMaster && guestMaster) {
                        // Merge guestMaster folders & portals into serverMaster
                        let serverMasterChanged = false;
                        if (guestMaster.nodes) {
                            serverMaster.nodes = serverMaster.nodes || [];
                            guestMaster.nodes.forEach(node => {
                                if (node.type === 'file-folder' && node.content) {
                                    const exists = serverMaster.nodes.some(n => n.type === 'file-folder' && n.content === node.content);
                                    if (!exists) {
                                        serverMaster.nodes.push(JSON.parse(JSON.stringify(node)));
                                        serverMasterChanged = true;
                                    }
                                } else if ((node.type === 'portal' || node.type === 'smart-portal') && node.content) {
                                    const exists = serverMaster.nodes.some(n => (n.type === 'portal' || n.type === 'smart-portal') && n.content === node.content);
                                    if (!exists) {
                                        serverMaster.nodes.push(JSON.parse(JSON.stringify(node)));
                                        serverMasterChanged = true;
                                    }
                                }
                            });
                        }
                        if (guestMaster.connections && guestMaster.nodes && serverMaster.nodes) {
                            serverMaster.connections = serverMaster.connections || [];
                            guestMaster.connections.forEach(conn => {
                                if (conn.type === 'structural') {
                                    const guestFromNode = guestMaster.nodes.find(n => n.id === conn.from);
                                    const guestToNode = guestMaster.nodes.find(n => n.id === conn.to);
                                    if (guestFromNode && guestToNode) {
                                        const serverFromNode = serverMaster.nodes.find(n => {
                                            if (guestFromNode.type === 'file-root') return n.type === 'file-root';
                                            return n.content === guestFromNode.content && n.type === guestFromNode.type;
                                        });
                                        const serverToNode = serverMaster.nodes.find(n => {
                                            return n.content === guestToNode.content && n.type === guestToNode.type;
                                        });
                                        if (serverFromNode && serverToNode) {
                                            const connExists = serverMaster.connections.some(c => c.from === serverFromNode.id && c.to === serverToNode.id && c.type === 'structural');
                                            if (!connExists) {
                                                serverMaster.connections.push({
                                                    id: this.generateId(),
                                                    from: serverFromNode.id,
                                                    to: serverToNode.id,
                                                    type: 'structural'
                                                });
                                                serverMasterChanged = true;
                                            }
                                        }
                                    }
                                }
                            });
                        }

                        if (serverMasterChanged) {
                            try {
                                const serverMasterRef = window.Firestore.doc(window.FirebaseDb, "users", uid, "projects", proj.project_id, "pages", serverMaster.map_id);
                                await window.Firestore.setDoc(serverMasterRef, serverMaster);
                            } catch (saveErr) {
                                console.error("Failed to save merged server master map:", saveErr);
                            }
                        }

                        // Update active map ID if it pointed to guest master
                        if (guestActiveMapId === guestMaster.map_id) {
                            guestActiveMapId = serverMaster.map_id;
                        }

                        // Remove guest master from the list of page IDs to upload and from the project list
                        finalProj.page_ids = finalProj.page_ids.filter(id => id !== guestMaster.map_id);
                        if (!finalProj.page_ids.includes(serverMaster.map_id)) {
                            finalProj.page_ids.push(serverMaster.map_id);
                        }

                        // Filter guestMaster out of projPages so we don't upload it
                        projPages = projPages.filter(p => p.map_id !== guestMaster.map_id);
                    } else if (guestMaster) {
                        // Make sure guestMaster is set to isMaster: true and titled correctly
                        guestMaster.meta = guestMaster.meta || {};
                        guestMaster.meta.isMaster = true;
                        guestMaster.meta.title = "Project Directory";
                        guestMaster.meta.type = "file";
                    }

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
        if (this.isReadOnly) return;
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
                        type: "file", 
                        created: new Date().toISOString(),
                        shared: false,
                        project_id: defaultProjId,
                        isMaster: true
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
                        localStorage.setItem("mm_active_project_id", this.activeProjectId);
                        const projPages = this.firestorePagesByProject[this.activeProjectId] || [];
                        activePage = projPages.find(p => p.meta && p.meta.isMaster === true) || 
                                     projPages.find(p => p.meta && p.meta.title === "Project Directory") || 
                                     projPages[0];
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

    selectNode(id) { 
        this.state.session.selectedId = id; 
        if (id) {
            let currentId = id;
            const nodesToExpand = [];
            while (currentId) {
                const parentConn = this.state.connections.find(c => c.to === currentId && c.type === 'structural');
                if (!parentConn) break;
                const parentNode = this.state.nodes.find(n => n.id === parentConn.from);
                if (!parentNode) break;
                nodesToExpand.push(parentNode);
                currentId = parentNode.id;
            }

            const node = this.state.nodes.find(n => n.id === id);
            if (node) nodesToExpand.push(node);

            nodesToExpand.forEach(n => {
                if (n.data && n.data.collapsed) {
                    n.data.collapsed = false;
                    if (n.type === 'file-folder' && this.state.meta && this.state.meta.isMaster === true) {
                        const projId = this.state.meta.project_id || this.activeProjectId;
                        if (projId && n.content) {
                            this.updateProjectFolder(projId, n.content, { isExpanded: true }).catch(console.error);
                        }
                    }
                }
            });
        }
        this.notify(); 
    }
}