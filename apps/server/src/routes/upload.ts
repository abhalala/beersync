import type { UploadCompleteResponseType, UploadUrlResponseType } from "@beatsync/shared";
import { GetUploadUrlSchema, UploadCompleteSchema } from "@beatsync/shared";
import type { BunServer } from "@/utils/websocket";
import { createKey, generateAudioFileName } from "@/lib/r2";
import { globalManager } from "@/managers";
import { getStorage } from "@/storage";
import { toStorageFileName } from "@/storage/keys";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";

// New endpoint to get presigned upload URL
export const handleGetPresignedURL = async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body: unknown = await req.json();
    const parseResult = GetUploadUrlSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, fileName, contentType } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. Please join the room before uploading files.", 404);
    }

    // Generate unique filename
    const uniqueFileName = toStorageFileName(generateAudioFileName(fileName));
    const key = createKey(roomId, uniqueFileName);

    // R2: presigned PUT URL. Local storage (no R2 config): signed PUT /media-upload/<key> on this server.
    const storage = getStorage();
    const { uploadUrl, publicUrl } = await storage.createUploadTarget(key, contentType);

    console.log(`Generated ${storage.kind} upload URL - key: (${key})`);

    const response: UploadUrlResponseType = {
      uploadUrl,
      publicUrl,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("Error generating upload URL:", error);
    return errorResponse("Failed to generate upload URL", 500);
  }
};

// Endpoint to confirm successful upload and broadcast to room
export const handleUploadComplete = async (req: Request, server: BunServer) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const body: unknown = await req.json();
    const parseResult = UploadCompleteSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse(`Invalid request data: ${parseResult.error.message}`, 400);
    }

    const { roomId, publicUrl } = parseResult.data;

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. The room may have been closed during upload.", 404);
    }

    const sources = room.addAudioSource({ url: publicUrl });

    console.log(`✅ Audio upload completed - broadcasting to room ${roomId} new sources: ${JSON.stringify(sources)}`);

    // Broadcast to room that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    const response: UploadCompleteResponseType = { success: true };
    return jsonResponse(response);
  } catch (error) {
    console.error("Error confirming upload:", error);
    return errorResponse("Failed to confirm upload", 500);
  }
};
