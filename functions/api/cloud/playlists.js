const MAX_PLAYLIST_BYTES = 512 * 1024;
const JSON_HEADERS = {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet({ request, env }) {
    const auth = await authenticate(request, env);
    if (auth.response) return auth.response;

    const row = await env.CLOUD_SYNC_DB.prepare(
        'SELECT data, updated_at, byte_size FROM cloud_playlist_snapshots WHERE account_id = ?'
    )
        .bind(auth.accountId)
        .first();

    return json({
        playlists: row?.data ? JSON.parse(row.data) : [],
        updatedAt: row?.updated_at || null,
        byteSize: row?.byte_size || 0,
    });
}

export async function onRequestPut({ request, env }) {
    const auth = await authenticate(request, env);
    if (auth.response) return auth.response;

    const body = await readJson(request);
    const playlists = Array.isArray(body?.playlists) ? body.playlists.map(minifyPlaylist) : null;
    if (!playlists) {
        return json({ error: 'Expected playlists array' }, 400);
    }

    const data = JSON.stringify(playlists);
    const byteSize = new TextEncoder().encode(data).byteLength;
    if (byteSize > MAX_PLAYLIST_BYTES) {
        return json({ error: `Playlist snapshot is too large (${byteSize} bytes)` }, 413);
    }

    const now = Date.now();
    await env.CLOUD_SYNC_DB.prepare(
        `INSERT INTO cloud_playlist_snapshots (account_id, data, updated_at, byte_size)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET data = excluded.data,
                                               updated_at = excluded.updated_at,
                                               byte_size = excluded.byte_size`
    )
        .bind(auth.accountId, data, now, byteSize)
        .run();

    return json({ ok: true, updatedAt: now, byteSize });
}

async function authenticate(request, env) {
    if (!env.CLOUD_SYNC_DB) {
        return { response: json({ error: 'Cloud sync database is not configured' }, 503) };
    }

    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const separatorIndex = token.indexOf('.');
    if (separatorIndex <= 0) {
        return { response: json({ error: 'Missing cloud sync token' }, 401) };
    }

    const accountId = token.slice(0, separatorIndex);
    const sessionToken = token.slice(separatorIndex + 1);
    const account = await env.CLOUD_SYNC_DB.prepare('SELECT token_hash FROM cloud_accounts WHERE id = ?')
        .bind(accountId)
        .first();

    if (!account || account.token_hash !== (await hashSecret(accountId, sessionToken))) {
        return { response: json({ error: 'Invalid cloud sync token' }, 401) };
    }

    return { accountId };
}

function minifyPlaylist(playlist = {}) {
    const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    return {
        id: playlist.id,
        name: playlist.name || playlist.title || '',
        cover: playlist.cover || null,
        description: playlist.description || '',
        createdAt: playlist.createdAt || Date.now(),
        updatedAt: playlist.updatedAt || Date.now(),
        numberOfTracks: playlist.numberOfTracks || tracks.length,
        images: Array.isArray(playlist.images) ? playlist.images.slice(0, 4) : [],
        tracks: tracks.map(minifyTrack),
    };
}

function minifyTrack(track = {}) {
    return {
        id: track.id,
        type: track.type || 'track',
        title: track.title || null,
        duration: track.duration || null,
        addedAt: track.addedAt || null,
        artist: track.artist ? { id: track.artist.id || null, name: track.artist.name || null } : null,
        artists: Array.isArray(track.artists)
            ? track.artists.slice(0, 4).map((artist) => ({ id: artist.id || null, name: artist.name || null }))
            : [],
        album: track.album
            ? {
                  id: track.album.id || null,
                  title: track.album.title || null,
                  cover: track.album.cover || null,
              }
            : null,
        image: track.image || track.cover || null,
        youtubeVideoId: track.youtubeVideoId || null,
        source: track.source || null,
        manifestSourceId: track.manifestSourceId || null,
    };
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function json(payload, status = 200) {
    return Response.json(payload, { status, headers: JSON_HEADERS });
}

async function hashSecret(accountId, secret) {
    const input = new TextEncoder().encode(`${accountId}:${secret}`);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
