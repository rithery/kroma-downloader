# KROMA: ក្រមា Downloader

A modern, Khmer-inspired web interface for `yt-dlp`.  
Features video quality selection, high-res MP3 conversion, and AI-powered metadata analysis.

## 🚀 Installation Guide

### Prerequisites
1. **Node.js** (v18+)
2. **Python** (v3.10+)
3. **FFmpeg** (Required for MP3 conversion)
   - Mac: `brew install ffmpeg`
   - Windows: Download binaries and add to PATH.

### 1. Backend Setup (The Engine)
The backend runs `yt-dlp` and `ffmpeg` locally to process videos.

```bash
# Install Python dependencies
pip install -r requirements.txt

# Start the server (runs on http://127.0.0.1:8000)
python server.py
```

### 2. Frontend Setup (The UI)
Open a new terminal window:

```bash
# Install Node dependencies
npm install

# Start the development server
npm run dev
```

## 🛠 Features

- **Video Downloads**: Supports 4K, 1080p, 720p, etc.
- **Audio Conversion**: Convert any video to High-Quality 320kbps MP3 on the fly.
- **AI Metadata**: Uses Gemini to generate professional summaries and tags.
- **Real-time Progress**: Accurate progress bars, speed, and ETA.

## ⚠️ Troubleshooting

**"Failed to fetch" / "Cannot reach backend"**  
Ensure `python server.py` is running and you are using `http://127.0.0.1:8000` in the settings.

**"FFmpeg not found"**  
If MP3 conversion fails, ensure `ffmpeg` is accessible from your terminal by typing `ffmpeg -version`.
