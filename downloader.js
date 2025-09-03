const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs').promises;
const path = require('path');

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
            console.log(`🔍 Getting video info for: ${url}`);
            const output = await this.ytDlpWrap.execPromise([
                url,
                '--print', '%(title)s',
                '--no-warnings',
                '--no-playlist'
            ]);
            
            const title = output.trim().replace(/[^\w\s\-_\.]/g, '_').substring(0, 100);
            console.log(`📝 Video title: "${title}"`);
            
            return {
                title: title,
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
                    
                    // Check if it's an audio format
                    if (!resolutionMatch && (line.includes('audio only') || line.includes('mp4a') || 
                        line.includes('opus') || line.includes('m4a') || container === 'm4a' || container === 'webm')) {
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

            console.log(`✅ Found ${videoFormats.length} HD video formats (>720p)`);
            console.log(`✅ Found ${audioFormats.length} audio formats`);

            return { videoFormats, audioFormats };
        } catch (error) {
            console.error('❌ Error checking formats:', error.message);
            return { videoFormats: [], audioFormats: [] };
        }
    }

    async downloadSingleVideo(videoUrl, customFilename = null, downloadDir = './downloads') {
        try {
            const videoInfo = await this.getVideoInfo(videoUrl);
            const filename = customFilename || videoInfo.title;

            console.log(`\n⬇️ Downloading: ${filename}`);
            console.log(`🔗 From URL: ${videoUrl}`);

            // Get available formats
            const { videoFormats, audioFormats } = await this.getAvailableFormats(videoUrl);
            
            if (videoFormats.length === 0 && audioFormats.length === 0) {
                console.log(`⚠️ Skipping "${filename}" - No suitable formats available`);
                return { success: false, filename, reason: 'no_suitable_formats' };
            }

            let videoDownloaded = false;
            let audioDownloaded = false;
            let videoExt = 'mp4';
            let audioExt = 'm4a';
            let videoFile, audioFile;

            // Download HD video if available
            if (videoFormats.length > 0) {
                console.log('🎬 Downloading HD video...');
                for (const videoFormat of videoFormats) {
                    try {
                        videoFile = `${filename}_video.${videoFormat.container}`;
                        const videoOutputPath = path.join(downloadDir, videoFile);
                        console.log(`🎯 Trying video format ID: ${videoFormat.id} (${videoFormat.quality})`);
                        
                        await this.ytDlpWrap.execPromise([
                            videoUrl,
                            '--format', videoFormat.id,
                            '--output', videoOutputPath,
                            '--no-warnings',
                            '--no-progress'
                        ]);

                        console.log(`✅ Video downloaded: ${videoFormat.quality}`);
                        videoDownloaded = true;
                        videoExt = videoFormat.container;
                        break;
                    } catch (error) {
                        console.log(`⚠️ Video format ID "${videoFormat.id}" failed, trying next...`);
                        continue;
                    }
                }
            }

            // Download audio
            if (audioFormats.length > 0) {
                console.log('🔊 Downloading audio...');
                for (const audioFormat of audioFormats) {
                    try {
                        audioFile = `${filename}_audio.${audioFormat.container}`;
                        const audioOutputPath = path.join(downloadDir, audioFile);
                        console.log(`🎯 Trying audio format ID: ${audioFormat.id} (${audioFormat.bitrate}k)`);
                        
                        await this.ytDlpWrap.execPromise([
                            videoUrl,
                            '--format', audioFormat.id,
                            '--output', audioOutputPath,
                            '--no-warnings',
                            '--no-progress'
                        ]);

                        console.log(`✅ Audio downloaded: ${audioFormat.bitrate}k bitrate`);
                        audioDownloaded = true;
                        audioExt = audioFormat.container;
                        break;
                    } catch (error) {
                        console.log(`⚠️ Audio format ID "${audioFormat.id}" failed, trying next...`);
                        continue;
                    }
                }
            }

            if (videoDownloaded && audioDownloaded) {
                console.log(`✅ Successfully downloaded both video and audio for: ${filename}`);
                return { 
                    success: true, 
                    filename, 
                    videoFile,
                    audioFile,
                    type: 'video_with_audio'
                };
            } else if (videoDownloaded) {
                console.log(`⚠️ Downloaded video only for: ${filename} (no audio available)`);
                return { 
                    success: true, 
                    filename, 
                    videoFile,
                    type: 'video_only'
                };
            } else if (audioDownloaded) {
                console.log(`⚠️ Downloaded audio only for: ${filename} (no video available)`);
                return { 
                    success: true, 
                    filename, 
                    audioFile,
                    type: 'audio_only'
                };
            } else {
                console.log(`❌ Failed to download: ${filename}`);
                return { success: false, filename, reason: 'download_failed' };
            }
        } catch (error) {
            console.error(`❌ Download failed: ${error.message}`);
            return { success: false, filename: customFilename || 'unknown', reason: error.message };
        }
    }

    async downloadPlaylist(playlistUrls, playlistName, alreadyDownloaded = [], downloadDir = './downloads') {
        console.log(`\n🎯 Processing ${playlistUrls.length} videos from playlist "${playlistName}"`);
        
        const results = {
            successful: [],
            failed: [],
            skipped: []
        };

        for (let i = 0; i < playlistUrls.length; i++) {
            const videoUrl = playlistUrls[i];
            const paddedIndex = String(i + 1).padStart(3, '0');
            const baseFilename = `${playlistName}_${paddedIndex}`;
            
            // Check if this video is already downloaded
            const isAlreadyDownloaded = alreadyDownloaded.some(file => file.startsWith(baseFilename));
            
            if (isAlreadyDownloaded) {
                console.log(`\n⏭️ Skipping ${baseFilename} - already downloaded`);
                results.skipped.push({ filename: baseFilename, url: videoUrl });
                continue;
            }

            console.log(`\n📥 Processing video ${i + 1}/${playlistUrls.length}`);
            console.log(`🔗 URL: ${videoUrl}`);
            
            try {
                const result = await this.downloadSingleVideo(videoUrl, baseFilename, downloadDir);
                
                if (result.success) {
                    console.log(`✅ Successfully downloaded: ${baseFilename}`);
                    results.successful.push(result);
                } else {
                    console.log(`❌ Failed to download: ${baseFilename} - ${result.reason}`);
                    results.failed.push({ filename: baseFilename, url: videoUrl, reason: result.reason });
                }
                
                // Add delay between downloads to avoid rate limiting
                if (i < playlistUrls.length - 1) {
                    const delay = 5000; // 5 seconds
                    console.log(`⏳ Waiting ${delay/1000}s before next download...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`❌ Error processing ${baseFilename}:`, error.message);
                results.failed.push({ filename: baseFilename, url: videoUrl, reason: error.message });
            }
        }

        console.log(`\n📊 Download results for "${playlistName}":`);
        console.log(`✅ Successful: ${results.successful.length}`);
        console.log(`❌ Failed: ${results.failed.length}`);
        console.log(`⏭️ Skipped: ${results.skipped.length}`);

        return results;
    }
}

module.exports = { YouTubeDownloader };