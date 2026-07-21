/**
 * Multi-Map LIBRARY SYSTEM v1.2
 * Features: Targeted Templates (Node-Specific Application) & Profile Defaults.
 */

const MultiMapLibrary = {
    defaults: [],
    defaultsLoaded: false,
    fallbackDefaults: [
        {
            "map_id": "tpl_web_standard",
            "meta": { "title": "Standard Landing Page", "target_type": "web-root", "notes": "Responsive web layout.", "shared": true },
            "nodes": [
                { "id": "t_wr", "type": "web-root", "title": "Site Root", "content": "", "data": { "x": 0, "y": 0, "isCore": true } }
            ],
            "connections": []
        },
        {
            "map_id": "tpl_sw_arch",
            "meta": { "title": "Software Architecture", "target_type": "hub", "notes": "Web application stack.", "shared": true },
            "nodes": [
                { "id": "sa_root", "type": "hub", "title": "Platform Architecture", "data": { "x": 0, "y": 0, "isCore": true } }
            ],
            "connections": []
        }
    ],

    async loadDefaults() {
        if (this.defaultsLoaded) return;
        try {
            const res = await fetch('assets/templates/manifest.json');
            if (res.ok) {
                const manifest = await res.json();
                this.defaults = [];
                for (const item of manifest) {
                    try {
                        const tplRes = await fetch(item.path);
                        if (tplRes.ok) {
                            const tplData = await tplRes.json();
                            this.defaults.push(tplData);
                        }
                    } catch (innerErr) {
                        console.warn(`Failed to fetch template ${item.id}:`, innerErr);
                    }
                }
            } else {
                throw new Error("Manifest response not OK");
            }
            this.defaultsLoaded = true;
        } catch (e) {
            console.warn("Failed to load templates manifest, using fallback defaults:", e);
            this.defaults = this.fallbackDefaults || [];
            this.defaultsLoaded = true;
        }
    },

    getCustomTemplates() {
        try {
            const data = localStorage.getItem('mm_custom_templates');
            return data ? JSON.parse(data) : [];
        } catch (e) { return []; }
    },

    saveCustomTemplate(templateData) {
        try {
            const customs = this.getCustomTemplates();
            const idx = customs.findIndex(t => t.map_id === templateData.map_id);
            if (idx > -1) customs[idx] = templateData;
            else customs.push(templateData);
            localStorage.setItem('mm_custom_templates', JSON.stringify(customs));
            return true;
        } catch (e) { return false; }
    },

    deleteCustomTemplate(id) {
        try {
            let customs = this.getCustomTemplates();
            customs = customs.filter(t => t.map_id !== id);
            localStorage.setItem('mm_custom_templates', JSON.stringify(customs));
            return true;
        } catch (e) { return false; }
    },

    async getManifest() {
        await this.loadDefaults();
        const allTemplates = [...this.defaults, ...this.getCustomTemplates()];
        return allTemplates.map(t => ({
            id: t.map_id,
            title: t.meta?.title || "Untitled Template",
            desc: t.meta?.notes || "A pre-configured mapstate.",
            target_type: t.meta?.target_type || "any",
            nodes: t.nodes?.length || 0,
            isCustom: !this.defaults.find(d => d.map_id === t.map_id)
        }));
    },

    async getTemplateData(id) {
        await this.loadDefaults();
        const allTemplates = [...this.defaults, ...this.getCustomTemplates()];
        const tpl = allTemplates.find(t => t.map_id === id);
        if (!tpl) throw new Error(`Template ${id} not found.`);
        return JSON.parse(JSON.stringify(tpl));
    },

    loadLocalProjects() {
        try {
            const rawProjects = localStorage.getItem("mm_projects");
            const projects = rawProjects ? JSON.parse(rawProjects) : [];
            const rawLib = localStorage.getItem("mm_constellation_lib");
            const pages = rawLib ? JSON.parse(rawLib) : [];
            return { projects, pages };
        } catch (e) {
            console.error("loadLocalProjects failed:", e);
            return { projects: [], pages: [] };
        }
    },

    clearLocalProjects() {
        localStorage.removeItem("mm_projects");
        localStorage.removeItem("mm_constellation_lib");
        localStorage.removeItem("mm_core_state");
    }
};