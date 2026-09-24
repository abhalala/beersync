import { ADMIN_SECRET, IS_DEMO_MODE } from "@/demo";
import { BackupManager } from "@/managers/BackupManager";
import { getStorage } from "@/storage";
import { getActiveRooms } from "@/routes/active";
import { handleGetDefaultAudio } from "@/routes/default";
import { handleServeAudio } from "@/routes/demoAudio";
import { handleDiscover } from "@/routes/discover";
import { handleHealth } from "@/routes/health";
import { handleLibraryBrowse, handleLibrarySearch, handleLibrarySources } from "@/routes/library";
import { MEDIA_PREFIX, MEDIA_UPLOAD_PREFIX, handleMedia, handleMediaUpload } from "@/routes/media";
import { handleRoot } from "@/routes/root";
import { handleStats } from "@/routes/stats";
import { handleGetPresignedURL, handleUploadComplete } from "@/routes/upload";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleClose, handleMessage, handleOpen } from "@/routes/websocketHandlers";
import { LOCAL_UPLOAD_MAX_BYTES } from "@/storage/local";
import { corsHeaders, errorResponse } from "@/utils/responses";
import type { WSData } from "@/utils/websocket";

// Bun.serve with WebSocket support
const server = Bun.serve<WSData>({
  hostname: "0.0.0.0",
  port: 8080,
  // Local-storage uploads (PUT /media-upload) accept up to 200 MB; Bun's default cap is 128 MB
  maxRequestBodySize: LOCAL_UPLOAD_MAX_BYTES + 1024 * 1024,
  async fetch(req, server) {
    const start = performance.now();
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    let response: Response;

    try {
      // Demo mode: serve local audio files
      if (IS_DEMO_MODE && url.pathname.startsWith("/audio/")) {
        response = handleServeAudio(url.pathname);
      } else if (url.pathname.startsWith(MEDIA_PREFIX)) {
        // Local storage mode: serve room media (404 when R2 is in use)
        response = await handleMedia(req, url);
      } else if (url.pathname.startsWith(MEDIA_UPLOAD_PREFIX)) {
        response = IS_DEMO_MODE
          ? errorResponse("Uploads disabled in demo mode", 403)
          : await handleMediaUpload(req, url);
      } else {
        switch (url.pathname) {
          case "/":
            response = handleRoot(req);
            break;

          case "/ws":
            return handleWebSocketUpgrade(req, server);

          case "/upload/get-presigned-url":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleGetPresignedURL(req);
            }
            break;

          case "/upload/complete":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleUploadComplete(req, server);
            }
            break;

          case "/stats":
            response = await handleStats();
            break;

          case "/default":
            response = await handleGetDefaultAudio(req);
            break;

          case "/active-rooms":
            response = getActiveRooms(req);
            break;

          case "/discover":
            response = handleDiscover(req);
            break;

          case "/library/sources":
            response = IS_DEMO_MODE ? errorResponse("Library disabled in demo mode", 403) : handleLibrarySources(req);
            break;

          case "/library/search":
            response = IS_DEMO_MODE
              ? errorResponse("Library disabled in demo mode", 403)
              : await handleLibrarySearch(req, url);
            break;

          case "/library/browse":
            response = IS_DEMO_MODE
              ? errorResponse("Library disabled in demo mode", 403)
              : await handleLibraryBrowse(req, url);
            break;

          case "/health":
            response = handleHealth();
            break;

          default:
            response = errorResponse("Not found", 404);
            break;
        }
      }
    } catch (error) {
      const durationMs = (performance.now() - start).toFixed(1);
      console.error(
        `[${new Date().toISOString()}] ${req.method} ${url.pathname} 500 ${durationMs}ms - Unhandled error:`,
        error
      );
      return errorResponse("Internal server error", 500);
    }

    const durationMs = (performance.now() - start).toFixed(1);
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} ${response.status} ${durationMs}ms`);

    return response;
  },

  websocket: {
    open(ws) {
      handleOpen(ws, server);
    },

    message(ws, message) {
      void handleMessage(ws, message, server);
    },

    close(ws) {
      handleClose(ws, server);
    },
  },
});

console.log(`HTTP listening on http://${server.hostname}:${server.port}`);

if (IS_DEMO_MODE) {
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
}

// State backups live in R2; with local media storage (dev without R2) there is nowhere to back up to
const BACKUPS_ENABLED = !IS_DEMO_MODE && getStorage().kind === "r2";

if (BACKUPS_ENABLED) {
  // Restore state from backup on startup
  BackupManager.restoreState().catch((error) => {
    console.error("Failed to restore state on startup:", error);
  });

  // Set up periodic backups every minute (for Render persistence issues)
  const BACKUP_INTERVAL_MS = 60 * 1000; // 1 minute
  setInterval(() => {
    console.log("🔄 Performing periodic backup at", new Date().toISOString());
    BackupManager.backupState().catch((error) => {
      console.error("Failed to perform periodic backup:", error);
    });
  }, BACKUP_INTERVAL_MS);
}

// Simple graceful shutdown
const shutdown = async () => {
  console.log("\n⚠️ Shutting down...");

  void server.stop(); // Stop accepting new connections
  if (BACKUPS_ENABLED) {
    await BackupManager.backupState(); // Save state
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Crash handlers — log the error before PM2 restarts the process
process.on("uncaughtException", (error) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION — process will exit:`, error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION:`, reason);
});
