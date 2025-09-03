const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { YouTubeDownloader } = require('./downloader');
const { VideoMerger } = require('./merger');
const { S3MediaUploader } = require('./uploader');

class PlaylistProcessor {
    constructor() {
        this.downloader = new YouTubeDownloader();
        this.merger = new VideoMerger();
        this.uploader = null;
        
        this.playlistsDir = path.join(__dirname, 'playlists');
        this.downloadsDir = path.join(__dirname, 'downloads');
        this.mergedDir = path.join(__dirname, 'merged');
        this.uploadedDir = path.join(__dirname, 'uploaded');
        
        this.stateFile = path.join(__dirname, 'processing_state.json');
        this.processingState = {
            playlists: {},
            lastRun: null
        };
    }
    
    async init() {
        // Create necessary directories
        await this.ensureDirectoryExists(this.playlistsDir);
        await this.ensureDirectoryExists(this.downloadsDir);
        await this.ensureDirectoryExists(this.mergedDir);
        await this.ensureDirectoryExists(this.uploadedDir);
        
        // Load processing state
        await this.loadProcessingState();
        
        // Initialize downloader
        await this.downloader.initialize();
        
        console.log('✅ Playlist Processor initialized');
    }
    
    async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            await fs.mkdir(dirPath, { recursive: true });
            console.log(`📁 Created directory: ${dirPath}`);
        }
    }
    
    async loadProcessingState() {
        try {
            if (fsSync.existsSync(this.stateFile)) {
                const data = await fs.readFile(this.stateFile, 'utf8');
                this.processingState = JSON.parse(data);
                console.log('📊 Loaded processing state');
            }
        } catch (error) {
            console.log('❌ Could not load processing state, starting fresh');
            this.processingState = {
                playlists: {},
                lastRun: new Date().toISOString()
            };
        }
    }
    
    async saveProcessingState() {
        try {
            await fs.writeFile(this.stateFile, JSON.stringify(this.processingState, null, 2), 'utf8');
        } catch (error) {
            console.error('❌ Error saving processing state:', error.message);
        }
    }
    
    async getPlaylistFiles() {
        try {
            const files = await fs.readdir(this.playlistsDir);
            return files.filter(file => file.endsWith('.txt'));
        } catch (error) {
            console.error('❌ Error reading playlists directory:', error.message);
            return [];
        }
    }
    
    async readPlaylistFile(filename) {
        try {
            const filePath = path.join(this.playlistsDir, filename);
            const content = await fs.readFile(filePath, 'utf8');
            
            // Try to parse as JSON first
            try {
                return JSON.parse(content);
            } catch (e) {
                // If not JSON, treat as one URL per line
                return content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#') && line.includes('youtube.com'));
            }
        } catch (error) {
            console.error(`❌ Error reading playlist file ${filename}:`, error.message);
            return [];
        }
    }
    
    async processPlaylists() {
        const playlistFiles = await this.getPlaylistFiles();
        
        if (playlistFiles.length === 0) {
            console.log('ℹ️ No playlist files found in playlists/ directory');
            return;
        }
        
        console.log(`📋 Found ${playlistFiles.length} playlist files`);
        
        for (const playlistFile of playlistFiles) {
            const playlistName = path.basename(playlistFile, '.txt');
            
            // Initialize playlist state if not exists
            if (!this.processingState.playlists[playlistName]) {
                this.processingState.playlists[playlistName] = {
                    processed: false,
                    downloadedVideos: [],
                    mergedVideos: [],
                    uploadedVideos: [],
                    lastProcessed: null
                };
            }
            
            const playlistState = this.processingState.playlists[playlistName];
            
            // Skip if already fully processed
            if (playlistState.processed) {
                console.log(`⏭️ Skipping playlist ${playlistName} - already processed`);
                continue;
            }
            
            console.log(`\n🎵 Processing playlist: ${playlistName}`);
            
            // Read playlist URLs
            const playlistUrls = await this.readPlaylistFile(playlistFile);
            
            if (playlistUrls.length === 0) {
                console.log(`❌ No valid URLs found in ${playlistFile}`);
                continue;
            }
            
            console.log(`📺 Found ${playlistUrls.length} videos in playlist`);
            
            // Download videos
            const downloadResults = await this.downloader.downloadPlaylist(
                playlistUrls, 
                playlistName,
                playlistState.downloadedVideos
            );
            
            // Update state with downloaded videos
            playlistState.downloadedVideos = [
                ...playlistState.downloadedVideos,
                ...downloadResults.successful.map(video => video.filename)
            ];
            
            // Merge videos
            const mergeResults = await this.merger.processDownloads(
                this.downloadsDir,
                this.mergedDir,
                playlistState.mergedVideos
            );
            
            // Update state with merged videos
            playlistState.mergedVideos = [
                ...playlistState.mergedVideos,
                ...mergeResults.mergedFiles
            ];
            
            // Initialize uploader if not done yet
            if (!this.uploader) {
                this.uploader = new S3MediaUploader(
                    process.env.S3_BUCKET_NAME || 'your-bucket-name',
                    this.mergedDir,
                    this.uploadedDir
                );
                await this.uploader.init();
            }
            
            // Upload files
            const uploadResults = await this.uploader.processFiles(
                playlistState.uploadedVideos
            );
            
            // Update state with uploaded videos
            playlistState.uploadedVideos = [
                ...playlistState.uploadedVideos,
                ...uploadResults.uploadedFiles
            ];
            
            // Mark playlist as processed if all videos are done
            if (downloadResults.successful.length === playlistUrls.length &&
                mergeResults.mergedFiles.length === downloadResults.successful.length &&
                uploadResults.uploadedFiles.length === mergeResults.mergedFiles.length) {
                playlistState.processed = true;
                playlistState.lastProcessed = new Date().toISOString();
                console.log(`✅ Completed processing playlist: ${playlistName}`);
            }
            
            // Save state after each playlist
            await this.saveProcessingState();
        }
        
        console.log('\n🎉 All playlists processed!');
    }
    
    async cleanup() {
        // Clean up any temporary files if needed
        console.log('🧹 Cleanup completed');
    }
}

async function main() {
    try {
        const processor = new PlaylistProcessor();
        await processor.init();
        await processor.processPlaylists();
        await processor.cleanup();
    } catch (error) {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    }
}

// Handle interruption
process.on('SIGINT', async () => {
    console.log('\n⚡ Process interrupted by user');
    process.exit(0);
});

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = PlaylistProcessor;