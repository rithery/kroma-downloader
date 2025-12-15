import React, { useState } from 'react';
import { Icons } from '../constants';
import { generateSmartMetadata } from '../services/geminiService';
import { AiMetadataResult } from '../types';

interface GeminiMetadataProps {
  videoTitle: string;
  uploader: string;
}

export const GeminiMetadata: React.FC<GeminiMetadataProps> = ({ videoTitle, uploader }) => {
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<AiMetadataResult | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateSmartMetadata(videoTitle, uploader);
      setMetadata(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 bg-gradient-to-br from-indigo-900/20 to-purple-900/10 border border-indigo-500/30 rounded-2xl p-6 relative overflow-hidden">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-indigo-300">
            <Icons.Sparkles className="w-5 h-5" />
            <span className="font-semibold tracking-wide text-sm">GEMINI AI ENHANCER</span>
          </div>
          {!metadata && !loading && (
             <button
             onClick={handleGenerate}
             className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
           >
             Generate Metadata
           </button>
          )}
        </div>

        {loading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-indigo-500/20 rounded w-3/4"></div>
            <div className="h-4 bg-indigo-500/20 rounded w-1/2"></div>
            <div className="flex gap-2 mt-4">
              <div className="h-6 w-16 bg-indigo-500/20 rounded-full"></div>
              <div className="h-6 w-16 bg-indigo-500/20 rounded-full"></div>
            </div>
          </div>
        )}

        {metadata && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">AI Summary</h4>
              <p className="text-slate-200 leading-relaxed">{metadata.summary}</p>
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-slate-400 mb-2">SEO Tags</h4>
              <div className="flex flex-wrap gap-2">
                {metadata.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md text-xs">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

             <div>
              <h4 className="text-sm font-medium text-slate-400 mb-1">Suggested Filename</h4>
              <code className="bg-slate-950 px-3 py-1.5 rounded text-sm font-mono text-green-400 block w-fit">
                {metadata.suggestedFileName}
              </code>
            </div>
          </div>
        )}

        {!metadata && !loading && (
          <p className="text-sm text-slate-400">
            Use Google's Gemini AI to analyze the video info and generate professional summaries, optimized tags, and clean filenames for your archive.
          </p>
        )}
      </div>

      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-600/10 blur-[80px] rounded-full pointer-events-none"></div>
    </div>
  );
};
