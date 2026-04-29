#!/usr/bin/env python3

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

from ytmusicapi import YTMusic
from yt_dlp import YoutubeDL


HOST = os.environ.get("MONOCHROME_YTM_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("MONOCHROME_YTM_BRIDGE_PORT", "33123"))

YTM = YTMusic()


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=True).encode("utf-8")


def parse_duration_seconds(value):
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str) or not value:
        return 0
    if value.isdigit():
        return int(value)
    parts = value.split(":")
    if len(parts) < 2:
        return 0
    total = 0
    for part in parts:
        if not part.isdigit():
            return 0
        total = total * 60 + int(part)
    return total


def pick_best_audio(formats):
    candidates = []
    for fmt in formats or []:
        if fmt.get("vcodec") not in (None, "none"):
            continue
        if not fmt.get("url"):
            continue
        bitrate = float(fmt.get("abr") or fmt.get("tbr") or 0)
        ext = str(fmt.get("ext") or "").lower()
        score = bitrate
        if ext in ("m4a", "mp4"):
            score += 1000
        elif ext == "webm":
            score += 500
        candidates.append((score, fmt))

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1] if candidates else None


def normalize_search_result(item):
    video_id = item.get("videoId")
    artist_name = "YouTube Music"
    artist_id = None
    artists = item.get("artists") or []
    if artists:
        artist_name = artists[0].get("name") or artist_name
        artist_id = artists[0].get("id")

    thumbnails = item.get("thumbnails") or item.get("thumbnail") or []
    thumbnail = thumbnails[-1]["url"] if thumbnails else None

    return {
        "type": "video",
        "videoId": video_id,
        "title": item.get("title") or "Unknown Track",
        "author": artist_name,
        "authorId": artist_id,
        "lengthSeconds": item.get("duration_seconds") or parse_duration_seconds(item.get("duration")),
        "videoThumbnails": [{"url": thumbnail, "quality": "medium"}] if thumbnail else [],
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def send_json(self, payload, status=200):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        try:
            if parsed.path == "/health":
                self.send_json({"ok": True})
                return

            if parsed.path == "/search":
                query = (params.get("q") or [""])[0].strip()
                if not query:
                    self.send_json({"error": "missing q"}, status=400)
                    return
                results = YTM.search(query, filter="songs")
                items = [normalize_search_result(item) for item in results[:20] if item.get("videoId")]
                self.send_json(items)
                return

            if parsed.path == "/stream":
                video_id = (params.get("id") or [""])[0].strip()
                if not video_id:
                    self.send_json({"error": "missing id"}, status=400)
                    return

                with YoutubeDL(
                    {
                        "quiet": True,
                        "no_warnings": True,
                        "skip_download": True,
                        "format": "bestaudio/best",
                        "extract_flat": False,
                        "noplaylist": True,
                    }
                ) as ydl:
                    info = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)

                best = pick_best_audio(info.get("formats"))
                if not best or not best.get("url"):
                    self.send_json({"error": "no playable audio format"}, status=502)
                    return

                self.send_json(
                    {
                        "url": best["url"],
                        "format": best.get("ext"),
                        "bitrateKbps": best.get("abr") or best.get("tbr"),
                        "audioQuality": "HIGH",
                        "source": "youtube-music",
                        "videoId": video_id,
                    }
                )
                return

            if parsed.path == "/watch":
                video_id = (params.get("id") or [""])[0].strip()
                if not video_id:
                    self.send_json({"error": "missing id"}, status=400)
                    return
                playlist = YTM.get_watch_playlist(videoId=video_id, limit=25)
                tracks = playlist.get("tracks") or []
                items = [normalize_search_result(item) for item in tracks if item.get("videoId")]
                self.send_json(items)
                return

            self.send_json({"error": "not found"}, status=404)
        except Exception as error:
            self.send_json({"error": str(error)}, status=502)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"ytmusic-local-bridge listening on http://{HOST}:{PORT}", file=sys.stderr)
    server.serve_forever()


if __name__ == "__main__":
    main()
