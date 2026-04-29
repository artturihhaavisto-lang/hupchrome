import { db } from '../db.js';

const ACCOUNT_ID_KEY = 'monochrome-cloudflare-account-id';
const SESSION_TOKEN_KEY = 'monochrome-cloudflare-session-token';

export const cloudflareSyncManager = {
    get sessionToken() {
        return localStorage.getItem(SESSION_TOKEN_KEY);
    },

    async createAccount() {
        const response = await fetch('/api/cloud/account', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'create' }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to create cloud account');
        this.storeSession(payload);
        return payload;
    },

    async signIn(accountId, recoveryKey) {
        const response = await fetch('/api/cloud/account', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'login', accountId, recoveryKey }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to sign in to cloud account');
        this.storeSession(payload);
        return payload;
    },

    signOut() {
        localStorage.removeItem(ACCOUNT_ID_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);
    },

    storeSession(payload) {
        localStorage.setItem(ACCOUNT_ID_KEY, payload.accountId);
        localStorage.setItem(SESSION_TOKEN_KEY, payload.sessionToken);
    },

    async pushPlaylists() {
        if (!this.sessionToken) throw new Error('Not signed in to Cloudflare sync');
        const playlists = await db.getPlaylists(true);
        const response = await fetch('/api/cloud/playlists', {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${this.sessionToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ playlists }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to push playlists');
        return payload;
    },

    async pullPlaylists() {
        if (!this.sessionToken) throw new Error('Not signed in to Cloudflare sync');
        const response = await fetch('/api/cloud/playlists', {
            headers: { authorization: `Bearer ${this.sessionToken}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to pull playlists');
        return payload;
    },
};
