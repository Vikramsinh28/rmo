export interface CallSignalDescription {
  type: string;
  sdp: string;
}

export interface CallSignalCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface CallSignal {
  seq: number;
  callId: number;
  fromUserId: number;
  type: 'offer' | 'answer' | 'ice';
  description: CallSignalDescription | null;
  candidate: CallSignalCandidate | null;
}

const byCall = new Map<number, CallSignal[]>();
let nextSeq = 0;

export function appendCallSignal(input: Omit<CallSignal, 'seq'>): CallSignal {
  const signal: CallSignal = { ...input, seq: ++nextSeq };
  const list = byCall.get(input.callId) || [];
  list.push(signal);
  if (list.length > 300) list.splice(0, list.length - 300);
  byCall.set(input.callId, list);
  return signal;
}

export function readCallSignals(callId: number, after: number): CallSignal[] {
  return (byCall.get(callId) || []).filter(item => item.seq > after);
}

export function clearCallSignals(callId: number) {
  byCall.delete(callId);
}
