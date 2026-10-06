# ChatGPT Enter Key Control (by marusin)

A Chrome extension that prevents accidental message sending in ChatGPT.

## Features

- Press Enter to insert a newline  
- Press Shift + Enter to send your message  
- On Mac, Cmd + Enter and Shift + Cmd + Enter can also be selected as send shortcuts
- Reduce Japanese input issues after pasting multiline text into ChatGPT in some environments

## Benefits

- Write longer prompts without accidental sending  
- Improve typing comfort and control  
- Reduce mistakes when editing messages  

## Privacy

- No data collection  
- No external communication  
- Works only on ChatGPT  

## Installation

1. Download from Chrome Web Store  
2. Enable the extension  
3. Start using ChatGPT with improved input behavior  

## Changelog

### 1.3.1
- Updated configured send shortcuts to use the verified send button in the new ChatGPT composer
- Updated ChatGPT composer detection for compatibility with the latest ChatGPT Web UI
- Maintained compatibility with the previous composer structure

### 1.3.0
- Reduce Japanese input issues after pasting multiline plain text into an empty ChatGPT input field

### 1.2.0
- Added Mac send shortcut support for Cmd+Enter and Shift+Cmd+Enter
- Added extra IME composition safeguards for Enter handling

### 1.1.6
- Added Spanish localization
- Added Brazilian Portuguese localization
- Added Traditional Chinese localization

### 1.1.5
- Updated popup description text
- Updated localized app descriptions

### 1.1.4
- Added collapsible secondary settings in popup
- Moved language/version/other extensions link into secondary area

### 1.1.3
- UI improvements

### 1.1.2
- Minor UI text adjustment

### 1.1.1
- Added multilingual support (Japanese, Chinese, Korean)

## Developer

Developed by Marushin

## Development tests

Unit tests: `npm test`. Browser integration tests: `npm run test:browser`.
Run both with `npm run test:all`. See [Playwright Mock DOM tests](tests/playwright/README.md) for setup, fixtures, and coverage limits.
