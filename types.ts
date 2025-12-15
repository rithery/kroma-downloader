export enum FormatType {
  VIDEO = 'video',
  AUDIO = 'audio'
}

export interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize?: number;
  note?: string; // e.g., "1080p60 HDR"
  type: FormatType;
  vcodec?: string;
  acodec?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number; // in seconds
  view_count: number;
  description: string;
  formats: VideoFormat[];
  webpage_url: string;
}

export interface AiMetadataResult {
  summary: string;
  tags: string[];
  suggestedFileName: string;
}
