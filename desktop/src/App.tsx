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
        refreshStories();
        if (selectedStoryId) {
          refreshCurrentStory(selectedStoryId);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (selectedStoryId) {
      refreshCurrentStory(selectedStoryId);
    } else {
      setSelectedStory(null);
    }
  }, [selectedStoryId]);

  const handleAnalyze = async (force = false) => {
    if (!selectedStoryId) return;
    try {
      const res = await api.analyzeStory(selectedStoryId, force);
      setActiveOperation({
        operation_id: res.operation_id,
        kind: "analyze",
        state: "pending",
        completed: 0,
        total: 1,
        message_code: "analysis_queued",
      });
    } catch (err: any) {
      alert(`Analysis failed to start: ${err.message}`);
    }
  };

  const handleRender = async () => {
    if (!selectedStoryId) return;
    try {
      const res = await api.renderStory(selectedStoryId);
      setActiveOperation({
        operation_id: res.operation_id,
        kind: "render",
        state: "pending",
        completed: 0,
        total: selectedStory?.segments.length || 1,
        message_code: "render_queued",
      });
    } catch (err: any) {
      alert(`Rendering failed to start: ${err.message}`);
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
        message_code: "reassigning_queued",
      });
    } catch (err: any) {
      alert(`Voice reassignment failed to start: ${err.message}`);
    }
  };

  const handleCancelOperation = async () => {
    if (!activeOperation) return;
    try {
      await api.cancelOperation(activeOperation.operation_id);
      setActiveOperation(null);
    } catch (err: any) {
      console.warn("Cancel failed", err);
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

