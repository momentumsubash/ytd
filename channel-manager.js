const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');

class YouTubeChannelManager {
  constructor() {
    this.ytDlpWrap = new YTDlpWrap();
    this.channelsFile = path.join(__dirname, 'channels.json');
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

  // Helper method to extract channel ID from various URL formats
  extractChannelId(channelUrl) {
    try {
      const url = new URL(channelUrl);
      
      // Handle different URL formats
      if (url.pathname.includes('/channel/')) {
        return url.pathname.split('/channel/')[1].split('/')[0];
      } else if (url.pathname.includes('/@')) {
        return url.pathname.split('/@')[1].split('/')[0];
      } else if (url.pathname.includes('/c/')) {
        return url.pathname.split('/c/')[1].split('/')[0];
      } else if (url.pathname.includes('/user/')) {
        return url.pathname.split('/user/')[1].split('/')[0];
      }
      
      return null;
    } catch (error) {
      console.log(`⚠️  Could not parse channel URL: ${channelUrl}`);
      return null;
    }
  }

  // Method to get channel info first (to get proper channel ID)
  async getChannelInfo(channelUrl) {
    try {
      console.log(`🔍 Getting channel info for: ${channelUrl}`);
      
      const output = await this.ytDlpWrap.execPromise([
        channelUrl,
        '--flat-playlist',
        '--playlist-end', '1',
        '--print', '%(channel)s|%(channel_id)s|%(channel_url)s|%(uploader)s',
        '--no-warnings',
        '--ignore-errors'
      ]);

      const lines = output.trim().split('\n').filter(line => line.trim());
      
      if (lines.length > 0) {
        const parts = lines[0].split('|');
        if (parts.length >= 3) {
          return {
            name: parts[0] || parts[3] || 'Unknown Channel',
            channelId: parts[1],
            channelUrl: parts[2] || channelUrl,
            originalUrl: channelUrl
          };
        }
      }
      
      return null;
    } catch (error) {
      console.log(`⚠️  Could not get channel info: ${error.message}`);
      return null;
    }
  }

  async getChannelPlaylists(channelUrl, channelName) {
    try {
      console.log(`📋 Getting playlists from: ${channelName}`);
      
      let playlists = [];
      let channelInfo = null;

      // First, get proper channel info
      channelInfo = await this.getChannelInfo(channelUrl);
      if (channelInfo) {
        console.log(`✅ Channel info: ${channelInfo.name} (ID: ${channelInfo.channelId})`);
        channelName = channelInfo.name; // Use the actual channel name
      }

      // Method 1: Direct playlist extraction using multiple URL formats
      const urlsToTry = [
        `${channelUrl}/playlists`,
        `${channelUrl}/playlists?view=1`,
        channelUrl // Sometimes the main channel URL works
      ];

      // If we have channel info, try the canonical URLs too
      if (channelInfo && channelInfo.channelId) {
        urlsToTry.push(`https://www.youtube.com/channel/${channelInfo.channelId}/playlists`);
        urlsToTry.push(`https://www.youtube.com/channel/${channelInfo.channelId}/playlists?view=1`);
      }

      for (const url of urlsToTry) {
        try {
          console.log(`🔍 Trying playlist URL: ${url}`);
          
          const output = await this.ytDlpWrap.execPromise([
            url,
            '--flat-playlist',
            '--print', '%(playlist_title)s|%(playlist_id)s|%(playlist_url)s|%(playlist_count)s|%(id)s',
            '--no-warnings',
            '--ignore-errors',
            '--playlist-end', '50' // Get more playlists
          ]);

          const lines = output.trim().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 4) {
              const playlistTitle = parts[0];
              const playlistId = parts[1] || parts[4]; // Fallback to id if playlist_id is empty
              const playlistUrl = parts[2];
              const videoCount = parseInt(parts[3]) || 0;
              
              // Validate playlist data
              if (playlistTitle && playlistId && playlistId.length > 10 && videoCount > 0) {
                // Ensure proper playlist URL
                let finalUrl = playlistUrl;
                if (!finalUrl || !finalUrl.includes('playlist?list=')) {
                  finalUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
                }
                
                playlists.push({
                  title: playlistTitle.trim(),
                  id: playlistId,
                  url: finalUrl,
                  videoCount: videoCount,
                  channelName: channelName
                });
              }
            }
          }
          
          if (playlists.length > 0) {
            console.log(`✅ Found ${playlists.length} playlists using URL: ${url}`);
            break; // Stop trying other URLs if we found playlists
          }
        } catch (error) {
          console.log(`⚠️  Failed with URL ${url}: ${error.message}`);
        }
      }

      // Method 2: If no playlists found, try extracting from channel videos with playlist info
      if (playlists.length === 0 && channelInfo) {
        try {
          console.log(`🔍 Method 2: Extracting playlists from channel videos...`);
          
          const output = await this.ytDlpWrap.execPromise([
            channelInfo.channelUrl || channelUrl,
            '--flat-playlist',
            '--print', '%(playlist_title)s|%(playlist_id)s|%(playlist)s',
            '--no-warnings',
            '--ignore-errors',
            '--playlist-end', '100' // Check more videos to find playlist associations
          ]);

          const lines = output.trim().split('\n').filter(line => line.trim());
          const playlistSet = new Set();
          
          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 2) {
              const playlistTitle = parts[0];
              const playlistId = parts[1] || parts[2];
              
              if (playlistTitle && playlistId && playlistId.length > 10 && 
                  playlistTitle !== 'NA' && playlistId !== 'NA' && 
                  !playlistSet.has(playlistId)) {
                
                playlistSet.add(playlistId);
                
                // Verify this is a real playlist by checking it
                try {
                  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
                  const playlistInfo = await this.ytDlpWrap.execPromise([
                    playlistUrl,
                    '--flat-playlist',
                    '--print', '%(playlist_count)s',
                    '--no-warnings',
                    '--ignore-errors',
                    '--playlist-end', '1'
                  ]);

                  const videoCount = parseInt(playlistInfo.trim()) || 0;
                  
                  if (videoCount > 0) {
                    playlists.push({
                      title: playlistTitle.trim(),
                      id: playlistId,
                      url: playlistUrl,
                      videoCount: videoCount,
                      channelName: channelName
                    });
                  }
                } catch (verifyError) {
                  console.log(`⚠️  Could not verify playlist ${playlistId}: ${verifyError.message}`);
                }
              }
            }
          }
          
          console.log(`✅ Method 2 found ${playlists.length} additional playlists`);
        } catch (error) {
          console.log(`⚠️  Method 2 failed: ${error.message}`);
        }
      }

      // Method 3: Try using youtube-dl's JSON output for more detailed info
      if (playlists.length === 0) {
        try {
          console.log(`🔍 Method 3: Using JSON extraction...`);
          
          const output = await this.ytDlpWrap.execPromise([
            `${channelUrl}/playlists`,
            '--dump-json',
            '--flat-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--playlist-end', '20'
          ]);

          // Parse JSON output line by line
          const lines = output.trim().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              if (data.playlist_title && data.playlist_id && data.playlist_count > 0) {
                playlists.push({
                  title: data.playlist_title,
                  id: data.playlist_id,
                  url: `https://www.youtube.com/playlist?list=${data.playlist_id}`,
                  videoCount: data.playlist_count,
                  channelName: channelName
                });
              }
            } catch (jsonError) {
              // Skip invalid JSON lines
            }
          }
          
          console.log(`✅ Method 3 found ${playlists.length} playlists via JSON`);
        } catch (error) {
          console.log(`⚠️  Method 3 failed: ${error.message}`);
        }
      }

      // Method 4: Try searching for playlists by channel name
      if (playlists.length === 0) {
        try {
          console.log(`🔍 Method 4: Searching for playlists by channel name...`);
          
          const searchQueries = [
            `"${channelName}" playlist site:youtube.com`,
            `${channelName} playlist`,
            `channel:"${channelName}" playlist`
          ];

          for (const searchQuery of searchQueries) {
            try {
              const output = await this.ytDlpWrap.execPromise([
                `ytsearch15:${searchQuery}`,
                '--flat-playlist',
                '--print', '%(title)s|%(id)s|%(url)s|%(playlist_count)s|%(uploader)s|%(channel)s',
                '--no-warnings',
                '--ignore-errors'
              ]);

              const lines = output.trim().split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 4) {
                  const title = parts[0];
                  const id = parts[1];
                  const url = parts[2];
                  const count = parseInt(parts[3]) || 0;
                  const uploader = parts[4] || '';
                  const channel = parts[5] || '';
                  
                  // Check if this playlist belongs to our target channel
                  const uploaderMatch = uploader.toLowerCase().includes(channelName.toLowerCase());
                  const channelMatch = channel.toLowerCase().includes(channelName.toLowerCase());
                  const titleMatch = title.toLowerCase().includes('playlist') || 
                                   title.toLowerCase().includes('series') ||
                                   title.toLowerCase().includes('episodes');
                  
                  if (id && id.startsWith('PL') && count > 0 && (uploaderMatch || channelMatch || titleMatch)) {
                    const playlistUrl = url.includes('playlist?list=') ? url : `https://www.youtube.com/playlist?list=${id}`;
                    
                    playlists.push({
                      title: title.trim(),
                      id: id,
                      url: playlistUrl,
                      videoCount: count,
                      channelName: channelName
                    });
                  }
                }
              }
              
              if (playlists.length > 0) {
                console.log(`✅ Method 4 found playlists with query: "${searchQuery}"`);
                break;
              }
            } catch (searchError) {
              console.log(`⚠️  Search query failed: "${searchQuery}"`);
            }
          }
        } catch (error) {
          console.log(`⚠️  Method 4 failed: ${error.message}`);
        }
      }

      // Method 5: Extract playlists from channel's video metadata
      if (playlists.length === 0) {
        try {
          console.log(`🔍 Method 5: Extracting playlists from video metadata...`);
          
          // Get videos from the channel and look for playlist associations
          const output = await this.ytDlpWrap.execPromise([
            channelUrl,
            '--flat-playlist',
            '--print', '%(playlist_title)s|%(playlist_id)s|%(title)s',
            '--no-warnings',
            '--ignore-errors',
            '--playlist-end', '200' // Check more videos
          ]);

          const lines = output.trim().split('\n').filter(line => line.trim());
          const playlistMap = new Map();
          
          for (const line of lines) {
            const parts = line.split('|');
            if (parts.length >= 2) {
              const playlistTitle = parts[0];
              const playlistId = parts[1];
              
              if (playlistTitle && playlistId && 
                  playlistTitle !== 'NA' && playlistId !== 'NA' && 
                  playlistTitle !== channelName && // Exclude the main channel "playlist"
                  playlistId.startsWith('PL') && playlistId.length > 15) {
                
                if (!playlistMap.has(playlistId)) {
                  playlistMap.set(playlistId, {
                    title: playlistTitle.trim(),
                    id: playlistId,
                    videoCount: 1
                  });
                } else {
                  playlistMap.get(playlistId).videoCount++;
                }
              }
            }
          }
          
          // Convert map to array and filter out playlists with too few videos
          for (const [id, playlist] of playlistMap) {
            if (playlist.videoCount >= 2) { // At least 2 videos to be considered a real playlist
              playlists.push({
                title: playlist.title,
                id: playlist.id,
                url: `https://www.youtube.com/playlist?list=${playlist.id}`,
                videoCount: playlist.videoCount,
                channelName: channelName
              });
            }
          }
          
          console.log(`✅ Method 5 found ${playlists.length} playlists from video metadata`);
        } catch (error) {
          console.log(`⚠️  Method 5 failed: ${error.message}`);
        }
      }

      // Method 6: Use yt-dlp's tab extraction if available
      if (playlists.length === 0 && channelInfo && channelInfo.channelId) {
        try {
          console.log(`🔍 Method 6: Using tab-based extraction...`);
          
          const tabUrls = [
            `https://www.youtube.com/channel/${channelInfo.channelId}/playlists`,
            `https://www.youtube.com/c/${channelInfo.channelId}/playlists`,
            `https://www.youtube.com/@${channelInfo.channelId}/playlists`
          ];

          for (const tabUrl of tabUrls) {
            try {
              const output = await this.ytDlpWrap.execPromise([
                tabUrl,
                '--flat-playlist',
                '--print', 'PLAYLIST:%(title)s|%(id)s|%(playlist_count)s',
                '--no-warnings',
                '--ignore-errors',
                '--extractor-args', 'youtube:tab_types=playlists',
                '--playlist-end', '30'
              ]);

              const lines = output.trim().split('\n').filter(line => line.trim() && line.startsWith('PLAYLIST:'));
              
              for (const line of lines) {
                const content = line.replace('PLAYLIST:', '');
                const parts = content.split('|');
                
                if (parts.length >= 3) {
                  const title = parts[0];
                  const id = parts[1];
                  const count = parseInt(parts[2]) || 0;
                  
                  if (title && id && id.startsWith('PL') && count > 0) {
                    playlists.push({
                      title: title.trim(),
                      id: id,
                      url: `https://www.youtube.com/playlist?list=${id}`,
                      videoCount: count,
                      channelName: channelName
                    });
                  }
                }
              }
              
              if (playlists.length > 0) {
                console.log(`✅ Method 6 found playlists using: ${tabUrl}`);
                break;
              }
            } catch (tabError) {
              console.log(`⚠️  Tab URL failed: ${tabUrl}`);
            }
          }
        } catch (error) {
          console.log(`⚠️  Method 6 failed: ${error.message}`);
        }
      }

      // Method 7: Brute force approach - try to find playlists by searching for the channel
      if (playlists.length === 0) {
        try {
          console.log(`🔍 Method 7: Brute force playlist search...`);
          
          const searchTerms = [
            `${channelName} playlists`,
            `${channelName} series`,
            `${channelName} episodes`,
            `channel:"${channelName}"`
          ];

          for (const term of searchTerms) {
            try {
              const output = await this.ytDlpWrap.execPromise([
                `ytsearch20:${term}`,
                '--flat-playlist',
                '--print', '%(title)s|%(id)s|%(url)s|%(uploader)s|%(duration)s',
                '--no-warnings',
                '--ignore-errors'
              ]);

              const lines = output.trim().split('\n').filter(line => line.trim());
              const potentialPlaylists = new Set();
              
              for (const line of lines) {
                const parts = line.split('|');
                if (parts.length >= 4) {
                  const uploader = parts[3];
                  const videoUrl = parts[2];
                  
                  // Check if uploader matches our channel
                  if (uploader && uploader.toLowerCase().includes(channelName.toLowerCase())) {
                    // Extract playlist ID from video URL if it's part of a playlist
                    const listMatch = videoUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/);
                    if (listMatch && listMatch[1].startsWith('PL')) {
                      potentialPlaylists.add(listMatch[1]);
                    }
                  }
                }
              }
              
              // Verify each potential playlist
              for (const playlistId of potentialPlaylists) {
                try {
                  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
                  const playlistOutput = await this.ytDlpWrap.execPromise([
                    playlistUrl,
                    '--flat-playlist',
                    '--print', '%(playlist_title)s|%(playlist_count)s|%(uploader)s',
                    '--no-warnings',
                    '--ignore-errors',
                    '--playlist-end', '1'
                  ]);

                  const playlistLines = playlistOutput.trim().split('\n').filter(line => line.trim());
                  if (playlistLines.length > 0) {
                    const playlistParts = playlistLines[0].split('|');
                    if (playlistParts.length >= 2) {
                      const playlistTitle = playlistParts[0];
                      const videoCount = parseInt(playlistParts[1]) || 0;
                      const uploader = playlistParts[2] || '';
                      
                      // Double-check this playlist belongs to our channel
                      if (videoCount > 1 && 
                          (uploader.toLowerCase().includes(channelName.toLowerCase()) || 
                           playlistTitle.toLowerCase().includes(channelName.toLowerCase()))) {
                        
                        playlists.push({
                          title: playlistTitle.trim(),
                          id: playlistId,
                          url: playlistUrl,
                          videoCount: videoCount,
                          channelName: channelName
                        });
                      }
                    }
                  }
                } catch (playlistError) {
                  // Skip invalid playlists
                }
              }
              
              if (playlists.length > 0) {
                console.log(`✅ Method 7 found playlists with search: "${term}"`);
                break;
              }
            } catch (termError) {
              console.log(`⚠️  Search term failed: "${term}"`);
            }
          }
        } catch (error) {
          console.log(`⚠️  Method 7 failed: ${error.message}`);
        }
      }

      // Remove duplicates and sort by video count
      const uniquePlaylists = [];
      const seenIds = new Set();
      
      for (const playlist of playlists) {
        if (!seenIds.has(playlist.id)) {
          seenIds.add(playlist.id);
          uniquePlaylists.push(playlist);
        }
      }

      // Sort by video count (descending)
      uniquePlaylists.sort((a, b) => b.videoCount - a.videoCount);

      // Method 8: If still no playlists found, create "Latest Videos" as fallback
      if (uniquePlaylists.length === 0) {
        console.log(`📺 No playlists found for ${channelName}, creating "Latest Videos" fallback`);
        
        // Try to get actual video count from the channel
        let actualVideoCount = 50; // Default estimate
        try {
          const channelVideosOutput = await this.ytDlpWrap.execPromise([
            channelUrl,
            '--flat-playlist',
            '--print', '%(title)s',
            '--no-warnings',
            '--ignore-errors',
            '--playlist-end', '100'
          ]);
          
          const videoLines = channelVideosOutput.trim().split('\n').filter(line => line.trim());
          actualVideoCount = Math.min(videoLines.length, 50);
        } catch (countError) {
          console.log(`⚠️  Could not count videos, using estimate`);
        }
        
        uniquePlaylists.push({
          title: `${channelName} - Latest Videos`,
          id: `latest_${channelName.replace(/[^\w]/g, '_')}`,
          url: `${channelUrl}/videos`,
          videoCount: actualVideoCount,
          channelName: channelName,
          isLatestVideos: true
        });
      }

      console.log(`\n✅ Final result for ${channelName}: ${uniquePlaylists.length} playlists`);
      uniquePlaylists.forEach((playlist, index) => {
        const typeIndicator = playlist.isLatestVideos ? ' [Latest Videos]' : ' [Playlist]';
        console.log(`   ${index + 1}. ${playlist.title}${typeIndicator} (${playlist.videoCount} videos)`);
      });

      return uniquePlaylists;
      
    } catch (error) {
      console.error(`❌ Error getting playlists from ${channelName}: ${error.message}`);
      
      // Return fallback even on error
      return [{
        title: `${channelName} - Latest Videos (Fallback)`,
        id: `fallback_${channelName.replace(/[^\w]/g, '_')}`,
        url: `${channelUrl}/videos`,
        videoCount: 25,
        channelName: channelName,
        isLatestVideos: true
      }];
    }
  }

  async searchChannels(searchQueries) {
    const channelsData = {};
    
    for (const query of searchQueries) {
      console.log(`\n🔍 Searching for: ${query}`);
      
      try {
        // Enhanced search with multiple approaches
        const searchUrls = [
          `ytsearch15:${query}`, // General search
          `ytsearch10:${query} channel`, // Explicit channel search
          `ytsearch8:"${query}" channel` // Quoted search for exact matches
        ];

        let allChannels = [];
        
        for (const searchUrl of searchUrls) {
          try {
            console.log(`🔍 Trying search: ${searchUrl}`);
            
            const output = await this.ytDlpWrap.execPromise([
              searchUrl,
              '--flat-playlist',
              '--print', '%(channel)s|%(channel_url)s|%(channel_id)s|%(uploader)s|%(title)s|%(url)s',
              '--no-warnings',
              '--ignore-errors'
            ]);

            const lines = output.trim().split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              const parts = line.split('|');
              if (parts.length >= 4) {
                const channelName = parts[0] || parts[3]; // Fallback to uploader
                let channelUrl = parts[1];
                const channelId = parts[2];
                const uploader = parts[3];
                
                // If no direct channel URL, construct it from channel ID
                if ((!channelUrl || channelUrl === 'NA') && channelId) {
                  channelUrl = `https://www.youtube.com/channel/${channelId}`;
                }
                
                // Validate channel data
                if (channelName && channelUrl && channelName !== 'NA' && 
                    channelUrl.includes('youtube.com') &&
                    (channelName.toLowerCase().includes(query.toLowerCase()) || 
                     uploader.toLowerCase().includes(query.toLowerCase()))) {
                  
                  allChannels.push({
                    name: channelName.trim(),
                    url: channelUrl,
                    channelId: channelId,
                    uploader: uploader,
                    searchQuery: query
                  });
                }
              }
            }
          } catch (searchError) {
            console.log(`⚠️  Search URL failed: ${searchUrl}`);
          }
        }

        // Remove duplicates based on channel ID or URL
        const uniqueChannels = [];
        const seenChannels = new Set();

        for (const channel of allChannels) {
          const identifier = channel.channelId || channel.url;
          if (!seenChannels.has(identifier)) {
            seenChannels.add(identifier);
            uniqueChannels.push(channel);
          }
        }

        console.log(`✅ Found ${uniqueChannels.length} unique channels for "${query}"`);
        
        // Now get playlists for each channel with better error handling
        const channelsWithPlaylists = [];
        
        for (let i = 0; i < Math.min(uniqueChannels.length, 8); i++) { // Limit to 8 channels per query
          const channel = uniqueChannels[i];
          console.log(`\n📺 Channel ${i + 1}/${Math.min(uniqueChannels.length, 8)}: ${channel.name}`);
          console.log(`🔗 ${channel.url}`);
          
          try {
            const playlists = await this.getChannelPlaylists(channel.url, channel.name);
            
            const channelWithPlaylists = {
              name: channel.name,
              url: channel.url,
              channelId: channel.channelId,
              searchQuery: query,
              playlists: playlists
            };
            
            channelsWithPlaylists.push(channelWithPlaylists);
            console.log(`✅ Added ${channel.name} with ${playlists.length} playlists`);
            
          } catch (playlistError) {
            console.error(`❌ Failed to get playlists for ${channel.name}: ${playlistError.message}`);
            
            // Add channel with fallback playlist
            channelsWithPlaylists.push({
              name: channel.name,
              url: channel.url,
              channelId: channel.channelId,
              searchQuery: query,
              playlists: [{
                title: `${channel.name} - Latest Videos (Error Fallback)`,
                id: `error_fallback_${channel.name.replace(/[^\w]/g, '_')}`,
                url: `${channel.url}/videos`,
                videoCount: 20,
                channelName: channel.name,
                isLatestVideos: true
              }]
            });
          }
          
          // Add delay between channels to avoid rate limiting
          if (i < Math.min(uniqueChannels.length, 8) - 1) {
            console.log('⏳ Waiting 8s before next channel...');
            await new Promise(resolve => setTimeout(resolve, 8000));
          }
        }

        channelsData[query] = channelsWithPlaylists;
        
        // Add delay between search queries
        if (searchQueries.indexOf(query) < searchQueries.length - 1) {
          console.log('\n⏳ Waiting 15s before next search query...');
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
        
      } catch (error) {
        console.error(`❌ Error searching for "${query}": ${error.message}`);
        channelsData[query] = [];
      }
    }

    return channelsData;
  }

  async saveChannels(channelsData) {
    try {
      // Calculate totals
      let totalChannels = 0;
      let totalPlaylists = 0;
      
      Object.values(channelsData).forEach(channelList => {
        totalChannels += channelList.length;
        channelList.forEach(channel => {
          totalPlaylists += channel.playlists.length;
        });
      });

      const data = {
        lastUpdated: new Date().toISOString(),
        totalQueries: Object.keys(channelsData).length,
        totalChannels: totalChannels,
        totalPlaylists: totalPlaylists,
        channels: channelsData
      };

      fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2));
      console.log(`\n💾 Saved ${totalChannels} channels with ${totalPlaylists} playlists to channels.json`);
      
      // Print detailed summary
      console.log('\n📊 Channel & Playlist Summary:');
      Object.entries(channelsData).forEach(([query, channelList]) => {
        const totalPlaylistsInCategory = channelList.reduce((sum, channel) => sum + channel.playlists.length, 0);
        console.log(`\n📂 ${query} (${channelList.length} channels, ${totalPlaylistsInCategory} playlists):`);
        
        channelList.forEach((channel, index) => {
          console.log(`   ${index + 1}. ${channel.name} (${channel.playlists.length} playlists)`);
          
          // Show first few playlists
          const playlistsToShow = channel.playlists.slice(0, 3);
          playlistsToShow.forEach((playlist, pIndex) => {
            const typeIndicator = playlist.isLatestVideos ? ' [Latest]' : ' [Playlist]';
            console.log(`      📋 ${playlist.title}${typeIndicator} (${playlist.videoCount} videos)`);
          });
          
          if (channel.playlists.length > 3) {
            console.log(`      ... and ${channel.playlists.length - 3} more playlists`);
          }
        });
      });
      
      return true;
    } catch (error) {
      console.error('❌ Failed to save channels:', error.message);
      return false;
    }
  }

  loadChannels() {
    try {
      if (!fs.existsSync(this.channelsFile)) {
        console.log('❌ channels.json not found. Run search-channels command first.');
        return null;
      }

      const data = JSON.parse(fs.readFileSync(this.channelsFile, 'utf8'));
      console.log(`📖 Loaded ${data.totalChannels} channels with ${data.totalPlaylists} playlists`);
      console.log(`📅 Last updated: ${new Date(data.lastUpdated).toLocaleString()}`);
      
      return data.channels;
    } catch (error) {
      console.error('❌ Failed to load channels:', error.message);
      return null;
    }
  }

  async getChannelVideos(channelUrl, maxVideos = 50) {
    try {
      console.log(`📺 Getting videos from channel: ${channelUrl}`);
      
      // Get channel videos using yt-dlp
      const output = await this.ytDlpWrap.execPromise([
        channelUrl,
        '--flat-playlist',
        '--print', '%(url)s|%(title)s|%(duration)s|%(upload_date)s',
        '--no-warnings',
        '--playlist-end', maxVideos.toString()
      ]);

      const lines = output.trim().split('\n').filter(line => line.trim());
      const videos = [];

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 2) {
          videos.push({
            url: parts[0],
            title: parts[1] || 'Unknown Title',
            duration: parts[2] || 'Unknown',
            uploadDate: parts[3] || 'Unknown'
          });
        }
      }

      console.log(`✅ Found ${videos.length} videos in channel`);
      return videos;
    } catch (error) {
      console.error(`❌ Error getting channel videos: ${error.message}`);
      return [];
    }
  }

  // New method to validate and enrich playlist data
  async validateAndEnrichPlaylists(playlists, channelName) {
    console.log(`🔍 Validating and enriching ${playlists.length} playlists for ${channelName}...`);
    
    const validPlaylists = [];
    
    for (let i = 0; i < playlists.length; i++) {
      const playlist = playlists[i];
      
      try {
        console.log(`🔍 Validating playlist ${i + 1}/${playlists.length}: ${playlist.title}`);
        
        // Skip if it's a latest videos pseudo-playlist
        if (playlist.isLatestVideos) {
          validPlaylists.push(playlist);
          continue;
        }
        
        // Validate the playlist exists and get accurate info
        const output = await this.ytDlpWrap.execPromise([
          playlist.url,
          '--flat-playlist',
          '--print', '%(playlist_title)s|%(playlist_count)s|%(uploader)s|%(channel)s',
          '--no-warnings',
          '--ignore-errors',
          '--playlist-end', '1'
        ]);

        const lines = output.trim().split('\n').filter(line => line.trim());
        
        if (lines.length > 0) {
          const parts = lines[0].split('|');
          if (parts.length >= 2) {
            const actualTitle = parts[0] || playlist.title;
            const actualCount = parseInt(parts[1]) || playlist.videoCount;
            const actualUploader = parts[2] || '';
            const actualChannel = parts[3] || '';
            
            // Verify this playlist belongs to the channel
            const uploaderMatch = actualUploader.toLowerCase().includes(channelName.toLowerCase());
            const channelMatch = actualChannel.toLowerCase().includes(channelName.toLowerCase());
            
            if (actualCount > 0 && (uploaderMatch || channelMatch || !actualUploader)) {
              validPlaylists.push({
                ...playlist,
                title: actualTitle.trim(),
                videoCount: actualCount,
                verified: true
              });
              
              console.log(`✅ Validated: ${actualTitle} (${actualCount} videos)`);
            } else {
              console.log(`⚠️  Playlist doesn't belong to channel: ${actualTitle}`);
            }
          }
        } else {
          console.log(`⚠️  Could not validate playlist: ${playlist.title}`);
        }
        
        // Small delay between validations
        if (i < playlists.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.log(`⚠️  Validation failed for ${playlist.title}: ${error.message}`);
        // Keep unvalidated playlist but mark it
        validPlaylists.push({
          ...playlist,
          verified: false
        });
      }
    }
    
    console.log(`✅ Validation complete: ${validPlaylists.length} valid playlists`);
    return validPlaylists;
  }

  async downloadFromChannels(options = {}) {
    const {
      categories = [], // Array of category names to download from
      maxVideosPerPlaylist = 10,
      maxPlaylistsPerChannel = 5,
      maxChannelsPerCategory = 3,
      delayBetweenPlaylists = 15000, // 15 seconds
      delayBetweenVideos = 3000 // 3 seconds
    } = options;

    const channelsData = this.loadChannels();
    if (!channelsData) return { successful: 0, failed: 0, skipped: 0 };

    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // If no categories specified, use all
    const categoriesToProcess = categories.length > 0 ? categories : Object.keys(channelsData);

    console.log(`\n🎯 Will download from categories: ${categoriesToProcess.join(', ')}`);
    console.log(`📺 Max videos per playlist: ${maxVideosPerPlaylist}`);
    console.log(`📋 Max playlists per channel: ${maxPlaylistsPerChannel}`);
    console.log(`📺 Max channels per category: ${maxChannelsPerCategory}\n`);

    for (const category of categoriesToProcess) {
      if (!channelsData[category]) {
        console.log(`⚠️  Category "${category}" not found in channels.json`);
        continue;
      }

      console.log(`\n📂 Processing category: ${category}`);
      const categoryChannels = channelsData[category].slice(0, maxChannelsPerCategory);
      
      for (let channelIndex = 0; channelIndex < categoryChannels.length; channelIndex++) {
        const channel = categoryChannels[channelIndex];
        console.log(`\n📺 Channel ${channelIndex + 1}/${categoryChannels.length}: ${channel.name}`);
        console.log(`🔗 ${channel.url}`);
        console.log(`📋 Available playlists: ${channel.playlists.length}`);

        if (channel.playlists.length === 0) {
          console.log(`⚠️  No playlists found for ${channel.name}, skipping...`);
          continue;
        }

        // Process playlists from this channel
        const playlistsToProcess = channel.playlists.slice(0, maxPlaylistsPerChannel);
        
        for (let playlistIndex = 0; playlistIndex < playlistsToProcess.length; playlistIndex++) {
          const playlist = playlistsToProcess[playlistIndex];
          
          console.log(`\n📋 Playlist ${playlistIndex + 1}/${playlistsToProcess.length}: ${playlist.title}`);
          console.log(`🔗 ${playlist.url}`);
          console.log(`📊 Videos available: ${playlist.videoCount}`);
          
          try {
            // Import and use the downloader from your existing script
            const { YouTubeDownloader } = require('./index'); // Assuming main script is index.js
            const videoDownloader = new YouTubeDownloader();
            await videoDownloader.initialize();
            
            // Generate custom prefix for organized file naming
            const categoryPrefix = category.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 15);
            const channelPrefix = channel.name.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 20);
            const playlistPrefix = playlist.title.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 25);
            
            const paddedChannelIndex = String(channelIndex + 1).padStart(2, '0');
            const paddedPlaylistIndex = String(playlistIndex + 1).padStart(2, '0');
            
            // Check if this is a "Latest Videos" pseudo-playlist
            if (playlist.isLatestVideos) {
              console.log(`🎬 Processing latest videos from channel...`);
              
              // For latest videos, we'll download directly from channel
              const channelVideos = await this.getChannelVideos(channel.url, maxVideosPerPlaylist);
              
              if (channelVideos.length === 0) {
                console.log(`⚠️  No videos found in channel: ${channel.name}`);
                continue;
              }

              console.log(`🎬 Found ${channelVideos.length} latest videos, downloading HD versions...`);

              // Download each video
              for (let videoIndex = 0; videoIndex < channelVideos.length; videoIndex++) {
                const video = channelVideos[videoIndex];
                const paddedVideoIndex = String(videoIndex + 1).padStart(3, '0');
                
                const customFilename = `${categoryPrefix}_Ch${paddedChannelIndex}_Latest_${paddedVideoIndex}`;
                
                console.log(`\n🎬 Video ${videoIndex + 1}/${channelVideos.length}: ${video.title.substring(0, 50)}...`);
                
                const success = await videoDownloader.downloadSingleVideo(video.url, customFilename);
                
                if (success) {
                  totalSuccessful++;
                } else {
                  totalSkipped++;
                }

                // Delay between videos
                if (videoIndex < channelVideos.length - 1) {
                  console.log(`⏳ Waiting ${delayBetweenVideos/1000}s before next video...`);
                  await new Promise(resolve => setTimeout(resolve, delayBetweenVideos));
                }
              }
              
            } else {
              // Regular playlist download
              const result = await videoDownloader.downloadPlaylist(playlist.url, {
                maxVideos: maxVideosPerPlaylist,
                startIndex: 0,
                delayBetweenDownloads: delayBetweenVideos,
                skipLowQuality: true,
                customPrefix: `${categoryPrefix}_Ch${paddedChannelIndex}_Pl${paddedPlaylistIndex}_${playlistPrefix}`
              });
              
              totalSuccessful += result.successful;
              totalFailed += result.failed;
              totalSkipped += result.skipped;
              
              console.log(`📊 Playlist "${playlist.title}" results:`);
              console.log(`   ✅ Downloaded: ${result.successful}`);
              console.log(`   ⏭️  Skipped: ${result.skipped}`);
              console.log(`   ❌ Failed: ${result.failed}`);
            }

          } catch (error) {
            console.error(`❌ Error downloading playlist "${playlist.title}": ${error.message}`);
            totalFailed++;
          }

          // Delay between playlists
          if (playlistIndex < playlistsToProcess.length - 1) {
            console.log(`\n⏸️  Waiting ${delayBetweenPlaylists/1000}s before next playlist...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenPlaylists));
          }
        }

        // Delay between channels
        if (channelIndex < categoryChannels.length - 1) {
          console.log(`\n⏸️  Waiting 20s before next channel...`);
          await new Promise(resolve => setTimeout(resolve, 20000));
        }
      }
      
      // Delay between categories
      if (categoriesToProcess.indexOf(category) < categoriesToProcess.length - 1) {
        console.log(`\n⏸️  Waiting 30s before next category...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    console.log(`\n🎉 Download completed!`);
    console.log(`📊 Final Results:
✅ Successful HD downloads: ${totalSuccessful}
⏭️  Skipped (no HD): ${totalSkipped}
❌ Failed: ${totalFailed}
`);

    return { successful: totalSuccessful, failed: totalFailed, skipped: totalSkipped };
  }

  displayChannels() {
    const channelsData = this.loadChannels();
    if (!channelsData) return;

    console.log('\n📺 Available Channels and Playlists by Category:\n');
    
    Object.entries(channelsData).forEach(([category, channelList]) => {
      const totalPlaylists = channelList.reduce((sum, channel) => sum + channel.playlists.length, 0);
      console.log(`📂 ${category.toUpperCase()} (${channelList.length} channels, ${totalPlaylists} playlists):`);
      
      channelList.forEach((channel, index) => {
        console.log(`\n   ${index + 1}. ${channel.name} (${channel.playlists.length} playlists)`);
        console.log(`      🔗 ${channel.url}`);
        console.log(`      🆔 ${channel.channelId || 'Unknown'}`);
        
        if (channel.playlists.length > 0) {
          console.log(`      📋 Playlists:`);
          channel.playlists.forEach((playlist, pIndex) => {
            const verifiedIndicator = playlist.verified ? '✅' : '❓';
            const typeIndicator = playlist.isLatestVideos ? ' [Latest]' : ' [Playlist]';
            console.log(`         ${pIndex + 1}. ${verifiedIndicator} ${playlist.title}${typeIndicator} (${playlist.videoCount} videos)`);
            console.log(`            🔗 ${playlist.url}`);
          });
        } else {
          console.log(`      ⚠️  No playlists found`);
        }
      });
      console.log('');
    });
  }

  // New method to re-scan channels for more playlists
  async rescanChannelPlaylists(categoryName = null) {
    const channelsData = this.loadChannels();
    if (!channelsData) return false;

    const categoriesToRescan = categoryName ? [categoryName] : Object.keys(channelsData);
    let totalNewPlaylists = 0;

    console.log(`🔄 Rescanning channels for playlists...`);
    
    for (const category of categoriesToRescan) {
      if (!channelsData[category]) continue;
      
      console.log(`\n📂 Rescanning category: ${category}`);
      
      for (let i = 0; i < channelsData[category].length; i++) {
        const channel = channelsData[category][i];
        console.log(`\n📺 Rescanning ${i + 1}/${channelsData[category].length}: ${channel.name}`);
        
        const currentPlaylistCount = channel.playlists.length;
        console.log(`📋 Current playlists: ${currentPlaylistCount}`);
        
        // Get fresh playlist data
        const newPlaylists = await this.getChannelPlaylists(channel.url, channel.name);
        
        // Validate and enrich the new playlists
        const validatedPlaylists = await this.validateAndEnrichPlaylists(newPlaylists, channel.name);
        
        // Update channel data
        channelsData[category][i].playlists = validatedPlaylists;
        
        const newPlaylistCount = validatedPlaylists.length;
        const addedPlaylists = Math.max(0, newPlaylistCount - currentPlaylistCount);
        totalNewPlaylists += addedPlaylists;
        
        console.log(`📊 Updated: ${newPlaylistCount} playlists (${addedPlaylists > 0 ? '+' + addedPlaylists : '0'} new)`);
        
        // Delay between channels
        if (i < channelsData[category].length - 1) {
          console.log('⏳ Waiting 10s before next channel...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }
    }

    // Save the updated data
    const saved = await this.saveChannels(channelsData);
    
    if (saved) {
      console.log(`\n✅ Rescan completed! Found ${totalNewPlaylists} additional playlists`);
      return true;
    } else {
      console.log(`\n❌ Failed to save rescanned data`);
      return false;
    }
  }
}

// Command functions for package.json scripts
async function searchChannelsCommand() {
  const manager = new YouTubeChannelManager();
  
  const initialized = await manager.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize channel manager');
    process.exit(1);
  }

  // Your search queries
  const searchQueries = [
    // Broadcast News
    'Aaj Tak',
    'Zee News',
    'ABP News',
    'Republic Bharat',
    'TV9 Bharatvarsh',
    'Times Now Navbharat',
    'NDTV India',
    'DD News',
    
    // Podcasts & Audio-Style Playlists in Hindi
    'Hindi Food Podcast',
    'Hindi Podcasts',
    'Bingepods Indian Podcasts',
    'Figuring Out With Raj Shamani',
    'The Ranveer Show Hindi',
    'ANI Podcast with Smita Prakash',
    'Gyan Adhyatmik Katha',
    'Puliyabaazi Hindi Podcast',
    'The Madhushala Podcast',
    'Naatak Radio',
    'हिन्दी प्रसारण',
    'Stories From the Quran by Meera\'n Malik',
    'Hindi Story Basket'
  ];

  console.log('🔍 Starting channel search...');
  console.log(`📋 Processing ${searchQueries.length} search queries\n`);

  const channels = await manager.searchChannels(searchQueries);
  const saved = await manager.saveChannels(channels);
  
  if (saved) {
    console.log('\n✅ Channel search completed successfully!');
    console.log('💡 Use "npm run list-channels" to view saved channels');
    console.log('💡 Use "npm run rescan-playlists" to find more playlists');
    console.log('💡 Use "npm run download-from-channels" to start downloading');
  } else {
    console.log('\n❌ Failed to save channels');
    process.exit(1);
  }
}

async function listChannelsCommand() {
  const manager = new YouTubeChannelManager();
  manager.displayChannels();
}

async function rescanPlaylistsCommand() {
  const manager = new YouTubeChannelManager();
  
  const initialized = await manager.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize channel manager');
    process.exit(1);
  }

  // Get command line arguments
  const args = process.argv.slice(2);
  let categoryName = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) {
      categoryName = args[i + 1];
      break;
    }
  }

  console.log('🔄 Starting playlist rescan...');
  if (categoryName) {
    console.log(`🎯 Rescanning category: ${categoryName}`);
  } else {
    console.log('🎯 Rescanning ALL categories');
  }

  const success = await manager.rescanChannelPlaylists(categoryName);
  
  if (success) {
    console.log('\n✅ Playlist rescan completed!');
    console.log('💡 Use "npm run list-channels" to view updated channels');
  } else {
    console.log('\n❌ Playlist rescan failed');
    process.exit(1);
  }
}

async function downloadFromChannelsCommand() {
  const manager = new YouTubeChannelManager();
  
  const initialized = await manager.initialize();
  if (!initialized) {
    console.error('❌ Could not initialize channel manager');
    process.exit(1);
  }

  // Get command line arguments
  const args = process.argv.slice(2);
  const options = {};

  // Parse command line options
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--categories':
        options.categories = args[i + 1] ? args[i + 1].split(',').map(c => c.trim()) : [];
        i++;
        break;
      case '--max-playlists':
        options.maxPlaylistsPerChannel = parseInt(args[i + 1]) || 5;
        i++;
        break;
      case '--max-videos':
        options.maxVideosPerPlaylist = parseInt(args[i + 1]) || 10;
        i++;
        break;
      case '--max-channels':
        options.maxChannelsPerCategory = parseInt(args[i + 1]) || 3;
        i++;
        break;
      case '--help':
        console.log(`
📖 Download from Channels Help:

Usage: npm run download-from-channels [options]

Options:
  --categories <list>       Comma-separated list of categories to download from
                           Example: --categories "Aaj Tak,Zee News"
  --max-videos <number>     Maximum videos per playlist (default: 10)
  --max-playlists <number>  Maximum playlists per channel (default: 5)
  --max-channels <number>   Maximum channels per category (default: 3)
  --help                    Show this help message

Examples:
  npm run download-from-channels
  npm run download-from-channels -- --categories "Aaj Tak,Zee News" --max-videos 5
  npm run download-from-channels -- --max-channels 2 --max-playlists 3 --max-videos 15

Additional Commands:
  npm run rescan-playlists                    Rescan all channels for more playlists
  npm run rescan-playlists -- --category "Aaj Tak"  Rescan specific category
        `);
        process.exit(0);
    }
  }

  console.log('🎬 Starting download from saved channels...');
  
  if (options.categories && options.categories.length > 0) {
    console.log(`🎯 Target categories: ${options.categories.join(', ')}`);
  } else {
    console.log('🎯 Will download from ALL categories');
  }

  const result = await manager.downloadFromChannels(options);
  
  console.log('\n🏁 Download process completed!');
  console.log(`📊 Summary: ${result.successful} successful, ${result.skipped} skipped, ${result.failed} failed`);
}

// Export functions and class
module.exports = {
  YouTubeChannelManager,
  searchChannelsCommand,
  listChannelsCommand,
  downloadFromChannelsCommand,
  rescanPlaylistsCommand
};

// CLI handling
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'search':
      searchChannelsCommand().catch(console.error);
      break;
    case 'list':
      listChannelsCommand();
      break;
    case 'download':
      downloadFromChannelsCommand().catch(console.error);
      break;
    case 'rescan':
      rescanPlaylistsCommand().catch(console.error);
      break;
    default:
      console.log(`
🎬 YouTube Channel Manager

Available commands:
  node channel-manager.js search    - Search for channels and save to channels.json
  node channel-manager.js list      - Display saved channels
  node channel-manager.js download  - Download videos from saved channels
  node channel-manager.js rescan    - Rescan channels for more playlists

Or use npm scripts:
  npm run search-channels
  npm run list-channels  
  npm run download-from-channels
  npm run rescan-playlists [-- --category "CategoryName"]
      `);
  }
}