export enum FormatType {
  VIDEO = 'video',
  AUDIO = 'audio'
}

export interface VideoFormat {
  format_id: string;
  ext: string;
  resolution: string;
  filesize?: number;
  filesize_approx?: number;
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

export interface PlaylistInfo {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  description: string;
  webpage_url: string;
  video_count: number;
  videos: VideoInfo[];
}

export interface AiMetadataResult {
  summary: string;
  tags: string[];
  suggestedFileName: string;
}

export type MediaInfo = VideoInfo | PlaylistInfo;
