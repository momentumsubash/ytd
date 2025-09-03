const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class VideoMerger {
    constructor() {
        this.videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
        this.audioExtensions = ['.m4a', '.mp3', '.aac', '.wav', '.webm'];
    }

    // Extract base name by removing the _video or _audio suffix
    getBaseName(filename) {
        const nameWithoutExt = path.basename(filename, path.extname(filename));
        
        if (nameWithoutExt.endsWith('_video')) {
            return nameWithoutExt.slice(0, -6);
        } else if (nameWithoutExt.endsWith('_audio')) {
            return nameWithoutExt.slice(0, -6);
        }
        
        return nameWithoutExt;
    }

    // Find matching video and audio files
    findMatchingPairs(files) {
        const pairs = [];
        const fileMap = {};
        
        // Group files by their base name
        files.forEach(file => {
            const baseName = this.getBaseName(file);
            const ext = path.extname(file).toLowerCase();
            
            if (!fileMap[baseName]) {
                fileMap[baseName] = { video: null, audio: null };
            }
            
            if (this.videoExtensions.includes(ext)) {
                fileMap[baseName].video = file;
            } else if (this.audioExtensions.includes(ext)) {
                fileMap[baseName].audio = file;
            }
        });
        
        // Create pairs for entries that have both video and audio
        for (const baseName in fileMap) {
            if (fileMap[baseName].video && fileMap[baseName].audio) {
                pairs.push({
                    baseName,
                    video: fileMap[baseName].video,
                    audio: fileMap[baseName].audio,
                    output: `${baseName}.mp4`
                });
            }
        }
        
        return pairs;
    }

    // Find audio-only files
    findAudioOnlyFiles(files, pairs) {
        const pairedBaseNames = new Set(pairs.map(pair => pair.baseName));
        const audioFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return this.audioExtensions.includes(ext);
        });
        
        return audioFiles.filter(file => {
            const baseName = this.getBaseName(file);
            return !pairedBaseNames.has(baseName);
        });
    }

    // Find video-only files
    findVideoOnlyFiles(files, pairs) {
        const pairedBaseNames = new Set(pairs.map(pair => pair.baseName));
        const videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return this.videoExtensions.includes(ext);
        });
        
        return videoFiles.filter(file => {
            const baseName = this.getBaseName(file);
            return !pairedBaseNames.has(baseName);
        });
    }

    // Merge video and audio using FFmpeg
    async mergeVideoAudio(videoPath, audioPath, outputPath) {
        try {
            const command = `ffmpeg -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 "${outputPath}" -y`;
            
            console.log(`🔧 Merging: ${path.basename(videoPath)} + ${path.basename(audioPath)}`);
            
            const { stdout, stderr } = await execPromise(command);
            
            console.log(`✅ Successfully merged: ${path.basename(outputPath)}`);
            return true;
        } catch (error) {
            console.error(`❌ Error merging ${path.basename(videoPath)}:`, error.message);
            return false;
        }
    }

    // Copy audio file (for audio-only content)
    async copyAudioFile(audioPath, outputPath) {
        try {
            await fs.copyFile(audioPath, outputPath);
            console.log(`✅ Copied audio file: ${path.basename(outputPath)}`);
            return true;
        } catch (error) {
            console.error(`❌ Error copying audio file ${path.basename(audioPath)}:`, error.message);
            return false;
        }
    }

    // Copy video file (for video-only content)
    async copyVideoFile(videoPath, outputPath) {
        try {
            await fs.copyFile(videoPath, outputPath);
            console.log(`✅ Copied video file: ${path.basename(outputPath)}`);
            return true;
        } catch (error) {
            console.error(`❌ Error copying video file ${path.basename(videoPath)}:`, error.message);
            return false;
        }
    }

    // Delete source files after successful merge/copy
    async deleteSourceFiles(files) {
        for (const file of files) {
            try {
                await fs.unlink(file);
                console.log(`🗑️ Deleted source file: ${path.basename(file)}`);
            } catch (error) {
                console.error(`❌ Error deleting file ${path.basename(file)}:`, error.message);
            }
        }
    }

    async processDownloads(inputFolder = './downloads', outputFolder = './merged', alreadyProcessed = []) {
        console.log('🔍 Scanning for files to process...');
        
        try {
            // Read all files from input directory
            const allFiles = await fs.readdir(inputFolder);
            
            console.log(`📁 Found ${allFiles.length} files total`);
            
            // Filter out already processed files
            const filesToProcess = allFiles.filter(file => 
                !alreadyProcessed.includes(this.getBaseName(file))
            );
            
            if (filesToProcess.length === 0) {
                console.log('⏭️ No new files to process');
                return { mergedFiles: [], audioOnlyFiles: [], videoOnlyFiles: [] };
            }
            
            // Find matching pairs
            const pairs = this.findMatchingPairs(filesToProcess);
            console.log(`📊 Found ${pairs.length} matching video/audio pairs`);
            
            // Find audio-only files
            const audioOnlyFiles = this.findAudioOnlyFiles(filesToProcess, pairs);
            console.log(`📊 Found ${audioOnlyFiles.length} audio-only files`);
            
            // Find video-only files
            const videoOnlyFiles = this.findVideoOnlyFiles(filesToProcess, pairs);
            console.log(`📊 Found ${videoOnlyFiles.length} video-only files`);
            
            const results = {
                mergedFiles: [],
                audioOnlyFiles: [],
                videoOnlyFiles: []
            };
            
            // Process each pair
            for (const pair of pairs) {
                const videoPath = path.join(inputFolder, pair.video);
                const audioPath = path.join(inputFolder, pair.audio);
                const outputPath = path.join(outputFolder, pair.output);
                
                console.log(`\n🔄 Processing: ${pair.baseName}`);
                
                if (await this.mergeVideoAudio(videoPath, audioPath, outputPath)) {
                    results.mergedFiles.push(pair.output);
                    // Delete source files after successful merge
                    await this.deleteSourceFiles([videoPath, audioPath]);
                }
            }
            
            // Process audio-only files
            for (const audioFile of audioOnlyFiles) {
                const audioPath = path.join(inputFolder, audioFile);
                const baseName = this.getBaseName(audioFile);
                const outputPath = path.join(outputFolder, `${baseName}.mp3`);
                
                console.log(`\n🔄 Processing audio-only: ${baseName}`);
                
                if (await this.copyAudioFile(audioPath, outputPath)) {
                    results.audioOnlyFiles.push(`${baseName}.mp3`);
                    // Delete source file after successful copy
                    await this.deleteSourceFiles([audioPath]);
                }
            }
            
            // Process video-only files
            for (const videoFile of videoOnlyFiles) {
                const videoPath = path.join(inputFolder, videoFile);
                const baseName = this.getBaseName(videoFile);
                const outputPath = path.join(outputFolder, `${baseName}.mp4`);
                
                console.log(`\n🔄 Processing video-only: ${baseName}`);
                
                if (await this.copyVideoFile(videoPath, outputPath)) {
                    results.videoOnlyFiles.push(`${baseName}.mp4`);
                    // Delete source file after successful copy
                    await this.deleteSourceFiles([videoPath]);
                }
            }
            
            console.log('\n📊 Processing completed:');
            console.log(`✅ Merged files: ${results.mergedFiles.length}`);
            console.log(`✅ Audio-only files: ${results.audioOnlyFiles.length}`);
            console.log(`✅ Video-only files: ${results.videoOnlyFiles.length}`);
            
            return results;
            
        } catch (error) {
            console.error('❌ Error processing files:', error.message);
            return { mergedFiles: [], audioOnlyFiles: [], videoOnlyFiles: [] };
        }
    }
}

module.exports = { VideoMerger };