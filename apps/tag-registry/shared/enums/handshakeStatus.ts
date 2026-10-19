/** Backend-side handshake state per module, published in HMI.Module_Info.Handshake. */
export const HandshakeStatus = {
  NA:          0,  // not an MQTT module
  NONE:        1,  // no HANDSHAKE_REQUEST since backend start
  REQUESTED:   2,  // TAG_LIST sent, waiting for CONFIRM
  PUSHING:     3,  // CONFIRM received, waiting for the Set push ACK
  BOUND:       4,  // push acked (or no Sets), no missing_ids
  MISSING_IDS: 5,  // CONFIRM reported missing_ids
  PUSH_FAILED: 6,  // Set push not acked, or the setpoint store could not be read
  CONFLICT:    7,  // reserved: second module with the same module_id (rejection not built)
} as const;

export const HandshakeStatusLabels: Record<number, string> = {
  0: 'N/A',
  1: 'NONE',
  2: 'REQUESTED',
  3: 'PUSHING',
  4: 'BOUND',
  5: 'MISSING_IDS',
  6: 'PUSH_FAILED',
  7: 'CONFLICT',
};
