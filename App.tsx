import React, { useEffect, useRef, useState } from 'react';
import { Icons } from './constants';
import { Logo } from './components/Logo';
import { VideoInfo, PlaylistInfo, MediaInfo, FormatType, VideoFormat } from './types';
import { fetchVideoInfo, simulateDownload, DownloadProgress, updateApiConfig, getApiConfig, PlaylistCombineMode } from './services/mockYtDlpService';
import { VideoCard } from './components/VideoCard';
import { FormatSelector } from './components/FormatSelector';
import { PlaylistCard } from './components/PlaylistCard';

const parseHeight = (format: VideoFormat): number => {
  const res = format.resolution?.toLowerCase() || '';
  const pMatch = res.match(/(\d{3,4})p/);
  if (pMatch) return parseInt(pMatch[1], 10);
  const xMatch = res.match(/x(\d{3,4})/);
  if (xMatch) return parseInt(xMatch[1], 10);
  return 0;
};

const findRecommendedFormat = (formats: VideoFormat[]): string | null => {
  if (!formats?.length) return null;

  // Prefer the highest resolution video; if it's video-only we'll auto-merge best audio.
  const videos = formats.filter(f => f.type === FormatType.VIDEO);
  if (videos.length) {
    const sorted = [...videos].sort((a, b) => {
      const heightDiff = parseHeight(b) - parseHeight(a);
      if (heightDiff !== 0) return heightDiff;
      const audioScoreA = a.acodec && a.acodec !== 'none' ? 1 : 0;
      const audioScoreB = b.acodec && b.acodec !== 'none' ? 1 : 0;
      if (audioScoreA !== audioScoreB) return audioScoreB - audioScoreA;
      const sizeA = a.filesize ?? a.filesize_approx ?? 0;
      const sizeB = b.filesize ?? b.filesize_approx ?? 0;
      return sizeB - sizeA;
    });
    return sorted[0]?.format_id || null;
  }

  // Fallback to best audio-only if no video streams
  const audioFormats = formats
    .filter(f => f.type === FormatType.AUDIO)
    .sort((a, b) => {
      const sizeA = a.filesize ?? a.filesize_approx ?? 0;
      const sizeB = b.filesize ?? b.filesize_approx ?? 0;
      return sizeB - sizeA;
    });

  if (audioFormats.length) return audioFormats[0].format_id;

  return formats[0].format_id;
};

const formatFilename = (
  template: string | undefined,
  info: { title?: string; uploader?: string; resolution?: string; formatId?: string; id?: string },
  fallback: string,
  ext: string
) => {
  const baseTemplate = template?.trim() || '{title}';
  const safeExt = ext.startsWith('.') ? ext.slice(1) : ext;
  const replacements: Record<string, string> = {
    title: info.title || fallback,
    uploader: info.uploader || 'uploader',
    resolution: info.resolution || 'best',
    format: info.formatId || 'format',
    id: info.id || 'id',
    ext: safeExt,
  };

  let name = baseTemplate;
  Object.entries(replacements).forEach(([key, value]) => {
    const regex = new RegExp(`{${key}}`, 'gi');
    name = name.replace(regex, value);
  });

  // Keep unicode, spaces, dashes; strip only characters disallowed by common filesystems
  name = name
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/[\u0000-\u001F]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) name = fallback;

  if (!name.toLowerCase().endsWith(`.${safeExt.toLowerCase()}`)) {
    return `${name}.${safeExt}`;
  }
  return name;
};

const SETTINGS_ENABLED = true;
const AppStatus = {
  IDLE: 'IDLE',
  BUSY: 'BUSY',
} as const;

const STORAGE_KEYS = {
  prefs: 'kroma_prefs_v1',
  recentUrls: 'kroma_recent_urls_v1',
  recentDownloads: 'kroma_recent_downloads_v1',
};

const PLAYLIST_PAGE_SIZE = 50;
const MAX_PLAYLIST_FETCH = 500;

const SUPPORTED_SITES = [
  { name: 'YouTube', patterns: ['youtube.com', 'youtu.be'] },
  // { name: 'TikTok', patterns: ['tiktok.com'] },
  // { name: 'Vimeo', patterns: ['vimeo.com'] },
  // { name: 'Twitter / X', patterns: ['twitter.com', 'x.com'] },
  // { name: 'Instagram', patterns: ['instagram.com'] },
  // { name: 'Reddit', patterns: ['reddit.com'] },
  // { name: 'Facebook', patterns: ['facebook.com', 'fb.watch'] },
];

