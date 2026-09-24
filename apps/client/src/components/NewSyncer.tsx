"use client";
import { generateName } from "@/lib/randomNames";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useRoomStore } from "@/store/room";
import { motion } from "motion/react";
import { useEffect } from "react";
import { IS_DEMO_MODE } from "@/lib/demo";
import { Dashboard } from "./dashboard/Dashboard";
import { DemoDashboard } from "./dashboard/DemoDashboard";
import { Console } from "./console/Console";
import { WebSocketManager } from "./room/WebSocketManager";

interface NewSyncerProps {
  roomId: string;
  /** "console" = Beersync DJ console (default); "party" = Beatsync's listening-party dashboard */
  view?: "console" | "party";
}

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId, view = "console" }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);

  // Update document title based on playback state
  useDocumentTitle();

  // Generate a new random username when the component mounts
  useEffect(() => {
    setRoomId(roomId);
    if (!username) {
      setUsername(generateName());
    }
  }, [setUsername, username, roomId, setRoomId]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {/* WebSocket connection manager (non-visual component) */}
      <WebSocketManager roomId={roomId} username={username} />

      {/* Spatial audio background effects */}
      {/* <SpatialAudioBackground /> */}

      {IS_DEMO_MODE ? (
        <DemoDashboard roomId={roomId} />
      ) : view === "party" ? (
        <Dashboard roomId={roomId} />
      ) : (
        <Console roomId={roomId} />
      )}
    </motion.div>
  );
};
