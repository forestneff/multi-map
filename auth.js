import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, OAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    projectId: "meta-mind-sandbox",
    apiKey: "dummy-api-key-for-emulator"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
}

window.FirebaseAuth = auth;
window.FirebaseApp = app;

window.getFirebaseAuthToken = async () => {
    if (auth.currentUser) {
        return await auth.currentUser.getIdToken();
    }
    return null;
};

window.loginAnonymous = async () => {
    try {
        await signInAnonymously(auth);
        console.log("Logged in anonymously.");
    } catch (e) {
        console.error("Auth error", e);
    }
};

onAuthStateChanged(auth, user => {
    if (user) {
        console.log("User logged in:", user.uid);
    } else {
        console.log("User logged out");
        // Auto-login anonymously for ease of development in sandbox
        if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
            window.loginAnonymous();
        }
    }
});

window.Auth = {
    renderProfile: function(container) {
        if (!container) return;
        const user = auth.currentUser;
        let html = '';
        
        if (user && !user.isAnonymous) {
            html += `
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow flex flex-col gap-3">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xl overflow-hidden shadow-inner">
                        ${user.photoURL ? `<img src="${user.photoURL}" class="w-full h-full object-cover">` : (user.displayName || user.email ? (user.displayName || user.email)[0].toUpperCase() : 'U')}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-bold text-white truncate">${user.displayName || 'No Name Set'}</div>
                        <div class="text-xs text-slate-400 truncate">${user.email || 'No Email'}</div>
                        <div class="text-[10px] text-emerald-400 mt-0.5">Authenticated via ${user.providerData.length > 0 ? user.providerData[0].providerId : 'email'}</div>
                    </div>
                </div>
                <button onclick="window.Auth.logout()" class="w-full py-2 bg-slate-800 hover:bg-red-600 text-white text-xs font-bold rounded transition-colors border border-slate-700 mt-2">Logout</button>
            </div>
            `;
        } else {
            html += `
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow flex flex-col gap-4">
                <h3 class="text-sm font-bold text-white text-center">Sign In to Multi-Map</h3>
                
                <div class="flex flex-col gap-2">
                    <button onclick="window.Auth.loginGoogle()" class="w-full py-2 bg-white hover:bg-gray-100 text-gray-800 text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        Continue with Google
                    </button>
                    <button onclick="window.Auth.loginApple()" class="w-full py-2 bg-black hover:bg-slate-900 text-white text-xs font-bold rounded shadow transition-colors flex items-center justify-center gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                        Continue with Apple
                    </button>
                </div>
                
                <div class="relative flex py-2 items-center">
                    <div class="flex-grow border-t border-slate-700"></div>
                    <span class="flex-shrink-0 mx-4 text-slate-500 text-xs">or email</span>
                    <div class="flex-grow border-t border-slate-700"></div>
                </div>

                <input type="email" id="auth-email" placeholder="Email" class="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <input type="password" id="auth-pass" placeholder="Password" class="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-500">
                <div class="flex gap-2 mt-1">
                    <button onclick="window.Auth.login()" class="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors shadow">Login</button>
                    <button onclick="window.Auth.signup()" class="flex-1 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold rounded transition-colors shadow">Sign Up</button>
                </div>
            </div>
            `;
        }
        
        container.innerHTML = html;
    },

    renderDataManager: function(container) {
        if (!container) return;
        
        // Render data manager directly into the new drawer
        if (window.SC && window.SC.registry) {
            const dataEngine = window.SC.registry.get('data');
            if (dataEngine) {
                dataEngine.render(container, window.SC.kernel.state);
            }
        } else {
            container.innerHTML = '<div class="text-slate-500 text-center p-4">Library engine not loaded.</div>';
        }
    },
    
    login: async function() {
        const e = document.getElementById('auth-email').value;
        const p = document.getElementById('auth-pass').value;
        try {
            await signInWithEmailAndPassword(auth, e, p);
            this.renderProfile(document.getElementById('profile-content'));
        } catch (err) {
            alert(err.message);
        }
    },
    
    signup: async function() {
        const e = document.getElementById('auth-email').value;
        const p = document.getElementById('auth-pass').value;
        try {
            await createUserWithEmailAndPassword(auth, e, p);
            this.renderProfile(document.getElementById('profile-content'));
        } catch (err) {
            alert(err.message);
        }
    },
    
    logout: async function() {
        await signOut(auth);
        this.renderProfile(document.getElementById('profile-content'));
    },

    loginGoogle: async function() {
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            this.renderProfile(document.getElementById('profile-content'));
        } catch (err) {
            console.error(err);
            alert("Google login failed: " + err.message);
        }
    },

    loginApple: async function() {
        try {
            const provider = new OAuthProvider('apple.com');
            await signInWithPopup(auth, provider);
            this.renderProfile(document.getElementById('profile-content'));
        } catch (err) {
            console.error(err);
            alert("Apple login failed: " + err.message);
        }
    }
};