type UrlInsight =
  | { state: 'idle'; message: '' }
  | { state: 'valid' | 'warn' | 'invalid'; message: string; matchedSite?: string };

const analyzeUrl = (raw: string): UrlInsight => {
  const value = raw.trim();
  if (!value) return { state: 'idle', message: '' };

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let host = '';
  try {
    const parsed = new URL(normalized);
    host = parsed.hostname.toLowerCase();
  } catch {
    return {
      state: 'invalid',
      message: 'Enter a full link, e.g. https://youtube.com/watch?...',
    };
  }

  const matched = SUPPORTED_SITES.find((site) =>
    site.patterns.some((p) => host.includes(p))
  );

  if (matched) {
    const isPlaylist = /list=/.test(normalized) || /\/playlist/.test(normalized);
    return {
      state: 'valid',
      message: `${matched.name} link${isPlaylist ? ' (playlist detected)' : ''}`,
      matchedSite: matched.name,
    };
  }

  return {
    state: 'warn',
    message: 'May be unsupported. Works best with YouTube, TikTok, Vimeo, X, Instagram, Reddit.',
  };
};

const safeTrim = (val?: string | null) => (typeof val === 'string' ? val.trim() : '');

const pickBestAudioFormat = (formats: VideoFormat[]): VideoFormat | undefined => {
  return [...formats]
    .filter(f => f.type === FormatType.AUDIO || (!f.vcodec || f.vcodec === 'none'))
    .filter(f => f.acodec && f.acodec !== 'none')
    .sort((a, b) => {
      const sizeA = a.filesize ?? a.filesize_approx ?? 0;
      const sizeB = b.filesize ?? b.filesize_approx ?? 0;
      if (sizeA !== sizeB) return sizeB - sizeA;
      const brA = a.tbr ?? 0;
      const brB = b.tbr ?? 0;
      return brB - brA;
    })[0];
};

