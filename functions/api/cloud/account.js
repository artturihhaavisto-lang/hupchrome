const JSON_HEADERS = {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestPost({ request, env }) {
    if (!env.CLOUD_SYNC_DB) {
        return json({ error: 'Cloud sync database is not configured' }, 503);
    }

    const body = await readJson(request);
    const action = body?.action || 'create';

    if (action === 'create') {
        return createAccount(env.CLOUD_SYNC_DB);
    }
    if (action === 'login') {
        return login(env.CLOUD_SYNC_DB, body);
    }

    return json({ error: 'Unsupported account action' }, 400);
}

async function createAccount(db) {
    const accountId = `acct_${randomHex(12)}`;
    const recoveryKey = `mk_${randomHex(24)}`;
    const token = randomHex(32);
    const now = Date.now();

    await db
        .prepare(
            `INSERT INTO cloud_accounts (id, recovery_hash, token_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
        )
        .bind(accountId, await hashSecret(accountId, recoveryKey), await hashSecret(accountId, token), now, now)
        .run();

    return json({
        accountId,
        recoveryKey,
        sessionToken: `${accountId}.${token}`,
    });
}

async function login(db, body) {
    const accountId = String(body?.accountId || '');
    const recoveryKey = String(body?.recoveryKey || '');
    if (!accountId || !recoveryKey) {
        return json({ error: 'Missing accountId or recoveryKey' }, 400);
    }

    const account = await db.prepare('SELECT id, recovery_hash FROM cloud_accounts WHERE id = ?').bind(accountId).first();
    if (!account || account.recovery_hash !== (await hashSecret(accountId, recoveryKey))) {
        return json({ error: 'Invalid account credentials' }, 401);
    }

    const token = randomHex(32);
    await db
        .prepare('UPDATE cloud_accounts SET token_hash = ?, updated_at = ? WHERE id = ?')
        .bind(await hashSecret(accountId, token), Date.now(), accountId)
        .run();

    return json({ accountId, sessionToken: `${accountId}.${token}` });
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

function randomHex(bytes) {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(accountId, secret) {
    const input = new TextEncoder().encode(`${accountId}:${secret}`);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
