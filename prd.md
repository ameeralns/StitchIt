# Product Requirements Document: FFmpeg Video Processing Microservice (Inngest-Optimized)

**Version:** 2.0
**Date:** December 2024
**Author:** [Your Name/Team Name]

---

## 1. Introduction

This document outlines the requirements for an FFmpeg-based microservice responsible for automating the creation of music videos. The service will accept a series of video clips, an ASS subtitle file, and an audio track (song), process them using FFmpeg, and then store the final combined video in Vercel Blob Storage. **All custom fonts required by the ASS file are expected to be pre-installed on the microservice.** The processing will be **synchronous**, designed specifically for use with **Inngest functions** which can handle long-running operations without timeout concerns.

## 2. Goals

*   Automate the creation of custom music videos from provided assets.
*   Process video clips with smooth transitions between consecutive clips.
*   Accurately overlay custom-font ASS subtitles onto the video, using fonts pre-installed on the service.
*   Trim the final video to match the duration of the provided song.
*   Efficiently manage storage by deleting source assets after successful processing.
*   Provide immediate, direct response with the final video URL upon completion.
*   Optimize for Inngest function execution patterns and capabilities.

## 3. Non-Goals

*   Real-time video processing.
*   A user interface (UI) for video editing or previewing.
*   Advanced video effects (e.g., color grading, complex motion graphics beyond transitions).
*   Video encoding optimization for specific devices or platforms (beyond standard web-friendly H.264/AAC).
*   Content moderation or validation of video/audio quality.
*   Authentication/Authorization for API requests (as explicitly stated).
*   Dynamic font downloading by the microservice from external URLs.
*   Asynchronous processing or webhook notifications.
*   Job queuing or background worker systems.

## 4. Target Audience

This microservice is specifically designed for use by **Inngest functions** that need to generate custom music videos programmatically as part of larger workflows.

## 5. Functional Requirements

### 5.1. API Endpoint Definition

The microservice will expose a single RESTful API endpoint for synchronous video processing.

**Endpoint:** `POST /process-video`

**Request Body (JSON):**

```json
{
  "videoClips": [
    {
      "url": "https://<vercel-blob-url>/clip1.mp4",
      "duration": 8 // Expected duration in seconds. Service will assume 8s if not provided
    },
    {
      "url": "https://<vercel-blob-url>/clip2.mp4",
      "duration": 8
    }
    // ... more clips, sent in desired order
  ],
  "assFile": {
    "url": "https://<vercel-blob-url>/subtitles.ass"
  },
  "songUrl": "https://<vercel-blob-url>/my-song.mp3",
  "songId": "unique-song-identifier-123", // A unique ID for the song, used for output path
  "songTitle": "My Awesome Song",        // Optional: Title for logging/metadata
  "outputAspectRatio": "9:16",           // Required: "9:16" (portrait) or "16:9" (landscape)
  "transitionDuration": 0.5              // Optional: Duration of the fade transition in seconds (default: 0.5)
}
```

**Response (HTTP 200 OK):**

The API will process the entire video synchronously and only respond after completion. This blocking behavior is ideal for Inngest functions.

**On Success:**

```json
{
  "status": "completed",
  "outputUrl": "https://<vercel-blob-url>/videos/unique-song-identifier-123/final_video_xyz-456.mp4",
  "thumbnailUrl": "https://<vercel-blob-url>/thumbnails/unique-song-identifier-123/final_video_xyz-456.jpg",
  "duration": 123.45, // Final video duration in seconds
  "message": "Video processed successfully.",
  "processingTimeMs": 45000 // Time taken for processing in milliseconds
}
```

**On Failure:**

```json
{
  "status": "failed",
  "error": {
    "code": "FFMPEG_PROCESSING_ERROR",
    "message": "Video processing failed during concatenation",
    "details": "FFmpeg error: Invalid input format",
    "stage": "video_concatenation"
  }
}
```

### 5.2. Core Video Processing Logic (Synchronous)

The microservice will perform the following steps sequentially within the single API request:

1.  **Request Validation:**
    *   Validate the incoming JSON request structure and required fields.
    *   Generate a unique `processId` for internal tracking and file naming.
    *   Log the start of processing with request details.

2.  **Asset Download:**
    *   Create a unique temporary directory on the local file system (`/tmp/<processId>`).
    *   Download all `videoClips`, the `assFile`, and the `songUrl` from their Vercel Blob URLs.
    *   Verify file integrity and basic format validation.
    *   Error handling: If any download fails, immediately clean up and return a `failed` response.

