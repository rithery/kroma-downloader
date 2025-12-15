import React, { useState } from 'react';
import { PlaylistInfo, VideoInfo } from '../types';
import { Icons } from '../constants';

interface PlaylistCardProps {
  info: PlaylistInfo;
  onVideoSelect: (video: VideoInfo) => void;
  selectedVideoId?: string;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ info, onVideoSelect, selectedVideoId }) => {
  const [imgError, setImgError] = useState(false);

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
