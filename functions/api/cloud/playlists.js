import {
    handleCloudPlaylistsGet,
    handleCloudPlaylistsOptions,
    handleCloudPlaylistsPut,
} from '../../../cloud-sync/playlists-handler.js';

export async function onRequestOptions() {
    return handleCloudPlaylistsOptions();
}

export async function onRequestGet({ request, env }) {
    return handleCloudPlaylistsGet(request, env);
}

export async function onRequestPut({ request, env }) {
    return handleCloudPlaylistsPut(request, env);
}
