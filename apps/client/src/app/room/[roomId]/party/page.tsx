import { NewSyncer } from "@/components/NewSyncer";
import { validateFullRoomId } from "@/lib/room";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Beatsync's original listening-party dashboard for the same room
export default async function PartyPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!validateFullRoomId(roomId)) redirect(`/room/${roomId}`);
  return <NewSyncer roomId={roomId} view="party" />;
}
