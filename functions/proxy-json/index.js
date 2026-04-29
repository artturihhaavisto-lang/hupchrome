export async function onRequestGet({ request }) {
    try {
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get('url');
        if (!target || !/^https:\/\/all-in-one\.cyrusna29\.workers\.dev\//.test(target)) {
            return new Response('Invalid proxy target', { status: 400 });
        }

        const upstream = await fetch(target);
        const headers = new Headers();
        headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
        headers.set('access-control-allow-origin', '*');
        headers.set('cache-control', 'no-store');

        return new Response(upstream.body, {
            status: upstream.status,
            headers,
        });
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
}
