import { VideoInfo, FormatType, PlaylistInfo, MediaInfo } from '../types';

/**
 * SERVICE CONFIGURATION
 * 
 * This service now supports two modes:
 * 1. MOCK MODE: Simulates yt-dlp behavior in the browser.
 * 2. SERVER MODE (Default): Connects to a real backend running yt-dlp.
 */

// --- SHARED TYPES ---

export interface DownloadProgress {
  progress: number;
  speed: string;
  eta: string;
}

export interface ApiConfig {
  useServer: boolean;
  serverUrl: string;
  filenameTemplate?: string;
}

export type PlaylistCombineMode = 'audio' | 'video' | 'zip';

// Default to true. We use 127.0.0.1 because 'localhost' can sometimes 
// fail due to IPv4/IPv6 resolution differences in Node vs Browser.
let currentConfig: ApiConfig = {
  useServer: true,
  serverUrl: 'http://127.0.0.1:8000',
  filenameTemplate: '{title}'
};

export const updateApiConfig = (config: Partial<ApiConfig>) => {
  currentConfig = { ...currentConfig, ...config };
};

export const getApiConfig = () => currentConfig;

// --- REAL IMPLEMENTATION ---

const fetchVideoInfoReal = async (url: string): Promise<MediaInfo> => {
  // Ensure no trailing slash
  const baseUrl = currentConfig.serverUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/api/info?url=${encodeURIComponent(url)}`;
  
  try {
    // Add a timeout to the fetch so it doesn't hang forever
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(id);

    if (!res.ok) {
        let errorMessage = `Server error: ${res.status}`;
        try {
            const errorJson = await res.json();
            if (errorJson.detail) errorMessage = errorJson.detail;
        } catch (e) {
            // ignore JSON parse error
        }
        throw new Error(errorMessage);
    }
    const data = await res.json();
    
    // Check if it's a playlist
    if (data._type === 'playlist') {
      return {
        id: data.id,
        title: data.title,
        uploader: data.uploader || data.uploader_id || 'Unknown',
        thumbnail: data.thumbnail,
        description: data.description || '',
        webpage_url: data.webpage_url,
        video_count: data.video_count || 0,
        videos: (data.videos || []).map((v: any) => ({
          id: v.id,
          title: v.title,
          uploader: v.uploader || v.uploader_id || 'Unknown',
          thumbnail: v.thumbnail,
          duration: v.duration,
          view_count: v.view_count || 0,
          description: v.description || '',
          webpage_url: v.webpage_url,
          formats: (v.formats || []).map((f: any) => ({
            format_id: f.format_id,
            ext: f.ext,
          resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : 'audio only'),
          note: f.format_note,
          type: (f.vcodec === 'none' || !f.vcodec) && f.acodec !== 'none' ? FormatType.AUDIO : FormatType.VIDEO,
          filesize: f.filesize,
          filesize_approx: f.filesize_approx,
          vcodec: f.vcodec,
          acodec: f.acodec,
          tbr: f.tbr
        })).filter((f: any) => f.format_id)
      }))
    } as PlaylistInfo;
  }
    
    // Transform backend data to our frontend VideoInfo interface
    return {
      id: data.id,
      title: data.title,
      uploader: data.uploader || data.uploader_id || 'Unknown',
      thumbnail: data.thumbnail,
      duration: data.duration,
      view_count: data.view_count || 0,
      description: data.description || '',
      webpage_url: data.webpage_url,
      formats: (data.formats || []).map((f: any) => ({
        format_id: f.format_id,
        ext: f.ext,
      resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : 'audio only'),
      note: f.format_note,
      type: (f.vcodec === 'none' || !f.vcodec) && f.acodec !== 'none' ? FormatType.AUDIO : FormatType.VIDEO,
      filesize: f.filesize,
      filesize_approx: f.filesize_approx,
      vcodec: f.vcodec,
      acodec: f.acodec,
      tbr: f.tbr
    })).filter((f: any) => f.format_id) // ensure valid formats
  } as VideoInfo;
  } catch (error: any) {
    console.error("Real API Error Details:", error);
    
    // Friendly error messages for common connection issues
    if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
        throw new Error("Cannot reach backend. Please run 'python server.py' in your terminal.");
    }
    if (error.name === 'AbortError') {
        throw new Error("Request timed out. The server took too long to respond.");
    }
    const urlLower = url.toLowerCase();
    if (urlLower.includes('facebook.com') || urlLower.includes('fb.watch')) {
        throw new Error("Facebook links often require login cookies. Provide a cookies.txt to the backend or ensure the video is public.");
    }
    
    throw error;
  }
};

const downloadVideoReal = async (
    url: string,
    formatId: string,
    onProgress: (data: DownloadProgress) => void,
    expectedFileSize?: number,
    convertToMp3: boolean = false,
    options?: { playlistCombine?: PlaylistCombineMode; karaoke?: boolean }
): Promise<Blob> => {
    const baseUrl = currentConfig.serverUrl.replace(/\/$/, '');
    let endpoint = `${baseUrl}/api/download?url=${encodeURIComponent(url)}&format=${formatId}`;
    if (convertToMp3) {
        endpoint += `&convert_to_mp3=true`;
    }
    if (currentConfig.filenameTemplate) {
        endpoint += `&filename_template=${encodeURIComponent(currentConfig.filenameTemplate)}`;
    }
    if (options?.playlistCombine) {
        endpoint += `&playlist_combine=${options.playlistCombine}`;
    }
    if (options?.karaoke) {
        endpoint += `&karaoke=true`;
    }
    
    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            let errorMessage = `Download failed: ${response.status} ${response.statusText}`;
            try {
                const errJson = await response.json();
                if (errJson?.detail) errorMessage = `Download failed: ${errJson.detail}`;
            } catch {
                try {
                    const errText = await response.text();
                    if (errText) errorMessage = `Download failed: ${errText}`;
                } catch {
                    // ignore
                }
            }
            throw new Error(errorMessage);
        }
        
        const contentLengthHeader = response.headers.get('Content-Length');
        // If converting to MP3, the size changes, so we can't trust the original filesize
        const contentLength = convertToMp3
            ? (expectedFileSize || 0)
            : (contentLengthHeader ? parseInt(contentLengthHeader, 10) : (expectedFileSize || 0));
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error("ReadableStream not supported by your browser");

        let receivedLength = 0;
        const chunks: Uint8Array[] = [];
        const startTime = Date.now();
        let lastUpdate = startTime;

        // Fire an initial progress event so the UI does not sit at 0%
        onProgress({ progress: 0, speed: 'Starting...', eta: 'calculating...' });

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;

            const now = Date.now();
            // Update UI every 200ms
            if (now - lastUpdate > 150) {
                let progress = 0;
                if (contentLength > 0) {
                    progress = (receivedLength / contentLength) * 100;
                    if (progress > 99.9) progress = 99.9;
                } else {
                    // Indeterminate progress logic for streams (especially MP3 conversion)
                    const mb = receivedLength / (1024 * 1024);
                    // Slower progress curve for indeterminate, cap lower if we have a rough size
                    progress = Math.min(contentLength ? 98 : 95, Math.log(mb + 1) * 12); 
                }
                
                // Calculate Speed
                const elapsed = (now - startTime) / 1000;
                const speedBytesPerSec = elapsed > 0 ? receivedLength / elapsed : 0;
                const speedMBps = (speedBytesPerSec / (1024 * 1024)).toFixed(1);
                
                // Calculate ETA
                let eta = "--";
                if (contentLength && speedBytesPerSec > 0) {
                    const remaining = contentLength - receivedLength;
                    const etaSec = Math.ceil(remaining / speedBytesPerSec);
                    if (etaSec < 60) eta = `${etaSec}s`;
                    else eta = `${Math.floor(etaSec/60)}m ${etaSec%60}s`;
                } else {
                    eta = "calculating...";
                }

                onProgress({
                    progress,
                    speed: `${speedMBps} MB/s`,
                    eta
                });
                lastUpdate = now;
            }
        }

        onProgress({ progress: 100, speed: 'Done', eta: '0s' });
        return new Blob(chunks);
    } catch (error: any) {
        if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
            throw new Error("Lost connection to server during download.");
        }
        throw error;
    }
};

// --- MOCK IMPLEMENTATION ---

const MOCK_THUMBNAILS = [
  "https://picsum.photos/seed/video1/640/360",
  "https://picsum.photos/seed/video2/640/360",
  "https://picsum.photos/seed/video3/640/360",
  "https://picsum.photos/seed/video4/640/360"
];

const generateMockFormats = () => [
  {
    format_id: "premium_4k",
    ext: "webm",
    resolution: "3840x2160",
    note: "4K HDR",
    type: FormatType.VIDEO,
    filesize: 850000000 + Math.floor(Math.random() * 100000000),
    vcodec: "vp9",
    acodec: "opus"
  },
  {
    format_id: "hd_1080p",
    ext: "mp4",
    resolution: "1920x1080",
    note: "1080p High",
    type: FormatType.VIDEO,
    filesize: 450000000 + Math.floor(Math.random() * 50000000),
    vcodec: "avc1",
    acodec: "mp4a"
  },
  {
    format_id: "hd_720p",
    ext: "mp4",
    resolution: "1280x720",
    note: "720p",
    type: FormatType.VIDEO,
    filesize: 120000000 + Math.floor(Math.random() * 20000000),
    vcodec: "avc1",
    acodec: "mp4a"
  },
  {
    format_id: "audio_best",
    ext: "m4a",
    resolution: "audio only",
    note: "High Quality Audio",
    type: FormatType.AUDIO,
    filesize: 15000000 + Math.floor(Math.random() * 5000000),
    vcodec: "none",
    acodec: "aac"
  }
];

const fetchVideoInfoMock = async (url: string): Promise<VideoInfo> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        new URL(url);
      } catch (e) {
        reject(new Error("Please enter a valid URL (e.g., https://...)"));
        return;
      }

      let derivedTitle = "Untitled Video";
      let derivedUploader = "Unknown Source";
      let derivedPlatform = "Web";

      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace('www.', '');
        derivedPlatform = hostname.split('.')[0];
        derivedPlatform = derivedPlatform.charAt(0).toUpperCase() + derivedPlatform.slice(1);
        
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) {
            const lastSegment = pathSegments[pathSegments.length - 1];
            const rawTitle = lastSegment.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, "");
            if (rawTitle.length > 0) {
                derivedTitle = rawTitle.replace(/\b\w/g, c => c.toUpperCase());
            }
        } else {
            derivedTitle = `Video from ${derivedPlatform}`;
        }
        derivedUploader = `${derivedPlatform} Creator`;
      } catch (e) {}

      const randomId = Math.random().toString(36).substring(7);
      const thumbIndex = url.length % MOCK_THUMBNAILS.length;
      
      resolve({
        id: randomId,
        title: derivedTitle,
        uploader: derivedUploader,
        thumbnail: MOCK_THUMBNAILS[thumbIndex],
        duration: 120 + Math.floor(Math.random() * 600),
        view_count: Math.floor(Math.random() * 1000000) + 5000,
        description: `[MOCK MODE] This is a simulated description for ${url}. Switch to Server Mode in settings to use real yt-dlp.`,
        webpage_url: url,
        formats: generateMockFormats()
      });
    }, 1200);
  });
};

const downloadVideoMock = (
  formatId: string,
  onProgress: (data: DownloadProgress) => void,
  convertToMp3: boolean = false,
  options?: { playlistCombine?: PlaylistCombineMode; karaoke?: boolean }
): Promise<Blob> => {
  return new Promise((resolve) => {
    let progress = 0;
    const interval = setInterval(() => {
      const increment = Math.random() * 2 + 1; 
      progress += increment;
      
      const remainingPercent = 100 - progress;
      const speedVal = (Math.random() * 15 + 5).toFixed(1);
      const estimatedSeconds = Math.ceil((remainingPercent / increment) * 0.1); 
      
      const stats: DownloadProgress = {
        progress: Math.min(progress, 100),
        speed: `${speedVal} MB/s`,
        eta: `${estimatedSeconds}s`
      };

      if (progress >= 100) {
        clearInterval(interval);
        onProgress({ ...stats, progress: 100, eta: '0s' });
        setTimeout(() => {
            // Return a dummy blob
            const shouldUseMp4 = options?.playlistCombine === 'video' || !convertToMp3;
            resolve(new Blob(["Simulated Video Content"], { type: shouldUseMp4 ? 'video/mp4' : 'audio/mpeg' }));
        }, 500);
      } else {
        onProgress(stats);
      }
    }, 100);
  });
};

// --- PUBLIC API DELEGATES ---

export const fetchVideoInfo = async (url: string): Promise<MediaInfo> => {
    if (currentConfig.useServer) {
        return fetchVideoInfoReal(url);
    }
    return fetchVideoInfoMock(url);
};

export const simulateDownload = async (
    formatId: string,
    url: string,
    onProgress: (data: DownloadProgress) => void,
    fileSize?: number,
    convertToMp3: boolean = false,
    options?: { playlistCombine?: PlaylistCombineMode; karaoke?: boolean }
): Promise<Blob> => {
    if (currentConfig.useServer) {
        return downloadVideoReal(url, formatId, onProgress, fileSize, convertToMp3, options);
    }
    return downloadVideoMock(formatId, onProgress, convertToMp3, options);
};
