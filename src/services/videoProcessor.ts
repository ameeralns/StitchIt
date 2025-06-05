import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { ProcessLogger } from '../utils/logger';
import { FileManager } from './fileManager';
import { FFmpegService } from './ffmpegService';
import { BlobService } from './blobService';
import { validateProcessVideoRequest } from '../validation/schemas';
import {
  ProcessVideoRequest,
  ProcessVideoResponse,
  ProcessingContext,
  ProcessingError,
  ProcessingErrorCode,
  ProcessingStage
} from '../types';

export class VideoProcessor {
  private logger: ProcessLogger;
  private processId: string;
  private fileManager: FileManager;
  private ffmpegService: FFmpegService;
  private blobService: BlobService;

  constructor() {
    this.processId = uuidv4();
    this.logger = new ProcessLogger(this.processId);
    this.fileManager = new FileManager(this.processId);
    this.ffmpegService = new FFmpegService(this.processId);
    this.blobService = new BlobService(this.processId);
  }

  async processVideo(requestData: any): Promise<ProcessVideoResponse> {
    const startTime = Date.now();
    let context: ProcessingContext | undefined;

    this.logger.info('Starting video processing', { 
      processId: this.processId,
      requestData: { ...requestData, songUrl: '[REDACTED]' } // Don't log full URLs
    });

    try {
      // Step 1: Validate request
      const request = await this.validateRequest(requestData);

      // Step 2: Verify FFmpeg installation and fonts
      await this.ffmpegService.verifyFFmpegInstallation();
      await this.ffmpegService.verifyFontsDirectory();

      // Step 3: Create processing context
      context = await this.createProcessingContext(request);

      // Step 4: Download assets
      const localFiles = await this.fileManager.downloadAssets(
        request.videoClips.map(clip => clip.url),
        request.assFile.url,
        request.songUrl,
        context.tempDir
      );

      // Update context with local file paths
      context.localFiles = {
        ...localFiles,
        outputFile: path.join(context.tempDir, 'final_video.mp4')
      };

      // Step 5: Extract metadata
      await this.extractMetadata(context);

      // Step 6: Process video with FFmpeg
      await this.ffmpegService.processVideo(context);

      // Step 7: Upload to Vercel Blob
      const outputUrl = await this.uploadOutput(context);

      // Step 8: Cleanup and delete source assets
      await this.cleanup(context);

      // Step 9: Generate response
      const processingTimeMs = Date.now() - startTime;
      const response: ProcessVideoResponse = {
        status: 'completed',
        outputUrl,
        duration: context.metadata.songDuration,
        message: 'Video processed successfully.',
        processingTimeMs
      };

      this.logger.info('Video processing completed successfully', {
        processId: this.processId,
        processingTimeMs,
        outputUrl,
        duration: context.metadata.songDuration
      });

      return response;

    } catch (error) {
      this.logger.error('Video processing failed', error as Error, {
        processId: this.processId,
        processingTimeMs: Date.now() - startTime
      });

      // Cleanup on error
      if (context?.tempDir) {
        await this.fileManager.cleanupDirectory(context.tempDir).catch(() => {
          // Ignore cleanup errors during error handling
        });
      }

      // Re-throw ProcessingError as-is, wrap other errors
      if (error instanceof ProcessingError) {
        throw error;
      } else {
        throw new ProcessingError(
          ProcessingErrorCode.FFMPEG_PROCESSING_ERROR,
          ProcessingStage.VIDEO_PROCESSING,
          'Unexpected error during video processing',
          (error as Error).message
        );
      }
    }
  }

  private async validateRequest(requestData: any): Promise<ProcessVideoRequest> {
    this.logger.logStage('Request Validation', 'start');
    
    try {
      const validatedRequest = validateProcessVideoRequest(requestData);
      this.logger.logStage('Request Validation', 'complete', {
        clipCount: validatedRequest.videoClips.length,
        outputAspectRatio: validatedRequest.outputAspectRatio
      });
      return validatedRequest;
    } catch (error) {
      this.logger.logStage('Request Validation', 'error', { error: (error as Error).message });
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'Request validation failed',
        (error as Error).message
      );
    }
  }

  private async createProcessingContext(request: ProcessVideoRequest): Promise<ProcessingContext> {
    const tempDir = await this.fileManager.createTempDirectory(this.processId);
    
    return {
      processId: this.processId,
      request,
      tempDir,
      startTime: Date.now(),
      localFiles: {
        videoClips: [],
        assFile: '',
        songFile: '',
        outputFile: ''
      },
      metadata: {
        songDuration: 0,
        totalClipDuration: 0,
        transitionOffsets: []
      }
    };
  }

  private async extractMetadata(context: ProcessingContext): Promise<void> {
    this.logger.logStage('Metadata Extraction', 'start');
    
    try {
      // Get song duration
      const songDuration = await this.ffmpegService.getSongDuration(context.localFiles.songFile);
      
      // Calculate clip durations and transition offsets
      const clipDurations = context.request.videoClips.map(clip => clip.duration);
      const totalClipDuration = clipDurations.reduce((sum, duration) => sum + duration, 0);
      const transitionDuration = context.request.transitionDuration || 0.5;
      const transitionOffsets = this.ffmpegService.calculateTransitionOffsets(clipDurations, transitionDuration);

      // Update context metadata
      context.metadata = {
        songDuration,
        totalClipDuration,
        transitionOffsets
      };

      this.logger.logStage('Metadata Extraction', 'complete', {
        songDuration,
        totalClipDuration,
        clipCount: clipDurations.length,
        transitionOffsets
      });

    } catch (error) {
      this.logger.logStage('Metadata Extraction', 'error', { error: (error as Error).message });
      throw error; // FFmpegService already wraps this in ProcessingError
    }
  }

  private async uploadOutput(context: ProcessingContext): Promise<string> {
    const fileName = this.fileManager.generateFileName(
      context.request.songId,
      this.processId,
      'mp4'
    );
    const blobPath = this.fileManager.generateBlobPath(context.request.songId, fileName);
    
    return await this.blobService.uploadVideo(
      context.localFiles.outputFile,
      blobPath,
      'video/mp4'
    );
  }

  private async cleanup(context: ProcessingContext): Promise<void> {
    this.logger.logStage('Cleanup', 'start');

    try {
      // Delete temporary files
      await this.fileManager.cleanupDirectory(context.tempDir);

      // Delete source assets from Vercel Blob (but keep the song)
      // DISABLED FOR TESTING: Keep input assets in blob storage
      // const videoClipUrls = context.request.videoClips.map(clip => clip.url);
      // await this.blobService.deleteInputAssets(videoClipUrls, context.request.assFile.url);

      this.logger.logStage('Cleanup', 'complete');

    } catch (error) {
      // Log cleanup errors but don't fail the entire process
      this.logger.warn('Cleanup partially failed', { error: (error as Error).message });
    }
  }
} 