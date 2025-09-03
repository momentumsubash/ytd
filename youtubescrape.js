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
    this.progressFile = path.join(__dirname, 'download_progress.json');
    this.configFile = path.join(__dirname, 'playlists.json');
    this.progress = this.loadProgress();
  }

  loadProgress() {
    try {
      if (fs.existsSync(this.progressFile)) {
        const data = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
        console.log('📊 Loaded previous progress');
        return data;
      }
    } catch (error) {
      console.log('⚠️  Could not load progress file, starting fresh');
    }
    
    return {
      playlists: {},
      lastUpdated: new Date().toISOString(),
      totalDownloaded: 0
    };
  }

  saveProgress() {
    try {
      this.progress.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
      console.log('💾 Progress saved');
    } catch (error) {
      console.error('❌ Failed to save progress:', error.message);
    }
  }

  loadPlaylists() {
    try {
      if (!fs.existsSync(this.configFile)) {
        // Create default config file with simple array format
        const defaultConfig = [
          "https://www.youtube.com/watch?v=hBez2q0jJao&list=PLKD9IRjNEpXuD9oTeF8kG3zOls0D_wd28&ab_channel=ZeeNews"
        ];
        
        fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2));
        console.log(`📝 Created default config file: ${this.configFile}`);
        console.log('🔧 Please edit this file to add your playlist URLs');
      }
      
      const playlistUrls = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      
      // Convert simple array to config object format for internal processing
      const config = {
        playlists: playlistUrls.map((url, index) => ({
          name: `Playlist ${index + 1}`,
          url: url,
          maxVideos: null, // Download all videos
          startIndex: 0,
          enabled: true
        })),
        settings: {
          delayBetweenDownloads: 5000,
          delayBetweenPlaylists: 30000,
          skipLowQuality: true,
          minQualityHeight: 720
        }
      };
      
      console.log(`📋 Loaded ${config.playlists.length} playlists from config`);
      return config;
    } catch (error) {
      console.error('❌ Failed to load playlists config:', error.message);
      return null;
    }
  }

  getPlaylistProgress(playlistUrl) {
    if (!this.progress.playlists[playlistUrl]) {
      this.progress.playlists[playlistUrl] = {
        completed: false,
        lastVideoIndex: 0,
        downloadedVideos: [],
        skippedVideos: [],
        failedVideos: [],
        totalVideos: 0,
        startedAt: new Date().toISOString(),
        completedAt: null
      };
    }
    return this.progress.playlists[playlistUrl];
  }

  markVideoDownloaded(playlistUrl, videoIndex, videoUrl, filename, status = 'downloaded') {
    const playlistProgress = this.getPlaylistProgress(playlistUrl);
    
    const videoInfo = {
      index: videoIndex,
      url: videoUrl,
      filename: filename,
      timestamp: new Date().toISOString(),
      status: status
    };

    if (status === 'downloaded') {
      playlistProgress.downloadedVideos.push(videoInfo);
      playlistProgress.lastVideoIndex = Math.max(playlistProgress.lastVideoIndex, videoIndex);
      this.progress.totalDownloaded++;
    } else if (status === 'skipped') {
      playlistProgress.skippedVideos.push(videoInfo);
    } else if (status === 'failed') {
      playlistProgress.failedVideos.push(videoInfo);
    }

    this.saveProgress();
  }

  markPlaylistCompleted(playlistUrl) {
    const playlistProgress = this.getPlaylistProgress(playlistUrl);
    playlistProgress.completed = true;
    playlistProgress.completedAt = new Date().toISOString();
    this.saveProgress();
    console.log(`✅ Playlist marked as completed`);
  }

  isVideoAlreadyDownloaded(playlistUrl, videoIndex) {
    const playlistProgress = this.getPlaylistProgress(playlistUrl);
    return playlistProgress.downloadedVideos.some(video => video.index === videoIndex);
  }

  printProgressSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DOWNLOAD PROGRESS SUMMARY');
    console.log('='.repeat(60));
    console.log(`📅 Last Updated: ${new Date(this.progress.lastUpdated).toLocaleString()}`);
    console.log(`🎯 Total Videos Downloaded: ${this.progress.totalDownloaded}`);
    console.log('');

    for (const [playlistUrl, progress] of Object.entries(this.progress.playlists)) {
      const status = progress.completed ? '✅ COMPLETED' : '🔄 IN PROGRESS';
      console.log(`${status} - ${progress.downloadedVideos.length + progress.skippedVideos.length}/${progress.totalVideos} videos processed`);
      console.log(`   🔗 ${playlistUrl.substring(0, 80)}...`);
      console.log(`   ⬇️  Downloaded: ${progress.downloadedVideos.length}`);
      console.log(`   ⏭️  Skipped: ${progress.skippedVideos.length}`);
      console.log(`   ❌ Failed: ${progress.failedVideos.length}`);
      if (progress.completed) {
        console.log(`   ✅ Completed: ${new Date(progress.completedAt).toLocaleString()}`);
      } else {
        console.log(`   🔄 Next video index: ${progress.lastVideoIndex + 1}`);
      }
      console.log('');
    }
    console.log('='.repeat(60) + '\n');
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
        const formatMatch = line.match(/^(\d+)\s+(\w+)\s+(\d+x\d+|\w+)/);
        if (formatMatch) {
          const formatId = formatMatch[1];
          const container = formatMatch[2];
          const resolution = formatMatch[3];
          
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
          
          if (!resolutionMatch && (line.includes('audio only') || line.includes('mp4a') || line.includes('opus') || line.includes('m4a') || container === 'm4a' || container === 'webm')) {
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

      videoFormats.sort((a, b) => b.height - a.height);
      audioFormats.sort((a, b) => b.bitrate - a.bitrate);

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

    const scriptPath = path.join(__dirname, 'merge_videos.bat');
    const scriptPathSh = path.join(__dirname, 'merge_videos.sh');
    
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
      
      try {
        require('child_process').exec(`chmod +x "${scriptPathSh}"`);
      } catch (e) {
        // Ignore chmod errors on Windows
      }
      
      console.log(`\n📝 FFmpeg merge scripts generated:`);
      console.log(`   Windows: ${scriptPath}`);
      console.log(`   Linux/Mac: ${scriptPathSh}`);
      console.log(`\n📋 Files ready for merging: ${this.mergeQueue.length}`);
      
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

  async downloadPlaylist(playlistConfig, settings) {
    const { name, url, maxVideos = null, startIndex = 0, enabled = true } = playlistConfig;
    
    if (!enabled) {
      console.log(`⏭️  Skipping disabled playlist: ${name}`);
      return { successful: 0, failed: 0, skipped: 0 };
    }

    const playlistProgress = this.getPlaylistProgress(url);
    
    if (playlistProgress.completed) {
      console.log(`✅ Playlist already completed: ${name}`);
      return { successful: playlistProgress.downloadedVideos.length, failed: 0, skipped: 0 };
    }

    console.log(`\n🎵 Processing: ${name}`);
    console.log(`🔗 ${url}`);
    
    if (playlistProgress.lastVideoIndex > 0) {
      console.log(`🔄 Resuming from video index: ${playlistProgress.lastVideoIndex + 1}`);
      console.log(`📊 Already downloaded: ${playlistProgress.downloadedVideos.length} videos`);
    }

    try {
      const videoUrls = await this.getPlaylistUrls(url);
      
      if (videoUrls.length === 0) {
        console.log('❌ No videos found in playlist');
        return { successful: 0, failed: 0, skipped: 0 };
      }

      playlistProgress.totalVideos = videoUrls.length;

      // Resume from where we left off
      const resumeIndex = Math.max(startIndex, playlistProgress.lastVideoIndex);
      const filteredUrls = videoUrls.slice(resumeIndex, maxVideos ? resumeIndex + maxVideos : undefined);
      
      console.log(`🎯 Will process ${filteredUrls.length} videos starting from index ${resumeIndex + 1}\n`);

      let successful = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < filteredUrls.length; i++) {
        const videoIndex = resumeIndex + i + 1;
        const paddedIndex = String(videoIndex).padStart(3, '0');
        
        // Skip if already downloaded
        if (this.isVideoAlreadyDownloaded(url, videoIndex)) {
          console.log(`⏭️  Video ${videoIndex} already downloaded, skipping...`);
          continue;
        }
        
        try {
          console.log(`\n📹 Processing video ${videoIndex}/${videoUrls.length}`);
          const videoInfo = await this.getVideoInfo(filteredUrls[i]);
          const filename = `${paddedIndex}_${videoInfo.title}`;
          
          const downloadSuccess = await this.downloadSingleVideo(filteredUrls[i], filename);
          
          if (downloadSuccess) {
            this.markVideoDownloaded(url, videoIndex, filteredUrls[i], filename, 'downloaded');
            successful++;
            console.log(`✅ Video ${videoIndex} completed successfully`);
          } else {
            this.markVideoDownloaded(url, videoIndex, filteredUrls[i], filename, 'skipped');
            skipped++;
            console.log(`⏭️  Video ${videoIndex} skipped (no HD quality)`);
          }
        } catch (error) {
          console.error(`❌ Error with video ${videoIndex}: ${error.message}`);
          this.markVideoDownloaded(url, videoIndex, filteredUrls[i], `error_${videoIndex}`, 'failed');
          failed++;
        }

        // Delay between downloads
        if (i < filteredUrls.length - 1) {
          console.log(`⏳ Waiting ${settings.delayBetweenDownloads/1000}s before next download...`);
          await new Promise(resolve => setTimeout(resolve, settings.delayBetweenDownloads));
        }
      }

      // Check if playlist is completed
      const totalProcessed = playlistProgress.downloadedVideos.length + playlistProgress.skippedVideos.length + playlistProgress.failedVideos.length;
      if (totalProcessed >= videoUrls.length || (maxVideos && totalProcessed >= maxVideos)) {
        this.markPlaylistCompleted(url);
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
      const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
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

  // Show current progress
  downloader.printProgressSummary();

  // Initialize
  const initialized = await downloader.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize downloader');
    return;
  }

  // Load playlists configuration
  const config = downloader.loadPlaylists();
  if (!config) {
    console.error('❌ Could not load playlists configuration');
    return;
  }

  // Test connection
  const connectionOk = await downloader.testConnection();
  if (!connectionOk) {
    console.error('❌ Connection test failed');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎵 Starting HD playlist downloads with resume capability');
  console.log('='.repeat(60) + '\n');

  const enabledPlaylists = config.playlists.filter(p => p.enabled !== false);
  console.log(`📋 Found ${enabledPlaylists.length} enabled playlists`);

  let totalSuccessful = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const playlist of enabledPlaylists) {
    const playlistProgress = downloader.getPlaylistProgress(playlist.url);
    
    if (playlistProgress.completed) {
      console.log(`✅ Skipping completed playlist: ${playlist.name}`);
      continue;
    }

    const result = await downloader.downloadPlaylist(playlist, config.settings);

    console.log(`\n📊 Results for "${playlist.name}":
✅ Successful HD downloads: ${result.successful}
⏭️  Skipped (no HD): ${result.skipped}
❌ Failed: ${result.failed}
`);

    totalSuccessful += result.successful;
    totalSkipped += result.skipped;
    totalFailed += result.failed;

    // Wait between playlists
    const currentIndex = enabledPlaylists.indexOf(playlist);
    if (currentIndex < enabledPlaylists.length - 1) {
      const nextPlaylist = enabledPlaylists[currentIndex + 1];
      const nextProgress = downloader.getPlaylistProgress(nextPlaylist.url);
      
      if (!nextProgress.completed) {
        console.log(`⏸️  Waiting ${config.settings.delayBetweenPlaylists/1000}s before next playlist...\n`);
        await new Promise(resolve => setTimeout(resolve, config.settings.delayBetweenPlaylists));
      }
    }
  }

  // Generate merge script if there are files to merge
  downloader.generateFFmpegScript();

  console.log('\n' + '='.repeat(60));
  console.log('🎉 DOWNLOAD SESSION COMPLETED!');
  console.log('='.repeat(60));
  console.log(`✅ Total Successful: ${totalSuccessful}`);
  console.log(`⏭️  Total Skipped: ${totalSkipped}`);
  console.log(`❌ Total Failed: ${totalFailed}`);
  console.log(`💾 Progress saved to: ${downloader.progressFile}`);
  
  // Show final progress summary
  downloader.printProgressSummary();
}

// Handle interruption
process.on('SIGINT', () => {
  console.log('\n⚡ Download interrupted by user');
  console.log('💾 Progress has been saved, you can resume later');
  process.exit(0);
});

// Run the main function
main().catch(console.error);