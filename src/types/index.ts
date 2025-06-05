export interface VideoClip {
  url: string;
  duration: number;
}

export interface AssFile {
  url: string;
}

export interface ProcessVideoRequest {
  videoClips: VideoClip[];
  assFile: AssFile;
  songUrl: string;
  songId: string;
  songTitle?: string;
  outputAspectRatio: '9:16' | '16:9';
  transitionDuration?: number;
}

export interface ProcessVideoResponse {
  status: 'completed';
  outputUrl: string;
  duration: number;
  message: string;
  processingTimeMs: number;
}

export interface ProcessVideoErrorResponse {
  status: 'failed';
  error: {
    code: ProcessingErrorCode;
    message: string;
    details: string;
    stage: ProcessingStage;
  };
}

export enum ProcessingErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  METADATA_EXTRACTION_ERROR = 'METADATA_EXTRACTION_ERROR',
  FFMPEG_PROCESSING_ERROR = 'FFMPEG_PROCESSING_ERROR',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  CLEANUP_ERROR = 'CLEANUP_ERROR'
}

export enum ProcessingStage {
  VALIDATION = 'validation',
  ASSET_DOWNLOAD = 'asset_download',
  METADATA_EXTRACTION = 'metadata_extraction',
  FFMPEG_CONSTRUCTION = 'ffmpeg_construction',
  VIDEO_PROCESSING = 'video_processing',
  OUTPUT_UPLOAD = 'output_upload',
  CLEANUP = 'cleanup'
}

export interface ProcessingContext {
  processId: string;
  request: ProcessVideoRequest;
  tempDir: string;
  startTime: number;
  localFiles: {
    videoClips: string[];
    assFile: string;
    songFile: string;
    outputFile: string;
  };
  metadata: {
    songDuration: number;
    totalClipDuration: number;
    transitionOffsets: number[];
  };
}

export interface AspectRatioConfig {
  width: number;
  height: number;
}

export const ASPECT_RATIO_CONFIGS: Record<string, AspectRatioConfig> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 }
};

export class ProcessingError extends Error {
  constructor(
    public code: ProcessingErrorCode,
    public stage: ProcessingStage,
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
} 