const buildFormatString = (
  formats: VideoFormat[],
  selectedFormatId: string,
  convertToMp3: boolean
): string => {
  const selected = formats.find(f => f.format_id === selectedFormatId);
  if (!selected) return selectedFormatId;

  // For MP3 conversion, prefer the best audio format regardless of current selection.
  if (convertToMp3) {
    if (selected.type === FormatType.AUDIO && selected.acodec && selected.acodec !== 'none') {
      return selected.format_id;
    }
    const bestAudio = pickBestAudioFormat(formats);
    return bestAudio ? bestAudio.format_id : 'bestaudio';
  }

  // If the chosen format already has audio, use as-is.
  if (selected.acodec && selected.acodec !== 'none') return selected.format_id;

  // If video-only, append the best audio stream for a merged result.
  const bestAudio = pickBestAudioFormat(formats);
  if (bestAudio) return `${selected.format_id}+${bestAudio.format_id}`;
  return `${selected.format_id}+bestaudio`;
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
  const [playlistLimit, setPlaylistLimit] = useState(PLAYLIST_PAGE_SIZE);
  const [karaokeMode, setKaraokeMode] = useState(false);
  const [loadingMorePlaylist, setLoadingMorePlaylist] = useState(false);
  
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'completed'>('idle');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{
    speed: string;
    eta: string;
    downloadedBytes?: number;
    totalBytes?: number;
  }>({
    speed: '--',
    eta: '--',
    downloadedBytes: 0,
    totalBytes: undefined,
  });
  const [downloadLogs, setDownloadLogs] = useState<string[]>([]);
  const lastLoggedPercent = useRef(0);
  const heroStatus = downloadState === 'idle' ? AppStatus.IDLE : AppStatus.BUSY;
  const [clipboardSuggestion, setClipboardSuggestion] = useState<string | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [urlInsight, setUrlInsight] = useState<UrlInsight>({ state: 'idle', message: '' });
  const [formatFilter, setFormatFilter] = useState<'all' | 'hdr' | 'av1' | 'vp9' | 'audio'>('all');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [recentDownloads, setRecentDownloads] = useState<
    { title: string; format: string; mp3: boolean; when: number; playlist: boolean }[]
  >([]);
  const [bundleExtras, setBundleExtras] = useState({ subtitles: false, chapters: false, thumbnail: true });

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

  // Hydrate persisted preferences and history.
  useEffect(() => {
    try {
      const savedPrefs = localStorage.getItem(STORAGE_KEYS.prefs);
      if (savedPrefs) {
        const parsed = JSON.parse(savedPrefs);
        if (typeof parsed.convertToMp3 === 'boolean') setConvertToMp3(parsed.convertToMp3);
        if (typeof parsed.karaokeMode === 'boolean') setKaraokeMode(parsed.karaokeMode);
        if (typeof parsed.formatFilter === 'string') setFormatFilter(parsed.formatFilter);
        if (typeof parsed.customTitle === 'string') setCustomTitle(parsed.customTitle);
        if (parsed.bundleExtras) {
          setBundleExtras((prev) => ({ ...prev, ...parsed.bundleExtras }));
        }
        if (parsed.config) {
          setConfig((prev) => {
            const merged = { ...prev, ...parsed.config };
            updateApiConfig(merged);
            return merged;
          });
        }
      }
      const savedUrls = localStorage.getItem(STORAGE_KEYS.recentUrls);
      if (savedUrls) {
        const parsed = JSON.parse(savedUrls);
        if (Array.isArray(parsed)) setRecentUrls(parsed.slice(0, 10));
      }
      const savedDownloads = localStorage.getItem(STORAGE_KEYS.recentDownloads);
      if (savedDownloads) {
        const parsed = JSON.parse(savedDownloads);
        if (Array.isArray(parsed)) setRecentDownloads(parsed.slice(0, 8));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.prefs,
        JSON.stringify({
          convertToMp3,
          karaokeMode,
          formatFilter,
          customTitle,
          config,
          bundleExtras,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [convertToMp3, karaokeMode, formatFilter, customTitle, config, bundleExtras]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.recentUrls, JSON.stringify(recentUrls.slice(0, 10)));
    } catch {
      // ignore storage errors
    }
  }, [recentUrls]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.recentDownloads, JSON.stringify(recentDownloads.slice(0, 8)));
    } catch {
      // ignore storage errors
    }
  }, [recentDownloads]);

  // Light clipboard watcher to surface a "paste" suggestion when empty.
  useEffect(() => {
    let cancelled = false;
    const peekClipboard = async () => {
      if (url.trim()) return;
      if (!navigator?.clipboard?.readText) return;
      try {
        const text = (await navigator.clipboard.readText())?.trim();
        if (cancelled) return;
        if (!text) {
          setClipboardSuggestion(null);
          return;
        }
        const insight = analyzeUrl(text);
        if (insight.state === 'valid' || insight.state === 'warn') {
          setClipboardSuggestion(text);
        } else {
          setClipboardSuggestion(null);
        }
      } catch {
        // ignore passive failures; surfaced on explicit paste attempt
      }
    };

    peekClipboard();
    const handleFocus = () => peekClipboard();
    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [url]);

  useEffect(() => {
    setUrlInsight(analyzeUrl(url));
  }, [url]);

  const rememberUrl = (value: string) => {
    if (!value) return;
    setRecentUrls((prev) => {
      const next = [value, ...prev.filter((v) => v !== value)];
      return next.slice(0, 10);
    });
  };

  const recordDownload = (payload: { title: string; format: string; mp3: boolean; playlist: boolean }) => {
    setRecentDownloads((prev) => {
      const next = [{ ...payload, when: Date.now() }, ...prev].slice(0, 8);
      return next;
    });
  };

  const filterFormatsForDisplay = (formats: VideoFormat[]) => {
    return formats;
  };

  const describeSize = (format?: VideoFormat) => {
    if (!format) return '--';
    const size = format.filesize || format.filesize_approx;
    if (size && size > 0) {
      const mb = size / (1024 * 1024);
      if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
      return `${mb.toFixed(1)} MB`;
    }
    return 'Unknown size';
  };

  const formatBytes = (bytes?: number) => {
    if (bytes === undefined || bytes === null || bytes < 0) return '--';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  // Handlers
  const handleVideoSelectFromPlaylist = (video: VideoInfo) => {
    if (selectedVideoFromPlaylist && selectedVideoFromPlaylist.id === video.id) {
      // Toggle off when clicking the same item
      setSelectedVideoFromPlaylist(null);
      setRecommendedFormatId(null);
      setSelectedFormat(null);
      setConvertToMp3(false);
      setPlaylistMode('video');
      setKaraokeMode(false);
      setDownloadState('idle');
      const fallbackTitle =
        videoInfo && 'title' in videoInfo ? videoInfo.title : '';
      setCustomTitle(fallbackTitle);
      return;
    }

    setSelectedVideoFromPlaylist(video);
    const recommended = findRecommendedFormat(video.formats);
    setRecommendedFormatId(recommended);
    setSelectedFormat(recommended);
    setConvertToMp3(false);
    setPlaylistMode('video');
    setKaraokeMode(false);
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
    setKaraokeMode(false);
    setDownloadState('idle');
    setSelectedVideoFromPlaylist(null);
    setPlaylistLimit(PLAYLIST_PAGE_SIZE);
    setCustomTitle('');
    setRecommendedFormatId(null);

    try {
      const info = await fetchVideoInfo(url, { maxItems: PLAYLIST_PAGE_SIZE });
      rememberUrl(url);
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

  const handleLoadMorePlaylist = async () => {
    if (!videoInfo || !('videos' in videoInfo)) return;
    if (loadingMorePlaylist) return;

    const currentCount = videoInfo.videos.length;
    const nextLimit = Math.min(
      playlistLimit + PLAYLIST_PAGE_SIZE,
      MAX_PLAYLIST_FETCH,
      videoInfo.video_count || MAX_PLAYLIST_FETCH
    );
    if (nextLimit <= currentCount) return;

    setLoadingMorePlaylist(true);
    setError(null);
    try {
      const updatedInfo = await fetchVideoInfo(url, {
        allowLargePlaylist: true,
        maxItems: nextLimit,
      });
      if ('videos' in updatedInfo) {
        setPlaylistLimit(nextLimit);
        setVideoInfo(updatedInfo);
        const selectedId = selectedVideoFromPlaylist?.id;
        if (selectedId) {
          const refreshedSelected = updatedInfo.videos.find((v) => v.id === selectedId) || null;
          setSelectedVideoFromPlaylist(refreshedSelected);
          if (refreshedSelected) {
            const stillHasSelectedFormat = refreshedSelected.formats.some((f) => f.format_id === selectedFormat);
            if (!stillHasSelectedFormat) {
              const recommended = findRecommendedFormat(refreshedSelected.formats);
              setRecommendedFormatId(recommended);
              setSelectedFormat(recommended);
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to load more videos");
    } finally {
      setLoadingMorePlaylist(false);
    }
  };

  const handlePasteFromClipboard = async (preferredValue?: string) => {
    setClipboardError(null);
    if (preferredValue) {
      setUrl(preferredValue);
      return;
    }
    if (!navigator?.clipboard?.readText) {
      setClipboardError('Clipboard not available here. Use Cmd/Ctrl + V.');
      return;
    }
    try {
      const text = (await navigator.clipboard.readText())?.trim();
      if (!text) {
        setClipboardError('Clipboard is empty.');
        return;
      }
      setUrl(text);
      setClipboardSuggestion(null);
    } catch (err: any) {
      setClipboardError(
        err?.message?.toLowerCase().includes('denied')
          ? 'Clipboard blocked by the browser. Click into the page and try again.'
          : 'Could not read clipboard. Use Cmd/Ctrl + V instead.'
      );
    }
  };

  const handleDownload = async () => {
    if (!selectedFormat) return;
    if (karaokeMode && convertToMp3) {
      setError("Karaoke requires MP4 (turn off MP3 mode).");
      return;
    }
    setDownloadState('downloading');
    setDownloadLogs([]);
    lastLoggedPercent.current = 0;
    setProgress(0);

    // Use selected video from playlist if available, otherwise use main videoInfo
    const currentVideoInfo = selectedVideoFromPlaylist || (videoInfo && 'formats' in videoInfo ? videoInfo : null);
    if (!currentVideoInfo) return;

    // Find the filesize if available for better progress bar
    const selectedFormatObj = currentVideoInfo.formats.find(f => f.format_id === selectedFormat);
    const formatForRequest = buildFormatString(
      currentVideoInfo.formats,
      selectedFormat,
      convertToMp3
    );
    const expectedSize = selectedFormatObj?.filesize;
    const karaokeEnabled = karaokeMode;
    setStats({ speed: 'Starting...', eta: 'Calculating...', downloadedBytes: 0, totalBytes: expectedSize });

    try {
        const downloadTargetUrl = selectedVideoFromPlaylist ? selectedVideoFromPlaylist.webpage_url : url;
        const blob = await simulateDownload(
            formatForRequest, 
            downloadTargetUrl, 
            (data: DownloadProgress) => {
                setProgress(data.progress);
                setStats({
                  speed: data.speed,
                  eta: data.eta,
                  downloadedBytes: data.downloadedBytes,
                  totalBytes: data.totalBytes || expectedSize,
                });
                const pct = Math.round(data.progress);
                if (pct - lastLoggedPercent.current >= 10) {
                  setDownloadLogs(prev => [...prev.slice(-20), `[download] ${pct}%`]);
                  lastLoggedPercent.current = pct;
                }
            }, 
            expectedSize,
            convertToMp3,
            { karaoke: karaokeEnabled }
        );
        
        // Trigger file save
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        
        const ext = convertToMp3 ? 'mp3' : (selectedFormatObj?.ext || 'mp4');
        const titleSource = safeTrim(customTitle) || currentVideoInfo.title;
        const downloadName = formatFilename(
          config.filenameTemplate,
          {
            title: titleSource,
            uploader: currentVideoInfo.uploader,
            resolution: selectedFormatObj?.resolution,
            formatId: selectedFormatObj?.format_id,
            id: currentVideoInfo.id,
          },
          'video',
          ext
        );
        link.download = downloadName;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);

        recordDownload({
          title: titleSource,
          format: formatForRequest,
          mp3: convertToMp3,
          playlist: false,
        });
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
        setStats({ speed: '--', eta: '--', downloadedBytes: 0, totalBytes: undefined });
    }, 3000);
  };

  const handleDownloadPlaylist = async () => {
    if (!videoInfo || !('videos' in videoInfo)) return;

    setDownloadState('downloading');
    setDownloadLogs([]);
    lastLoggedPercent.current = 0;
    setProgress(0);
    setStats({ speed: 'Starting...', eta: 'Calculating...', downloadedBytes: 0, totalBytes: undefined });

    try {
      const playlistTitle = safeTrim(customTitle) || videoInfo.title || 'playlist';
      const playlistCombine: PlaylistCombineMode = 'zip';
      const karaokeEnabled = false;
      const requestFormat = playlistMode === 'audio' ? 'bestaudio' : 'best';
      const convertFlag = playlistMode === 'audio';
      const blob = await simulateDownload(
        requestFormat,
        url,
        (data: DownloadProgress) => {
          setProgress(data.progress);
          setStats({
            speed: data.speed,
            eta: data.eta,
            downloadedBytes: data.downloadedBytes,
            totalBytes: data.totalBytes,
          });
          const pct = Math.round(data.progress);
          if (pct - lastLoggedPercent.current >= 10) {
            setDownloadLogs(prev => [...prev.slice(-20), `[playlist] ${pct}%`]);
            lastLoggedPercent.current = pct;
          }
        },
        undefined,
        convertFlag,
        { playlistCombine: playlistCombine as PlaylistCombineMode, karaoke: karaokeEnabled }
      );

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const ext =
        playlistCombine === 'audio'
          ? 'mp3'
          : playlistCombine === 'video'
          ? 'mp4'
          : playlistMode === 'audio'
          ? 'mp3_bundle.zip'
          : 'video_bundle.zip';
      const downloadName = formatFilename(
        config.filenameTemplate,
        {
          title: playlistTitle,
          uploader: videoInfo.uploader,
          resolution: playlistMode === 'audio' ? 'audio' : 'video',
          formatId: playlistMode === 'audio' ? 'bestaudio' : 'best',
          id: videoInfo.id,
        },
        'playlist',
        ext
      );
      link.href = blobUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      recordDownload({
        title: playlistTitle,
        format: requestFormat,
        mp3: convertFlag,
        playlist: true,
      });
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
      setStats({ speed: '--', eta: '--', downloadedBytes: 0, totalBytes: undefined });
    }, 3000);
  };

  const handlePhotoDownload = async (imageUrl: string, title: string) => {
    try {
      setDownloadState('downloading');
      setStats({ speed: 'Fetching...', eta: '--', downloadedBytes: 0, totalBytes: undefined });
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
      setStats({ speed: '--', eta: '--', downloadedBytes: 0, totalBytes: undefined });
    }, 2000);
  };

  const handleServerPhotoDownload = async (title: string) => {
    if (!config.useServer || !url) return;
    try {
      setDownloadState('downloading');
      setProgress(0);
      setStats({ speed: 'Starting...', eta: '--', downloadedBytes: 0, totalBytes: undefined });

      const blob = await simulateDownload(
        'best',
        url,
        (data: DownloadProgress) => {
          setProgress(data.progress);
          setStats({
            speed: data.speed,
            eta: data.eta,
            downloadedBytes: data.downloadedBytes,
            totalBytes: data.totalBytes,
          });
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
      setStats({ speed: '--', eta: '--', downloadedBytes: 0, totalBytes: undefined });
    }, 3000);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (downloadState === "idle" && selectedFormat) {
          handleDownload();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [downloadState, selectedFormat]);

  const isServerConnectionError = error?.includes("Could not connect to backend");

  return (
    <div className="min-h-screen bg-[#060815] text-slate-200 pb-2 relative flex flex-col">
      {/* Digital Weave Background */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(224,0,37,0.14),transparent_35%),radial-gradient(circle_at_90%_10%,rgba(3,46,161,0.18),transparent_40%),radial-gradient(circle_at_50%_80%,rgba(224,0,37,0.12),transparent_35%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px]" />
      </div>
      {/* Settings Modal */}
      {SETTINGS_ENABLED && showSettings && (
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

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  Filename template
                </label>
                <input
                  type="text"
                  value={config.filenameTemplate || "{title}"}
                  onChange={(e) =>
                    handleConfigChange({ filenameTemplate: e.target.value })
                  }
                  placeholder="{title}-{uploader}-{resolution}"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 text-sm font-mono"
                />
                <p className="text-xs text-slate-500">
                  Tokens: {"{title}"}, {"{uploader}"}, {"{resolution}"},{" "}
                  {"{format}"}. We sanitize unsafe characters automatically.
                </p>
              </div>
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
            <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-slate-700 shadow-lg shadow-emerald-900/30 bg-slate-900/80 flex items-center justify-center">
              <Logo className="w-10 h-10" />
            </div>
            <div className="flex flex-col leading-tight">
              <h1 className="font-bold text-xl tracking-tight text-white">
                KROMA
              </h1>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500"></span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-xs font-mono text-slate-200 border border-[#e00025]/30 px-2 py-1 rounded bg-[#e00025]/10">
              Build 2025.15
            </div>
            <span className="text-[11px] text-slate-200 px-2 py-1 border border-[#032ea1]/40 rounded-lg bg-[#032ea1]/10">
              Settings disabled
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pt-10 flex-1 w-full">
        {/* URL Input Section */}
        <section className="mb-10 text-center">
          <div
            className={`text-center mb-2 z-10 space-y-6 transition-all duration-700 ${
              heroStatus === AppStatus.IDLE
                ? "scale-100 opacity-100"
                : "scale-95 opacity-80"
            }`}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/80 border border-slate-700/50 backdrop-blur-md">
              <Icons.Layers className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-bold tracking-widest text-slate-300 uppercase">
                ទាញយកវីដេអូ Youtube
              </span>
            </div>
            <h1 className="text-6xl md:text-9xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-200 to-slate-500 drop-shadow-2xl">
              KROMA
            </h1>
          </div>
          <p className="text-slate-300 mb-8 max-w-lg mx-auto leading-relaxed">
            Drop any link and KROMA slices the stream, surfaces smart presets,
            and ships the exact file you want—powered by{" "}
            <span className="text-green-400 font-mono mx-1">yt-dlp</span>.
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
                "ស្វែងរក"
              )}
            </button>
          </form>

          <div className="mt-3 flex flex-col gap-2 items-center">
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => handlePasteFromClipboard()}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/70 text-xs text-slate-200 hover:border-indigo-500/60 hover:text-white transition-colors"
              >
                Paste from clipboard
              </button>
              {clipboardSuggestion && !url && (
                <button
                  type="button"
                  onClick={() => handlePasteFromClipboard(clipboardSuggestion)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs border border-emerald-700/50 transition-colors"
                >
                  Use detected link
                </button>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-[11px] text-slate-400">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">
                Supported: {SUPPORTED_SITES.map((s) => s.name).join(" • ")}
              </span>
              {urlInsight.state !== "idle" && (
                <span
                  className={`px-3 py-1 rounded-full border ${
                    urlInsight.state === "valid"
                      ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
                      : urlInsight.state === "warn"
                      ? "border-amber-700 bg-amber-900/30 text-amber-200"
                      : "border-red-800 bg-red-950/40 text-red-300"
                  }`}
                >
                  {urlInsight.message}
                </span>
              )}
              {clipboardError && (
                <span className="px-3 py-1 rounded-full border border-red-900 bg-red-950/40 text-red-300">
                  {clipboardError}
                </span>
              )}
            </div>
            {/* {recentUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-2 text-[11px]">
                {recentUrls.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setUrl(entry)}
                    className="px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900/70 text-slate-200 hover:border-indigo-500/60 hover:text-white transition-colors"
                  >
                    {entry.length > 42 ? `${entry.slice(0, 42)}…` : entry}
                  </button>
                ))}
              </div>
            )} */}
          </div>

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

        {recentDownloads.length > 0 && (
          <section className="mb-8">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-200">
                  Recent downloads
                </h3>
                <span className="text-[11px] text-slate-500">
                  {recentDownloads.length} saved
                </span>
              </div>
              <div className="space-y-2">
                {recentDownloads.map((item) => (
                  <div
                    key={`${item.title}-${item.when}`}
                    className="flex items-center justify-between text-xs bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2"
                  >
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="text-slate-100 font-semibold">
                        {item.title.length > 60
                          ? `${item.title.slice(0, 60)}…`
                          : item.title}
                      </span>
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                        <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700">
                          {item.format}
                        </span>
                        {item.mp3 && (
                          <span className="px-2 py-0.5 rounded-full bg-pink-700/30 border border-pink-600/50 text-pink-100">
                            MP3
                          </span>
                        )}
                        {item.playlist && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-700/25 border border-indigo-600/50 text-indigo-100">
                            Playlist
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(item.when).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Results Section */}
        {videoInfo && (
          <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">
            {"videos" in videoInfo ? (
              <PlaylistCard
                info={videoInfo}
                onVideoSelect={handleVideoSelectFromPlaylist}
                selectedVideoId={selectedVideoFromPlaylist?.id || null}
                truncated={
                  videoInfo.truncated ||
                  videoInfo.video_count > videoInfo.videos.length
                }
                onLoadMore={handleLoadMorePlaylist}
                loadingMore={loadingMorePlaylist}
                pageSize={PLAYLIST_PAGE_SIZE}
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
                      {config.useServer ? "your backend" : "the simulator"}. Download the whole list, or click any song/video below to grab it individually (and pick the exact quality) like a normal video.
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
                      onClick={() => {
                        setKaraokeMode(false);
                        setPlaylistMode("audio");
                      }}
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
                        {(() => {
                          if (!videoInfo) return null;
                          const activeFormats =
                            selectedVideoFromPlaylist?.formats ||
                            ("formats" in videoInfo ? videoInfo.formats : []);
                          const sel = activeFormats?.find(
                            (f) => f.format_id === selectedFormat
                          );
                          const titleSource =
                            safeTrim(customTitle) ||
                            selectedVideoFromPlaylist?.title ||
                            ("title" in videoInfo ? videoInfo.title : "");
                          const preview = formatFilename(
                            config.filenameTemplate,
                            {
                              title: titleSource,
                              uploader:
                                selectedVideoFromPlaylist?.uploader ||
                                ("uploader" in videoInfo
                                  ? videoInfo.uploader
                                  : undefined),
                              resolution: sel?.resolution,
                              formatId: sel?.format_id,
                              id:
                                selectedVideoFromPlaylist?.id ||
                                ("id" in videoInfo ? videoInfo.id : undefined),
                            },
                            "download",
                            convertToMp3 ? "mp3" : sel?.ext || "mp4"
                          );
                          return (
                            <div className="mt-2 inline-flex items-center gap-2 text-[11px] text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5">
                              <span className="text-slate-500">Preview:</span>
                              <span className="font-mono text-slate-200">
                                {preview}
                              </span>
                            </div>
                          );
                        })()}
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
                    <div className="flex items-center justify-between bg-slate-800/30 p-4 rounded-xl mb-6 border border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <div className="bg-indigo-500/10 text-indigo-300 p-2 rounded-lg">
                          <Icons.MicOff className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-semibold text-white">
                            Karaoke (music only)
                          </div>
                          <div className="text-xs text-slate-400">
                            Removes center vocals; requires MP4 output.
                          </div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={karaokeMode}
                          onChange={(e) => setKaraokeMode(e.target.checked)}
                          disabled={convertToMp3}
                        />
                        <div
                          className={`w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 ${
                            convertToMp3
                              ? "opacity-60 cursor-not-allowed"
                              : ""
                          }`}
                        ></div>
                      </label>
                    </div>

                    {/* Subtitles */}
                    <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icons.FileVideo className="w-4 h-4 text-indigo-300" />
                          <span className="text-sm font-semibold text-white">
                            Extras bundle
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Captions, chapters, cover
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-slate-200">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bundleExtras.subtitles}
                            onChange={(e) =>
                              setBundleExtras((prev) => ({
                                ...prev,
                                subtitles: e.target.checked,
                              }))
                            }
                          />
                          <span>Subtitles</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bundleExtras.chapters}
                            onChange={(e) =>
                              setBundleExtras((prev) => ({
                                ...prev,
                                chapters: e.target.checked,
                              }))
                            }
                          />
                          <span>Chapters</span>
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={bundleExtras.thumbnail}
                            onChange={(e) =>
                              setBundleExtras((prev) => ({
                                ...prev,
                                thumbnail: e.target.checked,
                              }))
                            }
                          />
                          <span>Thumbnail</span>
                        </label>
                      </div>
                      <div className="text-xs text-slate-500 mt-2">
                        Preferences are saved locally; backend hooks for these
                        are next up.
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-sm text-slate-500 hidden sm:block">
                        {config.useServer
                          ? "Downloads served from your local backend."
                          : "Powered by the built-in simulator."}
                      </div>
                      {(() => {
                        if (!videoInfo) return null;
                        const activeFormats =
                          selectedVideoFromPlaylist?.formats ||
                          ("formats" in videoInfo ? videoInfo.formats : []);
                        const sel = activeFormats?.find(
                          (f) => f.format_id === selectedFormat
                        );
                        return (
                          <div className="text-xs text-slate-300 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-1.5">
                            Est. size:{" "}
                            {convertToMp3
                              ? "After conversion"
                              : describeSize(sel)}
                          </div>
                        );
                      })()}

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
                          <span className="flex items-center gap-1.5 text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                            {stats.totalBytes
                              ? `${formatBytes(stats.downloadedBytes)} / ${formatBytes(stats.totalBytes)}`
                              : stats.downloadedBytes
                              ? `${formatBytes(stats.downloadedBytes)} downloaded`
                              : '--'}
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

      {downloadState === "downloading" && (
        <div className="fixed bottom-4 left-4 right-4 z-40 sm:hidden">
          <div className="bg-slate-900/90 border border-slate-700 rounded-xl p-3 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
              <span className="font-semibold">
                {convertToMp3 ? "MP3 download" : "Download in progress"}
              </span>
              <span className="font-mono">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full ${
                  convertToMp3
                    ? "bg-gradient-to-r from-pink-500 to-rose-500"
                    : "bg-gradient-to-r from-indigo-500 to-purple-500"
                }`}
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                {stats.speed}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                {stats.totalBytes
                  ? `${formatBytes(stats.downloadedBytes)} / ${formatBytes(stats.totalBytes)}`
                  : stats.downloadedBytes
                  ? `${formatBytes(stats.downloadedBytes)}`
                  : '--'}
              </span>
              <span>ETA {stats.eta}</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer Info */}
      <footer className="mt-10 border-t border-slate-800/70 bg-slate-950/80 backdrop-blur px-4">
        <div className="max-w-4xl mx-auto py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-2 justify-center">
            <div className="flex items-center gap-2 group cursor-default">
              <span>BUILT_BY:</span>
              <span className="text-slate-300 font-bold group-hover:text-red-500 transition-colors">
                KROMA_DEV_TEAM
              </span>
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-400">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5 hover:border-red-500/30 transition-colors cursor-default">
              <span>🇰🇭</span>
              <span className="hidden sm:inline uppercase tracking-wider text-slate-300">
                Cambodia Needs Peace
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
