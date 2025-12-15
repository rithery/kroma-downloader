"""FastAPI backend for ApsaraFlow.

This service exposes two endpoints:
- GET /api/info     : returns metadata for a provided URL using yt-dlp
- GET /api/download : downloads a video (optionally converting to MP3)

Run with:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
from typing import Any, Dict, IO, Optional

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

app = FastAPI(title="ApsaraFlow API", version="1.0.0")

# Allow the frontend to connect from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


PROGRESS_RE = re.compile(r"(\d{1,3}(?:\.\d+)?)%")
CHUNK_SIZE = 1024 * 256


def build_ydl_opts(temp_dir: str, format_id: str, convert_to_mp3: bool, allow_playlist: bool = False) -> Dict[str, Any]:
    """Configure yt-dlp options for metadata or download operations."""
    options: Dict[str, Any] = {
        "format": format_id,
        "outtmpl": os.path.join(temp_dir, "%(playlist_index)03d-%(id)s.%(ext)s" if allow_playlist else "%(id)s.%(ext)s"),
        "noplaylist": not allow_playlist,
        "yesplaylist": allow_playlist,
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


def sanitize_filename(title: str, ext: str) -> str:
    """Create a safe filename for Content-Disposition headers."""
    safe_title = re.sub(r"[^A-Za-z0-9_\-]+", "_", title).strip("_") or "download"
    return f"{safe_title}.{ext}"


def log_progress_stream(stderr: Optional[IO[bytes]]) -> None:
    """Read yt-dlp stderr and print clean progress lines to the terminal."""
    if stderr is None:
        return

    for raw_line in iter(stderr.readline, b""):
        try:
            text = raw_line.decode("utf-8", errors="ignore")
        except Exception:
            continue

        match = PROGRESS_RE.search(text)
        if match:
            print(f"[yt-dlp] Download progress: {match.group(1)}%")

    try:
        stderr.close()
    except Exception:
        pass


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
        if info.get("_type") == "playlist":
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
            playlist_info["video_count"] = len(info.get("entries", []))

            # Get detailed info for each video (limit to first 50 for performance)
            videos = []
            entries = info.get("entries", [])[:50]  # Limit to 50 videos

            for entry in entries:
                if entry:
                    try:
                        # Extract full info for each video
                        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as video_ydl:
                            video_info = video_ydl.extract_info(entry["url"], download=False)

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
    """
    Stream the selected format back to the client.

    - yt-dlp runs as a subprocess writing media bytes to stdout
    - A background thread tails stderr and logs parsed percentage updates
    - The response streams chunks immediately so the frontend progress bar tracks in real time
    """
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True}) as sniff_ydl:
            pre_info = sniff_ydl.extract_info(url, download=False)

        is_playlist = pre_info.get("_type") == "playlist"

        # Playlist downloads still use the temp-file + zip flow for now.
        if is_playlist:
            temp_dir = tempfile.mkdtemp(prefix="apsaraflow_")
            try:
                ydl_opts = build_ydl_opts(temp_dir, format, convert_to_mp3, allow_playlist=True)

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.extract_info(url, download=True)

                archive_base = temp_dir
                archive_path = shutil.make_archive(archive_base, "zip", temp_dir)
                filename = f"{pre_info.get('id', 'playlist')}_{'mp3' if convert_to_mp3 else 'videos'}.zip"

                def cleanup_playlist():
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    try:
                        os.remove(archive_path)
                    except FileNotFoundError:
                        pass

                background = BackgroundTask(cleanup_playlist)
                return FileResponse(
                    path=archive_path,
                    media_type="application/zip",
                    filename=filename,
                    background=background,
                )
            except yt_dlp.utils.DownloadError as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=400, detail=str(exc))
            except Exception as exc:  # pragma: no cover - passthrough error handling
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=500, detail=str(exc))

        # Single video/audio streaming path
        formats = pre_info.get("formats") or []
        selected_format = next((f for f in formats if f.get("format_id") == format), None)
        ext = "mp3" if convert_to_mp3 else (selected_format.get("ext") if selected_format else "bin")
        filename = sanitize_filename(pre_info.get("title") or pre_info.get("id") or "download", ext)

        content_type = "audio/mpeg" if convert_to_mp3 else "application/octet-stream"
        content_length = None
        if selected_format:
            content_length = selected_format.get("filesize") or selected_format.get("filesize_approx")

        cmd = [
            "yt-dlp",
            "-f",
            format,
            "-o",
            "-",
            "--no-playlist",
            "--no-warnings",
            "--newline",
            url,
        ]

        if convert_to_mp3:
            cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])

        try:
            yt_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail="yt-dlp is not installed or not in PATH") from exc

        # Start stderr watcher for progress logs
        threading.Thread(target=log_progress_stream, args=(yt_process.stderr,), daemon=True).start()

        stream_process = yt_process
        cleanup_processes = [yt_process]

        # Optional MP3 conversion via ffmpeg
        if convert_to_mp3:
            ffmpeg_cmd = [
                "ffmpeg",
                "-i",
                "pipe:0",
                "-vn",
                "-acodec",
                "libmp3lame",
                "-b:a",
                "320k",
                "-f",
                "mp3",
                "pipe:1",
            ]
            try:
                ffmpeg_process = subprocess.Popen(
                    ffmpeg_cmd,
                    stdin=yt_process.stdout,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    bufsize=0,
                )
            except FileNotFoundError as exc:
                yt_process.kill()
                raise HTTPException(status_code=500, detail="ffmpeg is required for MP3 conversion") from exc

            stream_process = ffmpeg_process
            cleanup_processes.append(ffmpeg_process)

            # Allow yt-dlp to receive SIGPIPE if ffmpeg exits
            if yt_process.stdout:
                yt_process.stdout.close()

        def stream_output():
            try:
                if stream_process.stdout is None:
                    raise HTTPException(status_code=500, detail="Stream unavailable from yt-dlp")

                for chunk in iter(lambda: stream_process.stdout.read(CHUNK_SIZE), b""):
                    if not chunk:
                        break
                    yield chunk

                # Wait for subprocesses to finish to catch early failures
                for proc in cleanup_processes:
                    proc.wait(timeout=5)

                for proc in cleanup_processes:
                    if proc.returncode not in (0, None):
                        print(f"[yt-dlp] process exited with code {proc.returncode}")
                        break
            finally:
                for proc in cleanup_processes:
                    if proc.poll() is None:
                        proc.kill()
                    try:
                        if proc.stdout:
                            proc.stdout.close()
                    except Exception:
                        pass
                    try:
                        if proc.stderr:
                            proc.stderr.close()
                    except Exception:
                        pass

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
        }
        if content_length:
            headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_output(),
            media_type=content_type,
            headers=headers,
        )

    except Exception as exc:  # pragma: no cover - passthrough error handling
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
