export type FreshcallerParticipant = {
  id: number;
  call_id: number;
  caller_id?: number | null;
  caller_number?: string | null;
  caller_name?: string | null;
  participant_id?: string | number | null;
  participant_type: string;
  connection_type?: number;
  call_status?: number;
  duration?: number;
  duration_unit?: string;
  cost?: number;
  cost_unit?: string;
  enqueued_time?: string | null;
  created_time?: string;
  updated_time?: string;
};

export type FreshcallerRecording = {
  id: number;
  url: string;
  transcription_url?: string | null;
  duration?: number;
  duration_unit?: string;
};

export type FreshcallerLifeCycleEvent = {
  type: string;
  id?: number;
  leg_type?: number;
  user_id?: number;
  contact_id?: number | null;
  reason?: string;
  time_stamp: string;
};

export type FreshcallerCall = {
  id: number;
  direction: string;
  phone_number?: string | null;
  assigned_agent_id?: number | null;
  assigned_agent_name?: string | null;
  assigned_team_name?: string | null;
  bill_duration?: number | null;
  bill_duration_unit?: string | null;
  created_time: string;
  updated_time?: string;
  call_notes?: string | null;
  recording: FreshcallerRecording | null;
  participants: FreshcallerParticipant[];
  life_cycle?: FreshcallerLifeCycleEvent[];
  /** Local path once recording has been downloaded */
  localRecordingPath?: string;
  localRecordingName?: string;
};

export type ExportJobStatus =
  | "started"
  | "in_progress"
  | "completed"
  | "failed"
  | "downloading"
  | "indexing";

export type ExportJobRecord = {
  id: number;
  status: ExportJobStatus;
  message?: string;
  createdAt: string;
  updatedAt: string;
  downloadPath?: string;
  error?: string;
  callCount?: number;
  callsWithRecording?: number;
  startDate?: string;
  endDate?: string;
};
