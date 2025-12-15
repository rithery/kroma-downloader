"""FastAPI backend for KROMA: ក្រមា Downloader.

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
from typing import Any, Dict, Optional, List
from urllib.request import urlopen, Request

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

app = FastAPI(title="KROMA: ក្រមា API", version="1.0.0")

# Allow the frontend to connect from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHUNK_SIZE = 1024 * 256
MAX_CONCURRENT = max(int(os.getenv("MAX_CONCURRENT_DOWNLOADS", "3") or "3"), 1)
DOWNLOAD_GUARD = threading.BoundedSemaphore(value=MAX_CONCURRENT)
# Aggressive vocal removal with wide notches + center cut, then normalization/boost.
# anequalizer uses t=o (octave) and w=<bandwidth in octaves>; syntax must match ffmpeg 7.
KARAOKE_FILTERS = [
    "pan=stereo|c0=c0-c1|c1=c1-c0,"
    "highpass=f=120,"
    "lowpass=f=9500,"
    "anequalizer=f=350:t=o:w=1:g=-12,"
    "anequalizer=f=800:t=o:w=1:g=-24,"
    "anequalizer=f=1500:t=o:w=1:g=-28,"
    "anequalizer=f=3000:t=o:w=1:g=-22,"
    "anequalizer=f=5000:t=o:w=1:g=-10,"
    "dynaudnorm=f=250:g=10:p=0.95,"
    "volume=10dB,"
    "alimiter",
    # Fallback: hard center cancellation with broad band reject + gentle shaping
    "pan=stereo|c0=c0-c1|c1=c1-c0,"
    "highpass=f=140,"
    "lowpass=f=8800,"
    "anequalizer=f=250:t=o:w=2:g=-18,"
    "anequalizer=f=1200:t=o:w=2:g=-24,"
    "anequalizer=f=3200:t=o:w=2:g=-18,"
    "dynaudnorm=f=250:g=9:p=0.9,"
    "volume=9dB,"
    "alimiter",
    # Simplest fallback: center cut + light shaping (no notches) to avoid option issues
    "pan=stereo|c0=c0-c1|c1=c1-c0,highpass=f=140,lowpass=f=9000,volume=8dB,alimiter",
]

DEFAULT_MAX_PLAYLIST_ITEMS = max(int(os.getenv("MAX_PLAYLIST_ITEMS", "50") or "50"), 1)


DEFAULT_HTTP_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"}


def build_ydl_opts(
    temp_dir: str,
    format_id: str,
    convert_to_mp3: bool,
    allow_playlist: bool = False,
    merge_output_format: Optional[str] = None,
) -> Dict[str, Any]:
    """Configure yt-dlp options for metadata or download operations."""
    options: Dict[str, Any] = {
        "format": format_id,
        "outtmpl": os.path.join(temp_dir, "%(playlist_index)03d-%(id)s.%(ext)s" if allow_playlist else "%(id)s.%(ext)s"),
        "noplaylist": not allow_playlist,
        "yesplaylist": allow_playlist,
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,
        "http_headers": DEFAULT_HTTP_HEADERS,
    }
    if merge_output_format:
        options["merge_output_format"] = merge_output_format

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
    """Create a safe, ASCII filename for Content-Disposition headers."""
    safe_title = (
        re.sub(r'[\\/*?:"<>|]', "", title)
        .replace("\n", " ")
        .replace("\r", " ")
        .strip()
    )
    safe_title = safe_title or "download"
    # Force ASCII to avoid latin-1 header encoding failures
    safe_title_ascii = safe_title.encode("ascii", "ignore").decode("ascii").strip() or "download"
    safe_ext_ascii = ext.encode("ascii", "ignore").decode("ascii") or ext
    return f"{safe_title_ascii}.{safe_ext_ascii}"


def build_filename(template: Optional[str], info: Dict[str, Any], ext: str) -> str:
    """Apply a simple template to build a filename, then sanitize it."""
    if template:
        payload = {
            "title": info.get("title") or info.get("id") or "download",
            "uploader": info.get("uploader") or info.get("uploader_id") or "uploader",
            "id": info.get("id") or "id",
            "ext": ext,
            "resolution": info.get("resolution") or info.get("format") or "best",
            "format": info.get("format_id") or "format",
        }
        try:
            return sanitize_filename(template.format(**payload), ext)
        except Exception:
            pass
    return sanitize_filename(info.get("title") or info.get("id") or "download", ext)


def write_concat_file(files: List[str], temp_dir: str) -> str:
    """Create an ffmpeg concat input file for the provided paths."""
    list_path = os.path.join(temp_dir, "inputs.txt")
    with open(list_path, "w", encoding="utf-8") as handle:
        for path in files:
            safe_path = path.replace("'", "'\\''")
            handle.write(f"file '{safe_path}'\n")
    return list_path


def apply_karaoke_filter(source_path: str, output_path: str, copy_video: bool = True) -> None:
    """Apply karaoke filter with fallbacks; raises HTTPException on failure."""
    errors: list[str] = []
    for filt in KARAOKE_FILTERS:
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
        ]
        if copy_video:
            ffmpeg_cmd.extend(["-map", "0:v:0", "-c:v", "copy"])
        ffmpeg_cmd.extend(
            [
                "-map",
                "0:a:0",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-af",
                filt,
                "-ac",
                "2",
                "-movflags",
                "faststart",
                output_path,
            ]
        )
        try:
            ffmpeg_proc = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail="ffmpeg is required for karaoke mode") from exc
        if ffmpeg_proc.returncode == 0 and os.path.exists(output_path):
            return
        errors.append(ffmpeg_proc.stderr.strip() or "ffmpeg failed")
        try:
            os.remove(output_path)
        except FileNotFoundError:
            pass
    raise HTTPException(
        status_code=500,
        detail="Karaoke filter failed:\n" + "\n".join(errors[-2:]),
    )


def download_thumbnail(thumbnail_url: Optional[str]) -> Optional[str]:
    """Download thumbnail to a temp file for embedding as cover art."""
    if not thumbnail_url:
        return None
    try:
        tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        with urlopen(Request(thumbnail_url, headers={"User-Agent": "Mozilla/5.0"})) as resp:
            tmp_file.write(resp.read())
        tmp_file.close()
        return tmp_file.name
    except Exception:
        return None


@app.get("/")
async def root() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health")
async def healthcheck() -> Dict[str, Any]:
    """Return service readiness and tool versions."""
    ffmpeg_version = None
    try:
        proc = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=2)
        if proc.returncode == 0:
            ffmpeg_version = proc.stdout.splitlines()[0]
    except FileNotFoundError:
        ffmpeg_version = None
    except Exception:
        ffmpeg_version = "ffmpeg check failed"

    yt_dlp_version = getattr(yt_dlp, "__version__", None)
    return {
        "status": "ok",
        "yt_dlp": yt_dlp_version,
        "ffmpeg": ffmpeg_version or "missing",
        "max_concurrent_downloads": MAX_CONCURRENT,
        "default_max_playlist_items": DEFAULT_MAX_PLAYLIST_ITEMS,
    }


@app.get("/api/info")
async def fetch_info(
    url: str = Query(..., description="Video or audio URL"),
    allow_large_playlist: bool = Query(False, description="Allow fetching more than the default playlist cap."),
    max_items: int = Query(DEFAULT_MAX_PLAYLIST_ITEMS, ge=1, le=500, description="Max playlist items when allow_large_playlist is true."),
) -> Dict[str, Any]:
    """Return metadata for the provided URL using yt-dlp."""
    try:
        # First check if it's a playlist by extracting info without noplaylist
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True, "http_headers": DEFAULT_HTTP_HEADERS}) as ydl:
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
            videos: list[Dict[str, Any]] = []
            playlist_limit = max_items if allow_large_playlist else DEFAULT_MAX_PLAYLIST_ITEMS
            entries = info.get("entries", [])[:playlist_limit]  # Limit to cap unless explicitly overridden

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
            playlist_info["truncated"] = len(info.get("entries", [])) > len(entries)
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
    filename_template: Optional[str] = Query(None, description="Filename template e.g. {title}-{resolution}"),
    playlist_combine: Optional[str] = Query(
        None,
        description="For playlists: combine all items into a single file. Options: audio, video, zip (default).",
    ),
    karaoke: bool = Query(False, description="Attempt to remove vocals (music-only). Applies when re-encoding."),
):
    """
    Stream the selected format back to the client.

    - yt-dlp runs as a subprocess writing media bytes to stdout
    - A background thread tails stderr and logs parsed percentage updates
    - The response streams chunks immediately so the frontend progress bar tracks in real time
    """
    acquired = DOWNLOAD_GUARD.acquire(timeout=2)
    if not acquired:
        raise HTTPException(status_code=429, detail="Too many concurrent downloads, please wait.")

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True, "http_headers": DEFAULT_HTTP_HEADERS}) as sniff_ydl:
            pre_info = sniff_ydl.extract_info(url, download=False)

        is_playlist = pre_info.get("_type") == "playlist"
        combine_mode: Optional[str] = None
        if playlist_combine:
            normalized = playlist_combine.lower()
            if normalized not in {"audio", "video", "zip"}:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid playlist_combine option. Use one of: audio, video, zip.",
                )
            combine_mode = None if normalized == "zip" else normalized
        if karaoke and combine_mode == "audio":
            raise HTTPException(
                status_code=400,
                detail="Karaoke mode requires single MP4 playlist output.",
            )

        # Playlist downloads still use the temp-file + zip flow for now.
        if is_playlist:
            temp_dir = tempfile.mkdtemp(prefix="apsaraflow_")
            try:
                ydl_opts = build_ydl_opts(
                    temp_dir,
                    format,
                    convert_to_mp3 if not combine_mode else False,
                    allow_playlist=True,
                )

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.extract_info(url, download=True)

                downloaded_paths = sorted(
                    [
                        os.path.join(temp_dir, name)
                        for name in os.listdir(temp_dir)
                        if os.path.isfile(os.path.join(temp_dir, name))
                    ]
                )
                if not downloaded_paths:
                    raise HTTPException(status_code=500, detail="No playlist items were downloaded.")

                if combine_mode:
                    concat_list = write_concat_file(downloaded_paths, temp_dir)
                    if combine_mode == "audio":
                        output_ext = "mp3"
                        output_path = os.path.join(temp_dir, "playlist_merged.mp3")
                        ffmpeg_cmd = [
                            "ffmpeg",
                            "-y",
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            concat_list,
                            "-vn",
                            "-acodec",
                            "libmp3lame",
                            "-b:a",
                            "320k",
                        ]
                    else:  # combine_mode == "video"
                        output_ext = "mp4"
                        output_path = os.path.join(temp_dir, "playlist_merged.mp4")
                        ffmpeg_cmd = [
                            "ffmpeg",
                            "-y",
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            concat_list,
                            "-c:v",
                            "libx264",
                            "-preset",
                            "veryfast",
                            "-crf",
                            "22",
                            "-c:a",
                            "aac",
                            "-movflags",
                            "faststart",
                        ]

                    ffmpeg_cmd.append(output_path)
                    try:
                        ffmpeg_proc = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
                    except FileNotFoundError as exc:
                        raise HTTPException(status_code=500, detail="ffmpeg is required for playlist merging") from exc

                    if ffmpeg_proc.returncode != 0:
                        stderr = ffmpeg_proc.stderr.strip() or "FFmpeg failed to merge playlist."
                        raise HTTPException(status_code=500, detail=stderr)

                    if not os.path.exists(output_path):
                        raise HTTPException(status_code=500, detail="Merged playlist output not created.")

                    final_path = output_path
                    if karaoke and combine_mode == "video":
                        karaoke_path = os.path.join(temp_dir, "playlist_karaoke.mp4")
                        apply_karaoke_filter(output_path, karaoke_path, copy_video=True)
                        final_path = karaoke_path

                    safe_name = sanitize_filename(
                        build_filename(filename_template, pre_info, output_ext), output_ext
                    )
                    media_type = "audio/mpeg" if combine_mode == "audio" else "video/mp4"
                    background = BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
                    return FileResponse(
                        path=final_path,
                        media_type=media_type,
                        filename=safe_name,
                        background=background,
                    )

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

        # Single video/audio path
        formats = pre_info.get("formats") or []
        # Support combined selectors like "137+bestaudio"
        selected_format = next((f for f in formats if f.get("format_id") == format), None)
        base_format = selected_format
        if selected_format is None and "+" in format:
            base_id = format.split("+", 1)[0]
            base_format = next((f for f in formats if f.get("format_id") == base_id), None)

        if base_format is None and selected_format is None and "+" not in format:
            raise HTTPException(
                status_code=400,
                detail=f"Format '{format}' not available for this video. Refresh formats and pick another quality.",
            )

        ext = "mp3" if convert_to_mp3 else ((base_format or selected_format).get("ext") if (base_format or selected_format) else "bin")
        filename = build_filename(filename_template, {**pre_info, **(base_format or selected_format or {})}, ext)

        # If the selected format is video-only or requires merging (e.g., 1080p DASH),
        # download to disk and let yt-dlp/ffmpeg handle muxing, then serve the file.
        needs_merge = False
        is_audio_only = False
        if karaoke and convert_to_mp3:
            raise HTTPException(status_code=400, detail="Karaoke mode requires MP4 video output.")
        if not convert_to_mp3:
            if "+" in format:
                needs_merge = True
            elif base_format and base_format.get("vcodec") and (not base_format.get("acodec") or base_format.get("acodec") == "none"):
                needs_merge = True
            elif base_format and (not base_format.get("vcodec") or base_format.get("vcodec") == "none"):
                is_audio_only = True
            if karaoke:
                needs_merge = True  # force file flow so we can filter audio

        # MP3 conversion: use temp files so we can surface errors cleanly.
        if convert_to_mp3:
            temp_dir = tempfile.mkdtemp(prefix="apsaraflow_mp3_")
            try:
                ydl_opts = build_ydl_opts(temp_dir, format, False, allow_playlist=False)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)

                requested = (info.get("requested_downloads") or [{}])[0]
                source_path = requested.get("filepath") or requested.get("_filename")
                if not source_path:
                    source_path = os.path.join(
                        temp_dir, f"{info.get('id')}.{requested.get('ext') or info.get('ext') or 'bin'}"
                    )
                if not os.path.exists(source_path):
                    raise HTTPException(status_code=500, detail="Downloaded file missing before conversion.")

                output_path = os.path.join(temp_dir, "output.mp3")
                ffmpeg_cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    source_path,
                    "-vn",
                    "-acodec",
                    "libmp3lame",
                    "-b:a",
                    "320k",
                ]
                ffmpeg_cmd.append(output_path)
                try:
                    ffmpeg_proc = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
                except FileNotFoundError as exc:
                    raise HTTPException(status_code=500, detail="ffmpeg is required for MP3 conversion") from exc

                if ffmpeg_proc.returncode != 0:
                    err_msg = ffmpeg_proc.stderr.strip() or "FFmpeg failed to convert audio."
                    raise HTTPException(status_code=500, detail=err_msg)

                if not os.path.exists(output_path):
                    raise HTTPException(status_code=500, detail="MP3 output not created.")

                safe_name = sanitize_filename(filename if filename.endswith(".mp3") else f"{filename.rsplit('.',1)[0]}.mp3", "mp3")
                background = BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
                return FileResponse(
                    path=output_path,
                    media_type="audio/mpeg",
                    filename=safe_name,
                    background=background,
                )
            except yt_dlp.utils.DownloadError as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=400, detail=str(exc))
            except HTTPException:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise
            except Exception as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=500, detail=str(exc))

        # Audio-only: download to file and return directly to avoid stdout issues with some HLS/DASH audio formats.
        if is_audio_only:
            if karaoke:
                raise HTTPException(status_code=400, detail="Karaoke mode requires a video format.")
            temp_dir = tempfile.mkdtemp(prefix="apsaraflow_audio_")
            try:
                ydl_opts = build_ydl_opts(temp_dir, format, False, allow_playlist=False)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)

                requested = (info.get("requested_downloads") or [{}])[0]
                output_path = requested.get("filepath") or requested.get("_filename")
                if not output_path:
                    output_path = os.path.join(
                        temp_dir, f"{info.get('id')}.{requested.get('ext') or info.get('ext') or 'webm'}"
                    )
                if not os.path.exists(output_path):
                    raise HTTPException(status_code=500, detail="Audio file was not created.")

                media_type = "audio/webm"
                guessed_ext = os.path.splitext(output_path)[1].lstrip(".") or "webm"
                if guessed_ext.lower() in ("m4a", "mp4", "m4v"):
                    media_type = "audio/mp4"

                safe_name = sanitize_filename(filename, guessed_ext)
                background = BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
                return FileResponse(
                    path=output_path,
                    media_type=media_type,
                    filename=safe_name,
                    background=background,
                )
            except yt_dlp.utils.DownloadError as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=400, detail=str(exc))
            except HTTPException:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise
            except Exception as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=500, detail=str(exc))

        if needs_merge:
            temp_dir = tempfile.mkdtemp(prefix="apsaraflow_mux_")
            try:
                ydl_opts = build_ydl_opts(temp_dir, format, False, allow_playlist=False, merge_output_format="mp4")
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)

                requested = (info.get("requested_downloads") or [{}])[0]
                output_path = requested.get("filepath") or requested.get("_filename")
                if not output_path:
                    output_path = os.path.join(
                        temp_dir, f"{info.get('id')}.{requested.get('ext') or info.get('ext') or 'mp4'}"
                    )
                if not os.path.exists(output_path):
                    # yt-dlp may place merged file at the root with merge_output_format
                    merged_guess = os.path.join(temp_dir, f"{info.get('id')}.mp4")
                    if os.path.exists(merged_guess):
                        output_path = merged_guess
                if not os.path.exists(output_path):
                    raise HTTPException(status_code=500, detail="Muxed video was not created.")

                final_path = output_path
                if karaoke:
                    karaoke_path = os.path.join(temp_dir, "karaoke.mp4")
                    apply_karaoke_filter(output_path, karaoke_path, copy_video=True)
                    final_path = karaoke_path

                safe_name = sanitize_filename(
                    filename if filename.endswith(".mp4") else f"{filename.rsplit('.', 1)[0]}.mp4",
                    "mp4",
                )
                background = BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
                return FileResponse(
                    path=final_path,
                    media_type="video/mp4",
                    filename=safe_name,
                    background=background,
                )
            except yt_dlp.utils.DownloadError as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=400, detail=str(exc))
            except HTTPException:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise
            except Exception as exc:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise HTTPException(status_code=500, detail=str(exc))

        # Streaming path (no conversion)
        if karaoke:
            raise HTTPException(
                status_code=400,
                detail="Karaoke mode requires MP4 merge path; pick a video format.",
            )
        content_type = "application/octet-stream"
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

        try:
            yt_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail="yt-dlp is not installed or not in PATH") from exc

        stream_process = yt_process
        cleanup_processes = [yt_process]

        # Drain stderr to avoid deadlock and capture errors.
        stderr_lines: list[str] = []

        def _drain_stderr():
            try:
                if yt_process.stderr:
                    for line in iter(yt_process.stderr.readline, b""):
                        if not line:
                            break
                        text = line.decode("utf-8", "ignore").strip()
                        if text:
                            stderr_lines.append(text)
                        # Keep only the last few lines to include in errors
                        if len(stderr_lines) > 20:
                            stderr_lines.pop(0)
            except Exception:
                pass

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

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
                        stderr_thread.join(timeout=1)
                        detail = "\n".join(stderr_lines[-6:]).strip() or f"yt-dlp exited with code {proc.returncode}"
                        print(f"[yt-dlp stderr] {detail}")  # surface server-side for debugging
                        raise HTTPException(status_code=500, detail=detail)
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
            "Content-Disposition": f'attachment; filename="{sanitize_filename(filename, ext)}"',
        }
        if content_length:
            headers["Content-Length"] = str(content_length)

        return StreamingResponse(
            stream_output(),
            media_type=content_type,
            headers=headers,
        )

    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - passthrough error handling
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if acquired:
            try:
                DOWNLOAD_GUARD.release()
            except Exception:
                pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
