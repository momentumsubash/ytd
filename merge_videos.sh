#!/bin/bash
echo "Starting video and audio merge process..."
cd "D:\Github\ytd\downloads"

echo "Merging 1/12: 530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News"
if ffmpeg -i "530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_video.mp4" -i "530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_audio.webm" -c:v copy -c:a aac -shortest "530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_merged.mp4"; then
    echo "Successfully merged: 530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_merged.mp4"
    rm "530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_video.mp4"
    rm "530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 530_Breaking News_ 65      _ _ SIR _ Bihar Election _ Suprem Court _ ZEE News"
fi
echo ""

echo "Merging 2/12: 531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News"
if ffmpeg -i "531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_video.mp4" -i "531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_audio.webm" -c:v copy -c:a aac -shortest "531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_merged.mp4"; then
    echo "Successfully merged: 531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_merged.mp4"
    rm "531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_video.mp4"
    rm "531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 531_TOP 10 News _ World News _ Himachal Flood _ Uttrakahand _ Chhattisgarh _ Spain Fire _ Iran _ UP News"
fi
echo ""

echo "Merging 3/12: 532_Himachal News_  24        _   _ Breaking News _ ZEE News"
if ffmpeg -i "532_Himachal News_  24        _   _ Breaking News _ ZEE News_video.mp4" -i "532_Himachal News_  24        _   _ Breaking News _ ZEE News_audio.webm" -c:v copy -c:a aac -shortest "532_Himachal News_  24        _   _ Breaking News _ ZEE News_merged.mp4"; then
    echo "Successfully merged: 532_Himachal News_  24        _   _ Breaking News _ ZEE News_merged.mp4"
    rm "532_Himachal News_  24        _   _ Breaking News _ ZEE News_video.mp4"
    rm "532_Himachal News_  24        _   _ Breaking News _ ZEE News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 532_Himachal News_  24        _   _ Breaking News _ ZEE News"
fi
echo ""

echo "Merging 4/12: 533_Breaking News_      _   _ Spian Fire _ ZEE News"
if ffmpeg -i "533_Breaking News_      _   _ Spian Fire _ ZEE News_video.mp4" -i "533_Breaking News_      _   _ Spian Fire _ ZEE News_audio.webm" -c:v copy -c:a aac -shortest "533_Breaking News_      _   _ Spian Fire _ ZEE News_merged.mp4"; then
    echo "Successfully merged: 533_Breaking News_      _   _ Spian Fire _ ZEE News_merged.mp4"
    rm "533_Breaking News_      _   _ Spian Fire _ ZEE News_video.mp4"
    rm "533_Breaking News_      _   _ Spian Fire _ ZEE News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 533_Breaking News_      _   _ Spian Fire _ ZEE News"
fi
echo ""

echo "Merging 5/12: 534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News"
if ffmpeg -i "534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_video.mp4" -i "534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_audio.webm" -c:v copy -c:a aac -shortest "534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_merged.mp4"; then
    echo "Successfully merged: 534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_merged.mp4"
    rm "534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_video.mp4"
    rm "534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 534_Breaking News _ Mumbai   3  _ IMD      _ ZEE News"
fi
echo ""

echo "Merging 6/12: 535_Breaking News_            Mumbai Building Collapse"
if ffmpeg -i "535_Breaking News_            Mumbai Building Collapse_video.mp4" -i "535_Breaking News_            Mumbai Building Collapse_audio.webm" -c:v copy -c:a aac -shortest "535_Breaking News_            Mumbai Building Collapse_merged.mp4"; then
    echo "Successfully merged: 535_Breaking News_            Mumbai Building Collapse_merged.mp4"
    rm "535_Breaking News_            Mumbai Building Collapse_video.mp4"
    rm "535_Breaking News_            Mumbai Building Collapse_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 535_Breaking News_            Mumbai Building Collapse"
fi
echo ""

echo "Merging 7/12: 536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News"
if ffmpeg -i "536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_video.mp4" -i "536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_audio.webm" -c:v copy -c:a aac -shortest "536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_merged.mp4"; then
    echo "Successfully merged: 536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_merged.mp4"
    rm "536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_video.mp4"
    rm "536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 536_Breaking News_      SIR     Bihar Rahul Gandhi Zee News"
fi
echo ""

echo "Merging 8/12: 537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK"
if ffmpeg -i "537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_video.mp4" -i "537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_audio.webm" -c:v copy -c:a aac -shortest "537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_merged.mp4"; then
    echo "Successfully merged: 537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_merged.mp4"
    rm "537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_video.mp4"
    rm "537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 537_CM Dhami Action Muslim Board_       _  _ _ Breaking News _ UK"
fi
echo ""

echo "Merging 9/12: 538_Vice President Breaking_        _ Vice President Election"
if ffmpeg -i "538_Vice President Breaking_        _ Vice President Election_video.mp4" -i "538_Vice President Breaking_        _ Vice President Election_audio.webm" -c:v copy -c:a aac -shortest "538_Vice President Breaking_        _ Vice President Election_merged.mp4"; then
    echo "Successfully merged: 538_Vice President Breaking_        _ Vice President Election_merged.mp4"
    rm "538_Vice President Breaking_        _ Vice President Election_video.mp4"
    rm "538_Vice President Breaking_        _ Vice President Election_audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 538_Vice President Breaking_        _ Vice President Election"
fi
echo ""

echo "Merging 10/12: 539_New Vice President Candidate Name_          _ _BJP News"
if ffmpeg -i "539_New Vice President Candidate Name_          _ _BJP News_video.mp4" -i "539_New Vice President Candidate Name_          _ _BJP News_audio.m4a" -c:v copy -c:a aac -shortest "539_New Vice President Candidate Name_          _ _BJP News_merged.mp4"; then
    echo "Successfully merged: 539_New Vice President Candidate Name_          _ _BJP News_merged.mp4"
    rm "539_New Vice President Candidate Name_          _ _BJP News_video.mp4"
    rm "539_New Vice President Candidate Name_          _ _BJP News_audio.m4a"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 539_New Vice President Candidate Name_          _ _BJP News"
fi
echo ""

echo "Merging 11/12: 540_Breaking News_     5  _  MP  _"
if ffmpeg -i "540_Breaking News_     5  _  MP  __video.mp4" -i "540_Breaking News_     5  _  MP  __audio.webm" -c:v copy -c:a aac -shortest "540_Breaking News_     5  _  MP  __merged.mp4"; then
    echo "Successfully merged: 540_Breaking News_     5  _  MP  __merged.mp4"
    rm "540_Breaking News_     5  _  MP  __video.mp4"
    rm "540_Breaking News_     5  _  MP  __audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 540_Breaking News_     5  _  MP  _"
fi
echo ""

echo "Merging 12/12: 541_ECI Press Conference_  ..       _  _"
if ffmpeg -i "541_ECI Press Conference_  ..       _  __video.mp4" -i "541_ECI Press Conference_  ..       _  __audio.webm" -c:v copy -c:a aac -shortest "541_ECI Press Conference_  ..       _  __merged.mp4"; then
    echo "Successfully merged: 541_ECI Press Conference_  ..       _  __merged.mp4"
    rm "541_ECI Press Conference_  ..       _  __video.mp4"
    rm "541_ECI Press Conference_  ..       _  __audio.webm"
    echo "Cleaned up temporary files"
else
    echo "Failed to merge: 541_ECI Press Conference_  ..       _  _"
fi
echo ""

echo "All merging operations completed!"
