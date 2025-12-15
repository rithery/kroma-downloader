import React from 'react';
import { VideoFormat, FormatType } from '../types';
import { Icons } from '../constants';

interface FormatSelectorProps {
  formats: VideoFormat[];
  selectedFormatId: string | null;
  recommendedFormatId?: string | null;
  onSelect: (id: string) => void;
}

interface FormatItemProps {
  format: VideoFormat;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: (id: string) => void;
}

const FormatItem: React.FC<FormatItemProps> = ({ 
  format, 
  isSelected, 
  isRecommended,
  onSelect 
}) => {
  const hasAudio = !!(format.acodec && format.acodec !== 'none');
  const sizeLabel = format.filesize ? `${(format.filesize / 1024 / 1024).toFixed(1)} MB` : '—';
  const qualityLabel = format.type === FormatType.VIDEO 
    ? (format.note || format.resolution || format.ext.toUpperCase())
    : format.ext.toUpperCase();

  return (
    <button
      onClick={() => onSelect(format.format_id)}
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-200 group
        ${isSelected 
          ? 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.3)]' 
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-500 hover:bg-slate-800'
        }`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400 group-hover:text-slate-200'}`}>
          {format.type === FormatType.VIDEO ? <Icons.Video className="w-5 h-5" /> : <Icons.Music className="w-5 h-5" />}
        </div>
        <div className="text-left">
          <div className={`font-semibold ${isSelected ? 'text-indigo-400' : 'text-slate-200'}`}>
            {qualityLabel}
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>{format.ext}</span>
            <span>•</span>
            <span>{sizeLabel}</span>
            {!hasAudio && (
              <>
                <span>•</span>
                <span className="text-amber-300">No audio</span>
              </>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {isRecommended && !isSelected && (
          <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded">
            Recommended
          </span>
        )}
        {isSelected && (
          <div className="text-indigo-400 animate-in zoom-in duration-200">
            <Icons.Check className="w-6 h-6" />
          </div>
        )}
      </div>
    </button>
  );
};

export const FormatSelector: React.FC<FormatSelectorProps> = ({ formats, selectedFormatId, recommendedFormatId, onSelect }) => {
  // Sort video formats by quality (resolution and filesize)
  const sortedVideoFormats = formats
    .filter(f => f.type === FormatType.VIDEO)
    .sort((a, b) => {
      const hasAudioA = !!(a.acodec && a.acodec !== 'none');
      const hasAudioB = !!(b.acodec && b.acodec !== 'none');
      if (hasAudioA !== hasAudioB) return hasAudioB ? 1 : -1; // Prefer formats that include audio

      // Prioritize higher resolution
      const resA = parseInt(a.resolution) || 0;
      const resB = parseInt(b.resolution) || 0;
      if (resA !== resB) return resB - resA;
      
      // Then by filesize (larger files usually better quality)
      return (b.filesize || 0) - (a.filesize || 0);
    });

  // Take top 3 video formats
  const topVideoFormats = sortedVideoFormats.slice(0, 3);

  // Get best audio format
  const audioFormats = formats.filter(f => f.type === FormatType.AUDIO);
  const bestAudioFormat = audioFormats.length > 0 ? [audioFormats[0]] : [];

  // Combine into max 4 formats
  const selectedFormats = [...topVideoFormats, ...bestAudioFormat];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider ml-1">Available Formats</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {selectedFormats.map(f => (
          <FormatItem 
            key={f.format_id} 
            format={f} 
            isSelected={selectedFormatId === f.format_id}
            isRecommended={recommendedFormatId === f.format_id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
};
