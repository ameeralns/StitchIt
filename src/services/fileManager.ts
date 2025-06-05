import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ProcessLogger } from '../utils/logger';
import { ProcessingError, ProcessingErrorCode, ProcessingStage } from '../types';

export class FileManager {
  private logger: ProcessLogger;

  constructor(processId: string) {
    this.logger = new ProcessLogger(processId);
  }

  async createTempDirectory(processId: string): Promise<string> {
    const tempDir = path.join('/tmp', processId);
    
    try {
      await fs.mkdir(tempDir, { recursive: true });
      this.logger.info('Created temporary directory', { tempDir });
      return tempDir;
    } catch (error) {
      this.logger.error('Failed to create temporary directory', error as Error, { tempDir });
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'Failed to create temporary directory',
        (error as Error).message
      );
    }
  }

  async downloadFile(url: string, destination: string, description: string): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Downloading ${description}`, { url, destination });

    try {
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 300000, // 5 minutes timeout
        headers: {
          'User-Agent': 'FFmpeg-Video-Processor/1.0'
        }
      });

      const writer = await fs.open(destination, 'w');
      
      await new Promise<void>((resolve, reject) => {
        const writeStream = writer.createWriteStream();
        response.data.pipe(writeStream);
        response.data.on('error', reject);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      await writer.close();

      // Verify file was downloaded successfully
      const stats = await fs.stat(destination);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }

      this.logger.logTiming(`Download ${description}`, startTime, { 
        url, 
        destination, 
        fileSize: stats.size 
      });

    } catch (error) {
      this.logger.error(`Failed to download ${description}`, error as Error, { url, destination });
      throw new ProcessingError(
        ProcessingErrorCode.DOWNLOAD_FAILED,
        ProcessingStage.ASSET_DOWNLOAD,
        `Failed to download ${description}`,
        (error as Error).message
      );
    }
  }

  async downloadAssets(
    videoClipUrls: string[],
    assFileUrl: string,
    songUrl: string,
    tempDir: string
  ): Promise<{
    videoClips: string[];
    assFile: string;
    songFile: string;
  }> {
    const startTime = Date.now();
    this.logger.logStage('Asset Download', 'start', { 
      videoClipCount: videoClipUrls.length,
      assFileUrl,
      songUrl 
    });

    try {
      // Download video clips
      const videoClips: string[] = [];
      for (let i = 0; i < videoClipUrls.length; i++) {
        const clipPath = path.join(tempDir, `clip_${i + 1}.mp4`);
        await this.downloadFile(videoClipUrls[i]!, clipPath, `video clip ${i + 1}`);
        videoClips.push(clipPath);
      }

      // Download ASS file
      const assFile = path.join(tempDir, 'subtitles.ass');
      await this.downloadFile(assFileUrl, assFile, 'ASS subtitle file');

      // Download song
      const songFile = path.join(tempDir, 'song.mp3');
      await this.downloadFile(songUrl, songFile, 'song audio');

      this.logger.logTiming('Asset Download', startTime, {
        videoClipCount: videoClips.length,
        totalFiles: videoClips.length + 2
      });

      return {
        videoClips,
        assFile,
        songFile
      };

    } catch (error) {
      // Clean up any partially downloaded files
      await this.cleanupDirectory(tempDir).catch(() => {
        // Ignore cleanup errors during error handling
      });
      throw error;
    }
  }

  async cleanupDirectory(dirPath: string): Promise<void> {
    const startTime = Date.now();
    this.logger.logStage('Cleanup', 'start', { dirPath });

    try {
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (exists) {
        await fs.rm(dirPath, { recursive: true, force: true });
        this.logger.logTiming('Cleanup', startTime, { dirPath });
      } else {
        this.logger.info('Directory does not exist, nothing to clean up', { dirPath });
      }
    } catch (error) {
      this.logger.error('Failed to cleanup directory', error as Error, { dirPath });
      throw new ProcessingError(
        ProcessingErrorCode.CLEANUP_ERROR,
        ProcessingStage.CLEANUP,
        'Failed to cleanup temporary directory',
        (error as Error).message
      );
    }
  }

  generateFileName(songId: string, processId: string, extension: string): string {
    return `final_video_${processId}.${extension}`;
  }

  generateBlobPath(songId: string, fileName: string): string {
    return `videos/${songId}/${fileName}`;
  }
} 