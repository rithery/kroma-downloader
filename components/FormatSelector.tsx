import React, { useMemo } from 'react';
import { VideoFormat, FormatType } from '../types';
import { Icons } from '../constants';

type FormatOptionId =
  | 'video_1440p'
  | 'video_1080p'
  | 'video_720p'
  | 'raw_mkv';

interface FormatSelectorProps {
  formats: VideoFormat[];
  selectedFormatId: string | null;
  recommendedFormatId?: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

interface FormatOptionConfig {
  id: FormatOptionId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

interface ResolvedFormatOption extends FormatOptionConfig {
  format?: VideoFormat;
}

const OPTION_CONFIG: FormatOptionConfig[] = [
  {
    id: 'video_1440p',
    label: '2K Quad HD',
    desc: '1440p high res (MP4)',
    icon: Icons.Monitor,
    accent: 'from-sky-500/30 to-cyan-500/20'
  },
  {
    id: 'video_1080p',
    label: '1080p Full HD',
    desc: 'Balanced quality (MP4)',
    icon: Icons.Film,
    accent: 'from-purple-500/30 to-indigo-500/20'
  },
  {
    id: 'video_720p',
    label: '720p HD',
    desc: 'Data saver (MP4)',
    icon: Icons.Smartphone,
    accent: 'from-amber-500/30 to-orange-500/20'
  },
  {
    id: 'raw_mkv',
    label: 'Raw MKV',
    desc: 'Unaltered video stream',
    icon: Icons.FileVideo,
    accent: 'from-slate-500/30 to-slate-400/20'
  }
];

const getHeight = (format?: VideoFormat) => {
  if (!format?.resolution) return 0;
  const pMatch = format.resolution.match(/(\d{3,4})p/i);
  if (pMatch) return parseInt(pMatch[1], 10);

  const xMatch = format.resolution.match(/x(\d{3,4})/i);
  if (xMatch) return parseInt(xMatch[1], 10);

  return 0;
};

const hasAudio = (format?: VideoFormat) => !!format?.acodec && format.acodec !== 'none';

const getSizeInfo = (format?: VideoFormat) => {
  if (!format) return { label: '--', estimated: true };
  if (format.filesize && format.filesize > 0) {
    return { label: `${(format.filesize / 1024 / 1024).toFixed(1)} MB`, estimated: false };
  }
  if (format.filesize_approx && format.filesize_approx > 0) {
    return { label: `~${(format.filesize_approx / 1024 / 1024).toFixed(1)} MB`, estimated: true };
  }
  return { label: 'Unknown', estimated: true };
};

const FormatItem: React.FC<{
  option: ResolvedFormatOption;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: (id: string) => void;
  disabled?: boolean;
}> = ({ option, isSelected, isRecommended, onSelect, disabled }) => {
  const { format } = option;
  const sizeInfo = getSizeInfo(format);
  const height = format ? getHeight(format) : 0;
  const resolutionTag = format?.resolution?.toLowerCase() === 'audio only'
    ? 'Audio'
    : height > 0
      ? `${height}p`
      : format?.note || format?.resolution || '';

  return (
    <button
      onClick={() => format && !disabled && onSelect(format.format_id)}
      disabled={!format || disabled}
      className={`w-full text-left rounded-xl border transition-all duration-200 relative overflow-hidden group
        ${isSelected
          ? 'border-indigo-400/70 bg-gradient-to-br from-indigo-900/40 via-slate-900/60 to-slate-900 shadow-[0_14px_45px_rgba(79,70,229,0.35)]'
          : 'border-slate-800 bg-slate-900/70 hover:border-slate-600 hover:bg-slate-900'
        }
        ${!format || disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-r ${option.accent} opacity-0 group-hover:opacity-70 transition-opacity`} />
      <div className="relative p-3 sm:p-4 flex items-start gap-3">
        <div className={`rounded-lg p-2.5 border ${isSelected ? 'border-indigo-400/50 bg-indigo-500/20 text-indigo-100' : 'border-slate-700 bg-slate-800 text-slate-200'}`}>
          <option.icon className="w-4 h-4" />
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-semibold text-sm ${format ? 'text-white' : 'text-slate-500'}`}>{option.label}</span>
            {isRecommended && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 px-2 py-1 rounded">
                Recommended
              </span>
            )}
            {!format && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-800 text-slate-400 border border-slate-700 px-2 py-1 rounded">
                Not available
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">{option.desc}</p>
          {format && (
            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-200">
              <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 uppercase tracking-wide">
                {format.ext}
              </span>
              {(format.note || format.resolution) && (
                <span className="px-2 py-0.5 rounded-full bg-slate-800/70 border border-slate-700/70">
                  {format.note || format.resolution}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full border ${sizeInfo.estimated ? 'border-dashed border-slate-600 text-slate-300' : 'border-slate-700 text-white'} bg-slate-900/60`}>
                {sizeInfo.estimated ? `Est. ${sizeInfo.label}` : sizeInfo.label}
              </span>
              {format.type === FormatType.VIDEO && (
                <span className={`px-2 py-0.5 rounded-full border bg-slate-900/60 ${hasAudio(format) ? 'border-emerald-700/60 text-emerald-200' : 'border-amber-700/60 text-amber-200'}`}>
                  {hasAudio(format) ? 'Video + Audio' : 'Video only'}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{sizeInfo.estimated ? 'Estimate' : 'Size'}</span>
          <span className="text-xs font-mono text-white">{sizeInfo.label}</span>
          {format && <span className="text-[11px] text-slate-400">{resolutionTag}</span>}
          {isSelected && <Icons.Check className="w-5 h-5 text-indigo-300" />}
        </div>
      </div>
    </button>
  );
};

export const FormatSelector: React.FC<FormatSelectorProps> = ({ formats, selectedFormatId, recommendedFormatId, onSelect, disabled }) => {
  const options = useMemo<ResolvedFormatOption[]>(() => {
    const pickVideoByHeight = (minHeight?: number, maxHeight?: number) => {
      const videos = formats.filter(f => f.type === FormatType.VIDEO);
      const filtered = videos.filter(f => {
        const h = getHeight(f);
        if (minHeight && h < minHeight) return false;
        if (maxHeight && h >= maxHeight) return false;
        return true;
      });

      const sorted = [...filtered].sort((a, b) => {
        if (hasAudio(a) !== hasAudio(b)) return hasAudio(b) ? 1 : -1;
        const heightDiff = getHeight(b) - getHeight(a);
        if (heightDiff !== 0) return heightDiff;
        const sizeA = a.filesize ?? a.filesize_approx ?? 0;
        const sizeB = b.filesize ?? b.filesize_approx ?? 0;
        return sizeB - sizeA;
      });
      return sorted[0];
    };

    const pickRawMkv = () => {
      const mkvVideos = formats.filter(
        f => f.type === FormatType.VIDEO && f.ext.toLowerCase() === 'mkv'
      );
      if (!mkvVideos.length) return undefined;
      return [...mkvVideos].sort((a, b) => {
        const heightDiff = getHeight(b) - getHeight(a);
        if (heightDiff !== 0) return heightDiff;
        const sizeA = a.filesize ?? a.filesize_approx ?? 0;
        const sizeB = b.filesize ?? b.filesize_approx ?? 0;
        return sizeB - sizeA;
      })[0];
    };

    const mapping: Record<FormatOptionId, VideoFormat | undefined> = {
      video_1440p: pickVideoByHeight(1350, 2000),
      video_1080p: pickVideoByHeight(1000, 1400),
      video_720p: pickVideoByHeight(700, 1000),
      raw_mkv: pickRawMkv()
    };

    return OPTION_CONFIG.map(option => ({
      ...option,
      format: mapping[option.id]
    }));
  }, [formats]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 uppercase tracking-wide ml-1">Quality presets</h3>
        <span className="text-[10px] text-slate-500">Compact view</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {options.map(option => {
          const formatId = option.format?.format_id || '';
          return (
            <FormatItem
              key={option.id}
              option={option}
              isSelected={!!formatId && selectedFormatId === formatId}
              isRecommended={!!formatId && recommendedFormatId === formatId}
              onSelect={onSelect}
              disabled={disabled}
            />
          );
        })}
      </div>
    </div>
  );
};
