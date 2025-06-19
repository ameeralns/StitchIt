import Mux from '@mux/mux-node';
import fs from 'fs/promises';
import { ProcessLogger } from '../utils/logger';
import { ProcessingError, ProcessingErrorCode, ProcessingStage } from '../types';

export interface MuxUploadResult {
  assetId: string;
  playbackId: string;
}

export class MuxService {
  private logger: ProcessLogger;
  private mux: Mux;

  constructor(processId: string) {
    this.logger = new ProcessLogger(processId);
    
    const tokenId = process.env.MUX_TOKEN_ID;
    const tokenSecret = process.env.MUX_TOKEN_SECRET;
    
    if (!tokenId || !tokenSecret) {
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'MUX_TOKEN_ID and MUX_TOKEN_SECRET environment variables are required',
        'Missing Mux credentials'
      );
    }

    this.mux = new Mux({
      tokenId,
      tokenSecret,
    });
  }

  /**
   * Upload video to Mux for streaming
   * This will create a Mux asset and return the asset ID and playback ID
   */
  async uploadVideo(
    localFilePath: string,
    songId: string,
    processId: string,
    songTitle?: string
  ): Promise<MuxUploadResult> {
    const startTime = Date.now();
    this.logger.logStage('Mux Upload', 'start', { localFilePath, songId });

    try {
      // Get file stats
      const fileStats = await fs.stat(localFilePath);
      
      this.logger.info('Uploading video to Mux', {
        localFilePath,
        songId,
        processId,
        fileSize: fileStats.size
      });

      // Create a direct upload for the video file
      const newAssetSettings: any = {
        playback_policy: ['public'],
        video_quality: 'basic',
        normalize_audio: true
      };
      
      // Add title metadata if provided
      if (songTitle) {
        newAssetSettings.meta = {
          title: songTitle
        };
      }
      
      const upload = await this.mux.video.uploads.create({
        new_asset_settings: newAssetSettings,
        cors_origin: '*' // Allow uploads from any origin - adjust as needed
      });

      // Debug log the upload response structure
      this.logger.info('Mux upload created', {
        uploadId: upload.id,
        assetId: upload.asset_id,
        uploadKeys: Object.keys(upload),
        uploadResponse: JSON.stringify(upload, null, 2)
      });

      // Read the video file
      const videoBuffer = await fs.readFile(localFilePath);
      
      // Upload the video file to the signed URL
      const uploadResponse = await fetch(upload.url, {
        method: 'PUT',
        body: videoBuffer,
        headers: {
          'Content-Type': 'video/mp4',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}: ${uploadResponse.statusText}`);
      }

      // Wait for the asset to be created and get the playback ID
      // For Direct Uploads, the asset_id might not be available immediately
      let assetId = upload.asset_id;
      
      // If asset_id is not immediately available, we need to check the upload status
      if (!assetId) {
        this.logger.info('Asset ID not immediately available, checking upload status...', {
          uploadId: upload.id
        });
        
        // Check upload status to get the asset_id
        let uploadStatus;
        let statusRetries = 0;
        const maxStatusRetries = 10;
        
        while (statusRetries < maxStatusRetries && !assetId) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          
          try {
            uploadStatus = await this.mux.video.uploads.retrieve(upload.id);
            assetId = uploadStatus.asset_id;
            
            this.logger.debug('Upload status check', {
              uploadId: upload.id,
              status: uploadStatus.status,
              assetId: uploadStatus.asset_id,
              retry: statusRetries
            });
            
            statusRetries++;
          } catch (error) {
            this.logger.warn('Failed to retrieve upload status', {
              uploadId: upload.id,
              error: (error as Error).message,
              retry: statusRetries
            });
            statusRetries++;
          }
        }
      }
      
      if (!assetId) {
        throw new Error('Mux upload did not return an asset ID after checking status');
      }

      let asset;
      let retries = 0;
      const maxRetries = 30; // Wait up to 5 minutes (30 * 10 seconds)

      this.logger.info('Waiting for Mux asset to be ready', { assetId });

      while (retries < maxRetries) {
        try {
          asset = await this.mux.video.assets.retrieve(assetId);
          
          if (asset.status === 'ready' && asset.playback_ids && asset.playback_ids.length > 0) {
            break;
          } else if (asset.status === 'errored') {
            throw new Error(`Mux asset processing failed: ${asset.errors?.messages?.join(', ') || 'Unknown error'}`);
          }
          
          // Wait 10 seconds before checking again
          await new Promise(resolve => setTimeout(resolve, 10000));
          retries++;
          
          this.logger.debug('Mux asset not ready, retrying...', { 
            assetId, 
            status: asset.status, 
            retry: retries 
          });
          
        } catch (error) {
          if (retries === maxRetries - 1) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 10000));
          retries++;
        }
      }

      if (!asset || asset.status !== 'ready' || !asset.playback_ids || asset.playback_ids.length === 0) {
        throw new Error('Mux asset did not become ready within the timeout period');
      }

      const firstPlaybackId = asset.playback_ids[0];
      if (!firstPlaybackId || !firstPlaybackId.id) {
        throw new Error('Mux asset does not have a valid playback ID');
      }
      const playbackId = firstPlaybackId.id;

      this.logger.logTiming('Mux Upload', startTime, {
        assetId,
        playbackId,
        fileSize: fileStats.size,
        retries
      });

      return {
        assetId,
        playbackId
      };

    } catch (error) {
      this.logger.error('Failed to upload video to Mux', error as Error, {
        localFilePath,
        songId,
        processId
      });
      throw new ProcessingError(
        ProcessingErrorCode.UPLOAD_FAILED,
        ProcessingStage.OUTPUT_UPLOAD,
        'Failed to upload video to Mux',
        (error as Error).message
      );
    }
  }

  /**
   * Delete a Mux asset (cleanup)
   */
  async deleteAsset(assetId: string): Promise<void> {
    const startTime = Date.now();
    this.logger.info('Deleting Mux asset', { assetId });

    try {
      await this.mux.video.assets.delete(assetId);
      
      this.logger.logTiming('Mux Asset Deletion', startTime, { assetId });

    } catch (error) {
      // Log the error but don't throw - cleanup errors are non-fatal
      this.logger.warn('Failed to delete Mux asset', {
        assetId,
        error: (error as Error).message
      });
    }
  }

  /**
   * Get asset information
   */
  async getAsset(assetId: string) {
    try {
      return await this.mux.video.assets.retrieve(assetId);
    } catch (error) {
      this.logger.error('Failed to retrieve Mux asset', error as Error, { assetId });
      throw error;
    }
  }

  validateMuxCredentials(): void {
    const tokenId = process.env.MUX_TOKEN_ID;
    const tokenSecret = process.env.MUX_TOKEN_SECRET;
    
    if (!tokenId || !tokenSecret) {
      throw new ProcessingError(
        ProcessingErrorCode.VALIDATION_ERROR,
        ProcessingStage.VALIDATION,
        'Mux credentials are not configured',
        'MUX_TOKEN_ID and MUX_TOKEN_SECRET environment variables are missing or empty'
      );
    }
  }
} 