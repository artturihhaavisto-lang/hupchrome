import { db } from '../db.js';

const ACCOUNT_ID_KEY = 'monochrome-cloudflare-account-id';
const USERNAME_KEY = 'monochrome-cloudflare-username';
const SESSION_TOKEN_KEY = 'monochrome-cloudflare-session-token';
const LAST_SYNC_AT_KEY = 'monochrome-cloudflare-last-sync-at';
const API_BASE_KEY = 'monochrome-cloudflare-api-base';
const RECOVERY_KEY_KEY = 'monochrome-cloudflare-recovery-key';

export const cloudflareSyncManager = {
    _initPromise: null,
    _pushTimer: null,
    _isApplyingRemoteState: false,

    get accountId() {
        return localStorage.getItem(ACCOUNT_ID_KEY);
    },

    get username() {
        return localStorage.getItem(USERNAME_KEY);
    },

    get sessionToken() {
        return localStorage.getItem(SESSION_TOKEN_KEY);
    },

    get recoveryKey() {
        return localStorage.getItem(RECOVERY_KEY_KEY);
    },

    get isSignedIn() {
        return !!this.accountId && !!this.sessionToken;
    },

    get apiBase() {
        const local = localStorage.getItem(API_BASE_KEY);
        if (local) return local.replace(/\/+$/, '');

        if (typeof __MONOCHROME_CLOUD_SYNC_API__ !== 'undefined' && __MONOCHROME_CLOUD_SYNC_API__) {
            return String(__MONOCHROME_CLOUD_SYNC_API__).replace(/\/+$/, '');
        }

        if (window.__MONOCHROME_CLOUD_SYNC_API__) {
            return String(window.__MONOCHROME_CLOUD_SYNC_API__).replace(/\/+$/, '');
        }

        return '';
    },

    getEndpoint(path) {
        return `${this.apiBase}${path}`;
    },

    async init() {
        if (this._initPromise) return this._initPromise;

        this.attachPlaylistListener();

        // Re-sync whenever the user switches back to this tab, so changes made
        // on another browser/device are picked up without a full page reload.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isSignedIn) {
                this.syncWithRemote().catch((err) =>
                    console.warn('[Cloudflare Sync] Visibility re-sync failed:', err)
                );
            }
        });

        this._initPromise = this.bootstrap().catch((error) => {
            console.error('[Cloudflare Sync] Bootstrap failed:', error);
        });
        return this._initPromise;
    },

    /**
     * Merges local and remote playlists by `updatedAt` timestamp.
     * - Playlists only on one side are kept.
     * - When both sides have the same playlist (by id/uuid), the newer one wins.
     * Returns the merged array and whether the local side had newer data.
     */
    mergePlaylists(localPlaylists, remotePlaylists) {
        const merged = new Map();

        for (const p of remotePlaylists) {
            merged.set(p.uuid || p.id, { ...p });
        }

        let localHasNewer = false;
        for (const p of localPlaylists) {
            const key = p.uuid || p.id;
            const remote = merged.get(key);
            if (!remote) {
                // Local-only playlist — keep it and push later
                merged.set(key, { ...p });
                localHasNewer = true;
            } else {
                const localTs = Number(p.updatedAt || 0);
                const remoteTs = Number(remote.updatedAt || 0);
                
                // Track union merge logic
                const mergedTracks = [];
                const seenTrackIds = new Set();
                
                // Keep the order of the newer playlist as the base
                const basePlaylist = localTs > remoteTs ? p : remote;
                const otherPlaylist = localTs > remoteTs ? remote : p;

                for (const track of basePlaylist.tracks || []) {
                    if (!seenTrackIds.has(track.id)) {
                        mergedTracks.push(track);
                        seenTrackIds.add(track.id);
                    }
                }
                
                let addedAny = false;
                for (const track of otherPlaylist.tracks || []) {
                    if (!seenTrackIds.has(track.id)) {
                        mergedTracks.push(track);
                        seenTrackIds.add(track.id);
                        addedAny = true;
                    }
                }

                // Push if local was newer OR if local was older but contained unique tracks not in remote
                if (localTs > remoteTs || (basePlaylist === remote && addedAny)) {
                    localHasNewer = true;
                }

                merged.set(key, { 
                    ...basePlaylist, 
                    tracks: mergedTracks,
                    updatedAt: Math.max(localTs, remoteTs)
                });
            }
        }

        return { merged: Array.from(merged.values()), localHasNewer };
    },

    async bootstrap() {
        if (!this.isSignedIn) return;
        await this.syncWithRemote();
    },

    /**
     * Pulls remote playlists, merges with local by updatedAt, and pushes back
     * if local had newer data.  Safe to call at any time (idempotent).
     */
    async syncWithRemote() {
        if (!this.isSignedIn) return;

        const [localPlaylists, payload] = await Promise.all([
            db.getPlaylists(true),
            this.pullPlaylists(),
        ]);

        const remotePlaylists = Array.isArray(payload?.playlists) ? payload.playlists : [];

        if (remotePlaylists.length === 0 && localPlaylists.length > 0) {
            // Remote is empty — push everything local
            await this.pushPlaylists();
            return;
        }

        if (remotePlaylists.length === 0) return;

        const { merged, localHasNewer } = this.mergePlaylists(localPlaylists, remotePlaylists);

        // Apply merged state locally (replaces DB contents)
        await this.applyRemotePlaylists(merged, payload.updatedAt || null);

        // If we had newer local data, push the merged result back to the cloud
        // so the other browser gets it on its next sync.
        if (localHasNewer) {
            await this.pushPlaylists();
        }
    },

    async createAccount() {
        const url = new URL(this.getEndpoint('/api/cloud/account'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'create' }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to create cloud account');
        this.storeSession(payload);
        await this.bootstrap();
        return payload;
    },

    async register(username, password) {
        const url = new URL(this.getEndpoint('/api/cloud/account'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'register', username, password }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to register cloud sync account');
        this.storeSession(payload);
        await this.bootstrap();
        return payload;
    },

    async signIn(accountId, recoveryKey) {
        if (recoveryKey === undefined && typeof accountId === 'string' && accountId.includes(':')) {
            const [username, password] = accountId.split(':');
            return this.signInWithUsername(username, password);
        }

        const url = new URL(this.getEndpoint('/api/cloud/account'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'login', accountId, recoveryKey }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to sign in to cloud account');
        this.storeSession(payload);
        await this.bootstrap();
        return payload;
    },

    async signInWithUsername(username, password) {
        const url = new URL(this.getEndpoint('/api/cloud/account'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'login', username, password }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to sign in to cloud sync');
        this.storeSession(payload);
        await this.bootstrap();
        return payload;
    },

    signOut() {
        localStorage.removeItem(ACCOUNT_ID_KEY);
        localStorage.removeItem(USERNAME_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);
        localStorage.removeItem(LAST_SYNC_AT_KEY);
        localStorage.removeItem(RECOVERY_KEY_KEY);
        this.updateUI();
    },

    storeSession(payload) {
        if (payload.accountId) {
            localStorage.setItem(ACCOUNT_ID_KEY, payload.accountId);
        }
        if (payload.username) {
            localStorage.setItem(USERNAME_KEY, payload.username);
        }
        if (payload.sessionToken) {
            localStorage.setItem(SESSION_TOKEN_KEY, payload.sessionToken);
        }
        if (payload.recoveryKey) {
            localStorage.setItem(RECOVERY_KEY_KEY, payload.recoveryKey);
        }
        this.updateUI(payload);
    },

    attachPlaylistListener() {
        if (this._playlistListenerAttached) return;
        this._playlistListenerAttached = true;

        window.addEventListener('sync-playlist-change', () => {
            if (!this.isSignedIn || this._isApplyingRemoteState) return;
            this.schedulePush();
        });
    },

    schedulePush(delayMs = 800) {
        if (this._pushTimer) {
            window.clearTimeout(this._pushTimer);
        }

        this._pushTimer = window.setTimeout(async () => {
            this._pushTimer = null;
            try {
                await this.pushPlaylists();
            } catch (error) {
                console.error('[Cloudflare Sync] Failed to push playlists:', error);
            }
        }, delayMs);
    },

    async applyRemotePlaylists(playlists, updatedAt = null) {
        this._isApplyingRemoteState = true;
        try {
            await db.replacePlaylists(playlists);
            if (updatedAt) {
                localStorage.setItem(LAST_SYNC_AT_KEY, String(updatedAt));
            }
            window.dispatchEvent(new CustomEvent('library-changed'));
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        } finally {
            this._isApplyingRemoteState = false;
        }
    },

    async pushPlaylists() {
        if (!this.sessionToken) throw new Error('Not signed in to Cloudflare sync');
        const playlists = await db.getPlaylists(true);
        const url = new URL(this.getEndpoint('/api/cloud/playlists'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${this.sessionToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ playlists }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to push playlists');
        if (payload.updatedAt) {
            localStorage.setItem(LAST_SYNC_AT_KEY, String(payload.updatedAt));
        }
        return payload;
    },

    async pullPlaylists() {
        if (!this.sessionToken) throw new Error('Not signed in to Cloudflare sync');
        const url = new URL(this.getEndpoint('/api/cloud/playlists'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            headers: { authorization: `Bearer ${this.sessionToken}` },
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to pull playlists');
        return payload;
    },

    async clearCloudData() {
        if (!this.sessionToken) throw new Error('Not signed in to Cloudflare sync');
        const url = new URL(this.getEndpoint('/api/cloud/playlists'));
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.toString(), {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${this.sessionToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ playlists: [] }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw new Error(payload.error || 'Failed to clear cloud playlists');
        localStorage.setItem(LAST_SYNC_AT_KEY, String(payload.updatedAt || Date.now()));
        return payload;
    },

    getStatusText() {
        if (!this.isSignedIn) return 'Sign in to sync playlists between devices';
        const identity = this.username || this.accountId;
        return `Cloud sync connected as ${identity}`;
    },

    updateUI(payload = null) {
        const connectBtn = document.getElementById('auth-connect-btn');
        const signupBtn = document.getElementById('auth-github-btn');
        const usernameBtn = document.getElementById('auth-discord-btn');
        const emailToggleBtn = document.getElementById('toggle-email-auth-btn');
        const clearDataBtn = document.getElementById('auth-clear-cloud-btn');
        const statusText = document.getElementById('auth-status');
        const helperText = document.getElementById('auth-helper-text');
        const privacyText = document.getElementById('auth-privacy-text');
        const recoveryBox = document.getElementById('cloud-sync-recovery');
        const recoveryValue = document.getElementById('cloud-sync-recovery-value');

        if (connectBtn) {
            connectBtn.textContent = this.isSignedIn ? 'Sign Out' : 'Create Account';
            connectBtn.classList.toggle('danger', this.isSignedIn);
        }

        if (signupBtn) {
            signupBtn.textContent = this.isSignedIn ? 'Sync Now' : 'Sign In';
            signupBtn.style.display = 'inline-block';
        }

        if (usernameBtn) {
            usernameBtn.textContent = this.isSignedIn ? 'Copy Recovery Key' : 'Register Username';
            usernameBtn.style.display = 'inline-block';
        }

        if (emailToggleBtn) {
            emailToggleBtn.textContent = this.isSignedIn ? 'Show Recovery Key' : 'Username / Password';
            emailToggleBtn.style.display = 'inline-block';
        }

        if (clearDataBtn) {
            clearDataBtn.style.display = this.isSignedIn ? 'block' : 'none';
        }

        if (statusText) {
            statusText.textContent = this.getStatusText();
        }

        if (helperText) {
            helperText.textContent = this.isSignedIn
                ? 'Your playlists will be pushed to Cloudflare and restored on other devices after sign-in.'
                : 'Create a cloud sync account or sign in with a username to sync playlists between devices.';
        }

        if (privacyText) {
            privacyText.textContent = this.isSignedIn
                ? 'Keep the recovery key somewhere safe. It is the only way to get back into this cloud sync account.'
                : 'This sync account is separate from the rest of the site. It only handles playlist saving and loading.';
        }

        const recoveryKey = payload?.recoveryKey || this.recoveryKey;
        if (recoveryBox && recoveryValue) {
            if (recoveryKey) {
                recoveryBox.style.display = 'block';
                recoveryValue.textContent = recoveryKey;
            } else {
                recoveryBox.style.display = 'none';
                recoveryValue.textContent = '';
            }
        }
    },
};

async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) {
        return {
            error: response.ok ? null : `Request failed with status ${response.status}`,
        };
    }

    try {
        return JSON.parse(text);
    } catch {
        return {
            error: text.slice(0, 200) || `Invalid response with status ${response.status}`,
        };
    }
}
