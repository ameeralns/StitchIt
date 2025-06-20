# FFmpeg Video Processing Microservice

A synchronous FFmpeg-based microservice for automated music video creation, optimized for use with Inngest functions.

## 🎯 Features

- **Video Concatenation**: Seamlessly stitch multiple video clips with smooth fade transitions
- **Subtitle Overlay**: Apply ASS subtitle files with pre-installed custom fonts
- **Audio Replacement**: Replace original video audio with provided song tracks
- **Aspect Ratio Conversion**: Support for both 9:16 (portrait) and 16:9 (landscape) outputs
- **Automatic Trimming**: Trim final video to match song duration
- **Thumbnail Generation**: Automatically generate video thumbnails from the 1-second mark
- **Vercel Blob Integration**: Direct upload to and cleanup from Vercel Blob storage
- **Comprehensive Logging**: Structured logging for debugging and monitoring
- **Synchronous Processing**: Perfect for Inngest function integration

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Inngest       │    │   Microservice  │    │  Vercel Blob    │
│   Function      │───▶│   /process-video│───▶│   Storage       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │    FFmpeg       │
                       │   Processing    │
                       └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- FFmpeg installed on your system
- Vercel Blob storage account
- (Optional) Custom fonts installed system-wide

### 1. Installation

```bash
# Clone the repository
git clone <repository-url>
cd ffmpeg-video-processor

# Install dependencies
npm install

# Copy environment configuration
cp env.example .env
```

### 2. Environment Configuration

Edit `.env` file with your configuration:

```bash
# Required: Vercel Blob Storage Token
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token_here

# Required: API Key for authentication
X_API_KEY=your_secure_api_key_here

# Optional: Server Configuration
PORT=8080
NODE_ENV=development
LOG_LEVEL=info
```

### 3. Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### 4. System Requirements

Make sure you have FFmpeg installed on your system:

- **Ubuntu/Debian**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg`  
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## 📋 API Reference

### Authentication

All endpoints except `/health` require authentication using an API key.

**Headers:**
- `X-API-Key`: Your API key (configured via `X_API_KEY` environment variable)
- `Content-Type`: `application/json`

**Authentication Errors:**

```json
{
  "status": "failed",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "API key required", // or "Invalid API key"
    "details": "Please provide a valid X-API-Key header",
    "stage": "authentication"
  }
}
```

### POST /process-video

Processes video clips, applies subtitles, and creates a final music video.

**Headers:**
- `X-API-Key`: Required - Your API key
- `Content-Type`: `application/json`

**Request Body:**

```json
{
  "videoClips": [
    {
      "url": "https://blob-url/clip1.mp4",
      "duration": 8
    },
    {
      "url": "https://blob-url/clip2.mp4", 
      "duration": 8
    }
  ],
  "assFile": {
    "url": "https://blob-url/subtitles.ass"
  },
  "songUrl": "https://blob-url/song.mp3",
  "songId": "unique-song-123",
  "songTitle": "My Awesome Song",
  "outputAspectRatio": "9:16",
  "transitionDuration": 0.5
}
```

**Success Response (200):**

```json
{
  "status": "completed",
  "muxAssetId": "abc123-def456-ghi789",
  "muxPlaybackId": "xyz789-uvw456-rst123",
  "duration": 123.45,
  "message": "Video processed successfully.",
  "processingTimeMs": 45000
}
```

**Error Response (400/500):**

```json
{
  "status": "failed",
  "error": {
    "code": "FFMPEG_PROCESSING_ERROR",
    "message": "Video processing failed",
    "details": "Detailed error description",
    "stage": "video_processing"
  }
}
```

### GET /health

Health check endpoint for monitoring. **No authentication required.**

**Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2024-12-19T10:30:00.000Z",
  "service": "ffmpeg-video-processor"
}
```

## 🎬 Inngest Integration

### Example Inngest Function

```typescript
import { inngest } from './inngest';

export const processVideoWorkflow = inngest.createFunction(
  { 
    id: "process-video-workflow",
    concurrency: { limit: 3 }
  },
  { event: "video.process.requested" },
  async ({ event, step }) => {
    const result = await step.run("ffmpeg-processing", async () => {
      const response = await fetch(`${FFMPEG_SERVICE_URL}/process-video`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-API-Key": process.env.FFMPEG_API_KEY 
        },
        body: JSON.stringify(event.data),
        timeout: 600000 // 10 minute timeout
      });
      
      if (!response.ok) {
        throw new Error(`FFmpeg service failed: ${response.statusText}`);
      }
      
      return await response.json();
    });
    
    return { videoUrl: result.outputUrl, duration: result.duration };
  }
);
```

## 🎥 Mux Integration

