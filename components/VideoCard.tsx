import React, { useState } from 'react';
import { VideoInfo } from '../types';
import { Icons } from '../constants';

interface VideoCardProps {
  info: VideoInfo;
}

export const VideoCard: React.FC<VideoCardProps> = ({ info }) => {
  const [imgError, setImgError] = useState(false);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row gap-6 items-start">
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
          {formatDuration(info.duration)}
        </div>
      </div>
      
      <div className="flex-1 space-y-2">
        <h2 className="text-xl font-bold text-white leading-tight">{info.title}</h2>
        <p className="text-indigo-400 font-medium">{info.uploader}</p>
        <p className="text-sm text-slate-400 line-clamp-2">{info.description}</p>
        <div className="pt-2 flex items-center gap-4 text-xs text-slate-500">
           <span>{info.view_count.toLocaleString()} views</span>
           <span>ID: {info.id}</span>
        </div>
      </div>
    </div>
  );
};