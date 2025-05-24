## 🚀 Harbor ElizaOS Frontend Demo

This project is a frontend demonstration of the Harbor plugin based on ElizaOS. It showcases how the Harbor plugin enables secure storage and sharing of AI agent memories and files using blockchain technology.

### Demo Video

[![Harbor Plugin Demo](https://img.youtube.com/vi/rEF4pNcIYwM/0.jpg)](https://youtu.be/rEF4pNcIYwM)

Click the image above to watch the demo video of the Harbor plugin in action.

### Key Features

- **ElizaOS Integration**: Forked from ElizaOS with Harbor plugin integration
- **Enhanced File Upload**: Implemented chunked upload for large files
- **AI Memory Sharing**: NFT-based memory encryption and sharing
- **File Sharing**: Support for sharing any file type and size
- **Improved UI/UX**: User-friendly file attachment and command support

### Project Structure

Based on ElizaOS with the following key modifications:

1. **Harbor Plugin Integration**

   - Added `@yhl125/plugin-harbor` to `packages/cli`
   - Registered the plugin in `packages/cli/src/characters/eliza.ts`

2. **File Upload Improvements**

   - Files under 10MB: Processed via `/api/upload` endpoint
   - Files over 10MB: Handled via `/api/upload-chunk` and `/api/complete-upload` endpoints

3. **Chat Interface Enhancements**
   - Modified `packages/client/src/components/room.tsx` and `packages/client/src/components/chat.tsx`
   - Implemented file attachment functionality and message transmission

## 📋 Setup & Installation

### Prerequisites

- [Bun](https://bun.sh/) installed
- [ElizaOS](https://github.com/elizaOS/eliza) base requirements

### Environment Configuration

Copy `.env.example` to create your own `.env`:

```bash
# Copy the example file
cp .env.example .env

# Edit the .env file with your values
nano .env  # or use your preferred editor
```

Then add your specific values to the `.env` file:

```
# Harbor plugin configuration
SUI_PRIVATE_KEY=your_sui_private_key_here # testnet sui and wal is needed
BASE_URL=http://localhost:3000

# API keys
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### Install and Build

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Start the server
bun start
```

### Run with Docker

```bash
# Build Docker image
docker-compose build

# Run Docker container
docker-compose up -d
```

## 🧪 How to Test

Navigate to `localhost:3000` and you should see the ElizaOS interface.

### Example Commands

#### NFT-Based Operations

```
# Upload file and create NFT collection. Use it with attach file
upload file to nft collection "my file" with mint price 0.0001

# Mint an NFT from an existing collection
mint nft from collection 0x8f89

# Download content using an NFT
download with nft 0xa0123

# Upload memory and create NFT collection
upload memory to nft collection "my memory" with mint price 0.1

# Mint an NFT from a memory collection
mint nft from collection 0x8f779

# Download memory using an NFT
download with nft 0xa0165

# List all owned NFTs
show my nfts

# List all created collections
show my collections
```

#### Direct Storage Operations

```
# Upload a file directly. Use it with attach file
upload file

# Upload memory directly
upload memory

# Download a file by blob ID
download file blob abc123 fileName myfile.txt

# Download memory by blob ID
download memory blob abc123
```

## Key Improvements

### 1. Harbor Plugin Integration

Added the Harbor plugin to ElizaOS's `packages/cli` and registered it in the agent configuration:

```typescript
// packages/cli/src/characters/eliza.ts
export const character: Character = {
  // ...
  plugins: [
    // Existing plugins...
    '@yhl125/plugin-harbor',
  ],
  // ...
  system: 'A friendly, helpful ai who always check action requests.',
};
```

### 2. File Upload Enhancement

Improved the file attachment functionality in ElizaOS by implementing file upload APIs and chunked upload for large files:

```typescript
// File upload based on size
const uploadFile = async (file: File) => {
  const CHUNK_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  if (file.size > CHUNK_FILE_SIZE) {
    // Chunked upload logic
    // ...
  } else {
    // Single file upload
    return await uploadSingleFile(file);
  }
};
```

### 3. Message Transmission Enhancement

Enhanced message sending to include file IDs when files are attached:

```typescript
// Include file ID when sending messages with attachments
if (fileData) {
  socketIOManager.sendMessage(input + ' fileId: ' + fileData.fileId, roomId, CHAT_SOURCE);
} else {
  socketIOManager.sendMessage(input, roomId, CHAT_SOURCE);
}
```

## License

MIT License

---

This project is a demonstration of Harbor plugin functionality and supports all base features of ElizaOS. For more detailed information about the Harbor plugin, visit the [Harbor Plugin Repository](https://github.com/harbor-overflow/eliza_plugin).