3.  **Metadata Extraction:**
    *   Use `ffprobe` to determine the exact duration of the `songUrl`.
    *   Optionally verify the duration and properties of video clips.
    *   Calculate transition offsets based on clip durations.
    *   Error handling: If metadata extraction fails, clean up and return a `failed` response.

4.  **FFmpeg Command Construction:**
    *   Build a complex FFmpeg command using `fluent-ffmpeg` library incorporating:
        *   **Video Concatenation & Transitions:** Sequential input of all video clips with `xfade` filter between consecutive clips
        *   **Audio Replacement:** Discard original clip audio and use only the song audio
        *   **Subtitle Overlay:** Apply ASS subtitles using pre-installed fonts
        *   **Aspect Ratio Scaling:** Scale to specified output ratio (9:16 or 16:9)
        *   **Duration Trimming:** Trim final video to match song duration
        *   **Web Optimization:** H.264/AAC encoding with web-friendly settings

5.  **FFmpeg Execution:**
    *   Execute the constructed FFmpeg command synchronously.
    *   Monitor process output for errors and progress.
    *   Error handling: If FFmpeg fails, clean up temporary files and return detailed error response.

6.  **Output Upload:**
    *   Generate a thumbnail from the final video at the 1-second mark as a JPEG image.
    *   Upload the generated video to Vercel Blob Storage at path: `videos/<songId>/final_video_<processId>.mp4`
    *   Upload the generated thumbnail to Vercel Blob Storage at path: `thumbnails/<songId>/final_video_<processId>.jpg`
    *   Verify successful uploads and obtain public URLs.
    *   Error handling: If upload fails, clean up and return a `failed` response.

7.  **Cleanup:**
    *   Delete all temporary local files from `/tmp/<processId>` directory.
    *   Delete original input `videoClips` and `assFile` from Vercel Blob Storage.
    *   Keep the `songUrl` as it's typically reusable.
    *   Log cleanup completion.

8.  **Response:**
    *   Return HTTP 200 with success status and video URL, or HTTP 400/500 with detailed error information.

### 5.3. Error Handling & Logging

*   **Comprehensive Error Categories:**
    *   `VALIDATION_ERROR`: Invalid request format or missing required fields
    *   `DOWNLOAD_FAILED`: Unable to download input assets
    *   `METADATA_EXTRACTION_ERROR`: FFprobe failures
    *   `FFMPEG_PROCESSING_ERROR`: Video processing failures
    *   `UPLOAD_FAILED`: Vercel Blob upload issues
    *   `CLEANUP_ERROR`: File cleanup issues (non-fatal)

*   **Detailed Logging:**
    *   Log each processing stage with timestamps
    *   Include process ID in all log entries
    *   Log FFmpeg commands and output for debugging
    *   Structured logging format for easy parsing

## 6. Non-Functional Requirements

### 6.1. Performance

*   **Processing Time:** Target processing time for a typical 2-3 minute video should be under 3 minutes.
*   **Resource Usage:** Optimize for single-request processing with predictable resource consumption.
*   **Memory Management:** Efficient handling of temporary files and memory usage during FFmpeg operations.

### 6.2. Scalability

*   **Inngest Compatibility:** Designed for Inngest's execution model with long-running capabilities.
*   **Stateless Design:** Each request is completely independent with no shared state.
*   **Resource Isolation:** Each processing request uses isolated temporary directories.

### 6.3. Reliability

*   **Synchronous Reliability:** All-or-nothing processing with immediate success/failure feedback.
*   **Cleanup Guarantees:** Temporary files are always cleaned up, even on failures.
*   **Inngest Integration:** Leverage Inngest's built-in retry and error handling capabilities.

### 6.4. Security

*   **No Authentication:** As explicitly requested, the API will not require authentication.
*   **Input Validation:** Comprehensive validation of all input parameters and URLs.
*   **Secure File Handling:** Safe temporary file creation and cleanup.
*   **Environment Variables:** Secure storage of `BLOB_READ_WRITE_TOKEN`.

### 6.5. Observability

*   **Structured Logging:** JSON-formatted logs with consistent fields across all operations.
*   **Processing Metrics:** Track processing duration, success rates, and error frequencies.
*   **Resource Monitoring:** Monitor disk space, memory usage, and FFmpeg performance.

## 7. Technical Considerations

### 7.1. Technology Stack

