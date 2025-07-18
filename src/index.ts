import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger } from './utils/logger';
import { VideoProcessor } from './services/videoProcessor';
import { ProcessingError, ProcessVideoErrorResponse } from './types';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for large request payloads

// Authorization middleware for API key validation
const authenticateApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const providedApiKey = req.headers['x-api-key'] as string;
  const validApiKey = process.env.X_API_KEY;

  // Check if API key is configured
  if (!validApiKey) {
    logger.error('X_API_KEY not configured in environment variables');
    res.status(500).json({
      status: 'failed',
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'API key not configured on server',
        details: 'Server configuration error',
        stage: 'authentication'
      }
    });
    return;
  }

  // Check if API key is provided
  if (!providedApiKey) {
    logger.warn('Unauthorized access attempt - no API key provided', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      url: req.url
    });
    res.status(401).json({
      status: 'failed',
      error: {
        code: 'UNAUTHORIZED',
        message: 'API key required',
        details: 'Please provide a valid X-API-Key header',
        stage: 'authentication'
      }
    });
    return;
  }

  // Check if API key is valid
  if (providedApiKey !== validApiKey) {
    logger.warn('Unauthorized access attempt - invalid API key', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      url: req.url,
      providedKey: providedApiKey.substring(0, 8) + '...' // Log only first 8 chars for security
    });
    res.status(401).json({
      status: 'failed',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid API key',
        details: 'The provided API key is not valid',
        stage: 'authentication'
      }
    });
    return;
  }

  // API key is valid, proceed to next middleware
  logger.debug('API key validation successful', {
    ip: req.ip,
    url: req.url
  });
  next();
};

// Health check endpoint (no authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'ffmpeg-video-processor'
  });
});

// Main video processing endpoint (protected with API key)
app.post('/process-video', authenticateApiKey, async (req, res) => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || 'unknown';
  
  logger.info('Received video processing request', {
    requestId,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length']
  });

  try {
    // Create video processor instance
    const processor = new VideoProcessor();
    
    // Process video (this is the synchronous operation)
    const result = await processor.processVideo(req.body);
    
    // Log successful completion
    const processingTime = Date.now() - startTime;
    logger.info('Video processing request completed successfully', {
      requestId,
      processingTime,
      muxAssetId: result.muxAssetId,
      muxPlaybackId: result.muxPlaybackId,
      duration: result.duration
    });

    // Return successful response
    res.status(200).json(result);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Video processing request failed', error as Error, {
      requestId,
      processingTime,
      body: req.body
    });

    // Handle ProcessingError with detailed response
    if (error instanceof ProcessingError) {
      const errorResponse: ProcessVideoErrorResponse = {
        status: 'failed',
        error: {
          code: error.code,
          message: error.message,
          details: error.details || 'No additional details available',
          stage: error.stage
        }
      };

      // Different HTTP status codes based on error type
      const statusCode = getHttpStatusCode(error.code);
      res.status(statusCode).json(errorResponse);
    } else {
      // Handle unexpected errors
      const errorResponse: ProcessVideoErrorResponse = {
        status: 'failed',
        error: {
          code: 'INTERNAL_SERVER_ERROR' as any,
          message: 'An unexpected error occurred during video processing',
          details: (error as Error).message,
          stage: 'unknown' as any
        }
      };

      res.status(500).json(errorResponse);
    }
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error in Express middleware', error, {
    method: req.method,
    url: req.url,
    headers: req.headers
  });

  res.status(500).json({
    status: 'failed',
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      details: error.message,
      stage: 'server'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'failed',
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      details: `${req.method} ${req.path} is not a valid endpoint`,
      stage: 'routing'
    }
  });
});

function getHttpStatusCode(errorCode: string): number {
  switch (errorCode) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'DOWNLOAD_FAILED':
    case 'METADATA_EXTRACTION_ERROR':
    case 'FFMPEG_PROCESSING_ERROR':
    case 'UPLOAD_FAILED':
    case 'CONFIGURATION_ERROR':
      return 500;
    case 'CLEANUP_ERROR':
      return 200; // Cleanup errors are non-fatal
    default:
      return 500;
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(port, () => {
  logger.info('FFmpeg Video Processor started', {
    port,
    nodeEnv: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0'
  });
});

export default app; 