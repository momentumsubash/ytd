const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Create download directory
const downloadDir = path.join(__dirname, 'downloads');

// Create directory if it doesn't exist
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true });
}

class AudioYouTubeDownloader {
  constructor() {
    this.ytDlpWrap = new YTDlpWrap();
    this.initialized = false;
    this.progressFile = path.join(__dirname, 'audio_download_progress.json');
    this.configFile = path.join(__dirname, 'playlists.json');
    this.cookiesFile = path.join(__dirname, 'cookies.txt'); // Cookie file path
    this.progress = this.loadProgress();
    
    // Audio quality settings
    this.minAudioBitrate = 128; // Minimum audio bitrate in kbps
    this.preferredAudioFormats = ['m4a', 'mp3', 'opus', 'webm']; // Preferred audio formats in order
  }

  // Cookie management methods
  checkCookiesAvailable() {
    if (fs.existsSync(this.cookiesFile)) {
      try {
        const content = fs.readFileSync(this.cookiesFile, 'utf8');
        if (content.includes('.youtube.com') && content.includes('\t')) {
          console.log('🍪 Cookies file found and appears valid');
          return true;
        }
      } catch (error) {
        console.log('⚠️  Cookies file exists but cannot be read');
      }
    }
    console.log('⚠️  No valid cookies file found - using anonymous mode (may encounter restrictions)');
    return false;
  }

  getBaseYtdlpArgs(additionalArgs = []) {
    const args = [
      '--no-warnings',
      '--ignore-errors',
      '--skip-unavailable-fragments',
      '--no-mtime',
      ...additionalArgs
    ];
    
    // Add cookies if file exists and is valid
    if (this.checkCookiesAvailable()) {
      args.push('--cookies', this.cookiesFile);
    }
    
    return args;
  }

  loadProgress() {
    try {
      if (fs.existsSync(this.progressFile)) {
        const data = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
        console.log('📊 Loaded previous audio download progress');
        return data;
      }
    } catch (error) {
      console.log('⚠️  Could not load audio progress file, starting fresh');
    }
    
    return {
      playlists: {},
      lastUpdated: new Date().toISOString(),
      totalDownloaded: 0,
      audioDownloads: 0,
      videoFallbackDownloads: 0,
      cookieStatus: 'unknown'
    };
  }

  saveProgress() {
    try {
      this.progress.lastUpdated = new Date().toISOString();
      this.progress.cookieStatus = this.checkCookiesAvailable() ? 'valid' : 'missing';
      fs.writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
      console.log('💾 Audio progress saved');
    } catch (error) {
      console.error('❌ Failed to save audio progress:', error.message);
    }
  }

  loadPlaylists() {
    try {
      if (!fs.existsSync(this.configFile)) {
        const defaultConfig = [
          "https://www.youtube.com/watch?v=hBez2q0jJao&list=PLKD9IRjNEpXuD9oTeF8kG3zOls0D_wd28&ab_channel=ZeeNews"
        ];
        
        fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2));
        console.log(`📝 Created default config file: ${this.configFile}`);
        console.log('🔧 Please edit this file to add your playlist URLs');
      }
      
