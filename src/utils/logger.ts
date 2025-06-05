import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'ffmpeg-video-processor'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error'
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log'
  }));
}

export class ProcessLogger {
  constructor(private processId: string) {}

  info(message: string, meta?: any) {
    logger.info(message, { processId: this.processId, ...meta });
  }

  error(message: string, error?: Error, meta?: any) {
    logger.error(message, { 
      processId: this.processId, 
      error: error?.message,
      stack: error?.stack,
      ...meta 
    });
  }

  warn(message: string, meta?: any) {
    logger.warn(message, { processId: this.processId, ...meta });
  }

  debug(message: string, meta?: any) {
    logger.debug(message, { processId: this.processId, ...meta });
  }

  logStage(stage: string, action: 'start' | 'complete' | 'error', meta?: any) {
    const message = `${stage.toUpperCase()}: ${action}`;
    if (action === 'error') {
      this.error(message, undefined, meta);
    } else {
      this.info(message, meta);
    }
  }

  logTiming(stage: string, startTime: number, meta?: any) {
    const duration = Date.now() - startTime;
    this.info(`${stage.toUpperCase()}: completed in ${duration}ms`, { duration, ...meta });
  }
} 