#!/bin/bash

# Quick Google Font installer
# Usage: ./add-google-font.sh "Font+Name"

if [ $# -eq 0 ]; then
    echo "Usage: $0 'Font+Name'"
    echo "Example: $0 'Roboto'"
    echo "Example: $0 'Open+Sans'"
    exit 1
fi

FONT_NAME="$1"
TEMP_DIR=$(mktemp -d)

echo "📥 Downloading $FONT_NAME from Google Fonts..."

# Download the font
curl -L -o "$TEMP_DIR/font.zip" "https://fonts.google.com/download?family=$FONT_NAME"

# Extract
cd "$TEMP_DIR"
unzip -q font.zip

# Install fonts
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "🍎 Installing fonts to macOS system..."
    sudo cp *.ttf /Library/Fonts/ 2>/dev/null || echo "No TTF files found"
    sudo cp *.otf /Library/Fonts/ 2>/dev/null || echo "No OTF files found"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    echo "🐧 Installing fonts to Linux system..."
    sudo mkdir -p /usr/local/share/fonts/
    sudo cp *.ttf /usr/local/share/fonts/ 2>/dev/null || echo "No TTF files found"
    sudo cp *.otf /usr/local/share/fonts/ 2>/dev/null || echo "No OTF files found"
    fc-cache -fv
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo "✅ Font $FONT_NAME installed successfully!"
echo "🔍 Verify with: fc-list | grep -i $(echo $FONT_NAME | tr '+' ' ')" 