      const playlistUrls = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      
      const config = {
        playlists: playlistUrls.map((url, index) => ({
          name: `Playlist ${index + 1}`,
          url: url,
          maxVideos: null,
          startIndex: 0,
          enabled: true
        })),
        settings: {
          delayBetweenDownloads: 5000,
          delayBetweenPlaylists: 30000,
          maxRetries: 3,
          retryDelay: 10000,
          preferredAudioQuality: 'best' // Best available audio
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
        downloadedAudios: [],
        skippedAudios: [],
        failedAudios: [],
        totalVideos: 0,
        audioDownloadsCount: 0,
        videoFallbackCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: null
      };
    }
    return this.progress.playlists[playlistUrl];
  }

  markAudioDownloaded(playlistUrl, videoIndex, videoUrl, filename, audioInfo, status = 'downloaded') {
    const playlistProgress = this.getPlaylistProgress(playlistUrl);
    
    const audioData = {
      index: videoIndex,
      url: videoUrl,
      filename: filename,
      timestamp: new Date().toISOString(),
      status: status,
      duration: audioInfo.duration,
      size: audioInfo.size,
      bitrate: audioInfo.bitrate,
      format: audioInfo.format,
      quality: audioInfo.quality,
      type: audioInfo.type
    };

    if (status === 'downloaded') {
      playlistProgress.downloadedAudios.push(audioData);
      playlistProgress.lastVideoIndex = Math.max(playlistProgress.lastVideoIndex, videoIndex);
      this.progress.totalDownloaded++;
      
      if (audioInfo.type === 'audio_only') {
        playlistProgress.audioDownloadsCount++;
        this.progress.audioDownloads++;
      } else if (audioInfo.type === 'video_with_audio') {
        playlistProgress.videoFallbackCount++;
        this.progress.videoFallbackDownloads++;
      }
    } else if (status === 'skipped') {
      playlistProgress.skippedAudios.push(audioData);
    } else if (status === 'failed') {
      playlistProgress.failedAudios.push(audioData);
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

  isAudioAlreadyDownloaded(playlistUrl, videoIndex) {
    const playlistProgress = this.getPlaylistProgress(playlistUrl);
    return playlistProgress.downloadedAudios.some(audio => audio.index === videoIndex);
  }

  printProgressSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 AUDIO DOWNLOAD PROGRESS SUMMARY');
    console.log('='.repeat(70));
    console.log(`📅 Last Updated: ${new Date(this.progress.lastUpdated).toLocaleString()}`);
    console.log(`🍪 Cookie Status: ${this.checkCookiesAvailable() ? '✅ Valid' : '⚠️  Missing/Invalid'}`);
    console.log(`🎯 Total Downloads: ${this.progress.totalDownloaded}`);
    console.log(`🔊 Audio-Only Downloads: ${this.progress.audioDownloads}`);
    console.log(`📹 Video Fallback Downloads: ${this.progress.videoFallbackDownloads}`);
    console.log('');

    for (const [playlistUrl, progress] of Object.entries(this.progress.playlists)) {
      const status = progress.completed ? '✅ COMPLETED' : '🔄 IN PROGRESS';
      console.log(`${status} - ${progress.downloadedAudios.length + progress.skippedAudios.length}/${progress.totalVideos} audios processed`);
      console.log(`   🔗 ${playlistUrl.substring(0, 80)}...`);
      console.log(`   🔊 Audio-Only: ${progress.audioDownloadsCount}`);
      console.log(`   📹 Video Fallback: ${progress.videoFallbackCount}`);
      console.log(`   ⏭️  Skipped: ${progress.skippedAudios.length}`);
      console.log(`   ❌ Failed: ${progress.failedAudios.length}`);
      if (progress.completed) {
        console.log(`   ✅ Completed: ${new Date(progress.completedAt).toLocaleString()}`);
      } else {
        console.log(`   🔄 Next audio index: ${progress.lastVideoIndex + 1}`);
      }
      console.log('');
    }
    console.log('='.repeat(70) + '\n');
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      console.log('🔄 Checking yt-dlp...');
      const version = await this.ytDlpWrap.getVersion();
      console.log(`✅ yt-dlp ready (${version})`);
      
      // Check if it's a recent version
      const versionMatch = version.match(/\d+/);
      if (versionMatch && parseInt(versionMatch[0]) < 2023) {
        console.log('⚠️  yt-dlp version seems old, attempting update...');
        await this.forceUpdateYtDlp();
      }
      
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

  async forceUpdateYtDlp() {
    try {
      console.log('🔄 Force updating yt-dlp...');
      await this.ytDlpWrap.execPromise(['--update']);
      const version = await this.ytDlpWrap.getVersion();
      console.log(`✅ yt-dlp updated to version: ${version}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to update yt-dlp:', error.message);
      return false;
    }
  }

  async updateYtDlp() {
    try {
      console.log('🔄 Updating yt-dlp...');
      await this.ytDlpWrap.execPromise(['-U']);
      console.log('✅ yt-dlp updated successfully');
      return true;
    } catch (error) {
      console.log('⚠️  Could not update yt-dlp:', error.message);
      return false;
    }
  }

  async getVideoInfo(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const baseArgs = this.getBaseYtdlpArgs();
        const args = [
          url,
          '--print', '%(title)s',
          '--no-playlist',
          ...baseArgs
        ];
        
        const output = await this.ytDlpWrap.execPromise(args);
        
        const title = output.trim();
        if (!title || title.includes('ERROR') || title.includes('Requested format is not available')) {
          throw new Error('Could not extract title');
        }
        
        return {
          title: title.replace(/[^\w\s\-_\.]/g, '_').substring(0, 100),
          url: url,
          available: true
        };
      } catch (error) {
        console.log(`⚠️  Attempt ${attempt}/${retries} failed for video info: ${error.message}`);
        
        if (attempt === retries) {
          return {
            title: `audio_${Date.now()}_${url.split('=').pop().substring(0, 11)}`,
            url: url,
            available: false,
            error: error.message
          };
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  async checkVideoAvailability(videoUrl) {
    try {
      const baseArgs = this.getBaseYtdlpArgs();
      const args = [
        videoUrl,
        '--simulate',
        '--quiet',
        ...baseArgs
      ];
      
      await this.ytDlpWrap.execPromise(args);
      return { available: true };
    } catch (error) {
      const errorMsg = error.message.toLowerCase();
      
      if (errorMsg.includes('private video') || errorMsg.includes('this video is private')) {
        return { available: false, reason: 'private' };
      } else if (errorMsg.includes('video unavailable') || errorMsg.includes('does not exist')) {
        return { available: false, reason: 'deleted' };
      } else if (errorMsg.includes('blocked') || errorMsg.includes('not available in your country')) {
        return { available: false, reason: 'geo-blocked' };
      } else if (errorMsg.includes('age-restricted') || errorMsg.includes('sign in')) {
        return { available: false, reason: 'age-restricted' };
      } else if (errorMsg.includes('bot')) {
        return { available: false, reason: 'bot_detected', error: error.message };
      } else {
        return { available: false, reason: 'unknown', error: error.message };
      }
    }
  }

  async getAudioFormats(videoUrl, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log('🔍 Analyzing audio formats...');
        const baseArgs = this.getBaseYtdlpArgs();
        const args = [
          videoUrl,
          '--list-formats',
          ...baseArgs
        ];
        
        const output = await this.ytDlpWrap.execPromise(args);
        
        const lines = output.split('\n');
        const audioFormats = [];
        
        lines.forEach(line => {
          // Parse audio formats (audio only)
          const audioMatch = line.match(/^(\d+)\s+(\w+)\s+(audio only|audio)/);
          if (audioMatch || line.includes('audio only') || line.includes('m4a') || line.includes('opus') || line.includes('mp3')) {
            const formatMatch = line.match(/^(\d+)\s+(\w+)/);
            if (formatMatch) {
              const formatId = formatMatch[1];
              const container = formatMatch[2];
              
              const bitrateMatch = line.match(/(\d+(?:\.\d+)?)k/);
              const bitrate = bitrateMatch ? parseFloat(bitrateMatch[1]) : 0;
              
              // Only include quality audio (128kbps and above)
              if (bitrate >= this.minAudioBitrate) {
                audioFormats.push({
                  id: formatId,
                  container,
                  bitrate,
                  quality: `${bitrate}k`,
                  line: line.trim(),
                  isHD: bitrate >= this.minAudioBitrate
                });
              }
            }
          }
        });

        // Sort by preferred format and bitrate
        audioFormats.sort((a, b) => {
          const aFormatIndex = this.preferredAudioFormats.indexOf(a.container);
          const bFormatIndex = this.preferredAudioFormats.indexOf(b.container);
          
          if (aFormatIndex !== -1 && bFormatIndex !== -1) {
            if (aFormatIndex === bFormatIndex) {
              return b.bitrate - a.bitrate; // Same format, higher bitrate first
            }
            return aFormatIndex - bFormatIndex; // Prefer order in preferredAudioFormats
          } else if (aFormatIndex !== -1) {
            return -1; // a is preferred format
          } else if (bFormatIndex !== -1) {
            return 1; // b is preferred format
          } else {
            return b.bitrate - a.bitrate; // Higher bitrate first
          }
        });

        console.log(`📊 Found ${audioFormats.length} audio formats`);
        
        return { audioFormats };
      } catch (error) {
        console.error(`⚠️  Audio format analysis attempt ${attempt}/${retries} failed:`, error.message);
        if (attempt === retries) {
          return { audioFormats: [], error: error.message };
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  async downloadAudioOnly(videoUrl, filename, audioFormat) {
    try {
      const audioOutputPath = path.join(downloadDir, `${filename}.${audioFormat.container}`);
      
      console.log(`🔊 Downloading audio-only: ${audioFormat.quality} bitrate (${audioFormat.container})`);
      console.log(`🎯 Format ID: ${audioFormat.id}`);
      
      // Get file info before download
      const baseArgs = this.getBaseYtdlpArgs();
      const infoArgs = [
        videoUrl,
        '--format', audioFormat.id,
        '--print', '%(duration)s:%(filesize)s',
        ...baseArgs
      ];
      
      const infoOutput = await this.ytDlpWrap.execPromise(infoArgs);
      
      const [duration, size] = infoOutput.trim().split(':');
      
      // Download the audio
      const downloadArgs = [
        videoUrl,
        '--format', audioFormat.id,
        '--output', audioOutputPath,
        ...baseArgs
      ];

      await this.ytDlpWrap.execPromise(downloadArgs);

      console.log(`✅ Audio-only downloaded: ${audioFormat.quality} (${audioFormat.container})`);
      
      return { 
        success: true, 
        path: audioOutputPath, 
        quality: audioFormat.quality,
        bitrate: audioFormat.bitrate,
        container: audioFormat.container,
        duration: parseInt(duration) || 0,
        size: parseInt(size) || 0,
        type: 'audio_only'
      };
    } catch (error) {
      console.error(`❌ Audio-only download failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async downloadVideoWithAudio(videoUrl, filename) {
    try {
      const videoOutputPath = path.join(downloadDir, `${filename}.mp4`);
      
      console.log(`📹 Downloading video with audio (fallback)...`);
      
      // Get file info before download
      const baseArgs = this.getBaseYtdlpArgs();
      const infoArgs = [
        videoUrl,
        '--format', 'best[height<=720]',
        '--print', '%(duration)s:%(filesize)s',
        ...baseArgs
      ];
      
      const infoOutput = await this.ytDlpWrap.execPromise(infoArgs);
      
      const [duration, size] = infoOutput.trim().split(':');
      
      // Download video with audio
      const downloadArgs = [
        videoUrl,
        '--format', 'best[height<=720]',
        '--output', videoOutputPath,
        ...baseArgs
      ];

      await this.ytDlpWrap.execPromise(downloadArgs);

      console.log(`✅ Video with audio downloaded (fallback)`);
      
      return { 
        success: true, 
        path: videoOutputPath, 
        quality: '720p',
        bitrate: 0,
        container: 'mp4',
        duration: parseInt(duration) || 0,
        size: parseInt(size) || 0,
        type: 'video_with_audio'
      };
    } catch (error) {
      console.error(`❌ Video with audio download failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async downloadAudioContent(videoUrl, customFilename = null, maxRetries = 3) {
    // Check video availability first
    const availability = await this.checkVideoAvailability(videoUrl);
    if (!availability.available) {
      console.log(`⚠️  Video unavailable (${availability.reason}): ${videoUrl}`);
      return { success: false, reason: availability.reason, skipped: true };
    }

    const videoInfo = await this.getVideoInfo(videoUrl, maxRetries);
    
    if (!videoInfo.available) {
      console.log(`⚠️  Could not get video info: ${videoUrl}`);
      return { success: false, reason: 'info_unavailable', skipped: true };
    }

    const filename = customFilename || videoInfo.title;
    console.log(`🎵 Processing content: ${filename}`);

    // STRATEGY 1: Try audio-only formats first
    console.log('\n🎯 STRATEGY 1: Attempting audio-only download...');
    const { audioFormats, error } = await this.getAudioFormats(videoUrl);
    
    if (error) {
      console.log(`⚠️  Could not analyze audio formats: ${error}`);
    } else if (audioFormats.length > 0) {
      let audioResult = null;

      // Try to download audio-only
      for (const audioFormat of audioFormats) {
        console.log(`\n🔊 Attempting audio-only download...`);
        audioResult = await this.downloadAudioOnly(videoUrl, filename, audioFormat);
        if (audioResult.success) break;
        
        console.log(`⚠️  Audio format ${audioFormat.quality} (${audioFormat.container}) failed, trying next...`);
      }

      if (audioResult?.success) {
        console.log(`✅ Successfully downloaded audio-only for: ${filename}`);
        console.log(`   🔊 Audio: ${audioResult.quality} (${audioResult.container})`);
        console.log(`   ⏱️  Duration: ${Math.round(audioResult.duration / 60)} minutes`);
        console.log(`   📦 Size: ${(audioResult.size / (1024 * 1024)).toFixed(2)} MB`);
        
        return { 
          success: true, 
          reason: 'audio_only_success', 
          audioInfo: {
            duration: audioResult.duration,
            size: audioResult.size,
            bitrate: audioResult.bitrate,
            format: audioResult.container,
            quality: audioResult.quality,
            type: audioResult.type
          }
        };
      }
    }

    // STRATEGY 2: Fallback to video with audio
    console.log('\n🎯 STRATEGY 2: Audio-only failed, falling back to video with audio...');
    let fallbackResult = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`\n📹 Attempting video with audio download (Attempt ${attempt}/${maxRetries})...`);
      fallbackResult = await this.downloadVideoWithAudio(videoUrl, filename);
      
      if (fallbackResult.success) {
        console.log(`✅ Successfully downloaded video with audio (fallback) for: ${filename}`);
        console.log(`   📹 Format: ${fallbackResult.quality} video with audio`);
        console.log(`   ⏱️  Duration: ${Math.round(fallbackResult.duration / 60)} minutes`);
        console.log(`   📦 Size: ${(fallbackResult.size / (1024 * 1024)).toFixed(2)} MB`);
        
        return { 
          success: true, 
          reason: 'video_fallback_success', 
          audioInfo: {
            duration: fallbackResult.duration,
            size: fallbackResult.size,
            bitrate: fallbackResult.bitrate,
            format: fallbackResult.container,
            quality: fallbackResult.quality,
            type: fallbackResult.type
          }
        };
      } else {
        console.log(`⚠️  Video with audio download attempt ${attempt} failed: ${fallbackResult.error}`);
        if (attempt < maxRetries) {
          const delay = attempt * 5000; // Exponential backoff
          console.log(`⏳ Waiting ${delay/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // If all strategies fail
    console.log(`❌ All download strategies failed for: ${filename}`);
    return { 
      success: false, 
      reason: 'all_strategies_failed',
      audioInfo: {
        duration: 0,
        size: 0,
        bitrate: 0,
        format: 'unknown',
        quality: '0k',
        type: 'unknown'
      }
    };
  }

  async getPlaylistUrls(playlistUrl) {
    try {
      console.log('📋 Getting playlist URLs...');
      
      const baseArgs = this.getBaseYtdlpArgs();
      const args = [
        playlistUrl,
        '--flat-playlist',
        '--print', '%(url)s',
        ...baseArgs
      ];

      const output = await this.ytDlpWrap.execPromise(args);

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
      return { successful: playlistProgress.downloadedAudios.length, failed: 0, skipped: 0 };
    }

    console.log(`\n🎵 Processing Playlist: ${name}`);
    console.log(`🔗 ${url}`);
    console.log(`🍪 Authentication: ${this.checkCookiesAvailable() ? '✅ Using cookies' : '⚠️  Anonymous mode'}`);
    
    if (playlistProgress.lastVideoIndex > 0) {
      console.log(`🔄 Resuming from index: ${playlistProgress.lastVideoIndex + 1}`);
      console.log(`📊 Already processed: ${playlistProgress.downloadedAudios.length} items`);
      console.log(`   🔊 Audio-only: ${playlistProgress.audioDownloadsCount}`);
      console.log(`   📹 Video fallback: ${playlistProgress.videoFallbackCount}`);
    }

    try {
      const videoUrls = await this.getPlaylistUrls(url);
      
      if (videoUrls.length === 0) {
        console.log('❌ No videos found in playlist');
        return { successful: 0, failed: 0, skipped: 0 };
      }

      playlistProgress.totalVideos = videoUrls.length;

      const resumeIndex = Math.max(startIndex, playlistProgress.lastVideoIndex);
      const filteredUrls = videoUrls.slice(resumeIndex, maxVideos ? resumeIndex + maxVideos : undefined);
      
      console.log(`🎯 Will process ${filteredUrls.length} items starting from index ${resumeIndex + 1}\n`);

      let successful = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < filteredUrls.length; i++) {
        const videoIndex = resumeIndex + i + 1;
        const paddedIndex = String(videoIndex).padStart(3, '0');
        
        if (this.isAudioAlreadyDownloaded(url, videoIndex)) {
          console.log(`⏭️  Item ${videoIndex} already processed, skipping...`);
          continue;
        }
        
        try {
          console.log(`\n🔊 Processing item ${videoIndex}/${videoUrls.length}`);
          console.log(`🔗 URL: ${filteredUrls[i]}`);
          
          const result = await this.downloadAudioContent(filteredUrls[i], `${paddedIndex}_${name}`, settings.maxRetries || 3);
          
          if (result.success) {
            this.markAudioDownloaded(url, videoIndex, filteredUrls[i], `${paddedIndex}_${name}`, result.audioInfo, 'downloaded');
            successful++;
            console.log(`✅ Item ${videoIndex} completed (${result.reason})`);
          } else {
            this.markAudioDownloaded(url, videoIndex, filteredUrls[i], `${paddedIndex}_${name}`, result.audioInfo, 'failed');
            failed++;
            console.log(`❌ Item ${videoIndex} failed (${result.reason})`);
          }
        } catch (error) {
          console.error(`❌ Error with item ${videoIndex}: ${error.message}`);
          this.markAudioDownloaded(url, videoIndex, filteredUrls[i], `error_${videoIndex}`, {
            duration: 0,
            size: 0,
            bitrate: 0,
            format: 'unknown',
            quality: '0k',
            type: 'unknown'
          }, 'failed');
          failed++;
        }

        // Delay between downloads
        if (i < filteredUrls.length - 1) {
          console.log(`⏳ Waiting ${settings.delayBetweenDownloads/1000}s before next item...`);
          await new Promise(resolve => setTimeout(resolve, settings.delayBetweenDownloads));
        }
      }

      // Check if playlist is completed
      const totalProcessed = playlistProgress.downloadedAudios.length + playlistProgress.skippedAudios.length + playlistProgress.failedAudios.length;
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
      const availability = await this.checkVideoAvailability(testUrl);
      
      if (availability.available) {
        console.log(`✅ Connection test passed`);
        return true;
      } else if (availability.reason === 'bot_detected') {
        console.log(`⚠️  Bot detected - cookies may be needed`);
        return false;
      } else {
        console.log(`⚠️  Test video unavailable, but connection seems OK`);
        return true;
      }
    } catch (error) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
  }
}

// Cookie Setup Function
async function setupCookies() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n' + '🍪'.repeat(25));
  console.log('   YOUTUBE COOKIE SETUP');
  console.log('🍪'.repeat(25));
  console.log('\nTo avoid bot detection, you need to provide cookies from a logged-in browser.');
  console.log('This will allow you to download age-restricted and private playlist content.');
  
  const cookieFile = path.join(__dirname, 'cookies.txt');
  
  return new Promise((resolve) => {
    console.log('\n' + '-'.repeat(50));
    console.log('OPTION 1: I already have a cookies.txt file');
    console.log('OPTION 2: Help me create a cookies.txt file');
    console.log('OPTION 3: Skip cookie setup (may have limited access)');
    console.log('-'.repeat(50));
    
    rl.question('\nChoose option (1/2/3): ', async (choice) => {
      switch (choice) {
        case '1':
          if (fs.existsSync(cookieFile)) {
            console.log(`✅ Found cookies.txt file`);
            const content = fs.readFileSync(cookieFile, 'utf8');
            if (content.includes('.youtube.com')) {
              console.log('✅ Cookies appear to contain YouTube session data');
            } else {
              console.log('⚠️  Cookies file exists but may not contain YouTube cookies');
            }
          } else {
            console.log('❌ cookies.txt file not found in project folder');
            console.log('Please export cookies and save as cookies.txt in:');
            console.log(__dirname);
          }
          break;
          
        case '2':
          console.log('\n' + '📝'.repeat(25));
          console.log('   HOW TO CREATE COOKIES.TXT');
          console.log('📝'.repeat(25));
          console.log('\nStep 1: Install browser extension:');
          console.log('   Chrome/Edge: "Get cookies.txt LOCALLY"');
          console.log('   Firefox: "cookies.txt"');
          console.log('\nStep 2: Log into YouTube in your browser');
          console.log('\nStep 3: Click the extension icon and export cookies');
          console.log('\nStep 4: Save the file as "cookies.txt" in this folder:');
          console.log(__dirname);
          console.log('\nStep 5: Run the downloader again');
          console.log('\n💡 Tip: Cookies expire after a while. If downloads fail, repeat this process.');
          break;
          
        case '3':
          console.log('⚠️  Skipping cookie setup. You may encounter:');
          console.log('   - "Sign in to confirm you\'re not a bot" errors');
          console.log('   - Age-restricted content unavailable');
          console.log('   - Private playlist access denied');
          break;
          
        default:
          console.log('❌ Invalid choice');
      }
      
      rl.close();
      resolve();
    });
  });
}

// Updated main function with cookie check
async function main() {
  // Check for command line arguments
  if (process.argv.includes('--setup-cookies')) {
    await setupCookies();
    return;
  }

  const downloader = new AudioYouTubeDownloader();

  // Show current progress
  downloader.printProgressSummary();

  // Initialize
  const initialized = await downloader.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize downloader');
    return;
  }

  // Check cookies status
  const hasCookies = downloader.checkCookiesAvailable();
  if (!hasCookies) {
    console.log('\n⚠️  WARNING: No valid cookies found!');
    console.log('You may encounter bot detection errors.');
    console.log('Run: node script.js --setup-cookies for setup instructions\n');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    await new Promise((resolve) => {
      rl.question('Continue without cookies? (y/n): ', (answer) => {
        if (answer.toLowerCase() !== 'y') {
          console.log('Run with --setup-cookies flag to set up cookies');
          rl.close();
          process.exit(0);
        }
        rl.close();
        resolve();
      });
    });
  }

  // Try to update yt-dlp
  console.log('🔄 Attempting to update yt-dlp to latest version...');
  await downloader.updateYtDlp();

  // Load playlists configuration
  const config = downloader.loadPlaylists();
  if (!config) {
    console.error('❌ Could not load playlists configuration');
    return;
  }

  // Test connection
  const connectionOk = await downloader.testConnection();
  if (!connectionOk) {
    console.error('\n❌ Connection test failed - YouTube may be blocking requests');
    if (!hasCookies) {
      console.log('💡 Try setting up cookies with: node script.js --setup-cookies');
    }
    return;
  }

  console.log('\n' + '='.repeat(70));
  console.log('🎵 Starting Download Session');
  console.log('🎯 Strategy: Audio-first, Video fallback');
  console.log(`🍪 Authentication: ${hasCookies ? '✅ Using cookies' : '⚠️  Anonymous mode'}`);
  console.log('📁 All files saved to ./downloads/');
  console.log('💾 Progress saved to: audio_download_progress.json');
  console.log('='.repeat(70) + '\n');

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
✅ Successful downloads: ${result.successful}
❌ Failed: ${result.failed}
`);

    totalSuccessful += result.successful;
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

  console.log('\n' + '='.repeat(70));
  console.log('🎉 DOWNLOAD SESSION COMPLETED!');
  console.log('='.repeat(70));
  console.log(`✅ Total Successful Downloads: ${totalSuccessful}`);
  console.log(`❌ Total Failed: ${totalFailed}`);
  console.log(`🍪 Authentication: ${hasCookies ? '✅ Used cookies' : '⚠️  Anonymous'}`);
  console.log(`💾 Progress saved to: ${downloader.progressFile}`);
  console.log(`📁 All files saved to: ${downloadDir}`);

  // Show final progress summary
  downloader.printProgressSummary();

  // Show download type summary
  console.log('\n' + '📊'.repeat(20));
  console.log('DOWNLOAD TYPE SUMMARY');
  console.log('📊'.repeat(20));
  console.log(`🔊 Audio-Only Downloads: ${downloader.progress.audioDownloads}`);
  console.log(`📹 Video Fallback Downloads: ${downloader.progress.videoFallbackDownloads}`);
  console.log(`🔊 Audio Bitrate Minimum: ${downloader.minAudioBitrate}kbps`);
  console.log('📊'.repeat(20) + '\n');

  // Show file organization summary
  console.log('\n' + '📁'.repeat(20));
  console.log('FILE ORGANIZATION');
  console.log('📁'.repeat(20));
  console.log('Your downloads are organized as follows:');
  console.log('');
  console.log('📂 downloads/');
  console.log('  ├── 001_playlist.m4a        ← Audio-only files');
  console.log('  ├── 002_playlist.mp3        ← Audio-only files');
  console.log('  ├── 003_playlist.mp4        ← Video with audio (fallback)');
  console.log('  └── ...');
  console.log('');
  console.log('📋 playlists.json              ← Your playlist URLs');
  console.log('🍪 cookies.txt                ← YouTube authentication (if set up)');
  console.log('📊 audio_download_progress.json ← Download progress & stats');
  console.log('');
  console.log('✅ All downloads include metadata: duration, size, bitrate, format, type');
  console.log('📁'.repeat(20));
}

// Handle interruption gracefully
process.on('SIGINT', () => {
  console.log('\n⚡ Download interrupted by user');
  console.log('💾 Progress has been saved, you can resume later');
  console.log('📁 Partial downloads are saved in downloads folder');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught error:', error.message);
  console.log('💾 Progress has been saved');
  console.log('📁 Check download folder for partial files');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled rejection:', reason);
  console.log('💾 Progress has been saved');
});

// Run the main function
if (require.main === module) {
  console.log('\n' + '🎵'.repeat(25));
  console.log('   YOUTUBE AUDIO DOWNLOADER');
  console.log('🎵'.repeat(25));
  console.log('\nUsage:');
  console.log('  node script.js              ← Start downloader');
  console.log('  node script.js --setup-cookies ← Cookie setup guide');
  console.log('\n');
  
  main().catch(console.error);
}

// Export the downloader class for testing
module.exports = { AudioYouTubeDownloader, setupCookies };