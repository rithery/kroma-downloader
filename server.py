"""FastAPI backend for StreamGrab.

This service exposes two endpoints:
- GET /api/info     : returns metadata for a provided URL using yt-dlp
- GET /api/download : downloads a video (optionally converting to MP3)

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import os
import pathlib
import shutil
import tempfile
from typing import Any, Dict

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="StreamGrab API", version="1.0.0")

# Allow the frontend to connect from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_ydl_opts(temp_dir: str, format_id: str, convert_to_mp3: bool) -> Dict[str, Any]:
    """Configure youtube-dl options for metadata or download operations."""
    options: Dict[str, Any] = {
        "format": format_id,
        "outtmpl": os.path.join(temp_dir, "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,
    }

    if convert_to_mp3:
        # Convert the downloaded file to a high-quality mp3 via ffmpeg
        options["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "320",
            }
        ]

    return options


@app.get("/")
async def root() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/info")
async def fetch_info(url: str = Query(..., description="Video or audio URL")) -> Dict[str, Any]:
    """Return metadata for the provided URL using yt-dlp."""
    try:
        # First check if it's a playlist by extracting info without noplaylist
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            
        # Check if it's a playlist
        if info.get('_type') == 'playlist':
            # It's a playlist, return playlist info
            playlist_keys = [
                "id",
                "title", 
                "uploader",
                "uploader_id",
                "thumbnail",
                "description",
                "webpage_url",
            ]
            
            playlist_info = {key: info.get(key) for key in playlist_keys}
            playlist_info["video_count"] = len(info.get('entries', []))
            
            # Get detailed info for each video (limit to first 50 for performance)
            videos = []
            entries = info.get('entries', [])[:50]  # Limit to 50 videos
            
            for entry in entries:
                if entry:
                    try:
                        # Extract full info for each video
                        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as video_ydl:
                            video_info = video_ydl.extract_info(entry['url'], download=False)
                            
                        video_keys = [
                            "id",
                            "title",
                            "uploader",
                            "uploader_id", 
                            "thumbnail",
                            "duration",
                            "view_count",
                            "description",
                            "webpage_url",
                            "formats",
                        ]
                        videos.append({key: video_info.get(key) for key in video_keys if key in video_info or key == "formats"})
                    except Exception:
                        # Skip videos that fail to load
                        continue
            
            playlist_info["videos"] = videos
            playlist_info["_type"] = "playlist"
            return playlist_info
        else:
            # It's a single video
            keys = [
                "id",
                "title",
                "uploader",
                "uploader_id",
                "thumbnail",
                "duration",
                "view_count",
                "description",
                "webpage_url",
                "formats",
            ]
            return {key: info.get(key) for key in keys if key in info or key == "formats"}
            
    except Exception as exc:  # pragma: no cover - passthrough error handling
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/download")
async def download(
    url: str = Query(..., description="Video URL to download"),
    format: str = Query("best", description="yt-dlp format identifier"),
    convert_to_mp3: bool = Query(False, description="Convert output to MP3"),
):
    """Download the selected format and stream the resulting file back to the client."""
    temp_dir = tempfile.mkdtemp(prefix="streamgrab_")

    try:
        ydl_opts = build_ydl_opts(temp_dir, format, convert_to_mp3)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            result = ydl.extract_info(url, download=True)
            download_path = pathlib.Path(ydl.prepare_filename(result))

        if convert_to_mp3:
            download_path = download_path.with_suffix(".mp3")

        if not download_path.exists():
            raise HTTPException(status_code=500, detail="Download did not produce a file")

        media_type = "audio/mpeg" if convert_to_mp3 else "application/octet-stream"
        background = BackgroundTask(shutil.rmtree, temp_dir)
        return FileResponse(
            path=download_path,
            media_type=media_type,
            filename=download_path.name,
            background=background,
        )
    except yt_dlp.utils.DownloadError as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover - passthrough error handling
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