*   **Language & Runtime:** TypeScript / Node.js (18+)
*   **Web Framework:** Express.js for the API endpoint
*   **FFmpeg Integration:** `fluent-ffmpeg` library with FFmpeg binary
*   **HTTP Client:** `axios` for downloading blob URLs with proper timeout handling
*   **Blob Storage:** `@vercel/blob` SDK for Vercel Blob storage operations
*   **File System:** Native Node.js `fs` operations for temporary file management

### 7.2. Deployment Environment

*   **Container Platform:** Docker-based deployment on platforms supporting long-running processes:
    *   Google Cloud Run (with maximum timeout settings)
    *   AWS App Runner
    *   Azure Container Apps
    *   Traditional VMs or Kubernetes clusters

*   **Resource Requirements:**
    *   CPU: 2+ cores for FFmpeg processing
    *   Memory: 4GB+ for video processing operations
    *   Disk: Sufficient temporary storage for video files
    *   Network: Reliable connectivity for blob storage operations

### 7.3. Docker Configuration

```dockerfile
FROM node:18-bullseye

# Install FFmpeg and font dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Install custom fonts (add your specific fonts here)
COPY fonts/ /usr/share/fonts/custom/
RUN fc-cache -fv

# Application setup
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
```

## 8. FFmpeg Processing Details

### 8.1. Command Structure

The FFmpeg command will follow this general pattern:

```bash
ffmpeg \
  -i video1.mp4 -i video2.mp4 -i videoN.mp4 -i song.mp3 -i subtitles.ass \
  -filter_complex "
    [0:v]scale=${width}:${height},setsar=1[v0];
    [1:v]scale=${width}:${height},setsar=1[v1];
    [2:v]scale=${width}:${height},setsar=1[v2];
    [v0][v1]xfade=transition=fade:duration=${transitionDuration}:offset=${offset1}[v01];
    [v01][v2]xfade=transition=fade:duration=${transitionDuration}:offset=${offset2}[v012];
    [v012]ass=subtitles.ass[vout]
  " \
  -map "[vout]" -map 3:a \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -t ${songDuration} \
  output.mp4
```

### 8.2. Aspect Ratio Handling

*   **9:16 (Portrait):** Scale to 1080x1920
*   **16:9 (Landscape):** Scale to 1920x1080
*   **Letterboxing:** Applied automatically if source aspect ratio differs

## 9. Integration with Inngest

### 9.1. Recommended Inngest Function Pattern

```typescript
export const processVideoWorkflow = inngest.createFunction(
  { 
    id: "process-video-workflow",
    concurrency: { limit: 3 } // Limit concurrent video processing
  },
  { event: "video.process.requested" },
  async ({ event, step }) => {
    const result = await step.run("ffmpeg-processing", async () => {
      const response = await fetch(`${FFMPEG_SERVICE_URL}/process-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.data),
        timeout: 600000 // 10 minute timeout
      });
      
      if (!response.ok) {
        throw new Error(`FFmpeg service failed: ${response.statusText}`);
      }
      
      return await response.json();
    });
    
    // Handle the result (save to database, trigger other workflows, etc.)
    await step.run("save-result", async () => {
      // Your post-processing logic here
      return { videoUrl: result.outputUrl, duration: result.duration };
    });
  }
);
```

### 9.2. Error Handling in Inngest

```typescript
export const processVideoWithRetry = inngest.createFunction(
  { 
    id: "process-video-with-retry",
    retries: 2 // Inngest handles retries automatically
  },
  { event: "video.process.requested" },
  async ({ event, step, attempt }) => {
    try {
      return await step.run("process-video", async () => {
        // FFmpeg service call
      });
    } catch (error) {
      // Log error details
      console.error(`Video processing failed (attempt ${attempt}):`, error);
      throw error; // Let Inngest handle retries
    }
  }
);
```

## 10. Open Questions & Future Considerations

*   **Concurrency Limits:** What's the maximum number of concurrent video processing operations the deployment should support?
*   **Custom Font Management:** Process for adding new fonts to the Docker image and redeployment workflow.
*   **Quality Presets:** Should we offer different quality/speed presets (fast/balanced/high-quality)?
*   **Progress Monitoring:** Would it be valuable to add progress streaming for very long videos?
*   **Caching:** Should we implement caching for frequently used songs or common clip combinations?
*   **Resource Monitoring:** Implementation of resource usage monitoring and automatic scaling triggers.

---

This revised PRD is optimized for Inngest functions, providing synchronous processing that leverages Inngest's capabilities for long-running operations, built-in retries, and comprehensive error handling.