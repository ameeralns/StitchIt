import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ProcessLogger } from '../utils/logger';
import { 
  ProcessingError, 
  ProcessingErrorCode, 
  ProcessingStage, 
  ProcessingContext,
  ASPECT_RATIO_CONFIGS
} from '../types';

const execAsync = promisify(exec);

export class FFmpegService {
  private logger: ProcessLogger;

  constructor(processId: string) {
    this.logger = new ProcessLogger(processId);
  }

  async extractMetadata(filePath: string, description: string): Promise<any> {
    const startTime = Date.now();
    this.logger.info(`Extracting metadata for ${description}`, { filePath });

    try {
      const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
      const { stdout } = await execAsync(command);
      const metadata = JSON.parse(stdout);
      
      this.logger.logTiming(`Metadata extraction for ${description}`, startTime, {
        filePath,
        duration: parseFloat(metadata.format.duration)
      });

      return metadata;
    } catch (error) {
      this.logger.error(`Failed to extract metadata for ${description}`, error as Error, { filePath });
      throw new ProcessingError(
        ProcessingErrorCode.METADATA_EXTRACTION_ERROR,
        ProcessingStage.METADATA_EXTRACTION,
        `Failed to extract metadata for ${description}`,
        (error as Error).message
      );
    }
  }

  async getSongDuration(songPath: string): Promise<number> {
    const metadata = await this.extractMetadata(songPath, 'song audio');
    return parseFloat(metadata.format.duration);
  }

  calculateTransitionOffsets(clipDurations: number[], transitionDuration: number): number[] {
    const offsets: number[] = [];
    let cumulativeDuration = 0;

    for (let i = 0; i < clipDurations.length - 1; i++) {
      cumulativeDuration += clipDurations[i]! - transitionDuration;
      offsets.push(cumulativeDuration);
    }

    return offsets;
  }

  buildFilterComplex(
    context: ProcessingContext
  ): string {
    const { request, localFiles, metadata } = context;
    const { width, height } = ASPECT_RATIO_CONFIGS[request.outputAspectRatio]!;
    const transitionDuration = request.transitionDuration || 0.5;
    
    let filterComplex = '';
    
    // Scale all video inputs
    for (let i = 0; i < localFiles.videoClips.length; i++) {
      filterComplex += `[${i}:v]scale=${width}:${height},setsar=1[v${i}];`;
    }

    // Build transition chain
    if (localFiles.videoClips.length === 1) {
      // Single video, no transitions needed
      filterComplex += `[v0]`;
    } else {
      // Multiple videos, apply xfade transitions
      let currentLabel = 'v0';
      
      for (let i = 1; i < localFiles.videoClips.length; i++) {
        const offset = metadata.transitionOffsets[i - 1]!;
        const nextLabel = i === localFiles.videoClips.length - 1 ? 'video_out' : `v${i}_fade`;
        
        filterComplex += `[${currentLabel}][v${i}]xfade=transition=fade:duration=${transitionDuration}:offset=${offset}[${nextLabel}];`;
        currentLabel = nextLabel;
      }
    }

    // Apply subtitles with local fonts directory
    const fontsDir = path.join(process.cwd(), 'fonts');
    const assInputIndex = localFiles.videoClips.length + 1; // +1 for song audio
    if (localFiles.videoClips.length === 1) {
      filterComplex += `[v0]ass=${localFiles.assFile}:fontsdir=${fontsDir}[vout]`;
    } else {
      filterComplex += `[video_out]ass=${localFiles.assFile}:fontsdir=${fontsDir}[vout]`;
    }

    this.logger.info('Built filter complex', { 
      filterComplex,
      clipCount: localFiles.videoClips.length,
      transitionDuration,
      aspectRatio: request.outputAspectRatio
    });

    return filterComplex;
  }

  async processVideo(context: ProcessingContext): Promise<void> {
    const startTime = Date.now();
    this.logger.logStage('Video Processing', 'start', {
      clipCount: context.localFiles.videoClips.length,
      outputAspectRatio: context.request.outputAspectRatio
    });

    return new Promise((resolve, reject) => {
      try {
        const { localFiles, metadata, request } = context;
        const filterComplex = this.buildFilterComplex(context);

        // Create FFmpeg command
        let command = ffmpeg();

        // Add video clip inputs
        localFiles.videoClips.forEach(clipPath => {
          command = command.input(clipPath);
        });

        // Add audio input (song)
        command = command.input(localFiles.songFile);

        // Add ASS subtitle input
        command = command.input(localFiles.assFile);

        // Apply filter complex
        command = command.complexFilter(filterComplex, ['vout']);

        // Map outputs
        command = command
          .outputOptions([
            '-map', '[vout]',  // Use processed video
            `-map`, `${localFiles.videoClips.length}:a`, // Use song audio (not clip audio)
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-t', metadata.songDuration.toString() // Trim to song duration
          ])
          .output(localFiles.outputFile);

        // Set up event handlers
        command.on('start', (commandLine: string) => {
          this.logger.info('FFmpeg command started', { commandLine });
        });

        command.on('progress', (progress: any) => {
          this.logger.debug('FFmpeg progress', { 
            percent: progress.percent,
            timemark: progress.timemark 
          });
        });

        command.on('error', (error: any) => {
          this.logger.error('FFmpeg processing failed', error, {
            clipCount: localFiles.videoClips.length,
            songDuration: metadata.songDuration
          });
          reject(new ProcessingError(
            ProcessingErrorCode.FFMPEG_PROCESSING_ERROR,
            ProcessingStage.VIDEO_PROCESSING,
            'FFmpeg video processing failed',
            error.message
          ));
        });

        command.on('end', () => {
          this.logger.logTiming('Video Processing', startTime, {
            outputFile: localFiles.outputFile,
            songDuration: metadata.songDuration
          });
          resolve();
        });

        // Start processing
        command.run();

      } catch (error) {
        this.logger.error('Failed to start FFmpeg processing', error as Error);
        reject(new ProcessingError(
          ProcessingErrorCode.FFMPEG_PROCESSING_ERROR,
          ProcessingStage.VIDEO_PROCESSING,
          'Failed to start FFmpeg processing',
          (error as Error).message
        ));
      }
    });
  }

  async verifyFFmpegInstallation(): Promise<void> {
    try {
      const { stdout } = await execAsync('ffmpeg -version');
      this.logger.info('FFmpeg version verified', { version: stdout.split('\n')[0] });
    } catch (error) {
      this.logger.error('FFmpeg not found or not working', error as Error);
      throw new ProcessingError(
        ProcessingErrorCode.FFMPEG_PROCESSING_ERROR,
        ProcessingStage.VALIDATION,
        'FFmpeg is not installed or not accessible',
        (error as Error).message
      );
    }
  }

  async verifyFontsDirectory(): Promise<void> {
    const fontsDir = path.join(process.cwd(), 'fonts');
    try {
      const fs = await import('fs/promises');
      const fontFiles = await fs.readdir(fontsDir);
      const ttfFiles = fontFiles.filter(file => file.endsWith('.ttf') || file.endsWith('.otf'));
      
      this.logger.info('Fonts directory verified', { 
        fontsDir,
        totalFiles: fontFiles.length,
        fontFiles: ttfFiles
      });
      
      if (ttfFiles.length === 0) {
        this.logger.warn('No font files found in fonts directory', { fontsDir });
      }
    } catch (error) {
      this.logger.warn('Fonts directory not found or not accessible', { 
        fontsDir,
        error: (error as Error).message 
      });
    }
  }
} 