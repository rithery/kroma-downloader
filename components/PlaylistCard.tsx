import React, { useState } from 'react';
import { PlaylistInfo, VideoInfo } from '../types';
import { Icons } from '../constants';

interface PlaylistCardProps {
  info: PlaylistInfo;
  onVideoSelect: (video: VideoInfo) => void;
  selectedVideoId?: string;
  truncated?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  pageSize?: number;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ info, onVideoSelect, selectedVideoId, truncated, onLoadMore, loadingMore, pageSize }) => {
  const [imgError, setImgError] = useState(false);
  const nextBatchSize = Math.max(1, Math.min(info.video_count - info.videos.length, pageSize || 50));

  const formatDuration = (seconds?: number) => {
    if (!Number.isFinite(seconds) || seconds! < 0) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4 sm:p-6 space-y-6">
      {/* Playlist Header */}
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="relative w-full sm:w-64 flex-shrink-0 group">
          {!imgError ? (
              <img
              src={info.thumbnail}
              alt={info.title}
              onError={() => setImgError(true)}
              className="w-full aspect-video object-cover rounded-xl shadow-lg border border-slate-600/50 group-hover:border-indigo-500/50 transition-colors"
              />
          ) : (
              <div className="w-full aspect-video bg-slate-800 rounded-xl border border-slate-700 flex items-center justify-center">
                  <Icons.Video className="w-12 h-12 text-slate-600" />
              </div>
          )}

          <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-md">
            {info.video_count} videos
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <h2 className="text-xl font-bold text-white leading-tight">{info.title || 'Untitled playlist'}</h2>
          <p className="text-indigo-400 font-medium">{info.uploader || 'Unknown uploader'}</p>
          <p className="text-sm text-slate-400 line-clamp-2">{info.description || 'No description provided.'}</p>
      <div className="pt-2 flex items-center gap-4 text-xs text-slate-500">
         <span>{info.video_count} videos</span>
         <span>ID: {info.id || 'N/A'}</span>
      </div>
    </div>
  </div>

      {(truncated || info.video_count > info.videos.length) && (
        <div className="bg-amber-900/30 border border-amber-800/60 text-amber-100 text-sm rounded-xl px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icons.AlertTriangle className="w-4 h-4" />
            <span>
              Showing first {info.videos.length} of {info.video_count} items. Large playlists are capped to keep things fast.
            </span>
          </div>
          {onLoadMore && (
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 hover:bg-amber-500/30 disabled:opacity-60"
            >
              {loadingMore ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Fetching next batch...</span>
                </>
              ) : (
                <>
                  <Icons.Download className="w-4 h-4" />
                  <span>Load next {nextBatchSize} items</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Video List */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Select a video to download:</h3>
        <div className="max-h-96 overflow-y-auto space-y-2">
          {info.videos.map((video, index) => (
            <button
              key={video.id}
              onClick={() => onVideoSelect(video)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 text-left group
                ${selectedVideoId === video.id
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.2)]'
                  : 'bg-slate-800/50 border-slate-700 hover:border-slate-500 hover:bg-slate-800'
                }`}
            >
              <div className="flex-shrink-0 w-8 h-8 bg-slate-700 rounded flex items-center justify-center text-xs font-medium text-slate-300">
                {index + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className={`font-medium truncate ${selectedVideoId === video.id ? 'text-indigo-400' : 'text-slate-200'}`}>
                  {video.title}
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <span>{formatDuration(video.duration)}</span>
                  <span>•</span>
                  <span>{(video.view_count || 0).toLocaleString()} views</span>
                </div>
              </div>

              {selectedVideoId === video.id && (
                <div className="text-indigo-400 animate-in zoom-in duration-200">
                  <Icons.Check className="w-5 h-5" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
