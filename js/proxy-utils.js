export const getProxyUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    if (window.__tidalOriginExtension) return url;
    if (url.startsWith('blob:')) return url;
    const isLocalDev =
        typeof window !== 'undefined' &&
        (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost');
    if (url.startsWith('/proxy-audio?')) return url;
    if (url.startsWith('https://audio-proxy.binimum.org/')) return url;
    try {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/latest_version') || parsed.pathname.includes('/companion/videoplayback')) {
            return isLocalDev ? `/proxy-audio?url=${encodeURIComponent(url)}` : url;
        }
    } catch {}
    if (
        !isLocalDev &&
        (url.includes('.manifest.tidal.com/') ||
            url.includes('.audio.tidal.com/') ||
            url.includes('.audio.tidalhifi.com/'))
    ) {
        return url;
    }
    if (
        !isLocalDev &&
        (url.startsWith('https://streaming-qobuz-std.akamaized.net/') ||
            url.startsWith('https://amz-pr-fa.audio.tidal.com/'))
    ) {
        return url;
    }
    if (isLocalDev) {
        return `/proxy-audio?url=${encodeURIComponent(url)}`;
    }
    return `https://audio-proxy.binimum.org/proxy-audio?url=${encodeURIComponent(url)}`;
};
