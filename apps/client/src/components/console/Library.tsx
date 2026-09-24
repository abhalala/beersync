"use client";
import { uploadAudioFile } from "@/lib/api";
import { browseLibrary, fetchLibrarySources, searchLibrary } from "@/lib/library";
import { cn, extractFileNameFromUrl, formatTime, trimFileName } from "@/lib/utils";
import { useDjStore } from "@/store/dj";
import { useGlobalStore } from "@/store/global";
import { useRoomStore } from "@/store/room";
import type { DeckId, LibraryTrack } from "@beatsync/shared";
import { camelotToKeyName, isHarmonicMatch } from "@beatsync/shared";
import { useQuery } from "@tanstack/react-query";
import { Disc3, Globe, Loader2, Search, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type View = { kind: "collection" } | { kind: "source"; sourceId: string; genre?: string };

interface Row {
  id: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  bpm?: number;
  key?: string;
  durationSec?: number;
  genre?: string;
  /** Room collection URL, when the track is already in the room */
  url?: string;
  libraryTrack?: LibraryTrack;
}

const displayTitle = (url: string, title?: string) => title ?? trimFileName(extractFileNameFromUrl(url));

/** The key harmonic suggestions are relative to: the master deck's track, else any loaded deck */
const useReferenceKey = (): string | undefined => {
  const masterDeck = useDjStore((s) => s.mixer.masterDeck);
  const decks = useDjStore((s) => s.decks);
  const audioSources = useGlobalStore((s) => s.audioSources);
  const tracks = useDjStore((s) => s.tracks);
  const order: DeckId[] = masterDeck ? [masterDeck, masterDeck === "A" ? "B" : "A"] : ["A", "B"];
  for (const id of order) {
    const url = decks[id].trackUrl;
    if (!url) continue;
    const key = audioSources.find((s) => s.source.url === url)?.source.meta?.key ?? tracks[url]?.analysis?.key;
    if (key) return key;
  }
  return undefined;
};

export const Library = ({ className }: { className?: string }) => {
  const [view, setView] = useState<View>({ kind: "collection" });
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const audioSources = useGlobalStore((s) => s.audioSources);
  const activeImports = useGlobalStore((s) => s.activeStreamJobs);
  const tracks = useDjStore((s) => s.tracks);
  const decks = useDjStore((s) => s.decks);
  const sendDeckCommand = useDjStore((s) => s.sendDeckCommand);
  const importTrack = useDjStore((s) => s.importTrack);
  const referenceKey = useReferenceKey();

  const sources = useQuery({ queryKey: ["library-sources"], queryFn: fetchLibrarySources, staleTime: 5 * 60_000 });
  const activeSource = view.kind === "source" ? sources.data?.find((s) => s.id === view.sourceId) : undefined;

  const remote = useQuery({
    queryKey: ["library", view, submittedQuery],
    enabled: view.kind === "source",
    queryFn: async () => {
      if (view.kind !== "source") return { items: [], nextOffset: null };
      if (submittedQuery) return searchLibrary({ source: view.sourceId, query: submittedQuery });
      if (activeSource?.capabilities.browse) return browseLibrary({ source: view.sourceId, genre: view.genre });
      return { items: [], nextOffset: null };
    },
  });

  const collectionRows: Row[] = audioSources
    .map(({ source }) => {
      const analysis = tracks[source.url]?.analysis;
      return {
        id: source.url,
        url: source.url,
        title: displayTitle(source.url, source.meta?.title),
        artist: source.meta?.artist,
        artworkUrl: source.meta?.artworkUrl,
        bpm: source.meta?.bpm ?? analysis?.bpm,
        key: source.meta?.key ?? analysis?.key,
        durationSec: source.meta?.durationSec ?? analysis?.durationSec,
        genre: source.meta?.genre,
      };
    })
    .filter((row) => {
      if (view.kind !== "collection" || !submittedQuery) return true;
      const q = submittedQuery.toLowerCase();
      return row.title.toLowerCase().includes(q) || row.artist?.toLowerCase().includes(q);
    });

  const inCollection = (track: LibraryTrack) =>
    audioSources.find(
      (s) => s.source.meta?.sourceId === track.sourceId && s.source.meta?.sourceTrackId === track.trackId
    )?.source.url;

  const remoteRows: Row[] = (remote.data?.items ?? []).map((track) => ({
    id: `${track.sourceId}:${track.trackId}`,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl,
    bpm: track.bpm,
    key: track.key,
    durationSec: track.durationSec,
    genre: track.genre,
    url: inCollection(track),
    libraryTrack: track,
  }));

  const rows = view.kind === "collection" ? collectionRows : remoteRows;

  const loadTo = (row: Row, deckId: DeckId) => {
    if (decks[deckId].status === "playing") {
      toast.error(`Deck ${deckId} is playing. Pause it before loading.`);
      return;
    }
    if (row.url) sendDeckCommand(deckId, { type: "LOAD", trackUrl: row.url });
    else if (row.libraryTrack) {
      importTrack(row.libraryTrack, deckId);
      toast(`Importing "${row.title}" to deck ${deckId}…`);
    }
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  };

  const selectView = (next: View) => {
    setView(next);
    setQuery("");
    setSubmittedQuery("");
  };

  return (
    <div className={cn("neu-library flex min-h-0 gap-3", className)}>
      {/* Sources rail */}
      <nav className="hidden md:flex w-48 shrink-0 flex-col gap-1 overflow-y-auto pr-1" aria-label="Library sources">
        <RailItem active={view.kind === "collection"} onClick={() => selectView({ kind: "collection" })}>
          <Disc3 className="size-4" /> Room collection
          <span className="ml-auto text-[11px] tabular-nums opacity-60">{audioSources.length}</span>
        </RailItem>
        <div className="mt-3 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--neu-muted)]">
          Sources
        </div>
        {sources.isLoading && <div className="px-2 text-xs text-[var(--neu-muted)]">Loading sources…</div>}
        {sources.error && <div className="px-2 text-xs text-[var(--neu-crit)]">Library unavailable</div>}
        {sources.data?.map((source) => (
          <div key={source.id} className="flex flex-col">
            <RailItem
              active={view.kind === "source" && view.sourceId === source.id && !view.genre}
              onClick={() => selectView({ kind: "source", sourceId: source.id })}
            >
              <Globe className="size-4" /> {source.name}
            </RailItem>
            {view.kind === "source" && view.sourceId === source.id && source.genres.length > 0 && (
              <div className="ml-6 flex flex-col">
                {source.genres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => selectView({ kind: "source", sourceId: source.id, genre })}
                    className={cn(
                      "rounded-md px-2 py-1 text-left text-xs text-[var(--neu-muted)] hover:text-[var(--neu-text)]",
                      view.genre === genre && "text-[var(--deck-a)]"
                    )}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="neu-input md:hidden"
            aria-label="Library source"
            value={view.kind === "collection" ? "collection" : view.sourceId}
            onChange={(e) =>
              selectView(
                e.target.value === "collection" ? { kind: "collection" } : { kind: "source", sourceId: e.target.value }
              )
            }
          >
            <option value="collection">Room collection</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
            <label className="neu-input flex min-w-0 flex-1 items-center gap-2">
              <Search className="size-4 shrink-0 text-[var(--neu-muted)]" />
              <input
                id="library-search"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--neu-muted)]"
                placeholder={
                  view.kind === "collection"
                    ? "Filter the room collection"
                    : view.sourceId === "url"
                      ? "Paste a link to an audio file"
                      : `Search ${activeSource?.name ?? ""}`
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </form>
          {view.kind === "collection" && <UploadButton />}
          {activeImports > 0 && (
            <span className="flex items-center gap-1 text-xs text-[var(--neu-muted)]">
              <Loader2 className="size-3 animate-spin" /> Importing {activeImports}
            </span>
          )}
        </div>
        {view.kind === "source" && activeSource && (
          <p className="text-xs text-[var(--neu-muted)]">
            {view.genre
              ? `Trending in ${view.genre}`
              : submittedQuery
                ? `Results for "${submittedQuery}"`
                : activeSource.description}
          </p>
        )}

        {/* Track table */}
        <div className="neu-well min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--neu-bg-2)] text-[10px] uppercase tracking-[0.14em] text-[var(--neu-muted)]">
              <tr>
                <th className="w-10 px-2 py-2" />
                <th className="px-2 py-2 text-left font-semibold">Title</th>
                <th className="px-2 py-2 text-left font-semibold">Artist</th>
                <th className="px-2 py-2 text-right font-semibold">BPM</th>
                <th className="px-2 py-2 text-left font-semibold">Key</th>
                <th className="px-2 py-2 text-right font-semibold">Time</th>
                <th className="px-2 py-2 text-right font-semibold">Load</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const harmonic = isHarmonicMatch(row.key, referenceKey);
                const onDeck = (["A", "B"] as const).filter((id) => row.url && decks[id].trackUrl === row.url);
                return (
                  <tr key={row.id} className="border-t border-[var(--neu-line)] hover:bg-white/[0.03]">
                    <td className="px-2 py-1.5">
                      {row.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.artworkUrl} alt="" className="size-8 rounded-md object-cover" loading="lazy" />
                      ) : (
                        <div className="grid size-8 place-items-center rounded-md bg-[var(--neu-bg-2)]">
                          <Disc3 className="size-4 text-[var(--neu-muted)]" />
                        </div>
                      )}
                    </td>
                    <td className="max-w-[18rem] truncate px-2 py-1.5 font-medium" title={row.title}>
                      {row.title}
                      {onDeck.map((id) => (
                        <span
                          key={id}
                          className="ml-2 rounded px-1 text-[10px] font-bold"
                          style={{ color: id === "A" ? "var(--deck-a)" : "var(--deck-b)" }}
                        >
                          {id}
                        </span>
                      ))}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1.5 text-[var(--neu-muted)]">{row.artist ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {row.bpm ? row.bpm.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {row.key ? (
                        <span
                          title={camelotToKeyName(row.key) ?? undefined}
                          className={cn(harmonic && "text-[var(--neu-ok)]")}
                        >
                          {row.key}
                          {harmonic && <span className="sr-only"> (harmonic match)</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--neu-muted)]">
                      {row.durationSec ? formatTime(row.durationSec) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <LoadButton deckId="A" onClick={() => loadTo(row, "A")} label={`Load ${row.title} to deck A`} />
                      <LoadButton deckId="B" onClick={() => loadTo(row, "B")} label={`Load ${row.title} to deck B`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-6 text-center text-sm text-[var(--neu-muted)]">
              {view.kind === "collection"
                ? "No tracks in this room yet. Upload files or pick a source on the left to import music."
                : remote.isLoading
                  ? "Loading…"
                  : remote.error
                    ? `Couldn't reach ${activeSource?.name ?? "this source"}: ${(remote.error as Error).message}`
                    : activeSource?.capabilities.browse
                      ? "Nothing here yet."
                      : "Search to find tracks."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RailItem = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? "page" : undefined}
    className={cn(
      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--neu-muted)] hover:text-[var(--neu-text)]",
      active && "neu-inset-sm text-[var(--neu-text)]"
    )}
  >
    {children}
  </button>
);

const LoadButton = ({ deckId, onClick, label }: { deckId: DeckId; onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="neu-chip ml-1 font-mono text-[11px] font-bold"
    style={{ color: deckId === "A" ? "var(--deck-a)" : "var(--deck-b)" }}
  >
    {deckId}
  </button>
);

const UploadButton = () => {
  const roomId = useRoomStore((s) => s.roomId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setUploading((n) => n + list.length);
    await Promise.all(
      list.map(async (file) => {
        try {
          await uploadAudioFile({ file, roomId });
        } catch (error) {
          toast.error(`Upload failed for ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          setUploading((n) => n - 1);
        }
      })
    );
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <button
        type="button"
        className="neu-chip flex items-center gap-1.5 text-xs"
        onClick={() => inputRef.current?.click()}
      >
        {uploading > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {uploading > 0 ? `Uploading ${uploading}` : "Upload"}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/aac,audio/ogg,audio/webm,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.webm,.flac"
        onChange={(e) => void onFiles(e.target.files)}
      />
    </>
  );
};
