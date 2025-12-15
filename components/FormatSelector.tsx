import React from 'react';
import { VideoFormat, FormatType } from '../types';
import { Icons } from '../constants';

interface FormatSelectorProps {
  formats: VideoFormat[];
  selectedFormatId: string | null;
  onSelect: (id: string) => void;
}

interface FormatItemProps {
  format: VideoFormat;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const FormatItem: React.FC<FormatItemProps> = ({ 
  format, 
  isSelected, 
  onSelect 
}) => {
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
            {format.type === FormatType.VIDEO ? format.note || format.resolution : format.ext.toUpperCase()}
          </div>
          <div className="text-xs text-slate-400">
             {format.ext} • {format.filesize ? `${(format.filesize / 1024 / 1024).toFixed(1)} MB` : 'Unknown Size'}
          </div>
        </div>
      </div>
      
      {isSelected && (
        <div className="text-indigo-400 animate-in zoom-in duration-200">
          <Icons.Check className="w-6 h-6" />
        </div>
      )}
    </button>
  );
};

export const FormatSelector: React.FC<FormatSelectorProps> = ({ formats, selectedFormatId, onSelect }) => {
  const videoFormats = formats.filter(f => f.type === FormatType.VIDEO);
  const audioFormats = formats.filter(f => f.type === FormatType.AUDIO);

  return (
    <div className="space-y-6">
      {videoFormats.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider ml-1">Video Formats</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {videoFormats.map(f => (
              <FormatItem 
                key={f.format_id} 
                format={f} 
                isSelected={selectedFormatId === f.format_id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
      
      {audioFormats.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider ml-1">Audio Only</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {audioFormats.map(f => (
              <FormatItem 
                key={f.format_id} 
                format={f} 
                isSelected={selectedFormatId === f.format_id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
