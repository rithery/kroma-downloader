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
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:  # pragma: no cover - passthrough error handling
        raise HTTPException(status_code=400, detail=str(exc))

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
