#!/usr/bin/env node
import path from 'path';
import fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

async function getSubtitleDuration(assFilePath: string): Promise<number> {
  try {
    const content = await fs.readFile(assFilePath, 'utf-8');
    const lines = content.split('\n');
    
    let maxEndTime = 0;
    
    // Parse dialogue lines to find the latest end time
    for (const line of lines) {
      if (line.startsWith('Dialogue:')) {
        // Extract start and end times
        const parts = line.split(',');
        if (parts.length >= 3) {
          const endTimeStr = parts[2]?.trim() || '';
          const endTime = parseTimeToSeconds(endTimeStr);
          if (endTime > maxEndTime) {
            maxEndTime = endTime;
          }
        }
      }
    }
    
    // Add 2 seconds padding
    return maxEndTime + 2;
  } catch (error) {
    console.error('Error parsing ASS file for duration:', error);
    // Default to 30 seconds if parsing fails
    return 30;
  }
}

function parseTimeToSeconds(timeStr: string): number {
  // Parse time format H:MM:SS.CC
  const match = timeStr.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  const centiseconds = parseInt(match[4] || '0');
  
  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

async function generateVerticalVideo(assFilePath: string, outputPath?: string): Promise<void> {
  // Validate input file exists
  try {
    await fs.access(assFilePath);
  } catch (error) {
    console.error(`ASS file not found: ${assFilePath}`);
    process.exit(1);
  }

  // Set output path
  const inputFileName = path.basename(assFilePath, '.ass');
  const finalOutputPath = outputPath || `${inputFileName}_vertical.mp4`;
  
  // Get duration from subtitle file
  const duration = await getSubtitleDuration(assFilePath);
  console.log(`Detected subtitle duration: ${duration}s`);

  // Get fonts directory
  const fontsDir = path.join(process.cwd(), 'fonts');
  
  // Check if fonts directory exists
  try {
    await fs.access(fontsDir);
    console.log(`Using fonts from: ${fontsDir}`);
  } catch (error) {
    console.warn('Fonts directory not found, using system fonts');
  }

  console.log(`Generating vertical (9:16) video...`);
  console.log(`Input: ${assFilePath}`);
  console.log(`Output: ${finalOutputPath}`);

  // Create a more direct FFmpeg command
  const command = `ffmpeg -f lavfi -i "color=c=black:s=1080x1920:d=${duration}" -vf "ass=${assFilePath}:fontsdir=${fontsDir}" -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -t ${duration} "${finalOutputPath}" -y`;
  
  console.log('Running command:', command);
  
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.log('FFmpeg output:', stderr);
    }
    console.log('\n✅ Video generated successfully!');
    console.log(`Output saved to: ${finalOutputPath}`);
  } catch (error: any) {
    console.error('\nError:', error.message);
    if (error.stderr) {
      console.error('FFmpeg error output:', error.stderr);
    }
    throw error;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npm run generate:vertical <ass-file-path> [output-path]');
    console.log('Example: npm run generate:vertical src/boi.ass my-video.mp4');
    process.exit(1);
  }

  const assFilePath = args[0]!;
  const outputPath = args[1];

  try {
    await generateVerticalVideo(assFilePath, outputPath);
  } catch (error) {
    console.error('Failed to generate video:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
} 