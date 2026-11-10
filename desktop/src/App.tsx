import React, { useEffect, useState } from "react";
import { api } from "./api/client";
import { useAudioPlayer } from "./audio/useAudioPlayer";
import { CastRail } from "./components/CastRail";
import { DeleteModal } from "./components/DeleteModal";
import { DoctorModal } from "./components/DoctorModal";
import { Header } from "./components/Header";
import { SettingsModal } from "./components/SettingsModal";
import { StoryRail } from "./components/StoryRail";
import { StoryScene } from "./components/StoryScene";
import { Transport } from "./components/Transport";
import { VoicePickerModal } from "./components/VoicePickerModal";
import { AddStoryModal } from "./components/AddStoryModal";
import { Character, OperationEvent, SetupStatus, StoryDetail, StorySummary, VoiceItem } from "./types";

export const App: React.FC = () => {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<StoryDetail | null>(null);
  const [voices, setVoices] = useState<VoiceItem[]>([]);

  // Operations state
  const [activeOperation, setActiveOperation] = useState<OperationEvent | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const pollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const startPollingOperation = (opId: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const op = await api.getOperation(opId);
        if (!op) return;
        setActiveOperation(op);
        if (op.state === "completed") {
          stopPolling();
          refreshStories();
          if (selectedStoryId) {
            refreshCurrentStory(selectedStoryId);
          }
          setTimeout(() => {
            setActiveOperation((curr) => (curr?.operation_id === opId ? null : curr));
          }, 1800);
        } else if (op.state === "failed") {
          stopPolling();
          setOperationError(op.error || op.message_code || "Operation failed");
        } else if (op.state === "cancelled") {
          stopPolling();
          setActiveOperation(null);
        }
      } catch {
        // Ignore transient poll error
      }
    }, 600);
  };

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [voicePickerChar, setVoicePickerChar] = useState<Character | null>(null);

  // Audio player hook
  const audio = useAudioPlayer(
    selectedStory?.manifest.story_id,
    selectedStory?.segments || []
  );

  const refreshSetup = async () => {
    try {
      const status = await api.getSetupStatus();
      setSetupStatus(status);
    } catch (err) {
      console.warn("Could not load setup status", err);
    }
  };

  const refreshStories = async () => {
    try {
      const list = await api.getStories();
      setStories(list);
      if (!selectedStoryId && list.length > 0) {
        setSelectedStoryId(list[0].story_id);
      }
    } catch (err) {
      console.warn("Could not load stories", err);
    }
  };

  const refreshCurrentStory = async (storyId: string) => {
    try {
      const detail = await api.getStory(storyId);
      setSelectedStory(detail);
    } catch (err) {
      console.warn("Could not load story detail", err);
    }
  };

  const refreshVoices = async () => {
    try {
      const v = await api.getVoices();
      setVoices(v);
    } catch (err) {
      console.warn("Could not load voices", err);
    }
  };

  useEffect(() => {
    api.init().then(() => {
      refreshSetup();
      refreshStories();
      refreshVoices();
    });

    const unsubscribe = api.onOperationEvent((event) => {
      setActiveOperation(event);
      if (event.state === "completed") {
        stopPolling();
        refreshStories();
        if (selectedStoryId) {
          refreshCurrentStory(selectedStoryId);
        }
        setTimeout(() => {
          setActiveOperation((curr) => (curr?.operation_id === event.operation_id ? null : curr));
        }, 1800);
      } else if (event.state === "failed") {
        stopPolling();
        setOperationError(event.error || event.message_code || "Operation failed");
      }
    });

    return () => {
      stopPolling();
      unsubscribe();
    };
  }, [selectedStoryId]);

  useEffect(() => {
    if (selectedStoryId) {
      refreshCurrentStory(selectedStoryId);
    } else {
      setSelectedStory(null);
    }
  }, [selectedStoryId]);

  const handleAnalyze = async (force = false) => {
    if (!selectedStoryId) return;
    setOperationError(null);

    // If Gemini or Groq is chosen but no key is stored, guide user straight to Settings
    if (setupStatus?.llm_provider === "gemini" && !setupStatus.gemini_key_present) {
      setOperationError("Gemini API key is required for story analysis. Please add your key in Settings.");
      setIsSettingsOpen(true);
      return;
    }
    if (setupStatus?.llm_provider === "groq" && !setupStatus.groq_key_present) {
      setOperationError("Groq API key is required for story analysis. Please add your key in Settings.");
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
        message_code: "Starting analysis...",
      });
      const res = await api.analyzeStory(selectedStoryId, force);
      setActiveOperation({
        operation_id: res.operation_id,
        kind: "analyze",
        state: "running",
        completed: 0,
        total: 1,
        message_code: "Analyzing story chunks with AI...",
      });
      startPollingOperation(res.operation_id);
    } catch (err: any) {
      setActiveOperation(null);
      const errMsg = err.message || "Failed to start analysis";
      setOperationError(errMsg);
      if (errMsg.includes("Settings") || errMsg.includes("API key") || errMsg.includes("key not found")) {
        setIsSettingsOpen(true);
      }
    }
  };

  const handleRender = async () => {
    if (!selectedStoryId) return;
    setOperationError(null);

    // Pre-flight checks for TTS provider
    if (setupStatus?.tts_provider === "elevenlabs" && !setupStatus.elevenlabs_key_present) {
      setOperationError("ElevenLabs API key is required to render voices. Please add your key in Settings.");
      setIsSettingsOpen(true);
      return;
    }
    if (setupStatus?.tts_provider === "kokoro" && (!setupStatus.kokoro_model_present || !setupStatus.kokoro_voices_present)) {
      setOperationError("Kokoro voice assets must be downloaded first. Please open Settings to download offline assets.");
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
        message_code: "Starting voice synthesis...",
      });
      const res = await api.renderStory(selectedStoryId);
      setActiveOperation({
        operation_id: res.operation_id,
        kind: "render",
        state: "running",
        completed: 0,
        total: selectedStory?.segments.length || 1,
        message_code: "Rendering character lines...",
      });
      startPollingOperation(res.operation_id);
    } catch (err: any) {
      setActiveOperation(null);
      setOperationError(err.message || "Failed to start voice rendering");
    }
  };

  const handleReassignCast = async () => {
    if (!selectedStoryId) return;
    try {
      const res = await api.reassignVoices(selectedStoryId);
      setActiveOperation({
        operation_id: res.operation_id,
        kind: "reassign_voices",
        state: "pending",
        completed: 0,
        total: selectedStory?.characters.length || 1,
        message_code: "Reassigning cast voices...",
      });
      startPollingOperation(res.operation_id);
    } catch (err: any) {
      setOperationError(`Voice reassignment failed: ${err.message}`);
    }
  };

  const handleCancelOperation = async () => {
    if (!activeOperation) return;
    const opId = activeOperation.operation_id;
    stopPolling();
    try {
      if (opId !== "init") {
        await api.cancelOperation(opId);
      }
      setActiveOperation(null);
    } catch (err: any) {
      console.warn("Cancel failed", err);
      setActiveOperation(null);
    }
  };

  const handleAssignVoice = async (characterId: string, voiceId: string) => {
    if (!selectedStoryId) return;
    try {
      await api.updateCharacterVoice(selectedStoryId, characterId, voiceId);
      refreshCurrentStory(selectedStoryId);
    } catch (err: any) {
      alert(`Failed to assign voice: ${err.message}`);
    }
  };

  const handleDeleteStoryConfirm = async () => {
    if (!deleteTargetId) return;
    try {
      await api.deleteStory(deleteTargetId);
      if (selectedStoryId === deleteTargetId) {
        setSelectedStoryId(null);
        setSelectedStory(null);
      }
      setDeleteTargetId(null);
      refreshStories();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="theatre-shell">
      <Header
        setupStatus={setupStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDoctor={() => setIsDoctorOpen(true)}
      />

      <div className="workspace-body">
        {/* Left Story Rail */}
        <StoryRail
          stories={stories}
          selectedStoryId={selectedStoryId}
          onSelectStory={(id) => setSelectedStoryId(id)}
          onAddStory={() => setIsAddOpen(true)}
          onDeleteStory={(id) => setDeleteTargetId(id)}
        />

        {/* Center Stage */}
        <StoryScene
          story={selectedStory}
          currentSegmentIndex={audio.currentSegmentIndex}
          activeOperation={activeOperation}
          operationError={operationError}
          onDismissError={() => setOperationError(null)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onAnalyze={handleAnalyze}
          onRender={handleRender}
          onCancelOperation={handleCancelOperation}
        />

        {/* Right Cast Rail */}
        <CastRail
          characters={selectedStory?.characters || []}
          onSelectCharacterVoice={(char) => setVoicePickerChar(char)}
          onReassignCast={handleReassignCast}
          disabled={!selectedStory}
        />
      </div>

      {/* Bottom Transport Player */}
      <Transport
        isPlaying={audio.isPlaying}
        currentTime={audio.currentTime}
        totalDuration={audio.totalDuration}
        volume={audio.volume}
        onPlay={audio.play}
        onPause={audio.pause}
        onPrev={audio.prev}
        onNext={audio.next}
        onVolumeChange={audio.setVolume}
        disabled={!selectedStory || selectedStory.rendered_count === 0}
      />

      {/* Modals */}
      <AddStoryModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onStoryCreated={(id) => {
          refreshStories();
          setSelectedStoryId(id);
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        setupStatus={setupStatus}
        onRefreshStatus={refreshSetup}
      />

      <DoctorModal
        isOpen={isDoctorOpen}
        onClose={() => setIsDoctorOpen(false)}
      />

      <DeleteModal
        isOpen={Boolean(deleteTargetId)}
        storyTitle={stories.find((s) => s.story_id === deleteTargetId)?.title || "this story"}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDeleteStoryConfirm}
      />

      <VoicePickerModal
        isOpen={Boolean(voicePickerChar)}
        character={voicePickerChar}
        voices={voices}
        onClose={() => setVoicePickerChar(null)}
        onAssignVoice={handleAssignVoice}
      />
    </div>
  );
};

