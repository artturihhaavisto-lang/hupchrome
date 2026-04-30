import { handleCloudAccountOptions, handleCloudAccountRequest } from '../../../cloud-sync/account-handler.js';

export async function onRequestOptions() {
    return handleCloudAccountOptions();
}

export async function onRequestPost({ request, env }) {
    return handleCloudAccountRequest(request, env);
}
