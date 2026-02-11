require('dotenv').config();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const crypto = require('crypto');
const readline = require('readline');

class S3MediaUploader {
    constructor(bucketName, sourceFolder, awsRegion = 'ap-south-1') {
        this.bucketName = bucketName;
        this.sourceFolder = path.resolve(sourceFolder);
        this.progressFile = path.resolve('s3_upload_progress.json');
        this.logFile = path.resolve('s3_uploader.log');
        this.uploadHistoryFile = path.resolve('s3_upload_history.json');
        
        // Supported media file extensions
        this.supportedExtensions = new Set([
            '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v', // Video
            '.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma', '.opus'  // Audio
        ]);
        
        // Initialize S3 client
        this.s3Client = this.createS3Client(awsRegion);
        
        // Progress tracking
        this.progress = null;
        this.uploadHistory = null;
        this.sessionStats = {
            uploaded: 0,
            skipped: 0,
            failed: 0,
            deleted: 0,
            totalSize: 0,
            uploadedSize: 0
        };
        
        // For progress display
        this.currentUploadProgress = 0;
    }
    
    createS3Client(region) {
        const config = {
            region: region,
            forcePathStyle: false,
            requestHandler: {
                requestTimeout: 300000, // 5 minutes
                httpsAgent: {
                    timeout: 300000
                }
            }
        };

        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            config.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            };
            this.log('Using explicit AWS credentials from environment variables', 'info');
        } else {
            this.log('No explicit credentials found. Using default AWS credential chain', 'info');
        }

        return new S3Client(config);
    }
    
    async init() {
        try {
            // Load progress and history
            this.progress = await this.loadProgress();
            this.uploadHistory = await this.loadUploadHistory();
            
            // Test S3 connection
            this.log('Testing S3 connection...', 'info');
            await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
            this.log(`Successfully connected to S3 bucket: ${this.bucketName}`, 'success');
            
            // Create source directory if it doesn't exist
            await this.ensureDirectoryExists(this.sourceFolder);
            
            return true;
        } catch (error) {
            if (error.name === 'CredentialsProviderError' || error.message.includes('credential')) {
                this.log('AWS credentials error. Please ensure credentials are properly configured:', 'error');
                this.log('1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables', 'error');
                this.log('2. Or configure AWS CLI: aws configure', 'error');
            } else if (error.$metadata?.httpStatusCode === 404) {
                this.log(`Bucket '${this.bucketName}' not found or access denied.`, 'error');
            } else if (error.name === 'NetworkingError') {
                this.log('Network error. Check your internet connection.', 'error');
            } else {
                this.log(`Error connecting to S3: ${error.message}`, 'error');
            }
            throw error;
        }
    }
    
    async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(dirPath, { recursive: true });
                this.log(`Created directory: ${dirPath}`, 'info');
            }
        }
    }
    
    async loadProgress() {
        try {
            if (fsSync.existsSync(this.progressFile)) {
                const data = await fs.readFile(this.progressFile, 'utf8');
                const progress = JSON.parse(data);
                this.log(`Loaded progress: ${Object.keys(progress.uploadedFiles || {}).length} files previously uploaded`, 'info');
                return progress;
            } else {
                return {
                    uploadedFiles: {},
                    session: {
                        startTime: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        totalFiles: 0,
                        completedFiles: 0
                    }
                };
            }
        } catch (error) {
            this.log('Progress file is corrupted. Creating new progress tracking.', 'warning');
            return {
                uploadedFiles: {},
                session: {
                    startTime: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    totalFiles: 0,
                    completedFiles: 0
                }
            };
        }
    }
    
    async loadUploadHistory() {
        try {
            // First, try to load existing upload history
            let history = null;
            
            if (fsSync.existsSync(this.uploadHistoryFile)) {
                const data = await fs.readFile(this.uploadHistoryFile, 'utf8');
                history = JSON.parse(data);
                this.log(`Loaded upload history: ${Object.keys(history.files || {}).length} files tracked`, 'info');
            } else {
                // Create new history structure
                history = {
                    files: {},
                    metadata: {
                        created: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        totalUploads: 0,
                        totalSizeUploaded: 0
                    }
                };
            }
            
            // Merge data from progress file if it exists and history is new
            if (fsSync.existsSync(this.progressFile) && Object.keys(history.files).length === 0) {
                try {
                    const progressData = await fs.readFile(this.progressFile, 'utf8');
                    const progress = JSON.parse(progressData);
                    
                    if (progress.uploadedFiles && Object.keys(progress.uploadedFiles).length > 0) {
                        this.log(`Migrating ${Object.keys(progress.uploadedFiles).length} files from progress file to history`, 'info');
                        
                        let totalSize = 0;
                        for (const [filename, details] of Object.entries(progress.uploadedFiles)) {
                            history.files[filename] = {
                                ...details,
                                deleted: true // Mark as deleted since they were uploaded
                            };
                            totalSize += details.fileSizeBytes || 0;
                        }
                        
                        history.metadata.totalUploads = Object.keys(history.files).length;
                        history.metadata.totalSizeUploaded = totalSize;
                        
                        // Save the migrated history
                        await fs.writeFile(this.uploadHistoryFile, JSON.stringify(history, null, 2), 'utf8');
                        this.log('Migration complete. History file created.', 'success');
                    }
                } catch (migrateError) {
                    this.log('Could not migrate progress file data, continuing with existing history', 'warning');
                }
            }
            
            return history;
        } catch (error) {
            this.log('Upload history file is corrupted. Creating new history.', 'warning');
            return {
                files: {},
                metadata: {
                    created: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    totalUploads: 0,
                    totalSizeUploaded: 0
                }
            };
        }
    }
    
    async saveProgress() {
        try {
            this.progress.session.lastUpdated = new Date().toISOString();
            await fs.writeFile(this.progressFile, JSON.stringify(this.progress, null, 2), 'utf8');
        } catch (error) {
            this.log(`Error saving progress: ${error.message}`, 'error');
        }
    }
    
    async saveUploadHistory() {
        try {
            this.uploadHistory.metadata.lastUpdated = new Date().toISOString();
            await fs.writeFile(this.uploadHistoryFile, JSON.stringify(this.uploadHistory, null, 2), 'utf8');
        } catch (error) {
            this.log(`Error saving upload history: ${error.message}`, 'error');
        }
    }
    
    async generateFileHash(filePath) {
        try {
            const hash = crypto.createHash('md5');
            const stream = fsSync.createReadStream(filePath);
            
            return new Promise((resolve, reject) => {
                stream.on('data', data => hash.update(data));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', error => {
                    this.log(`Error reading file for hash: ${error.message}`, 'warning');
                    resolve(null);
                });
            });
        } catch (error) {
            this.log(`Error setting up hash generation for ${filePath}: ${error.message}`, 'warning');
            return null;
        }
    }
    
    isMediaFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.has(ext);
    }
    
    isFileInHistory(filename, fileHash) {
        const historyRecord = this.uploadHistory.files[filename];
        if (!historyRecord) return false;
        
        // Check if file with same name and hash was uploaded before
        if (fileHash && historyRecord.fileHash === fileHash) {
            return true;
        }
        
        // If no hash match but filename exists, still consider it uploaded
        return true;
    }
    
    async getMediaFiles() {
        try {
            const files = await fs.readdir(this.sourceFolder);
            const mediaFiles = [];
            
            for (const file of files) {
                const filePath = path.join(this.sourceFolder, file);
                const stats = await fs.stat(filePath);
                
                if (stats.isFile() && this.isMediaFile(filePath)) {
                    const hash = await this.generateFileHash(filePath);
                    mediaFiles.push({
                        name: file,
                        path: filePath,
                        size: stats.size,
                        hash: hash
                    });
                }
            }
            
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
            return mediaFiles;
        } catch (error) {
            this.log(`Error reading source folder: ${error.message}`, 'error');
            return [];
        }
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    clearLine() {
        if (process.stdout.isTTY) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
        }
    }
    
    showUploadProgress(filename, bytesUploaded, totalBytes) {
        if (!process.stdout.isTTY) return;
        
        const percent = Math.min(100, (bytesUploaded / totalBytes * 100)).toFixed(1);
        const uploaded = this.formatFileSize(bytesUploaded);
        const total = this.formatFileSize(totalBytes);
        const barLength = 30;
        const filledLength = Math.round(barLength * bytesUploaded / totalBytes);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        
        this.clearLine();
        process.stdout.write(`📤 ${filename} │ ${bar} │ ${percent}% │ ${uploaded}/${total}`);
    }
    
    async uploadToS3(filePath, s3Key, fileSize) {
        const startTime = Date.now();
        const filename = path.basename(filePath);
        
        try {
            const fileBuffer = await fs.readFile(filePath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            
            // Show initial progress
            this.showUploadProgress(filename, 0, fileSize);
            
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: s3Key,
                Body: fileBuffer,
                ContentType: contentType,
                Metadata: {
                    'original-filename': path.basename(filePath),
                    'upload-timestamp': new Date().toISOString()
                }
            });
            
            const response = await this.s3Client.send(command);
            
            // Show 100% completion
            this.showUploadProgress(filename, fileSize, fileSize);
            console.log(''); // New line after progress bar
            
            const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
            const uploadSpeed = (fileSize / (1024 * 1024) / uploadTime).toFixed(2);
            
            this.log(`✅ Successfully uploaded ${filename} in ${uploadTime}s (${uploadSpeed} MB/s)`, 'success');
            return true;
            
        } catch (error) {
            console.log(''); // New line after progress bar
            const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
            this.log(`❌ Failed to upload ${filename} after ${uploadTime}s: ${error.message}`, 'error');
            
            if (error.name === 'NetworkingError') {
                this.log('Network error occurred. Check your internet connection.', 'warning');
            } else if (error.$metadata?.httpStatusCode === 403) {
                this.log('Permission denied. Check your AWS credentials and bucket permissions.', 'warning');
            }
            
            return false;
        }
    }
    
    async deleteFile(filePath) {
        try {
            await fs.unlink(filePath);
            this.log(`🗑️  Deleted local file: ${path.basename(filePath)}`, 'info');
            return true;
        } catch (error) {
            this.log(`❌ Failed to delete ${path.basename(filePath)}: ${error.message}`, 'error');
            return false;
        }
    }
    
    logUpload(filename, s3Key, fileSize, fileHash) {
        const uploadRecord = {
            s3Key: s3Key,
            uploadDate: new Date().toISOString(),
            fileSizeBytes: fileSize,
            fileHash: fileHash,
            status: 'completed',
            bucket: this.bucketName,
            deleted: true
        };
        
        // Save to current progress
        this.progress.uploadedFiles[filename] = uploadRecord;
        this.progress.session.completedFiles++;
        
        // Save to permanent history
        this.uploadHistory.files[filename] = uploadRecord;
        this.uploadHistory.metadata.totalUploads++;
        this.uploadHistory.metadata.totalSizeUploaded += fileSize;
    }
    
    printProgressSummary() {
        const historyCount = Object.keys(this.uploadHistory.files || {}).length;
        const totalSize = this.uploadHistory.metadata?.totalSizeUploaded || 0;
        const lastUpdate = this.uploadHistory.metadata?.lastUpdated || 'Never';
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 S3 UPLOAD HISTORY SUMMARY');
        console.log('='.repeat(70));
        console.log(`📅 Last Updated: ${new Date(lastUpdate).toLocaleString()}`);
        console.log(`🎯 Total Files Ever Uploaded: ${historyCount}`);
        console.log(`💾 Total Data Uploaded: ${this.formatFileSize(totalSize)}`);
        console.log(`📦 S3 Bucket: ${this.bucketName}`);
        console.log(`📁 Source Folder: ${this.sourceFolder}`);
        console.log('='.repeat(70) + '\n');
    }
    
    async processFiles() {
        const mediaFiles = await this.getMediaFiles();
        
        if (mediaFiles.length === 0) {
            this.log('No media files found in source folder', 'info');
            return;
        }
        
        // Filter out files that are already in history
        const newFiles = [];
        const skippedFiles = [];
        
        for (const file of mediaFiles) {
            if (this.isFileInHistory(file.name, file.hash)) {
                skippedFiles.push(file);
            } else {
                newFiles.push(file);
            }
        }
        
        const totalSize = mediaFiles.reduce((sum, file) => sum + file.size, 0);
        const newFilesSize = newFiles.reduce((sum, file) => sum + file.size, 0);
        
        this.log(`Found ${mediaFiles.length} media files (${this.formatFileSize(totalSize)} total)`, 'info');
        this.log(`${skippedFiles.length} files already uploaded (will be skipped)`, 'info');
        this.log(`${newFiles.length} new files to upload (${this.formatFileSize(newFilesSize)})`, 'info');
        
        // Handle skipped files
        if (skippedFiles.length > 0) {
            console.log('\n📋 Previously uploaded files found:');
            for (const file of skippedFiles) {
                const historyRecord = this.uploadHistory.files[file.name];
                const uploadDate = historyRecord?.uploadDate ? new Date(historyRecord.uploadDate).toLocaleString() : 'Unknown';
                console.log(`  ⏭️  ${file.name} (uploaded: ${uploadDate})`);
            }
            this.sessionStats.skipped = skippedFiles.length;
        }
        
        if (newFiles.length === 0) {
            this.log('\n✅ All files have already been uploaded!', 'success');
            return;
        }
        
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🚀 STARTING UPLOAD OF ${newFiles.length} NEW FILES`);
        console.log(`${'='.repeat(70)}\n`);
        
        // Update session info
        this.progress.session.totalFiles = newFiles.length;
        this.progress.session.startTime = new Date().toISOString();
        
        // Process each new file
        for (let i = 0; i < newFiles.length; i++) {
            const file = newFiles[i];
            
            try {
                console.log(`\n[${ i + 1}/${newFiles.length}] Processing: ${file.name} (${this.formatFileSize(file.size)})`);
                console.log('-'.repeat(70));
                
                // Upload to S3
                const s3Key = `media/${file.name}`;
                
                if (await this.uploadToS3(file.path, s3Key, file.size)) {
                    // Log the upload
                    this.logUpload(file.name, s3Key, file.size, file.hash);
                    
                    // Save progress after upload
                    await this.saveProgress();
                    await this.saveUploadHistory();
                    
                    // Delete the file after successful upload
                    if (await this.deleteFile(file.path)) {
                        this.sessionStats.deleted++;
                        this.sessionStats.uploaded++;
                        this.sessionStats.uploadedSize += file.size;
                        this.log(`✅ File uploaded and deleted successfully`, 'success');
                    } else {
                        this.sessionStats.uploaded++;
                        this.sessionStats.uploadedSize += file.size;
                        this.log(`⚠️  File uploaded but deletion failed`, 'warning');
                    }
                } else {
                    this.sessionStats.failed++;
                    this.log(`❌ Upload failed - file kept in source folder`, 'error');
                }
                
                // Show overall progress
                const completed = i + 1;
                const progressPercent = ((completed / newFiles.length) * 100).toFixed(1);
                const remainingFiles = newFiles.length - completed;
                console.log(`\n📊 Overall Progress: ${completed}/${newFiles.length} (${progressPercent}%) - ${remainingFiles} remaining`);
                
            } catch (error) {
                this.log(`❌ Error processing ${file.name}: ${error.message}`, 'error');
                this.sessionStats.failed++;
            }
        }
        
        // Final save
        await this.saveProgress();
        await this.saveUploadHistory();
        this.printSessionSummary();
    }
    
    printSessionSummary() {
        const { uploaded, skipped, failed, deleted, uploadedSize } = this.sessionStats;
        const total = uploaded + skipped + failed;
        
        console.log('\n' + '='.repeat(70));
        console.log('🎉 SESSION COMPLETE');
        console.log('='.repeat(70));
        console.log(`✅ Uploaded: ${uploaded} files (${this.formatFileSize(uploadedSize)})`);
        console.log(`🗑️  Deleted: ${deleted} files (freed space: ${this.formatFileSize(uploadedSize)})`);
        console.log(`⏭️  Skipped: ${skipped} files (already uploaded)`);
        console.log(`❌ Failed: ${failed} files`);
        console.log(`📊 Total processed: ${total} files`);
        console.log(`🗃️  Total files in history: ${Object.keys(this.uploadHistory.files).length}`);
        console.log('='.repeat(70));
        
        if (failed > 0) {
            console.log('\n⚠️  Some files failed to upload. They remain in the source folder.');
            console.log('   Run the script again to retry failed uploads.');
        }
    }
    
    showUploadHistory() {
        const uploadedFiles = this.uploadHistory.files || {};
        
        if (Object.keys(uploadedFiles).length === 0) {
            console.log('\n📝 No upload history found.');
            return;
        }
        
        console.log(`\n📋 Upload History (${Object.keys(uploadedFiles).length} files):`);
        console.log('-'.repeat(80));
        
        // Group by date
        const filesByDate = {};
        for (const [filename, details] of Object.entries(uploadedFiles)) {
            const uploadDate = details.uploadDate ? details.uploadDate.split('T')[0] : 'Unknown';
            if (!filesByDate[uploadDate]) filesByDate[uploadDate] = [];
            filesByDate[uploadDate].push({ filename, ...details });
        }
        
        // Display grouped by date (show last 7 days)
        const sortedDates = Object.keys(filesByDate).sort().reverse().slice(0, 7);
        for (const date of sortedDates) {
            const files = filesByDate[date];
            console.log(`\n📅 ${date} (${files.length} files):`);
            files.slice(0, 10).forEach(file => {
                const size = this.formatFileSize(file.fileSizeBytes || 0);
                const time = file.uploadDate ? new Date(file.uploadDate).toLocaleTimeString() : 'Unknown';
                const status = file.deleted ? '🗑️' : '📁';
                console.log(`  ${status} ${file.filename} (${size}) - ${time}`);
            });
            if (files.length > 10) {
                console.log(`  ... and ${files.length - 10} more files`);
            }
        }
        console.log('-'.repeat(80));
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const colors = {
            info: '\x1b[36m',
            success: '\x1b[32m',
            warning: '\x1b[33m',
            error: '\x1b[31m'
        };
        const reset = '\x1b[0m';
        
        const color = colors[level] || colors.info;
        const prefix = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        }[level] || 'ℹ️';
        
        console.log(`${color}${prefix} [${new Date(timestamp).toLocaleTimeString()}] ${message}${reset}`);
        
        // Write to log file
        const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
        try {
            fsSync.appendFileSync(this.logFile, logEntry);
        } catch (error) {
            // Ignore log file write errors
        }
    }
}

async function main() {
    const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'your-s3-bucket-name';
    const SOURCE_FOLDER = process.env.SOURCE_FOLDER || './downloads';
    const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    
    if (BUCKET_NAME === 'your-s3-bucket-name') {
        console.error('❌ Please set S3_BUCKET_NAME environment variable or update the script');
        console.error('Example: export S3_BUCKET_NAME=my-media-bucket');
        process.exit(1);
    }
    
    console.log('\n🚀 S3 Media Uploader with Auto-Delete');
    console.log('='.repeat(70));
    console.log('🔧 Configuration:');
    console.log(`  📦 S3 Bucket: ${BUCKET_NAME}`);
    console.log(`  📁 Source Folder: ${SOURCE_FOLDER}`);
    console.log(`  🌍 AWS Region: ${AWS_REGION}`);
    console.log(`  🔑 AWS Access Key: ${process.env.AWS_ACCESS_KEY_ID ? '✓ Set' : '✗ Not set'}`);
    console.log(`  🔐 AWS Secret Key: ${process.env.AWS_SECRET_ACCESS_KEY ? '✓ Set' : '✗ Not set'}`);
    console.log('='.repeat(70));
    
    try {
        const uploader = new S3MediaUploader(BUCKET_NAME, SOURCE_FOLDER, AWS_REGION);
        await uploader.init();
        
        uploader.printProgressSummary();
        uploader.showUploadHistory();
        
        await uploader.processFiles();
        
    } catch (error) {
        console.error(`\n❌ Error: ${error.message}`);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log('\n\n⚡ Upload interrupted by user');
    console.log('💾 Progress has been saved automatically');
    console.log('🔄 You can resume by running the script again');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

if (require.main === module) {
    main();
}

module.exports = S3MediaUploader;