import React, { useRef, useState } from 'react';
import { Icons } from './constants';
import { VideoInfo, PlaylistInfo, MediaInfo, FormatType, VideoFormat } from './types';
import { fetchVideoInfo, simulateDownload, DownloadProgress, updateApiConfig, getApiConfig } from './services/mockYtDlpService';
import { VideoCard } from './components/VideoCard';
import { FormatSelector } from './components/FormatSelector';
import { PlaylistCard } from './components/PlaylistCard';

const findRecommendedFormat = (formats: VideoFormat[]): string | null => {
  if (!formats?.length) return null;

  const videoWithAudio = formats
    .filter(f => f.type === FormatType.VIDEO && f.acodec && f.acodec !== 'none')
    .sort((a, b) => {
      const resA = parseInt(a.resolution) || 0;
      const resB = parseInt(b.resolution) || 0;
      if (resA !== resB) return resB - resA;
      return (b.filesize || 0) - (a.filesize || 0);
    });

  if (videoWithAudio.length) return videoWithAudio[0].format_id;

  const audioFormats = formats
    .filter(f => f.type === FormatType.AUDIO)
    .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

  if (audioFormats.length) return audioFormats[0].format_id;

  return formats[0].format_id;
};

function App() {
  // State
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<MediaInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [recommendedFormatId, setRecommendedFormatId] = useState<string | null>(null);
  const [convertToMp3, setConvertToMp3] = useState(false);
  const [selectedVideoFromPlaylist, setSelectedVideoFromPlaylist] = useState<VideoInfo | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [playlistMode, setPlaylistMode] = useState<'video' | 'audio'>('video');
  
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ speed: string; eta: string }>({ speed: '--', eta: '--' });
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);
  const lastLoggedPercent = useRef(0);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState(getApiConfig());

  const handleConfigChange = (changes: Partial<typeof config>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...changes };
      updateApiConfig(updated);
      return updated;
    });
  };

  // Handlers
  const handleVideoSelectFromPlaylist = (video: VideoInfo) => {
    setSelectedVideoFromPlaylist(video);
    const recommended = findRecommendedFormat(video.formats);
    setRecommendedFormatId(recommended);
    setSelectedFormat(recommended);
    setConvertToMp3(false);
    setPlaylistMode('video');
    setDownloadState('idle');
    setCustomTitle(video.title);
  };

  const handleFetchInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setSelectedFormat(null);
    setConvertToMp3(false);
    setPlaylistMode('video');
    setDownloadState('idle');
    setSelectedVideoFromPlaylist(null);
    setCustomTitle('');
    setRecommendedFormatId(null);

    try {
      const info = await fetchVideoInfo(url);
      setVideoInfo(info);
      setCustomTitle(info.title);

      if ('formats' in info) {
        const recommended = findRecommendedFormat(info.formats);
        setRecommendedFormatId(recommended);
        setSelectedFormat(recommended);
      } else {
        setRecommendedFormatId(null);
        setSelectedFormat(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch video info");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedFormat) return;
    
    setDownloadState('downloading');
    setDownloadLogs([]);
    lastLoggedPercent.current = 0;
    setProgress(0);
    setStats({ speed: 'Starting...', eta: 'Calculating...' });

    // Use selected video from playlist if available, otherwise use main videoInfo
    const currentVideoInfo = selectedVideoFromPlaylist || (videoInfo && 'formats' in videoInfo ? videoInfo : null);
    if (!currentVideoInfo) return;

    // Find the filesize if available for better progress bar
    const selectedFormatObj = currentVideoInfo.formats.find(f => f.format_id === selectedFormat);
    const expectedSize = selectedFormatObj?.filesize;

    try {
        const downloadTargetUrl = selectedVideoFromPlaylist ? selectedVideoFromPlaylist.webpage_url : url;
        const blob = await simulateDownload(
            selectedFormat, 
            downloadTargetUrl, 
            (data: DownloadProgress) => {
                setProgress(data.progress);
                setStats({ speed: data.speed, eta: data.eta });
                const pct = Math.round(data.progress);
                if (pct - lastLoggedPercent.current >= 10) {
                  setDownloadLogs(prev => [...prev.slice(-20), `[download] ${pct}%`]);
                  lastLoggedPercent.current = pct;
                }
            }, 
            expectedSize,
            convertToMp3
        );
        
        // Trigger file save
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        
        const ext = convertToMp3 ? 'mp3' : (selectedFormatObj?.ext || 'mp4');
        const titleSource = customTitle.trim() || currentVideoInfo.title;
        const sanitizedTitle = titleSource.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'video';
        link.download = `${sanitizedTitle}.${ext}`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);

        setDownloadState('completed');
        setDownloadLogs(prev => [...prev.slice(-20), '[done] Download complete']);
    } catch (e: any) {
        setError(e.message || "Download failed");
        setDownloadState('idle');
        return;
    }
    
    // Reset after a delay so the user can start another download
    setTimeout(() => {
        setDownloadState('idle');
        setProgress(0);
        setStats({ speed: '--', eta: '--' });
    }, 3000);
  };

  const handleDownloadPlaylist = async () => {
    if (!videoInfo || !('videos' in videoInfo)) return;

    setDownloadState('downloading');
    setDownloadLogs([]);
    lastLoggedPercent.current = 0;
    setProgress(0);
    setStats({ speed: 'Starting...', eta: 'Calculating...' });

    try {
      const playlistTitle = customTitle.trim() || videoInfo.title || 'playlist';
      const blob = await simulateDownload(
        playlistMode === 'audio' ? 'bestaudio' : 'best',
        url,
        (data: DownloadProgress) => {
          setProgress(data.progress);
          setStats({ speed: data.speed, eta: data.eta });
          const pct = Math.round(data.progress);
          if (pct - lastLoggedPercent.current >= 10) {
            setDownloadLogs(prev => [...prev.slice(-20), `[playlist] ${pct}%`]);
            lastLoggedPercent.current = pct;
          }
        },
        undefined,
        playlistMode === 'audio'
      );

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sanitizedTitle = playlistTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'playlist';
      link.href = blobUrl;
      link.download = `${sanitizedTitle}.${playlistMode === 'audio' ? 'mp3_bundle.zip' : 'video_bundle.zip'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setDownloadState('completed');
      setDownloadLogs(prev => [...prev.slice(-20), '[done] Playlist download complete']);
    } catch (e: any) {
      setError(e.message || 'Download failed');
      setDownloadState('idle');
      return;
    }

    setTimeout(() => {
      setDownloadState('idle');
      setProgress(0);
      setStats({ speed: '--', eta: '--' });
    }, 3000);
  };

  const handlePhotoDownload = async (imageUrl: string, title: string) => {
    try {
      setDownloadState('downloading');
      setStats({ speed: 'Fetching...', eta: '--' });
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sanitizedTitle = (title || 'photo').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.href = blobUrl;
      link.download = `${sanitizedTitle || 'photo'}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setDownloadState('completed');
    } catch (e: any) {
      setError(e.message || 'Download failed');
      setDownloadState('idle');
    }

    setTimeout(() => {
      setDownloadState('idle');
      setProgress(0);
      setStats({ speed: '--', eta: '--' });
    }, 2000);
  };

  const handleServerPhotoDownload = async (title: string) => {
    if (!config.useServer || !url) return;
    try {
      setDownloadState('downloading');
      setProgress(0);
      setStats({ speed: 'Starting...', eta: '--' });

      const blob = await simulateDownload(
        'best',
        url,
        (data: DownloadProgress) => {
          setProgress(data.progress);
          setStats({ speed: data.speed, eta: data.eta });
        },
        undefined,
        false
      );

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sanitizedTitle = (title || 'media').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.href = blobUrl;
      link.download = `${sanitizedTitle || 'media'}.bin`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      setDownloadState('completed');
    } catch (e: any) {
      setError(e.message || 'Download failed');
      setDownloadState('idle');
      return;
    }

    setTimeout(() => {
      setDownloadState('idle');
      setProgress(0);
      setStats({ speed: '--', eta: '--' });
    }, 3000);
  };

  const isServerConnectionError = error?.includes("Could not connect to backend");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-2 relative flex flex-col">
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Icons.Settings className="w-5 h-5 text-indigo-400" /> Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-white"
              >
                <Icons.X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <label className="flex items-center justify-between cursor-pointer group">
                  <span className="font-medium text-slate-200">
                    Use local backend (yt-dlp)
                  </span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={config.useServer}
                      onChange={(e) =>
                        handleConfigChange({ useServer: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </div>
                </label>
                <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                  Connect to your own API for real yt-dlp power. Turn off to
                  stay in fast mock mode.
                </p>
              </div>

              {config.useServer && (
                <div className="space-y-2 animate-in slide-in-from-top-2">
                  <label className="text-sm font-medium text-slate-300">
                    Backend API URL
                  </label>
                  <input
                    type="text"
                    value={config.serverUrl}
                    onChange={(e) =>
                      handleConfigChange({ serverUrl: e.target.value })
                    }
                    placeholder="http://localhost:8000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm"
                  />
                  <p className="text-xs text-slate-500">
                    Must support GET /api/info and GET /api/download endpoints
                    with CORS enabled.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Solidarity Banner */}
      <div className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.35)] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[#e00025] via-[#032ea1] to-[#e00025] opacity-80" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.08),transparent_30%)] animate-[pulse_8s_infinite]" />
        <div className="pointer-events-none absolute -inset-[35%] opacity-25 bg-[conic-gradient(from_45deg,rgba(255,255,255,0.25),transparent,rgba(255,255,255,0.12),transparent)] animate-[spin_28s_linear_infinite]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-25 animate-[pulse_5s_ease-in-out_infinite]" />
        <div className="max-w-4xl mx-auto px-4 py-2.5 flex flex-col sm:flex-row items-center justify-center gap-2 text-xs sm:text-sm text-slate-100 relative">
          <div className="flex items-center gap-2 animate-[fadeInUp_0.5s_ease]">
            <span className="text-lg sm:text-xl drop-shadow-sm animate-pulse">
              🇰🇭
            </span>
            <span className="font-semibold tracking-wide uppercase">
              Cambodia needs peace
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] bg-white/10 text-white px-2.5 py-0.5 rounded-full border border-white/15 animate-[fadeInUp_0.7s_ease]">
            ខ្មែរតែមួយ
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-12 z-40">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`relative w-10 h-10 rounded-xl overflow-hidden border border-slate-700 shadow-lg shadow-emerald-900/30 ${
                config.useServer
                  ? "bg-gradient-to-br from-emerald-500 via-cyan-500 to-indigo-500"
                  : "bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500"
              }`}
            >
              <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent_45%)]" />
              <div className="absolute inset-0 flex items-center justify-center text-white font-black tracking-tight text-lg drop-shadow-sm">
                AF
              </div>
            </div>
            <div className="flex flex-col leading-tight">
              <h1 className="font-bold text-xl tracking-tight text-white">
                ApsaraFlow
              </h1>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500"></span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-xs font-mono text-slate-400 border border-slate-800 px-2 py-1 rounded">
              Build 2024.10
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
              title="Settings"
            >
              <Icons.Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-10 flex-1 w-full">
        {/* URL Input Section */}
        <section className="mb-10 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Universal Video Downloader
          </h2>
          <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            Drop any YouTube link and ApsaraFlow will read the stream, surface
            clean presets, and deliver the file you need—powered by{" "}
            {config.useServer ? (
              <span className="text-green-400 font-mono mx-1">real yt-dlp</span>
            ) : (
              <span className="text-indigo-400 font-mono mx-1">
                our fast simulator
              </span>
            )}
            .
          </p>

          <form
            onSubmit={handleFetchInfo}
            className="relative max-w-2xl mx-auto group"
          >
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
              <Icons.Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a video or playlist URL..."
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl py-4 pl-12 pr-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-xl shadow-black/20"
            />
            <button
              type="submit"
              disabled={loading || !url}
              className="absolute right-2 top-2 bottom-2 bg-slate-800 hover:bg-indigo-600 text-white px-6 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                "Fetch info"
              )}
            </button>
          </form>

          {error && (
            <div
              className={`mt-4 flex flex-col items-center justify-center gap-2 py-3 px-6 rounded-lg inline-flex border max-w-md mx-auto
                ${
                  isServerConnectionError
                    ? "bg-amber-950/30 border-amber-900/50 text-amber-200"
                    : "bg-red-950/30 border-red-900/50 text-red-400"
                }`}
            >
              <div className="flex items-center gap-2">
                <Icons.AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span className="font-semibold text-sm text-left">{error}</span>
              </div>
              {isServerConnectionError && (
                <div className="text-xs text-amber-400/80 mt-1 bg-amber-900/40 p-2 rounded w-full text-left font-mono">
                  &gt; pip install fastapi uvicorn yt-dlp
                  <br />
                  &gt; python server.py
                </div>
              )}
            </div>
          )}
        </section>

        {/* Results Section */}
        {videoInfo && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">
            {"videos" in videoInfo ? (
              <PlaylistCard
                info={videoInfo}
                onVideoSelect={handleVideoSelectFromPlaylist}
                selectedVideoId={selectedVideoFromPlaylist?.id || null}
              />
            ) : (
              <VideoCard info={videoInfo} />
            )}

            {"videos" in videoInfo && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm text-slate-300 font-semibold">
                      Download entire playlist
                    </div>
                    <div className="text-xs text-slate-500">
                      Uses yt-dlp via{" "}
                      {config.useServer ? "your backend" : "the simulator"}.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700 rounded-xl p-1 text-xs text-slate-200">
                    <button
                      type="button"
                      onClick={() => setPlaylistMode("video")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                        playlistMode === "video"
                          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                          : "hover:bg-slate-700"
                      }`}
                    >
                      MP4 / Best Video
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaylistMode("audio")}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                        playlistMode === "audio"
                          ? "bg-pink-600 text-white shadow-md shadow-pink-600/30"
                          : "hover:bg-slate-700"
                      }`}
                    >
                      MP3 Only
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleDownloadPlaylist}
                  disabled={downloadState !== "idle" || !config.useServer}
                  className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-white
                    ${
                      downloadState !== "idle" || !config.useServer
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                        : "bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40"
                    }`}
                >
                  {downloadState === "downloading" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Playlist...</span>
                    </>
                  ) : (
                    <>
                      <Icons.Download className="w-4 h-4" />
                      <span>
                        {playlistMode === "audio"
                          ? "Download MP3 Playlist"
                          : "Download Video Playlist"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {(selectedVideoFromPlaylist ||
              ("formats" in videoInfo && !("videos" in videoInfo))) && (
              <>
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-white">
                      Choose quality
                    </h3>
                  </div>

                  {(() => {
                    const activeFormats =
                      selectedVideoFromPlaylist?.formats || videoInfo.formats;
                    const hasFormats = (activeFormats?.length || 0) > 0;
                    const isPhotoOnly =
                      hasFormats &&
                      activeFormats.every(
                        (f) =>
                          (f.vcodec === "none" || !f.vcodec) &&
                          (f.acodec === "none" || !f.acodec)
                      );
                    if (!hasFormats || isPhotoOnly) {
                      return (
                        <div className="text-sm text-amber-300 bg-amber-900/25 border border-amber-800/60 rounded-xl p-4">
                          No downloadable video/audio formats detected. Try a
                          direct video URL or enable Server Mode for broader
                          extractor support.
                        </div>
                      );
                    }

                    return (
                      <FormatSelector
                        formats={activeFormats}
                        selectedFormatId={selectedFormat}
                        recommendedFormatId={recommendedFormatId}
                        onSelect={setSelectedFormat}
                        disabled={convertToMp3}
                      />
                    );
                  })()}

                  {/* Action Bar */}
                  <div className="mt-8 pt-6 border-t border-slate-800">
                    <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between mb-6">
                      <div className="flex flex-col flex-1">
                        <label className="text-sm text-slate-300 font-medium mb-2">
                          Download name
                        </label>
                        <input
                          type="text"
                          value={customTitle}
                          onChange={(e) => setCustomTitle(e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition"
                          placeholder="Use original title or customize"
                        />
                        <span className="text-xs text-slate-500 mt-1">
                          Auto-filled from the source—tweak it or keep as-is.
                        </span>
                      </div>
                    </div>

                    {/* MP3 Toggle */}
                    <div className="flex items-center justify-between bg-slate-800/40 p-4 rounded-xl mb-6 border border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <div className="bg-pink-500/10 text-pink-400 p-2 rounded-lg">
                          <Icons.Music className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-semibold text-white">
                            {convertToMp3
                              ? "MP3 mode enabled"
                              : "Audio-only (MP3)"}
                          </div>
                          <div className="text-xs text-slate-400">
                            {convertToMp3
                              ? "Video picks locked while we prep audio"
                              : "320kbps export, needs FFmpeg"}
                          </div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={convertToMp3}
                          onChange={(e) => setConvertToMp3(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-600"></div>
                      </label>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-sm text-slate-500 hidden sm:block">
                        {config.useServer
                          ? "Downloads served from your local backend."
                          : "Powered by the built-in simulator."}
                      </div>

                      <button
                        onClick={handleDownload}
                        disabled={!selectedFormat || downloadState !== "idle"}
                        className={`w-full sm:w-auto px-8 py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all transform active:scale-95
                        ${
                          !selectedFormat || downloadState !== "idle"
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                            : convertToMp3
                            ? "bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-600/25 hover:shadow-pink-600/40"
                            : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40"
                        }`}
                      >
                        {downloadState === "idle" && (
                          <>
                            <Icons.Download className="w-5 h-5" />
                            <span>
                              {convertToMp3 ? "Download MP3" : "Download Video"}
                            </span>
                          </>
                        )}
                        {downloadState === "downloading" && (
                          <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>Processing... {Math.round(progress)}%</span>
                          </>
                        )}
                        {downloadState === "completed" && (
                          <>
                            <Icons.Check className="w-5 h-5" />
                            <span>Complete!</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar Visual with Stats */}
                  {downloadState === "downloading" && (
                    <div className="mt-6 space-y-3 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
                      <div className="flex justify-between items-end text-sm">
                        <span
                          className={`font-semibold ${
                            convertToMp3 ? "text-pink-400" : "text-indigo-400"
                          }`}
                        >
                          {convertToMp3
                            ? "Converting & Downloading..."
                            : "Downloading..."}
                        </span>
                        <span className="font-mono text-slate-300">
                          {Math.round(progress)}%
                        </span>
                      </div>

                      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ease-out relative ${
                            convertToMp3
                              ? "bg-gradient-to-r from-pink-500 to-rose-500"
                              : "bg-gradient-to-r from-indigo-500 to-purple-500"
                          }`}
                          style={{ width: `${progress}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
                        </div>
                      </div>

                      <div className="flex justify-between text-xs font-mono text-slate-500 pt-1">
                        <div className="flex gap-4">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                            {stats.speed}
                          </span>
                        </div>
                        <span className="text-slate-400">ETA: {stats.eta}</span>
                      </div>

                      {downloadLogs.length > 0 && (
                        <div className="mt-3 bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto space-y-1">
                          <div className="text-slate-500 uppercase tracking-wide text-[10px]">
                            yt-dlp output
                          </div>
                          {downloadLogs.map((line, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-slate-600">$</span>
                              <span className="whitespace-pre-wrap">
                                {line}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="mt-10 border-t border-slate-800/70 bg-slate-950/80 backdrop-blur px-4">
        <div className="max-w-4xl mx-auto py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-2 justify-center">
            <span className="text-slate-200 font-semibold">
              ApsaraFlow v2.0
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] border ${
                config.useServer
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-slate-700/40 text-slate-300 border-slate-600/60"
              }`}
            >
              {config.useServer ? "Server Mode" : "Demo Mode"}
            </span>
          </div>
          <div className="opacity-60">
            {config.useServer
              ? "Powered by your backend yt-dlp."
              : "Enable Server Mode in settings to use real yt-dlp."}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
