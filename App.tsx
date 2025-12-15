import React, { useState } from 'react';
import { Icons } from './constants';
import { VideoInfo } from './types';
import { fetchVideoInfo, simulateDownload, DownloadProgress, updateApiConfig, getApiConfig } from './services/mockYtDlpService';
import { VideoCard } from './components/VideoCard';
import { FormatSelector } from './components/FormatSelector';
import { GeminiMetadata } from './components/GeminiMetadata';

function App() {
  // State
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [convertToMp3, setConvertToMp3] = useState(false);
  
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ speed: string; eta: string }>({ speed: '--', eta: '--' });

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState(getApiConfig());

  // Handlers
  const handleConfigChange = (newConfig: Partial<typeof config>) => {
      const updated = { ...config, ...newConfig };
      setConfig(updated);
      updateApiConfig(updated);
  };

  const handleFetchInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setVideoInfo(null);
    setSelectedFormat(null);
    setConvertToMp3(false);
    setDownloadState('idle');

    try {
      const info = await fetchVideoInfo(url);
      setVideoInfo(info);
    } catch (err: any) {
      setError(err.message || "Failed to fetch video info");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedFormat) return;
    
    setDownloadState('downloading');
    setProgress(0);
    setStats({ speed: 'Starting...', eta: 'Calculating...' });

    // Find the filesize if available for better progress bar
    const selectedFormatObj = videoInfo?.formats.find(f => f.format_id === selectedFormat);
    const expectedSize = selectedFormatObj?.filesize;

    try {
        const blob = await simulateDownload(
            selectedFormat, 
            url, 
            (data: DownloadProgress) => {
                setProgress(data.progress);
                setStats({ speed: data.speed, eta: data.eta });
            }, 
            expectedSize,
            convertToMp3
        );
        
        // Trigger file save
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        
        const ext = convertToMp3 ? 'mp3' : (selectedFormatObj?.ext || 'mp4');
        const sanitizedTitle = videoInfo?.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'video';
        link.download = `${sanitizedTitle}.${ext}`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);

        setDownloadState('completed');
    } catch (e: any) {
        setError(e.message || "Download failed");
        setDownloadState('idle');
    }
    
    // Reset after a delay
    if (downloadState !== 'idle') {
        setTimeout(() => {
            setDownloadState('idle');
            setProgress(0);
            setStats({ speed: '--', eta: '--' });
        }, 5000);
    }
  };

  const isServerConnectionError = error?.includes("Could not connect to backend");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20 relative">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Icons.Settings className="w-5 h-5 text-indigo-400"/> Settings
                </h3>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                    <Icons.X className="w-6 h-6"/>
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                    <label className="flex items-center justify-between cursor-pointer group">
                        <span className="font-medium text-slate-200">Server Mode (Real yt-dlp)</span>
                        <div className="relative">
                            <input 
                              type="checkbox" 
                              checked={config.useServer}
                              onChange={(e) => handleConfigChange({ useServer: e.target.checked })}
                              className="sr-only peer" 
                            />
                            <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                        </div>
                    </label>
                    <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                        When enabled, the app will try to connect to a backend API to run actual yt-dlp commands. 
                        Disable to use the built-in simulation mode.
                    </p>
                </div>

                {config.useServer && (
                   <div className="space-y-2 animate-in slide-in-from-top-2">
                      <label className="text-sm font-medium text-slate-300">Backend API URL</label>
                      <input 
                        type="text" 
                        value={config.serverUrl}
                        onChange={(e) => handleConfigChange({ serverUrl: e.target.value })}
                        placeholder="http://localhost:8000"
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm"
                      />
                      <p className="text-xs text-slate-500">
                        Must support GET /api/info and GET /api/download endpoints with CORS enabled.
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

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg text-white transition-colors duration-500 ${config.useServer ? 'bg-indigo-600' : 'bg-slate-700'}`}>
              <Icons.Download className="w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-white">Stream<span className="text-indigo-400">Grab</span></h1>
            {config.useServer && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/50 text-indigo-300 border border-indigo-500/30">REAL</span>
            )}
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden sm:block text-xs font-mono text-slate-500 border border-slate-800 px-2 py-1 rounded">
                v2024.10.1
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

      <main className="max-w-4xl mx-auto px-4 pt-10">
        
        {/* URL Input Section */}
        <section className="mb-10 text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Universal Video Downloader
            </h2>
            <p className="text-slate-400 mb-8 max-w-lg mx-auto">
              Paste a link below to extract video information and download in high quality using 
              {config.useServer ? <span className="text-green-400 font-mono mx-1">real yt-dlp</span> : <span className="text-indigo-400 font-mono mx-1">simulated yt-dlp</span>}.
            </p>
            
            <form onSubmit={handleFetchInfo} className="relative max-w-2xl mx-auto group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                <Icons.Search className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste YouTube URL here..." 
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
                  "Analyze"
                )}
              </button>
            </form>
            
            {error && (
              <div className={`mt-4 flex flex-col items-center justify-center gap-2 py-3 px-6 rounded-lg inline-flex border max-w-md mx-auto
                ${isServerConnectionError ? 'bg-amber-950/30 border-amber-900/50 text-amber-200' : 'bg-red-950/30 border-red-900/50 text-red-400'}`}>
                <div className="flex items-center gap-2">
                    <Icons.AlertTriangle className="w-5 h-5 flex-shrink-0" />
                    <span className="font-semibold text-sm text-left">{error}</span>
                </div>
                {isServerConnectionError && (
                    <div className="text-xs text-amber-400/80 mt-1 bg-amber-900/40 p-2 rounded w-full text-left font-mono">
                        &gt; pip install fastapi uvicorn yt-dlp<br/>
                        &gt; python server.py
                    </div>
                )}
              </div>
            )}
        </section>

        {/* Results Section */}
        {videoInfo && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">
            
            <VideoCard info={videoInfo} />

            <GeminiMetadata 
              videoTitle={videoInfo.title} 
              uploader={videoInfo.uploader} 
            />

            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">Select Format</h3>
                {selectedFormat && (
                  <span className="text-xs font-mono text-indigo-400 bg-indigo-950/50 px-2 py-1 rounded border border-indigo-900">
                    ID: {selectedFormat}
                  </span>
                )}
              </div>

              <FormatSelector 
                formats={videoInfo.formats} 
                selectedFormatId={selectedFormat}
                onSelect={setSelectedFormat}
              />

              {/* Action Bar */}
              <div className="mt-8 pt-6 border-t border-slate-800">
                 
                 {/* MP3 Toggle */}
                 <div className="flex items-center justify-between bg-slate-800/40 p-4 rounded-xl mb-6 border border-slate-700/50">
                    <div className="flex items-center gap-3">
                        <div className="bg-pink-500/10 text-pink-400 p-2 rounded-lg">
                            <Icons.Music className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="font-semibold text-white">Convert to MP3</div>
                            <div className="text-xs text-slate-400">High Resolution 320kbps (Requires FFmpeg)</div>
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
                        ? "Files are streamed directly from your local server." 
                        : "Files are generated by the simulator."}
                    </div>
                    
                    <button
                    onClick={handleDownload}
                    disabled={!selectedFormat || downloadState !== 'idle'}
                    className={`w-full sm:w-auto px-8 py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all transform active:scale-95
                        ${!selectedFormat || downloadState !== 'idle'
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : convertToMp3 
                            ? 'bg-pink-600 hover:bg-pink-500 text-white shadow-lg shadow-pink-600/25 hover:shadow-pink-600/40'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40'
                        }`}
                    >
                    {downloadState === 'idle' && (
                        <>
                            <Icons.Download className="w-5 h-5" />
                            <span>{convertToMp3 ? 'Download MP3' : 'Download Video'}</span>
                        </>
                    )}
                    {downloadState === 'downloading' && (
                        <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span>Processing... {Math.round(progress)}%</span>
                        </>
                    )}
                    {downloadState === 'completed' && (
                        <>
                            <Icons.Check className="w-5 h-5" />
                            <span>Complete!</span>
                        </>
                    )}
                    </button>
                 </div>
              </div>

              {/* Progress Bar Visual with Stats */}
              {downloadState === 'downloading' && (
                <div className="mt-6 space-y-3 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
                  <div className="flex justify-between items-end text-sm">
                    <span className={`font-semibold ${convertToMp3 ? 'text-pink-400' : 'text-indigo-400'}`}>
                        {convertToMp3 ? 'Converting & Downloading...' : 'Downloading...'}
                    </span>
                    <span className="font-mono text-slate-300">{Math.round(progress)}%</span>
                  </div>
                  
                  <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-200 ease-out relative ${
                          convertToMp3 
                          ? 'bg-gradient-to-r from-pink-500 to-rose-500' 
                          : 'bg-gradient-to-r from-indigo-500 to-purple-500'
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
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      
      {/* Footer Info */}
      <footer className="mt-20 border-t border-slate-900 py-8 text-center text-slate-600 text-sm">
        <p>StreamGrab v2.0 - {config.useServer ? 'Server Mode Active' : 'Demo Mode'}</p>
        {!config.useServer && (
            <p className="mt-1 opacity-50">
            To use real yt-dlp, enable Server Mode in settings.
            </p>
        )}
      </footer>
    </div>
  );
}

export default App;