import { handleCloudAccountOptions, handleCloudAccountRequest } from './account-handler.js';
import {
    handleCloudPlaylistsGet,
    handleCloudPlaylistsOptions,
    handleCloudPlaylistsPut,
} from './playlists-handler.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/api/cloud/account') {
            if (request.method === 'OPTIONS') return handleCloudAccountOptions();
            if (request.method === 'POST') return handleCloudAccountRequest(request, env);
            return methodNotAllowed(['OPTIONS', 'POST']);
        }

        if (url.pathname === '/api/cloud/playlists') {
            if (request.method === 'OPTIONS') return handleCloudPlaylistsOptions();
            if (request.method === 'GET') return handleCloudPlaylistsGet(request, env);
            if (request.method === 'PUT') return handleCloudPlaylistsPut(request, env);
            return methodNotAllowed(['OPTIONS', 'GET', 'PUT']);
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    },
};

function methodNotAllowed(allowedMethods) {
    return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { allow: allowedMethods.join(', ') } }
    );
}
