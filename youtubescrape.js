const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

// Create download directory
const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

class YouTubeDownloader {
  constructor() {
    this.ytDlpWrap = new YTDlpWrap();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      console.log('🔄 Checking yt-dlp...');
      const version = await this.ytDlpWrap.getVersion();
      console.log(`✅ yt-dlp ready (${version})`);
      this.initialized = true;
      return true;
    } catch (error) {
      try {
        console.log('📥 Downloading yt-dlp binary...');
        await YTDlpWrap.downloadFromGithub();
        const version = await this.ytDlpWrap.getVersion();
        console.log(`✅ yt-dlp installed (${version})`);
        this.initialized = true;
        return true;
      } catch (downloadError) {
        console.error('❌ Failed to install yt-dlp:', downloadError.message);
        return false;
      }
    }
  }

  async getVideoInfo(url) {
    try {
      const output = await this.ytDlpWrap.execPromise([
        url,
        '--print', '%(title)s',
        '--no-warnings',
        '--no-playlist'
      ]);
      
      return {
        title: output.trim().replace(/[^\w\s\-_\.]/g, '_').substring(0, 100),
        url: url
      };
    } catch (error) {
      console.error(`❌ Error getting video info: ${error.message}`);
      return {
        title: `video_${Date.now()}`,
        url: url
      };
    }
  }

  async getAvailableFormats(videoUrl) {
    try {
      console.log('🔍 Checking available formats...');
      const output = await this.ytDlpWrap.execPromise([
        videoUrl,
        '--list-formats',
        '--no-warnings'
      ]);
      
      const lines = output.split('\n');
      const videoFormats = [];
      const audioFormats = [];
      
      lines.forEach(line => {
        // Match format lines that contain format ID and resolution
        const formatMatch = line.match(/^(\d+)\s+(\w+)\s+(\d+x\d+|\w+)/);
        if (formatMatch) {
          const formatId = formatMatch[1];
          const container = formatMatch[2];
          const resolution = formatMatch[3];
          
          // Check if it's a video format with resolution
          const resolutionMatch = resolution.match(/(\d+)x(\d+)/);
          if (resolutionMatch) {
            const width = parseInt(resolutionMatch[1]);
            const height = parseInt(resolutionMatch[2]);
            
            if (height > 720) {
              videoFormats.push({ 
                id: formatId, 
                width, 
                height, 
                container,
                line: line.trim(),
                quality: `${width}x${height}`
              });
            }
          }
          
          // Check if it's an audio format (no resolution, but has audio indicators)
          if (!resolutionMatch && (line.includes('audio only') || line.includes('mp4a') || line.includes('opus') || line.includes('m4a') || container === 'm4a' || container === 'webm')) {
            // Extract bitrate if available
            const bitrateMatch = line.match(/(\d+)k/);
            const bitrate = bitrateMatch ? parseInt(bitrateMatch[1]) : 0;
            
            audioFormats.push({
              id: formatId,
              container,
              bitrate,
              line: line.trim()
            });
          }
        }
      });

      // Sort video formats by quality (height) descending
      videoFormats.sort((a, b) => b.height - a.height);
      
      // Sort audio formats by bitrate descending
      audioFormats.sort((a, b) => b.bitrate - a.bitrate);

      console.log(`✅ Found ${videoFormats.length} HD video formats (>720p):`);
      videoFormats.forEach(format => {
        console.log(`   🎬 ID: ${format.id} - ${format.quality} (${format.container})`);
      });
      
      console.log(`✅ Found ${audioFormats.length} audio formats:`);
      audioFormats.forEach(format => {
        console.log(`   🔊 ID: ${format.id} - ${format.bitrate}k (${format.container})`);
      });

      return { videoFormats, audioFormats };
    } catch (error) {
      console.error('❌ Error checking formats:', error.message);
      return { videoFormats: [], audioFormats: [] };
    }
  }

  async downloadSingleVideo(videoUrl, customFilename = null) {
    try {
      const videoInfo = await this.getVideoInfo(videoUrl);
      const filename = customFilename || videoInfo.title;

      console.log(`⬇️  Downloading: ${filename}`);

      // Get available formats
      const { videoFormats, audioFormats } = await this.getAvailableFormats(videoUrl);
      
      if (videoFormats.length === 0) {
        console.log(`⚠️  Skipping "${filename}" - No HD video formats (>720p) available`);
        return false;
      }

      if (audioFormats.length === 0) {
        console.log(`⚠️  Skipping "${filename}" - No audio formats available`);
        return false;
      }

      let videoDownloaded = false;
      let audioDownloaded = false;
      let videoExt = 'mp4';
      let audioExt = 'm4a';

      // Download HD video
      console.log('🎬 Downloading HD video...');
      for (const videoFormat of videoFormats) {
        try {
          const videoOutputPath = path.join(downloadDir, `${filename}_video.${videoFormat.container}`);
          console.log(`🎯 Trying video format ID: ${videoFormat.id} (${videoFormat.quality})`);
          
          await this.ytDlpWrap.execPromise([
            videoUrl,
            '--format', videoFormat.id,
            '--output', videoOutputPath,
            '--no-warnings'
          ]);

          console.log(`✅ Video downloaded: ${videoFormat.quality}`);
          videoDownloaded = true;
          videoExt = videoFormat.container;
          break;
        } catch (error) {
          console.log(`⚠️  Video format ID "${videoFormat.id}" failed, trying next...`);
          continue;
        }
      }

      // Download audio
      if (videoDownloaded) {
        console.log('🔊 Downloading audio...');
        for (const audioFormat of audioFormats) {
          try {
            const audioOutputPath = path.join(downloadDir, `${filename}_audio.${audioFormat.container}`);
            console.log(`🎯 Trying audio format ID: ${audioFormat.id} (${audioFormat.bitrate}k)`);
            
            await this.ytDlpWrap.execPromise([
              videoUrl,
              '--format', audioFormat.id,
              '--output', audioOutputPath,
              '--no-warnings'
            ]);

            console.log(`✅ Audio downloaded: ${audioFormat.bitrate}k bitrate`);
            audioDownloaded = true;
            audioExt = audioFormat.container;
            break;
          } catch (error) {
            console.log(`⚠️  Audio format ID "${audioFormat.id}" failed, trying next...`);
            continue;
          }
        }
      }

      if (videoDownloaded && audioDownloaded) {
        console.log(`✅ Successfully downloaded both video and audio for: ${filename}`);
        console.log(`   📁 Video: ${filename}_video.${videoExt}`);
        console.log(`   📁 Audio: ${filename}_audio.${audioExt}`);
        
        // Add to merge queue
        this.addToMergeQueue(filename, videoExt, audioExt);
        
        return true;
      } else if (videoDownloaded) {
        console.log(`⚠️  Downloaded video only for: ${filename} (no audio available)`);
        return true;
      } else {
        console.log(`❌ Failed to download: ${filename}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Download failed: ${error.message}`);
      return false;
    }
  }

  addToMergeQueue(filename, videoExt, audioExt) {
    if (!this.mergeQueue) {
      this.mergeQueue = [];
    }
    
    this.mergeQueue.push({
      filename,
      videoExt,
      audioExt,
      videoFile: `${filename}_video.${videoExt}`,
      audioFile: `${filename}_audio.${audioExt}`,
      outputFile: `${filename}_merged.mp4`
    });
  }

  generateFFmpegScript() {
    if (!this.mergeQueue || this.mergeQueue.length === 0) {
      console.log('📝 No files to merge');
      return;
    }

    const scriptPath = path.join(__dirname, 'merge_videos.bat');  // Windows batch file
    const scriptPathSh = path.join(__dirname, 'merge_videos.sh'); // Linux/Mac shell script
    
    let batchContent = '@echo off\n';
    batchContent += 'echo Starting video and audio merge process...\n';
    batchContent += 'cd /d "' + downloadDir + '"\n\n';
    
    let shellContent = '#!/bin/bash\n';
    shellContent += 'echo "Starting video and audio merge process..."\n';
    shellContent += 'cd "' + downloadDir + '"\n\n';

    this.mergeQueue.forEach((item, index) => {
      batchContent += `echo Merging ${index + 1}/${this.mergeQueue.length}: ${item.filename}\n`;
      batchContent += `ffmpeg -i "${item.videoFile}" -i "${item.audioFile}" -c:v copy -c:a aac -shortest "${item.outputFile}"\n`;
      batchContent += `if %ERRORLEVEL% EQU 0 (\n`;
      batchContent += `    echo Successfully merged: ${item.outputFile}\n`;
      batchContent += `    del "${item.videoFile}"\n`;
      batchContent += `    del "${item.audioFile}"\n`;
      batchContent += `    echo Cleaned up temporary files\n`;
      batchContent += `) else (\n`;
      batchContent += `    echo Failed to merge: ${item.filename}\n`;
      batchContent += `)\n`;
      batchContent += 'echo.\n\n';

      shellContent += `echo "Merging ${index + 1}/${this.mergeQueue.length}: ${item.filename}"\n`;
      shellContent += `if ffmpeg -i "${item.videoFile}" -i "${item.audioFile}" -c:v copy -c:a aac -shortest "${item.outputFile}"; then\n`;
      shellContent += `    echo "Successfully merged: ${item.outputFile}"\n`;
      shellContent += `    rm "${item.videoFile}"\n`;
      shellContent += `    rm "${item.audioFile}"\n`;
      shellContent += `    echo "Cleaned up temporary files"\n`;
      shellContent += `else\n`;
      shellContent += `    echo "Failed to merge: ${item.filename}"\n`;
      shellContent += `fi\n`;
      shellContent += `echo ""\n\n`;
    });

    batchContent += 'echo All merging operations completed!\n';
    batchContent += 'pause\n';
    
    shellContent += 'echo "All merging operations completed!"\n';

    try {
      fs.writeFileSync(scriptPath, batchContent);
      fs.writeFileSync(scriptPathSh, shellContent);
      
      // Make shell script executable on Unix systems
      try {
        require('child_process').exec(`chmod +x "${scriptPathSh}"`);
      } catch (e) {
        // Ignore if chmod fails (probably on Windows)
      }
      
      console.log(`\n📝 FFmpeg merge scripts generated:`);
      console.log(`   Windows: ${scriptPath}`);
      console.log(`   Linux/Mac: ${scriptPathSh}`);
      console.log(`\n🔧 To merge all videos, run:`);
      console.log(`   Windows: Double-click merge_videos.bat or run it from command prompt`);
      console.log(`   Linux/Mac: ./merge_videos.sh`);
      console.log(`\n⚠️  Make sure FFmpeg is installed and in your PATH`);
      console.log(`\n📋 Files ready for merging: ${this.mergeQueue.length}`);
      
      this.mergeQueue.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.filename}`);
      });
      
    } catch (error) {
      console.error('❌ Failed to write merge script:', error.message);
    }
  }

  async getPlaylistUrls(playlistUrl) {
    try {
      console.log('📋 Getting playlist URLs...');
      
      const output = await this.ytDlpWrap.execPromise([
        playlistUrl,
        '--flat-playlist',
        '--print', '%(url)s',
        '--no-warnings'
      ]);

      const urls = output.trim().split('\n')
        .filter(url => url.trim() && url.includes('youtube.com/watch'));

      console.log(`📊 Found ${urls.length} videos in playlist`);
      return urls;
    } catch (error) {
      console.error('❌ Error getting playlist URLs:', error.message);
      return [];
    }
  }

  async downloadPlaylist(playlistUrl, options = {}) {
    const {
      maxVideos = null,
      startIndex = 0,
      delayBetweenDownloads = 3000,
      skipLowQuality = true  // New option to skip videos without HD
    } = options;

    try {
      const videoUrls = await this.getPlaylistUrls(playlistUrl);
      
      if (videoUrls.length === 0) {
        console.log('❌ No videos found in playlist');
        return { successful: 0, failed: 0, skipped: 0 };
      }

      // Apply filters
      const filteredUrls = videoUrls.slice(startIndex, maxVideos ? startIndex + maxVideos : undefined);
      
      console.log(`🎯 Will process ${filteredUrls.length} videos (HD only: ${skipLowQuality})\n`);

      let successful = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < filteredUrls.length; i++) {
        const videoIndex = startIndex + i + 1;
        const paddedIndex = String(videoIndex).padStart(3, '0');
        
        try {
          const videoInfo = await this.getVideoInfo(filteredUrls[i]);
          const filename = `${paddedIndex}_${videoInfo.title}`;
          
          const success = await this.downloadSingleVideo(filteredUrls[i], filename);
          if (success) {
            successful++;
          } else {
            if (skipLowQuality) {
              skipped++;
            } else {
              failed++;
            }
          }
        } catch (error) {
          console.error(`❌ Error with video ${videoIndex}: ${error.message}`);
          failed++;
        }

        // Delay between downloads to avoid rate limits
        if (i < filteredUrls.length - 1) {
          console.log(`⏳ Waiting ${delayBetweenDownloads/1000}s before next download...\n`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenDownloads));
        }
      }

      return { successful, failed, skipped };
    } catch (error) {
      console.error('💥 Error in playlist download:', error.message);
      return { successful: 0, failed: 0, skipped: 0 };
    }
  }

  async testConnection() {
    try {
      console.log('🧪 Testing connection...');
      // Use a reliable test video
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Roll - always available
      const info = await this.getVideoInfo(testUrl);
      console.log(`✅ Connection test passed: "${info.title}"`);
      return true;
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
  }
}

async function main() {
  const downloader = new YouTubeDownloader();

  // Initialize
  const initialized = await downloader.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize downloader');
    return;
  }

  // Test connection
  const connectionOk = await downloader.testConnection();
  if (!connectionOk) {
    console.error('❌ Connection test failed');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎵 Starting HD playlist downloads (>720p only)');
  console.log('='.repeat(60) + '\n');

  // Configure your playlists here
  const playlists = [
    {
      name: 'NDTV India Playlist',
      url: 'https://www.youtube.com/playlist?list=PLpSN4vP31-Ksd_JKfIN2bOZp4mw3jdyye',
      maxVideos: 5, // Download first 5 videos as test
      startIndex: 0
    }
    // Add more playlists here:
    // {
    //   name: 'Another Playlist',
    //   url: 'https://www.youtube.com/playlist?list=ANOTHER_ID',
    //   maxVideos: 10
    // }
  ];

  for (const playlist of playlists) {
    console.log(`\n🎵 Processing: ${playlist.name}`);
    console.log(`🔗 ${playlist.url}`);
    console.log(`📺 Quality: HD only (>720p)\n`);

    const result = await downloader.downloadPlaylist(playlist.url, {
      maxVideos: playlist.maxVideos,
      startIndex: playlist.startIndex || 0,
      delayBetweenDownloads: 5000, // 5 second delay
      skipLowQuality: true // Skip videos without HD quality
    });

    console.log(`\n📊 Results for "${playlist.name}":
✅ Successful HD downloads: ${result.successful}
⏭️  Skipped (no HD): ${result.skipped}
❌ Failed: ${result.failed}
`);

    // Wait between playlists
    if (playlists.indexOf(playlist) < playlists.length - 1) {
      console.log('⏸️  Waiting 30s before next playlist...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  console.log('\n🎉 All HD downloads completed!');
}

// Alternative: Download specific video URLs (HD only)
async function downloadSpecificVideos() {
  const downloader = new YouTubeDownloader();
  await downloader.initialize();

  const videoUrls = [
    'https://www.youtube.com/watch?v=dt2z-xxL6oM',
    // Add more specific video URLs here
  ];

  console.log(`🎯 Downloading ${videoUrls.length} specific videos (HD only)\n`);

  let successful = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < videoUrls.length; i++) {
    const paddedIndex = String(i + 1).padStart(3, '0');
    const result = await downloader.downloadSingleVideo(videoUrls[i], `${paddedIndex}_manual_video`);
    
    if (result) {
      successful++;
    } else {
      skipped++; // Assuming it was skipped due to no HD quality
    }
    
    if (i < videoUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log(`\n📊 Final Results:
✅ Successful HD downloads: ${successful}
⏭️  Skipped (no HD): ${skipped}
❌ Failed: ${failed}
`);
}

// Choose which function to run:
main().catch(console.error);

// Or run this instead to download specific videos:
// downloadSpecificVideos().catch(console.error);

// Handle interruption
process.on('SIGINT', () => {
  console.log('\n⚡ Download interrupted by user');
  process.exit(0);
});