This service integrates with [Mux](https://mux.com) for optimized video streaming and delivery. After processing, videos are uploaded to both:

1. **Vercel Blob Storage** - For backup and direct access
2. **Mux Video Platform** - For optimized streaming with adaptive bitrates

### Mux Setup

1. Create a Mux account at [mux.com](https://mux.com)
2. Generate API credentials in your Mux dashboard
3. Add your credentials to the environment variables:

```bash
MUX_TOKEN_ID=your_mux_token_id_here
MUX_TOKEN_SECRET=your_mux_token_secret_here
```

### Playback

With the Mux playback ID returned from the API, you can:

- **HLS Streaming**: `https://stream.mux.com/{playbackId}.m3u8`
- **MP4 Download**: `https://stream.mux.com/{playbackId}.mp4`
- **Thumbnails**: `https://image.mux.com/{playbackId}/thumbnail.jpg`
- **Animated GIFs**: `https://image.mux.com/{playbackId}/animated.gif`

### Benefits

- **Adaptive Streaming**: Automatically adjusts quality based on viewer's connection
- **Global CDN**: Fast delivery worldwide
- **Analytics**: Built-in video performance metrics
- **Thumbnails & GIFs**: Automatic generation of preview media

## 🔧 Configuration

### Font Management

To add custom fonts to your system:

**Linux (Ubuntu/Debian):**
```bash
# Copy fonts to system directory
sudo mkdir -p /usr/share/fonts/custom
sudo cp your-fonts/*.ttf /usr/share/fonts/custom/
sudo fc-cache -fv
```

**macOS:**
```bash
# Copy fonts to system directory
sudo cp your-fonts/*.ttf /System/Library/Fonts/
# Or use Font Book app to install fonts
```

**Windows:**
```bash
# Copy fonts to Windows fonts directory
copy your-fonts\*.ttf C:\Windows\Fonts\
```

### Resource Requirements

**Minimum:**
- CPU: 2 cores
- Memory: 4GB
- Disk: 20GB (for temporary files)

**Recommended:**
- CPU: 4 cores
- Memory: 8GB
- Disk: 50GB

### Performance Tuning

**FFmpeg Settings:**
- Preset: `medium` (balance of speed/quality)
- CRF: `23` (good quality)
- Audio bitrate: `128k`

**Concurrency:**
- Limit concurrent requests based on available resources
- Each video processing uses ~2GB RAM and 1-2 CPU cores

## 📊 Monitoring

### Logging

The service produces structured JSON logs:

```json
{
  "timestamp": "2024-12-19T10:30:00.000Z",
  "level": "info",
  "message": "Video processing completed",
  "processId": "abc-123",
  "processingTimeMs": 45000,
  "service": "ffmpeg-video-processor"
}
```

### Metrics

Key metrics to monitor:
- Processing duration
- Success/failure rates
- Memory usage
- Disk space utilization
- Queue depth (if using message queues)

## 🔍 Troubleshooting

### Common Issues

**1. FFmpeg Not Found**
```
Error: FFmpeg is not installed or not accessible
```
**Solution:** Ensure FFmpeg is installed in the container

**2. Font Missing**
```
Warning: Font 'CustomFont' not found, using fallback
```
**Solution:** Install font files on your system and rebuild font cache

**3. Out of Memory**
```
Error: Cannot allocate memory
```
**Solution:** Increase container memory allocation

**4. Blob Upload Failed**
```
Error: Failed to upload video to Vercel Blob storage
```
**Solution:** Check `BLOB_READ_WRITE_TOKEN` and network connectivity

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

## 📝 API Examples

### cURL Example

```bash
curl -X POST http://localhost:8080/process-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{
    "videoClips": [
      {"url": "https://blob-url/clip1.mp4", "duration": 8},
      {"url": "https://blob-url/clip2.mp4", "duration": 8}
    ],
    "assFile": {"url": "https://blob-url/subtitles.ass"},
    "songUrl": "https://blob-url/song.mp3",
    "songId": "test-song-123",
    "outputAspectRatio": "9:16"
  }'
```

### Node.js Example

```javascript
const response = await fetch('http://localhost:8080/process-video', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'X-API-Key': 'your_api_key_here'
  },
  body: JSON.stringify({
    videoClips: [
      { url: 'https://blob-url/clip1.mp4', duration: 8 },
      { url: 'https://blob-url/clip2.mp4', duration: 8 }
    ],
    assFile: { url: 'https://blob-url/subtitles.ass' },
    songUrl: 'https://blob-url/song.mp3',
    songId: 'test-song-123',
    outputAspectRatio: '9:16'
  })
});

const result = await response.json();
console.log('Video URL:', result.outputUrl);
console.log('Thumbnail URL:', result.thumbnailUrl);
```

## 🔗 Related Documentation

- [Product Requirements Document](./prd.md)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [Vercel Blob API](https://vercel.com/docs/storage/vercel-blob)
- [Inngest Documentation](https://www.inngest.com/docs)

## 📄 License

MIT License - see LICENSE file for details 