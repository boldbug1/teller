import React, {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api/client";
import { useAudioPlayer } from "./audio/useAudioPlayer";
import { AddStoryModal } from "./components/AddStoryModal";
import { CastRail } from "./components/CastRail";
import { DeleteModal } from "./components/DeleteModal";
import { DoctorModal } from "./components/DoctorModal";
import { Header } from "./components/Header";
import { SettingsModal } from "./components/SettingsModal";
import { StoryRail } from "./components/StoryRail";
import { StoryScene } from "./components/StoryScene";
import { Transport } from "./components/Transport";
import { VoicePickerModal } from "./components/VoicePickerModal";
import { Character, OperationEvent, SetupStatus, StoryDetail, StorySummary, VoiceItem } from "./types";

type MobilePanel = "library" | "stage" | "cast";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const App: React.FC = () => {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<StoryDetail | null>(null);
  const [isStoryLoading, setIsStoryLoading] = useState(false);
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("stage");

  const [activeOperation, setActiveOperation] = useState<OperationEvent | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [voicePickerChar, setVoicePickerChar] = useState<Character | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingInFlightRef = useRef(false);
  const operationDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledOperationsRef = useRef(new Set<string>());
  const selectedStoryIdRef = useRef(selectedStoryId);
  selectedStoryIdRef.current = selectedStoryId;

  const audio = useAudioPlayer(
    selectedStory?.manifest.story_id,
    selectedStory?.segments || []
  );

  const refreshSetup = useCallback(async () => {
    try {
      setSetupStatus(await api.getSetupStatus());
    } catch (error) {
      console.warn("Could not load setup status", error);
    }
  }, []);

  const refreshStories = useCallback(async () => {
    try {
      const list = await api.getStories();
      setStories(list);
      setSelectedStoryId((current) => {
        if (current && list.some((story) => story.story_id === current)) return current;
        return list[0]?.story_id || null;
      });
    } catch (error) {
      console.warn("Could not load stories", error);
    }
  }, []);

  const refreshCurrentStory = useCallback(async (storyId: string, showLoading = false) => {
    if (showLoading) setIsStoryLoading(true);
    try {
      const detail = await api.getStory(storyId);
      if (selectedStoryIdRef.current === storyId) setSelectedStory(detail);
    } catch (error) {
      console.warn("Could not load story detail", error);
      if (selectedStoryIdRef.current === storyId) {
        setSelectedStory(null);
        setOperationError("This story could not be opened. Try selecting it again.");
      }
    } finally {
      if (showLoading && selectedStoryIdRef.current === storyId) setIsStoryLoading(false);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    try {
      setVoices(await api.getVoices());
    } catch (error) {
      console.warn("Could not load voices", error);
    }
  }, []);

  const refreshProviderState = useCallback(async () => {
    await Promise.all([refreshSetup(), refreshVoices()]);
  }, [refreshSetup, refreshVoices]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollingInFlightRef.current = false;
  }, []);

  const scheduleOperationDismissal = useCallback((operationId: string) => {
    if (operationDismissTimerRef.current) clearTimeout(operationDismissTimerRef.current);
    operationDismissTimerRef.current = setTimeout(() => {
      setActiveOperation((current) => current?.operation_id === operationId ? null : current);
    }, 1800);
  }, []);

  const handleOperationEvent = useCallback((event: OperationEvent) => {
    const isSettled = event.state === "completed" || event.state === "failed" || event.state === "cancelled";
    if (isSettled && settledOperationsRef.current.has(event.operation_id)) return;
    setActiveOperation(event);

    if (event.state === "completed") {
      settledOperationsRef.current.add(event.operation_id);
      stopPolling();
      void refreshStories();
      const storyId = selectedStoryIdRef.current;
      if (storyId) void refreshCurrentStory(storyId);
      scheduleOperationDismissal(event.operation_id);
    } else if (event.state === "failed") {
      settledOperationsRef.current.add(event.operation_id);
      stopPolling();
      setOperationError(event.error || event.message_code || "Operation failed");
    } else if (event.state === "cancelled") {
      settledOperationsRef.current.add(event.operation_id);
      stopPolling();
      setActiveOperation(null);
    }
  }, [refreshCurrentStory, refreshStories, scheduleOperationDismissal, stopPolling]);

  const startPollingOperation = useCallback((operationId: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      if (pollingInFlightRef.current) return;
      pollingInFlightRef.current = true;
      try {
        const operation = await api.getOperation(operationId);
        if (operation) handleOperationEvent(operation);
      } catch {
        // WebSocket events remain the primary progress source.
      } finally {
        pollingInFlightRef.current = false;
      }
    }, 700);
  }, [handleOperationEvent, stopPolling]);

  useEffect(() => {
    let disposed = false;
    void api.init().then(() => {
      if (disposed) return;
      return Promise.all([refreshSetup(), refreshStories(), refreshVoices()]);
    }).catch((error) => {
      if (!disposed) setOperationError(getErrorMessage(error, "Teller could not connect to its local service."));
    });

    const unsubscribe = api.onOperationEvent(handleOperationEvent);
    return () => {
      disposed = true;
      stopPolling();
      if (operationDismissTimerRef.current) clearTimeout(operationDismissTimerRef.current);
      unsubscribe();
    };
  }, [handleOperationEvent, refreshSetup, refreshStories, refreshVoices, stopPolling]);

  useEffect(() => {
    if (!selectedStoryId) {
      setSelectedStory(null);
      setIsStoryLoading(false);
      return;
    }
    setSelectedStory(null);
    void refreshCurrentStory(selectedStoryId, true);
  }, [refreshCurrentStory, selectedStoryId]);

  const handleAnalyze = useCallback(async (force = false) => {
    const storyId = selectedStoryIdRef.current;
    if (!storyId) return;
    setOperationError(null);

    if (setupStatus?.llm_provider === "gemini" && !setupStatus.gemini_key_present) {
      setOperationError("Gemini API key is required for story analysis.");
      setIsSettingsOpen(true);
      return;
    }
    if (setupStatus?.llm_provider === "groq" && !setupStatus.groq_key_present) {
      setOperationError("Groq API key is required for story analysis.");
      setIsSettingsOpen(true);
      return;
    }

    try {
      setActiveOperation({
        operation_id: "init",
        kind: "analyze",
        state: "running",
        completed: 0,
        total: 1,
        message_code: "starting_analysis",
      });
      const result = await api.analyzeStory(storyId, force);
      setActiveOperation({
        operation_id: result.operation_id,
        kind: "analyze",
        state: "running",
        completed: 0,
        total: 1,
        message_code: "reading_story_chunks",
      });
      startPollingOperation(result.operation_id);
    } catch (error) {
      setActiveOperation(null);
      const message = getErrorMessage(error, "Failed to start analysis");
      setOperationError(message);
      if (/settings|api key|key not found/i.test(message)) setIsSettingsOpen(true);
    }
  }, [setupStatus, startPollingOperation]);

  const handleRender = useCallback(async () => {
    const storyId = selectedStoryIdRef.current;
    if (!storyId) return;
    setOperationError(null);

    if (setupStatus?.tts_provider === "elevenlabs" && !setupStatus.elevenlabs_key_present) {
      setOperationError("ElevenLabs API key is required to render voices.");
      setIsSettingsOpen(true);
      return;
    }
    if (
      setupStatus?.tts_provider === "kokoro"
      && (
        !setupStatus.kokoro_model_present
        || !setupStatus.kokoro_voices_present
        || !setupStatus.kokoro_runtime_available
      )
    ) {
      setOperationError(
        setupStatus.kokoro_model_present && setupStatus.kokoro_voices_present
          ? "The Kokoro runtime is incomplete. Restart Teller after installing the latest desktop build."
          : "Download the Kokoro voice assets before rendering."
      );
      setIsSettingsOpen(true);
      return;
    }

    try {
      setActiveOperation({
        operation_id: "init",
        kind: "render",
        state: "running",
        completed: 0,
        total: selectedStory?.segments.length || 1,
        message_code: "preparing_recording",
      });
      const result = await api.renderStory(storyId);
      setActiveOperation({
        operation_id: result.operation_id,
        kind: "render",
        state: "running",
        completed: 0,
        total: selectedStory?.segments.length || 1,
        message_code: "recording_character_lines",
      });
      startPollingOperation(result.operation_id);
    } catch (error) {
      setActiveOperation(null);
      setOperationError(getErrorMessage(error, "Failed to start voice rendering"));
    }
  }, [selectedStory?.segments.length, setupStatus, startPollingOperation]);

  const handleReassignCast = useCallback(async () => {
    const storyId = selectedStoryIdRef.current;
    if (!storyId) return;
    setOperationError(null);
    if (
      setupStatus?.tts_provider === "kokoro"
      && (
        !setupStatus.kokoro_model_present
        || !setupStatus.kokoro_voices_present
        || !setupStatus.kokoro_runtime_available
      )
    ) {
      setOperationError(
        setupStatus.kokoro_model_present && setupStatus.kokoro_voices_present
          ? "The Kokoro runtime is incomplete. Restart Teller after installing the latest desktop build."
          : "Download the Kokoro voice assets before auto-casting."
      );
      setIsSettingsOpen(true);
      return;
    }
    try {
      const result = await api.reassignVoices(storyId);
      setActiveOperation({
        operation_id: result.operation_id,
        kind: "reassign_voices",
        state: "pending",
        completed: 0,
        total: selectedStory?.characters.length || 1,
        message_code: "recasting_voices",
      });
      startPollingOperation(result.operation_id);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Voice reassignment failed"));
    }
  }, [selectedStory?.characters.length, setupStatus, startPollingOperation]);

  const handleCancelOperation = useCallback(async () => {
    if (!activeOperation) return;
    const operationId = activeOperation.operation_id;
    stopPolling();
    try {
      if (operationId !== "init") await api.cancelOperation(operationId);
      settledOperationsRef.current.add(operationId);
    } catch (error) {
      console.warn("Cancel failed", error);
    } finally {
      setActiveOperation(null);
    }
  }, [activeOperation, stopPolling]);

  const handleAssignVoice = useCallback(async (characterId: string, voiceId: string) => {
    const storyId = selectedStoryIdRef.current;
    if (!storyId) return;
    try {
      await api.updateCharacterVoice(storyId, characterId, voiceId);
      await refreshCurrentStory(storyId);
    } catch (error) {
      const message = getErrorMessage(error, "Failed to assign voice");
      setOperationError(message);
      throw new Error(message);
    }
  }, [refreshCurrentStory]);

  const handleDeleteStoryConfirm = useCallback(async () => {
    if (!deleteTargetId || isDeleting) return;
    setIsDeleting(true);
    try {
      await api.deleteStory(deleteTargetId);
      if (selectedStoryIdRef.current === deleteTargetId) {
        setSelectedStoryId(null);
        setSelectedStory(null);
      }
      setDeleteTargetId(null);
      await refreshStories();
    } catch (error) {
      setOperationError(getErrorMessage(error, "The story could not be deleted"));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTargetId, isDeleting, refreshStories]);

  const handleDownloadStoryAudio = useCallback(async () => {
    if (!selectedStory || selectedStory.rendered_count === 0 || isExporting) return;
    const storyId = selectedStory.manifest.story_id;
    const safeTitle = (selectedStory.manifest.title || "story")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[-\s]+/g, "_") || "story";
    const filename = `${safeTitle}.wav`;

    setIsExporting(true);
    try {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const selectedPath = await save({
            defaultPath: filename,
            filters: [{ name: "Waveform Audio", extensions: ["wav"] }],
          });
          if (selectedPath === null) return;
          if (typeof selectedPath === "string") {
            await api.exportStoryAudio(storyId, selectedPath);
            return;
          }
        } catch (error) {
          console.warn("Native save dialog unavailable, using browser download", error);
        }
      }

      const blob = await api.downloadStoryAudio(storyId);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);
    } catch (error) {
      setOperationError(getErrorMessage(error, "Failed to export audio"));
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, selectedStory]);

  const handleSelectStory = useCallback((storyId: string) => {
    startTransition(() => setSelectedStoryId(storyId));
    setMobilePanel("stage");
  }, []);
  const handleOpenAdd = useCallback(() => setIsAddOpen(true), []);
  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleOpenDoctor = useCallback(() => setIsDoctorOpen(true), []);
  const handleDismissError = useCallback(() => {
    setOperationError(null);
    audio.clearError();
  }, [audio.clearError]);
  const handleRequestDelete = useCallback((storyId: string) => setDeleteTargetId(storyId), []);
  const handleSelectCharacterVoice = useCallback((character: Character) => setVoicePickerChar(character), []);

  const currentSegment = selectedStory?.segments[audio.currentSegmentIndex];
  const activeSpeakerId = currentSegment?.speaker_id || null;
  const currentSpeakerName = selectedStory?.characters.find((character) => character.id === activeSpeakerId)?.name
    || activeSpeakerId
    || undefined;

  useEffect(() => {
    document.body.classList.toggle("playing", audio.isPlaying);
    return () => document.body.classList.remove("playing");
  }, [audio.isPlaying]);

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <div className="theatre-shell">
        <Header
          setupStatus={setupStatus}
          onOpenSettings={handleOpenSettings}
          onOpenDoctor={handleOpenDoctor}
        />

        <nav className="mobile-module-nav" aria-label="Workspace panels">
          {(["library", "stage", "cast"] as MobilePanel[]).map((panel) => (
            <button
              type="button"
              key={panel}
              className={mobilePanel === panel ? "active" : ""}
              aria-pressed={mobilePanel === panel}
              onClick={() => setMobilePanel(panel)}
            >
              {panel === "stage" ? "Story" : panel[0].toUpperCase() + panel.slice(1)}
            </button>
          ))}
        </nav>

        <div className={`workspace-body mobile-panel-${mobilePanel}`}>
          <StoryRail
            stories={stories}
            selectedStoryId={selectedStoryId}
            onSelectStory={handleSelectStory}
            onAddStory={handleOpenAdd}
            onDeleteStory={handleRequestDelete}
          />

          <StoryScene
            story={selectedStory}
            isLoading={isStoryLoading}
            currentSegmentIndex={audio.currentSegmentIndex}
            segmentTime={audio.segmentTime}
            segmentDuration={audio.segmentDuration}
            isPlaying={audio.isPlaying}
            activeOperation={activeOperation}
            operationError={operationError || audio.error}
            onDismissError={handleDismissError}
            onOpenSettings={handleOpenSettings}
            onAnalyze={handleAnalyze}
            onRender={handleRender}
            onCancelOperation={handleCancelOperation}
            onDownload={handleDownloadStoryAudio}
            isDownloading={isExporting}
            onSeekSegment={audio.seekSegment}
            onAddStory={handleOpenAdd}
          />

          <CastRail
            characters={selectedStory?.characters || []}
            voices={voices}
            activeSpeakerId={activeSpeakerId}
            isPlaying={audio.isPlaying}
            onSelectCharacterVoice={handleSelectCharacterVoice}
            onReassignCast={handleReassignCast}
            disabled={!selectedStory || Boolean(activeOperation && ["pending", "running"].includes(activeOperation.state))}
          />
        </div>

        <Transport
          isPlaying={audio.isPlaying}
          currentTime={audio.currentTime}
          totalDuration={audio.totalDuration}
          volume={audio.volume}
          onPlay={audio.play}
          onPause={audio.pause}
          onPrev={audio.prev}
          onNext={audio.next}
          onSeek={audio.seekToTime}
          onVolumeChange={audio.setVolume}
          disabled={!selectedStory || selectedStory.rendered_count === 0}
          currentSpeakerName={currentSpeakerName}
        />

        <AddStoryModal
          isOpen={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          onStoryCreated={(storyId) => {
            void refreshStories();
            setSelectedStoryId(storyId);
            setMobilePanel("stage");
          }}
        />
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          setupStatus={setupStatus}
          onRefreshStatus={refreshProviderState}
        />
        <DoctorModal isOpen={isDoctorOpen} onClose={() => setIsDoctorOpen(false)} />
        <DeleteModal
          isOpen={Boolean(deleteTargetId)}
          storyTitle={stories.find((story) => story.story_id === deleteTargetId)?.title || "this story"}
          onClose={() => setDeleteTargetId(null)}
          onConfirm={handleDeleteStoryConfirm}
          loading={isDeleting}
        />
        <VoicePickerModal
          isOpen={Boolean(voicePickerChar)}
          character={voicePickerChar}
          voices={voices}
          onClose={() => setVoicePickerChar(null)}
          onAssignVoice={handleAssignVoice}
        />
      </div>
    </>
  );
};
