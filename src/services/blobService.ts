import { put, del } from '@vercel/blob';
import fs from 'fs/promises';
import { ProcessLogger } from '../utils/logger';
import { ProcessingError, ProcessingErrorCode, ProcessingStage } from '../types';

export class BlobService {
  private logger: ProcessLogger;
  private token: string;

  constructor(processId: string) {
    this.logger = new ProcessLogger(processId);
    this.token = process.env.BLOB_READ_WRITE_TOKEN || '';
    
    if (!this.token) {
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'BLOB_READ_WRITE_TOKEN environment variable is required',
        'Missing Vercel Blob token'
      );
    }
  }

  async uploadVideo(
    localFilePath: string,
    blobPath: string,
    contentType: string = 'video/mp4'
  ): Promise<string> {
    const startTime = Date.now();
    this.logger.logStage('Video Upload', 'start', { localFilePath, blobPath });

    try {
      // Read the file
      const fileBuffer = await fs.readFile(localFilePath);
      const fileStats = await fs.stat(localFilePath);
      
      this.logger.info('Uploading video to Vercel Blob', {
        localFilePath,
        blobPath,
        fileSize: fileStats.size,
        contentType
      });

      // Upload to Vercel Blob
      const blob = await put(blobPath, fileBuffer, {
        access: 'public',
        token: this.token,
        contentType
      });

      this.logger.logTiming('Video Upload', startTime, {
        url: blob.url,
        fileSize: fileStats.size,
        blobPath
      });

      return blob.url;

    } catch (error) {
      this.logger.error('Failed to upload video to Vercel Blob', error as Error, {
        localFilePath,
        blobPath
      });
      throw new ProcessingError(
        ProcessingErrorCode.UPLOAD_FAILED,
        ProcessingStage.OUTPUT_UPLOAD,
        'Failed to upload video to Vercel Blob storage',
        (error as Error).message
      );
    }
  }

  async deleteBlob(url: string, description: string): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Deleting ${description} from Vercel Blob`, { url });

    try {
      await del(url, { token: this.token });
      
      this.logger.logTiming(`Delete ${description}`, startTime, { url });

    } catch (error) {
      // Log the error but don't throw - cleanup errors are non-fatal
      this.logger.warn(`Failed to delete ${description} from Vercel Blob`, {
        url,
        error: (error as Error).message
      });
    }
  }

  async deleteInputAssets(videoClipUrls: string[], assFileUrl: string): Promise<void> {
    this.logger.logStage('Asset Cleanup', 'start', {
      videoClipCount: videoClipUrls.length,
      assFileUrl
    });

    // Delete video clips
    const deletePromises = videoClipUrls.map((url, index) => 
      this.deleteBlob(url, `video clip ${index + 1}`)
    );

    // Delete ASS file
    deletePromises.push(this.deleteBlob(assFileUrl, 'ASS subtitle file'));

    // Execute all deletions in parallel
    await Promise.allSettled(deletePromises);

    this.logger.logStage('Asset Cleanup', 'complete', {
      deletedAssets: videoClipUrls.length + 1
    });
  }

  validateBlobToken(): void {
    if (!this.token) {
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'Vercel Blob token is not configured',
        'BLOB_READ_WRITE_TOKEN environment variable is missing or empty'
      );
    }
  }
} 